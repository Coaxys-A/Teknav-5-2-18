import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditLogService } from '../../audit-log.service';
import { Request } from 'express';

/**
 * Audit Interceptor
 * M0 - Architecture
 * 
 * Automatically writes AuditLog for mutating endpoints.
 */

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;

    // 1. Only Audit Mutating Methods (POST, PATCH, DELETE)
    if (
!['POST', 'PATCH', 'DELETE'].includes(method)
) {
      return next.handle();
    }

    // 2. Extract Context (M0: TenantContext)
    // Note: Assuming `TenantGuard`/`TenantMiddleware` has attached `tenantContext` to `req`.
    const tenantId = (request as any).tenantContext?.tenantId;
    const workspaceId = (request as any).tenantContext?.workspaceId;
    const userId = (request as any).tenantContext?.userId;

    return next.handle().pipe(
      tap(async (data) => {
        // 3. Write AuditLog on Success
        // Route: e.g. `POST /api/articles`
        const route = context.getClass().name + '.' + context.getHandler().name;
        const action = 'api.request'; // Generic action
        const resource = route; // Generic resource

        await this.auditLogService.logAction({
          actorUserId: userId,
          action: action,
          resource: resource,
          payload: {
            method,
            url: request.url,
            tenantId,
            workspaceId,
            statusCode: data.statusCode || 200, // If controller returns { statusCode }
          },
        });
      }),
      catchError(async (error) => {
        // 4. Write Error Log (AuditLog)
        // This is separate from the Global ExceptionFilter which logs ERROR_TRACE
        // Here we log the API request failure specifically.
        await this.auditLogService.logAction({
          actorUserId: userId,
          action: 'api.request.failed',
          resource: context.getClass().name + '.' + context.getHandler().name,
          payload: {
            method,
            url: request.url,
            error: error.message,
          },
        });
        throw error; // Re-throw
      })
    );
  }
}
