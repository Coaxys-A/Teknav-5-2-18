import { Processor, Process, OnQueueError } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { EmailService } from '../../emails/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBusService } from '../../notifications/event-bus.service';

/**
 * Email Processor
 *
 * Consumes: email-notification
 * Sends emails via SMTP.
 * Retries with backoff.
 */

@Processor('email-notification')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  @Process('email-notification')
  async handleEmail(job: Job<any>) {
    const { data } = job;
    try {
      // 1. Send Email
      await this.emailService.send({
        to: data.to,
        subject: 'Notification', // In real app, load template subject
        html: data.message,
      });

      // 2. Update EmailLog (Optional, if schema exists)
      // await this.prisma.emailLog.create({...})

      this.logger.log(`Email sent to ${data.to} for job ${job.id}`);
    } catch (error) {
      this.logger.error(`Email Job ${job.id} failed`, error);
      throw error; // Retries handled by BullMQ
    }
  }

  @OnQueueError()
  async onError(job: Job, error: Error) {
    this.logger.error(`Email Job ${job.id} error`, error);
    // BullMQ handles DLQ
  }
}
