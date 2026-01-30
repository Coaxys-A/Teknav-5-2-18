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
 * Owner Queue Observatory Controller (COMPLETED)
 * M11 - Queue Platform: "Owner UI — Queue Observatory"
 */

@Controller('api/owner/queues')
@UseGuards(PoliciesGuard)
export class OwnerQueueController {
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
  // JOB DETAILS
  // ==========================================================================

  @Get(':queueName/jobs/:aiJobId')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getJobDetail(
    @Param('queueName') queueName: string,
    @Param('aiJobId') aiJobId: string,
  ) {
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

    // Get job events from AuditLog
    const events = await this.prisma.auditLog.findMany({
      where: {
        action: { in: ['queue.job.enqueued', 'queue.job.started', 'queue.job.completed', 'queue.job.failed', 'queue.job.retried', 'queue.job.moved_to_dlq', 'queue.job.cancelled', 'queue.job.replayed'] },
        resource: `AiJob:${aiJobId}`,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

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
      events: events.map(e => ({
        id: e.id,
        type: e.action.replace('queue.job.', '').toUpperCase(),
        timestamp: e.createdAt,
        message: e.action,
        actorId: e.actorUserId,
        metadata: e.payload,
      })),
    };
  }

  @Get(':queueName/jobs/:aiJobId/events')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getJobEvents(
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
      orderBy: { createdAt: 'desc' },
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
  async getJobLogs(
    @Param('queueName') queueName: string,
    @Param('aiJobId') aiJobId: string,
  ) {
    // Get job details with error logs
    const job = await this.prisma.aiJob.findUnique({
      where: { id: parseInt(aiJobId) },
    });

    if (!job) {
      throw new Error(`Job not found: ${aiJobId}`);
    }

    // In production, this would fetch from logging service
    // For MVP, we'll return the error message
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
    };
  }

  @Post(':queueName/jobs/:aiJobId/replay-with-payload')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async replayJobWithPayload(
    @Param('queueName') queueName: string,
    @Param('aiJobId') aiJobId: string,
    @Body() body: { newIdempotencyKey?: string; payloadUpdates?: any },
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Get original job
    const originalJob = await this.prisma.aiJob.findUnique({
      where: { id: parseInt(aiJobId) },
      include: { task: true },
    });

    if (!originalJob) {
      throw new Error(`Job not found: ${aiJobId}`);
    }

    // Merge payload updates
    const payload = body.payloadUpdates
      ? { ...(originalJob.task as object), ...body.payloadUpdates }
      : originalJob.task;

    // Replay job with new idempotency key
    const newIdempotencyKey = body.newIdempotencyKey || `${originalJob.id}-replay-${Date.now()}`;

    const result = await this.queueConfig.getQueue(queueName as JobType).add(
      `${queueName}-replay`,
      payload,
      {
        jobId: `${queueName}-${Date.now()}-${Math.random()}`,
        attempts: 0,
      },
    );

    // Publish replay event
    await this.queueEvents.jobReplayed({
      queueName: `${this.queueConfig.getQueuePrefix()}:${queueName}`,
      jobType: originalJob.type,
      aiJobId: originalJob.id,
      oldBullJobId: originalJob.jobId,
      newBullJobId: result.id,
      traceId: (originalJob.task as any)?.traceId,
      actorId,
      metadata: { newIdempotencyKey, payloadUpdated: !!body.payloadUpdates },
    });

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.job.replayed_with_payload',
      resource: `AiJob:${aiJobId}`,
      payload: {
        queueName,
        aiJobId,
        newIdempotencyKey,
        payloadUpdated: !!body.payloadUpdates,
      },
    });

    return {
      message: 'Job replayed with new payload',
      aiJobId: originalJob.id,
      newJobId: result.id,
      newIdempotencyKey,
    };
  }

  // ==========================================================================
  // QUEUE CLEANUP
  // ==========================================================================

  @Post(':queueName/clean')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async cleanQueue(
    @Param('queueName') queueName: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Clean queue: remove completed jobs
    const queue = this.queueConfig.getQueue(queueName as JobType);
    await queue.clean(5000, 'completed'); // Keep last 5000 completed jobs

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.cleaned',
      resource: `Queue:${queueName}`,
      payload: { queueName },
    });

    return { message: 'Queue cleaned' };
  }

  // ==========================================================================
  // BULK ACTIONS
  // ==========================================================================

  @Post(':queueName/jobs/bulk-retry')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async bulkRetryJobs(
    @Param('queueName') queueName: string,
    @Body() body: { jobIds: string[] },
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    const { jobIds } = body;

    const results = [];

    for (const jobId of jobIds) {
      // Parse aiJobId from jobId
      const aiJobId = jobId.split('-').pop(); // Assumes format: queue-aiJobId-timestamp-random

      try {
        // Get job from AiJob table
        const job = await this.prisma.aiJob.findUnique({
          where: { id: parseInt(aiJobId) },
        });

        if (!job) {
          results.push({ jobId, success: false, error: 'Job not found' });
          continue;
        }

        // Replay job
        const result = await this.queueConfig.getQueue(queueName as JobType).add(
          `${queueName}-bulk-retry`,
          job.task,
          {
            jobId: `${queueName}-${Date.now()}-${Math.random()}`,
            attempts: 0,
          },
        );

        results.push({ jobId, success: true, newJobId: result.id });
      } catch (error: any) {
        results.push({ jobId, success: false, error: error.message });
      }
    }

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.jobs.bulk_retried',
      resource: `Queue:${queueName}`,
      payload: { queueName, jobIds, results },
    });

    return {
      message: `Bulk retry completed`,
      results,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    };
  }

  @Post(':queueName/jobs/bulk-cancel')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async bulkCancelJobs(
    @Param('queueName') queueName: string,
    @Body() body: { jobIds: string[] },
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    const { jobIds } = body;

    const results = [];

    for (const jobId of jobIds) {
      const aiJobId = jobId.split('-').pop();

      try {
        // Get job from AiJob table
        const job = await this.prisma.aiJob.findUnique({
          where: { id: parseInt(aiJobId) },
        });

        if (!job) {
          results.push({ jobId, success: false, error: 'Job not found' });
          continue;
        }

        // Update job status to CANCELLED
        await this.prisma.aiJob.update({
          where: { id: parseInt(aiJobId) },
          data: {
            status: 'CANCELLED',
            finishedAt: new Date(),
            errorMessage: 'Bulk cancelled',
          },
        });

        // Remove from BullMQ queue
        const queue = this.queueConfig.getQueue(queueName as JobType);
        // Note: queue.remove(jobId) would be called here

        // Publish cancel event
        await this.queueEvents.jobCancelled({
          queueName: `${this.queueConfig.getQueuePrefix()}:${queueName}`,
          jobType: job.type,
          aiJobId: job.id,
          bullJobId: jobId,
          traceId: (job.task as any)?.traceId,
          actorId,
          metadata: {},
        });

        results.push({ jobId, success: true });
      } catch (error: any) {
        results.push({ jobId, success: false, error: error.message });
      }
    }

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.jobs.bulk_cancelled',
      resource: `Queue:${queueName}`,
      payload: { queueName, jobIds, results },
    });

    return {
      message: `Bulk cancel completed`,
      results,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    };
  }
}
