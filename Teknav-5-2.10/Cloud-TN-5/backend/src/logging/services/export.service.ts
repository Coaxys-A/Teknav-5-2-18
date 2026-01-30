import { Injectable, Logger } from '@nestjs/common';
import { LogIngestService } from './log-ingest.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Export Service
 * 
 * Writes to `DataAccessLog` (Action: EXPORT).
 * Supports NDJSON (Newline Delimited JSON) and CSV exports.
 */

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly logIngest: LogIngestService,
  ) {}

  /**
   * Export Audit Logs to NDJSON
   */
  async exportAuditLogs(actor: any, filters: {
    actorId?: number;
    workspaceId?: number;
    from: Date;
    to: Date;
  }) {
    // 1. Query Logs
    const logs = await this.prisma.auditLog.findMany({
      where: {
        tenantId: actor.tenantId,
        createdAt: {
          gte: filters.from,
          lte: filters.to,
        },
        ...(filters.actorId && { actorUserId: filters.actorId }),
        ...(filters.workspaceId && { workspaceId: filters.workspaceId }),
      },
      orderBy: { createdAt: 'desc' },
    });

    this.logger.log(`Exporting ${logs.length} audit logs`);

    // 2. Write DataAccessLog (Action: EXPORT)
    await this.logIngest.writeDataAccessLog({
      actorUserId: actor.userId,
      action: 'EXPORT',
      resource: 'AuditLog',
      payload: { count: logs.length, filters },
    });

    return this.streamNdjson(logs);
  }

  /**
   * Stream NDJSON
   * Returns a NodeJS ReadableStream (or Observable stream).
   */
  private streamNdjson(data: any[]) {
    const { Readable } = require('stream');

    let index = 0;
    return new Readable({
      objectMode: true,
      read(size: number) {
        if (index >= data.length) {
          return null;
        }
        
        const chunk = data.slice(index, index + size);
        index += size;
        return chunk;
      },
    });
  }

  /**
   * Export to CSV (Helper)
   */
  private streamCsv(data: any[], fields: string[]) {
    const { Readable } = require('stream');

    let index = 0;
    return new Readable({
      objectMode: false,
      read(size: number) {
        if (index === 0) {
          // Header
          return fields.join(',') + '\n';
        }

        if (index >= data.length) {
          return null;
        }

        const chunk = data.slice(index, index + size);
        const rows = chunk.map(row => {
          return fields.map(field => {
            let val = row[field];
            if (typeof val === 'object' && val !== null) {
              val = JSON.stringify(val);
            }
            // Escape CSV
            if (val && val.includes(',')) {
              val = `"${val}"`;
            }
            return val;
          }).join(',');
        }).join('\n');

        index += size;
        return rows;
      },
    });
  }
}
