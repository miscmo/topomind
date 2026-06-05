import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { ok } from './common/api-response';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.types';
import { AccessTokenGuard } from './access-token.guard';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
@UseGuards(AccessTokenGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const items = await this.workspacesService.listForUser(user.userId);
    return ok({ items });
  }

  @Get(':workspaceId')
  async getWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    const workspace = await this.workspacesService.getWorkspaceForUser(
      user.userId,
      workspaceId,
    );

    return ok({ workspace });
  }
}
