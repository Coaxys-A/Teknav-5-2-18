import { Controller, Post, Get, Patch, Delete, Param, UseInterceptors, UseGuards, Body, Query, HttpCode, HttpStatus, UploadedFile, Req, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.service';
import { AuditDecorator } from '../../common/decorators/audit.decorator';
import { RequirePolicy } from '../../security/policy/require-policy.decorator';
import { PolicyAction, PolicySubject } from '../../security/policy/policy.types';

/**
 * Media Controller
 *
 * Endpoints:
 * - Upload (Multipart)
 * - List
 * - Update
 * - Delete
 * - AI Alt-Text
 */

@Controller('api/media')
// @UseGuards(AuthGuard) // Assumed global
@UseInterceptors(FileInterceptor('file')) // Key 'file' used in service
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Upload Media
   */
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.CREATE, subject: PolicySubject.API_KEY }) // Or create token action
  @AuditDecorator({ action: 'media.upload', resourceType: 'MediaAsset' })
  async uploadMedia(@Req() req: any, @Body() body: any) {
    // 'file' attached by Interceptor
    return { data: await this.mediaService.uploadMedia(req.user, req.workspaceId, req.file, body.metadata) };
  }

  /**
   * List Media
   */
  @Get('')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.READ, subject: PolicySubject.API_KEY })
  @AuditDecorator({ action: 'media.list', resourceType: 'MediaAsset' })
  async listMedia(@Req() req: any, @Query('q') q: string, @Query('type') type: string, @Query('folder') folder: string) {
    return { data: await this.mediaService.listMedia(req.user, req.workspaceId, { q, type, folder }) };
  }

  /**
   * Update Media
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.UPDATE, subject: PolicySubject.API_KEY })
  @AuditDecorator({ action: 'media.update', resourceType: 'MediaAsset', resourceIdParam: 'id' })
  async updateMedia(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return { data: await this.mediaService.updateMedia(req.user, req.workspaceId, parseInt(id), body) };
  }

  /**
   * Delete Media
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.DELETE, subject: PolicySubject.API_KEY })
  @AuditDecorator({ action: 'media.delete', resourceType: 'MediaAsset', resourceIdParam: 'id' })
  async deleteMedia(@Param('id') id: string, @Req() req: any) {
    return { data: await this.mediaService.deleteMedia(req.user, req.workspaceId, parseInt(id)) };
  }

  /**
   * Generate AI Alt-Text
   */
  @Post(':id/ai-alttext')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.CREATE_TOKEN, subject: PolicySubject.API_KEY }) // Run AI requires token
  @AuditDecorator({ action: 'media.ai.alttext', resourceType: 'MediaAsset', resourceIdParam: 'id' })
  async generateAiAltText(@Param('id') id: string, @Req() req: any) {
    return { data: await this.mediaService.generateAiAltText(req.user, req.workspaceId, parseInt(id)) };
  }
}
