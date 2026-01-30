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
 * AI Review Consumer
 * M11 - Queue Platform: "AI Jobs Processing"
 *
 * Processes:
 * - Article reviews (content quality, grammar, style)
 * - AI scoring (readability, engagement prediction)
 * - SEO analysis updates
 */

@Injectable()
export class AiReviewConsumer extends BaseConsumer {
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
      JobType.AI_REVIEW,
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
   * Process AI Review Job
   */
  protected async process(job: Job<any>): Promise<any> {
    const { aiJobId, actorId, tenantId, workspaceId, entity, meta, traceId } = job.data;
    const { articleId, reviewType, criteria } = meta;

    this.logger.log(`Processing AI Review job: ${aiJobId} (article: ${articleId}, type: ${reviewType})`);

    // 1. Validate inputs
    if (!articleId || !reviewType) {
      throw new Error('Missing required fields: articleId, reviewType');
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

    // 4. Execute review based on type
    let reviewResult: any;

    switch (reviewType) {
      case 'content_quality':
        reviewResult = await this.reviewContentQuality(article, criteria);
        break;
      case 'grammar_style':
        reviewResult = await this.reviewGrammarStyle(article, criteria);
        break;
      case 'readability':
        reviewResult = await this.reviewReadability(article, criteria);
        break;
      case 'engagement_prediction':
        reviewResult = await this.predictEngagement(article, criteria);
        break;
      default:
        throw new Error(`Unknown review type: ${reviewType}`);
    }

    // 5. Update article with review results
    const updatedArticle = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        aiReviewScore: reviewResult.score,
        aiReviewDetails: reviewResult.details,
        aiReviewedAt: new Date(),
      },
    });

    // 6. Record AI usage
    await this.recordAiUsage({
      aiJobId,
      tenantId,
      workspaceId,
      actorId,
      model: reviewResult.model,
      promptTokens: reviewResult.usage?.prompt_tokens,
      completionTokens: reviewResult.usage?.completion_tokens,
      totalTokens: reviewResult.usage?.total_tokens,
      cost: this.calculateCost(reviewResult.usage, reviewResult.model),
    });

    // 7. Publish AI review completed event
    await this.queueEvents.jobCompleted({
      queueName: job.queueQualifiedName,
      jobType: JobType.AI_REVIEW,
      aiJobId,
      bullJobId: job.id,
      traceId,
      entity: { type: 'Article', id: articleId },
      metadata: { reviewType, score: reviewResult.score },
    });

    this.logger.log(`AI Review job completed: ${aiJobId} (article: ${articleId})`);

    return {
      success: true,
      article: updatedArticle,
      reviewResult,
    };
  }

  /**
   * Review Content Quality
   */
  private async reviewContentQuality(article: any, criteria: any): Promise<any> {
    const result = await this.callAiService({
      type: 'content_quality_review',
      article,
      criteria: {
        grammar: criteria?.grammar || true,
        spelling: criteria?.spelling || true,
        style: criteria?.style || true,
        tone: criteria?.tone || 'professional',
      },
    });

    return {
      model: result.model,
      score: result.score || 0.8,
      details: {
        grammarScore: result.grammarScore || 0.9,
        spellingScore: result.spellingScore || 0.95,
        styleScore: result.styleScore || 0.85,
        issues: result.issues || [],
      },
      usage: result.usage,
    };
  }

  /**
   * Review Grammar & Style
   */
  private async reviewGrammarStyle(article: any, criteria: any): Promise<any> {
    const result = await this.callAiService({
      type: 'grammar_style_review',
      article,
      criteria: {
        checkGrammar: criteria?.checkGrammar || true,
        checkStyle: criteria?.checkStyle || true,
        style: criteria?.style || 'apa',
      },
    });

    return {
      model: result.model,
      score: result.score || 0.85,
      details: {
        grammarErrors: result.grammarErrors || [],
        styleSuggestions: result.styleSuggestions || [],
      },
      usage: result.usage,
    };
  }

  /**
   * Review Readability
   */
  private async reviewReadability(article: any, criteria: any): Promise<any> {
    const result = await this.callAiService({
      type: 'readability_analysis',
      article,
      criteria: {
        targetAudience: criteria?.targetAudience || 'general',
        complexityLevel: criteria?.complexityLevel || 'medium',
      },
    });

    return {
      model: result.model,
      score: result.score || 0.7,
      details: {
        fleschKincaidGrade: result.fleschKincaidGrade,
        fleschReadingEase: result.fleschReadingEase,
        wordsPerSentence: result.wordsPerSentence,
        sentencesPerParagraph: result.sentencesPerParagraph,
      },
      usage: result.usage,
    };
  }

  /**
   * Predict Engagement
   */
  private async predictEngagement(article: any, criteria: any): Promise<any> {
    const result = await this.callAiService({
      type: 'engagement_prediction',
      article,
      criteria: {
        platform: criteria?.platform || 'web',
        contentType: criteria?.contentType || 'article',
      },
    });

    return {
      model: result.model,
      score: result.score || 0.75,
      details: {
        predictedEngagement: result.predictedEngagement || 'medium',
        confidence: result.confidence || 0.85,
        factors: result.factors || [],
      },
      usage: result.usage,
    };
  }

  /**
   * Call AI Service (simulated)
   */
  private async callAiService(params: any): Promise<any> {
    // In production, this would call actual AI service
    // For MVP, we'll simulate a response
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay

    return {
      model: 'gpt-4',
      score: 0.85,
      usage: {
        prompt_tokens: Math.ceil(JSON.stringify(params).length / 4),
        completion_tokens: Math.ceil(500 / 4),
        total_tokens: Math.ceil(JSON.stringify(params).length / 4) + Math.ceil(500 / 4),
      },
      details: {
        message: 'AI review completed successfully',
      },
    };
  }

  /**
   * Check AI usage limits
   */
  private async checkAiUsageLimits(tenantId: number, workspaceId: number): Promise<void> {
    // Same logic as AI Content Consumer
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, limits: true },
    });

    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    const limits = (tenant.limits as any) || {};
    const monthlyLimit = limits.aiRequests || 10000;

    const currentMonth = new Date().toISOString().substring(0, 7);
    const usageKey = `teknav:ai:usage:${tenantId}:${workspaceId}:${currentMonth}`;
    const currentUsage = await this.prisma.redis?.get(usageKey) || '0';
    const usage = parseInt(currentUsage as string);

    if (usage >= monthlyLimit) {
      throw new Error(`AI usage limit exceeded: ${usage}/${monthlyLimit}`);
    }

    await this.prisma.redis?.incr(usageKey);
    await this.prisma.redis?.expire(usageKey, 30 * 24 * 60 * 60);
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
      data: { cost: params.cost },
    });

    await this.auditLog.logAction({
      actorUserId: params.actorId,
      action: 'ai.usage.recorded',
      resource: 'AiUsage',
      payload: params,
    });
  }

  /**
   * Calculate cost
   */
  private calculateCost(usage: any, model: string): number {
    const per1k = 0.002;
    const tokens = usage.total_tokens || 0;
    return (tokens / 1000) * per1k;
  }

  /**
   * Get circuit breaker config override
   */
  protected getCircuitBreakerConfig(dep: Dependency) {
    if (dep === Dependency.OPENROUTER_API) {
      return {
        failureThreshold: 10,
        resetTimeout: 120000,
        halfOpenMaxCalls: 5,
      };
    }
    return {};
  }
}
