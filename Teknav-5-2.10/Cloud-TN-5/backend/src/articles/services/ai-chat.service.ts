import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { OpenRouterService } from '../../../ai/openrouter/openrouter.service';
import { QueueProducerService } from '../../../queues/queue-producer.service';
import { EventBusService } from '../../../notifications/event-bus.service';
import { AuditLogService } from '../../../logging/audit-log.service';
import { RedisService } from '../../../redis/redis.service';

/**
 * AI Chat Service
 *
 * Handles:
 * - Chat Thread Storage (Redis)
 * - Streaming Responses (SSE)
 * - Tool Actions (Rewrite, SEO, Translate, etc.)
 * - Apply Mechanism (Diff, Full, Versioning)
 */

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  private readonly THREAD_TTL = 60 * 60 * 24 * 7; // 7 days

  constructor(
    private readonly prisma: PrismaService,
    private readonly openrouter: OpenRouterService,
    private readonly queueProducer: QueueProducerService,
    private readonly eventBus: EventBusService,
    private readonly auditLog: AuditLogService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Send Message (User -> AI)
   * Stores message in thread.
   * Triggers AI response (Streaming).
   */
  async sendMessage(actor: any, workspaceId: number, articleId: number, model: string, message: string) {
    // 1. Store User Message (In Redis Thread)
    const threadKey = this.getThreadKey(articleId, actor.userId);
    const userMessage = {
      id: this.generateId(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };

    await this.appendMessage(threadKey, userMessage);

    // 2. Fetch Article Context
    const article = await this.prisma.article.findUnique({
      where: { id: articleId, workspaceId },
      select: { id: true, title: true, content: true, language: true, metadata: true },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    // 3. Call AI (Streaming logic handled by Controller/SSE)
    // For this service, we just return the "start" state.
    // The actual streaming is done in Controller using `OpenRouterService` stream method.
    this.logger.log(`User message sent for article ${articleId}`);

    return { threadId: articleId, messageId: userMessage.id };
  }

  /**
   * Execute Tool
   * Rewrites selection, generates SEO, translates, etc.
   * Enqueues AI job.
   */
  async executeTool(
    actor: any,
    workspaceId: number,
    articleId: number,
    model: string,
    tool: 'rewrite' | 'improve_seo' | 'suggest_title' | 'generate_excerpt' | 'translate_section' | 'summarize' | 'fix_tone',
    selectionRange?: { start: number; end: number },
    instructions?: string,
    targetLang?: string,
  ) {
    // 1. Fetch Article
    const article = await this.prisma.article.findUnique({
      where: { id: articleId, workspaceId },
      select: { id: true, content: true, title: true, language: true },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    // 2. Prepare Payload based on Tool
    let payload: any = { articleId, workspaceId, model };

    if (tool === 'rewrite') {
      if (!selectionRange) {
        throw new BadRequestException('Rewrite requires selection range');
      }
      payload.selection = article.content.substring(selectionRange.start, selectionRange.end);
      payload.instructions = instructions || 'Rewrite this section to be more engaging.';
    } else if (tool === 'improve_seo') {
      payload.keyword = article.title; // Simple extraction for MVP
      payload.instructions = instructions || 'Improve SEO for this article.';
    } else if (tool === 'suggest_title') {
      payload.content = article.content;
      payload.instructions = 'Suggest a better title.';
    } else if (tool === 'generate_excerpt') {
      payload.content = article.content;
      payload.instructions = 'Generate a compelling excerpt.';
    } else if (tool === 'translate_section') {
      if (!selectionRange) {
        throw new BadRequestException('Translation requires selection range');
      }
      payload.section = article.content.substring(selectionRange.start, selectionRange.end);
      payload.sourceLang = article.language || 'en';
      payload.targetLang = targetLang || 'en';
    } else if (tool === 'summarize') {
      payload.content = article.content;
    } else if (tool === 'fix_tone') {
      if (!selectionRange) {
        throw new BadRequestException('Tone fix requires selection range');
      }
      payload.selection = article.content.substring(selectionRange.start, selectionRange.end);
      payload.instructions = 'Fix the tone to be professional.';
    }

    // 3. Store Tool Request in Thread (Redis)
    const threadKey = this.getThreadKey(articleId, actor.userId);
    const toolMessage = {
      id: this.generateId(),
      role: 'ai',
      tool,
      timestamp: new Date().toISOString(),
    };
    await this.appendMessage(threadKey, toolMessage);

    // 4. Enqueue AI Job (To process in background and stream result)
    // We use `ai-content` queue.
    const job = await this.queueProducer.enqueueAiContent(actor, {
      articleId,
      workspaceId,
      model,
      promptTemplateId: 1, // Generic ID
      priority: 10, // Higher priority
    });

    this.logger.log(`Tool ${tool} executed for article ${articleId}, job ${job.id}`);

    // 5. Publish Event
    await this.eventBus.publish('teknav:articles:events', {
      id: `tool-${articleId}-${Date.now()}`,
      type: 'article.ai.tool.executed',
      workspaceId,
      articleId,
      tool,
      payload: toolMessage,
    });

    return { jobId: job.id, toolMessageId: toolMessage.id };
  }

  /**
   * Apply Change
   * Applies AI result to article.
   * Supports: Full Replacement, Selection Replacement.
   * Auto-creates version.
   */
  async applyChange(
    actor: any,
    workspaceId: number,
    articleId: number,
    result: { content: string; meta?: any },
    mode: 'full' | 'selection',
    selection?: { start: number; end: number },
  ) {
    // 1. Fetch Article
    const article = await this.prisma.article.findUnique({
      where: { id: articleId, workspaceId },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    // 2. Create Version Snapshot (Before applying change)
    const snapshot = await this.prisma.articleVersion.create({
      data: {
        articleId,
        versionTitle: article.title,
        content: article.content,
        excerpt: article.excerpt,
        status: article.status,
        createdById: actor.userId,
        createdAt: new Date(),
      },
    });

    this.logger.log(`Version snapshot created: ${snapshot.id}`);

    // 3. Apply Change
    let newContent = article.content;

    if (mode === 'full') {
      newContent = result.content;
    } else if (mode === 'selection') {
      if (!selection) {
        throw new BadRequestException('Selection mode requires selection range');
      }
      const prefix = article.content.substring(0, selection.start);
      const suffix = article.content.substring(selection.end);
      newContent = prefix + result.content + suffix;
    }

    // 4. Update Article
    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        content: newContent,
        changedBy: actor.userId,
        changedAt: new Date(),
        metadata: result.meta ? { ...article.metadata, ...result.meta } : article.metadata,
      },
    });

    // 5. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'article.ai.apply',
      resource: `Article:${articleId}`,
      payload: {
        snapshotId: snapshot.id,
        mode,
        selection,
      },
    });

    // 6. Publish Event
    await this.eventBus.publish('teknav:articles:events', {
      id: articleId,
      type: 'article.ai.apply',
      workspaceId,
      userId: actor.userId,
    });

    return updated;
  }

  /**
   * Stream Response (SSE)
   * Wrapper to OpenRouter stream.
   */
  async streamResponse(articleId: number, model: string, prompt: string) {
    return await this.openrouter.streamContent({
      model,
      prompt,
    });
  }

  /**
   * Helpers
   */
  private getThreadKey(articleId: number, userId: number): string {
    return `${this.REDIS_PREFIX}:article:ai:thread:${articleId}:${userId}`;
  }

  private async appendMessage(key: string, message: any) {
    // Use RPUSH for append
    await this.redis.redis.rpush(key, JSON.stringify(message));
    await this.redis.redis.expire(key, this.THREAD_TTL);
  }

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}
