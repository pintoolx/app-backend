import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import {
  type StrategySubscriptionRow,
  type StrategySubscriptionsRepository,
} from './subscriptions.repository';
import { type FollowerVaultRow, type FollowerVaultsRepository } from './follower-vaults.repository';
import {
  type FollowerVaultUmbraIdentityRow,
  type FollowerVaultUmbraIdentitiesRepository,
} from './follower-vault-umbra-identities.repository';
import { type FollowerVisibilityGrantsRepository } from './follower-visibility-grants.repository';
import { type FollowerVaultSignerService } from './follower-vault-signer.service';
import { type StrategyDeploymentsRepository } from '../strategy-deployments/strategy-deployments.repository';
import { type PerGroupsRepository } from '../magicblock/per-groups.repository';
import {
  type PerAuthTokenRow,
  type PerAuthTokensRepository,
} from '../magicblock/per-auth-tokens.repository';
import {
  type MagicBlockPerAdapterPort,
  type PerReadFollowerStateResult,
} from '../magicblock/magicblock.port';
import { type UmbraAdapterPort } from '../umbra/umbra.port';

const DEPLOYMENT_ID = 'dep-1';
const SUB_ID = 'sub-1';
const VAULT_ID = 'fv-1';
const FOLLOWER = 'follower-wallet';
const CREATOR = 'creator-wallet';

