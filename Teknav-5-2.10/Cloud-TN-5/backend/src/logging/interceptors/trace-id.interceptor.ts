import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';

/**
 * TraceId Interceptor
 * M0 - Architecture
 * 
 * Generades traceId per request if missing.
 * Attaches traceId to req context.
 */

@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    
    // 1. Generate or Reuse TraceId
    // From Request Headers (Distributed Tracing) or Generate
    let traceId = request.headers['x-trace-id'] || request.headers['x-request-id'] || request.headers['x-vercel-id'];
    if (!traceId) {
      traceId = randomUUID();
    }

    // 2. Attach to Request (M0 Context)
    (request as any).traceId = traceId;

    // 3. Add Response Header
    // We can't set header here directly in interceptor for nestjs easily without modifying response.
    // But we can attach it to `request` object for other interceptors/services to use.
    // Ideally, `response.setHeader('x-trace-id', traceId)` happens in a separate interceptor or controller.

    return next.handle();
  }
}
