/**
 * LLM Adapter Interface
 *
 * Generic interface that the Agent Runtime depends on.
 * The rest of the application NEVER imports Gemini SDK directly.
 *
 * Architecture:
 *   agentRuntime → adapter (this) → geminiAdapter → configured model
 */

const geminiAdapter = require('./geminiAdapter');

/**
 * Generate a streaming response from the LLM.
 *
 * @param {Array} messages - OpenAI-format messages array
 * @param {Array} tools - OpenAI-format tool definitions
 * @param {object} options - Additional options (dealId, sessionId, etc.)
 * @returns {AsyncIterable<object>} - Yields OpenAI-compatible SSE chunk objects
 */
async function* generateResponse(messages, tools = [], options = {}) {
  yield* geminiAdapter.generateResponse(messages, tools, options);
}

/**
 * Generate a non-streaming response (for internal tool result processing).
 *
 * @param {Array} messages - OpenAI-format messages array
 * @param {Array} tools - OpenAI-format tool definitions
 * @returns {object} - Complete response with content and/or tool_calls
 */
async function generateResponseSync(messages, tools = []) {
  return geminiAdapter.generateResponseSync(messages, tools);
}

module.exports = {
  generateResponse,
  generateResponseSync,
};
