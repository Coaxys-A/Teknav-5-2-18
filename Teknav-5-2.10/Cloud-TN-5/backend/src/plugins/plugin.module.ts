import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PluginService } from './services/plugin.service';
import { PluginStorageService } from './services/plugin-storage.service';
import { PluginSecurityService } from './services/plugin-security.service';
import { PluginPermissionService } from './services/plugin-permission.service';
import { RateLimitService } from './services/rate-limit.service';
import { PluginEventPipelineService } from './services/plugin-event-pipeline.service';
import { PluginWasmSandboxService } from './services/plugin-wasm-sandbox.service';
import { PluginAnalyticsService } from './services/plugin-analytics.service';
import { OwnerPluginController } from './controllers/owner-plugin.controller';
import { OwnerPluginPermissionsController } from './controllers/owner-plugin-permissions.controller';
import { OwnerPluginSettingsController } from './controllers/owner-plugin-settings.controller';
import { OwnerPluginLogsController } from './controllers/owner-plugin-logs.controller';
import { PluginWorkerConsumer } from './workers/plugin-worker.consumer';
import { QueueModule } from '../queue/queue.module';

/**
 * Plugin Module (COMPLETE)
 * PART 12 - Plugin Platform: "Marketplace + Install/Upgrade/Rollback + Permissions Matrix + Signing Enforcement + WASM Sandbox Hardening + Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 *
 * Ties together:
 * - All plugin services (CRUD, Storage, Security, Permissions, Rate Limits, Event Pipeline, WASM Sandbox, Analytics)
 * - All plugin controllers (Marketplace, Versioning, Installations, Permissions, Settings, Secrets, Logs)
 * - Plugin Worker Consumer (BullMQ hook execution)
 * - Integration with Queue Module (for hook dispatch)
 */

@Module({
  imports: [
    QueueModule, // For hook dispatch via plugins queue
  ],
  controllers: [
    OwnerPluginController,
    OwnerPluginPermissionsController,
    OwnerPluginSettingsController,
    OwnerPluginLogsController,
  ],
  providers: [
    // Services
    PluginService,
    PluginStorageService,
    PluginSecurityService,
    PluginPermissionService,
    RateLimitService,
    PluginEventPipelineService,
    PluginWasmSandboxService,
    PluginAnalyticsService,
    // Worker Consumer (registered in Queue Module)
  ],
  exports: [
    PluginService,
    PluginStorageService,
    PluginSecurityService,
    PluginPermissionService,
    RateLimitService,
    PluginEventPipelineService,
    PluginWasmSandboxService,
    PluginAnalyticsService,
  ],
})
export class PluginModule {}
