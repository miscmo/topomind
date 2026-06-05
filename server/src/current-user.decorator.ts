import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser } from './auth.types';
import { AppException } from './common/app-exception';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
    }>();

    if (!request.user) {
      throw new AppException(401, 'UNAUTHORIZED', 'Current user is not attached');
    }

    return request.user;
  },
);
