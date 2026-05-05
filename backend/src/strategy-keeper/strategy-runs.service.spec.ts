import { Test, TestingModule } from '@nestjs/testing';
import { StrategyRunsService } from './strategy-runs.service';
import { StrategyRunsRepository, StrategyRunRow } from './strategy-runs.repository';
import {
  StrategyDeploymentsRepository,
  StrategyDeploymentRow,
} from '../strategy-deployments/strategy-deployments.repository';
import { OnchainAdapterPort } from '../onchain/onchain-adapter.port';
import { MagicBlockErAdapterPort } from '../magicblock/magicblock.port';
import { PrivateExecutionCyclesService } from '../follower-vaults/private-execution-cycles.service';
import { MetricsService } from '../observability/metrics.service';
import { StrategyEvaluationEvent } from './strategy-keeper.service';
import { ONCHAIN_ADAPTER } from '../onchain/onchain-adapter.port';
import { MAGICBLOCK_ER_ADAPTER } from '../magicblock/magicblock.port';

/** Helper to mock updateRun with correct camelCase→snake_case mapping. */
function mockUpdateRun(baseRun: StrategyRunRow) {
  return jest.fn().mockImplementation(async (id: string, input: any) => {
    const merged = { ...baseRun, id } as any;
    if (input.status !== undefined) merged.status = input.status;
    if (input.publicOutcome !== undefined) merged.public_outcome = input.publicOutcome;
    if (input.errorMessage !== undefined) merged.error_message = input.errorMessage;
    if (input.completedAt !== undefined) merged.completed_at = input.completedAt;
    if (input.privateStateRef !== undefined) merged.private_state_ref = input.privateStateRef;
    return merged as StrategyRunRow;
  });
}

