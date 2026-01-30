import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { PoliciesGuard } from '../../auth/policies.guard';
import { RequirePolicy } from '../../security/policy/policy.decorator';
import { PolicyAction, PolicySubject } from '../../security/policy/policy.types';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueConfigService } from '../queue-config.service';
import { QueueEventsService } from '../services/queue-events.service';
import { JobSlaService } from '../services/job-sla.service';
import { QuarantineService } from '../services/quarantine.service';
import { CircuitBreakerService } from '../services/circuit-breaker.service';
import { JobType, JobPriority } from '../types/job-envelope';

/**
 * Owner Queue Observatory Controller (ADDITIONAL METHODS)
 * M11 - Queue Platform: "Job Detail + Bulk Actions"
 */

@Controller('api/owner/queues')
@UseGuards(PoliciesGuard)
export class OwnerQueueAdditionalController {
  constructor(
    private readonly queueConfig: QueueConfigService,
    private readonly queueEvents: QueueEventsService,
    private readonly jobSla: JobSlaService,
    private readonly quarantine: QuarantineService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly auditLog: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  // ==========================================================================
  // JOB DETAILS & EVENTS
  // ==========================================================================

  @Get(':queueName/jobs/:aiJobId')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getJobDetail(
    @Param('queueName') queueName: string,
    @Param('aiJobId') aiJobId: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Get job from AiJob table
    const job = await this.prisma.aiJob.findUnique({
      where: { id: parseInt(aiJobId) },
      include: {
        task: true,
      },
    });

    if (!job) {
      throw new Error(`Job not found: ${aiJobId}`);
    }

    return {
      data: {
        id: job.id,
        jobId: `${this.queueConfig.getQueuePrefix()}:${queueName}:${job.id}`,
        jobType: job.type,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        durationMs: job.finishedAt && job.startedAt
          ? job.finishedAt.getTime() - job.startedAt.getTime()
          : null,
        errorMessage: job.errorMessage,
        cost: job.cost,
        queue: queueName,
        entity: (job.task as any)?.entity,
        actorId: (job.task as any)?.actorId,
        tenantId: (job.task as any)?.tenantId,
        workspaceId: (job.task as any)?.workspaceId,
        payload: job.task,
      },
    };
  }

  @Get(':queueName/jobs/:aiJobId/events')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getJobDetailEvents(
    @Param('queueName') queueName: string,
    @Param('aiJobId') aiJobId: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr) : 100;

    // Get job events from AuditLog
    const events = await this.prisma.auditLog.findMany({
      where: {
        action: { in: ['queue.job.enqueued', 'queue.job.started', 'queue.job.completed', 'queue.job.failed', 'queue.job.retried', 'queue.job.moved_to_dlq', 'queue.job.cancelled', 'queue.job.replayed'] },
        resource: `AiJob:${aiJobId}`,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return {
      data: events.map(e => ({
        id: e.id,
        type: e.action.replace('queue.job.', '').toUpperCase(),
        timestamp: e.createdAt,
        message: e.action,
        actorId: e.actorUserId,
        metadata: e.payload,
      })),
    };
  }

  @Get(':queueName/jobs/:aiJobId/logs')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getJobDetailLogs(
    @Param('queueName') queueName: string,
    @Param('aiJobId') aiJobId: string,
  ) {
    // Get job from AiJob table
    const job = await this.prisma.aiJob.findUnique({
      where: { id: parseInt(aiJobId) },
    });

    if (!job) {
      throw new Error(`Job not found: ${aiJobId}`);
    }

    // Get error logs (if any)
    const logs = [];

    if (job.errorMessage) {
      logs.push({
        level: 'error',
        message: job.errorMessage,
        timestamp: job.finishedAt,
      });
    }

    return {
      data: logs,
      jobId: aiJobId,
    };
  }

  // ==========================================================================
  // BULK DLQ ACTIONS
  // ==========================================================================

  @Post(':queueName/dlq/bulk-replay')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async bulkReplayDlqJobs(
    @Param('queueName') queueName: string,
    @Body() body: { jobIds: string[] },
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    const { jobIds } = body;

    const results = [];

    for (const jobId of jobIds) {
      try {
        // Get job from DLQ
        const dlq = this.queueConfig.getDlq(queueName as JobType);
        const job = await dlq.getJob(jobId);

        if (!job) {
          results.push({ jobId, success: false, error: 'Job not found' });
          continue;
        }

        // Remove from DLQ
        await dlq.remove(jobId);

        // Replay job
        const replayedJobId = await this.queueConfig.getQueue(queueName as JobType).add(
          `${queueName}-bulk-replay`,
          job.data.payload,
          {
            jobId: `${queueName}-${Date.now()}-${Math.random()}`,
            attempts: 0,
          },
        );

        // Publish replay event
        await this.queueEvents.jobReplayed({
          queueName: `${this.queueConfig.getQueuePrefix()}:${queueName}`,
          jobType: job.data.jobType,
          aiJobId: job.data.aiJobId,
          oldBullJobId: job.data.originalJobId,
          newBullJobId: replayedJobId.id,
          traceId: job.data.payload.traceId,
          actorId,
          metadata: { bulk: true },
        });

        results.push({ jobId, success: true, newJobId: replayedJobId.id });
      } catch (error: any) {
        results.push({ jobId, success: false, error: error.message });
      }
    }

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.dlq.jobs.bulk_replayed',
      resource: `Dlq:${queueName}`,
      payload: { queueName, jobIds, results },
    });

    return {
      message: 'Bulk DLQ replay completed',
      results,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    };
  }

  @Post(':queueName/dlq/bulk-delete')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async bulkDeleteDlqJobs(
    @Param('queueName') queueName: string,
    @Body() body: { jobIds: string[] },
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    const { jobIds } = body;

    const results = [];

    for (const jobId of jobIds) {
      try {
        // Remove from DLQ
        const dlq = this.queueConfig.getDlq(queueName as JobType);
        await dlq.remove(jobId);

        results.push({ jobId, success: true });
      } catch (error: any) {
        results.push({ jobId, success: false, error: error.message });
      }
    }

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.dlq.jobs.bulk_deleted',
      resource: `Dlq:${queueName}`,
      payload: { queueName, jobIds, results },
    });

