import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';

import { AppException } from './common/app-exception';
import type { AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      user?: AuthenticatedUser;
    }>();

    const authorization = request.headers?.authorization;
    const token = extractBearerToken(authorization);

    if (!token) {
      throw new AppException(401, 'UNAUTHORIZED', 'Missing bearer token');
    }

    request.user = await this.authService.verifyAccessToken(token);
    return true;
  }
}

function extractBearerToken(headerValue?: string | string[]): string | null {
  if (Array.isArray(headerValue)) {
    return extractBearerToken(headerValue[0]);
  }

  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token.trim();
}
