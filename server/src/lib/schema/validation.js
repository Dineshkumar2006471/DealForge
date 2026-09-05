const { z } = require('zod');

const STAGES = ['QUALIFY', 'NEGOTIATE', 'BOOK', 'CLOSED_WON', 'CLOSED_LOST'];
const STATUSES = ['ACTIVE', 'QUALIFIED', 'PENDING_APPROVAL', 'CLOSED_WON', 'CLOSED_LOST'];
const SOURCES = ['customer_statement', 'inferred', 'tool_result'];
const MEDDIC = ['metrics', 'economicBuyer', 'decisionCriteria', 'decisionProcess', 'identifyPain', 'champion'];
const FIELD_NAMES = ['company', 'teamSize', 'timeline', 'budget', 'competitor', 'pain', 'sentiment'];

const callLinkSchema = z.object({ dealId: z.string().min(1).max(128), expiresInMinutes: z.number().int().min(5).max(60).default(60) }).strict();
const sessionCredentialSchema = z.object({ sessionCredential: z.string().min(32).max(256) }).strict();
const callActivitySchema = z.object({ sessionCredential: z.string().min(32).max(256), eventType: z.enum(['AGENT_AUDIO_PUBLISHED', 'CUSTOMER_AUDIO_PLAYBACK_STARTED', 'AGENT_AUDIO_TIMEOUT', 'CUSTOMER_AUDIO_PLAYBACK_FAILED']) }).strict();
const approvalResolutionSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).strict();
const callStopSchema = z.object({}).strict();
const chatContentPartSchema = z.object({ type: z.string().min(1).max(64), text: z.string().max(12000).optional() }).passthrough();
const chatContentSchema = z.union([z.string().max(12000), z.array(chatContentPartSchema).max(50)]).nullable().optional();
const chatSchema = z.object({ stream: z.literal(true), messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: chatContentSchema, name: z.string().max(128).optional(), tool_call_id: z.string().max(256).optional(), tool_calls: z.array(z.any()).optional() }).passthrough()).max(20) }).passthrough();
const toolSchemas = {
  calculate_discount: z.object({ requested_pct: z.number().min(0).max(25) }).strict(),
  update_deal_state: z.object({ field: z.enum(FIELD_NAMES).optional(), value: z.string().min(1).max(1000).optional(), confidence: z.number().min(0).max(1).optional(), source: z.enum(SOURCES).optional(), meddic_pillar: z.enum(MEDDIC).optional(), meddic_status: z.enum(['confirmed', 'unknown', 'not_asked']).optional(), new_stage: z.enum(STAGES).optional() }).strict().refine(v => Boolean(v.new_stage || v.meddic_pillar || (v.field && v.value !== undefined)), 'field/value, meddic_pillar, or new_stage is required'),
  check_product_availability: z.object({ plan: z.enum(['starter', 'pro', 'enterprise']).optional(), seats: z.number().int().min(1).max(100000).optional() }).strict(),
  book_meeting: z.object({
    meeting_type: z.enum(['enterprise_demo', 'technical_review', 'executive_briefing']),
    preferred_date: z.string().datetime({ offset: true }),
    attendee: z.object({ name: z.string().min(1).max(120), email: z.string().email(), timeZone: z.string().min(1).max(80) }).strict(),
  }).strict(),
  sync_to_hubspot: z.object({
    fields: z.object({
      dealname: z.union([z.string().min(1).max(5000), z.number().finite()]).optional(),
      amount: z.union([z.string().min(1).max(5000), z.number().finite()]).optional(),
      dealstage: z.union([z.string().min(1).max(5000), z.number().finite()]).optional(),
      closedate: z.union([z.string().min(1).max(5000), z.number().finite()]).optional(),
      description: z.union([z.string().min(1).max(5000), z.number().finite()]).optional(),
    }).strict().refine(fields => Object.keys(fields).length > 0, 'At least one allowlisted HubSpot field is required'),
  }).strict(),
  escalate_to_human: z.object({ reason: z.string().min(1).max(1000), urgency: z.enum(['low', 'medium', 'high']) }).strict(),
};

function parse(schema, value) { return schema.parse(value); }
function parseTool(tool, args) { if (!toolSchemas[tool]) throw new Error(`Unknown tool: ${tool}`); return toolSchemas[tool].parse(args); }
module.exports = { STAGES, STATUSES, callLinkSchema, approvalResolutionSchema, callStopSchema, sessionCredentialSchema, callActivitySchema, chatSchema, parse, parseTool };
