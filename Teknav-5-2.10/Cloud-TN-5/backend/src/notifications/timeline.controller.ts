import { Controller, Get, Query, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { AuditDecorator } from '../../common/decorators/audit.decorator';

/**
 * Timeline Controller
 */

@Controller('admin/timeline')
// @UseGuards(AuthGuard)
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  /**
   * Global Timeline
   */
  @Get('')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'timeline.global.list', resourceType: 'TimelineEvent' })
  async getGlobalTimeline(
    @Query('workspaceId') workspaceId: string,
    @Query('severity') severity: string,
    @Query('type') type: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('sort') sort: string,
    @Req() req: any,
  ) {
    const actor = req.user;
    const filters = {
      workspaceId: workspaceId ? parseInt(workspaceId) : undefined,
      severity,
      type,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: page ? parseInt(page) : 1,
      pageSize: pageSize ? parseInt(pageSize) : 20,
      sort: sort || 'at',
    };

    return await this.timelineService.getGlobalTimeline(actor, filters);
  }

  /**
   * Entity Timeline
   */
  @Get('entity/:entityType/:entityId')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'timeline.entity.list', resourceType: 'TimelineEvent', resourceIdParam: 'entityId' })
  async getEntityTimeline(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Req() req: any,
  ) {
    const actor = req.user;
    return await this.timelineService.getEntityTimeline(actor, entityType, parseInt(entityId));
  }
}
