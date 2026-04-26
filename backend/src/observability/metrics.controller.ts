import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';

@ApiTags('Observability')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({
    summary: 'Prometheus metrics exposition (text/plain; version 0.0.4)',
  })
  async metrics(@Res() res: Response) {
    const registry = this.metricsService.getRegistry();
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}
