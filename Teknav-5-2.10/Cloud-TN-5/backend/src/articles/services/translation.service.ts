import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueueProducerService } from '../../../queues/queue-producer.service';
import { EventBusService } from '../../../notifications/event-bus.service';
import { AuditLogService } from '../../../logging/audit-log.service';
import { RedisService } from '../../../redis/redis.service';

/**
 * Article Translation Service
 *
 * Handles:
 * - Matrix View (Locales x Article)
 * - AI Translation (Queue)
 * - Human Review/Edit
 * - Publish Translation
 */

@Injectable()
export class ArticleTranslationService {
  private readonly logger = new Logger(ArticleTranslationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueProducer: QueueProducerService,
    private readonly eventBus: EventBusService,
    private readonly auditLog: AuditLogService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Get Matrix (Locales x Article)
   */
  async getTranslationMatrix(actor: any, workspaceId: number, articleId: number) {
    // 1. Fetch Article (Source)
    const article = await this.prisma.article.findUnique({
      where: { id: articleId, workspaceId },
      select: { id: true, title: true, language: true, content: true },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    // 2. Fetch Translations
    // Assuming `ArticleTranslation` model exists
    const translations = await this.prisma.articleTranslation.findMany({
      where: { articleId },
    });

    // 3. Group by Locale
    const matrix = translations.reduce((acc: any, t: any) => {
      acc[t.locale] = t;
      return acc;
    }, {});

    return {
      source: article,
      translations: matrix,
    };
  }

  /**
   * AI Translate (Target Locale)
   * Enqueues `ai-translation` job.
   */
  async aiTranslate(
    actor: any,
    workspaceId: number,
    articleId: number,
    targetLang: string,
  ) {
    const article = await this.prisma.article.findUnique({
      where: { id: articleId, workspaceId },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    // 1. Create Translation Entry (DRAFT)
    const translation = await this.prisma.articleTranslation.create({
      data: {
        articleId,
        locale: targetLang,
        status: 'DRAFT',
        createdBy: actor.userId,
      },
    });

    this.logger.log(`Translation draft created: ${translation.id} (${targetLang})`);

    // 2. Enqueue Job
    const job = await this.queueProducer.enqueueAiTranslation(actor, {
      articleId,
      workspaceId,
      targetLang,
      sourceLang: article.language || 'en',
    });

    // 3. Update Translation with Job ID
    await this.prisma.articleTranslation.update({
      where: { id: translation.id },
      data: {
        jobId: job.id,
      },
    });

    // 4. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.translation.ai',
      resource: `Article:${articleId}:Translation:${translation.id}`,
      payload: { targetLang, jobId: job.id },
    });

    return { translation, job };
  }

  /**
   * Human Edit Translation
   */
  async humanEdit(
    actor: any,
    workspaceId: number,
    translationId: number,
    content: string,
    title?: string,
  ) {
    const translation = await this.prisma.articleTranslation.findFirst({
      where: { id: translationId, article: { workspaceId } },
    });

    if (!translation) {
      throw new NotFoundException('Translation not found');
    }

    const updated = await this.prisma.articleTranslation.update({
      where: { id: translationId },
      data: {
        title: title || translation.title,
        content,
        status: 'READY_FOR_PUBLISH',
        changedBy: actor.userId,
        changedAt: new Date(),
      },
    });

    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.translation.edit',
      resource: `ArticleTranslation:${translationId}`,
      payload: { title, length: content.length },
    });

    return updated;
  }

  /**
   * Publish Translation
   * Updates `ArticleTranslation.status` to `PUBLISHED`.
   * Syncs `SearchDocument` (Stubbed).
   */
  async publishTranslation(actor: any, workspaceId: number, translationId: number) {
    const translation = await this.prisma.articleTranslation.findFirst({
      where: { id: translationId, article: { workspaceId } },
      include: { article: true },
    });

    if (!translation) {
      throw new NotFoundException('Translation not found');
    }

    const updated = await this.prisma.articleTranslation.update({
      where: { id: translationId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishedBy: actor.userId,
      },
    });

    // 2. Sync SearchDocument (Stubbed)
    // await this.searchService.upsert({
    //   articleId: translation.articleId,
    //   locale: translation.locale,
    //   content: translation.content,
    // })

    // 3. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.translation.publish',
      resource: `ArticleTranslation:${translationId}`,
      payload: { locale: translation.locale },
    });

    return updated;
  }

  /**
   * Sync from Source
   * Regenerates draft translation but preserves human overrides if flagged.
   */
  async syncFromSource(
    actor: any,
    workspaceId: number,
    articleId: number,
    targetLocale: string,
  ) {
    // 1. Fetch Source Article
    const article = await this.prisma.article.findUnique({
      where: { id: articleId, workspaceId },
      select: { id: true, content: true, title: true },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    // 2. Fetch Existing Translation
    const existing = await this.prisma.articleTranslation.findFirst({
      where: { articleId, locale: targetLocale },
    });

    // 3. Create/Update Translation
    // Preserve overrides? For MVP, we just overwrite.
    // In real app, we would parse existing content and merge.
    if (existing) {
      const updated = await this.prisma.articleTranslation.update({
        where: { id: existing.id },
        data: {
          title: article.title,
          content: article.content,
          status: 'READY_FOR_PUBLISH',
          changedBy: actor.userId,
          changedAt: new Date(),
        },
      });
      return updated;
    } else {
      const created = await this.prisma.articleTranslation.create({
        data: {
          articleId,
          locale: targetLocale,
          title: article.title,
          content: article.content,
          status: 'READY_FOR_PUBLISH',
          createdBy: actor.userId,
        },
      });
      return created;
    }
  }

  /**
   * Get Translation Detail
   */
  async getTranslation(actor: any, workspaceId: number, translationId: number) {
    return await this.prisma.articleTranslation.findFirst({
      where: { id: translationId, article: { workspaceId } },
      include: {
        article: {
          select: { id: true, title: true, language: true, content: true },
        },
      },
    });
  }
}
