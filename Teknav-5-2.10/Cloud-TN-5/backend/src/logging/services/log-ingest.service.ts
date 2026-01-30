import { Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../../audit-log.service';
import { DomainEventService } from '../events/domain-event.service';
import { RedisService } from '../../redis/redis.service';

/**
 * Log Ingest Service
 * 
 * Updated for M10 - Workstream 1 (Domain Events + Outbound Webhooks)
 * 
 * Wraps `AuditLogService` and `DomainEventService`.
 */

@Injectable()
export class LogIngestService {
  private readonly logger = new Logger(LogIngestService.name);

  constructor(
    private readonly auditLog: AuditLogService,
    private readonly domainEvent: DomainEventService,
    private readonly redis: RedisService,
  ) {}

  async writeAuditLog(log: {
    actorUserId: number;
    action: string;
    resource: string;
    payload: any;
    metadata?: any;
  }) {
    // 1. Write Audit Log
    await this.auditLog.logAction(log);

    // 2. Publish Domain Event (Internal) - M10
    // Only publish for "Write" actions, not Reads (optional optimization)
    if (
      [
        'create', 'update', 'delete', 'installed', 'uninstalled', 'enabled', 'disabled', 'revoked', 'banned', 'unsub', 'bounced', 'complained'
      ].some(action => log.action.includes(action))
    ) {
      // M10: Domain Events
      await this.domainEvent.publish('audit', {
        id: DomainEventService.generateId(),
        type: log.action,
        time: new Date(),
        tenantId: 0, // System level action, or extract from `log` if needed.
        object: { type: log.resource },
        data: log.payload,
      });
    }

    // 3. Invalidate Cache (If needed) - M0
    // `global invalidation helper: prefix-based delete`
    // Implemented via `RedisService` methods if specific to this log type.
  }

  async writeAiLog(log: {
    actorUserId: number;
    action: string;
    resource: string;
    payload: any;
    metadata?: any;
  }) {
    // 1. Write Audit Log
    await this.auditLog.logAction({
      actorUserId: log.actorUserId,
      action: `ai.${log.action}`,
      resource: log.resource,
      payload: log.payload,
    });

    // 2. Publish Domain Event (AI) - M10
    await this.domainEvent.publish('ai', {
      id: DomainEventService.generateId(),
      type: `ai.${log.action}`,
      time: new Date(),
      tenantId: 0, // Assume `TenantContext` sets this globally or we pass it.
      object: { type: log.resource, id: log.payload?.runId },
      data: log.payload,
    });
  }

  async writePluginLog(log: {
    actorUserId: number;
    action: string;
    resource: string;
    payload: any;
    metadata?: any;
  }) {
    // 1. Write Audit Log
    await this.auditLog.logAction({
      actorUserId: log.actorUserId,
      action: `plugin.${log.action}`,
      resource: log.resource,
      payload: log.payload,
    });

    // 2. Publish Domain Event (Plugins) - M10
    await this.domainEvent.publish('plugins', {
      id: DomainEventService.generateId(),
      type: `plugin.${log.action}`,
      time: new Date(),
      tenantId: 0,
      object: { type: log.resource, id: log.payload?.pluginId },
      data: log.payload,
    });
  }

  async writeDataAccessLog(log: {
    actorUserId: number;
    action: string;
    resource: string;
    payload: any;
    metadata?: any;
  }) {
    // 1. Write Audit Log
    await this.auditLog.logAction({
      actorUserId: log.actorUserId,
      action: `data.access.${log.action}`,
      resource: log.resource,
      payload: log.payload,
    });

    // 2. Publish Domain Event (Security/Data) - M10
    if (log.action === 'EXPORT') {
      await this.domainEvent.publish('security', {
        id: DomainEventService.generateId(),
        type: 'security.data.exported',
        time: new Date(),
        tenantId: 0,
        object: { type: log.resource },
        data: log.payload,
      });
    }
  }

  async writeEmailLog(log: {
    to: string;
    subject: string;
    status: string;
    error?: string;
  }) {
    // 1. Write Audit Log
    await this.auditLog.logAction({
      actorUserId: 0,
      action: `email.send`,
      resource: 'Email',
      payload: log,
    });

    // 2. Publish Domain Event (Newsletter) - M10
    if (log.status === 'SENT') {
      await this.domainEvent.publish('newsletter', {
        id: DomainEventService.generateId(),
        type: 'newsletter.sent',
        time: new Date(),
        tenantId: 0,
        object: { type: 'Email' },
        data: { to: log.to, subject: log.subject },
      });
    } else if (log.status === 'FAILED') {
      await this.domainEvent.publish('newsletter', {
        id: DomainEventService.generateId(),
        type: 'newsletter.failed',
        time: new Date(),
        tenantId: 0,
        object: { type: 'Email' },
        data: { to: log.to, subject: log.subject, error: log.error },
      });
    }
  }

  async writeWebhookLog(log: {
    endpointId: string;
    eventType: string;
    status: string;
    responseStatus?: number;
    error?: string;
    retries: number;
  }) {
    // 1. Write Audit Log
    await this.auditLog.logAction({
      actorUserId: 0,
      action: `webhook.delivery`,
      resource: `Webhook:${log.endpointId}`,
      payload: log,
    });

    // 2. Publish Domain Event (Webhooks) - M10
    await this.domainEvent.publish('webhooks', {
      id: DomainEventService.generateId(),
      type: `webhook.${log.status.toLowerCase()}`,
      time: new Date(),
      tenantId: 0,
      object: { type: 'Webhook', id: log.endpointId },
      data: log,
    });
  }

  async publishLogEvent(type: string, payload: any) {
    // Generic Event Publisher (Used by Frontend for Realtime)
    await this.domainEvent.publish('general', {
      id: DomainEventService.generateId(),
      type: type,
      time: new Date(),
      tenantId: 0, // Global
      object: { type: 'General' },
      data: payload,
    });
  }
}
