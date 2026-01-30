import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PolicyAction, PolicySubject } from '../../security/policy/policy.types';
import { PolicyEngineService } from '../../security/policy/policy.engine.service';

/**
 * Workspace Guard
 *
 * Validates workspace membership.
 * Requires user to be in `WorkspaceMember` table with role >= VIEWER.
 */

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly policyEngine: PolicyEngineService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Check if guard is explicitly required (in case of global guard)
    // For now, we assume if this guard is used, it's required.
    
    const request = context.switchToHttp().getRequest();
    const actor = request.user; // Populated by AuthGuard
    const workspaceId = request.params?.workspaceId || request.query?.workspaceId || request.body?.workspaceId || request.cookies?.workspaceId;

    if (!actor) {
      throw new ForbiddenException('User not authenticated');
    }

    if (!workspaceId) {
      throw new ForbiddenException('Workspace ID missing');
    }

    // 2. Check Workspace Membership
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        userId: actor.userId,
        workspaceId: parseInt(workspaceId),
      },
    });

    if (!membership) {
      throw new ForbiddenException('User is not a member of this workspace');
    }

    // 3. Check Role (Min VIEWER)
    // NOTE: Roles are stored as strings. We assume 'VIEWER', 'EDITOR', 'ADMIN', 'OWNER'.
    const allowedRoles = ['VIEWER', 'EDITOR', 'ADMIN', 'OWNER'];
    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('User does not have required role');
    }

    // 4. Attach Membership to Request
    request.workspaceMember = membership;
    request.workspaceId = parseInt(workspaceId);

    // 5. Enforce Policy (Optional but recommended)
    // Check if user has permission to READ Workspace
    try {
      const result = await this.policyEngine.evaluate({
        actor: {
          userId: actor.userId,
          roles: [membership.role],
          workspaceMemberships: [{ workspaceId: parseInt(workspaceId), role: membership.role }],
          tenantIds: actor.tenantIds,
        },
        action: PolicyAction.READ,
        subject: PolicySubject.WORKSPACE,
        resource: {
          workspaceId: parseInt(workspaceId),
        },
        context: {
          ip: request.ip,
          ua: request.headers['user-agent'],
          deviceId: request.headers['x-device-id'] || request.sessionId,
          sessionId: request.sessionId,
          requestId: request.headers['x-request-id'],
          geo: request.geo,
        },
      });
      if (!result.allowed || result.denied) {
        throw new ForbiddenException(result.reason || 'Policy Denied');
      }
    } catch (error) {
      // If policy evaluation fails, we might want to be lenient or strict.
      // For "Strict Pass/Fail", we throw.
      throw new ForbiddenException('Policy evaluation failed');
    }

    return true;
  }
}
