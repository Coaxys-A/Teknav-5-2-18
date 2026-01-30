import { Processor, Process, OnQueueActive, OnQueueError, OnQueueWaiting } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { OpenRouterService } from '../../ai/openrouter/openrouter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBusService } from '../../notifications/event-bus.service';
import { RedisService } from '../../redis/redis.service';
import { QueueRegistryService } from '../queue-registry.service';
import * as Schemas from '../dto/job-schemas';

/**
 * AI Processor
 *
 * Consumes: ai-content, ai-seo, ai-translation
 */

@Processor('ai-content')
export class AiContentProcessor {
  private readonly logger = new Logger(AiContentProcessor.name);

  constructor(
    private readonly openrouter: OpenRouterService,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly redis: RedisService,
  ) {}

  @Process('ai-content')
  async handleAiContent(job: Job<any>) {
    const { data } = job;
    try {
      // 1. Fetch Article
      const article = await this.prisma.article.findUnique({
        where: { id: data.articleId },
      });
      if (!article) throw new Error('Article not found');

      // 2. Call AI Service
      const result = await this.openrouter.generateContent({
        model: data.model,
        prompt: article.content || '',
      });

      // 3. Store Result
      await this.prisma.aiRun.create({
        data: {
          articleId: data.articleId,
          workspaceId: data.workspaceId,
          model: data.model,
          status: 'COMPLETED',
          result: result.content,
        },
      });

      this.logger.log(`AI Content Job ${job.id} completed`);
    } catch (error) {
      this.logger.error(`AI Content Job ${job.id} failed`, error);
      await this.prisma.aiRun.create({
        data: {
          articleId: data.articleId,
          workspaceId: data.workspaceId,
          model: data.model,
          status: 'FAILED',
          error: error.message,
        },
      });
      throw error; // Move to DLQ if retries exhausted
    }
  }
}

@Processor('ai-seo')
export class AiSeoProcessor {
  private readonly logger = new Logger(AiSeoProcessor.name);

  constructor(
    private readonly openrouter: OpenRouterService,
    private readonly prisma: PrismaService,
  ) {}

  @Process('ai-seo')
  async handleAiSeo(job: Job<any>) {
    const { data } = job;
    try {
      // 1. Generate Keywords/Meta
      const article = await this.prisma.article.findUnique({
        where: { id: data.articleId },
      });
      if (!article) throw new Error('Article not found');

      const keywords = await this.openrouter.generateKeywords({
        model: data.model,
        content: article.content,
      });

      // 2. Update Article
      await this.prisma.article.update({
        where: { id: data.articleId },
        data: {
          metadata: {
            ...article.metadata,
            keywords: keywords.map(k => k.keyword),
          },
        },
      });

      this.logger.log(`AI SEO Job ${job.id} completed`);
    } catch (error) {
      this.logger.error(`AI SEO Job ${job.id} failed`, error);
      throw error;
    }
  }
}

@Processor('ai-translation')
export class AiTranslationProcessor {
  private readonly logger = new Logger(AiTranslationProcessor.name);

  constructor(
    private readonly openrouter: OpenRouterService,
    private readonly prisma: PrismaService,
  ) {}

  @Process('ai-translation')
  async handleAiTranslation(job: Job<any>) {
    const { data } = job;
    try {
      const article = await this.prisma.article.findUnique({
        where: { id: data.articleId },
        select: { content: true },
      });
      if (!article) throw new Error('Article not found');

      const translated = await this.openrouter.translateContent({
        model: data.model,
        text: article.content,
        targetLang: data.targetLang,
      });

      await this.prisma.article.update({
        where: { id: data.articleId },
        data: {
          content: translated.content,
        },
      });

      this.logger.log(`AI Translation Job ${job.id} completed`);
    } catch (error) {
      this.logger.error(`AI Translation Job ${job.id} failed`, error);
      throw error;
    }
  }
}
