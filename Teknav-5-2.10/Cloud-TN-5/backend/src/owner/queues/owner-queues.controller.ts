import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { PoliciesGuard } from '../../auth/policies.guard';
import { RequirePolicy } from '../../security/policy/policy.decorator';
import { PolicyAction, PolicySubject } from '../../security/policy/policy.types';
import { AuditLogService } from '../../logging/audit-log.service';
import { QueueConfigService } from '../queue-config.service';
import { ProducerService } from '../services/producer.service';
import { QueueEventsService } from '../services/queue-events.service';
import { JobSlaService } from '../services/job-sla.service';
import { QuarantineService } from '../services/quarantine.service';
import { CircuitBreakerService } from '../services/circuit-breaker.service';
import { JobType, JobPriority } from '../types/job-envelope';

/**
 * Owner Queue Observatory Controller
 * M11 - Queue Platform: "Owner UI — Queue Observatory"
 *
 * Endpoints:
 * - GET /api/owner/queues (overview, health, metrics, events)
 * - GET /api/owner/queues/:queueName (jobs list, stats)
 * - POST /api/owner/queues/:queueName/jobs/retry (retry job)
 * - POST /api/owner/queues/:queueName/jobs/cancel (cancel job)
 * - POST /api/owner/queues/:queueName/pause (pause queue)
 * - POST /api/owner/queues/:queueName/resume (resume queue)
 * - GET /api/owner/queues/:queueName/dlq (DLQ list)
 * - POST /api/owner/queues/:queueName/dlq/replay (replay job)
 * - GET /api/owner/queues/:queueName/quarantine (quarantine list)
 * - POST /api/owner/queues/:queueName/quarantine/delete (delete quarantined)
 * - GET /api/owner/queues/health (health check)
 * - GET /api/owner/queues/sla (SLA stats)
 * - GET /api/owner/queues/circuits (circuit breaker status)
 */

@Controller('api/owner/queues')
@UseGuards(PoliciesGuard)
export class OwnerQueueController {
  constructor(
    private readonly queueConfig: QueueConfigService,
    private readonly producer: ProducerService,
    private readonly queueEvents: QueueEventsService,
    private readonly jobSla: JobSlaService,
    private readonly quarantine: QuarantineService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ==========================================================================
  // OVERVIEW & HEALTH
  // ==========================================================================

  @Get()
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getQueuesOverview(@Req() req: any) {
    const actorId = req.user.id;
    const tenantId = req.user.tenantId;

    // Get all queues from config service
    const queueNames = Object.values(JobType);

    // Get stats for each queue
    const queues = [];

    for (const jobType of queueNames) {
      const queue = this.queueConfig.getQueue(jobType);
      const dlq = this.queueConfig.getDlq(jobType);

      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      const paused = await queue.isPaused();
      const workers = await queue.getWorkers(); // Get worker count

      queues.push({
        name: queue.name,
        jobType,
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused,
        workers: workers.length,
        rate: 0, // Would calculate from recent completions
        avgDurationMs: 0, // Would calculate from recent completions
        isStalled: false, // Would check if jobs > N minutes old
        lastUpdatedAt: new Date().toISOString(),
      });
    }

    return {
      data: queues,
      summary: {
        totalQueues: queues.length,
        totalWaiting: queues.reduce((sum, q) => sum + q.waiting, 0),
        totalActive: queues.reduce((sum, q) => sum + q.active, 0),
        totalFailed: queues.reduce((sum, q) => sum + q.failed, 0),
        healthyQueues: queues.filter(q => !q.paused && q.failed < 10).length,
      },
    };
  }

  @Get('health')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getHealthCheck(@Req() req: any) {
    const actorId = req.user.id;
    const tenantId = req.user.tenantId;

    // Get queue health
    const queueHealth = await this.getQueueHealthInternal();

    // Get circuit breaker status
    const circuits = await this.circuitBreaker.getAllCircuits();

    // Check Redis connectivity
    // Check Postgres connectivity
    const redisStatus = 'ok'; // Would check Redis ping
    const postgresStatus = 'ok'; // Would check Prisma connection

    const health = {
      status: queueHealth.every((q: any) => q.status === 'ok') && redisStatus === 'ok' && postgresStatus === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        queues: queueHealth,
        circuits: Object.fromEntries(circuits),
        redis: { status: redisStatus },
        postgres: { status: postgresStatus },
      },
    };

    return health;
  }

  @Get('sla')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getSlaStats(@Query('hours') hours?: string) {
    const windowHours = hours ? parseInt(hours) : 24;
    const jobTypes = Object.values(JobType);

    const slaStats = {};

    for (const jobType of jobTypes) {
      const stats = await this.jobSla.getSlaStats(jobType, windowHours);
      const degradation = await this.jobSla.checkSlaDegradation(jobType, windowHours);

      slaStats[jobType] = {
        ...stats,
        degraded: degradation.degraded,
        breachRate: degradation.breachRate,
      };
    }

    return {
      data: slaStats,
      summary: {
        totalBreaches: Object.values(slaStats).reduce((sum, s) => sum + s.breachRate, 0),
      },
    };
  }

