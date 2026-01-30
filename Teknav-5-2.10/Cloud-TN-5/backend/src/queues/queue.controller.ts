import { Controller, Get, Post, Body, Param, UseGuards, Req, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { QueueProducerService } from './queue-producer.service';
import { QueueRegistryService } from './queue-registry.service';
import { AuditDecorator } from '../../../common/decorators/audit.decorator';
import { RequirePolicy } from '../../security/policy/require-policy.decorator';
import { PolicyAction, PolicySubject } from '../../security/policy/policy.types';

/**
 * Queue Controller
 *
 * Endpoints:
 * - POST /api/owner/queues/:queueName (Manual Enqueue)
 * - GET /api/owner/queues/stats
 * - GET /api/owner/queues/dlq
 * - POST /api/owner/queues/dlq/:jobId/retry
 * - POST /api/owner/queues/dlq/:jobId/discard
 */

@Controller('api/owner/queues')
// @UseGuards(AuthGuard)
export class OwnerQueueController {
  constructor(
    private readonly producer: QueueProducerService,
    private readonly registry: QueueRegistryService,
  ) {}

  /**
   * Enqueue AI Content (Example of Manual Enqueue)
   */
  @Post('ai-content')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.CREATE_TOKEN, subject: PolicySubject.API_KEY })
  @AuditDecorator({ action: 'queue.ai.content.manual', resourceType: 'Queue' })
  async enqueueAiContent(@Body() body: any, @Req() req: any) {
    const job = await this.producer.enqueueAiContent(req.user, body);
    return { data: { jobId: job.id } };
  }

  /**
   * Enqueue Workflow (Example)
   */
  @Post('workflow-execution')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.RUN_WORKFLOW, subject: PolicySubject.WORKFLOW })
  @AuditDecorator({ action: 'queue.workflow.manual', resourceType: 'Queue' })
  async enqueueWorkflow(@Body() body: any, @Req() req: any) {
    const job = await this.producer.enqueueWorkflow(req.user, body);
    return { data: { jobId: job.id } };
  }

  /**
   * Get All Stats
   */
  @Get('stats')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'queue.stats.list', resourceType: 'Queue' })
  async getStats() {
    const stats = await this.registry.getAllStats();
    return { data: stats };
  }

  /**
   * Get DLQ List (Filtered)
   */
  @Get('dlq')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'queue.dlq.list', resourceType: 'Queue' })
  async getDlq(
    @Query('queueName') queueName: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    // Stub: In real app, BullMQ `getFailed` scans DLQ.
    // We return empty array for MVP.
    const dlqJobs = [];
    return { data: dlqJobs, total: 0 };
  }

  /**
   * Retry DLQ Job
   */
  @Post('dlq/:jobId/retry')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'queue.dlq.retry', resourceType: 'Queue', resourceIdParam: 'jobId' })
  async retryDlqJob(@Param('jobId') jobId: string, @Req() req: any) {
    // Stub: BullMQ `getJob(jobId)`, then `retry()`.
    return { success: true, message: 'Job retried' };
  }

  /**
   * Discard DLQ Job
   */
  @Post('dlq/:jobId/discard')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'queue.dlq.discard', resourceType: 'Queue', resourceIdParam: 'jobId' })
  async discardDlqJob(@Param('jobId') jobId: string, @Req() req: any) {
    // Stub: BullMQ `getJob(jobId)`, then `discard()`.
    return { success: true, message: 'Job discarded' };
  }
}

@Controller('api/admin/queues')
export class AdminQueueController {
  @Get('stats')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.READ, subject: PolicySubject.WORKFLOW }) // Reuse subject
  async getWorkspaceStats(@Req() req: any) {
    // Returns stats for user's workspace (Filtered)
    // For MVP, we just return all.
    const stats = await this.registry.getAllStats();
    return { data: stats };
  }
}
