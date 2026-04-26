import { Injectable, Logger } from '@nestjs/common';
import {
  type CloseDeploymentParams,
  type CommitStateParams,
  type InitializeDeploymentParams,
  type InitializeDeploymentResult,
  type OnchainAdapterPort,
  type OnchainCommitResult,
  type SetLifecycleStatusParams,
  type SetPublicSnapshotParams,
} from './onchain-adapter.port';

/**
 * Default Noop adapter used until the Anchor `strategy_runtime` program lands
 * in Week 3. All methods return null signatures and log at debug level so the
 * deployment lifecycle can be exercised without touching the chain.
 */
@Injectable()
export class NoopOnchainAdapter implements OnchainAdapterPort {
  private readonly logger = new Logger('NoopOnchainAdapter');

  async initializeDeployment(
    params: InitializeDeploymentParams,
  ): Promise<InitializeDeploymentResult> {
    this.logger.debug(
      `[noop] initializeDeployment deployment=${params.deploymentId} strategy=${params.strategyId} version=${params.strategyVersion} mode=${params.executionMode}`,
    );
    return {
      deploymentAccount: null,
      vaultAuthorityAccount: null,
      strategyStateAccount: null,
      publicSnapshotAccount: null,
      signature: null,
    };
  }

  async setLifecycleStatus(
    params: SetLifecycleStatusParams,
  ): Promise<{ signature: string | null }> {
    this.logger.debug(
      `[noop] setLifecycleStatus deployment=${params.deploymentId} status=${params.newStatus}`,
    );
    return { signature: null };
  }

  async commitState(params: CommitStateParams): Promise<OnchainCommitResult> {
    this.logger.debug(
      `[noop] commitState deployment=${params.deploymentId} expectedRevision=${params.expectedRevision}`,
    );
    return { signature: null, newStateRevision: params.expectedRevision + 1 };
  }

  async setPublicSnapshot(params: SetPublicSnapshotParams): Promise<OnchainCommitResult> {
    this.logger.debug(
      `[noop] setPublicSnapshot deployment=${params.deploymentId} expectedSnapshot=${params.expectedSnapshotRevision}`,
    );
    return {
      signature: null,
      newStateRevision: params.expectedSnapshotRevision + 1,
    };
  }

  async closeDeployment(params: CloseDeploymentParams): Promise<{ signature: string | null }> {
    this.logger.debug(`[noop] closeDeployment deployment=${params.deploymentId}`);
    return { signature: null };
  }
}
