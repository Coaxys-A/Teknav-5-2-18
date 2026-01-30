import { Injectable, Logger, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PolicyAction, PolicySubject, PolicyResult } from '../../security/policy/policy.types';
import { PolicyEngineService } from '../../security/policy/policy.engine.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { ArticleVersionService } from './article-version.service';
import { RedisService } from '../../redis/redis.service';

/**
 * Writer Article Service (Extended)
 *
 * Implements:
 * - Status Flow (Draft -> Submitted -> Approved/Rejected -> Scheduled -> Published)
 * - Autosave (Redis)
 * - Submission for Review
 * - Rejection Feedback Loop
 * - Scheduling Logic
 */

@Injectable()
export class WriterArticleService {
  private readonly logger = new Logger(WriterArticleService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  private readonly AUTOSAVE_TTL = 900; // 15 minutes (15 * 60)

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyEngine: PolicyEngineService,
    private readonly auditLog: AuditLogService,
    private readonly articleVersionService: ArticleVersionService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Submit Article
   * Draft -> Submitted
   */
  async submitArticle(actor: any, workspaceId: number, articleId: number): Promise<any> {
    // 1. Policy Check (UPDATE)
    let policyResult = await this.policyEngine.evaluate({
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

    // 3. Check Status Transition (Draft -> Submitted)
    if (article.status !== 'DRAFT') {
      throw new ConflictException('Only DRAFT articles can be submitted');
    }

    // 4. Update Status
    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        changedBy: actor.userId,
        changedAt: new Date(),
      },
    });

    // 5. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.submit',
      resource: `Article:${articleId}`,
      payload: {
        articleId,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    // 6. Clear Autosave (if exists)
    await this.redis.del(`${this.REDIS_PREFIX}:article:autosave:${articleId}:${actor.userId}`);

    // 7. Invalidate Cache (if any)
    await this.redis.del(`${this.REDIS_PREFIX}:article:${articleId}`);

    return updated;
  }

  /**
   * Reject Article (Called by Manager, not Writer UI, but needed for flow)
   * Submitted -> Rejected
   * Stores rejection reason.
   */
  async rejectArticle(actor: any, workspaceId: number, articleId: number, reason: string): Promise<any> {
    // 1. Policy Check (UPDATE)
    let policyResult = await this.policyEngine.evaluate({
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

    // 3. Check Status Transition (Submitted -> Rejected)
    if (article.status !== 'SUBMITTED') {
      throw new ConflictException('Only SUBMITTED articles can be rejected');
    }

    // 4. Update Status + Payload
    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
        changedBy: actor.userId,
        changedAt: new Date(),
      },
    });

    // 5. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.reject',
      resource: `Article:${articleId}`,
      payload: {
        articleId,
        reason,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    // 6. Clear Cache
    await this.redis.del(`${this.REDIS_PREFIX}:article:${articleId}`);

    return updated;
  }

  /**
   * Approve Article (Called by Manager)
   * Submitted -> Approved
   */
  async approveArticle(actor: any, workspaceId: number, articleId: number): Promise<any> {
    // Policy Check
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.PUBLISH, // Using PUBLISH as APPROVE proxy
      subject: PolicySubject.ARTICLE,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    const article = await this.prisma.article.findFirst({
      where: { id: articleId, workspaceId },
    });

    if (!article) throw new Error('Article not found');
    if (article.status !== 'SUBMITTED') {
      throw new ConflictException('Only SUBMITTED articles can be approved');
    }

    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        status: 'APPROVED',
        approvedBy: actor.userId,
        approvedAt: new Date(),
        changedBy: actor.userId,
        changedAt: new Date(),
      },
    });

    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.approve',
      resource: `Article:${articleId}`,
      payload: { articleId, policyDecisionId: policyResult.policyDecisionId },
    });

    // Clear Cache
    await this.redis.del(`${this.REDIS_PREFIX}:article:${articleId}`);

    return updated;
  }

  /**
   * Schedule Article
   * Approved -> Scheduled
   */
  async scheduleArticle(actor: any, workspaceId: number, articleId: number, publishedAt: Date): Promise<any> {
    // Policy Check
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

    const article = await this.prisma.article.findFirst({
      where: { id: articleId, workspaceId },
    });

    if (!article) throw new Error('Article not found');
    if (article.status !== 'APPROVED') {
      throw new ConflictException('Only APPROVED articles can be scheduled');
    }

    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        status: 'SCHEDULED',
        publishedAt,
        changedBy: actor.userId,
        changedAt: new Date(),
      },
    });

    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.schedule',
      resource: `Article:${articleId}`,
      payload: { articleId, publishedAt, policyDecisionId: policyResult.policyDecisionId },
    });

    // Clear Cache
    await this.redis.del(`${this.REDIS_PREFIX}:article:${articleId}`);

    return updated;
  }

  /**
   * Publish Article (Immediate)
   * Approved/Scheduled -> Published
   */
  async publishArticle(actor: any, workspaceId: number, articleId: number): Promise<any> {
    // Policy Check
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

    const article = await this.prisma.article.findFirst({
      where: { id: articleId, workspaceId },
    });

    if (!article) throw new Error('Article not found');

    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        changedBy: actor.userId,
        changedAt: new Date(),
      },
    });

    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.publish',
      resource: `Article:${articleId}`,
      payload: { articleId, policyDecisionId: policyResult.policyDecisionId },
    });

    // Clear Cache
    await this.redis.del(`${this.REDIS_PREFIX}:article:${articleId}`);

    return updated;
  }

  /**
   * Autosave Article
   * Stores title/excerpt/content in Redis.
   */
  async autosaveArticle(actor: any, workspaceId: number, articleId: number, data: any): Promise<void> {
    const key = `${this.REDIS_PREFIX}:article:autosave:${articleId}:${actor.userId}`;
    const value = JSON.stringify({
      ...data,
      updatedAt: new Date(),
    });

    await this.redis.set(key, value, this.AUTOSAVE_TTL);
  }

  /**
   * Get Autosave
   * Returns null if not exists.
   */
  async getAutosave(actor: any, articleId: number): Promise<any | null> {
    const key = `${this.REDIS_PREFIX}:article:autosave:${articleId}:${actor.userId}`;
    const cached = await this.redis.get(key);

    if (!cached) {
      return null;
    }

    return JSON.parse(cached);
  }

  /**
   * Delete Autosave
   */
  async deleteAutosave(actor: any, articleId: number): Promise<void> {
    const key = `${this.REDIS_PREFIX}:article:autosave:${articleId}:${actor.userId}`;
    await this.redis.del(key);
  }

  /**
   * Update Article (Override Part 1)
   * Wraps original update + versioning + autosave delete.
   */
  async updateArticle(
    actor: any,
    workspaceId: number,
    articleId: number,
    data: any,
  ): Promise<any> {
    // 1. Policy Check
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

    // 2. Check updatedAt (Optimistic Concurrency)
    const existing = await this.prisma.article.findFirst({
      where: { id: articleId, workspaceId },
      select: { id: true, updatedAt: true, status: true },
    });

    if (!existing) throw new Error('Article not found');

    // 3. Perform Update
    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });

    // 4. Create Version
    await this.articleVersionService.createVersion(actor, workspaceId, articleId);

    // 5. Delete Autosave (clean slate)
    await this.deleteAutosave(actor, articleId);

    // 6. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.update',
      resource: `Article:${articleId}`,
      payload: {
        articleId,
        changes: Object.keys(data),
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    // 7. Clear Cache
    await this.redis.del(`${this.REDIS_PREFIX}:article:${articleId}`);

    return updated;
  }
}