describe('StrategyRunsService', () => {
  let service: StrategyRunsService;
  let runsRepository: jest.Mocked<Partial<StrategyRunsRepository>>;
  let deploymentsRepository: jest.Mocked<Partial<StrategyDeploymentsRepository>>;
  let onchainAdapter: jest.Mocked<Partial<OnchainAdapterPort>>;
  let erAdapter: jest.Mocked<Partial<MagicBlockErAdapterPort>>;
  let privateExecutionCyclesService: jest.Mocked<Partial<PrivateExecutionCyclesService>>;
  let metricsService: jest.Mocked<Partial<MetricsService>>;

  beforeEach(async () => {
    const defaultRun = mockStrategyRun({ id: 'run-default-insert' });
    runsRepository = {
      insertRun: jest.fn().mockResolvedValue(defaultRun),
      getById: jest.fn(),
      updateRun: jest.fn(),
      listByDeployment: jest.fn().mockResolvedValue([]),
      findActiveForDeployment: jest.fn().mockResolvedValue(null),
    };

    deploymentsRepository = {
      getById: jest.fn(),
      updateDeployment: jest.fn(),
    };

    onchainAdapter = {
      commitState: jest.fn().mockResolvedValue({
        signature: 'sig-commit-123',
        newStateRevision: 5,
      }),
      buildCommitStateTransaction: jest.fn().mockResolvedValue({
        transactionBase64: 'base64-signed-tx-mock',
      }),
      setPublicSnapshot: jest.fn().mockResolvedValue({
        signature: 'sig-snapshot-456',
        newStateRevision: 5,
      }),
    };

    erAdapter = {
      route: jest.fn().mockResolvedValue({
        signature: 'sig-route-789',
        routedThrough: 'er',
      }),
    };

    privateExecutionCyclesService = {
      startCycle: jest.fn().mockResolvedValue({
        cycle: {
          id: 'cycle-001',
          status: 'completed',
        },
        receipts: [
          { id: 'receipt-001', status: 'applied' },
          { id: 'receipt-002', status: 'applied' },
        ],
      }),
    };

    metricsService = {
      recordAdapterCall: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyRunsService,
        { provide: StrategyRunsRepository, useValue: runsRepository },
        { provide: StrategyDeploymentsRepository, useValue: deploymentsRepository },
        { provide: ONCHAIN_ADAPTER, useValue: onchainAdapter },
        { provide: MAGICBLOCK_ER_ADAPTER, useValue: erAdapter },
        { provide: PrivateExecutionCyclesService, useValue: privateExecutionCyclesService },
        { provide: MetricsService, useValue: metricsService },
      ],
    }).compile();

    service = module.get<StrategyRunsService>(StrategyRunsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createRun', () => {
    it('inserts a pending strategy run', async () => {
      const baseRun = mockStrategyRun();
      runsRepository.insertRun!.mockResolvedValue(baseRun);

      const result = await service.createRun({
        deploymentId: 'dep-123',
        executionLayer: 'offchain',
      });

      expect(result).toEqual(baseRun);
      expect(runsRepository.insertRun).toHaveBeenCalledWith({
        deploymentId: 'dep-123',
        executionLayer: 'offchain',
        strategyVersionId: null,
      });
    });

    it('returns existing active run instead of creating a duplicate', async () => {
      const activeRun = mockStrategyRun({ id: 'run-active', status: 'running' });
      runsRepository.findActiveForDeployment!.mockResolvedValue(activeRun);

      const result = await service.createRun({
        deploymentId: 'dep-123',
        executionLayer: 'offchain',
      });

      expect(result).toEqual(activeRun);
      expect(runsRepository.insertRun).not.toHaveBeenCalled();
    });
  });

  describe('handleStrategyEvaluated', () => {
    it('creates a run and kicks off async execution', async () => {
      const baseRun = mockStrategyRun({ id: 'run-1' });
      runsRepository.insertRun!.mockResolvedValue(baseRun);
      runsRepository.getById!.mockResolvedValue(baseRun);

      const deployment = mockDeployment();
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      deploymentsRepository.updateDeployment!.mockResolvedValue(deployment);
      runsRepository.updateRun = mockUpdateRun(baseRun);

      const event: StrategyEvaluationEvent = {
        deploymentId: 'dep-123',
        strategyId: 'strat-456',
        executionMode: 'offchain',
        triggerType: 'interval',
        evaluatedAt: new Date(),
      };

      await service.handleStrategyEvaluated(event);

      // Give async executeRun a tick to run
      await new Promise((r) => setTimeout(r, 50));

      expect(runsRepository.insertRun).toHaveBeenCalledWith({
        deploymentId: 'dep-123',
        executionLayer: 'offchain',
        strategyVersionId: null,
      });
      expect(runsRepository.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'running' }),
      );
    });
  });

  describe('executeRun', () => {
    it('executes offchain run: commitState + setPublicSnapshot', async () => {
      const run = mockStrategyRun({ execution_layer: 'offchain' });
      const deployment = mockDeployment({ state_revision: 3 });

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      deploymentsRepository.updateDeployment!.mockResolvedValue({
        ...deployment,
        state_revision: 5,
      });
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(onchainAdapter.commitState).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentId: deployment.id,
          expectedRevision: 3,
        }),
      );
      expect(deploymentsRepository.updateDeployment).toHaveBeenCalledWith(
        deployment.id,
        deployment.creator_wallet_address,
        { stateRevision: 5 },
      );
      expect(onchainAdapter.setPublicSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentId: deployment.id,
          expectedSnapshotRevision: 5,
          status: 'ok',
        }),
      );
      expect(result.status).toBe('completed');
      expect(metricsService.recordAdapterCall).toHaveBeenCalledWith(
        'keeper',
        'executeRun',
        'ok',
        expect.any(Number),
      );
    });

    it('executes er run: buildCommitStateTransaction + route through ER', async () => {
      const run = mockStrategyRun({ execution_layer: 'er' });
      const deployment = mockDeployment({ state_revision: 3 });

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      deploymentsRepository.updateDeployment!.mockResolvedValue({
        ...deployment,
        state_revision: 4,
      });
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(onchainAdapter.buildCommitStateTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentId: deployment.id,
          expectedRevision: 3,
        }),
      );
      expect(erAdapter.route).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentId: deployment.id,
          base64Tx: 'base64-signed-tx-mock',
        }),
      );
      expect(deploymentsRepository.updateDeployment).toHaveBeenCalledWith(
        deployment.id,
        deployment.creator_wallet_address,
        { stateRevision: 4 },
      );
      expect(result.status).toBe('completed');
      expect(result.public_outcome).toMatchObject({
        layer: 'er',
        commitSignature: 'sig-route-789',
        routedThrough: 'er',
        newStateRevision: 4,
      });
    });

    it('executes per run: startCycle via PrivateExecutionCyclesService', async () => {
      const run = mockStrategyRun({ execution_layer: 'per', id: 'run-per-001' });
      const deployment = mockDeployment({
        metadata: { auto_notional: '5000000000' },
      });

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      runsRepository.updateRun = mockUpdateRun(run);
      runsRepository.listByDeployment!.mockResolvedValue([
        {
          ...mockStrategyRun({ id: 'run-prev', status: 'completed' }),
          deployment_id: deployment.id,
        },
      ]);

      const result = await service.executeRun(run.id);

      expect(privateExecutionCyclesService.startCycle).toHaveBeenCalledWith(
        deployment.id,
        deployment.creator_wallet_address,
        expect.objectContaining({
          triggerType: 'keeper',
          idempotencyKey: 'run-per-001',
          notional: '5000000000',
        }),
      );
      expect(result.status).toBe('completed');
      expect(result.public_outcome).toMatchObject({
        layer: 'per',
        cycleId: 'cycle-001',
        receiptCount: 2,
        cycleStatus: 'completed',
      });
      expect(onchainAdapter.setPublicSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentId: deployment.id,
          expectedSnapshotRevision: 2,
          status: 'ok',
        }),
      );
    });

    it('executes per run with zero notional when auto_notional is missing', async () => {
      const run = mockStrategyRun({ execution_layer: 'per', id: 'run-per-002' });
      const deployment = mockDeployment({ metadata: {} });

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(privateExecutionCyclesService.startCycle).toHaveBeenCalledWith(
        deployment.id,
        deployment.creator_wallet_address,
        expect.objectContaining({
          triggerType: 'keeper',
          idempotencyKey: 'run-per-002',
          notional: undefined,
        }),
      );
      expect(result.status).toBe('completed');
    });

    it('marks run as failed when deployment not found', async () => {
      const run = mockStrategyRun();

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockImplementation(() => {
        throw new Error('Deployment not found');
      });
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(result.status).toBe('failed');
      expect(result.error_message).toContain('Deployment not found');
      expect(metricsService.recordAdapterCall).toHaveBeenCalledWith(
        'keeper',
        'executeRun',
        'fail',
        expect.any(Number),
      );
    });

    it('marks run as failed when commitState throws', async () => {
      const run = mockStrategyRun({ execution_layer: 'offchain' });
      const deployment = mockDeployment();

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      onchainAdapter.commitState!.mockRejectedValue(new Error('RPC timeout'));
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(result.status).toBe('failed');
      expect(result.error_message).toContain('RPC timeout');
      expect(metricsService.recordAdapterCall).toHaveBeenCalledWith(
        'keeper',
        'executeRun',
        'fail',
        expect.any(Number),
      );
    });

    it('marks er run as failed when route throws', async () => {
      const run = mockStrategyRun({ execution_layer: 'er' });
      const deployment = mockDeployment();

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      erAdapter.route!.mockRejectedValue(new Error('Router timeout'));
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(result.status).toBe('failed');
      expect(result.error_message).toContain('Router timeout');
      expect(metricsService.recordAdapterCall).toHaveBeenCalledWith(
        'keeper',
        'executeRun',
        'fail',
        expect.any(Number),
      );
    });

    it('marks per run as failed when startCycle throws', async () => {
      const run = mockStrategyRun({ execution_layer: 'per' });
      const deployment = mockDeployment();

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      privateExecutionCyclesService.startCycle!.mockRejectedValue(new Error('Cycle engine error'));
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(result.status).toBe('failed');
      expect(result.error_message).toContain('Cycle engine error');
      expect(metricsService.recordAdapterCall).toHaveBeenCalledWith(
        'keeper',
        'executeRun',
        'fail',
        expect.any(Number),
      );
    });

    it('handles snapshot publish failure gracefully', async () => {
      const run = mockStrategyRun({ execution_layer: 'offchain' });
      const deployment = mockDeployment();

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      deploymentsRepository.updateDeployment!.mockResolvedValue(deployment);
      onchainAdapter.setPublicSnapshot!.mockRejectedValue(new Error('Snapshot rejected'));
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      // Run should still succeed even if snapshot publish fails
      expect(result.status).toBe('completed');
    });

    it('schedules a retry when run fails and retries are available', async () => {
      const run = mockStrategyRun({
        id: 'run-fail-retry',
        execution_layer: 'offchain',
        retry_count: 0,
        max_retries: 2,
      });
      const deployment = mockDeployment();

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      onchainAdapter.commitState!.mockRejectedValue(new Error('RPC timeout'));
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(result.status).toBe('failed');
      expect(result.error_message).toContain('RPC timeout');

      // Verify a retry run was created
      expect(runsRepository.insertRun).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentId: deployment.id,
          executionLayer: 'offchain',
          retryCount: 1,
          maxRetries: 2,
          retryOf: 'run-fail-retry',
        }),
      );
    });

    it('does not schedule retry when max retries exhausted', async () => {
      const run = mockStrategyRun({
        id: 'run-no-retry',
        execution_layer: 'offchain',
        retry_count: 2,
        max_retries: 2,
      });
      const deployment = mockDeployment();

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      onchainAdapter.commitState!.mockRejectedValue(new Error('RPC timeout'));
      runsRepository.updateRun = mockUpdateRun(run);
      jest.clearAllMocks();
      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      onchainAdapter.commitState!.mockRejectedValue(new Error('RPC timeout'));
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(result.status).toBe('failed');
      expect(runsRepository.insertRun).not.toHaveBeenCalled();
    });
  });
});

function mockStrategyRun(overrides: Partial<StrategyRunRow> = {}): StrategyRunRow {
  return {
    id: 'run-' + Math.random().toString(36).slice(2, 10),
    deployment_id: 'dep-test',
    strategy_version_id: null,
    execution_layer: 'offchain',
    status: 'pending',
    public_outcome: {},
    private_state_ref: null,
    er_session_id: null,
    per_session_id: null,
    workflow_execution_id: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    error_message: null,
    retry_count: 0,
    max_retries: 1,
    retry_of: null,
    ...overrides,
  };
}

function mockDeployment(overrides: Partial<StrategyDeploymentRow> = {}): StrategyDeploymentRow {
  return {
    id: 'dep-test',
    strategy_id: 'strat-test',
    strategy_version_id: null,
    creator_wallet_address: '0x1234',
    account_id: null,
    execution_mode: 'offchain',
    treasury_mode: 'public',
    lifecycle_status: 'deployed',
    state_revision: 0,
    private_state_account: null,
    public_snapshot_account: null,
    er_session_id: null,
    per_session_id: null,
    umbra_user_account: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
    ...overrides,
  };
}
