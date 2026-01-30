import { Controller, Get, Query, Body, UseGuards, Req, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';

/**
 * Workspace Controller
 *
 * Implements /api/workspaces/current endpoint.
 */

@Controller('api/workspaces')
// @UseGuards(AuthGuard) // Assuming global or applied in module
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get('current')
  @HttpCode(HttpStatus.OK)
  async getCurrentWorkspace(
    @Query('workspaceId') providedWorkspaceId: string,
    @Req() req: any,
  ): Promise<any> {
    const actor = req.user;
    const cookieWorkspaceId = req.cookies?.workspaceId;

    if (!actor) {
      throw new BadRequestException('User not authenticated');
    }

    const workspace = await this.workspaceService.getCurrentWorkspace(
      actor.userId,
      providedWorkspaceId,
      cookieWorkspaceId,
    );

    return { data: workspace };
  }
}
