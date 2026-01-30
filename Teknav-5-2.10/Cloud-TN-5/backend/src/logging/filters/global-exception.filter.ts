import { ExceptionFilter, Catch, ArgumentsHost, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { AuditLogService } from '../../audit-log.service';

/**
 * Global Exception Filter
 * M0 - Architecture: "Error Traces"
 * 
 * Captures stack traces.
 * Writes AuditLog entry with action ERROR_TRACE.
 */

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly auditLogService: AuditLogService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    // 1. Generate TraceId (If missing)
    // Assuming `TraceIdInterceptor` ran before.
    const traceId = (request as any).traceId || 'unknown';

    // 2. Determine Status Code
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // 3. Log to Console
    this.logger.error(
      `[${traceId}] ${exception instanceof Error ? exception.message : 'Unknown Error'}`,
      exception instanceof Error ? exception.stack : exception,
    );

    // 4. Write to AuditLog (M5 Requirement: "Error Traces")
    await this.auditLogService.logAction({
      actorUserId: (request as any).tenantContext?.userId || 0, // System
      action: 'error.trace',
      resource: 'System',
      payload: {
        traceId,
        errorName: exception instanceof Error ? exception.constructor.name : 'Unknown',
        message: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : '',
        statusCode: status,
        context: {
          path: request.url,
          method: request.method,
        },
      },
    });

    // 5. Return Standard Error Response
    // Frontend expects this format.
    response.status(status).json({
      code: 'SERVER_ERROR',
      message: 'An unexpected error occurred',
      requestId: traceId,
      // Don't send stack to client (Security)
    });
  }
}
