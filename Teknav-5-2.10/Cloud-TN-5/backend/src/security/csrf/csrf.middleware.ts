import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { CsrfService } from './csrf.service';
import { AuditLogService } from '../../../logging/audit-log.service';

/**
 * CSRF Guard (Middleware)
 * Applied to sensitive routes.
 * Enforces x-csrf-token header.
 */

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(
    private readonly csrfService: CsrfService,
    private readonly auditLog: AuditLogService,
  ) {}

  async use(req: any, res: any, next: () => void) {
    // Skip for GET/HEAD (Safe methods)
    const method = req.method.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next();
    }

    // Verify Token
    const sessionId = req.user?.sessionId; // From AuthGuard
    const token = req.headers['x-csrf-token'] || req.headers['X-CSRF-TOKEN'] || req.body?.csrfToken;

    if (!sessionId) {
      throw new ForbiddenException('Session required');
    }

    const isValid = await this.csrfService.verifyToken(sessionId, token);

    if (!isValid) {
      // Log Failure
      await this.csrfService.logFailure(sessionId, req.ip, 'Header mismatch');

      // Invalidate Session (Optional, strict mode)
      // await req.session?.destroy();

      throw new ForbiddenException('CSRF Token mismatch');
    }

    // Rotate Token (Optional, per-request)
    const newToken = await this.csrfService.rotateToken(sessionId);
    req.csrfToken = newToken; // Attach to request for controller

    next();
  }
}
