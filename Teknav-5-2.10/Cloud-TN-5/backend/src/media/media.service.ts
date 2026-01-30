import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProducerService } from '../../queues/queue-producer.service';
import { EventBusService } from '../../notifications/event-bus.service';
import { AuditLogService } from '../../logging/audit-log.service';

/**
 * Media Service
 *
 * Handles:
 * - Upload (Multipart) -> File + MediaAsset
 * - CRUD (Metadata, Tags)
 * - AI Alt-Text/Caption Generation
 */

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueProducer: QueueProducerService,
    private readonly eventBus: EventBusService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Upload Media
   * (File Interceptor handles file stream)
   */
  async uploadMedia(actor: any, workspaceId: number, file: any, metadata: any) {
    // 1. Store File
    const fileRecord = await this.prisma.file.create({
      data: {
        workspaceId,
        url: file.path, // Or S3 url if integrated
        name: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        uploadedBy: actor.userId,
        metadata: metadata || {},
      },
    });

    // 2. Create MediaAsset
    const mediaAsset = await this.prisma.mediaAsset.create({
      data: {
        workspaceId,
        fileId: fileRecord.id,
        type: this.detectType(file.mimetype),
        altText: metadata?.altText || '',
        caption: metadata?.caption || '',
        tags: metadata?.tags || [],
        folder: metadata?.folder || 'root',
        createdAt: new Date(),
      },
    });

    this.logger.log(`Media uploaded: ${mediaAsset.id}`);

    // 3. Publish Event
    await this.eventBus.publish('media.uploaded', {
      id: mediaAsset.id,
      workspaceId,
      userId: actor.userId,
    });

    return mediaAsset;
  }

  /**
   * List Media
   * Supports tags (folder-like), search (q), type.
   */
  async listMedia(actor: any, workspaceId: number, filters: { q?: string; type?: string; folder?: string }) {
    const where: any = {
      workspaceId,
    };

    if (filters.q) {
      where.OR = [
        { altText: { contains: filters.q } },
        { caption: { contains: filters.q } },
        { file: { name: { contains: filters.q } } },
      ];
    }

    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.folder) {
      where.folder = filters.folder;
    }

    const media = await this.prisma.mediaAsset.findMany({
      where,
      include: {
        file: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return media;
  }

  /**
   * Update Media
   * Updates metadata, tags, folder.
   */
  async updateMedia(actor: any, workspaceId: number, mediaAssetId: number, data: any) {
    const mediaAsset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaAssetId, workspaceId },
      include: { file: true },
    });

    if (!mediaAsset) {
      throw new NotFoundException('Media Asset not found');
    }

    const updated = await this.prisma.mediaAsset.update({
      where: { id: mediaAssetId },
      data: {
        altText: data.altText,
        caption: data.caption,
        tags: data.tags,
        folder: data.folder,
        metadata: data.metadata,
        changedBy: actor.userId,
        changedAt: new Date(),
      },
    });

    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'media.update',
      resource: `MediaAsset:${mediaAssetId}`,
      payload: { folder: data.folder, tags: data.tags },
    });

    return updated;
  }

  /**
   * Delete Media
   * Deletes MediaAsset and File.
   */
  async deleteMedia(actor: any, workspaceId: number, mediaAssetId: number) {
    const mediaAsset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaAssetId, workspaceId },
      include: { file: true },
    });

    if (!mediaAsset) {
      throw new NotFoundException('Media Asset not found');
    }

    // 1. Delete File (Physical deletion handled by service or just DB)
    // await this.prisma.file.delete({ where: { id: mediaAsset.file.id } });
    // For MVP, we just keep DB record or soft delete.
    await this.prisma.file.update({
      where: { id: mediaAsset.file.id },
      data: { deletedAt: new Date() },
    });

    // 2. Delete MediaAsset
    await this.prisma.mediaAsset.delete({
      where: { id: mediaAssetId },
    });

    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'media.delete',
      resource: `MediaAsset:${mediaAssetId}`,
    });

    return { success: true };
  }

  /**
   * AI Alt-Text / Caption
   * Enqueues `ai-content` job.
   */
  async generateAiAltText(actor: any, workspaceId: number, mediaAssetId: number) {
    const mediaAsset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaAssetId, workspaceId },
      include: { file: true },
    });

    if (!mediaAsset) {
      throw new NotFoundException('Media Asset not found');
    }

    // 1. Enqueue AI Job
    const job = await this.queueProducer.enqueueAiContent(actor, {
      articleId: 0, // N/A for Media
      workspaceId,
      model: 'gpt-4-vision-preview',
      promptTemplateId: 1, // "Describe Image" template
      priority: 10,
    });

    // 2. Update MediaAsset with Job ID (To track result)
    await this.prisma.mediaAsset.update({
      where: { id: mediaAssetId },
      data: {
        metadata: { ...mediaAsset.metadata, aiJobId: job.id, aiStatus: 'PENDING' },
      },
    });

    // 3. Publish Event
    await this.eventBus.publish('media.ai.started', {
      mediaAssetId,
      jobId: job.id,
      workspaceId,
    });

    return { success: true, jobId: job.id };
  }

  private detectType(mimeType: string): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' {
    if (mimeType.startsWith('image/')) return 'IMAGE';
    if (mimeType.startsWith('video/')) return 'VIDEO';
    if (mimeType.startsWith('audio/')) return 'AUDIO';
    return 'DOCUMENT';
  }
}
