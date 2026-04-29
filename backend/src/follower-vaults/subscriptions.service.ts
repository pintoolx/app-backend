import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { StrategyDeploymentsRepository } from '../strategy-deployments/strategy-deployments.repository';
import { PerGroupsRepository } from '../magicblock/per-groups.repository';
import { PerAuthTokensRepository, type PerAuthTokenRow } from '../magicblock/per-auth-tokens.repository';
import {
  MAGICBLOCK_PER_ADAPTER,
  type MagicBlockPerAdapterPort,
} from '../magicblock/magicblock.port';
import { UMBRA_ADAPTER, type UmbraAdapterPort } from '../umbra/umbra.port';
import {
  ONCHAIN_ADAPTER,
  type FollowerPdaSet,
  type FollowerVaultLifecycleStatus,
  type OnchainAdapterPort,
} from '../onchain/onchain-adapter.port';
import {
  StrategySubscriptionsRepository,
  type StrategySubscriptionRow,
  type SubscriptionProvisioningState,
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
import { FollowerVisibilityPolicyService } from './follower-visibility-policy.service';

/** Phase-1: subscription PER auth token TTLs. */
const SUBSCRIPTION_CHALLENGE_TTL_MS = 30 * 1000;
const SUBSCRIPTION_TOKEN_TTL_MS = 10 * 60 * 1000;
/**
 * Phase-1 hardening: tolerate small clock skew between client/server when
 * comparing challenge `expires_at` to wall clock. Keeps the 30s window
 * usable across modest clock drift without re-issuing.
 */
const SUBSCRIPTION_CLOCK_SKEW_MS = 5 * 1000;
/**
 * Phase-2: synchronous retry budget for `setFollowerVaultStatus` when the
 * follower vault lifecycle is being mirrored on-chain. Three attempts with
 * exponential backoff (1s/4s/16s). After the budget, the row is flagged with
 * `lifecycle_drift = true` for admin reconciliation.
 */
const LIFECYCLE_RETRY_DELAYS_MS = [1_000, 4_000, 16_000] as const;

/** PER scope strings issued for follower self-visibility flows. */
export const PER_SCOPE_SUBSCRIPTION_AUTH_CHALLENGE = 'per:subscription-auth-challenge';
export const PER_SCOPE_SUBSCRIPTION_PRIVATE_STATE = 'per:subscription-private-state';

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
  /**
   * Phase-2 provisioning surface. Tells the caller where on the on-chain
   * wiring journey this subscription is, so admins/UI can decide whether to
   * trigger `resume-provisioning` or surface a drift warning.
   */
  provisioningState: SubscriptionProvisioningState;
  provisioningError: string | null;
  lifecycleDrift: boolean;
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
    private readonly perAuthTokensRepository: PerAuthTokensRepository,
    private readonly signerService: FollowerVaultSignerService,
    private readonly visibilityPolicy: FollowerVisibilityPolicyService,
    @Inject(UMBRA_ADAPTER) private readonly umbraAdapter: UmbraAdapterPort,
    @Inject(MAGICBLOCK_PER_ADAPTER) private readonly perAdapter: MagicBlockPerAdapterPort,
    @Inject(ONCHAIN_ADAPTER) private readonly onchainAdapter: OnchainAdapterPort,
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
    await this.deploymentsRepository.getById(deploymentId);

    const existing = await this.subscriptionsRepository.getByDeploymentAndFollower(
      deploymentId,
      followerWallet,
    );
    if (existing) {
      throw new BadRequestException('Follower already has a subscription for this deployment');
    }

    // Phase-2: derive REAL Anchor PDAs up front so the placeholder prefix
    // never reaches the database. Adapter handles dev/prod selection.
    const pdas = await this.onchainAdapter.deriveFollowerPdas({
      deploymentId,
      followerWallet,
    });

    // 1) Create the subscription row in db_inserted state with real PDAs.
    const subscription = await this.subscriptionsRepository.insert({
      deploymentId,
      followerWallet,
      subscriptionPda: pdas.subscriptionPda,
      followerVaultPda: pdas.followerVaultPda,
      vaultAuthorityPda: pdas.vaultAuthorityPda,
      visibilityPreset: params.visibilityPreset,
      maxCapital: params.maxCapital ?? null,
      allocationMode: params.allocationMode,
      maxDrawdownBps: params.maxDrawdownBps ?? null,
      provisioningState: 'db_inserted',
      subscriptionPdaBump: pdas.subscriptionPdaBump,
      followerVaultPdaBump: pdas.followerVaultPdaBump,
      vaultAuthorityPdaBump: pdas.vaultAuthorityPdaBump,
    });

    // 2) Create the follower vault row with real PDAs.
    const followerVault = await this.followerVaultsRepository.insert({
      subscriptionId: subscription.id,
      deploymentId,
      vaultPda: pdas.followerVaultPda,
      authorityPda: pdas.vaultAuthorityPda,
    });

    return this.runProvisioningStateMachine(subscription, followerVault, pdas, followerWallet);
  }

  /**
   * Resume a previously interrupted provisioning flow. Re-evaluates current
   * state and continues from the next pending step. Idempotent: if the row
   * is already `provisioning_complete`, returns the current view without
   * mutating anything.
   *
   * Owner-only — the follower whose JWT identity matches `follower_wallet`
   * may invoke this. (See `assertOwnership` for enforcement.)
   */
  async resumeSubscriptionProvisioning(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
  ): Promise<FollowerSubscriptionView> {
    const sub = await this.assertOwnership(deploymentId, subscriptionId, walletAddress);
    if (sub.provisioning_state === 'provisioning_complete') {
      const vault = await this.followerVaultsRepository.getBySubscriptionId(sub.id);
      const identity = sub.umbra_identity_ref
        ? await this.umbraIdentitiesRepository.getById(sub.umbra_identity_ref)
        : null;
      return this.toView(sub, vault, identity);
    }
    if (sub.provisioning_state === 'legacy_placeholder') {
      throw new BadRequestException(
        'Subscription has legacy placeholder PDAs and requires migration before resume',
      );
    }
    // Re-derive PDAs deterministically — same seed inputs always produce the
    // same address, so resuming is safe even if env config changed slightly.
    const pdas = await this.onchainAdapter.deriveFollowerPdas({
      deploymentId,
      followerWallet: sub.follower_wallet,
    });
    const vault = await this.followerVaultsRepository.getBySubscriptionId(sub.id);
    if (!vault) {
      // Defensive: re-create vault row with real PDAs (rare — only if a row
      // was deleted out from under us).
      const recreated = await this.followerVaultsRepository.insert({
        subscriptionId: sub.id,
        deploymentId,
        vaultPda: pdas.followerVaultPda,
        authorityPda: pdas.vaultAuthorityPda,
      });
      return this.runProvisioningStateMachine(sub, recreated, pdas, sub.follower_wallet);
    }
    return this.runProvisioningStateMachine(sub, vault, pdas, sub.follower_wallet);
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

    // Phase-1 hardening: when entering exiting/closed, revoke any still-live
    // subscription-scoped PER tokens so a follower cannot keep reading state
    // after they've initiated exit. Best-effort: failure to revoke logs but
    // does not block the state transition itself.
    if (nextStatus === 'exiting' || nextStatus === 'closed') {
      try {
        await this.perAuthTokensRepository.revokeAllForSubscription(sub.id);
      } catch (err) {
        this.logger.warn(
          `failed to revoke subscription-scoped PER tokens for ${sub.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    const updated = await this.subscriptionsRepository.update(sub.id, {
      status: nextStatus,
    });
    let vault = await this.followerVaultsRepository.getBySubscriptionId(sub.id);
    if (nextStatus === 'active' || nextStatus === 'paused' || nextStatus === 'closed') {
      const vaultLifecycle: FollowerVaultLifecycleStatus =
        nextStatus === 'closed' ? 'closed' : nextStatus;
      if (vault) {
        vault = await this.followerVaultsRepository.update(vault.id, {
          lifecycleStatus: vaultLifecycle,
        });
      }
      // Best-effort on-chain mirror with bounded retries. If we exhaust the
      // budget we set lifecycle_drift = true so admins can reconcile out of
      // band; we never block the user-visible state transition.
      if (vault?.vault_pda && updated.subscription_pda) {
        await this.mirrorLifecycleOnchain(
          updated,
          vault.vault_pda,
          updated.subscription_pda,
          vaultLifecycle,
        );
      }
    }
    const finalVault = await this.followerVaultsRepository.getBySubscriptionId(sub.id);
    const finalSub = await this.subscriptionsRepository.getById(sub.id);
    const identity = finalSub.umbra_identity_ref
      ? await this.umbraIdentitiesRepository.getById(finalSub.umbra_identity_ref)
      : null;
    return this.toView(finalSub, finalVault, identity);
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
    if (!sub.vault_authority_pda) {
      throw new BadRequestException(
        'Subscription has no vault_authority PDA — provisioning incomplete; call /resume-provisioning first',
      );
    }
    let instruction: {
      instructionBase64: string;
      recentBlockhash: string | null;
    } | null = null;
    try {
      const built = await this.onchainAdapter.buildFundIntentInstruction({
        vaultAuthorityPda: sub.vault_authority_pda,
        mint: params.mint,
        amount: params.amount,
        fromWallet: walletAddress,
      });
      instruction = {
        instructionBase64: built.instructionBase64,
        recentBlockhash: built.recentBlockhash,
      };
    } catch (err) {
      this.logger.warn(
        `fundIntent: failed to build instruction for sub=${sub.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    return {
      subscriptionId: sub.id,
      followerVaultPda: sub.follower_vault_pda,
      vaultAuthorityPda: sub.vault_authority_pda,
      mint: params.mint,
      amount: params.amount,
      action: 'transfer-to-follower-vault',
      humanReadable:
        'Sign and submit the unsigned instruction to transfer funds to vaultAuthorityPda before calling /shield',
      instruction,
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
    // Phase-3: replace strict ownership with policy-driven access. Owners
    // always pass; non-owners must hold an active `vault-balance` grant.
    const sub = await this.subscriptionsRepository.getById(subscriptionId);
    if (sub.deployment_id !== deploymentId) {
      throw new NotFoundException('Subscription not found for this deployment');
    }
    const decision = await this.visibilityPolicy.canReadPrivateBalance(walletAddress, sub);
    if (!decision.allowed) {
      throw new UnauthorizedException(
        `wallet ${walletAddress} is not allowed to read private balance for this subscription`,
      );
    }
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
        accessReason: decision.reason,
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

  // ---------------------------------------- Phase-1 follower-self PER auth

  /**
   * Issue a subscription-scoped PER challenge. The challenge token MUST be
   * exchanged via {@link verifySubscriptionChallenge} before it can be used
   * to read follower-private state.
   *
   * The follower-self auth flow does NOT proxy to the TEE — the TEE flow is
   * for deployment-wide creator/operator access. Subscription-scoped tokens
   * are signed by the follower’s wallet and verified by the platform JWT
   * guard before reaching this method, so we issue a server-side nonce and
   * a short-lived challenge row directly.
   */
  async issueSubscriptionChallenge(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
  ): Promise<{ challenge: string; expiresAt: string }> {
    const sub = await this.assertOwnership(deploymentId, subscriptionId, walletAddress);
    const challenge = `per-subscription-challenge-${randomBytes(16).toString('hex')}`;
    const expiresAt = new Date(Date.now() + SUBSCRIPTION_CHALLENGE_TTL_MS).toISOString();
    await this.perAuthTokensRepository.insertChallenge({
      token: challenge,
      deploymentId,
      wallet: walletAddress,
      groupId: sub.per_member_ref ?? null,
      expiresAt,
      scopes: [PER_SCOPE_SUBSCRIPTION_AUTH_CHALLENGE],
      scopeKind: 'subscription',
      subscriptionId: sub.id,
    });
    this.logger.log(
      `subscription challenge issued deployment=${deploymentId} subscription=${subscriptionId} wallet=${walletAddress}`,
    );
    return { challenge, expiresAt };
  }

  /**
   * Verify a subscription-scoped challenge and promote it to an active
   * follower-self PER token. Caller is the follower (already JWT-auth'd).
   *
   * Phase-1 trusts the JWT-authenticated wallet rather than re-verifying an
   * offline signature here. The challenge row exists only to enforce a
   * short-lived single-use ticket so the flow stays compatible with future
   * signature-based verifiers (e.g. when the TEE supports follower-scoped
   * sessions).
   */
  async verifySubscriptionChallenge(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
    challenge: string,
  ): Promise<{ authToken: string; expiresAt: string }> {
    await this.assertOwnership(deploymentId, subscriptionId, walletAddress);
    const row = await this.perAuthTokensRepository.getByToken(challenge);
    if (!row) throw new UnauthorizedException('Unknown subscription challenge');
    if (row.status !== 'challenge') {
      throw new UnauthorizedException(`Challenge is ${row.status}`);
    }
    if (row.scope_kind !== 'subscription' || row.subscription_id !== subscriptionId) {
      throw new UnauthorizedException('Challenge is not scoped to this subscription');
    }
    if (row.deployment_id !== deploymentId) {
      throw new UnauthorizedException('Challenge does not belong to this deployment');
    }
    if (row.wallet !== walletAddress) {
      throw new UnauthorizedException('Challenge does not belong to this wallet');
    }
    // Phase-1 hardening: tolerate small clock skew so a 30s challenge does
    // not fail under modest client/server clock drift.
    if (new Date(row.expires_at).getTime() + SUBSCRIPTION_CLOCK_SKEW_MS <= Date.now()) {
      throw new UnauthorizedException('Challenge expired');
    }
    const newExpiresAt = new Date(Date.now() + SUBSCRIPTION_TOKEN_TTL_MS).toISOString();
    const promoted = await this.perAuthTokensRepository.promoteChallenge(challenge, newExpiresAt);
    return { authToken: promoted.token, expiresAt: promoted.expires_at };
  }

  /**
   * Read follower-self private state via PER. Token (already validated by
   * `PerAuthGuard`) MUST be a subscription-scoped token bound to this
   * subscription — enforced by callers via `assertSubscriptionScope`.
   *
   * Returns sanitized state only. PER adapter is responsible for never
   * returning deployment-wide blobs through this surface; this method also
   * performs an ownership check to guard against caller mistakes.
   */
  async getFollowerPrivateState(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
    perToken: PerAuthTokenRow,
  ): Promise<{
    subscriptionId: string;
    followerVaultId: string | null;
    state: Record<string, unknown> | null;
    logs: Array<Record<string, unknown>>;
    privateStateRevision: number | null;
    accessReason?: 'owner' | 'grant';
  }> {
    const sub = await this.subscriptionsRepository.getById(subscriptionId);
    if (sub.deployment_id !== deploymentId) {
      throw new NotFoundException('Subscription not found for this deployment');
    }
    // Phase-3: enforce policy-based access. Owners pass; non-owners need an
    // active `vault-state` grant.
    const decision = await this.visibilityPolicy.canReadPrivateState(walletAddress, sub);
    if (!decision.allowed) {
      throw new UnauthorizedException(
        `wallet ${walletAddress} is not allowed to read private state for this subscription`,
      );
    }
    if (
      perToken.scope_kind !== 'subscription' ||
      perToken.subscription_id !== subscriptionId ||
      perToken.deployment_id !== deploymentId ||
      perToken.wallet !== walletAddress
    ) {
      throw new UnauthorizedException('PER token is not scoped to this follower subscription');
    }
    const vault = await this.followerVaultsRepository.getBySubscriptionId(sub.id);
    if (!vault) {
      // Vault may legitimately be missing for legacy/in-flight rows.
      return {
        subscriptionId: sub.id,
        followerVaultId: null,
        state: null,
        logs: [],
        privateStateRevision: null,
        accessReason: decision.reason,
      };
    }
    const result = await this.perAdapter.readFollowerPrivateState({
      deploymentId,
      subscriptionId: sub.id,
      followerVaultId: vault.id,
      followerWallet: walletAddress,
    });
    return {
      subscriptionId: sub.id,
      followerVaultId: vault.id,
      state: result.state,
      logs: result.logs,
      privateStateRevision: result.privateStateRevision,
      accessReason: decision.reason,
    };
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

  /**
   * Phase-2 stepwise provisioning. Each successful step is persisted so a
   * caller can resume from the last completed step. Failures are caught,
   * persisted as `provisioning_failed` with the error message, and re-thrown
   * so the controller can surface a 5xx for the user.
   */
  private async runProvisioningStateMachine(
    sub: StrategySubscriptionRow,
    vault: FollowerVaultRow,
    pdas: FollowerPdaSet,
    followerWallet: string,
  ): Promise<FollowerSubscriptionView> {
    let current = sub;
    let currentVault = vault;
    try {
      // Step → subscription_initialized
      if (current.provisioning_state === 'db_inserted') {
        await this.onchainAdapter.initializeFollowerSubscription({
          deploymentId: current.deployment_id,
          followerWallet,
          subscriptionId: current.id,
        });
        current = await this.subscriptionsRepository.update(current.id, {
          provisioningState: 'subscription_initialized',
          provisioningError: null,
        });
      }

      // Step → vault_initialized
      if (current.provisioning_state === 'subscription_initialized') {
        await this.onchainAdapter.initializeFollowerVault({
          subscriptionPda: pdas.subscriptionPda,
          followerWallet,
          vaultId: currentVault.id,
          custodyMode: currentVault.custody_mode,
        });
        current = await this.subscriptionsRepository.update(current.id, {
          provisioningState: 'vault_initialized',
          provisioningError: null,
        });
      }

      // Step → vault_authority_initialized
      if (current.provisioning_state === 'vault_initialized') {
        await this.onchainAdapter.initializeFollowerVaultAuthority({
          followerVaultPda: pdas.followerVaultPda,
          followerWallet,
        });
        current = await this.subscriptionsRepository.update(current.id, {
          provisioningState: 'vault_authority_initialized',
          provisioningError: null,
        });
      }

      // Step → provisioning_complete (Umbra register + PER membership)
      if (current.provisioning_state === 'vault_authority_initialized') {
        let umbraIdentityRef: string | null = current.umbra_identity_ref;
        if (!umbraIdentityRef) {
          umbraIdentityRef = await this.registerUmbraIdentityForVault(currentVault.id);
        }
        const perMemberRef = await this.attachToPerGroup(
          current.deployment_id,
          followerWallet,
          currentVault.id,
        );
        current = await this.subscriptionsRepository.update(current.id, {
          umbraIdentityRef,
          perMemberRef: perMemberRef ?? current.per_member_ref ?? null,
          provisioningState: 'provisioning_complete',
          provisioningError: null,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await this.subscriptionsRepository.update(current.id, {
          provisioningState: 'provisioning_failed',
          provisioningError: message,
        });
      } catch (persistErr) {
        this.logger.error(
          `failed to persist provisioning_failed state for sub=${current.id}: ${
            persistErr instanceof Error ? persistErr.message : persistErr
          }`,
        );
      }
      throw err;
    }

    const identity = current.umbra_identity_ref
      ? await this.umbraIdentitiesRepository.getById(current.umbra_identity_ref)
      : null;
    return this.toView(current, currentVault, identity);
  }

  /**
   * Derive a per-vault Umbra signer (HKDF) and register the identity. The
   * keeper master secret never leaves memory; we wipe the secret as soon as
   * the SDK call completes (success or failure).
   */
  private async registerUmbraIdentityForVault(followerVaultId: string): Promise<string | null> {
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
        `Umbra register failed for follower_vault=${followerVaultId}: ${
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
      derived.secretKey.fill(0);
    }
    const umbraIdentity = await this.umbraIdentitiesRepository.insert({
      followerVaultId,
      signerPubkey: derived.pubkey,
      derivationSalt: derived.derivationSalt,
      x25519PublicKey: umbraResult.x25519PublicKey ?? null,
      encryptedUserAccount: umbraResult.encryptedUserAccount ?? null,
      registrationStatus: umbraResult.status === 'confirmed' ? 'confirmed' : 'pending',
      registerQueueSignature: umbraResult.txSignatures[0] ?? null,
      registerCallbackSignature: umbraResult.txSignatures[1] ?? null,
    });
    return umbraIdentity.id;
  }

  private async attachToPerGroup(
    deploymentId: string,
    followerWallet: string,
    followerVaultId: string,
  ): Promise<string | null> {
    try {
      const group = await this.perGroupsRepository.getByDeployment(deploymentId);
      if (!group) return null;
      const deployment = await this.deploymentsRepository.getById(deploymentId);
      const nextMembers = [
        ...group.members.filter((m) => m.wallet !== followerWallet),
        { wallet: followerWallet, role: 'subscriber' as const, expiresAt: null },
      ];
      const updated = await this.perGroupsRepository.replaceMembers(
        deploymentId,
        deployment.creator_wallet_address,
        nextMembers,
      );
      return updated.group_id;
    } catch (err) {
      this.logger.warn(
        `PER membership add failed for follower_vault=${followerVaultId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return null;
    }
  }

  /**
   * Mirror the off-chain lifecycle transition to on-chain. Bounded synchronous
   * retry with exponential backoff. On exhaustion we set
   * `lifecycle_drift = true` so admins can reconcile manually.
   */
  private async mirrorLifecycleOnchain(
    sub: StrategySubscriptionRow,
    followerVaultPda: string,
    subscriptionPda: string,
    lifecycleStatus: FollowerVaultLifecycleStatus,
  ): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < LIFECYCLE_RETRY_DELAYS_MS.length; attempt++) {
      try {
        await this.onchainAdapter.setFollowerVaultStatus({
          followerVaultPda,
          subscriptionPda,
          followerWallet: sub.follower_wallet,
          lifecycleStatus,
        });
        // Clear any prior drift flag on success.
        if (sub.lifecycle_drift) {
          await this.subscriptionsRepository.update(sub.id, { lifecycleDrift: false });
        }
        return;
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `setFollowerVaultStatus attempt=${attempt + 1} failed for sub=${sub.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
        if (attempt < LIFECYCLE_RETRY_DELAYS_MS.length - 1) {
          await delay(LIFECYCLE_RETRY_DELAYS_MS[attempt]);
        }
      }
    }
    this.logger.error(
      `lifecycle drift detected for sub=${sub.id}: all ${LIFECYCLE_RETRY_DELAYS_MS.length} retries failed (${
        lastError instanceof Error ? lastError.message : lastError
      })`,
    );
    try {
      await this.subscriptionsRepository.update(sub.id, {
        lifecycleDrift: true,
        provisioningError: `setFollowerVaultStatus exhausted retries: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
      });
    } catch (persistErr) {
      this.logger.error(
        `failed to persist lifecycle_drift flag for sub=${sub.id}: ${
          persistErr instanceof Error ? persistErr.message : persistErr
        }`,
      );
    }
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
      provisioningState: sub.provisioning_state,
      provisioningError: sub.provisioning_error,
      lifecycleDrift: sub.lifecycle_drift,
      createdAt: sub.created_at,
      updatedAt: sub.updated_at,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
