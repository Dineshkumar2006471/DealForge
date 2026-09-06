const { registerTool } = require('./registry');
const { requestMeetingDetails } = require('../meetings/meetingRequests');

async function requestMeetingDetailsTool(args, context) {
  return requestMeetingDetails({
    organizationId: context.organizationId,
    dealId: context.dealId,
    sessionId: context.sessionId,
    meetingType: args.meeting_type,
  });
}

registerTool('request_meeting_details', requestMeetingDetailsTool, {
  description: 'Open a secure on-screen meeting form for the customer. Use this instead of asking them to say their email address or exact time aloud.',
  parameters: {
    type: 'object',
    properties: { meeting_type: { type: 'string', enum: ['enterprise_demo', 'technical_review', 'executive_briefing'] } },
    required: ['meeting_type'],
  },
});

module.exports = requestMeetingDetailsTool;
