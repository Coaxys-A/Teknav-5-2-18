import { Processor, Process, OnQueueError } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PluginExecutionService } from '../../plugins/execution/plugin-execution.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventBusService } from '../../../notifications/event-bus.service';
import { QueueRegistryService } from '../queue-registry.service';
import * as Schemas from '../dto/job-schemas';

/**
 * Plugin Processor
 * 
 * Consumes: plugin-execution
 * Executes plugins in WASM sandbox.
 */

@Processor('plugin-execution')
export class PluginProcessor {
  private readonly logger = new Logger(PluginProcessor.name);

  constructor(
    private readonly pluginService: PluginExecutionService,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly registry: QueueRegistryService,
  ) {}

  @Process('plugin-execution')
  async handlePlugin(job: Job<any>) {
    const { data } = job;
    try {
      this.logger.log(`Processing plugin job ${job.id} for ${data.eventType}`);

      if (data.eventType === 'run') {
        // 1. Execute Plugin
        const result = await this.pluginService.execute(data.pluginId, data.workspaceId, data.payload);

        // 2. Log Execution
        await this.prisma.pluginExecutionLog.create({
          data: {
            pluginId: data.pluginId,
            workspaceId: data.workspaceId,
            status: 'SUCCESS',
            output: JSON.stringify(result),
          },
        });

        // 3. Update Plugin Status
        if (data.payload?.updateStatus) {
          await this.prisma.plugin.update({
            where: { id: data.pluginId },
            data: { status: 'ACTIVE' }, // Assuming run moves it to active
          });
        }
      } else if (data.eventType === 'delete') {
        await this.pluginService.remove(data.pluginId, data.workspaceId);
      }

      this.logger.log(`Plugin job ${job.id} completed`);
    } catch (error) {
      this.logger.error(`Plugin job ${job.id} failed`, error);

      // 4. Log Failure
      await this.prisma.pluginExecutionLog.create({
        data: {
          pluginId: data.pluginId,
          workspaceId: data.workspaceId,
          status: 'FAILED',
          error: error.message,
        },
      });

      throw error; // BullMQ handles retries
    }
  }

  @OnQueueError()
  async onError(job: Job, error: Error) {
    this.logger.error(`Plugin job ${job.id} error`, error);
  }
}
