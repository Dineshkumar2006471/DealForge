const test = require('node:test');
const assert = require('node:assert/strict');
const { openaiToGeminiMessages } = require('../src/lib/llm/geminiAdapter');

test('Gemini history groups all tool results after their corresponding function-call turn', () => {
  const { contents } = openaiToGeminiMessages([
    { role: 'user', content: 'Please update my deal.' },
    { role: 'assistant', content: null, tool_calls: [
      { function: { name: 'update_deal_state', arguments: '{"field":"teamSize","value":"300"}' } },
      { function: { name: 'calculate_discount', arguments: '{"requested_pct":15}' } },
    ] },
    { role: 'tool', name: 'update_deal_state', content: '{"updated":true}' },
    { role: 'tool', name: 'calculate_discount', content: '{"approved":true}' },
    { role: 'assistant', content: 'I have updated the verified deal state.' },
  ]);

  assert.equal(contents.length, 4);
  assert.equal(contents[1].role, 'model');
  assert.equal(contents[1].parts.filter(part => part.functionCall).length, 2);
  assert.equal(contents[2].role, 'user');
  assert.equal(contents[2].parts.filter(part => part.functionResponse).length, 2);
  assert.deepEqual(contents[2].parts[0].functionResponse.response.result, { updated: true });
  assert.equal(contents[3].role, 'model');
});
