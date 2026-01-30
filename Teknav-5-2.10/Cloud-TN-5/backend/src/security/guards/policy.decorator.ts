import { SetMetadata, UseGuards } from '@nestjs/common';
import { PolicyEngineService } from '../policies/policy-engine.service';
import { ForbiddenException } from '@nestjs/common';

/**
 * RequirePolicy Decorator
 * M0 - Architecture: "RBAC must be enforced server-side"
 * 
 * Usage: @RequirePolicy({ action: 'article.update', resource: 'article' })
 * 
 * Logic:
 * - Calls PolicyEngineService.checkPermission
 * - Throws 403 if denied
 */

export const RequirePolicy = (options: {
  action: string;
  resource: string;
  resourceIdParam?: string; // Map to @Param() ID (e.g. 'id')
  workspaceIdParam?: string; // Map to @Param() Workspace ID
}) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    // Apply UseGuards (TenantGuard, AuthGuard)
    UseGuards(/* ... */)(target, constructor, descriptor);

    // Now Apply PolicyGuard
    RequirePolicyGuard(options)(target, propertyKey, descriptor);
  };
};

/**
 * Policy Guard (Internal)
 */
const RequirePolicyGuard = (options: { action: string; resource: string; resourceIdParam?: string; workspaceIdParam?: string }) => {
  return UseGuards(
    async (req: any, res: any, next: any) => {
      // 1. Resolve Parameters
      let resourceId: number | undefined;
      if (options.resourceIdParam) {
        resourceId = parseInt(req.params[options.resourceIdParam]);
      }

      let workspaceId: number | undefined;
      if (options.workspaceIdParam) {
        workspaceId = parseInt(req.params[options.workspaceIdParam]);
      } else {
        workspaceId = req.tenantContext?.workspaceId;
      }

      const tenantId = req.tenantContext?.tenantId;
      const userId = req.tenantContext?.userId;
      const roles = req.tenantContext?.roles || [];

      if (!tenantId) {
        throw new ForbiddenException('Tenant context missing');
      }

      // 2. Inject PolicyService
      const policyEngine = req.app.get(PolicyEngineService);

      // 3. Check Permission
      const decision = await policyEngine.checkPermission(
        { tenantId, userId, workspaceId, roles },
        options.action,
        options.resource,
        resourceId,
        workspaceId,
      );

      // 4. Handle Decision
      if (!decision.allow) {
        // M10: "Audit Log entry... always audit denies"
        // We inject AuditLogService here or rely on Interceptor.
        // To be safe and explicit as requested:
        const auditLogService = req.app.get('AuditLogService');
        await auditLogService.logAction({
          actorUserId: userId,
          action: 'access.denied',
          resource: `${options.resource}:${resourceId}`,
          payload: {
            policyDecision: decision.reason,
          },
        });

        throw new ForbiddenException(`Access Denied: ${decision.reason}`);
      }

      // 5. Attach Decision to Request (for downstream use if needed)
      req.policyDecision = decision;

      next();
    },
  );
};
