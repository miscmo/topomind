import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from './access-token.guard';
import type { AuthenticatedUser } from './auth.types';
import { BootstrapService } from './bootstrap.service';
import { ok } from './common/api-response';
import { CurrentUser } from './current-user.decorator';
import { SyncPullService } from './sync-pull.service';
import { SyncPushService } from './sync-push.service';

@Controller('workspaces/:workspaceId')
@UseGuards(AccessTokenGuard)
export class SyncController {
  constructor(
    private readonly bootstrapService: BootstrapService,
    private readonly syncPullService: SyncPullService,
    private readonly syncPushService: SyncPushService,
  ) {}

  @Get('bootstrap')
  async bootstrap(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    const data = await this.bootstrapService.getWorkspaceBootstrap(user.userId, workspaceId);
    return ok(data);
  }

  @Get('sync/pull')
  async pull(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Query('afterEventId') afterEventId?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.syncPullService.pull(user.userId, workspaceId, {
      afterEventId,
      limit,
    });

    return ok(data);
  }

  @Post('sync/push')
  async push(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const data = await this.syncPushService.push(workspaceId, user.userId, body);
    return ok(data);
  }
}
