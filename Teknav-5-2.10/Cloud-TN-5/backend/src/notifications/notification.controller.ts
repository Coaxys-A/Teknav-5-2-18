import { Controller, Get, Post, Patch, Body, Param, UseGuards, Req, HttpCode, HttpStatus, Query, Res } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { AuditDecorator } from '../../common/decorators/audit.decorator';

/**
 * Notification Controller (Admin)
 */

@Controller('admin/notifications')
// @UseGuards(AuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Get Notifications (Admin)
   */
  @Get('')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'notification.list', resourceType: 'Notification' })
  async getNotifications(
    @Query('userId') userId: string,
    @Query('status') status: string,
    @Query('channel') channel: string,
    @Query('type') type: string,
    @Query('q') q: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('sort') sort: string,
    @Req() req: any,
  ): Promise<{ data: any[]; total: number }> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    return await this.notificationService.getNotifications(actor, workspaceId, {
      userId: userId ? parseInt(userId) : undefined,
      status,
      channel,
      type,
      q,
      page: page ? parseInt(page) : 1,
      pageSize: pageSize ? parseInt(pageSize) : 20,
      sort: sort || 'createdAt',
    });
  }

  /**
   * Retry Notification
   */
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'notification.retry', resourceType: 'Notification', resourceIdParam: 'id' })
  async retryNotification(@Param('id') id: string, @Req() req: any): Promise<{ data: any }> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const updated = await this.notificationService.retry(actor, workspaceId, parseInt(id));
    return { data: updated };
  }

  /**
   * Mark Read (Admin action, rare but useful)
   */
  @Patch('read')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'notification.mark.read', resourceType: 'Notification' })
  async markRead(@Body() body: { ids: number[] }, @Req() req: any): Promise<void> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    await this.notificationService.markAsRead(actor, workspaceId, body.ids);
  }

  /**
   * Purge
   */
  @Post('purge')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'notification.purge', resourceType: 'Notification' })
  async purge(@Body() body: { olderThanDays: number; status?: string }, @Req() req: any): Promise<void> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    await this.notificationService.purge(actor, workspaceId, body.olderThanDays, body.status);
  }

  /**
   * DLQ
   */
  @Get('dlq')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'notification.dlq.list', resourceType: 'Notification' })
  async getDlq(@Req() req: any): Promise<{ data: any[] }> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    // Returns failed jobs from Queue
    return { data: [] };
  }

  @Post('dlq/:jobId/replay')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'notification.dlq.replay', resourceType: 'Notification', resourceIdParam: 'jobId' })
  async replayDlq(@Param('jobId') jobId: string, @Req() req: any): Promise<void> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    // Replays failed job
    await this.notificationService.replayDlqJob(jobId);
  }
}
