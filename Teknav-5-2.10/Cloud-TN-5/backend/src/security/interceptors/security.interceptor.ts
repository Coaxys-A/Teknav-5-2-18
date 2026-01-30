import { Injectable, NestInterceptor, ExecutionContext, CallHandler, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { PolicyEngineService, POLICY_RESOURCES, POLICY_ACTIONS } from '../policies/policy-engine.service';
import { SecurityService } from '../security/security.service';
import { CsrfService } from '../csrf/csrf.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { EventBusService } from '../../notifications/event-bus.service';

/**
 * Security Interceptor (Guard)
 * M0 - Architecture: "RBAC... enforced server-side"
 * 
 * Checks:
 * - CSRF (for dashboard mutations)
 * - Rate Limits (Global)
 * - Brute Force (Login)
 * - Bans (IP/User)
 * - RBAC (Policy Engine)
 * 
 * Writes AuditLog on deny.
 */

@Injectable()
export class SecurityInterceptor implements NestInterceptor {
  constructor(
    private readonly policyService: PolicyEngineService,
    private readonly securityService: SecurityService,
    private readonly csrfService: CsrfService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: EventBusService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse();
    const handlerName = context.getHandler().name;

    // 1. Resolve Tenant Context (Assumed attached by TenantMiddleware)
    const tenantId = (request as any).tenantContext?.tenantId;
    const userId = (request as any).tenantContext?.userId;
    const workspaceId = (request as any).tenantContext?.workspaceId;
    const ip = (request as any).ipAddress;
    const ua = (request as any).ua;

    if (!tenantId) {
      // Allow public endpoints (Auth, etc.)
      return next.handle();
    }

    // 2. Define Resource and Action for Policy Engine
    // Simplified mapping based on route name.
    // In real app, we'd use decorators `@RequirePolicy(action, resource)` to pass this info.
    // For Interceptor, we'll parse it or use defaults.
    let action = 'read';
    let resource = POLICY_RESOURCES.WORKSPACE; // Default

    // Heuristics for Action (Not robust, but works for MVP)
    if (handlerName.includes('create')) action = POLICY_ACTIONS.CREATE;
    if (handlerName.includes('update')) action = POLICY_ACTIONS.UPDATE;
    if (handlerName.includes('delete') || handlerName.includes('remove')) action = POLICY_ACTIONS.DELETE;

    // Heuristics for Resource
    if (handlerName.includes('article')) resource = POLICY_RESOURCES.ARTICLE;
    if (handlerName.includes('plugin')) resource = POLICY_RESOURCES.PLUGIN;
    if (handlerName.includes('workflow')) resource = POLICY_RESOURCES.WORKFLOW;
    if (handlerName.includes('security')) resource = POLICY_RESOURCES.AUDIT_LOG;
    if (handlerName.includes('session')) resource = POLICY_RESOURCES.SESSION;
    if (handlerName.includes('device')) resource = POLICY_RESOURCES.DEVICE;
    if (handlerName.includes('ban')) resource = POLICY_RESOURCES.BAN;

    // 3. Check Ban (IP/User)
    const isBanned = await this.securityService.checkBan(ip, userId);
    if (isBanned) {
      const decision = { allow: false, reason: 'Banned' };
      // M5: "Audit Log entry... always audit denies"
      await this.auditLog.logAction({
        actorUserId: userId || 0,
        action: 'access.denied',
        resource: 'Security',
        payload: {
          policyDecision: decision.reason,
          ip,
        },
      });

      throw new ForbiddenException(decision.reason);
    }

    // 4. Check Brute Force (Login/Password reset)
    if (handlerName.includes('login') || handlerName.includes('password')) {
      const isBrute = await this.securityService.checkBruteForce(ip, userId);
      if (!isBrute.allow) {
        const decision = { allow: false, reason: isBrute.reason };
        await this.auditLog.logAction({
          actorUserId: userId || 0,
          action: 'access.denied',
          resource: 'Security',
          payload: {
            policyDecision: decision.reason,
            ip,
          },
        });
        throw new ForbiddenException(decision.reason);
      }
    }

    // 5. Check Rate Limit (Per IP / Per User)
    const rateLimitResult = await this.securityService.checkRateLimit(ip, userId);
    if (!rateLimitResult.allow) {
      response.setHeader('x-ratelimit-limit', '60');
      response.setHeader('x-ratelimit-remaining', rateLimitResult.remaining);
      response.setHeader('x-ratelimit-reset', rateLimitResult.reset.toISOString());
      
      // M5: "Audit Log entry... always audit denies"
      await this.auditLog.logAction({
        actorUserId: userId || 0,
        action: 'access.denied',
        resource: 'Security',
        payload: {
          policyDecision: 'Rate limit exceeded',
          ip,
          remaining: rateLimitResult.remaining,
        },
      });
      
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    // 6. Check CSRF (For Dashboard/API Mutations)
    // Excludes GET requests and Webhooks.
    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);
    const isWebhook = handlerName.includes('webhook');

    if (isMutation && !isWebhook && tenantId) {
      const sessionId = (request as any).tenantContext?.sessionId;
      const csrfToken = request.headers['x-csrf-token'];
      
      if (sessionId && csrfToken) {
        const isValid = await this.csrfService.validateToken(sessionId, csrfToken);
        if (!isValid) {
          const decision = { allow: false, reason: 'CSRF Token Invalid' };
          await this.auditLog.logAction({
            actorUserId: userId || 0,
            action: 'access.denied',
            resource: 'Security',
            payload: {
              policyDecision: decision.reason,
              sessionId,
            },
          });
          throw new ForbiddenException('CSRF Token Invalid');
        }
      }
    }

    // 7. Check RBAC (Policy Engine)
    const policyDecision = await this.policyService.checkPermission(
      { tenantId, userId, workspaceId },
      action,
      resource,
    );

    if (!policyDecision.allow) {
      // M5: "Audit Log entry... always audit denies"
      await this.auditLog.logAction({
        actorUserId: userId,
        action: 'access.denied',
        resource: `${resource}:${handlerName}`,
        payload: {
          policyDecision: policyDecision.reason,
          action,
          resource,
          workspaceId,
        },
      });

      throw new ForbiddenException(policyDecision.reason);
    }

    // 8. Attach Decision to Request (For Downstream)
    (request as any).securityDecision = policyDecision;

    return next.handle();
  }
}
