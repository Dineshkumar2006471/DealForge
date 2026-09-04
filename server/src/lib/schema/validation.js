const { z } = require('zod');

const STAGES = ['QUALIFY', 'NEGOTIATE', 'BOOK', 'CLOSED_WON', 'CLOSED_LOST'];
const STATUSES = ['ACTIVE', 'QUALIFIED', 'PENDING_APPROVAL', 'CLOSED_WON', 'CLOSED_LOST'];
const SOURCES = ['customer_statement', 'inferred', 'tool_result'];
const MEDDIC = ['metrics', 'economicBuyer', 'decisionCriteria', 'decisionProcess', 'identifyPain', 'champion'];
const FIELD_NAMES = ['company', 'teamSize', 'timeline', 'budget', 'competitor', 'pain', 'sentiment'];

const callLinkSchema = z.object({ dealId: z.string().min(1).max(128), expiresInMinutes: z.number().int().min(5).max(60).default(60) }).strict();
const sessionCredentialSchema = z.object({ sessionCredential: z.string().min(32).max(256) }).strict();
const approvalResolutionSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).strict();
const callStopSchema = z.object({}).strict();
const chatSchema = z.object({ stream: z.literal(true), messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.string().max(12000).nullable().optional(), name: z.string().max(128).optional(), tool_call_id: z.string().max(256).optional(), tool_calls: z.array(z.any()).optional() }).passthrough()).max(20) }).passthrough();
const toolSchemas = {
  calculate_discount: z.object({ requested_pct: z.number().min(0).max(25) }).strict(),
  update_deal_state: z.object({ field: z.enum(FIELD_NAMES).optional(), value: z.string().min(1).max(1000).optional(), confidence: z.number().min(0).max(1).optional(), source: z.enum(SOURCES).optional(), meddic_pillar: z.enum(MEDDIC).optional(), meddic_status: z.enum(['confirmed', 'unknown', 'not_asked']).optional(), new_stage: z.enum(STAGES).optional() }).strict().refine(v => Boolean(v.new_stage || v.meddic_pillar || (v.field && v.value !== undefined)), 'field/value, meddic_pillar, or new_stage is required'),
  check_product_availability: z.object({ plan: z.enum(['starter', 'pro', 'enterprise']).optional(), seats: z.number().int().min(1).max(100000).optional() }).strict(),
  book_meeting: z.object({ meeting_type: z.enum(['enterprise_demo', 'technical_review', 'executive_briefing']), preferred_date: z.string().datetime({ offset: true }), attendees: z.array(z.string().email()).min(1).max(20) }).strict(),
  escalate_to_human: z.object({ reason: z.string().min(1).max(1000), urgency: z.enum(['low', 'medium', 'high']) }).strict(),
};

function parse(schema, value) { return schema.parse(value); }
function parseTool(tool, args) { if (!toolSchemas[tool]) throw new Error(`Unknown tool: ${tool}`); return toolSchemas[tool].parse(args); }
module.exports = { STAGES, STATUSES, callLinkSchema, approvalResolutionSchema, callStopSchema, sessionCredentialSchema, chatSchema, parse, parseTool };
