import { Processor, Process, OnQueueError } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventBusService } from '../../../notifications/event-bus.service';

/**
 * Media Processor
 *
 * Handles: resize, compress, optimize, thumbnail
 */

@Processor('media-processing')
export class MediaProcessor {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  @Process('media-processing')
  async handleMedia(job: Job<any>) {
    const { data } = job;
    const { fileId, workspaceId, operation, options } = data;

    try {
      this.logger.log(`Processing Media ${fileId}: ${operation}`);

      const file = await this.prisma.file.findUnique({
        where: { id: fileId, workspaceId },
      });

      if (!file) {
        throw new Error('File not found');
      }

      let result;
      
      if (operation === 'resize') {
        // Stub: Real logic would use Sharp/ImageMagick
        result = { original: file.url, resized: `${file.url}?w=800` };
        await this.prisma.file.update({
          where: { id: fileId },
          data: { metadata: { ...file.metadata, resize: result.resized } },
        });
      } else if (operation === 'thumbnail') {
        result = { thumbnail: `${file.url}?t=thumb` };
        await this.prisma.file.update({
          where: { id: fileId },
          data: { thumbnail: result.thumbnail },
        });
      } else if (operation === 'compress') {
        result = { compressed: `${file.url}?c=1` };
        await this.prisma.file.update({
          where: { id: fileId },
          data: { metadata: { ...file.metadata, compressed: true } },
        });
      } else {
        throw new Error(`Unsupported operation: ${operation}`);
      }

      this.logger.log(`Media Job ${job.id} completed`);
    } catch (error) {
      this.logger.error(`Media Job ${job.id} failed`, error);
      throw error;
    }
  }

  @OnQueueError()
  async onError(job: Job, error: Error) {
    this.logger.error(`Media Job ${job.id} error`, error);
  }
}
