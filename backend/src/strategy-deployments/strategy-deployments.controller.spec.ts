import { Test, TestingModule } from '@nestjs/testing';
import { StrategyDeploymentsController } from './strategy-deployments.controller';
import { StrategyDeploymentsService } from './strategy-deployments.service';
import { StrategyRunsService } from '../strategy-keeper/strategy-runs.service';
import { StrategyDeploymentsRepository } from './strategy-deployments.repository';
import { StrategyPermissionsService } from '../strategies/strategy-permissions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PerAuthGuard } from '../magicblock/per-auth.guard';
import { StrategyRunRow } from '../strategy-keeper/strategy-runs.repository';

describe('StrategyDeploymentsController', () => {
  let controller: StrategyDeploymentsController;
  let deploymentsRepository: any;
  let strategyRunsService: any;

  const mockDeployment = (overrides: Record<string, unknown> = {}) => ({
    id: 'dep-123',
    strategy_id: 'strat-1',
    strategy_version_id: null,
    creator_wallet_address: 'wallet-owner',
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
  });

  const mockRun = (overrides: Record<string, unknown> = {}): StrategyRunRow => ({
    id: 'run-new-1',
    deployment_id: 'dep-123',
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
  });

  beforeEach(async () => {
    deploymentsRepository = {
      getForCreator: jest.fn(),
    };

    strategyRunsService = {
      createRun: jest.fn(),
      executeRun: jest.fn().mockResolvedValue(mockRun({ status: 'completed' })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StrategyDeploymentsController],
      providers: [
        {
          provide: StrategyDeploymentsService,
          useValue: {},
        },
        {
          provide: StrategyRunsService,
          useValue: strategyRunsService,
        },
        {
          provide: StrategyDeploymentsRepository,
          useValue: deploymentsRepository,
        },
        {
          provide: StrategyPermissionsService,
          useValue: {},
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PerAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StrategyDeploymentsController>(StrategyDeploymentsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /deployments/:id/trigger', () => {
    it('creates a run and returns run ID when deployment is in deployed state', async () => {
      const deployment = mockDeployment();
      const run = mockRun();

      deploymentsRepository.getForCreator.mockResolvedValue(deployment);
      strategyRunsService.createRun.mockResolvedValue(run);

      const result = await controller.triggerDeployment('dep-123', 'wallet-owner');

      expect(result).toEqual({
        success: true,
        data: {
          runId: 'run-new-1',
          deploymentId: 'dep-123',
          executionLayer: 'offchain',
          status: 'pending',
        },
      });

      expect(deploymentsRepository.getForCreator).toHaveBeenCalledWith('dep-123', 'wallet-owner');
      expect(strategyRunsService.createRun).toHaveBeenCalledWith({
        deploymentId: 'dep-123',
        executionLayer: 'offchain',
        strategyVersionId: null,
      });
      expect(strategyRunsService.executeRun).toHaveBeenCalledWith('run-new-1');
    });

    it('returns existing active run when concurrency guard triggers', async () => {
      const deployment = mockDeployment();
      const activeRun = mockRun({ id: 'run-active', status: 'running' });

      deploymentsRepository.getForCreator.mockResolvedValue(deployment);
      strategyRunsService.createRun.mockResolvedValue(activeRun);

      const result = await controller.triggerDeployment('dep-123', 'wallet-owner');

      expect(result.success).toBe(true);
      expect(result.data.runId).toBe('run-active');
      expect(result.data.status).toBe('running');
      expect(strategyRunsService.executeRun).toHaveBeenCalledWith('run-active');
    });

    it('returns error when deployment is not in deployed state', async () => {
      const deployment = mockDeployment({ lifecycle_status: 'paused' });
      deploymentsRepository.getForCreator.mockResolvedValue(deployment);

      const result = await controller.triggerDeployment('dep-123', 'wallet-owner');

      expect(result).toEqual({
        success: false,
        error: "Deployment must be in 'deployed' state to trigger (current: paused)",
      });
      expect(strategyRunsService.createRun).not.toHaveBeenCalled();
    });

    it('returns error when deployment is in stopped state', async () => {
      const deployment = mockDeployment({ lifecycle_status: 'stopped' });
      deploymentsRepository.getForCreator.mockResolvedValue(deployment);

      const result = await controller.triggerDeployment('dep-123', 'wallet-owner');

      expect(result).toEqual({
        success: false,
        error: "Deployment must be in 'deployed' state to trigger (current: stopped)",
      });
      expect(strategyRunsService.createRun).not.toHaveBeenCalled();
    });
  });
});
