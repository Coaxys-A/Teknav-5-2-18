import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../logging/audit-log.service';
import { EventBusService } from '../../../notifications/event-bus.service';

/**
 * Page Template Service
 *
 * Handles:
 * - CRUD for Article/Page templates
 * - Variable Interpolation (Apply)
 */

@Injectable()
export class PageTemplateService {
  private readonly logger = new Logger(PageTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Create Template
   */
  async createTemplate(actor: any, workspaceId: number, data: any) {
    // 1. Validate Data (Zod)
    // Assuming Zod validated at controller

    const template = await this.prisma.pageTemplate.create({
      data: {
        workspaceId,
        categoryId: data.categoryId || null,
        topicId: data.topicId || null,
        name: data.name,
        description: data.description,
        content: data.content, // JSON structure or HTML with vars
        variables: data.variables || {}, // Key-value pairs for UI
        createdBy: actor.userId,
      },
    });

    this.logger.log(`Template created: ${template.id}`);

    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'template.create',
      resource: `PageTemplate:${template.id}`,
      payload: { workspaceId, name: template.name },
    });

    await this.eventBus.publish('template.created', {
      id: template.id,
      workspaceId,
      userId: actor.userId,
    });

    return template;
  }

  /**
   * Get Template
   */
  async getTemplate(actor: any, workspaceId: number, templateId: number) {
    return await this.prisma.pageTemplate.findFirst({
      where: { id: templateId, workspaceId },
    });
  }

  /**
   * List Templates
   */
  async listTemplates(actor: any, workspaceId: number, filters: { categoryId?: number; topicId?: number }) {
    const where: any = { workspaceId };

    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.topicId) where.topicId = filters.topicId;

    return await this.prisma.pageTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update Template
   */
  async updateTemplate(actor: any, workspaceId: number, templateId: number, data: any) {
    const template = await this.prisma.pageTemplate.findFirst({
      where: { id: templateId, workspaceId },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    const updated = await this.prisma.pageTemplate.update({
      where: { id: templateId },
      data: {
        name: data.name,
        description: data.description,
        content: data.content,
        variables: data.variables,
        changedBy: actor.userId,
        changedAt: new Date(),
      },
    });

    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'template.update',
      resource: `PageTemplate:${templateId}`,
      payload: { name: data.name },
    });

    return updated;
  }

  /**
   * Delete Template
   */
  async deleteTemplate(actor: any, workspaceId: number, templateId: number) {
    const template = await this.prisma.pageTemplate.findFirst({
      where: { id: templateId, workspaceId },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    await this.prisma.pageTemplate.delete({
      where: { id: templateId },
    });

    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'template.delete',
      resource: `PageTemplate:${templateId}`,
    });

    return { success: true };
  }

  /**
   * Apply Template
   * Interpolates variables into content.
   */
  async applyTemplate(actor: any, workspaceId: number, templateId: number, context: { [key: string]: any }) {
    const template = await this.getTemplate(actor, workspaceId, templateId);

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Simple String Replace (For MVP)
    // Variables: {title}, {mainKeyword}, {audience}, {angle}
    let content = template.content;

    if (context.title) content = content.replace(/{title}/g, context.title);
    if (context.mainKeyword) content = content.replace(/{mainKeyword}/g, context.mainKeyword);
    if (context.audience) content = content.replace(/{audience}/g, context.audience);
    if (context.angle) content = content.replace(/{angle}/g, context.angle);

    return {
      content,
      variables: template.variables,
      templateName: template.name,
    };
  }
}
