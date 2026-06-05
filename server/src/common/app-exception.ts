import { HttpException } from '@nestjs/common';

import type { ErrorResponse } from './api-response';

export class AppException extends HttpException {
  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    const response: ErrorResponse = {
      ok: false,
      error: {
        code,
        message,
        details,
      },
    };

    super(response, status);
  }
}
