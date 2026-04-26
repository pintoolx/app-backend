import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { BN } from '@coral-xyz/anchor';
import { SystemProgram } from '@solana/web3.js';
import { AnchorClientService } from './anchor-client.service';
import {
  type CloseDeploymentParams,
  type CommitStateParams,
  type DeploymentLifecycleStatus,
  type DeploymentExecutionMode,
  type InitializeDeploymentParams,
  type InitializeDeploymentResult,
  type OnchainAdapterPort,
  type OnchainCommitResult,
  type SetLifecycleStatusParams,
  type SetPublicSnapshotParams,
} from './onchain-adapter.port';
import {
  deriveDeploymentPda,
  derivePublicSnapshotPda,
  deriveStrategyStatePda,
  deriveStrategyVersionPda,
  deriveVaultAuthorityPda,
  hexTo32ByteArray,
  uuidToBytes,
} from './anchor/pda';

const LIFECYCLE_TO_CODE: Record<DeploymentLifecycleStatus, number> = {
  draft: 0,
  deployed: 1,
  paused: 2,
  stopped: 3,
  closed: 4,
};

const EXECUTION_MODE_TO_CODE: Record<DeploymentExecutionMode, number> = {
  offchain: 0,
  er: 1,
  per: 2,
};

const RISK_BAND_TO_CODE: Record<string, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const SNAPSHOT_STATUS_TO_CODE: Record<string, number> = {
  running: 0,
  paused: 1,
  stopped: 2,
  closed: 3,
};

/**
 * Anchor-backed implementation of the OnchainAdapterPort.
 *
 * The keeper keypair is used as creator/signer for all instructions in
 * Phase 1 (single-signer model). Future phases will switch to delegated
 * signing where the wallet co-signs and the keeper only relays.
 */
@Injectable()
export class AnchorOnchainAdapterService implements OnchainAdapterPort {
  private readonly logger = new Logger(AnchorOnchainAdapterService.name);

  constructor(private readonly anchorClient: AnchorClientService) {}

  async initializeDeployment(
    params: InitializeDeploymentParams,
  ): Promise<InitializeDeploymentResult> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [strategyVersionPda] = deriveStrategyVersionPda(
      programId,
      params.strategyId,
      params.strategyVersion,
    );
    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [vaultAuthorityPda] = deriveVaultAuthorityPda(programId, deploymentPda);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);
    const [publicSnapshotPda] = derivePublicSnapshotPda(programId, deploymentPda);

    // Idempotently register the strategy version. If the account already
    // exists we skip; any other failure surfaces as 500.
    try {
      await program.methods
        .initializeStrategyVersion(
          this.uuidArray(params.strategyId),
          params.strategyVersion,
          hexTo32ByteArray(params.publicMetadataHash),
          hexTo32ByteArray(params.privateDefinitionCommitment),
        )
        .accountsPartial({
          creator,
          strategyVersion: strategyVersionPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      if (!this.isAccountAlreadyExistsError(err)) {
        throw this.toInternalError('initializeStrategyVersion', err);
      }
      this.logger.debug(
        `strategy_version ${strategyVersionPda.toBase58()} already exists, skipping init`,
      );
    }

    let initSig: string | null = null;
    try {
      initSig = await program.methods
        .initializeDeployment(
          this.uuidArray(params.deploymentId),
          EXECUTION_MODE_TO_CODE[params.executionMode],
          new BN(0),
        )
        .accountsPartial({
          creator,
          strategyVersion: strategyVersionPda,
          deployment: deploymentPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      throw this.toInternalError('initializeDeployment', err);
    }

    try {
      await program.methods
        .initializeVaultAuthority(0)
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          vaultAuthority: vaultAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      throw this.toInternalError('initializeVaultAuthority', err);
    }

    try {
      await program.methods
        .initializeStrategyState()
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      throw this.toInternalError('initializeStrategyState', err);
    }

    try {
      await program.methods
        .setLifecycleStatus(LIFECYCLE_TO_CODE.deployed)
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
    } catch (err) {
      throw this.toInternalError('setLifecycleStatus(deployed)', err);
    }

    return {
      deploymentAccount: deploymentPda.toBase58(),
      vaultAuthorityAccount: vaultAuthorityPda.toBase58(),
      strategyStateAccount: strategyStatePda.toBase58(),
      publicSnapshotAccount: publicSnapshotPda.toBase58(),
      signature: initSig,
    };
  }

  async setLifecycleStatus(
    params: SetLifecycleStatusParams,
  ): Promise<{ signature: string | null }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);

    try {
      const sig = await program.methods
        .setLifecycleStatus(LIFECYCLE_TO_CODE[params.newStatus])
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
      return { signature: sig };
    } catch (err) {
      throw this.toInternalError('setLifecycleStatus', err);
    }
  }

  async commitState(params: CommitStateParams): Promise<OnchainCommitResult> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);

    try {
      const sig = await program.methods
        .commitState(
          params.expectedRevision,
          hexTo32ByteArray(params.newPrivateStateCommitment),
          params.lastResultCode,
        )
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
      return { signature: sig, newStateRevision: params.expectedRevision + 1 };
    } catch (err) {
      throw this.toInternalError('commitState', err);
    }
  }

  async setPublicSnapshot(params: SetPublicSnapshotParams): Promise<OnchainCommitResult> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [publicSnapshotPda] = derivePublicSnapshotPda(programId, deploymentPda);

    const statusCode = SNAPSHOT_STATUS_TO_CODE[params.status] ?? 0;
    const riskBandCode =
      params.riskBand && RISK_BAND_TO_CODE[params.riskBand] !== undefined
        ? RISK_BAND_TO_CODE[params.riskBand]
        : 0;
    const pnlBps = params.pnlSummaryBps ?? 0;

    try {
      const sig = await program.methods
        .setPublicSnapshot(
          params.expectedSnapshotRevision,
          statusCode,
          riskBandCode,
          pnlBps,
          hexTo32ByteArray(params.publicMetricsHash),
        )
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          publicSnapshot: publicSnapshotPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      return {
        signature: sig,
        newStateRevision: params.expectedSnapshotRevision,
      };
    } catch (err) {
      throw this.toInternalError('setPublicSnapshot', err);
    }
  }

  async closeDeployment(params: CloseDeploymentParams): Promise<{ signature: string | null }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);

    try {
      const sig = await program.methods
        .closeDeployment()
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
      return { signature: sig };
    } catch (err) {
      throw this.toInternalError('closeDeployment', err);
    }
  }

  private uuidArray(uuid: string): number[] {
    return Array.from(uuidToBytes(uuid));
  }

  private isAccountAlreadyExistsError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /already in use|0x0$|already initialized/i.test(msg);
  }

  private toInternalError(label: string, err: unknown): InternalServerErrorException {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(`Anchor adapter ${label} failed: ${msg}`);
    return new InternalServerErrorException(`onchain ${label} failed: ${msg}`);
  }
}
