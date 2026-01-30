import { z } from 'zod';

/**
 * Queue Job Types
 * M11 - Queue Platform: "Full Consumers + DLQ + Replay UI"
 */

export enum JobType {
  // AI Jobs
  AI_CONTENT = 'ai.content',
  AI_SEO = 'ai.seo',
  AI_REVIEW = 'ai.review',
  AI_SCORE = 'ai.score',
  AI_REPORT_RERUN = 'ai.report.rerun',
  AI_EDITOR_TOOL = 'ai.editor.tool',

  // Workflow Jobs
  WORKFLOW_RUN = 'workflow.run',
  WORKFLOW_STEP_EXECUTE = 'workflow.step.execute',
  WORKFLOW_SCHEDULE = 'workflow.schedule',

  // Plugin Jobs
  PLUGIN_EXECUTE = 'plugin.execute',
  PLUGIN_HOOK_ARTICLE_PUBLISH = 'plugin.hook.article_publish',
  PLUGIN_HOOK_USER_SIGNUP = 'plugin.hook.user_signup',
  PLUGIN_HOOK_AI_RESULT = 'plugin.hook.ai_result',
  PLUGIN_HOOK_SCHEDULE = 'plugin.hook.schedule',
  PLUGIN_HOOK_WEBHOOK = 'plugin.hook.webhook',

  // Analytics Jobs
  ANALYTICS_AGGREGATE = 'analytics.aggregate',
  ANALYTICS_SNAPSHOT = 'analytics.snapshot',
  ANALYTICS_FUNNEL = 'analytics.funnel',
  ANALYTICS_RETENTION_COHORT = 'analytics.retention_cohort',

  // Email Jobs
  EMAIL_SEND = 'email.send',
  EMAIL_QUEUE_PROCESS = 'email.queue.process',

  // Notification Jobs
  NOTIFICATION_DISPATCH = 'notification.dispatch',

  // OTP Jobs
  OTP_SEND = 'otp.send',
  OTP_RETRY = 'otp.retry',
}

export enum JobPriority {
  CRITICAL = 1,
  HIGH = 3,
  NORMAL = 5,
  LOW = 7,
  BACKGROUND = 10,
}

export enum JobStatus {
  WAITING = 'waiting',
  ACTIVE = 'active',
  DELAYED = 'delayed',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  MOVED_TO_DLQ = 'moved_to_dlq',
}

/**
 * Standard Job Envelope (Zod validated)
 */
export const JobEntitySchema = z.object({
  type: z.enum(['ARTICLE', 'WORKFLOW', 'USER', 'TENANT', 'WORKSPACE', 'PLUGIN', 'ANALYTICS', 'AI_JOB', 'NOTIFICATION', 'EMAIL']),
  id: z.union([z.number(), z.string()]),
});

export const JobEnvelopeSchema = z.object({
  jobType: z.nativeEnum(JobType),

  tenantId: z.number().optional(),
  workspaceId: z.number().optional(),

  actorId: z.number().optional(),

  entity: JobEntitySchema,

  idempotencyKey: z.string().min(1).max(255),

  priority: z.nativeEnum(JobPriority).default(JobPriority.NORMAL),

  traceId: z.string().uuid().optional(),

  createdAt: z.string().datetime().optional(),

  meta: z.record(z.string(), z.any()).optional(),
});

export const JobEnvelopeCreateSchema = JobEnvelopeSchema.partial({
  createdAt: true, // Auto-generated if not provided
});

export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;
export type JobEnvelopeCreate = z.infer<typeof JobEnvelopeCreateSchema>;
export type JobEntity = z.infer<typeof JobEntitySchema>;

/**
 * Job Processing Result
 */
export const JobResultSchema = z.object({
  success: z.boolean(),
  output: z.any().optional(),
  error: z.object({
    name: z.string(),
    message: z.string(),
    code: z.string().optional(),
    stack: z.string().optional(),
  }).optional(),
  nextJobType: z.nativeEnum(JobType).optional(),
  nextJobPayload: z.any().optional(),
});

export type JobResult = z.infer<typeof JobResultSchema>;

/**
 * DLQ Job Envelope (extended with original job data)
 */
export const DlqJobEnvelopeSchema = JobEnvelopeSchema.extend({
  originalJobId: z.string(),
  originalQueue: z.string(),
  attemptsMade: z.number(),
  failedAt: z.string().datetime(),
  error: z.object({
    name: z.string(),
    message: z.string(),
    code: z.string().optional(),
    stack: z.string().optional(),
  }),
});

export type DlqJobEnvelope = z.infer<typeof DlqJobEnvelopeSchema>;
