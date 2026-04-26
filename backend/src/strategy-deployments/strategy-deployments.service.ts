import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StrategiesRepository } from '../strategies/strategies.repository';
import { StrategyVersionsRepository } from '../strategies/strategy-versions.repository';
import {
  ONCHAIN_ADAPTER,
  type DeploymentExecutionMode,
  type OnchainAdapterPort,
} from '../onchain/onchain-adapter.port';
import {
  MAGICBLOCK_ER_ADAPTER,
  MAGICBLOCK_PER_ADAPTER,
  MAGICBLOCK_PRIVATE_PAYMENTS_ADAPTER,
  type MagicBlockErAdapterPort,
  type MagicBlockPerAdapterPort,
  type MagicBlockPrivatePaymentsAdapterPort,
  type PerMemberRole,
} from '../magicblock/magicblock.port';
import { PerGroupsRepository } from '../magicblock/per-groups.repository';
import { PerAuthTokensRepository } from '../magicblock/per-auth-tokens.repository';
import { UMBRA_ADAPTER, type UmbraAdapterPort } from '../umbra/umbra.port';
import {
  StrategyDeploymentsRepository,
  type DeploymentLifecycleStatus,
  type DeploymentTreasuryMode,
  type StrategyDeploymentRow,
} from './strategy-deployments.repository';
import { type CreateDeploymentDto } from './dto/create-deployment.dto';

export interface DeploymentView {
  id: string;
  strategyId: string;
  strategyVersionId: string | null;
  creatorWalletAddress: string;
  accountId: string | null;
  executionMode: DeploymentExecutionMode;
  treasuryMode: DeploymentTreasuryMode;
  lifecycleStatus: DeploymentLifecycleStatus;
  stateRevision: number;
  privateStateAccount: string | null;
  publicSnapshotAccount: string | null;
  erSessionId: string | null;
  perSessionId: string | null;
  umbraUserAccount: string | null;
  createdAt: string;
  updatedAt: string;
  erRouterUrl: string | null;
  erDelegateSignature: string | null;
  erUndelegateSignature: string | null;
  erCommittedAt: string | null;
  umbraX25519Pubkey: string | null;
  umbraSignerPubkey: string | null;
  umbraRegistrationStatus: 'pending' | 'confirmed' | 'failed' | null;
  perEndpointUrl: string | null;
  ppSessionId: string | null;
  ppEndpointUrl: string | null;
}

/**
 * Allowed lifecycle transitions per spec §9.2.
 *  draft  -> deployed (on deploy create)
 *  deployed <-> paused
 *  deployed -> stopped, paused -> stopped
 *  stopped -> closed
 */
const ALLOWED_LIFECYCLE_TRANSITIONS: Record<
  DeploymentLifecycleStatus,
  DeploymentLifecycleStatus[]
> = {
  draft: ['deployed'],
  deployed: ['paused', 'stopped'],
  paused: ['deployed', 'stopped'],
  stopped: ['closed'],
  closed: [],
};

@Injectable()
export class StrategyDeploymentsService {
  private readonly logger = new Logger(StrategyDeploymentsService.name);

  constructor(
    private readonly deploymentsRepository: StrategyDeploymentsRepository,
    private readonly strategiesRepository: StrategiesRepository,
    private readonly strategyVersionsRepository: StrategyVersionsRepository,
    @Inject(ONCHAIN_ADAPTER) private readonly onchainAdapter: OnchainAdapterPort,
    @Inject(MAGICBLOCK_ER_ADAPTER) private readonly erAdapter: MagicBlockErAdapterPort,
    @Inject(MAGICBLOCK_PER_ADAPTER) private readonly perAdapter: MagicBlockPerAdapterPort,
    @Inject(MAGICBLOCK_PRIVATE_PAYMENTS_ADAPTER)
    private readonly ppAdapter: MagicBlockPrivatePaymentsAdapterPort,
    @Inject(UMBRA_ADAPTER) private readonly umbraAdapter: UmbraAdapterPort,
    private readonly perGroupsRepository: PerGroupsRepository,
    private readonly perAuthTokensRepository: PerAuthTokensRepository,
  ) {}

