import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PrivateExecutionCyclesService } from './private-execution-cycles.service';
import { StartPrivateCycleDto } from './dto/private-execution-cycle.dto';

@ApiTags('Follower Vaults — Private Execution Cycles')
@ApiBearerAuth()
@Controller('deployments/:deploymentId/private-execution/cycles')
@UseGuards(JwtAuthGuard)
export class PrivateExecutionCyclesController {
  constructor(private readonly cyclesService: PrivateExecutionCyclesService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Start a private execution cycle. Computes follower allocations and persists sanitized receipts. Phase-1 does not invoke PER.',
  })
  async startCycle(
    @Param('deploymentId') deploymentId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: StartPrivateCycleDto,
  ) {
    const data = await this.cyclesService.startCycle(deploymentId, walletAddress, {
      triggerType: dto.triggerType,
      triggerRef: dto.triggerRef,
      idempotencyKey: dto.idempotencyKey,
      notional: dto.notional,
    });
    return {
      success: true,
      data: {
        cycleId: data.cycle.id,
        status: data.cycle.status,
        startedAt: data.cycle.started_at,
        completedAt: data.cycle.completed_at,
        metricsSummary: data.cycle.metrics_summary,
        receiptCount: data.receipts.length,
      },
    };
  }

  @Get(':cycleId')
  @ApiOperation({
    summary: 'Get a private execution cycle and its sanitized per-follower receipts',
  })
  async getCycle(
    @Param('deploymentId') deploymentId: string,
    @Param('cycleId') cycleId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.cyclesService.getCycle(deploymentId, cycleId, walletAddress);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'List recent private execution cycles for a deployment' })
  async listCycles(
    @Param('deploymentId') deploymentId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.cyclesService.listCycles(
      deploymentId,
      walletAddress,
      limit ? parseInt(limit, 10) : undefined,
    );
    return { success: true, count: data.length, data };
  }
}
