import { Module } from '@nestjs/common';

import { AccessTokenGuard } from './access-token.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BootstrapService } from './bootstrap.service';
import { DatabaseService } from './database.service';
import { EventWriter } from './event-writer';
import { HealthController } from './health.controller';
import { IdempotencyService } from './idempotency.service';
import { SyncController } from './sync.controller';
import { SyncPullService } from './sync-pull.service';
import { SyncPushService } from './sync-push.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  controllers: [HealthController, AuthController, WorkspacesController, SyncController],
  providers: [
    AccessTokenGuard,
    AuthService,
    BootstrapService,
    DatabaseService,
    EventWriter,
    IdempotencyService,
    SyncPullService,
    SyncPushService,
    WorkspacesService,
  ],
})
export class AppModule {}
