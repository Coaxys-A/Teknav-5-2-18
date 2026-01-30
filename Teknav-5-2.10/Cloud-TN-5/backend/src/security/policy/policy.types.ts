/**
 * Policy Engine Types
 *
 * Defines the core structures for RBAC.
 */

export enum PolicyAction {
  // General
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',

  // Content
  PUBLISH = 'publish',
  APPROVE = 'approve',
  REJECT = 'reject',
  ASSIGN = 'assign',

  // Workflow
  RUN_WORKFLOW = 'run_workflow',
  CANCEL_WORKFLOW = 'cancel_workflow',

  // Security
  MANAGE_PERMISSIONS = 'manage_permissions',
  MANAGE_ROLES = 'manage_roles',
  MANAGE_TENANT = 'manage_tenant',
  VIEW_AUDIT = 'view_audit',
  REVOKE_TOKEN = 'revoke_token',
  CREATE_TOKEN = 'create_token',
  BAN_USER = 'ban_user',
  UNBAN_USER = 'unban_user',

  // Billing
  MANAGE_SUBSCRIPTIONS = 'manage_subscriptions',
  MANAGE_ORDERS = 'manage_orders',
  ISSUE_REFUND = 'issue_refund',
}

export enum ResourceScope {
  GLOBAL = 'global',       // Tenant Owner
  TENANT = 'tenant',       // Workspace Manager
  WORKSPACE = 'workspace', // Workspace Admin
  SELF = 'self',         // Own resources
}

export enum ResourceSubject {
  // Content
  USER = 'User',
  ARTICLE = 'Article',
  WORKFLOW = 'Workflow',
  WORKFLOW_DEFINITION = 'WorkflowDefinition',
  NOTIFICATION = 'Notification',

  // System
  WORKSPACE = 'Workspace',
  TENANT = 'Tenant',
  AUDIT_LOG = 'AuditLog',

  // Billing
  ORDER = 'Order',
  SUBSCRIPTION = 'Subscription',

  // Security
  API_KEY = 'ApiKey',
  SESSION = 'Session',
  FEATURE_FLAG = 'FeatureFlag',
}

export interface PolicyContext {
  actorId: number;
  actorRole: string;
  tenantId: number;
  workspaceId?: number;
  membershipId?: number;
  ip?: string;
  ua?: string;
  sessionId?: string;
  requestId?: string;
}

export interface PolicyResource {
  resourceType: ResourceSubject;
  resourceId?: number | string;
  workspaceId?: number;
  tenantId?: number;
  ownerId?: number; // For SELF scope
}

export type PolicyDecision = {
  allowed: boolean;
  reason?: string;
  policyDecisionId?: string;
};

export interface PermissionRule {
  role: string;
  action: PolicyAction;
  resource: ResourceSubject;
  effect: 'allow' | 'deny';
  condition?: string; // e.g. workspaceId == x
}

export interface PermissionMatrix {
  default: PermissionRule[];
  tenantOverride?: PermissionRule[];
}
