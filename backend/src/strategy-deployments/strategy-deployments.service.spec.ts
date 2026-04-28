import { StrategyDeploymentsService } from './strategy-deployments.service';
import {
  type StrategyDeploymentRow,
  type StrategyDeploymentsRepository,
} from './strategy-deployments.repository';
import { type StrategiesRepository, type StrategyRow } from '../strategies/strategies.repository';
import {
  type StrategyVersionRow,
  type StrategyVersionsRepository,
} from '../strategies/strategy-versions.repository';
import { type OnchainAdapterPort } from '../onchain/onchain-adapter.port';
import { NoopOnchainAdapter } from '../onchain/noop-onchain-adapter.service';
import { StrategyCompilerService } from '../strategy-compiler/strategy-compiler.service';
import { type WorkflowDefinition } from '../web3/workflow-types';
import {
  type MagicBlockErAdapterPort,
  type MagicBlockPerAdapterPort,
  type MagicBlockPrivatePaymentsAdapterPort,
} from '../magicblock/magicblock.port';
import { type PerGroupsRepository } from '../magicblock/per-groups.repository';
import { type PerAuthTokensRepository } from '../magicblock/per-auth-tokens.repository';
import { type UmbraAdapterPort } from '../umbra/umbra.port';

const compiler = new StrategyCompilerService();

const definition: WorkflowDefinition = {
  nodes: [
    {
      id: 'guard-1',
      name: 'Balance Guard',
      type: 'getBalance',
      parameters: { token: 'USDC', condition: 'gte', threshold: '1000' },
    },
    {
      id: 'transfer-1',
      name: 'Settlement',
      type: 'transfer',
      parameters: { token: 'USDC', amount: '500', recipient: 'wallet-1' },
    },
  ],
  connections: {
    'guard-1': { main: [[{ node: 'transfer-1', type: 'main', index: 0 }]] },
  },
};

const compiled = compiler.compileStrategyIR(definition);

