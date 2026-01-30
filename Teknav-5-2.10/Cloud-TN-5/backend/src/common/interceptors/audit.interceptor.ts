import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { AuditLogService } from '../../logging/audit-log.service';

/**
 * Audit Interceptor
 *
 * Logs actions to AuditLog table.
 * Decorator @Audit(action) can be used on controllers/services.
 */

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly auditLog: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const handler = context.getHandler();
    const metadata = Reflect.getMetadata('audit', handler);

    const request = context.switchToHttp().getRequest<Request>();
    const startTime = Date.now();

    return next.handle().pipe(
      tap(async (result) => {
        // If metadata exists, log it
        if (metadata && metadata.action) {
          const duration = Date.now() - startTime;
          const actorId = request.user?.id;

          if (!actorId) {
            this.logger.warn('AuditInterceptor: User not found in request');
            return;
          }

          // Build resource string
          const resourceType = metadata.resourceType || 'Unknown';
          const resourceId = metadata.resourceId || request.params?.id || request.body?.id || '0';

          await this.auditLog.logAction({
            actorUserId: actorId,
            action: metadata.action, // e.g., "article.create", "article.update"
            resource: `${resourceType}:${resourceId}`,
            payload: {
              method: request.method,
              path: request.path,
              query: request.query,
              duration,
              success: true,
            },
          });
        }
      }),
    );
  }
}
