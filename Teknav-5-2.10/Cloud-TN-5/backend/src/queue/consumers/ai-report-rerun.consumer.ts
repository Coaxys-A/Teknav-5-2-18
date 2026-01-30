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
 * AI Report Rerun Consumer
 * M11 - Queue Platform: "AI Jobs Processing"
 */

@Injectable()
export class AiReportRerunConsumer extends BaseConsumer {
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
      JobType.AI_REPORT_RERUN,
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
    const { reportId, forceRerun } = meta;

    this.logger.log(`Processing AI Report Rerun job: ${aiJobId} (report: ${reportId})`);

    if (!reportId) {
      throw new Error('Missing required field: reportId');
    }

    const report = await this.prisma.aiReport.findUnique({
      where: { id: reportId },
      include: {
        article: true,
        createdBy: true,
      },
    });

    if (!report) {
      throw new Error(`AI Report not found: ${reportId}`);
    }

    const reportData = JSON.parse(report.data);

    const rerunData = await this.callAiService({
      type: 'report_rerun',
      reportId: report.id,
      reportData,
      forceRerun,
    });

    await this.prisma.aiReport.update({
      where: { id: reportId },
      data: {
        data: JSON.stringify(rerunData),
        rerunAt: new Date(),
      },
    });

    await this.queueEvents.jobCompleted({
      queueName: job.queueQualifiedName,
      jobType: JobType.AI_REPORT_RERUN,
      aiJobId,
      bullJobId: job.id,
      traceId,
      entity: { type: 'AIReport', id: reportId },
      metadata: { reportId, forceRerun },
    });

    return {
      success: true,
      report,
      rerunData,
    };
  }

  private async callAiService(params: any): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return {
      model: 'gpt-4',
      data: {
        message: 'Report rerun simulated',
        result: params.reportData,
      },
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
      },
    };
  }
}
