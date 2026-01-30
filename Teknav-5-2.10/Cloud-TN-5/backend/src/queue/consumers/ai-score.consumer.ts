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
 * AI Score Consumer
 * M11 - Queue Platform: "AI Jobs Processing"
 */

@Injectable()
export class AiScoreConsumer extends BaseConsumer {
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
      JobType.AI_SCORE,
      auditLog,
      prisma,
      queueConfig,
      queueEvents,
      circuitBreaker,
      quarantine,
      jobSla,
    );
  }

  protected async process(job: Job<any>): Promise<any> {
    const { aiJobId, actorId, tenantId, workspaceId, entity, meta, traceId } = job.data;
    const { articleId, scoreType } = meta;

    this.logger.log(`Processing AI Score job: ${aiJobId} (article: ${articleId}, type: ${scoreType})`);

    if (!articleId || !scoreType) {
      throw new Error('Missing required fields: articleId, scoreType');
    }

    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
      include: { tenant: true, workspace: true },
    });

    if (!article) {
      throw new Error(`Article not found: ${articleId}`);
    }

    await this.checkAiUsageLimits(tenantId, workspaceId);

    const scoreData = await this.calculateScore(article, scoreType);

    const updatedArticle = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        aiScore: scoreData.score,
        aiScoreDetails: scoreData.details,
        aiScoredAt: new Date(),
      },
    });

    await this.recordAiUsage({
      aiJobId,
      tenantId,
      workspaceId,
      actorId,
      model: scoreData.model,
      promptTokens: scoreData.usage?.prompt_tokens,
      completionTokens: scoreData.usage?.completion_tokens,
      totalTokens: scoreData.usage?.total_tokens,
      cost: this.calculateCost(scoreData.usage, scoreData.model),
    });

    await this.queueEvents.jobCompleted({
      queueName: job.queueQualifiedName,
      jobType: JobType.AI_SCORE,
      aiJobId,
      bullJobId: job.id,
      traceId,
      entity: { type: 'Article', id: articleId },
      metadata: { scoreType, score: scoreData.score },
    });

    return {
      success: true,
      article: updatedArticle,
      scoreData,
    };
  }

  private async calculateScore(article: any, scoreType: string): Promise<any> {
    const prompt = `Calculate ${scoreType} score for article "${article.title}":\n${article.content?.substring(0, 500)}...`;
    
    await new Promise(resolve => setTimeout(resolve, 1500));

    const mockScore = Math.random() * 100;

    return {
      model: 'gpt-4',
      score: mockScore,
      details: {
        scoreType,
        factors: {
          readability: Math.random() * 100,
          engagement: Math.random() * 100,
          seo: Math.random() * 100,
        },
      },
      usage: {
        prompt_tokens: Math.ceil(prompt.length / 4),
        completion_tokens: Math.ceil(200 / 4),
        total_tokens: Math.ceil(prompt.length / 4) + Math.ceil(200 / 4),
      },
    };
  }

  private async checkAiUsageLimits(tenantId: number, workspaceId: number): Promise<void> {
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

  private async recordAiUsage(params: any): Promise<void> {
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

  private calculateCost(usage: any, model: string): number {
    const per1k = 0.002;
    const tokens = usage.total_tokens || 0;
    return (tokens / 1000) * per1k;
  }

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
