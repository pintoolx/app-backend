import { BadRequestException } from '@nestjs/common';
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
}) => {
  const subRepo = {
    insert: jest.fn().mockResolvedValue(subRow),
    update: jest.fn().mockImplementation(async (_id, input) => ({ ...subRow, ...input })),
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
    getEncryptedBalance: jest.fn().mockResolvedValue({
      encryptedTokenAccount: null,
      ciphertext: null,
      decryptedAmount: null,
    }),
    grantViewer: jest.fn(),
  };

  const service = new SubscriptionsService(
    subRepo,
    vaultRepo,
    identityRepo,
    grantsRepo,
    deploymentsRepo,
    perGroupsRepo,
    signerService,
    umbraAdapter,
  );
  return { service, subRepo, vaultRepo, identityRepo, signerService, umbraAdapter };
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
});
