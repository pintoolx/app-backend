import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { StrategyKeeperService } from './strategy-keeper.service';
import { SupabaseService } from '../database/supabase.service';
import { KeeperKeypairService } from '../onchain/keeper-keypair.service';
import { MetricsService } from '../observability/metrics.service';
import { StrategyDeploymentRow } from '../strategy-deployments/strategy-deployments.repository';

jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      getBalance: jest.fn(),
    })),
  };
});

describe('StrategyKeeperService', () => {
  let service: StrategyKeeperService;
  let supabaseService: jest.Mocked<Partial<SupabaseService>>;
  let keeperKeypairService: jest.Mocked<Partial<KeeperKeypairService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;
  let metricsService: jest.Mocked<Partial<MetricsService>>;
  let eventEmitter: jest.Mocked<Partial<EventEmitter2>>;

  const mockKeypair = Keypair.generate();

  beforeEach(async () => {
    supabaseService = {
      client: {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
      } as any,
    };

    keeperKeypairService = {
      loadKeypair: jest.fn().mockResolvedValue(mockKeypair),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'SOLANA_RPC_URL') return 'https://api.devnet.solana.com';
        if (key === 'STRATEGY_KEEPER_POLLING_MS') return 1000;
        return undefined;
      }),
    } as any;

    metricsService = {
      recordAdapterCall: jest.fn(),
    };

    eventEmitter = {
      emit: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyKeeperService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: KeeperKeypairService, useValue: keeperKeypairService },
        { provide: ConfigService, useValue: configService },
        { provide: MetricsService, useValue: metricsService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<StrategyKeeperService>(StrategyKeeperService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllMocks();
  });

  describe('syncDeployments', () => {
    it('returns 0 when no deployed strategies exist', async () => {
      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });
      (supabaseService.client as any).from = mockFrom;

      (Connection as jest.Mock).mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue(1 * LAMPORTS_PER_SOL),
      }));

      const count = await service.syncDeployments();
      expect(count).toBe(0);
      expect(mockFrom).toHaveBeenCalledWith('strategy_deployments');
    });

    it('skips all evaluations when keeper balance is too low', async () => {
      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest
              .fn()
              .mockResolvedValue({ data: [mockDeployment()], error: null }),
          }),
        }),
      });
      (supabaseService.client as any).from = mockFrom;

      (Connection as jest.Mock).mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue(0.05 * LAMPORTS_PER_SOL),
      }));

      const count = await service.syncDeployments();
      expect(count).toBe(0);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('emits evaluation event for interval-triggered deployment', async () => {
      const deployment = mockDeployment({
        metadata: {
          trigger_config: { type: 'interval', interval_ms: 1000 },
        },
      });

      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: [deployment], error: null }),
          }),
        }),
      });
      (supabaseService.client as any).from = mockFrom;

      (Connection as jest.Mock).mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue(2 * LAMPORTS_PER_SOL),
      }));

      const count = await service.syncDeployments();
      expect(count).toBe(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'strategy.evaluated',
        expect.objectContaining({
          deploymentId: deployment.id,
          strategyId: deployment.strategy_id,
          triggerType: 'interval',
        }),
      );
    });

    it('does not re-trigger before interval has elapsed', async () => {
      const deployment = mockDeployment({
        metadata: {
          trigger_config: { type: 'interval', interval_ms: 300_000 },
        },
      });

      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: [deployment], error: null }),
          }),
        }),
      });
      (supabaseService.client as any).from = mockFrom;

      (Connection as jest.Mock).mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue(2 * LAMPORTS_PER_SOL),
      }));

      // First evaluation — should trigger
      let count = await service.syncDeployments();
      expect(count).toBe(1);

      // Second evaluation immediately — should not trigger
      count = await service.syncDeployments();
      expect(count).toBe(0);
    });

    it('handles manual trigger from metadata', async () => {
      const deployment = mockDeployment({
        metadata: {
          trigger_config: { type: 'manual' },
          manual_trigger_pending: true,
        },
      });

      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: [deployment], error: null }),
          }),
        }),
      });
      (supabaseService.client as any).from = mockFrom;

      (Connection as jest.Mock).mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue(2 * LAMPORTS_PER_SOL),
      }));

      const count = await service.syncDeployments();
      expect(count).toBe(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'strategy.evaluated',
        expect.objectContaining({
          triggerType: 'manual',
        }),
      );
    });

    it('records metrics on success and failure', async () => {
      // Success case
      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });
      (supabaseService.client as any).from = mockFrom;

      (Connection as jest.Mock).mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue(2 * LAMPORTS_PER_SOL),
      }));

      await service.syncDeployments();
      expect(metricsService.recordAdapterCall).toHaveBeenCalledWith(
        'keeper',
        'syncDeployments',
        'ok',
        expect.any(Number),
      );

      // Failure case
      (supabaseService.client as any).from = jest.fn().mockImplementation(() => {
        throw new Error('DB error');
      });

      await service.syncDeployments();
      expect(metricsService.recordAdapterCall).toHaveBeenCalledWith(
        'keeper',
        'syncDeployments',
        'fail',
        expect.any(Number),
      );
    });
  });

  describe('forceEvaluation', () => {
    it('triggers an immediate sync', async () => {
      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });
      (supabaseService.client as any).from = mockFrom;

      (Connection as jest.Mock).mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue(2 * LAMPORTS_PER_SOL),
      }));

      const count = await service.forceEvaluation();
      expect(count).toBe(0);
    });
  });

  describe('getLastEvaluations', () => {
    it('returns empty array before any evaluation', () => {
      expect(service.getLastEvaluations()).toEqual([]);
    });

    it('returns evaluation history after sync', async () => {
      const deployment = mockDeployment();
      const mockFrom = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: [deployment], error: null }),
          }),
        }),
      });
      (supabaseService.client as any).from = mockFrom;

      (Connection as jest.Mock).mockImplementation(() => ({
        getBalance: jest.fn().mockResolvedValue(2 * LAMPORTS_PER_SOL),
      }));

      await service.syncDeployments();
      const evaluations = service.getLastEvaluations();
      expect(evaluations).toHaveLength(1);
      expect(evaluations[0]).toMatchObject({
        deploymentId: deployment.id,
        triggered: true,
      });
    });
  });
});

function mockDeployment(
  overrides: Partial<StrategyDeploymentRow> = {},
): StrategyDeploymentRow {
  return {
    id: 'dep-' + Math.random().toString(36).slice(2, 10),
    strategy_id: 'strat-' + Math.random().toString(36).slice(2, 10),
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