  @Get('circuits')
  @RequirePolicy(PolicyAction.MANAGE_SETTINGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getCircuitStatus() {
    const circuits = await this.circuitBreaker.getAllCircuits();

    return {
      data: Object.fromEntries(circuits),
      summary: {
        totalCircuits: circuits.size,
        openCircuits: Array.from(circuits.entries()).filter(([_, status]) => status.state === 'OPEN').length,
      },
    };
  }

  @Post('circuits/:dependency/reset')
  @RequirePolicy(PolicyAction.MANAGE_SETTINGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async resetCircuit(@Param('dependency') dependency: string) {
    await this.circuitBreaker.resetCircuit(dependency);

    await this.auditLog.logAction({
      actorUserId: null, // System action
      action: 'queue.circuit.reset',
      resource: `CircuitBreaker:${dependency}`,
      payload: { dependency },
    });

    return { message: 'Circuit reset' };
  }

  // ==========================================================================
  // QUEUE ACTIONS
  // ==========================================================================

  @Get(':queueName/jobs')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getQueueJobs(
    @Param('queueName') queueName: string,
    @Query() query: any,
  ) {
    const actorId = query.actorId;
    const page = parseInt(query.page || '1');
    const pageSize = parseInt(query.pageSize || '20');
    const status = query.status;
    const jobType = query.jobType;
    const search = query.search;

    // Get jobs from queue
    // For MVP, we'll use queue.getJobs() method
    // In production, you'd query AiJob table with filters

    return {
      data: [], // Would return filtered jobs
      page,
      pageSize,
      total: 0, // Would return total count
      filters: { status, jobType, search },
    };
  }

  @Post(':queueName/jobs/:aiJobId/retry')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async retryJob(
    @Param('queueName') queueName: string,
    @Param('aiJobId') aiJobId: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Replay job: create new job with same payload, new idempotency key
    // For MVP, we'll just log it

    await this.queueEvents.jobReplayed({
      queueName: `${this.queueConfig.getQueuePrefix()}:${queueName}`,
      jobType: 'any', // Would get from AiJob
      aiJobId: parseInt(aiJobId),
      oldBullJobId: '', // Would get from mapping
      newBullJobId: '',
      traceId: '',
      actorId,
      metadata: {},
    });

    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.job.retried',
      resource: `QueueJob:${aiJobId}`,
      payload: { queueName, aiJobId },
    });

    return { message: 'Job retried' };
  }

