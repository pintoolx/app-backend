import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({
    summary: 'Liveness probe (200 = process alive). Does not exercise dependencies.',
  })
  live() {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({
    summary:
      'Readiness probe; runs DB + Solana RPC + MagicBlock + Umbra checks in parallel. ' +
      'Real mode only (Noop adapters report status=skipped).',
  })
  async ready() {
    return this.healthService.readiness();
  }
}
