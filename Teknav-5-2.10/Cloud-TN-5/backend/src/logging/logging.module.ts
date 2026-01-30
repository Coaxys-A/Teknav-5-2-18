import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { LogIngestService } from './services/log-ingest.service';
import { AuditLogService } from './audit-log.service';
import { ExportService } from './services/export.service';
import { OwnerLogsController } from './owner-logs.controller';
import { HealthController } from './health.controller';
import { RedisModule } from '../redis/redis.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notifications/notification.module';

/**
 * Logging Module
 * M0 - Architecture Contracts
 * 
 * Centralizes:
 * - LoggerService (Structured logs)
 * - LogIngestService (DB writes via AuditLog, DataAccessLog, etc.)
 * - Interceptors (Audit, TraceId)
 * - Exports
 * - Health Check
 */

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    NotificationModule,
  ],
  providers: [
    LogIngestService,
    AuditLogService,
    ExportService,
  ],
  controllers: [
    OwnerLogsController,
    HealthController,
  ],
  exports: [
    LogIngestService,
    AuditLogService,
    ExportService,
  ],
})
export class LoggingModule {
  configure(consumer: MiddlewareConsumer) {
    // Interceptors are usually applied globally in AppModule or via APP_INTERCEPTOR in this module.
    // We apply them globally in AppModule to ensure M0 coverage.
  }
}
