import { SetMetadata, UseGuards } from '@nestjs/common';
import { PolicyAction, PolicySubject, ResourceScope } from './policy.types';
import { PolicyGuard } from './policy.guard';

/**
 * Require Policy Decorator
 * Attaches policy metadata to route handler.
 */

export const RequirePolicy = (
  action: PolicyAction,
  subject: PolicySubject,
  scope?: ResourceScope,
) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    UseGuards(PolicyGuard)(target, propertyKey, descriptor);
    SetMetadata('POLICY_KEY', { action, subject, scope })(target, propertyKey, descriptor);
  };
};
