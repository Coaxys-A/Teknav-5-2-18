import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PolicyAction, PolicySubject, ResourceScope } from './policy.types';
import { PolicyService } from './policy.service';
import { AccessContextService } from './access-context.service';

/**
 * Policy Guard
 * Blocks request early with 403.
 */

@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policyService: PolicyService,
    private readonly accessContextService: AccessContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPolicy = this.reflector.getAllAndOverride('POLICY_KEY', context.getHandler());

    if (!requiredPolicy) {
      return true;
    }

    const { action, subject, resource } = requiredPolicy;
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const workspaceId = request.workspaceId;

    // 1. Resolve Context
    const policyContext = await this.accessContextService.resolveContext(user.sessionId, workspaceId, user.userId);

    // 2. Evaluate Policy
    await this.policyService.evaluate(policyContext, action, subject, {
      resourceType: subject,
      resourceId: resource?.id,
      workspaceId: workspaceId,
    });

    // 3. Check Ban
    await this.policyService.checkBan(policyContext);

    return true;
  }
}

export const POLICY_KEY = Symbol('policy');
