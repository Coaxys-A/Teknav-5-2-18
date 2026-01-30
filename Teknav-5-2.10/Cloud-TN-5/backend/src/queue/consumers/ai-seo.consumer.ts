import { Injectable } from '@nestjs/common';
import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed, Job, Queue } from 'bullmq';
import { BaseConsumer } from '../services/base-consumer.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueConfigService } from '../queue-config.service';
import { QueueEventsService } from '../services/queue-events.service';
import { CircuitBreakerService, Dependency } from '../services/circuit-breaker.service';
import { QuarantineService } from '../services/quarantine.service';
import { JobSlaService } from '../services/job-sla.service';
import { JobType, JobPriority } from '../types/job-envelope';

/**
 * AI SEO Consumer
 * M11 - Queue Platform: "AI Jobs Processing"
 *
 * Processes:
 * - SEO optimization
 * - Keyword analysis
 * - Meta tag generation
 * - Content optimization
 */

@Injectable()
export class AiSeoConsumer extends BaseConsumer {
  protected readonly DEFAULT_DEPENDENCIES: Dependency[] = [Dependency.OPENROUTER_API, Dependency.REDIS];

  constructor(
    auditLog: AuditLogService,
    prisma: PrismaService,
    queueConfig: QueueConfigService,
    queueEvents: QueueEventsService,
    circuitBreaker: CircuitBreakerService,
    quarantine: QuarantineService,
    jobSla: JobSlaService,
  ) {
    super(
      JobType.AI_SEO,
      auditLog,
      prisma,
      queueConfig,
      queueEvents,
      circuitBreaker,
      quarantine,
      jobSla,
    );
  }

