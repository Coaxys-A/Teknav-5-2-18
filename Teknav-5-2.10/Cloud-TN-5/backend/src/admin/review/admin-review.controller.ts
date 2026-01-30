import { Controller, Get, Post, Patch, Param, Body, UseGuards, Req, HttpCode, HttpStatus, ConflictException } from '@nestjs/common';
import { AdminReviewService } from './admin-review.service';
import { AuditDecorator } from '../../common/decorators/audit.decorator';

/**
 * Admin/Editor Review Controller
 *
 * Endpoints:
 * - GET /api/admin/review/articles
 * - POST /api/admin/review/articles/:id/assign
 * - POST /api/admin/review/articles/:id/approve
 * - POST /api/admin/review/articles/:id/reject
 * - POST /api/admin/review/articles/:id/quality-report
 * - GET /api/admin/review/articles/:id/quality-reports
 */

@Controller('admin/review')
// @UseGuards(AuthGuard) // Applied globally or globally
export class AdminReviewController {
  constructor(private readonly adminReviewService: AdminReviewService) {}

  @Get('articles')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'review.queue.list', resourceType: 'Article' })
  async getReviewQueue(@Req() req: any): Promise<{ data: any[]; total: number }> {
    const actor = req.user;
    const workspaceId = req.workspaceId;
    const filters = {
      status: req.query.status as string,
      q: req.query.q as string,
      categoryId: req.query.categoryId ? parseInt(req.query.categoryId) : undefined,
      authorId: req.query.authorId ? parseInt(req.query.authorId) : undefined,
      assignedReviewerId: req.query.assignedReviewerId ? parseInt(req.query.assignedReviewerId) : undefined,
      page: req.query.page ? parseInt(req.query.page) : 1,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize) : 20,
      sort: req.query.sort as string,
      order: req.query.order as 'asc' | 'desc' | undefined,
    };

    return await this.adminReviewService.getReviewQueue(actor, workspaceId, filters);
  }

  @Post('articles/:id/assign')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'review.assign', resourceType: 'Article', resourceIdParam: 'id' })
  async assignReviewer(@Param('id') id: string, @Body() body: { reviewerId: number; notes: string }, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const updated = await this.adminReviewService.assignReviewer(actor, workspaceId, parseInt(id), body);
    return { data: updated };
  }

  @Post('articles/:id/approve')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'review.approve', resourceType: 'Article', resourceIdParam: 'id' })
  async approveArticle(@Param('id') id: string, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const updated = await this.adminReviewService.approveArticle(actor, workspaceId, parseInt(id));
    return { data: updated };
  }

  @Patch('articles/:id/reject')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'review.reject', resourceType: 'Article', resourceIdParam: 'id' })
  async rejectArticle(@Param('id') id: string, @Body() body: { reason: string }, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const updated = await this.adminReviewService.rejectArticle(actor, workspaceId, parseInt(id), body.reason);
    return { data: updated };
  }

  @Post('articles/:id/quality-report')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'quality.report.create', resourceType: 'Article', resourceIdParam: 'id' })
  async createQualityReport(@Param('id') id: string, @Body() body: any, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const report = await this.adminReviewService.createQualityReport(actor, workspaceId, parseInt(id), body);
    return { data: report };
  }

  @Get('articles/:id/quality-reports')
  @HttpCode(HttpStatus.OK)
  async getQualityReports(@Param('id') id: string, @Req() req: any): Promise<{ data: any[] }> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const reports = await this.adminReviewService.getQualityReports(actor, workspaceId, parseInt(id));
    return { data: reports };
  }
}
