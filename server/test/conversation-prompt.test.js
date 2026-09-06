const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSystemPrompt } = require('../src/lib/llm/systemPrompt');

test('sales prompt explicitly prevents repeated greetings and directs meeting requests to the secure form', () => {
  const prompt = buildSystemPrompt({ deal: { teamSize: { value: '300' }, conversationStage: 'QUALIFY', status: 'ACTIVE' } });
  assert.match(prompt, /Do not greet again/i);
  assert.match(prompt, /request_meeting_details/);
  assert.match(prompt, /Do not ask the customer to spell an email/i);
  assert.match(prompt, /teamSize.*300/);
});