  async createDeployment(
    walletAddress: string,
    strategyId: string,
    dto: CreateDeploymentDto,
  ): Promise<DeploymentView> {
    const strategy = await this.strategiesRepository.getStrategyForCreator(
      strategyId,
      walletAddress,
    );

    if (strategy.lifecycle_state !== 'published') {
      throw new BadRequestException('Strategy must be published before it can be deployed');
    }

    if (!strategy.compiled_ir) {
      throw new BadRequestException('Strategy is missing compiled IR; recompile before deploy');
    }

    await this.deploymentsRepository.assertAccountOwnership(dto.accountId, walletAddress);
    const version = await this.strategyVersionsRepository.getLatestPublished(strategyId);

    const compiled = strategy.compiled_ir;
    const executionMode = dto.executionMode ?? this.resolveExecutionModeFromHints(compiled);
    const treasuryMode = dto.treasuryMode ?? this.resolveTreasuryModeFromHints(compiled);

    // Generate the deployment UUID up-front so the same id is used for the
    // PDA seed and the DB primary key (Anchor adapter needs a stable id).
    const deploymentId = randomUUID();

    const onchainResult = await this.onchainAdapter.initializeDeployment({
      deploymentId,
      strategyId,
      strategyVersion: version.version,
      creatorWallet: walletAddress,
      vaultOwnerHint: dto.accountId,
      publicMetadataHash: compiled.publicMetadata.publicMetadataHash,
      privateDefinitionCommitment: compiled.privateDefinition.privateDefinitionCommitment,
      executionMode,
    });

    const inserted = await this.deploymentsRepository.insertDeployment({
      id: deploymentId,
      strategyId,
      strategyVersionId: version.id,
      creatorWalletAddress: walletAddress,
      accountId: dto.accountId,
      executionMode,
      treasuryMode,
      lifecycleStatus: 'deployed',
      privateStateAccount: onchainResult.strategyStateAccount,
      publicSnapshotAccount: onchainResult.publicSnapshotAccount,
      metadata: dto.metadata ?? {},
    });

    // Auto-hook: register an Umbra EUA when treasury_mode === 'umbra' so the
    // deployment is ready to receive shielded deposits without an extra API
    // round-trip. The adapter is responsible for env-presence gating.
    let postUmbra = inserted;
    if (treasuryMode === 'umbra') {
      try {
        const reg = await this.umbraAdapter.registerEncryptedUserAccount({
          walletAddress,
          mode: 'confidential',
          // deploymentId is accepted by the real adapter; Noop ignores extras.
          ...({ deploymentId: inserted.id } as Record<string, unknown>),
        });
        postUmbra = await this.deploymentsRepository.updateDeployment(inserted.id, walletAddress, {
          umbraUserAccount: reg.encryptedUserAccount,
          umbraX25519Pubkey: reg.x25519PublicKey,
          umbraSignerPubkey: reg.encryptedUserAccount, // adapter returns signer pubkey here
          umbraRegistrationStatus: reg.status === 'confirmed' ? 'confirmed' : 'pending',
          umbraRegisterQueueSignature: reg.queueSignature,
          umbraRegisterCallbackSignature: reg.callbackSignature,
        });
      } catch (err) {
        this.logger.warn(
          `Umbra auto-register failed for deployment=${inserted.id}: ${err instanceof Error ? err.message : err}`,
        );
        postUmbra = await this.deploymentsRepository.updateDeployment(inserted.id, walletAddress, {
          umbraRegistrationStatus: 'failed',
        });
      }
    }

    // Auto-hook: kick off ER delegation when execution_mode === 'er'. The
    // adapter operates in advisory mode unless metadata.erDelegateBase64Tx is
    // provided; either way we record the resulting session id and signature.
    let postEr = postUmbra;
    if (executionMode === 'er') {
      try {
        const signedTxBase64 =
          typeof (dto.metadata as Record<string, unknown> | undefined)?.erDelegateBase64Tx ===
          'string'
            ? ((dto.metadata as Record<string, unknown>).erDelegateBase64Tx as string)
            : undefined;
        const erRes = await this.erAdapter.delegateAccount({
          deploymentId: inserted.id,
          accountPubkey: postUmbra.private_state_account ?? inserted.private_state_account ?? '',
          ...(signedTxBase64 ? { signedTxBase64 } : {}),
        } as Parameters<MagicBlockErAdapterPort['delegateAccount']>[0]);
        postEr = await this.deploymentsRepository.updateDeployment(inserted.id, walletAddress, {
          erSessionId: erRes.sessionId ?? null,
          erDelegateSignature: erRes.signature ?? null,
          erRouterUrl:
            (this as unknown as { resolveRouterUrl?: () => string | null }).resolveRouterUrl?.() ??
            null,
          erCommittedAt: erRes.signature ? new Date().toISOString() : null,
        });
      } catch (err) {
        this.logger.warn(
          `ER auto-delegate failed for deployment=${inserted.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Auto-hook: bootstrap a PER permission group when execution_mode === 'per'.
    // Creator is the sole member at deploy time; additional roles can be added
    // afterwards via POST /deployments/:id/per/groups.
    let postPer = postEr;
    if (executionMode === 'per') {
      try {
        const groupRes = await this.perAdapter.createPermissionGroup({
          deploymentId: inserted.id,
          members: [{ wallet: walletAddress, role: 'creator' }],
        });
        const groupId = groupRes.groupId ?? `per-${inserted.id}`;
        await this.perGroupsRepository.createGroup({
          deploymentId: inserted.id,
          groupId,
          creatorWallet: walletAddress,
          members: [{ wallet: walletAddress, role: 'creator' }],
        });
        postPer = await this.deploymentsRepository.updateDeployment(inserted.id, walletAddress, {
          perSessionId: groupRes.signature ?? groupId,
        });
      } catch (err) {
        this.logger.warn(
          `PER auto-bootstrap failed for deployment=${inserted.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    this.logger.log(
      `Deployment ${postPer.id} created for strategy=${strategyId} version=${version.version} mode=${executionMode} treasury=${treasuryMode}`,
    );

    return this.toView(postPer);
  }

  async getDeploymentForCreator(
    deploymentId: string,
    walletAddress: string,
  ): Promise<DeploymentView> {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    return this.toView(row);
  }

  async listDeploymentsForCreator(walletAddress: string): Promise<DeploymentView[]> {
    const rows = await this.deploymentsRepository.listForCreator(walletAddress);
    return rows.map((row) => this.toView(row));
  }

  async pauseDeployment(deploymentId: string, walletAddress: string): Promise<DeploymentView> {
    return this.transitionLifecycle(deploymentId, walletAddress, 'paused');
  }

  async resumeDeployment(deploymentId: string, walletAddress: string): Promise<DeploymentView> {
    return this.transitionLifecycle(deploymentId, walletAddress, 'deployed');
  }

  async stopDeployment(deploymentId: string, walletAddress: string): Promise<DeploymentView> {
    return this.transitionLifecycle(deploymentId, walletAddress, 'stopped');
  }

  async closeDeployment(deploymentId: string, walletAddress: string): Promise<DeploymentView> {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    const view = await this.transitionLifecycle(deploymentId, walletAddress, 'closed');
    await this.onchainAdapter.closeDeployment({ deploymentId });

    if (row.execution_mode === 'er') {
      try {
        const erRes = await this.erAdapter.commitAndUndelegate({
          deploymentId,
          accountPubkey: row.private_state_account ?? '',
        });
        if (erRes.signature) {
          await this.deploymentsRepository.updateDeployment(deploymentId, walletAddress, {
            erUndelegateSignature: erRes.signature,
            erCommittedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        this.logger.warn(
          `ER auto-undelegate failed for deployment=${deploymentId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Revoke any PER auth tokens issued for this deployment so private state
    // becomes inaccessible after close. Best-effort: failures are logged.
    try {
      await this.perAuthTokensRepository.revokeAllForDeployment(deploymentId);
    } catch (err) {
      this.logger.warn(
        `PER token revoke failed for deployment=${deploymentId}: ${err instanceof Error ? err.message : err}`,
      );
    }
    return view;
  }

  // ---------------------------------------------------------------
  // Week 4 — explicit ER endpoints
  // ---------------------------------------------------------------

  async erDelegate(
    deploymentId: string,
    walletAddress: string,
    signedTxBase64?: string,
  ): Promise<DeploymentView> {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    if (row.execution_mode !== 'er') {
      throw new BadRequestException('Deployment execution_mode must be "er" to delegate');
    }
    const res = await this.erAdapter.delegateAccount({
      deploymentId,
      accountPubkey: row.private_state_account ?? '',
      ...(signedTxBase64 ? { signedTxBase64 } : {}),
    } as Parameters<MagicBlockErAdapterPort['delegateAccount']>[0]);
    const updated = await this.deploymentsRepository.updateDeployment(deploymentId, walletAddress, {
      erSessionId: res.sessionId ?? null,
      erDelegateSignature: res.signature ?? null,
      erCommittedAt: res.signature ? new Date().toISOString() : null,
    });
    return this.toView(updated);
  }

  async erRoute(
    deploymentId: string,
    walletAddress: string,
    base64Tx: string,
  ): Promise<{ signature: string | null; routedThrough: 'er' | 'mainnet' | 'noop' }> {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    if (row.lifecycle_status !== 'deployed' && row.lifecycle_status !== 'paused') {
      throw new BadRequestException('Deployment must be deployed or paused to route transactions');
    }
    return this.erAdapter.route({ deploymentId, base64Tx });
  }

  async erUndelegate(
    deploymentId: string,
    walletAddress: string,
    signedTxBase64?: string,
  ): Promise<DeploymentView> {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    if (row.execution_mode !== 'er') {
      throw new BadRequestException('Deployment execution_mode must be "er" to undelegate');
    }
    const res = await this.erAdapter.commitAndUndelegate({
      deploymentId,
      accountPubkey: row.private_state_account ?? '',
      ...(signedTxBase64 ? { signedTxBase64 } : {}),
    } as Parameters<MagicBlockErAdapterPort['commitAndUndelegate']>[0]);
    const updated = await this.deploymentsRepository.updateDeployment(deploymentId, walletAddress, {
      erUndelegateSignature: res.signature ?? null,
      erCommittedAt: res.signature ? new Date().toISOString() : null,
    });
    return this.toView(updated);
  }

  // ---------------------------------------------------------------
  // Week 4 — explicit Umbra endpoints
  // ---------------------------------------------------------------

  async umbraRegister(
    deploymentId: string,
    walletAddress: string,
    mode: 'confidential' | 'anonymous' = 'confidential',
  ): Promise<DeploymentView> {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    const res = await this.umbraAdapter.registerEncryptedUserAccount({
      walletAddress: row.creator_wallet_address,
      mode,
      ...({ deploymentId } as Record<string, unknown>),
    });
    const updated = await this.deploymentsRepository.updateDeployment(deploymentId, walletAddress, {
      umbraUserAccount: res.encryptedUserAccount,
      umbraX25519Pubkey: res.x25519PublicKey,
      umbraSignerPubkey: res.encryptedUserAccount,
      umbraRegistrationStatus: res.status === 'confirmed' ? 'confirmed' : 'pending',
      umbraRegisterQueueSignature: res.queueSignature,
      umbraRegisterCallbackSignature: res.callbackSignature,
    });
    return this.toView(updated);
  }

  async umbraDeposit(
    deploymentId: string,
    walletAddress: string,
    params: { fromWallet?: string; mint: string; amount: string },
  ) {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    return this.umbraAdapter.deposit({
      deploymentId,
      fromWallet: params.fromWallet ?? row.creator_wallet_address,
      mint: params.mint,
      amount: params.amount,
    });
  }

  async umbraWithdraw(
    deploymentId: string,
    walletAddress: string,
    params: { toWallet: string; mint: string; amount: string },
  ) {
    await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    return this.umbraAdapter.withdraw({
      deploymentId,
      toWallet: params.toWallet,
      mint: params.mint,
      amount: params.amount,
    });
  }

  async umbraTransfer(
    deploymentId: string,
    walletAddress: string,
    params: { fromWallet?: string; toWallet: string; mint: string; amount: string },
  ) {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    return this.umbraAdapter.transfer({
      deploymentId,
      fromWallet: params.fromWallet ?? row.creator_wallet_address,
      toWallet: params.toWallet,
      mint: params.mint,
      amount: params.amount,
    });
  }

  async umbraBalance(
    deploymentId: string,
    walletAddress: string,
    params: { walletAddress?: string; mint: string },
  ) {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    return this.umbraAdapter.getEncryptedBalance({
      deploymentId,
      walletAddress: params.walletAddress ?? row.creator_wallet_address,
      mint: params.mint,
    });
  }

  async umbraGrantViewer(
    deploymentId: string,
    walletAddress: string,
    params: { granteeWallet: string; mint: string; expiresAt?: string },
  ) {
    await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    return this.umbraAdapter.grantViewer({
      deploymentId,
      granteeWallet: params.granteeWallet,
      mint: params.mint,
      expiresAt: params.expiresAt,
    });
  }

  // ---------------------------------------------------------------
  // Week 5 — explicit PER endpoints
  // ---------------------------------------------------------------

  async perReplaceMembers(
    deploymentId: string,
    walletAddress: string,
    members: Array<{ wallet: string; role: PerMemberRole; expiresAt?: string }>,
  ) {
    await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    const replaced = await this.perGroupsRepository.replaceMembers(
      deploymentId,
      walletAddress,
      members.map((m) => ({ wallet: m.wallet, role: m.role, expiresAt: m.expiresAt ?? null })),
    );
    return {
      groupId: replaced.group_id,
      members: replaced.members,
      updatedAt: replaced.updated_at,
    };
  }

  async perRequestChallenge(deploymentId: string, walletAddress: string) {
    await this.deploymentsRepository.getById(deploymentId);
    return this.perAdapter.requestAuthChallenge({ deploymentId, walletAddress });
  }

  async perVerifyChallenge(
    deploymentId: string,
    params: { walletAddress: string; challenge: string; signature: string },
  ) {
    await this.deploymentsRepository.getById(deploymentId);
    return this.perAdapter.verifyAuthSignature({
      deploymentId,
      walletAddress: params.walletAddress,
      challenge: params.challenge,
      signature: params.signature,
    });
  }

  async perGetPrivateState(deploymentId: string, authToken: string) {
    return this.perAdapter.getPrivateState({ deploymentId, authToken });
  }

  // ---------------------------------------------------------------
  // Week 5 — explicit Private Payments endpoints
  // ---------------------------------------------------------------

  async privatePaymentsDeposit(
    deploymentId: string,
    walletAddress: string,
    params: { fromWallet?: string; mint: string; amount: string },
  ) {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    return this.ppAdapter.deposit({
      deploymentId,
      fromWallet: params.fromWallet ?? row.creator_wallet_address,
      mint: params.mint,
      amount: params.amount,
    });
  }

  async privatePaymentsTransfer(
    deploymentId: string,
    walletAddress: string,
    params: { fromWallet?: string; toWallet: string; mint: string; amount: string },
  ) {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    return this.ppAdapter.transfer({
      deploymentId,
      fromWallet: params.fromWallet ?? row.creator_wallet_address,
      toWallet: params.toWallet,
      mint: params.mint,
      amount: params.amount,
    });
  }

  async privatePaymentsWithdraw(
    deploymentId: string,
    walletAddress: string,
    params: { toWallet: string; mint: string; amount: string },
  ) {
    await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    return this.ppAdapter.withdraw({
      deploymentId,
      toWallet: params.toWallet,
      mint: params.mint,
      amount: params.amount,
    });
  }

  async privatePaymentsBalance(
    deploymentId: string,
    walletAddress: string,
    params: { wallet?: string; mint: string },
  ) {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    return this.ppAdapter.getBalance({
      deploymentId,
      wallet: params.wallet ?? row.creator_wallet_address,
      mint: params.mint,
    });
  }

  private async transitionLifecycle(
    deploymentId: string,
    walletAddress: string,
    nextStatus: DeploymentLifecycleStatus,
  ): Promise<DeploymentView> {
    const row = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    const allowed = ALLOWED_LIFECYCLE_TRANSITIONS[row.lifecycle_status];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(
        `Cannot transition deployment from ${row.lifecycle_status} to ${nextStatus}`,
      );
    }

    await this.onchainAdapter.setLifecycleStatus({
      deploymentId,
      newStatus: nextStatus,
    });

    const updated = await this.deploymentsRepository.updateDeployment(deploymentId, walletAddress, {
      lifecycleStatus: nextStatus,
    });
    this.logger.log(
      `Deployment ${deploymentId} transitioned ${row.lifecycle_status} -> ${nextStatus}`,
    );
    return this.toView(updated);
  }

  private resolveExecutionModeFromHints(compiled: {
    deploymentHints: { recommendedExecutionLayer: 'offchain' | 'per' };
  }): DeploymentExecutionMode {
    return compiled.deploymentHints.recommendedExecutionLayer === 'per' ? 'per' : 'offchain';
  }

  private resolveTreasuryModeFromHints(compiled: {
    deploymentHints: {
      recommendedTreasuryPrivacy: 'not_required' | 'private_payments_api';
      optionalBalancePrivacy: 'not_required' | 'umbra';
    };
  }): DeploymentTreasuryMode {
    if (compiled.deploymentHints.recommendedTreasuryPrivacy === 'private_payments_api') {
      return 'private_payments';
    }
    if (compiled.deploymentHints.optionalBalancePrivacy === 'umbra') {
      return 'umbra';
    }
    return 'public';
  }

  private toView(row: StrategyDeploymentRow): DeploymentView {
    return {
      id: row.id,
      strategyId: row.strategy_id,
      strategyVersionId: row.strategy_version_id,
      creatorWalletAddress: row.creator_wallet_address,
      accountId: row.account_id,
      executionMode: row.execution_mode,
      treasuryMode: row.treasury_mode,
      lifecycleStatus: row.lifecycle_status,
      stateRevision: row.state_revision,
      privateStateAccount: row.private_state_account,
      publicSnapshotAccount: row.public_snapshot_account,
      erSessionId: row.er_session_id,
      perSessionId: row.per_session_id,
      umbraUserAccount: row.umbra_user_account,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      erRouterUrl: row.er_router_url,
      erDelegateSignature: row.er_delegate_signature,
      erUndelegateSignature: row.er_undelegate_signature,
      erCommittedAt: row.er_committed_at,
      umbraX25519Pubkey: row.umbra_x25519_pubkey,
      umbraSignerPubkey: row.umbra_signer_pubkey,
      umbraRegistrationStatus: row.umbra_registration_status,
      perEndpointUrl: row.per_endpoint_url,
      ppSessionId: row.pp_session_id,
      ppEndpointUrl: row.pp_endpoint_url,
    };
  }
}
