import { Injectable } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BaseConsumer } from '../services/base-consumer.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueConfigService } from '../queue-config.service';
import { QueueEventsService } from '../services/queue-events.service';
import { CircuitBreakerService, Dependency } from '../services/circuit-breaker.service';
import { QuarantineService } from '../services/quarantine.service';
import { JobSlaService } from '../services/job-sla.service';
import { JobType } from '../types/job-envelope';

/**
 * Email Consumer
 * M11 - Queue Platform: "Email Jobs Processing"
 *
 * Processes:
 * - Email queue processing
 * - Email delivery via provider (SendGrid/AWS SES/etc.)
 * - Email delivery logs
 */

@Injectable()
export class EmailConsumer extends BaseConsumer {
  protected readonly DEFAULT_DEPENDENCIES: Dependency[] = [Dependency.EMAIL_PROVIDER, Dependency.REDIS];

  constructor(
    auditLog: AuditLogService,
    prisma: PrismaService,
    queueConfig: QueueConfigService,
    queueEvents: QueueEventsService,
    circuitBreaker: CircuitBreakerService,
    quarantine: QuarantineService,
    jobSla: JobSlaService,
  ) {
    super(
      JobType.EMAIL_SEND,
      auditLog,
      prisma,
      queueConfig,
      queueEvents,
      circuitBreaker,
      quarantine,
      jobSla,
    );
  }

  /**
   * Process Email Job
   */
  protected async process(job: Job<any>): Promise<any> {
    const { aiJobId, actorId, tenantId, workspaceId, entity, meta, traceId } = job.data;
    const { to, subject, html, text, templateId, variables, attachments } = meta;

    this.logger.log(`Processing Email job: ${aiJobId} (to: ${to}, subject: ${subject})`);

    // 1. Validate inputs
    if (!to || !subject) {
      throw new Error('Missing required fields: to, subject');
    }

    // 2. Get email queue record (if exists)
    const emailQueue = await this.prisma.emailQueue.findFirst({
      where: {
        tenantId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'asc' },
    });

    // 3. Generate email content (template or HTML)
    let emailContent = html;

    if (templateId && variables) {
      emailContent = await this.renderTemplate(templateId, variables);
    } else if (!html && text) {
      throw new Error('Missing HTML or text content');
    }

    // 4. Send email via provider (Circuit Breaker protected)
    const providerResult = await this.sendEmailViaProvider({
      to,
      subject,
      html: emailContent,
      text,
      attachments,
    });

    // 5. Create email log
    await this.prisma.emailLog.create({
      data: {
        tenantId,
        workspaceId,
        from: process.env.EMAIL_FROM_ADDRESS || 'noreply@teknav.com',
        to,
        subject,
        status: providerResult.success ? 'DELIVERED' : 'FAILED',
        providerId: process.env.EMAIL_PROVIDER || 'sendgrid',
        providerMessageId: providerResult.messageId,
        errorMessage: providerResult.error,
        sentAt: new Date(),
        deliveredAt: providerResult.success ? new Date() : null,
        metadata: {
          templateId,
          variables,
        },
      },
    });

    this.logger.log(`Email job completed: ${aiJobId} (provider: ${providerResult.provider})`);

    return {
      success: providerResult.success,
      provider: providerResult.provider,
      messageId: providerResult.messageId,
    };
  }

  /**
   * Render template
   */
  private async renderTemplate(templateId: string, variables: any): Promise<string> {
    // In production, this would use a template engine (Handlebars, Mustache, etc.)
    // For MVP, we'll do simple string replacement
    const template = await this.getTemplate(templateId);

    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    let rendered = template.subject || template.body || '';

    // Replace variables {{variable}}
    for (const [key, value] of Object.entries(variables)) {
      rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    }

    return rendered;
  }

  /**
   * Get template from DB
   */
  private async getTemplate(templateId: string): Promise<any> {
    // For MVP, we'll return a simple template
    // In production, this would query EmailTemplate table
    return {
      id: templateId,
      subject: 'Hello {{name}}!',
      body: '<h1>Welcome to Teknav</h1><p>Dear {{name}},</p>',
    };
  }

  /**
   * Send email via provider (simulated - would use SendGrid/AWS SES/etc.)
   */
  private async sendEmailViaProvider(params: {
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    attachments?: any[];
  }): Promise<{ success: boolean; provider: string; messageId?: string; error?: string }> {
    // In production, this would call actual email provider API
    // For MVP, we'll simulate success

    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay

    return {
      success: true,
      provider: 'sendgrid',
      messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
    };
  }

  /**
   * Update job progress for long-running operations
   */
  protected async updateProgress(
    aiJobId: number,
    current: number,
    total: number,
  ): Promise<void> {
    // Email sending is usually fast, but we can track template rendering, provider response, etc.
    await super.updateProgress(aiJobId, current, total);
  }

  /**
   * Get circuit breaker config override
   */
  protected getCircuitBreakerConfig(dep: Dependency) {
    if (dep === Dependency.EMAIL_PROVIDER) {
      return {
        failureThreshold: 10,
        resetTimeout: 180000, // 3 minutes
        halfOpenMaxCalls: 5,
      };
    }
    return {};
  }
}
