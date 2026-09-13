import { z, ZodSchema } from 'zod';
import type { DealStage, DealStatus, MEDDICPillar } from '../../types/domain';

export const STAGES: DealStage[] = ['QUALIFY', 'NEGOTIATE', 'BOOK', 'CLOSED_WON', 'CLOSED_LOST'];
export const STATUSES: DealStatus[] = ['ACTIVE', 'QUALIFIED', 'PENDING_APPROVAL', 'CLOSED_WON', 'CLOSED_LOST'];
export const SOURCES = ['customer_statement', 'inferred', 'tool_result'] as const;
export const MEDDIC: MEDDICPillar[] = [
  'metrics',
  'economicBuyer',
  'decisionCriteria',
  'decisionProcess',
  'identifyPain',
  'champion',
];
export const FIELD_NAMES = ['company', 'teamSize', 'timeline', 'budget', 'competitor', 'pain', 'sentiment'] as const;

export const callLinkSchema = z
  .object({
    dealId: z.string().min(1).max(128),
    customerLabel: z.string().trim().min(2).max(120),
    expiresInMinutes: z.number().int().min(5).max(60).default(60),
  })
  .strict();

export const createDealSchema = z
  .object({
    company: z.string().trim().min(2).max(160),
    targetArr: z.number().finite().min(0).max(100000000).default(0),
  })
  .strict();

export const sessionCredentialSchema = z.object({ sessionCredential: z.string().min(32).max(256) }).strict();

export const callActivitySchema = z
  .object({
    sessionCredential: z.string().min(32).max(256),
    eventType: z.enum([
      'AGENT_AUDIO_PUBLISHED',
      'CUSTOMER_AUDIO_PLAYBACK_STARTED',
      'AGENT_AUDIO_TIMEOUT',
      'CUSTOMER_AUDIO_PLAYBACK_FAILED',
    ]),
  })
  .strict();

export const meetingTypeSchema = z.enum(['enterprise_demo', 'technical_review', 'executive_briefing']);

export const attendeeSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
    timeZone: z.string().trim().min(1).max(80),
  })
  .strict();

export const meetingDetailsSchema = z
  .object({
    sessionCredential: z.string().min(32).max(256),
    attendee: attendeeSchema,
    preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Preferred date must be YYYY-MM-DD'),
  })
  .strict();

export const meetingBookingSchema = z
  .object({ sessionCredential: z.string().min(32).max(256), slotStart: z.string().datetime({ offset: true }) })
  .strict();

export const hubspotLinkSchema = z
  .object({ hubspotDealId: z.string().trim().regex(/^\d+$/, 'HubSpot deal ID must be numeric').max(32) })
  .strict();

export const bookingSyncSchema = z.object({ enabled: z.boolean() }).strict();

export const approvalResolutionSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).strict();

export const callStopSchema = z.object({}).strict();

export const chatContentPartSchema = z
  .object({ type: z.string().min(1).max(64), text: z.string().max(12000).optional() })
  .passthrough();

export const chatContentSchema = z
  .union([z.string().max(12000), z.array(chatContentPartSchema).max(50)])
  .nullable()
  .optional();

export const chatSchema = z
  .object({
    stream: z.literal(true),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['system', 'user', 'assistant', 'tool']),
            content: chatContentSchema,
            name: z.string().max(128).optional(),
            tool_call_id: z.string().max(256).optional(),
            tool_calls: z.array(z.any()).optional(),
          })
          .passthrough(),
      )
      .max(20),
  })
  .passthrough();

export const toolSchemas: Record<string, z.ZodTypeAny> = {
  calculate_discount: z.object({ requested_pct: z.number().min(0).max(100) }).strict(),
  update_deal_state: z
    .object({
      field: z.enum(FIELD_NAMES).optional(),
      value: z.string().min(1).max(1000).optional(),
      confidence: z.number().min(0).max(1).optional(),
      source: z.enum(SOURCES).optional(),
      meddic_pillar: z.enum(MEDDIC as [MEDDICPillar, ...MEDDICPillar[]]).optional(),
      meddic_status: z.enum(['confirmed', 'unknown', 'not_asked']).optional(),
      new_stage: z.enum(STAGES as [DealStage, ...DealStage[]]).optional(),
    })
    .strict()
    .refine(
      (v) => Boolean(v.new_stage || v.meddic_pillar || (v.field && v.value !== undefined)),
      'field/value, meddic_pillar, or new_stage is required',
    ),
  check_product_availability: z
    .object({
      plan: z.enum(['starter', 'pro', 'enterprise']).optional(),
      seats: z.number().int().min(1).max(100000).optional(),
    })
    .strict(),
  book_meeting: z
    .object({
      meeting_type: meetingTypeSchema,
      preferred_date: z.string().datetime({ offset: true }),
      attendee: attendeeSchema,
    })
    .strict(),
  request_meeting_details: z.object({ meeting_type: meetingTypeSchema }).strict(),
  sync_to_hubspot: z
    .object({
      fields: z
        .object({
          dealname: z.union([z.string().min(1).max(5000), z.number().finite()]).optional(),
          amount: z.union([z.string().min(1).max(5000), z.number().finite()]).optional(),
          dealstage: z.union([z.string().min(1).max(5000), z.number().finite()]).optional(),
          closedate: z.union([z.string().min(1).max(5000), z.number().finite()]).optional(),
          description: z.union([z.string().min(1).max(5000), z.number().finite()]).optional(),
        })
        .strict()
        .refine((fields) => Object.keys(fields).length > 0, 'At least one allowlisted HubSpot field is required'),
    })
    .strict(),
  escalate_to_human: z
    .object({ reason: z.string().min(1).max(1000), urgency: z.enum(['low', 'medium', 'high']) })
    .strict(),
};

export function parse<T>(schema: ZodSchema<T>, value: unknown): T {
  return schema.parse(value);
}

export function parseTool(tool: string, args: unknown): any {
  if (!toolSchemas[tool]) throw new Error(`Unknown tool: ${tool}`);
  return toolSchemas[tool].parse(args);
}