    return {
      message: 'Bulk DLQ delete completed',
      results,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    };
  }

  @Get(':queueName/dlq/stats')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getDlqStats(
    @Param('queueName') queueName: string,
  ) {
    // Get DLQ stats
    const dlq = this.queueConfig.getDlq(queueName as JobType);

    const jobs = await dlq.getJobs(0, 9999);
    const total = jobs.length;

    // Calculate oldest job age
    let oldestJobAge = null;
    if (jobs.length > 0) {
      const oldestJob = jobs[jobs.length - 1];
      const failedAt = new Date(oldestJob.data.failedAt);
      oldestJobAge = Date.now() - failedAt.getTime();
    }

    // Count by error type
    const byReason = {};
    jobs.forEach(job => {
      const reason = job.data.error?.name || 'unknown';
      byReason[reason] = (byReason[reason] || 0) + 1;
    });

    return {
      total,
      oldestJobAge,
      byReason,
    };
  }

  // ==========================================================================
  // BULK QUARANTINE ACTIONS
  // ==========================================================================

  @Post(':queueName/quarantine/bulk-delete')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async bulkDeleteQuarantineJobs(
    @Param('queueName') queueName: string,
    @Body() body: { jobIds: string[] },
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    const { jobIds } = body;

    const results = [];

    for (const jobId of jobIds) {
      try {
        // Remove from quarantine
        await this.quarantine.removeJob(queueName, jobId);

        results.push({ jobId, success: true });
      } catch (error: any) {
        results.push({ jobId, success: false, error: error.message });
      }
    }

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.quarantine.jobs.bulk_deleted',
      resource: `Quarantine:${queueName}`,
      payload: { queueName, jobIds, results },
    });

    return {
      message: 'Bulk quarantine delete completed',
      results,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    };
  }

  @Get(':queueName/quarantine/stats')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getQuarantineStats(
    @Param('queueName') queueName: string,
  ) {
    const stats = await this.quarantine.getStats(queueName);

    return stats;
  }
}
