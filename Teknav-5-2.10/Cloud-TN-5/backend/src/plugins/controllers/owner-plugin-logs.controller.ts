import { Controller, Get, Body, Post, Delete, Param, Query, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { PoliciesGuard } from '../../auth/policies.guard';
import { RequirePolicy } from '../../security/policy/policy.decorator';
import { PolicyAction, PolicySubject } from '../../security/policy/policy.types';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Plugin Logs Controller (Owner + Workspace)
 * PART 12 - Plugin Platform: "Marketplace + Install/Upgrade/Rollback + Permissions Matrix + Signing Enforcement + WASM Sandbox Hardening + Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 */

@Controller('api/owner/workspaces/:workspaceId/plugins')
@UseGuards(PoliciesGuard)
export class WorkspacePluginLogsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ==========================================================================
  // WORKSPACE-SCOPE LOGS
  // ==========================================================================

  @Get(':pluginId/logs')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async getPluginLogs(
    @Param('workspaceId') workspaceId: number,
    @Param('pluginId') pluginId: number,
    @Req() req: any,
    @Query() query: any,
  ) {
    const actorId = req.user.id;

    // Check workspace boundary
    if (req.user.workspaceId !== workspaceId) {
      throw new Error('Not authorized for this workspace');
    }

    const {
      status,
      hookType,
      dateFrom,
      dateTo,
      errorMessageContains,
      minDurationMs,
      maxDurationMs,
      page = 1,
      pageSize = 20,
    } = query;

    const where: any = {
      workspaceId,
      pluginId,
    };

    // Status filter
    if (status) {
      where.status = status;
    }

    // Hook type filter
    if (hookType) {
      where.hookType = hookType;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo);
      }
    }

    // Error message contains filter
    if (errorMessageContains) {
      where.errorMessage = { contains: errorMessageContains, mode: 'insensitive' };
    }

    // Duration filter
    if (minDurationMs || maxDurationMs) {
      where.durationMs = {};
      if (minDurationMs) {
        where.durationMs.gte = minDurationMs;
      }
      if (maxDurationMs) {
        where.durationMs.lte = maxDurationMs;
      }
    }

    const [logs, total] = await Promise.all([
      this.prisma.pluginExecutionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.pluginExecutionLog.count({ where }),
    ]);

    // Calculate stats
    const stats = {
      total: logs.length,
      completed: logs.filter(l => l.status === 'COMPLETED').length,
      failed: logs.filter(l => l.status === 'FAILED').length,
      avgDurationMs: logs.length > 0
        ? logs.reduce((sum, l) => sum + (l.durationMs || 0), 0) / logs.length
        : 0,
      byHookType: {},
      byStatus: {},
    };

    // Aggregate by hook type
    for (const log of logs) {
      stats.byHookType[log.hookType] = (stats.byHookType[log.hookType] || 0) + 1;
      stats.byStatus[log.status] = (stats.byStatus[log.status] || 0) + 1;
    }

    return {
      data: logs,
      page,
      pageSize,
      total,
      stats,
      filters: query,
    };
  }

  @Get('logs/:logId')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async getLogDetail(
    @Param('workspaceId') workspaceId: number,
    @Param('pluginId') pluginId: number,
    @Param('logId') logId: number,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Check workspace boundary
    if (req.user.workspaceId !== workspaceId) {
      throw new Error('Not authorized for this workspace');
    }

    const log = await this.prisma.pluginExecutionLog.findUnique({
      where: { id: logId },
      include: {
        plugin: true,
        pluginInstallation: true,
      },
    });

    if (!log || log.workspaceId !== workspaceId || log.pluginId !== pluginId) {
      throw new Error(`Log not found: ${logId}`);
    }

    return {
      data: {
        id: log.id,
        status: log.status,
        hookType: log.hookType,
        input: log.input ? JSON.parse(log.input) : null,
        output: log.output ? JSON.parse(log.output) : null,
        errorMessage: log.errorMessage,
        durationMs: log.durationMs,
        memoryUsedMb: log.memoryUsedMb,
        tokensUsed: log.tokensUsed,
        cost: log.cost,
        createdAt: log.createdAt,
        plugin: log.plugin,
        pluginInstallation: log.pluginInstallation,
      },
    };
  }
}

/**
 * Global Plugin Logs Controller (Owner Scope)
 * PART 12 - Plugin Platform: "Logs + Analytics Attribution"
 */

@Controller('api/owner/plugins')
@UseGuards(PoliciesGuard)
export class OwnerPluginLogsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ==========================================================================
  // GLOBAL-SCOPE LOGS
  // ==========================================================================

  @Get(':pluginId/logs')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async getPluginLogsGlobal(
    @Param('pluginId') pluginId: number,
    @Req() req: any,
    @Query() query: any,
  ) {
    const actorId = req.user.id;

    const {
      status,
      hookType,
      dateFrom,
      dateTo,
      errorMessageContains,
      minDurationMs,
      maxDurationMs,
      workspaceId,
      page = 1,
      pageSize = 20,
    } = query;

    const where: any = {
      pluginId,
    };

    // Status filter
    if (status) {
      where.status = status;
    }

    // Hook type filter
    if (hookType) {
      where.hookType = hookType;
    }

    // Workspace filter
    if (workspaceId) {
      where.workspaceId = workspaceId;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo);
      }
    }

    // Error message contains filter
    if (errorMessageContains) {
      where.errorMessage = { contains: errorMessageContains, mode: 'insensitive' };
    }

    // Duration filter
    if (minDurationMs || maxDurationMs) {
      where.durationMs = {};
      if (minDurationMs) {
        where.durationMs.gte = minDurationMs;
      }
      if (maxDurationMs) {
        where.durationMs.lte = maxDurationMs;
      }
    }

    const [logs, total] = await Promise.all([
      this.prisma.pluginExecutionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.pluginExecutionLog.count({ where }),
    ]);

    return {
      data: logs,
      page,
      pageSize,
      total,
      filters: query,
    };
  }

  @Get('logs/:logId')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async getGlobalLogDetail(
    @Param('pluginId') pluginId: number,
    @Param('logId') logId: number,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const log = await this.prisma.pluginExecutionLog.findUnique({
      where: { id: logId },
      include: {
        plugin: true,
        pluginInstallation: true,
        workspace: true,
      },
    });

    if (!log || log.pluginId !== pluginId) {
      throw new Error(`Log not found: ${logId}`);
    }

    return {
      data: {
        id: log.id,
        status: log.status,
        hookType: log.hookType,
        input: log.input ? JSON.parse(log.input) : null,
        output: log.output ? JSON.parse(log.output) : null,
        errorMessage: log.errorMessage,
        durationMs: log.durationMs,
        memoryUsedMb: log.memoryUsedMb,
        tokensUsed: log.tokensUsed,
        cost: log.cost,
        createdAt: log.createdAt,
        plugin: log.plugin,
        pluginInstallation: log.pluginInstallation,
        workspace: log.workspace,
      },
    };
  }
}
