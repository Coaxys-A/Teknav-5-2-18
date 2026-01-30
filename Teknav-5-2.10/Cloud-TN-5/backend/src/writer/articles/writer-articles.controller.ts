import { Controller, Post, Get, Patch, Param, Body, UseGuards, Req, HttpCode, HttpStatus, ConflictException } from '@nestjs/common';
import { WriterArticleService } from './writer-articles.service';
import { AuditDecorator } from '../../common/decorators/audit.decorator';

/**
 * Writer Article Controller (Extended)
 *
 * Adds endpoints:
 * - POST /writer/articles/:id/submit
 * - POST /writer/articles/:id/schedule
 * - POST /writer/articles/:id/reject (For Managers, but scope allows if configured)
 * - POST /writer/articles/:id/publish (For Managers)
 * - POST /writer/articles/:id/autosave
 * - GET /writer/articles/:id/autosave
 * - DELETE /writer/articles/:id/autosave
 * - GET /writer/articles/:id/versions
 * - POST /writer/articles/:id/revert/:versionNumber
 */

@Controller('writer/articles')
// @UseGuards(AuthGuard) // Applied globally
export class WriterArticleController {
  constructor(private readonly writerArticleService: WriterArticleService) {}

  // ... Existing GET, POST, PATCH, GET:id ... (assumed to be merged or added to file)

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'article.submit', resourceType: 'Article', resourceIdParam: 'id' })
  async submitArticle(@Param('id') id: string, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const updated = await this.writerArticleService.submitArticle(actor, workspaceId, parseInt(id));
    return { data: updated };
  }

  @Post(':id/schedule')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'article.schedule', resourceType: 'Article', resourceIdParam: 'id' })
  async scheduleArticle(@Param('id') id: string, @Body() body: { publishedAt: string }, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const updated = await this.writerArticleService.scheduleArticle(actor, workspaceId, parseInt(id), new Date(body.publishedAt));
    return { data: updated };
  }

  @Patch(':id/reject') // Manager route, but can be here
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'article.reject', resourceType: 'Article', resourceIdParam: 'id' })
  async rejectArticle(@Param('id') id: string, @Body() body: { reason: string }, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const updated = await this.writerArticleService.rejectArticle(actor, workspaceId, parseInt(id), body.reason);
    return { data: updated };
  }

  @Post(':id/publish') // Manager route
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'article.publish', resourceType: 'Article', resourceIdParam: 'id' })
  async publishArticle(@Param('id') id: string, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const updated = await this.writerArticleService.publishArticle(actor, workspaceId, parseInt(id));
    return { data: updated };
  }

  @Post(':id/autosave')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'article.autosave', resourceType: 'Article', resourceIdParam: 'id' })
  async autosaveArticle(@Param('id') id: string, @Body() body: any, @Req() req: any): Promise<void> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    await this.writerArticleService.autosaveArticle(actor, workspaceId, parseInt(id), body);
  }

  @Get(':id/autosave')
  @HttpCode(HttpStatus.OK)
  async getAutosave(@Param('id') id: string, @Req() req: any): Promise<{ data: any | null }> {
    const actor = req.user;
    const autosave = await this.writerArticleService.getAutosave(actor, parseInt(id));
    return { data: autosave };
  }

  @Delete(':id/autosave')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'article.autosave.delete', resourceType: 'Article', resourceIdParam: 'id' })
  async deleteAutosave(@Param('id') id: string, @Req() req: any): Promise<void> {
    const actor = req.user;
    await this.writerArticleService.deleteAutosave(actor, parseInt(id));
  }

  @Get(':id/versions')
  @HttpCode(HttpStatus.OK)
  async getVersions(@Param('id') id: string, @Req() req: any): Promise<{ data: any[] }> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const versions = await this.writerArticleService.getVersions(actor, workspaceId, parseInt(id));
    return { data: versions };
  }

  @Post(':id/revert/:versionNumber')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'article.version.revert', resourceType: 'Article', resourceIdParam: 'id' })
  async revertVersion(@Param('id') id: string, @Param('versionNumber') versionNumber: string, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const updated = await this.writerArticleService.revertVersion(actor, workspaceId, parseInt(id), parseInt(versionNumber));
    return { data: updated };
  }
}