const subRow: StrategySubscriptionRow = {
  id: SUB_ID,
  deployment_id: DEPLOYMENT_ID,
  follower_wallet: FOLLOWER,
  subscription_pda: null,
  follower_vault_pda: null,
  vault_authority_pda: null,
  status: 'pending_funding',
  visibility_preset: 'subscriber-self',
  max_capital: '1000',
  allocation_mode: 'proportional',
  max_drawdown_bps: 1000,
  per_member_ref: null,
  umbra_identity_ref: null,
  provisioning_state: 'db_inserted',
  provisioning_error: null,
  lifecycle_drift: false,
  subscription_pda_bump: null,
  follower_vault_pda_bump: null,
  vault_authority_pda_bump: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const vaultRow: FollowerVaultRow = {
  id: VAULT_ID,
  subscription_id: SUB_ID,
  deployment_id: DEPLOYMENT_ID,
  vault_pda: 'placeholder-fv',
  authority_pda: 'placeholder-fva',
  lifecycle_status: 'pending_funding',
  private_state_ref: null,
  public_snapshot_ref: null,
  custody_mode: 'program_owned',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const identityRow: FollowerVaultUmbraIdentityRow = {
  id: 'umbra-1',
  follower_vault_id: VAULT_ID,
  signer_pubkey: 'derived-pubkey',
  x25519_public_key: null,
  encrypted_user_account: 'eua',
  derivation_salt: 'aabbcc',
  mvk_ref: null,
  registration_status: 'confirmed',
  register_queue_signature: null,
  register_callback_signature: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

const buildService = (overrides?: {
  subRepo?: Partial<StrategySubscriptionsRepository>;
  vaultRepo?: Partial<FollowerVaultsRepository>;
  identityRepo?: Partial<FollowerVaultUmbraIdentitiesRepository>;
  perAuthTokensRepo?: Partial<PerAuthTokensRepository>;
  perAdapter?: Partial<MagicBlockPerAdapterPort>;
}) => {
  // Translate camelCase Update inputs back to snake_case row fields so the
  // service's state machine sees the persisted state correctly.
  const applyUpdate = (
    base: StrategySubscriptionRow,
    input: Record<string, unknown>,
  ): StrategySubscriptionRow => ({
    ...base,
    ...(input.status !== undefined ? { status: input.status as StrategySubscriptionRow['status'] } : {}),
    ...(input.provisioningState !== undefined
      ? {
          provisioning_state:
            input.provisioningState as StrategySubscriptionRow['provisioning_state'],
        }
      : {}),
    ...(input.provisioningError !== undefined
      ? { provisioning_error: input.provisioningError as string | null }
      : {}),
    ...(input.lifecycleDrift !== undefined
      ? { lifecycle_drift: input.lifecycleDrift as boolean }
      : {}),
    ...(input.umbraIdentityRef !== undefined
      ? { umbra_identity_ref: input.umbraIdentityRef as string | null }
      : {}),
    ...(input.perMemberRef !== undefined
      ? { per_member_ref: input.perMemberRef as string | null }
      : {}),
  });
  const subRepo = {
    insert: jest.fn().mockResolvedValue(subRow),
    update: jest.fn().mockImplementation(async (_id, input) => applyUpdate(subRow, input)),
    getById: jest.fn().mockResolvedValue(subRow),
    getForFollower: jest.fn().mockResolvedValue(subRow),
    getByDeploymentAndFollower: jest.fn().mockResolvedValue(null),
    listByDeployment: jest.fn().mockResolvedValue([subRow]),
    listActiveByDeployment: jest.fn().mockResolvedValue([]),
    listForFollower: jest.fn().mockResolvedValue([subRow]),
    ...(overrides?.subRepo ?? {}),
  } as unknown as StrategySubscriptionsRepository;

  const vaultRepo = {
    insert: jest.fn().mockResolvedValue(vaultRow),
    getBySubscriptionId: jest.fn().mockResolvedValue(vaultRow),
    getBySubscriptionIdOrThrow: jest.fn().mockResolvedValue(vaultRow),
    listByDeployment: jest.fn().mockResolvedValue([vaultRow]),
    update: jest.fn().mockImplementation(async (_id, input) => ({ ...vaultRow, ...input })),
    ...(overrides?.vaultRepo ?? {}),
  } as unknown as FollowerVaultsRepository;

  const identityRepo = {
    insert: jest.fn().mockResolvedValue(identityRow),
    getById: jest.fn().mockResolvedValue(identityRow),
    getByFollowerVaultId: jest.fn().mockResolvedValue(identityRow),
    update: jest.fn().mockImplementation(async (_id, input) => ({ ...identityRow, ...input })),
    ...(overrides?.identityRepo ?? {}),
  } as unknown as FollowerVaultUmbraIdentitiesRepository;

  const grantsRepo = {
    insert: jest.fn(),
    listBySubscription: jest.fn().mockResolvedValue([]),
    revoke: jest.fn(),
    getById: jest.fn(),
  } as unknown as FollowerVisibilityGrantsRepository;

  const deploymentsRepo = {
    getById: jest.fn().mockResolvedValue({
      id: DEPLOYMENT_ID,
      creator_wallet_address: CREATOR,
    }),
    getForCreator: jest.fn().mockResolvedValue({
      id: DEPLOYMENT_ID,
      creator_wallet_address: CREATOR,
    }),
  } as unknown as StrategyDeploymentsRepository;

  const perGroupsRepo = {
    getByDeployment: jest.fn().mockResolvedValue(null),
    replaceMembers: jest.fn(),
  } as unknown as PerGroupsRepository;

  const signerService = {
    deriveFresh: jest.fn().mockResolvedValue({
      pubkey: 'derived-pubkey',
      secretKey: new Uint8Array(64),
      derivationSalt: 'aabbcc',
    }),
    derive: jest.fn().mockResolvedValue({
      pubkey: 'derived-pubkey',
      secretKey: new Uint8Array(64),
      derivationSalt: 'aabbcc',
    }),
    generateSalt: jest.fn().mockReturnValue('aabbcc'),
  } as unknown as FollowerVaultSignerService;

  const umbraAdapter: UmbraAdapterPort = {
    registerEncryptedUserAccount: jest.fn().mockResolvedValue({
      encryptedUserAccount: 'eua',
      x25519PublicKey: null,
      signerPubkey: 'derived-pubkey',
      txSignatures: [],
      status: 'confirmed',
    }),
    deposit: jest.fn().mockResolvedValue({
      queueSignature: 'qsig',
      callbackSignature: null,
      status: 'pending',
    }),
    withdraw: jest.fn(),
    transfer: jest.fn(),
    createEncryptedTransferIntent: jest.fn().mockResolvedValue({
      claimableUtxoRef: null,
      queueSignature: null,
      callbackSignature: null,
      status: 'pending',
    }),
    claimEncryptedTransfer: jest.fn().mockResolvedValue({
      queueSignature: null,
      callbackSignature: null,
      status: 'pending',
    }),
    getEncryptedBalance: jest.fn().mockResolvedValue({
      encryptedTokenAccount: null,
      ciphertext: null,
      decryptedAmount: null,
    }),
    grantViewer: jest.fn(),
  };

  const perAuthTokensRepo = {
    insertChallenge: jest.fn().mockImplementation(async (input) => ({
      token: input.token,
      deployment_id: input.deploymentId,
      wallet: input.wallet,
      group_id: input.groupId,
      scope_kind: input.scopeKind ?? 'deployment',
      subscription_id: input.subscriptionId ?? null,
      status: 'challenge',
      scopes: input.scopes ?? [],
      issued_at: new Date().toISOString(),
      expires_at: input.expiresAt,
      revoked_at: null,
    })),
    insertActive: jest.fn(),
    getByToken: jest.fn(),
    getActiveOrThrow: jest.fn(),
    promoteChallenge: jest.fn(),
    revokeToken: jest.fn(),
    revokeAllForDeployment: jest.fn(),
    revokeAllForSubscription: jest.fn(),
    ...(overrides?.perAuthTokensRepo ?? {}),
  } as unknown as PerAuthTokensRepository;

  const perAdapter: MagicBlockPerAdapterPort = {
    createPermissionGroup: jest.fn(),
    requestAuthChallenge: jest.fn(),
    verifyAuthSignature: jest.fn(),
    getPrivateState: jest.fn(),
    writeFollowerPrivateState: jest.fn(),
    readFollowerPrivateState: jest.fn().mockResolvedValue({
      state: { sanitizedAllocation: '500' },
      logs: [],
      privateStateRevision: 7,
    } satisfies PerReadFollowerStateResult),
    ...(overrides?.perAdapter ?? {}),
  };

  const visibilityPolicy = {
    canReadPrivateBalance: jest
      .fn()
      .mockImplementation(async (callerWallet: string, sub: StrategySubscriptionRow) => ({
        allowed: callerWallet === sub.follower_wallet,
        reason: callerWallet === sub.follower_wallet ? 'owner' : 'no-grant',
        subscriptionId: sub.id,
      })),
    canReadPrivateState: jest
      .fn()
      .mockImplementation(async (callerWallet: string, sub: StrategySubscriptionRow) => ({
        allowed: callerWallet === sub.follower_wallet,
        reason: callerWallet === sub.follower_wallet ? 'owner' : 'no-grant',
        subscriptionId: sub.id,
      })),
  } as any;

  const onchainAdapter: any = {
    deriveFollowerPdas: jest.fn().mockResolvedValue({
      subscriptionPda: 'SubPda1111111111111111111111111111111111111',
      subscriptionPdaBump: 254,
      followerVaultPda: 'FvPda1111111111111111111111111111111111111',
      followerVaultPdaBump: 253,
      vaultAuthorityPda: 'FvaPda1111111111111111111111111111111111111',
      vaultAuthorityPdaBump: 252,
    }),
    initializeFollowerSubscription: jest
      .fn()
      .mockResolvedValue({ signature: null, unsignedInstructionBase64: null, recentBlockhash: null }),
    initializeFollowerVault: jest
      .fn()
      .mockResolvedValue({ signature: null, unsignedInstructionBase64: null, recentBlockhash: null }),
    initializeFollowerVaultAuthority: jest
      .fn()
      .mockResolvedValue({ signature: null, unsignedInstructionBase64: null, recentBlockhash: null }),
    setFollowerVaultStatus: jest
      .fn()
      .mockResolvedValue({ signature: null, unsignedInstructionBase64: null, recentBlockhash: null }),
    closeFollowerVault: jest
      .fn()
      .mockResolvedValue({ signature: null, unsignedInstructionBase64: null, recentBlockhash: null }),
    buildFundIntentInstruction: jest.fn().mockResolvedValue({
      instructionBase64: 'eyJ0ZXN0Ijp0cnVlfQ==',
      recentBlockhash: null,
      vaultAuthorityPda: 'FvaPda1111111111111111111111111111111111111',
      mint: 'MINT',
      amount: '0',
    }),
    initializeDeployment: jest.fn(),
    setLifecycleStatus: jest.fn(),
    commitState: jest.fn(),
    setPublicSnapshot: jest.fn(),
    closeDeployment: jest.fn(),
  };

  const service = new SubscriptionsService(
    subRepo,
    vaultRepo,
    identityRepo,
    grantsRepo,
    deploymentsRepo,
    perGroupsRepo,
    perAuthTokensRepo,
    signerService,
    visibilityPolicy,
    umbraAdapter,
    perAdapter,
    onchainAdapter,
  );
  return {
    service,
    subRepo,
    vaultRepo,
    identityRepo,
    signerService,
    umbraAdapter,
    perAuthTokensRepo,
    perAdapter,
  };
};

describe('SubscriptionsService', () => {
  it('creates a subscription, follower vault, and per-vault Umbra identity exactly once', async () => {
    const { service, subRepo, vaultRepo, identityRepo, signerService, umbraAdapter } =
      buildService();
    const view = await service.createSubscription(DEPLOYMENT_ID, FOLLOWER, {});
    expect(subRepo.insert).toHaveBeenCalledTimes(1);
    expect(vaultRepo.insert).toHaveBeenCalledTimes(1);
    expect(identityRepo.insert).toHaveBeenCalledTimes(1);
    expect(signerService.deriveFresh).toHaveBeenCalledTimes(1);
    expect(umbraAdapter.registerEncryptedUserAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        signerOverride: expect.objectContaining({ pubkey: 'derived-pubkey' }),
      }),
    );
    expect(view.umbraIdentity?.signerPubkey).toBe('derived-pubkey');
    // The DB insert must not include any field hinting at the keeper secret.
    const insertArg = (identityRepo.insert as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(insertArg)).not.toContain('secretKey');
    expect(Object.keys(insertArg)).not.toContain('keeperSecret');
  });

  it('rejects duplicate subscriptions for the same (deployment, follower)', async () => {
    const { service } = buildService({
      subRepo: {
        getByDeploymentAndFollower: jest.fn().mockResolvedValue(subRow),
      },
    });
    await expect(service.createSubscription(DEPLOYMENT_ID, FOLLOWER, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('only allows valid lifecycle transitions', async () => {
    const closedSub = { ...subRow, status: 'closed' as const };
    const { service } = buildService({
      subRepo: { getById: jest.fn().mockResolvedValue(closedSub) },
    });
    await expect(
      service.transitionStatus(DEPLOYMENT_ID, SUB_ID, FOLLOWER, 'active'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listForFollower hydrates each row with vault + umbra identity projection', async () => {
    const { service } = buildService();
    const rows = await service.listForFollower(FOLLOWER);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(SUB_ID);
    expect(rows[0].followerVaultId).toBe(VAULT_ID);
  });

  it('listForFollower forwards an explicit status filter to the repository', async () => {
    const listForFollowerSpy = jest.fn().mockResolvedValue([]);
    const { service } = buildService({
      subRepo: { listForFollower: listForFollowerSpy },
    });
    await service.listForFollower(FOLLOWER, { status: 'active' });
    expect(listForFollowerSpy).toHaveBeenCalledWith(FOLLOWER, { status: 'active' });
  });

  it('listForDeployment requires creator ownership and projects rows', async () => {
    const { service, subRepo } = buildService();
    const rows = await service.listForDeployment(DEPLOYMENT_ID, CREATOR);
    expect(rows).toHaveLength(1);
    expect((subRepo.listByDeployment as jest.Mock)).toHaveBeenCalledWith(DEPLOYMENT_ID);
  });

  it('flips pending_funding -> active when shielding succeeds', async () => {
    const provisionedSub = { ...subRow, umbra_identity_ref: identityRow.id };
    const { service, subRepo, vaultRepo, umbraAdapter } = buildService({
      subRepo: { getById: jest.fn().mockResolvedValue(provisionedSub) },
    });
    const result = await service.shieldFunds(DEPLOYMENT_ID, SUB_ID, FOLLOWER, {
      mint: 'mint-1',
      amount: '500',
    });
    expect(umbraAdapter.deposit).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: DEPLOYMENT_ID,
        signerOverride: expect.objectContaining({ pubkey: 'derived-pubkey' }),
      }),
    );
    expect(result.queueSignature).toBe('qsig');
    expect(subRepo.update).toHaveBeenCalledWith(
      SUB_ID,
      expect.objectContaining({ status: 'active' }),
    );
    expect(vaultRepo.update).toHaveBeenCalledWith(
      VAULT_ID,
      expect.objectContaining({ lifecycleStatus: 'active' }),
    );
  });

  // ------------------------------ Phase 1 follower-self PER auth & state

  it('issueSubscriptionChallenge persists a subscription-scoped challenge for the owner', async () => {
    const { service, perAuthTokensRepo } = buildService();
    const res = await service.issueSubscriptionChallenge(DEPLOYMENT_ID, SUB_ID, FOLLOWER);
    expect(res.challenge).toMatch(/^per-subscription-challenge-/);
    expect(perAuthTokensRepo.insertChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: DEPLOYMENT_ID,
        wallet: FOLLOWER,
        scopeKind: 'subscription',
        subscriptionId: SUB_ID,
      }),
    );
  });

  it('issueSubscriptionChallenge refuses non-owners', async () => {
    const { service } = buildService();
    await expect(
      service.issueSubscriptionChallenge(DEPLOYMENT_ID, SUB_ID, 'someone-else'),
    ).rejects.toBeInstanceOf(Error);
  });

  it('verifySubscriptionChallenge promotes a fresh subscription challenge', async () => {
    const challengeRow: PerAuthTokenRow = {
      token: 'c1',
      deployment_id: DEPLOYMENT_ID,
      wallet: FOLLOWER,
      group_id: null,
      scope_kind: 'subscription',
      subscription_id: SUB_ID,
      status: 'challenge',
      scopes: ['per:subscription-auth-challenge'],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    };
    const { service, perAuthTokensRepo } = buildService({
      perAuthTokensRepo: {
        getByToken: jest.fn().mockResolvedValue(challengeRow),
        promoteChallenge: jest.fn().mockResolvedValue({ ...challengeRow, status: 'active' }),
      },
    });
    const out = await service.verifySubscriptionChallenge(DEPLOYMENT_ID, SUB_ID, FOLLOWER, 'c1');
    expect(out.authToken).toBe('c1');
    expect(perAuthTokensRepo.promoteChallenge).toHaveBeenCalledWith('c1', expect.any(String));
  });

  it('verifySubscriptionChallenge rejects challenges scoped to a different subscription', async () => {
    const wrongSubChallenge: PerAuthTokenRow = {
      token: 'c1',
      deployment_id: DEPLOYMENT_ID,
      wallet: FOLLOWER,
      group_id: null,
      scope_kind: 'subscription',
      subscription_id: 'other-sub',
      status: 'challenge',
      scopes: [],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    };
    const { service } = buildService({
      perAuthTokensRepo: {
        getByToken: jest.fn().mockResolvedValue(wrongSubChallenge),
      },
    });
    await expect(
      service.verifySubscriptionChallenge(DEPLOYMENT_ID, SUB_ID, FOLLOWER, 'c1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('verifySubscriptionChallenge rejects expired challenges', async () => {
    const expired: PerAuthTokenRow = {
      token: 'c1',
      deployment_id: DEPLOYMENT_ID,
      wallet: FOLLOWER,
      group_id: null,
      scope_kind: 'subscription',
      subscription_id: SUB_ID,
      status: 'challenge',
      scopes: [],
      issued_at: '2020-01-01T00:00:00Z',
      expires_at: '2020-01-01T00:01:00Z',
      revoked_at: null,
    };
    const { service } = buildService({
      perAuthTokensRepo: {
        getByToken: jest.fn().mockResolvedValue(expired),
      },
    });
    await expect(
      service.verifySubscriptionChallenge(DEPLOYMENT_ID, SUB_ID, FOLLOWER, 'c1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('getFollowerPrivateState returns sanitized state for the owner with a matching subscription token', async () => {
    const { service, perAdapter } = buildService();
    const ownerToken: PerAuthTokenRow = {
      token: 't',
      deployment_id: DEPLOYMENT_ID,
      wallet: FOLLOWER,
      group_id: null,
      scope_kind: 'subscription',
      subscription_id: SUB_ID,
      status: 'active',
      scopes: ['per:subscription-private-state'],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      revoked_at: null,
    };
    const out = await service.getFollowerPrivateState(
      DEPLOYMENT_ID,
      SUB_ID,
      FOLLOWER,
      ownerToken,
    );
    expect(out.privateStateRevision).toBe(7);
    expect(perAdapter.readFollowerPrivateState).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: SUB_ID,
        followerVaultId: VAULT_ID,
        followerWallet: FOLLOWER,
      }),
    );
  });

  it('getFollowerPrivateState rejects deployment-scope tokens replayed against the follower-self endpoint', async () => {
    const { service } = buildService();
    const deploymentToken: PerAuthTokenRow = {
      token: 'tdep',
      deployment_id: DEPLOYMENT_ID,
      wallet: FOLLOWER,
      group_id: null,
      scope_kind: 'deployment',
      subscription_id: null,
      status: 'active',
      scopes: ['per:private-state'],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      revoked_at: null,
    };
    await expect(
      service.getFollowerPrivateState(DEPLOYMENT_ID, SUB_ID, FOLLOWER, deploymentToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('getFollowerPrivateState rejects sibling subscription tokens', async () => {
    const { service } = buildService();
    const siblingToken: PerAuthTokenRow = {
      token: 'tsib',
      deployment_id: DEPLOYMENT_ID,
      wallet: FOLLOWER,
      group_id: null,
      scope_kind: 'subscription',
      subscription_id: 'sub-OTHER',
      status: 'active',
      scopes: [],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      revoked_at: null,
    };
    await expect(
      service.getFollowerPrivateState(DEPLOYMENT_ID, SUB_ID, FOLLOWER, siblingToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
