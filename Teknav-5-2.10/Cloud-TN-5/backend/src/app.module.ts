import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { NotificationModule } from './notifications/notification.module';
import { SecurityModule } from './security/security.module';
import { BillingModule } from './billing/billing.module';
import { ArticleModule } from './articles/article.module';
import { WorkflowRuntimeModule } from './workflows/workflow-runtime.module';
import { PluginExecutionModule } from './plugins/execution/plugin-execution.module';
import { MediaModule } from './media/media.module';
import { LoggingModule } from './logging/logging.module';
import { DomainEventModule } from './events/domain-event.module'; // New
import { NewsletterModule } from './newsletter/newsletter.module'; // New
import { RequestMetadataMiddleware } from './middleware/request-metadata.middleware';
import { TenantGuard } from './core/tenant-context/tenant.middleware';
import { TenantMiddleware } from './core/tenant-context/tenant.middleware';
import { PrismaTenantMiddleware } from './core/tenant-context/prisma-tenant.middleware';
import { IpGeoInterceptor } from './security/interceptors/ip-geo.interceptor';
import { SecurityInterceptor } from './security/interceptors/security.interceptor';
import { CsrfMiddleware } from './security/csrf/csrf.middleware';
import { GlobalRateLimitMiddleware } from './security/middleware/rate-limit.middleware';
import { GlobalExceptionFilter } from './logging/filters/global-exception.filter';
import { TraceIdInterceptor } from './logging/interceptors/trace-id.interceptor';
import { QueueModule } from './queues/queue.module';

/**
 * Main App Module
 *
 * M10 - Workstream 1: "Publishing + Membership (Core Product)"
 * M10 - Workstream 4: "Newsletter Pipeline"
 * M10 - Workstream 5: "Plugin Sandbox"
 *
 * Updates:
 * - Added `DomainEventModule` (Internal Events).
 * - Added `NewsletterModule` (Newsletter Pipeline).
 * - Integrated `LogIngestService` extension.
 */

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    NotificationModule,
    SecurityModule,
    BillingModule,
    ArticleModule,
    WorkflowRuntimeModule,
    PluginExecutionModule,
    MediaModule,
    LoggingModule,
    DomainEventModule, // New
    NewsletterModule,   // New
    QueueModule,
  ],
  providers: [
    GlobalExceptionFilter,
  ],
  exports: [
    PrismaModule,
    RedisModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // 1. Request Metadata (IP, UA, Geo)
    consumer.apply(RequestMetadataMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });

    // 2. Global Rate Limiting (Per-IP and Per-User)
    consumer.apply(GlobalRateLimitMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });

    // 3. CSRF Middleware (Mutations)
    consumer.apply(CsrfMiddleware).forRoutes({
      path: ['/api/auth', '/api/admin', '/api/owner', '/api/content', '/api/workflows'],
      method: [RequestMethod.POST, RequestMethod.PATCH, RequestMethod.PUT, RequestMethod.DELETE]
    });

    // 4. Tenant Middleware (Context Propagation)
    consumer.apply(TenantMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });

    // 5. Prisma Tenant Middleware (DB Filter Injection)
    consumer.apply(PrismaTenantMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });

    // 6. IP/Geo Interceptor
    consumer.apply(IpGeoInterceptor).forRoutes({ path: '*', method: RequestMethod.ALL });

    // 7. Security Interceptor (RBAC, Rate Limit, Ban, CSRF)
    consumer.apply(SecurityInterceptor).forRoutes({ path: '*', method: RequestMethod.ALL });

    // 8. TraceId Interceptor (Correlation)
    consumer.apply(TraceIdInterceptor).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
