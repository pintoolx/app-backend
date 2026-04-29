import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { StrategyDeploymentsRepository } from '../strategy-deployments/strategy-deployments.repository';
import { PerGroupsRepository } from '../magicblock/per-groups.repository';
import { UMBRA_ADAPTER, type UmbraAdapterPort } from '../umbra/umbra.port';
import {
  StrategySubscriptionsRepository,
  type StrategySubscriptionRow,
  type SubscriptionStatus,
} from './subscriptions.repository';
import { FollowerVaultsRepository, type FollowerVaultRow } from './follower-vaults.repository';
import {
  FollowerVaultUmbraIdentitiesRepository,
  type FollowerVaultUmbraIdentityRow,
} from './follower-vault-umbra-identities.repository';
import { FollowerVaultSignerService } from './follower-vault-signer.service';
import {
  FollowerVisibilityGrantsRepository,
  type FollowerVisibilityGrantRow,
  type VisibilityGrantScope,
} from './follower-visibility-grants.repository';

export interface FollowerSubscriptionView {
  id: string;
  deploymentId: string;
  followerWallet: string;
  status: SubscriptionStatus;
  visibilityPreset: string;
  allocationMode: string;
  maxCapital: string | null;
  maxDrawdownBps: number | null;
  subscriptionPda: string | null;
  followerVaultPda: string | null;
  vaultAuthorityPda: string | null;
  followerVaultId: string | null;
  umbraIdentity: {
    id: string;
    signerPubkey: string;
    encryptedUserAccount: string | null;
    registrationStatus: 'pending' | 'confirmed' | 'failed' | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  pending_funding: ['active', 'closed'],
  active: ['paused', 'exiting'],
  paused: ['active', 'exiting'],
  exiting: ['closed'],
  closed: [],
};

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly subscriptionsRepository: StrategySubscriptionsRepository,
    private readonly followerVaultsRepository: FollowerVaultsRepository,
    private readonly umbraIdentitiesRepository: FollowerVaultUmbraIdentitiesRepository,
    private readonly grantsRepository: FollowerVisibilityGrantsRepository,
    private readonly deploymentsRepository: StrategyDeploymentsRepository,
    private readonly perGroupsRepository: PerGroupsRepository,
    private readonly signerService: FollowerVaultSignerService,
    @Inject(UMBRA_ADAPTER) private readonly umbraAdapter: UmbraAdapterPort,
  ) {}

  async createSubscription(
    deploymentId: string,
    followerWallet: string,
    params: {
      visibilityPreset?: string;
      maxCapital?: string;
      allocationMode?: 'proportional' | 'fixed' | 'mirror';
      maxDrawdownBps?: number;
    },
  ): Promise<FollowerSubscriptionView> {
    // Ensure the deployment exists; subscription does NOT require creator
    // ownership of the deployment — followers are by definition non-creators.
    const deployment = await this.deploymentsRepository.getById(deploymentId);

    const existing = await this.subscriptionsRepository.getByDeploymentAndFollower(
      deploymentId,
      followerWallet,
    );
    if (existing) {
      throw new BadRequestException('Follower already has a subscription for this deployment');
    }

    // 1) Create the subscription row in pending_funding state.
    const subscription = await this.subscriptionsRepository.insert({
      deploymentId,
      followerWallet,
      subscriptionPda: null,
      followerVaultPda: null,
      vaultAuthorityPda: null,
      visibilityPreset: params.visibilityPreset,
      maxCapital: params.maxCapital ?? null,
      allocationMode: params.allocationMode,
      maxDrawdownBps: params.maxDrawdownBps ?? null,
    });

    // 2) Create the follower vault row.
    const followerVault = await this.followerVaultsRepository.insert({
      subscriptionId: subscription.id,
      deploymentId,
      // Synthetic placeholder PDAs until Anchor accounts land. Deterministic
      // so re-running migrations reproduces the same surface for tests.
      vaultPda: this.placeholderPda('fv', deploymentId, subscription.id),
      authorityPda: this.placeholderPda('fva', deploymentId, subscription.id),
    });

    // 3) Derive a per-vault Umbra signer (HKDF) and register the identity.
    const derived = await this.signerService.deriveFresh();
    let umbraResult;
    try {
      umbraResult = await this.umbraAdapter.registerEncryptedUserAccount({
        walletAddress: derived.pubkey,
        mode: 'confidential',
        signerOverride: { pubkey: derived.pubkey, secretKey: derived.secretKey },
      });
    } catch (err) {
      this.logger.warn(
        `Umbra register failed for follower_vault=${followerVault.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      umbraResult = {
        encryptedUserAccount: null,
        x25519PublicKey: null,
        signerPubkey: derived.pubkey,
        txSignatures: [] as string[],
        status: 'failed' as const,
      };
    } finally {
      // Best-effort wipe of the in-memory secret key once the Umbra call has
      // either succeeded or failed. The DB never sees the secret.
      derived.secretKey.fill(0);
    }

    const umbraIdentity = await this.umbraIdentitiesRepository.insert({
      followerVaultId: followerVault.id,
      signerPubkey: derived.pubkey,
      derivationSalt: derived.derivationSalt,
      x25519PublicKey: umbraResult.x25519PublicKey ?? null,
      encryptedUserAccount: umbraResult.encryptedUserAccount ?? null,
      registrationStatus: umbraResult.status === 'confirmed' ? 'confirmed' : 'pending',
      registerQueueSignature: umbraResult.txSignatures[0] ?? null,
      registerCallbackSignature: umbraResult.txSignatures[1] ?? null,
    });

    // 4) Wire follower into PER permission group as 'subscriber' if a group
    //    already exists for the deployment. Best-effort: PER may not be
    //    bootstrapped if the deployment is offchain/er.
    let perMemberRef: string | null = null;
    try {
      const group = await this.perGroupsRepository.getByDeployment(deploymentId);
      if (group) {
        const nextMembers = [
          ...group.members.filter((m) => m.wallet !== followerWallet),
          { wallet: followerWallet, role: 'subscriber' as const, expiresAt: null },
        ];
        const updated = await this.perGroupsRepository.replaceMembers(
          deploymentId,
          deployment.creator_wallet_address,
          nextMembers,
        );
        perMemberRef = updated.group_id;
      }
    } catch (err) {
      this.logger.warn(
        `PER membership add failed for follower_vault=${followerVault.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    // 5) Backfill subscription with the synthesized references.
    const finalRow = await this.subscriptionsRepository.update(subscription.id, {
      umbraIdentityRef: umbraIdentity.id,
      followerVaultPda: followerVault.vault_pda,
      vaultAuthorityPda: followerVault.authority_pda,
      subscriptionPda: this.placeholderPda('sub', deploymentId, subscription.id),
      perMemberRef,
    });

    return this.toView(finalRow, followerVault, umbraIdentity);
  }

  async getSubscriptionView(deploymentId: string, subscriptionId: string) {
    const sub = await this.subscriptionsRepository.getById(subscriptionId);
    if (sub.deployment_id !== deploymentId) {
      throw new NotFoundException('Subscription not found for this deployment');
    }
    const vault = await this.followerVaultsRepository.getBySubscriptionId(sub.id);
    const identity = sub.umbra_identity_ref
      ? await this.umbraIdentitiesRepository.getById(sub.umbra_identity_ref)
      : null;
    return this.toView(sub, vault, identity);
  }

  /**
   * List every subscription owned by `walletAddress` across all deployments.
   * Used by the follower-side `GET /subscriptions/me` endpoint so a follower
   * can audit their portfolio without enumerating sibling vaults.
   */
  async listForFollower(
    walletAddress: string,
    opts: { status?: SubscriptionStatus } = {},
  ): Promise<FollowerSubscriptionView[]> {
    const rows = await this.subscriptionsRepository.listForFollower(walletAddress, opts);
    return Promise.all(rows.map((row) => this.materializeView(row)));
  }

  /**
   * List every subscription attached to `deploymentId`. Only the deployment
   * creator can call this (admin dashboards have a separate, broader read
   * surface). The view never enumerates raw treasury balances or strategy
   * params — only the same projection followers see for themselves.
   */
  async listForDeployment(
    deploymentId: string,
    walletAddress: string,
  ): Promise<FollowerSubscriptionView[]> {
    // Reject non-creators upstream.
    await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    const rows = await this.subscriptionsRepository.listByDeployment(deploymentId);
    return Promise.all(rows.map((row) => this.materializeView(row)));
  }

  async getGrant(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
    grantId: string,
  ): Promise<FollowerVisibilityGrantRow> {
    await this.assertOwnership(deploymentId, subscriptionId, walletAddress);
    const grant = await this.grantsRepository.getById(grantId);
    if (grant.subscription_id !== subscriptionId) {
      throw new NotFoundException('Visibility grant does not belong to this subscription');
    }
    return grant;
  }

  async transitionStatus(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
    nextStatus: SubscriptionStatus,
  ): Promise<FollowerSubscriptionView> {
    const sub = await this.assertOwnership(deploymentId, subscriptionId, walletAddress);
    const allowed = ALLOWED_TRANSITIONS[sub.status];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(
        `Cannot transition subscription from ${sub.status} to ${nextStatus}`,
      );
    }
    const updated = await this.subscriptionsRepository.update(sub.id, {
      status: nextStatus,
    });
    if (nextStatus === 'active' || nextStatus === 'paused' || nextStatus === 'closed') {
      const vaultLifecycle = nextStatus === 'closed' ? 'closed' : nextStatus;
      const vault = await this.followerVaultsRepository.getBySubscriptionId(sub.id);
      if (vault) {
        await this.followerVaultsRepository.update(vault.id, {
          lifecycleStatus: vaultLifecycle,
        });
      }
    }
    const vault = await this.followerVaultsRepository.getBySubscriptionId(sub.id);
    const identity = updated.umbra_identity_ref
      ? await this.umbraIdentitiesRepository.getById(updated.umbra_identity_ref)
      : null;
    return this.toView(updated, vault, identity);
  }

  async fundIntent(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
    params: { mint: string; amount: string },
  ) {
    const sub = await this.assertOwnership(deploymentId, subscriptionId, walletAddress);
    if (sub.status !== 'pending_funding' && sub.status !== 'active') {
      throw new BadRequestException(
        'Subscription must be pending_funding or active to build a fund intent',
      );
    }
    return {
      subscriptionId: sub.id,
      followerVaultPda: sub.follower_vault_pda,
      vaultAuthorityPda: sub.vault_authority_pda,
      mint: params.mint,
      amount: params.amount,
      // Phase 1 returns a public funding plan only. Real signed transaction
      // construction (e.g. via the Crossmint / wallet bridge) lands later.
      action: 'transfer-to-follower-vault',
      hint: 'Sign and submit a public SPL transfer to vaultAuthorityPda before calling /shield',
    };
  }

  async shieldFunds(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
    params: { mint: string; amount: string },
  ) {
    const sub = await this.assertOwnership(deploymentId, subscriptionId, walletAddress);
    if (!sub.umbra_identity_ref) {
      throw new BadRequestException('Subscription is missing an Umbra identity; cannot shield');
    }
    const identity = await this.umbraIdentitiesRepository.getById(sub.umbra_identity_ref);
    if (!identity) {
      throw new NotFoundException('Umbra identity not found');
    }
    const derived = await this.signerService.derive(identity.derivation_salt);
    let result;
    try {
      result = await this.umbraAdapter.deposit({
        deploymentId,
        fromWallet: derived.pubkey,
        mint: params.mint,
        amount: params.amount,
        signerOverride: { pubkey: derived.pubkey, secretKey: derived.secretKey },
      });
    } finally {
      derived.secretKey.fill(0);
    }

    if (sub.status === 'pending_funding') {
      await this.subscriptionsRepository.update(sub.id, { status: 'active' });
      const vault = await this.followerVaultsRepository.getBySubscriptionId(sub.id);
      if (vault) {
        await this.followerVaultsRepository.update(vault.id, { lifecycleStatus: 'active' });
      }
    }

    return {
      subscriptionId: sub.id,
      umbraIdentityRef: identity.id,
      queueSignature: result.queueSignature,
      callbackSignature: result.callbackSignature,
      status: result.status,
    };
  }

  async getPrivateBalance(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
    params: { mint: string },
  ) {
    const sub = await this.assertOwnership(deploymentId, subscriptionId, walletAddress);
    if (!sub.umbra_identity_ref) {
      throw new BadRequestException('Subscription is missing an Umbra identity');
    }
    const identity = await this.umbraIdentitiesRepository.getById(sub.umbra_identity_ref);
    if (!identity) throw new NotFoundException('Umbra identity not found');

    const derived = await this.signerService.derive(identity.derivation_salt);
    try {
      const balance = await this.umbraAdapter.getEncryptedBalance({
        deploymentId,
        walletAddress: derived.pubkey,
        mint: params.mint,
        signerOverride: { pubkey: derived.pubkey, secretKey: derived.secretKey },
      });
      return {
        subscriptionId: sub.id,
        signerPubkey: derived.pubkey,
        ...balance,
      };
    } finally {
      derived.secretKey.fill(0);
    }
  }

  async createGrant(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
    params: { granteeWallet: string; scope: VisibilityGrantScope; expiresAt?: string },
  ): Promise<FollowerVisibilityGrantRow> {
    await this.assertOwnership(deploymentId, subscriptionId, walletAddress);
    return this.grantsRepository.insert({
      subscriptionId,
      granteeWallet: params.granteeWallet,
      scope: params.scope,
      expiresAt: params.expiresAt ?? null,
    });
  }

  async listGrants(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
  ): Promise<FollowerVisibilityGrantRow[]> {
    await this.assertOwnership(deploymentId, subscriptionId, walletAddress);
    return this.grantsRepository.listBySubscription(subscriptionId);
  }

  async revokeGrant(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
    grantId: string,
  ): Promise<FollowerVisibilityGrantRow> {
    await this.assertOwnership(deploymentId, subscriptionId, walletAddress);
    const grant = await this.grantsRepository.getById(grantId);
    if (grant.subscription_id !== subscriptionId) {
      throw new NotFoundException('Visibility grant does not belong to this subscription');
    }
    return this.grantsRepository.revoke(grantId);
  }

  // --------------------------------------------------------------------- helpers

  /**
   * Hydrate a raw subscription row with its follower vault and umbra identity
   * projection. Pulls each side concurrently to keep list endpoints O(N) on
   * roundtrips rather than O(3N).
   */
  private async materializeView(
    sub: StrategySubscriptionRow,
  ): Promise<FollowerSubscriptionView> {
    const [vault, identity] = await Promise.all([
      this.followerVaultsRepository.getBySubscriptionId(sub.id),
      sub.umbra_identity_ref
        ? this.umbraIdentitiesRepository.getById(sub.umbra_identity_ref)
        : Promise.resolve(null),
    ]);
    return this.toView(sub, vault, identity);
  }

  private async assertOwnership(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
  ): Promise<StrategySubscriptionRow> {
    const sub = await this.subscriptionsRepository.getById(subscriptionId);
    if (sub.deployment_id !== deploymentId) {
      throw new NotFoundException('Subscription not found for this deployment');
    }
    if (sub.follower_wallet !== walletAddress) {
      throw new NotFoundException('Subscription not found for the authenticated follower');
    }
    return sub;
  }

  private placeholderPda(
    prefix: 'sub' | 'fv' | 'fva',
    deploymentId: string,
    subscriptionId: string,
  ): string {
    const hash = createHash('sha256')
      .update(`${prefix}|${deploymentId}|${subscriptionId}`)
      .digest('hex');
    // Tag as a placeholder so reads can identify "not yet a real PDA".
    return `placeholder-${prefix}-${hash.slice(0, 32)}`;
  }

  private toView(
    sub: StrategySubscriptionRow,
    vault: FollowerVaultRow | null,
    identity: FollowerVaultUmbraIdentityRow | null,
  ): FollowerSubscriptionView {
    return {
      id: sub.id,
      deploymentId: sub.deployment_id,
      followerWallet: sub.follower_wallet,
      status: sub.status,
      visibilityPreset: sub.visibility_preset,
      allocationMode: sub.allocation_mode,
      maxCapital: sub.max_capital,
      maxDrawdownBps: sub.max_drawdown_bps,
      subscriptionPda: sub.subscription_pda,
      followerVaultPda: sub.follower_vault_pda,
      vaultAuthorityPda: sub.vault_authority_pda,
      followerVaultId: vault?.id ?? null,
      umbraIdentity: identity
        ? {
            id: identity.id,
            signerPubkey: identity.signer_pubkey,
            encryptedUserAccount: identity.encrypted_user_account,
            registrationStatus: identity.registration_status,
          }
        : null,
      createdAt: sub.created_at,
      updatedAt: sub.updated_at,
    };
  }
}
