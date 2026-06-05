import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get()
  getRoot() {
    return {
      service: 'topomind-server',
      status: 'ok',
    };
  }

  @Get('health')
  getHealth() {
    return {
      service: 'topomind-server',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