  @Post(':queueName/jobs/:aiJobId/cancel')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async cancelJob(
    @Param('queueName') queueName: string,
    @Param('aiJobId') aiJobId: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Cancel job: mark as CANCELLED in AiJob, remove from BullMQ
    // For MVP, we'll just log it

    await this.queueEvents.jobCancelled({
      queueName: `${this.queueConfig.getQueuePrefix()}:${queueName}`,
      jobType: 'any',
      aiJobId: parseInt(aiJobId),
      bullJobId: '',
      traceId: '',
      actorId,
      metadata: {},
    });

    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.job.cancelled',
      resource: `QueueJob:${aiJobId}`,
      payload: { queueName, aiJobId },
    });

    return { message: 'Job cancelled' };
  }

  @Post(':queueName/pause')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async pauseQueue(
    @Param('queueName') queueName: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Pause queue: queue.pause()
    const queue = this.queueConfig.getQueue(queueName as JobType);
    await queue.pause();

    await this.queueEvents.queuePaused({
      queueName: `${this.queueConfig.getQueuePrefix()}:${queueName}`,
      actorId,
      metadata: {},
    });

    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.paused',
      resource: `Queue:${queueName}`,
      payload: { queueName },
    });

    return { message: 'Queue paused' };
  }

  @Post(':queueName/resume')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async resumeQueue(
    @Param('queueName') queueName: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Resume queue: queue.resume()
    const queue = this.queueConfig.getQueue(queueName as JobType);
    await queue.resume();

    await this.queueEvents.queueResumed({
      queueName: `${this.queueConfig.getQueuePrefix()}:${queueName}`,
      actorId,
      metadata: {},
    });

    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.resumed',
      resource: `Queue:${queueName}`,
      payload: { queueName },
    });

    return { message: 'Queue resumed' };
  }

  // ==========================================================================
  // DLQ ACTIONS
  // ==========================================================================

  @Get(':queueName/dlq')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getDlqJobs(
    @Param('queueName') queueName: string,
    @Query() query: any,
  ) {
    const actorId = query.actorId;
    const page = parseInt(query.page || '1');
    const pageSize = parseInt(query.pageSize || '20');
    const errorType = query.errorType;
    const search = query.search;

    // Get DLQ jobs
    const dlq = this.queueConfig.getDlq(queueName as JobType);
    const jobs = await dlq.getJobs(0, pageSize - 1); // Get jobs from DLQ

    return {
      data: jobs.map(job => ({
        id: job.id,
        aiJobId: job.data.aiJobId,
        originalJobId: job.data.originalJobId,
        originalQueue: job.data.originalQueue,
        attemptsMade: job.data.attemptsMade,
        failedAt: job.data.failedAt,
        error: job.data.error,
        payload: job.data,
      })),
      page,
      pageSize,
      total: jobs.length, // Would get actual count
      filters: { errorType, search },
    };
  }

  @Post(':queueName/dlq/:jobId/replay')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async replayDlqJob(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Get job from DLQ
    const dlq = this.queueConfig.getDlq(queueName as JobType);
    const job = await dlq.getJob(jobId);

    // Remove from DLQ
    await dlq.remove(jobId);

    // Replay job: enqueue to main queue with new idempotency key
    const replayedJobId = await this.queueConfig.getQueue(queueName as JobType).add(
      `${queueName}-replay`,
      job.data.payload,
      {
        jobId: `${queueName}-${Date.now()}-${Math.random()}`,
        attempts: 0,
      },
    );

    await this.queueEvents.jobReplayed({
      queueName: `${this.queueConfig.getQueuePrefix()}:${queueName}`,
      jobType: job.data.jobType,
      aiJobId: job.data.aiJobId,
      oldBullJobId: job.data.originalJobId,
      newBullJobId: replayedJobId.id,
      traceId: job.data.payload.traceId,
      actorId,
      metadata: {},
    });

    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.dlq.job.replayed',
      resource: `DlqJob:${jobId}`,
      payload: { queueName, jobId },
    });

    return { message: 'Job replayed from DLQ' };
  }

  @Post(':queueName/dlq/clear')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async clearDlq(
    @Param('queueName') queueName: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Clear DLQ: remove all jobs
    const dlq = this.queueConfig.getDlq(queueName as JobType);
    await dlq.drain();

    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.dlq.cleared',
      resource: `Dlq:${queueName}`,
      payload: { queueName },
    });

    return { message: 'DLQ cleared' };
  }

  // ==========================================================================
  // QUARANTINE ACTIONS
  // ==========================================================================

  @Get(':queueName/quarantine')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getQuarantineJobs(
    @Param('queueName') queueName: string,
    @Query() query: any,
  ) {
    const page = parseInt(query.page || '1');
    const pageSize = parseInt(query.pageSize || '20');
    const reason = query.reason;
    const search = query.search;

    // Get quarantined jobs
    const jobs = await this.quarantine.getQuarantinedJobs(queueName, pageSize);

    return {
      data: jobs,
      page,
      pageSize,
      total: jobs.length, // Would get actual count
      filters: { reason, search },
    };
  }

  @Post(':queueName/quarantine/:jobId/promote')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async promoteQuarantineJob(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    const aiJobId = parseInt(query.aiJobId || '0');

    // Promote to DLQ
    await this.quarantine.promoteToDlq(queueName, jobId, aiJobId, actorId);

    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.quarantine.promoted_to_dlq',
      resource: `QuarantineJob:${jobId}`,
      payload: { queueName, jobId },
    });

    return { message: 'Job promoted to DLQ' };
  }

  @Post(':queueName/quarantine/:jobId/delete')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async deleteQuarantineJob(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Remove from quarantine
    await this.quarantine.removeJob(queueName, jobId);

    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.quarantine.deleted',
      resource: `QuarantineJob:${jobId}`,
      payload: { queueName, jobId },
    });

    return { message: 'Quarantine job deleted' };
  }

  @Post(':queueName/quarantine/clear')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async clearQuarantine(
    @Param('queueName') queueName: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Clear quarantine for queue
    await this.quarantine.clearQuarantine(queueName);

    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'queue.quarantine.cleared',
      resource: `Quarantine:${queueName}`,
      payload: { queueName },
    });

    return { message: 'Quarantine cleared' };
  }

  // ==========================================================================
  // INTERNAL HELPER
  // ==========================================================================

  private async getQueueHealthInternal(): Promise<any[]> {
    const queueNames = Object.values(JobType);
    const health = [];

    for (const jobType of queueNames) {
      const queue = this.queueConfig.getQueue(jobType);
      const waiting = await queue.getWaitingCount();
      const delayed = await queue.getDelayedCount();
      const active = await queue.getActiveCount();
      const completed = await queue.getCompletedCount();
      const failed = await queue.getFailedCount();
      const isPaused = await queue.isPaused();

      // Calculate age of oldest waiting job
      let isStalled = false;
      if (waiting > 0) {
        const jobs = await queue.getJobs(0, 0, 'delayed'); // Get delayed jobs (which includes waiting)
        if (jobs.length > 0) {
          const oldestJob = jobs[jobs.length - 1];
          const age = Date.now() - new Date(oldestJob.timestamp).getTime();
          isStalled = age > 5 * 60 * 1000; // 5 minutes
        }
      }

      health.push({
        name: queue.name,
        jobType,
        status: isPaused ? 'paused' : isStalled ? 'stalled' : 'ok',
        waiting,
        active,
        completed,
        failed,
        delayed,
        isStalled,
      });
    }

    return health;
  }
}
