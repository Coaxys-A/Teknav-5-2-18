import { z } from 'zod';

/**
 * Queue Job Schemas
 * 
 * Strict Zod contracts for all job payloads.
 * Used by Producers to validate before enqueue.
 */

// AI Content Job
export const AiContentJobSchema = z.object({
  articleId: z.number(),
  workspaceId: z.number(),
  model: z.string(),
  promptTemplateId: z.number(),
  priority: z.number().default(0),
});

export type AiContentJob = z.infer<typeof AiContentJobSchema>;

// AI SEO Job
export const AiSeoJobSchema = z.object({
  articleId: z.number(),
  workspaceId: z.number(),
  keyword: z.string(),
});

export type AiSeoJob = z.infer<typeof AiSeoJobSchema>;

// AI Translation Job
export const AiTranslationJobSchema = z.object({
  articleId: z.number(),
  workspaceId: z.number(),
  targetLang: z.string(),
  sourceLang: z.string().default('en'),
});

export type AiTranslationJob = z.infer<typeof AiTranslationJobSchema>;

// Workflow Execution Job
export const WorkflowJobSchema = z.object({
  workflowInstanceId: z.number(),
  workspaceId: z.number(),
  stepIndex: z.number(),
});

export type WorkflowJob = z.infer<typeof WorkflowJobSchema>;

// Plugin Execution Job
export const PluginJobSchema = z.object({
  pluginId: z.number(),
  workspaceId: z.number(),
  eventType: z.string(),
  payload: z.record(z.any()).optional(),
});

export type PluginJob = z.infer<typeof PluginJobSchema>;

// Analytics Processing Job
export const AnalyticsJobSchema = z.object({
  eventBatchId: z.string(),
  events: z.array(z.object({
    type: z.string(),
    userId: z.number().optional(),
    workspaceId: z.number(),
    entityId: z.number().optional(),
    entityType: z.string().optional(),
    timestamp: z.date(),
    payload: z.record(z.any()),
  })),
});

export type AnalyticsJob = z.infer<typeof AnalyticsJobSchema>;

// Email Notification Job
export const EmailJobSchema = z.object({
  templateKey: z.string(),
  to: z.string().email(),
  context: z.record(z.any()),
});

export type EmailJob = z.infer<typeof EmailJobSchema>;

// Billing Events Job
export const BillingJobSchema = z.object({
  orderId: z.number(),
  workspaceId: z.number(),
  eventType: z.enum(['order.paid', 'subscription.renewed', 'subscription.cancelled', 'refund.created']),
  metadata: z.record(z.any()).optional(),
});

export type BillingJob = z.infer<typeof BillingJobSchema>;

// Media Processing Job
export const MediaJobSchema = z.object({
  fileId: z.number(),
  workspaceId: z.number(),
  operation: z.enum(['resize', 'compress', 'optimize', 'thumbnail']),
  options: z.record(z.any()).optional(),
});

export type MediaJob = z.infer<typeof MediaJobSchema>;
