import { Injectable, NestMiddleware, ForbiddenException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContextService } from './tenant-context.service';

/**
 * Tenant Guard (M0 - Architecture)
 *
 * Enforces Tenant Boundary.
 * Blocks request early with 403 if no tenant resolved.
 */

@Injectable()
export class TenantGuard implements NestMiddleware {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(private readonly tenantContextService: TenantContextService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      // 1. Resolve Tenant Context
      const context = await this.tenantContextService.resolveTenantContext(req);

      if (!context.tenantId) {
        this.logger.warn(`Tenant Guard: No tenant resolved for request ${req.path}`);
        throw new ForbiddenException('Tenant context missing or invalid');
      }

      // 2. Attach Context to Request
      // We use an assignment to the `req` object which extends `express.Request`
      (req as any).tenantContext = context;

      // 3. Add Headers for Backend (Optional but helps consistency)
      res.setHeader('X-Tenant-Id', context.tenantId.toString());
      if (context.workspaceId) {
        res.setHeader('X-Workspace-Id', context.workspaceId.toString());
      }

      next();
    } catch (error) {
      this.logger.error(`Tenant Guard Error: ${error.message}`);
      throw new ForbiddenException(error.message || 'Tenant validation failed');
    }
  }
}
