import { Controller, Get, Post, Patch, Body, UseGuards, Req, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { AuditDecorator } from '../../common/decorators/audit.decorator';

/**
 * User Notifications Controller
 *
 * Endpoints for logged-in users to see their notifications.
 */

@Controller('api/me/notifications')
// @UseGuards(AuthGuard) // Assumed global
export class UserNotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Get User Notifications
   */
  @Get('')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'notification.list', resourceType: 'Notification' })
  async getUserNotifications(
    @Query('status') status: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('sort') sort: string,
    @Req() req: any,
  ): Promise<{ data: any[]; total: number }> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    // Use `getNotifications` with `userId` filter to get user's own notifications
    // Note: `getNotifications` in NotificationService expects `workspaceId` too.
    // We pass `userId: actor.userId` to filters.
    
    const filters = {
      userId: actor.userId, // This ensures user only sees their own
      status,
      page: page ? parseInt(page) : 1,
      pageSize: pageSize ? parseInt(pageSize) : 20,
      sort: sort || 'createdAt',
    };

    return await this.notificationService.getNotifications(actor, workspaceId, filters);
  }

  /**
   * Mark as Read
   */
  @Patch('read')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'notification.read', resourceType: 'Notification' })
  async markRead(@Body() body: { id: number } | { ids: number[] }, @Req() req: any): Promise<void> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    let ids: number[] = [];

    if (Array.isArray(body.ids)) {
      ids = body.ids;
    } else if (body.id) {
      ids = [body.id];
    }

    if (ids.length > 0) {
      await this.notificationService.markAsRead(actor, workspaceId, ids);
    }
  }
}
