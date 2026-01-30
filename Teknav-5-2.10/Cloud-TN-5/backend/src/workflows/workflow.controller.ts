import { Controller, Get, Post, Patch, Param, Body, UseGuards, Req, HttpCode, HttpStatus, ConflictException, Query } from '@nestjs/common';
import { WorkflowRuntimeService } from './workflow-runtime.service';
import { AuditDecorator } from '../../common/decorators/audit.decorator';

/**
 * Workflow Controller (Admin)
 *
 * Endpoints:
 * - GET /definitions (List Definitions)
 * - POST /definitions/:id/run
 * - POST /definitions/:id/rerun
 * - POST /instances/:id/cancel
 * - GET /instances
 * - GET /instances/:id
 * - GET /instances/:id/steps
 */

@Controller('admin/workflows')
// @UseGuards(AuthGuard) // Assumed global
export class WorkflowController {
  constructor(private readonly runtimeService: WorkflowRuntimeService) {}

  /**
   * List Definitions
   */
  @Get('definitions')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'workflow.definitions.list', resourceType: 'WorkflowDefinition' })
  async getDefinitions(
    @Query('status') status: 'ACTIVE' | 'INACTIVE' | undefined,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('sort') sort: string,
    @Req() req: any,
  ): Promise<{ data: any[]; total: number }> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const filters = {
      status,
      page: page ? parseInt(page) : 1,
      pageSize: pageSize ? parseInt(pageSize) : 20,
      sort: sort || 'createdAt',
    };

    return await this.runtimeService.getDefinitions(actor, workspaceId, filters);
  }

  /**
   * Run Workflow
   */
  @Post('definitions/:id/run')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'workflow.run', resourceType: 'WorkflowDefinition', resourceIdParam: 'id' })
  async runWorkflow(@Param('id') id: string, @Body() body: { input?: Record<string, any>; triggerContext?: Record<string, any> }, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const instance = await this.runtimeService.runWorkflow(
      actor,
      workspaceId,
      parseInt(id),
      body.input || {},
      body.triggerContext || {},
    );

    return { data: instance };
  }

  /**
   * Rerun Workflow
   */
  @Post('definitions/:id/rerun')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'workflow.rerun', resourceType: 'WorkflowDefinition', resourceIdParam: 'id' })
  async rerunWorkflow(@Param('id') id: string, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const instance = await this.runtimeService.runWorkflow(
      actor,
      workspaceId,
      parseInt(id),
      {}, // No input for rerun
      { rerunOf: parseInt(id) }, // Context
    );

    return { data: instance };
  }

  /**
   * Cancel Workflow Instance
   */
  @Post('instances/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'workflow.cancel', resourceType: 'WorkflowInstance', resourceIdParam: 'id' })
  async cancelInstance(@Param('id') id: string, @Req() req: any): Promise<any> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const instance = await this.runtimeService.cancelInstance(actor, workspaceId, parseInt(id));
    return { data: instance };
  }

  /**
   * List Instances
   */
  @Get('instances')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'workflow.instances.list', resourceType: 'WorkflowInstance' })
  async getInstances(
    @Query('workflowId') workflowId: string,
    @Query('status') status: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('sort') sort: string,
    @Req() req: any,
  ): Promise<{ data: any[]; total: number }> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const filters = {
      workflowId: workflowId ? parseInt(workflowId) : undefined,
      status,
      page: page ? parseInt(page) : 1,
      pageSize: pageSize ? parseInt(pageSize) : 20,
      sort: sort || 'createdAt',
    };

    return await this.runtimeService.getInstances(actor, workspaceId, filters);
  }

  /**
   * Get Instance Detail
   */
  @Get('instances/:id')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'workflow.instance.get', resourceType: 'WorkflowInstance', resourceIdParam: 'id' })
  async getInstance(@Param('id') id: string, @Req() req: any): Promise<{ data: any }> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const instance = await this.runtimeService.getInstance(actor, workspaceId, parseInt(id));
    return { data: instance };
  }

  /**
   * Get Instance Steps
   */
  @Get('instances/:id/steps')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'workflow.instance.steps.get', resourceType: 'WorkflowStepExecution', resourceIdParam: 'id' })
  async getInstanceSteps(@Param('id') id: string, @Req() req: any): Promise<{ data: any[] }> {
    const actor = req.user;
    const workspaceId = req.workspaceId;

    const steps = await this.runtimeService.getInstanceSteps(actor, workspaceId, parseInt(id));
    return { data: steps };
  }
}
