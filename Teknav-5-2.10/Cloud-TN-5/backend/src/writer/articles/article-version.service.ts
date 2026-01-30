import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PolicyAction, PolicySubject } from '../../security/policy/policy.types';
import { PolicyEngineService } from '../../security/policy/policy.engine.service';
import { AuditLogService } from '../../logging/audit-log.service';

/**
 * Article Versioning Service
 *
 * Handles:
 * - Create immutable version on update
 * - List versions
 * - Revert to version (creates NEW version)
 */

@Injectable()
export class ArticleVersionService {
  private readonly logger = new Logger(ArticleVersionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyEngine: PolicyEngineService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Create Version
   * Called internally by WriterArticleService on every meaningful update.
   */
  async createVersion(
    actor: any,
    workspaceId: number,
    articleId: number,
  ): Promise<any> {
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

    // 2. Fetch Article Snapshot
    const article = await this.prisma.article.findUnique({
      where: { id: articleId, workspaceId },
      select: {
        id: true,
        title: true,
        content: true,
        excerpt: true,
        categoryId: true,
        status: true,
        updatedAt: true,
      },
    });

    if (!article) {
      throw new Error('Article not found');
    }

    // 3. Determine Next Version Number
    const lastVersion = await this.prisma.articleVersion.findFirst({
      where: { articleId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const nextVersionNumber = lastVersion ? lastVersion.versionNumber + 1 : 1;

    // 4. Create Version Record
    const version = await this.prisma.articleVersion.create({
      data: {
        articleId,
        versionNumber: nextVersionNumber,
        snapshot: JSON.stringify(article), // Store snapshot as JSON
        updatedBy: actor.userId,
        updatedAt: article.updatedAt,
      },
    });

    // 5. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.version.create',
      resource: `ArticleVersion:${version.id}`,
      payload: {
        articleId,
        versionNumber: nextVersionNumber,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    return version;
  }

  /**
   * Get Versions
   */
  async getVersions(actor: any, workspaceId: number, articleId: number): Promise<any[]> {
    // Policy Check (READ)
    await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.READ,
      subject: PolicySubject.ARTICLE,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });

    return await this.prisma.articleVersion.findMany({
      where: { articleId },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        updatedAt: true,
        updatedBy: true,
      },
    });
  }

  /**
   * Revert Version
   * Creates a NEW version from the snapshot of the target version.
   * Never overwrites directly.
   */
  async revertVersion(
    actor: any,
    workspaceId: number,
    articleId: number,
    versionId: number,
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

    // 2. Fetch Target Version
    const targetVersion = await this.prisma.articleVersion.findFirst({
      where: {
        id: versionId,
        articleId,
      },
    });

    if (!targetVersion) {
      throw new Error('Target version not found');
    }

    // 3. Parse Snapshot
    const snapshot = JSON.parse(targetVersion.snapshot);

    // 4. Update Article with Snapshot Data
    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        title: snapshot.title,
        content: snapshot.content,
        excerpt: snapshot.excerpt,
        categoryId: snapshot.categoryId,
        status: snapshot.status, // Revert status too? Or keep current? Usually content revert.
        // Requirement: "Revert creates a NEW version".
        // So we update the Article to the snapshot state, and create a NEW version pointing to *this* new update.
        updatedAt: new Date(),
      },
    });

    // 5. Create New Version (of this revert)
    const nextVersionNumber = targetVersion.versionNumber + 1;
    const newVersion = await this.prisma.articleVersion.create({
      data: {
        articleId,
        versionNumber: nextVersionNumber,
        snapshot: JSON.stringify({
          id: updated.id,
          title: updated.title,
          content: updated.content,
          excerpt: updated.excerpt,
          categoryId: updated.categoryId,
          status: updated.status,
          updatedAt: updated.updatedAt,
        }),
        updatedBy: actor.userId,
        updatedAt: updated.updatedAt,
      },
    });

    // 6. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.version.revert',
      resource: `Article:${articleId}`,
      payload: {
        fromVersionId: versionId,
        toVersionId: newVersion.id,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    return updated;
  }
}
