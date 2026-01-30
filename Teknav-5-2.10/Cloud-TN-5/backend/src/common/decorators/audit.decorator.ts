import { SetMetadata } from '@nestjs/common';

/**
 * Audit Decorator
 *
 * Used to mark routes/services for audit logging.
 * Usage:
 * @Audit({ action: 'article.create', resourceType: 'Article', resourceIdParam: 'id' })
 */

export const AUDIT_KEY = 'audit';

export const Audit = (options: { action: string; resourceType: string; resourceIdParam?: string }) =>
  SetMetadata(AUDIT_KEY, options);
