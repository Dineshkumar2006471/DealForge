/**
 * Gemini Adapter
 *
 * ONLY file that imports @google-cloud/vertexai.
 * Translates between OpenAI-format messages (from Agora) and Gemini's native format,
 * then translates Gemini's response back to OpenAI-format SSE chunks.
 *
 * Model is configurable via GEMINI_MODEL env var.
 */
const { VertexAI, HarmCategory, HarmBlockThreshold } = require('@google-cloud/vertexai');
const { v4: uuidv4 } = require('uuid');

// Initialize Vertex AI
const projectId = process.env.GCP_PROJECT_ID;
const region = process.env.GCP_REGION || 'us-central1';
const modelId = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let vertexAI;
let generativeModel;

function getModel() {
  if (!generativeModel) {
    vertexAI = new VertexAI({ project: projectId, location: region });
    generativeModel = vertexAI.getGenerativeModel({
      model: modelId,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      ],
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 2048,
      },
    });
    console.log(`🤖 Gemini adapter initialized: ${modelId} in ${region}`);
  }
  return generativeModel;
}

// --- Format Translation ---

/**
 * Convert OpenAI-format messages to Gemini format.
 */
function openaiToGeminiMessages(messages) {
  const systemInstruction = [];
  const contents = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction.push({ text: msg.content });
    } else if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content }] });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls) {
        // Assistant requesting tool calls
        const parts = msg.tool_calls.map(tc => ({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || '{}'),
          },
        }));
        if (msg.content) parts.unshift({ text: msg.content });
        contents.push({ role: 'model', parts });
      } else {
        contents.push({ role: 'model', parts: [{ text: msg.content || '' }] });
      }
    } else if (msg.role === 'tool') {
      // Tool result → Gemini functionResponse
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: msg.name || 'tool_result',
            response: { result: msg.content },
          },
        }],
      });
    }
  }

  return { systemInstruction, contents };
}

/**
 * Convert OpenAI-format tool definitions to Gemini format.
 */
function openaiToGeminiTools(tools) {
  if (!tools || tools.length === 0) return undefined;

  const functionDeclarations = tools
    .filter(t => t.type === 'function')
    .map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters || { type: 'object', properties: {} },
    }));

  return functionDeclarations.length > 0
    ? [{ functionDeclarations }]
    : undefined;
}

/**
 * Streaming: Generate response as OpenAI-compatible SSE chunks.
 */
async function* generateResponse(messages, tools = [], options = {}) {
  const model = getModel();
  const { systemInstruction, contents } = openaiToGeminiMessages(messages);
  const geminiTools = openaiToGeminiTools(tools);
  const chatId = `chatcmpl-${uuidv4()}`;

  const request = {
      contents,
      tools: geminiTools,
    };

  if (systemInstruction.length > 0) {
    request.systemInstruction = { parts: systemInstruction };
  }

  try {
    const streamingResult = await model.generateContentStream(request);

    let isFirst = true;
    let hasToolCalls = false;

    for await (const chunk of streamingResult.stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;

      for (const part of candidate.content?.parts || []) {
        if (part.text) {
          // Text content chunk
          yield {
            id: chatId,
            choices: [{
              index: 0,
              delta: isFirst
                ? { role: 'assistant', content: part.text }
                : { content: part.text },
              finish_reason: null,
            }],
          };
          isFirst = false;
        } else if (part.functionCall) {
          // Tool call chunk
          hasToolCalls = true;
          const toolCallId = `tc_${uuidv4().slice(0, 8)}`;
          yield {
            id: chatId,
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: toolCallId,
                  type: 'function',
                  function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args || {}),
                  },
                }],
              },
              finish_reason: null,
            }],
          };
        }
      }
    }

    // Send finish chunk
    yield {
      id: chatId,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: hasToolCalls ? 'tool_calls' : 'stop',
      }],
    };
  } catch (err) {
    // The caller records this as a real runtime failure before returning a safe spoken apology.
    throw new Error(`Gemini streaming error: ${err.message}`);
  }
}

/**
 * Non-streaming: Generate a complete response (for internal processing).
 */
async function generateResponseSync(messages, tools = []) {
  const model = getModel();
  const { systemInstruction, contents } = openaiToGeminiMessages(messages);
  const geminiTools = openaiToGeminiTools(tools);

  const request = { contents, tools: geminiTools };
  if (systemInstruction.length > 0) {
    request.systemInstruction = { parts: systemInstruction };
  }

  const result = await model.generateContent(request);
  const candidate = result.response?.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  const textParts = parts.filter(p => p.text).map(p => p.text);
  const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({
    id: `tc_${uuidv4().slice(0, 8)}`,
    type: 'function',
    function: {
      name: p.functionCall.name,
      arguments: JSON.stringify(p.functionCall.args || {}),
    },
  }));

  return {
    content: textParts.join('') || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

module.exports = {
  generateResponse,
  generateResponseSync,
};