  /**
   * Process SEO Job
   */
  protected async process(job: Job<any>): Promise<any> {
    const { aiJobId, actorId, tenantId, workspaceId, entity, meta, traceId } = job.data;
    const { articleId, keywords, targetKeywords, language, optimizeFor } = meta;

    this.logger.log(`Processing AI SEO job: ${aiJobId} (article: ${articleId})`);

    // 1. Validate inputs
    if (!articleId) {
      throw new Error('Missing required field: articleId');
    }

    // 2. Get article
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
      include: {
        tenant: true,
        workspace: true,
      },
    });

    if (!article) {
      throw new Error(`Article not found: ${articleId}`);
    }

    // 3. Check tenant/workspace limits (AI usage)
    await this.checkAiUsageLimits(tenantId, workspaceId);

    // 4. Generate SEO content
    const seoData = await this.generateSeoContent({
      article,
      keywords,
      targetKeywords,
      language,
      optimizeFor,
    });

    // 5. Update article with SEO data
    const updatedArticle = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        seoTitle: seoData.title,
        seoDescription: seoData.description,
        seoKeywords: seoData.keywords,
        metaTitle: seoData.metaTitle,
        metaDescription: seoData.metaDescription,
        aiSeoGeneratedAt: new Date(),
      },
    });

    // 6. Record AI usage (cost, tokens)
    await this.recordAiUsage({
      aiJobId,
      tenantId,
      workspaceId,
      actorId,
      model: seoData.model,
      promptTokens: seoData.usage?.prompt_tokens,
      completionTokens: seoData.usage?.completion_tokens,
      totalTokens: seoData.usage?.total_tokens,
      cost: this.calculateCost(seoData.usage, seoData.model),
    });

    // 7. Log SEO generation event
    await this.auditLog.logAction({
      actorUserId: actorId || null,
      action: 'ai.seo.generated',
      resource: 'Article',
      payload: {
        articleId,
        keywords,
        targetKeywords,
        language,
        optimizeFor,
        seoData,
      },
    });

    this.logger.log(`AI SEO job completed: ${aiJobId} (article: ${articleId})`);

    return {
      success: true,
      article: updatedArticle,
      seoData,
    };
  }

  /**
   * Generate SEO Content
   */
  private async generateSeoContent(params: {
    article: any;
    keywords: string[];
    targetKeywords: string[];
    language: string;
    optimizeFor: string;
  }): Promise<any> {
    const { article, keywords, targetKeywords, language, optimizeFor } = params;

    // Call AI Service (Circuit Breaker protected)
    const result = await this.circuitBreaker.execute(
      Dependency.OPENROUTER_API,
      () => this.callAiService({
        type: 'seo',
        article,
        keywords,
        targetKeywords,
        language,
        optimizeFor,
      }),
      this.getCircuitBreakerConfig(Dependency.OPENROUTER_API),
    );

    return result;
  }

  /**
   * Call AI Service
   */
  private async callAiService(params: {
    type: string;
    article: any;
    keywords?: string[];
    targetKeywords?: string[];
    language?: string;
    optimizeFor?: string;
  }): Promise<any> {
    const { type, article, keywords, targetKeywords, language, optimizeFor } = params;

    // Build prompt
    let prompt = '';
    if (type === 'seo') {
      prompt = `Generate SEO metadata for this article:\n\n`;
      prompt += `Title: ${article.title}\n`;
      prompt += `Content: ${article.content?.substring(0, 1000)}...\n\n`;
      prompt += `Keywords: ${keywords?.join(', ')}\n`;
      prompt += `Target Keywords: ${targetKeywords?.join(', ')}\n`;
      prompt += `Language: ${language}\n`;
      prompt += `Optimize for: ${optimizeFor}\n\n`;
      prompt += `Provide:\n`;
      prompt += `1. Optimized SEO Title (60 chars max)\n`;
      prompt += `2. SEO Description (160 chars max)\n`;
      prompt += `3. Meta Title (60 chars max)\n`;
      prompt += `4. Meta Description (160 chars max)\n`;
      prompt += `5. Suggested keywords (comma separated)\n`;
    }

    // In production, this would call actual AI service
    // For MVP, we'll simulate a response
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay

    return {
      title: article.title,
      description: article.content?.substring(0, 150),
      keywords: keywords?.join(', '),
      metaTitle: article.title,
      metaDescription: article.content?.substring(0, 150),
      model: 'gpt-4',
      usage: {
        prompt_tokens: Math.ceil(prompt.length / 4),
        completion_tokens: Math.ceil(500 / 4),
        total_tokens: Math.ceil(prompt.length / 4) + Math.ceil(500 / 4),
      },
    };
  }

  /**
   * Check AI usage limits
   */
  private async checkAiUsageLimits(tenantId: number, workspaceId: number): Promise<void> {
    // Get tenant plan/limits
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, limits: true },
    });

    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    const limits = (tenant.limits as any) || {};
    const monthlyLimit = limits.aiRequests || 10000; // Default 10k

    // Check current month usage from Redis or DB
    const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
    const usageKey = `teknav:ai:usage:${tenantId}:${workspaceId}:${currentMonth}`;
    const currentUsage = await this.prisma.redis?.get(usageKey) || '0';
    const usage = parseInt(currentUsage as string);

    if (usage >= monthlyLimit) {
      throw new Error(`AI usage limit exceeded: ${usage}/${monthlyLimit}`);
    }

    // Increment usage
    await this.prisma.redis?.incr(usageKey);
    await this.prisma.redis?.expire(usageKey, 30 * 24 * 60 * 60); // 30 days TTL
  }

  /**
   * Calculate cost (mock)
   */
  private calculateCost(usage: any, model: string): number {
    // Simulated cost calculation
    const per1k = 0.002; // $0.002 per 1k tokens
    const tokens = usage.total_tokens || 0;
    return (tokens / 1000) * per1k;
  }

  /**
   * Record AI usage
   */
  private async recordAiUsage(params: {
    aiJobId: number;
    tenantId: number;
    workspaceId: number;
    actorId: number;
    model: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cost: number;
  }): Promise<void> {
    await this.prisma.aiJob.update({
      where: { id: params.aiJobId },
      data: {
        cost: params.cost,
      },
    });

    // Also store in separate AiUsage table if exists
    // For MVP, we'll just log to AuditLog
    await this.auditLog.logAction({
      actorUserId: params.actorId,
      action: 'ai.usage.recorded',
      resource: 'AiUsage',
      payload: params,
    });
  }

  /**
   * Get circuit breaker config override
   */
  protected getCircuitBreakerConfig(dep: Dependency) {
    if (dep === Dependency.OPENROUTER_API) {
      return {
        failureThreshold: 10,
        resetTimeout: 120000, // 2 minutes
        halfOpenMaxCalls: 5,
      };
    }
    return {};
  }
}