const publishedStrategy: StrategyRow = {
  id: 'strategy-1',
  creator_wallet_address: 'wallet-1',
  source_workflow_id: null,
  name: 'S',
  description: null,
  visibility_mode: 'public',
  lifecycle_state: 'published',
  current_version: 2,
  public_metadata: compiled.publicMetadata,
  compiled_ir: compiled,
  private_definition_ref: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

const draftStrategy: StrategyRow = {
  ...publishedStrategy,
  lifecycle_state: 'draft',
};

const deploymentRow: StrategyDeploymentRow = {
  id: 'deploy-1',
  strategy_id: publishedStrategy.id,
  strategy_version_id: 'version-1',
  creator_wallet_address: 'wallet-1',
  account_id: 'acct-1',
  execution_mode: 'per',
  treasury_mode: 'private_payments',
  lifecycle_status: 'deployed',
  state_revision: 0,
  private_state_account: null,
  public_snapshot_account: null,
  er_session_id: null,
  per_session_id: null,
  umbra_user_account: null,
  metadata: {},
  created_at: '2026-01-02T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  er_delegate_signature: null,
  er_undelegate_signature: null,
  er_router_url: null,
  er_committed_at: null,
  umbra_x25519_pubkey: null,
  umbra_signer_pubkey: null,
  umbra_registration_status: null,
  umbra_register_queue_signature: null,
  umbra_register_callback_signature: null,
  umbra_master_seed_ref: null,
  per_endpoint_url: null,
  pp_session_id: null,
  pp_endpoint_url: null,
};

const versionRow: StrategyVersionRow = {
  id: 'version-1',
  strategy_id: publishedStrategy.id,
  version: 2,
  public_metadata_hash: compiled.publicMetadata.publicMetadataHash,
  private_definition_commitment: compiled.privateDefinition.privateDefinitionCommitment,
  compiled_ir: compiled,
  status: 'published',
  published_at: '2026-01-02T00:00:00.000Z',
};

const buildService = (overrides?: {
  strategiesRepo?: Partial<StrategiesRepository>;
  versionsRepo?: Partial<StrategyVersionsRepository>;
  deploymentsRepo?: Partial<StrategyDeploymentsRepository>;
  onchain?: OnchainAdapterPort;
  er?: MagicBlockErAdapterPort;
  per?: MagicBlockPerAdapterPort;
  pp?: MagicBlockPrivatePaymentsAdapterPort;
  umbra?: UmbraAdapterPort;
  perGroupsRepo?: Partial<PerGroupsRepository>;
  perTokensRepo?: Partial<PerAuthTokensRepository>;
}) => {
  const strategiesRepo = {
    getStrategyForCreator: jest.fn().mockResolvedValue(publishedStrategy),
    ...(overrides?.strategiesRepo ?? {}),
  } as unknown as StrategiesRepository;

  const versionsRepo = {
    getLatestPublished: jest.fn().mockResolvedValue(versionRow),
    insertVersion: jest.fn(),
    getById: jest.fn(),
    ...(overrides?.versionsRepo ?? {}),
  } as unknown as StrategyVersionsRepository;

  const deploymentsRepo = {
    insertDeployment: jest.fn().mockResolvedValue(deploymentRow),
    getById: jest.fn().mockResolvedValue(deploymentRow),
    getForCreator: jest.fn().mockResolvedValue(deploymentRow),
    listForCreator: jest.fn().mockResolvedValue([deploymentRow]),
    updateDeployment: jest.fn().mockImplementation(async (_id, _wallet, input) => ({
      ...deploymentRow,
      ...(input.lifecycleStatus ? { lifecycle_status: input.lifecycleStatus } : {}),
    })),
    assertAccountOwnership: jest.fn().mockResolvedValue(undefined),
    ...(overrides?.deploymentsRepo ?? {}),
  } as unknown as StrategyDeploymentsRepository;

  const onchain = overrides?.onchain ?? new NoopOnchainAdapter();

  const er: MagicBlockErAdapterPort = overrides?.er ?? {
    delegateAccount: jest.fn().mockResolvedValue({ sessionId: null, signature: null }),
    route: jest.fn().mockResolvedValue({ signature: null, routedThrough: 'noop' }),
    commitAndUndelegate: jest.fn().mockResolvedValue({ signature: null }),
  };

  const per: MagicBlockPerAdapterPort = overrides?.per ?? {
    createPermissionGroup: jest.fn().mockResolvedValue({ groupId: 'per-test', signature: null }),
    requestAuthChallenge: jest.fn().mockResolvedValue({
      challenge: 'chal',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    verifyAuthSignature: jest.fn().mockResolvedValue({
      authToken: 'tok',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    getPrivateState: jest.fn().mockResolvedValue({ state: null, logs: [] }),
    writeFollowerPrivateState: jest.fn().mockResolvedValue({
      signature: null,
      privateStateRevision: null,
      status: 'applied' as const,
    }),
  };

  const pp: MagicBlockPrivatePaymentsAdapterPort = overrides?.pp ?? {
    deposit: jest.fn().mockResolvedValue({
      kind: 'deposit',
      version: 'legacy',
      transactionBase64: '',
      sendTo: 'base',
      recentBlockhash: '',
      lastValidBlockHeight: 0,
      instructionCount: 0,
      requiredSigners: [],
    } as unknown as ReturnType<MagicBlockPrivatePaymentsAdapterPort['deposit']>),
    transfer: jest.fn().mockResolvedValue({
      kind: 'transfer',
      version: 'legacy',
      transactionBase64: '',
      sendTo: 'base',
      recentBlockhash: '',
      lastValidBlockHeight: 0,
      instructionCount: 0,
      requiredSigners: [],
    } as unknown as ReturnType<MagicBlockPrivatePaymentsAdapterPort['transfer']>),
    withdraw: jest.fn().mockResolvedValue({
      kind: 'withdraw',
      version: 'legacy',
      transactionBase64: '',
      sendTo: 'base',
      recentBlockhash: '',
      lastValidBlockHeight: 0,
      instructionCount: 0,
      requiredSigners: [],
    } as unknown as ReturnType<MagicBlockPrivatePaymentsAdapterPort['withdraw']>),
    getBalance: jest.fn().mockResolvedValue({ balance: '0', decimals: 0 }),
  };

  const perGroupsRepo = {
    createGroup: jest.fn().mockResolvedValue({
      id: 'g1',
      deployment_id: 'deploy-1',
      group_id: 'per-test',
      creator_wallet: 'wallet-1',
      members: [{ wallet: 'wallet-1', role: 'creator' }],
      created_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    }),
    getByDeployment: jest.fn().mockResolvedValue(null),
    getByDeploymentOrThrow: jest.fn(),
    replaceMembers: jest.fn(),
    findMembership: jest.fn().mockResolvedValue(null),
    ...(overrides?.perGroupsRepo ?? {}),
  } as unknown as PerGroupsRepository;

  const perTokensRepo = {
    insertChallenge: jest.fn(),
    insertActive: jest.fn(),
    getByToken: jest.fn(),
    getActiveOrThrow: jest.fn(),
    promoteChallenge: jest.fn(),
    revokeToken: jest.fn(),
    revokeAllForDeployment: jest.fn().mockResolvedValue(undefined),
    ...(overrides?.perTokensRepo ?? {}),
  } as unknown as PerAuthTokensRepository;

  const umbra: UmbraAdapterPort = overrides?.umbra ?? {
    registerEncryptedUserAccount: jest.fn().mockResolvedValue({
      encryptedUserAccount: null,
      x25519PublicKey: null,
      signerPubkey: null,
      txSignatures: [],
      status: 'pending',
    }),
    deposit: jest
      .fn()
      .mockResolvedValue({ queueSignature: null, callbackSignature: null, status: 'pending' }),
    withdraw: jest
      .fn()
      .mockResolvedValue({ queueSignature: null, callbackSignature: null, status: 'pending' }),
    transfer: jest
      .fn()
      .mockResolvedValue({ queueSignature: null, callbackSignature: null, status: 'pending' }),
    getEncryptedBalance: jest
      .fn()
      .mockResolvedValue({ encryptedTokenAccount: null, ciphertext: null, decryptedAmount: null }),
    grantViewer: jest.fn().mockResolvedValue({ grantId: null, payload: {} }),
  };

  const service = new StrategyDeploymentsService(
    deploymentsRepo,
    strategiesRepo,
    versionsRepo,
    onchain,
    er,
    per,
    pp,
    umbra,
    perGroupsRepo,
    perTokensRepo,
  );
  return {
    service,
    deploymentsRepo,
    strategiesRepo,
    versionsRepo,
    onchain,
    er,
    per,
    pp,
    umbra,
    perGroupsRepo,
    perTokensRepo,
  };
};

describe('StrategyDeploymentsService', () => {
  it('rejects deploy on a draft strategy', async () => {
    const { service } = buildService({
      strategiesRepo: {
        getStrategyForCreator: jest.fn().mockResolvedValue(draftStrategy),
      },
    });

    await expect(
      service.createDeployment('wallet-1', 'strategy-1', { accountId: 'acct-1' }),
    ).rejects.toThrow('Strategy must be published');
  });

  it('creates a deployment using compiled IR hints when no overrides given', async () => {
    const { service, deploymentsRepo, versionsRepo } = buildService();

    const view = await service.createDeployment('wallet-1', 'strategy-1', {
      accountId: 'acct-1',
    });

    expect(versionsRepo.getLatestPublished).toHaveBeenCalledWith('strategy-1');
    expect(deploymentsRepo.insertDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyId: 'strategy-1',
        strategyVersionId: 'version-1',
        accountId: 'acct-1',
        executionMode: 'per', // from compiled hints
        treasuryMode: 'private_payments',
        lifecycleStatus: 'deployed',
      }),
    );
    expect(view.id).toBe(deploymentRow.id);
  });

  it('rejects illegal lifecycle transitions', async () => {
    const closedRow = { ...deploymentRow, lifecycle_status: 'closed' as const };
    const { service } = buildService({
      deploymentsRepo: {
        getForCreator: jest.fn().mockResolvedValue(closedRow),
      },
    });

    await expect(service.pauseDeployment('deploy-1', 'wallet-1')).rejects.toThrow(
      'Cannot transition deployment from closed to paused',
    );
  });

  it('auto-registers Umbra EUA on create when treasury_mode === umbra', async () => {
    const umbra: UmbraAdapterPort = {
      registerEncryptedUserAccount: jest.fn().mockResolvedValue({
        encryptedUserAccount: 'eua-pk',
        x25519PublicKey: 'x25519-pk',
        signerPubkey: 'signer-pk',
        txSignatures: [],
        status: 'pending',
      }),
      deposit: jest.fn(),
      withdraw: jest.fn(),
      transfer: jest.fn(),
      getEncryptedBalance: jest.fn(),
      grantViewer: jest.fn(),
    };
    const updateMock = jest
      .fn()
      .mockImplementation(async (_id, _wallet, input) => ({ ...deploymentRow, ...input }));
    const { service, umbra: injectedUmbra } = buildService({
      umbra,
      deploymentsRepo: {
        insertDeployment: jest
          .fn()
          .mockResolvedValue({ ...deploymentRow, treasury_mode: 'umbra' as const }),
        updateDeployment: updateMock,
        assertAccountOwnership: jest.fn().mockResolvedValue(undefined),
        getForCreator: jest.fn().mockResolvedValue(deploymentRow),
        listForCreator: jest.fn(),
        getById: jest.fn(),
      },
    });

    await service.createDeployment('wallet-1', 'strategy-1', {
      accountId: 'acct-1',
      treasuryMode: 'umbra',
    });

    expect(injectedUmbra.registerEncryptedUserAccount).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      deploymentRow.id,
      'wallet-1',
      expect.objectContaining({
        umbraUserAccount: 'eua-pk',
        umbraX25519Pubkey: 'x25519-pk',
        umbraRegistrationStatus: 'pending',
      }),
    );
  });

  it('auto-delegates ER on create when execution_mode === er', async () => {
    const er: MagicBlockErAdapterPort = {
      delegateAccount: jest.fn().mockResolvedValue({ sessionId: 'sess-1', signature: 'sig-1' }),
      route: jest.fn(),
      commitAndUndelegate: jest.fn(),
    };
    const erRow = {
      ...deploymentRow,
      execution_mode: 'er' as const,
      treasury_mode: 'public' as const,
      private_state_account: 'pda-1',
    };
    const updateMock = jest
      .fn()
      .mockImplementation(async (_id, _wallet, input) => ({ ...erRow, ...input }));
    const { service, er: injectedEr } = buildService({
      er,
      deploymentsRepo: {
        insertDeployment: jest.fn().mockResolvedValue(erRow),
        updateDeployment: updateMock,
        assertAccountOwnership: jest.fn().mockResolvedValue(undefined),
        getForCreator: jest.fn().mockResolvedValue(erRow),
        listForCreator: jest.fn(),
        getById: jest.fn(),
      },
    });

    await service.createDeployment('wallet-1', 'strategy-1', {
      accountId: 'acct-1',
      executionMode: 'er',
    });

    expect(injectedEr.delegateAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: erRow.id,
        accountPubkey: 'pda-1',
      }),
    );
    expect(updateMock).toHaveBeenCalledWith(
      erRow.id,
      'wallet-1',
      expect.objectContaining({
        erSessionId: 'sess-1',
        erDelegateSignature: 'sig-1',
      }),
    );
  });

  it('closeDeployment commits ER state when execution_mode === er', async () => {
    const er: MagicBlockErAdapterPort = {
      delegateAccount: jest.fn(),
      route: jest.fn(),
      commitAndUndelegate: jest.fn().mockResolvedValue({ signature: 'undelegate-sig' }),
    };
    let current: StrategyDeploymentRow = {
      ...deploymentRow,
      execution_mode: 'er' as const,
      lifecycle_status: 'stopped' as const,
      private_state_account: 'pda-1',
    };
    const updateMock = jest.fn().mockImplementation(async (_id, _wallet, input) => {
      current = {
        ...current,
        ...(input.lifecycleStatus ? { lifecycle_status: input.lifecycleStatus } : {}),
        ...(input.erUndelegateSignature
          ? { er_undelegate_signature: input.erUndelegateSignature }
          : {}),
      };
      return current;
    });
    const { service } = buildService({
      er,
      deploymentsRepo: {
        getForCreator: jest.fn().mockImplementation(async () => current),
        updateDeployment: updateMock,
      },
    });

    await service.closeDeployment('deploy-1', 'wallet-1');
    expect(er.commitAndUndelegate).toHaveBeenCalledWith({
      deploymentId: 'deploy-1',
      accountPubkey: 'pda-1',
    });
  });

  it('allows deployed → paused → resume → stop → close', async () => {
    let current: StrategyDeploymentRow = { ...deploymentRow };

    const { service } = buildService({
      deploymentsRepo: {
        getForCreator: jest.fn().mockImplementation(async () => current),
        updateDeployment: jest.fn().mockImplementation(async (_id, _wallet, input) => {
          current = {
            ...current,
            lifecycle_status: input.lifecycleStatus ?? current.lifecycle_status,
          };
          return current;
        }),
      },
    });

    let view = await service.pauseDeployment('deploy-1', 'wallet-1');
    expect(view.lifecycleStatus).toBe('paused');

    view = await service.resumeDeployment('deploy-1', 'wallet-1');
    expect(view.lifecycleStatus).toBe('deployed');

    view = await service.stopDeployment('deploy-1', 'wallet-1');
    expect(view.lifecycleStatus).toBe('stopped');

    view = await service.closeDeployment('deploy-1', 'wallet-1');
    expect(view.lifecycleStatus).toBe('closed');
  });
});
