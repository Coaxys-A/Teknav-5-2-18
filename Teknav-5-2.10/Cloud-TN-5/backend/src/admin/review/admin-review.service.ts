import { Injectable, Logger, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PolicyAction, PolicySubject, PolicyResult } from '../../security/policy/policy.types';
import { PolicyEngineService } from '../../security/policy/policy.engine.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { RedisService } from '../../redis/redis.service';
import { NotificationService } from '../notifications/notification.service';

/**
 * Admin/Editor Review Service
 *
 * Handles:
 * - Review Queue (SUBMITTED articles)
 * - Assignment of reviewer (optional) + review notes
 * - Approve/Reject actions (server-enforced transitions)
 * - Quality report creation + retrieval (ArticleQualityReport + AIReport hooks if present)
 * - Realtime updates in review UI using Redis Pub/Sub (no WebSocket terminal yet; just dashboard events)
 * - Notifications creation (Notification model) for writer on approval/rejection
 */

@Injectable()
export class AdminReviewService {
  private readonly logger = new Logger(AdminReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyEngine: PolicyEngineService,
    private readonly auditLog: AuditLogService,
    private readonly notificationService: NotificationService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Get Review Queue
   * Returns paginated list of SUBMITTED articles in workspace.
   * Must enforce workspace boundary.
   */
  async getReviewQueue(
    actor: any,
    workspaceId: number,
    filters: {
      status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'READY_FOR_PUBLISH';
      q?: string;
      categoryId?: number;
      authorId?: number;
      assignedReviewerId?: number;
      page: number;
      pageSize: number;
      sort?: 'createdAt' | 'updatedAt';
      order?: 'asc' | 'desc';
    },
  ): Promise<{ data: any[]; total: number }> {
    // 1. Policy Check (READ)
    let policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.READ,
      subject: PolicySubject.ARTICLE,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    // 2. Build Query
    const where: any = {
      workspaceId,
    };

    if (filters.status) {
      where.status = filters.status;
    } else {
      // Default to SUBMITTED
      where.status = 'SUBMITTED';
    }

    if (filters.q) {
      where.OR = [
        { title: { contains: filters.q } },
        { excerpt: { contains: filters.q } },
      ];
    }

    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters.authorId) {
      where.authorId = filters.authorId;
    }

    if (filters.assignedReviewerId) {
      where.reviewerId = filters.assignedReviewerId;
    }

    const orderBy: any = {};
    if (filters.sort) {
      orderBy[filters.sort] = filters.order || 'desc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const skip = (filters.page - 1) * filters.pageSize;
    const take = filters.pageSize;

    // 3. Execute Query
    const [articles, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          title: true,
          status: true,
          categoryId: true,
          authorId: true,
          reviewerId: true,
          reviewerNotes: true,
          submittedAt: true,
          publishedAt: true,
          rejectionReason: true,
          updatedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.article.count({ where }),
    ]);

    // 4. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'review.queue.list',
      resource: 'Article',
      payload: {
        filters,
        count: articles.length,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    return { data: articles, total };
  }

  /**
   * Assign Reviewer
   * Updates reviewerId and notes.
   */
  async assignReviewer(
    actor: any,
    workspaceId: number,
    articleId: number,
    data: { reviewerId: number; notes: string },
  ): Promise<any> {
    // 1. Policy Check (UPDATE)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.UPDATE,
      subject: PolicySubject.ARTICLE,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    // 2. Update Article
    const updated = await this.prisma.article.update({
      where: { id: articleId, workspaceId },
      data: {
        reviewerId: data.reviewerId,
        reviewerNotes: data.notes,
      },
    });

    // 3. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'review.assign',
      resource: `Article:${articleId}`,
      payload: {
        articleId,
        reviewerId: data.reviewerId,
        notes: data.notes,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    // 4. Publish Pub/Sub Event
    await this.publishEvent('review.assigned', {
      articleId,
      reviewerId: data.reviewerId,
      actorId: actor.userId,
    });

    return updated;
  }

  /**
   * Approve Article
   * Transition: SUBMITTED -> APPROVED
   * Also notifies writer.
   */
  async approveArticle(actor: any, workspaceId: number, articleId: number): Promise<any> {
    // 1. Policy Check (PUBLISH)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.PUBLISH,
      subject: PolicySubject.ARTICLE,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    // 2. Fetch Article
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, workspaceId },
    });

