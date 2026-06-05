import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { ok } from './common/api-response';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.types';
import { AccessTokenGuard } from './access-token.guard';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() body: Record<string, unknown>) {
    const session = await this.authService.login(body);
    return ok(session);
  }

  @Post('refresh')
  async refresh(@Body() body: Record<string, unknown>) {
    const session = await this.authService.refresh(body);
    return ok(session);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    const currentUser = await this.authService.getCurrentUser(user.userId);
    return ok({
      user: currentUser,
    });
  }
}
