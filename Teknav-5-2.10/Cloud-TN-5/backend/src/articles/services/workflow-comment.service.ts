import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventBusService } from '../../../notifications/event-bus.service';
import { AuditLogService } from '../../../logging/audit-log.service';

/**
 * Workflow Comment Service
 * M2 Milestone: "Workflow + collaboration (publisher-grade)"
 * 
 * Handles:
 * - Inline comments anchored to editor positions (or version ID).
 * - Realtime via Redis Events.
 */

@Injectable()
export class WorkflowCommentService {
  private readonly logger = new Logger(WorkflowCommentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Add Comment
   */
  async addComment(actor: any, articleId: number, versionId: number, anchor: string, body: string) {
    // 1. Create Comment
    const comment = await this.prisma.editorComment.create({
      data: {
        tenantId: actor.tenantId, // From TenantContext
        articleId,
        versionId,
        anchor,
        body,
        status: 'ACTIVE',
        createdBy: actor.userId,
      },
    });

    this.logger.log(`Comment added: ${comment.id}`);

    // 2. Publish Event (Realtime)
    await this.eventBus.publish('workflow.comment.created', {
      id: comment.id,
      articleId,
      versionId,
      userId: actor.userId,
      timestamp: new Date(),
    });

    // 3. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'workflow.comment.created',
      resource: `EditorComment:${comment.id}`,
      payload: { articleId, versionId, anchor },
    });

    return comment;
  }

  /**
   * Get Comments (For Article/Version)
   */
  async getComments(actor: any, articleId: number, versionId?: number) {
    return await this.prisma.editorComment.findMany({
      where: {
        tenantId: actor.tenantId,
        articleId,
        ...(versionId && { versionId }),
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    });
  }

  /**
   * Resolve Comment (Mark as reviewed)
   */
  async resolveComment(actor: any, commentId: number) {
    const comment = await this.prisma.editorComment.findFirst({
      where: { id: commentId, tenantId: actor.tenantId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const updated = await this.prisma.editorComment.update({
      where: { id: commentId },
      data: {
        status: 'RESOLVED',
      },
    });

    // Publish Event
    await this.eventBus.publish('workflow.comment.resolved', {
      id: commentId,
      articleId: comment.articleId,
      userId: actor.userId,
      timestamp: new Date(),
    });

    return updated;
  }

  /**
   * Delete Comment (Soft)
   */
  async deleteComment(actor: any, commentId: number) {
    const comment = await this.prisma.editorComment.findFirst({
      where: { id: commentId, tenantId: actor.tenantId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    await this.prisma.editorComment.update({
      where: { id: commentId },
      data: {
        status: 'DELETED',
      },
    });

    // Publish Event
    await this.eventBus.publish('workflow.comment.deleted', {
      id: commentId,
      articleId: comment.articleId,
      userId: actor.userId,
      timestamp: new Date(),
    });

    return { success: true };
  }
}
