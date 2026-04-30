import { Test, TestingModule } from '@nestjs/testing';
import { StrategyRunsService } from './strategy-runs.service';
import { StrategyRunsRepository, StrategyRunRow } from './strategy-runs.repository';
import { StrategyDeploymentsRepository, StrategyDeploymentRow } from '../strategy-deployments/strategy-deployments.repository';
import { OnchainAdapterPort } from '../onchain/onchain-adapter.port';
import { MagicBlockErAdapterPort } from '../magicblock/magicblock.port';
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
  let metricsService: jest.Mocked<Partial<MetricsService>>;

  beforeEach(async () => {
    runsRepository = {
      insertRun: jest.fn(),
      getById: jest.fn(),
      updateRun: jest.fn(),
    };

    deploymentsRepository = {
      getById: jest.fn(),
    };

    onchainAdapter = {
      commitState: jest.fn().mockResolvedValue({
        signature: 'sig-commit-123',
        newStateRevision: 5,
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
  });

  describe('handleStrategyEvaluated', () => {
    it('creates a run and kicks off async execution', async () => {
      const baseRun = mockStrategyRun({ id: 'run-1' });
      runsRepository.insertRun!.mockResolvedValue(baseRun);
      runsRepository.getById!.mockResolvedValue(baseRun);

      const deployment = mockDeployment();
      deploymentsRepository.getById!.mockResolvedValue(deployment);
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
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(onchainAdapter.commitState).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentId: deployment.id,
          expectedRevision: 3,
        }),
      );
      expect(onchainAdapter.setPublicSnapshot).toHaveBeenCalled();
      expect(result.status).toBe('completed');
      expect(metricsService.recordAdapterCall).toHaveBeenCalledWith(
        'keeper',
        'executeRun',
        'ok',
        expect.any(Number),
      );
    });

    it('executes er run with advisory outcome', async () => {
      const run = mockStrategyRun({ execution_layer: 'er' });
      const deployment = mockDeployment();

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(onchainAdapter.commitState).not.toHaveBeenCalled();
      expect(result.status).toBe('completed');
      expect(result.public_outcome).toMatchObject({ layer: 'er', advisory: true });
    });

    it('executes per run with advisory outcome', async () => {
      const run = mockStrategyRun({ execution_layer: 'per' });
      const deployment = mockDeployment();

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      expect(result.status).toBe('completed');
      expect(result.public_outcome).toMatchObject({ layer: 'per', advisory: true });
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

    it('handles snapshot publish failure gracefully', async () => {
      const run = mockStrategyRun({ execution_layer: 'offchain' });
      const deployment = mockDeployment();

      runsRepository.getById!.mockResolvedValue(run);
      deploymentsRepository.getById!.mockResolvedValue(deployment);
      onchainAdapter.setPublicSnapshot!.mockRejectedValue(new Error('Snapshot rejected'));
      runsRepository.updateRun = mockUpdateRun(run);

      const result = await service.executeRun(run.id);

      // Run should still succeed even if snapshot publish fails
      expect(result.status).toBe('completed');
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