    if (!article) {
      throw new Error('Article not found');
    }

    // 3. Check Status Transition
    if (article.status !== 'SUBMITTED') {
      throw new ConflictException('Only SUBMITTED articles can be approved');
    }

    // 4. Update Article
    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        status: 'APPROVED',
        approvedBy: actor.userId,
        approvedAt: new Date(),
      },
    });

    // 5. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'review.approve',
      resource: `Article:${articleId}`,
      payload: {
        articleId,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    // 6. Notify Writer
    await this.notificationService.createNotification({
      recipientUserId: article.authorId,
      type: 'success',
      title: 'Article Approved',
      message: `Your article "${article.title}" has been approved.`,
      link: `/dashboard/writer/articles/${articleId}/edit`,
    });

    // 7. Publish Pub/Sub Event
    await this.publishEvent('review.approved', {
      articleId,
      authorId: article.authorId,
      reviewerId: actor.userId,
    });

    return updated;
  }

  /**
   * Reject Article
   * Transition: SUBMITTED -> REJECTED
   * Stores rejection reason.
   * Notifies writer.
   */
  async rejectArticle(actor: any, workspaceId: number, articleId: number, reason: string): Promise<any> {
    // 1. Policy Check (UPDATE)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.UPDATE,
      subject: PolicySubject.ARTICLE,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    // 2. Fetch Article
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, workspaceId },
    });

    if (!article) {
      throw new Error('Article not found');
    }

    // 3. Check Status Transition
    if (article.status !== 'SUBMITTED') {
      throw new ConflictException('Only SUBMITTED articles can be rejected');
    }

    // 4. Update Article + Payload
    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
      },
    });

    // 5. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'review.reject',
      resource: `Article:${articleId}`,
      payload: {
        articleId,
        reason,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    // 6. Notify Writer
    await this.notificationService.createNotification({
      recipientUserId: article.authorId,
      type: 'error',
      title: 'Article Rejected',
      message: `Your article "${article.title}" was rejected. Reason: ${reason}`,
      link: `/dashboard/writer/articles/${articleId}/edit`,
    });

    // 7. Publish Pub/Sub Event
    await this.publishEvent('review.rejected', {
      articleId,
      authorId: article.authorId,
      reviewerId: actor.userId,
      reason,
    });

    return updated;
  }

  /**
   * Create Quality Report
   */
  async createQualityReport(
    actor: any,
    workspaceId: number,
    articleId: number,
    data: {
      score: number; // 1-10
      feedback: string;
      grammarScore?: number;
      styleScore?: number;
      contentScore?: number;
    },
  ): Promise<any> {
    // 1. Policy Check (CREATE)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.CREATE,
      subject: PolicySubject.ARTICLE_QUALITY_REPORT,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    // 2. Check Article exists
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, workspaceId },
      select: { id: true, title: true },
    });

    if (!article) {
      throw new Error('Article not found');
    }

    // 3. Create Report
    const report = await this.prisma.articleQualityReport.create({
      data: {
        articleId,
        reviewerId: actor.userId,
        score: data.score,
        feedback: data.feedback,
        grammarScore: data.grammarScore,
        styleScore: data.styleScore,
        contentScore: data.contentScore,
        createdAt: new Date(),
      },
    });

    // 4. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'quality.report.create',
      resource: `ArticleQualityReport:${report.id}`,
      payload: {
        articleId,
        score: data.score,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    // 5. Publish Pub/Sub Event
    await this.publishEvent('quality.report.created', {
      articleId,
      reportId: report.id,
    });

    return report;
  }

  /**
   * Get Quality Reports
   */
  async getQualityReports(actor: any, workspaceId: number, articleId: number): Promise<any[]> {
    // 1. Policy Check (READ)
    await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.READ,
      subject: PolicySubject.ARTICLE_QUALITY_REPORT,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });

    return await this.prisma.articleQualityReport.findMany({
      where: { articleId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Helper: Publish Redis Pub/Sub Event
  private async publishEvent(type: string, payload: any) {
    const channel = 'teknav:terminal:events';
    const message = JSON.stringify({ type, payload });
    try {
      await this.redis.redis.publish(channel, message);
      this.logger.log(`Published event to channel ${channel}: ${type}`);
    } catch (error) {
      this.logger.error('Failed to publish event', error);
    }
  }
}
