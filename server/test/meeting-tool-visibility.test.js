const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/lib/tools/bookMeeting');
require('../src/lib/tools/requestMeetingDetails');
const { getToolDefinitions } = require('../src/lib/tools/registry');

test('the model sees the secure meeting-details request tool but not raw booking execution', () => {
  const names = getToolDefinitions().map(tool => tool.function.name);
  assert.ok(names.includes('request_meeting_details'));
  assert.ok(!names.includes('book_meeting'));
});
