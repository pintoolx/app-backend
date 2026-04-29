import { Injectable, Logger } from '@nestjs/common';
import {
  type FetchStrategyOutputParams,
  type PrivateStrategyOutputProvider,
  type StrategyCycleOutput,
} from './private-cycle-strategy-output';

/**
 * Default Phase-4 strategy output provider. Always returns null so the cycle
 * planner falls back to the legacy `notional + proportional` flow. Real PER-
 * backed providers replace this in production deployments.
 */
@Injectable()
export class NoopPrivateStrategyOutputProvider implements PrivateStrategyOutputProvider {
  private readonly logger = new Logger(NoopPrivateStrategyOutputProvider.name);

  async getCycleOutput(_params: FetchStrategyOutputParams): Promise<StrategyCycleOutput | null> {
    this.logger.debug(
      `[noop strategy provider] cycle=${_params.cycleId} idempotencyKey=${_params.idempotencyKey} replan=${_params.replan} → null`,
    );
    return null;
  }
}
