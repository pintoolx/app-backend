import { BadRequestException } from '@nestjs/common';
import { AdminFollowerVaultsOpsService } from './admin-follower-vaults-ops.service';
import { type FollowerVaultRow } from '../../follower-vaults/follower-vaults.repository';
import { type StrategySubscriptionRow } from '../../follower-vaults/subscriptions.repository';
import { type FollowerVisibilityGrantRow } from '../../follower-vaults/follower-visibility-grants.repository';
import { type PrivateExecutionCycleRow } from '../../follower-vaults/private-execution-cycles.repository';

const makeVault = (status: FollowerVaultRow['lifecycle_status']): FollowerVaultRow => ({
  id: 'fv-1',
  subscription_id: 'sub-1',
  deployment_id: 'dep-1',
  vault_pda: null,
  authority_pda: null,
  lifecycle_status: status,
  private_state_ref: null,
  public_snapshot_ref: null,
  custody_mode: 'program_owned',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const makeSub = (status: StrategySubscriptionRow['status']): StrategySubscriptionRow => ({
  id: 'sub-1',
  deployment_id: 'dep-1',
  follower_wallet: 'wallet-f',
  subscription_pda: null,
  follower_vault_pda: null,
  vault_authority_pda: null,
  status,
  visibility_preset: 'subscriber-self',
  max_capital: '100',
  allocation_mode: 'proportional',
  max_drawdown_bps: null,
  per_member_ref: null,
  umbra_identity_ref: null,
  provisioning_state: 'provisioning_complete',
  provisioning_error: null,
  lifecycle_drift: false,
  subscription_pda_bump: null,
  follower_vault_pda_bump: null,
  vault_authority_pda_bump: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const makeGrant = (
  status: FollowerVisibilityGrantRow['status'],
): FollowerVisibilityGrantRow => ({
  id: 'g-1',
  subscription_id: 'sub-1',
  grantee_wallet: 'wallet-g',
  scope: 'vault-balance',
  status,
  expires_at: null,
  revoked_at: null,
  payload: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const makeCycle = (
  status: PrivateExecutionCycleRow['status'],
  metricsSummary: Record<string, unknown> = {},
): PrivateExecutionCycleRow => ({
  id: 'c-1',
  deployment_id: 'dep-1',
  idempotency_key: 'idem-1',
  trigger_type: 'price',
  trigger_ref: 'pyth:abc',
  status,
  metrics_summary: metricsSummary,
  started_at: '2026-01-01T00:00:00.000Z',
  completed_at: '2026-01-01T00:00:01.000Z',
  error_message: status === 'failed' ? 'mock failure' : null,
});

const buildHarness = (overrides: {
  grant?: FollowerVisibilityGrantRow;
  vault?: FollowerVaultRow;
  sub?: StrategySubscriptionRow;
  cycle?: PrivateExecutionCycleRow;
} = {}) => {
  const grantsRepo = {
    getById: jest.fn().mockResolvedValue(overrides.grant ?? makeGrant('active')),
    revoke: jest.fn().mockImplementation(async (id: string) => ({
      ...(overrides.grant ?? makeGrant('active')),
      id,
      status: 'revoked' as const,
      revoked_at: '2026-01-01T01:00:00.000Z',
    })),
  };
  const vaultsRepo = {
    getById: jest.fn().mockResolvedValue(overrides.vault ?? makeVault('active')),
    update: jest.fn().mockImplementation(async (id: string, input: Record<string, unknown>) => ({
      ...(overrides.vault ?? makeVault('active')),
      id,
      lifecycle_status: (input.lifecycleStatus as FollowerVaultRow['lifecycle_status']) ?? 'active',
    })),
  };
  const subsRepo = {
    getById: jest.fn().mockResolvedValue(overrides.sub ?? makeSub('active')),
    update: jest.fn().mockImplementation(async (id: string, input: Record<string, unknown>) => ({
      ...(overrides.sub ?? makeSub('active')),
      id,
      status: input.status,
    })),
  };
  const cyclesRepo = {
    getById: jest.fn().mockResolvedValue(overrides.cycle ?? makeCycle('failed')),
  };
  const cyclesService = {
    startCycle: jest.fn().mockResolvedValue({
      cycle: { ...makeCycle('completed'), id: 'c-2' },
      receipts: [{ id: 'r-1' }, { id: 'r-2' }],
    }),
  };
  const deploymentsRepo = {
    getById: jest.fn().mockResolvedValue({
      id: 'dep-1',
      creator_wallet_address: 'wallet-creator',
    }),
  };

  const service = new AdminFollowerVaultsOpsService(
    grantsRepo as any,
    vaultsRepo as any,
    subsRepo as any,
    cyclesRepo as any,
    cyclesService as any,
    deploymentsRepo as any,
  );
  return { service, grantsRepo, vaultsRepo, subsRepo, cyclesRepo, cyclesService, deploymentsRepo };
};

describe('AdminFollowerVaultsOpsService', () => {
  describe('revokeVisibilityGrant', () => {
    it('revokes an active grant', async () => {
      const { service, grantsRepo } = buildHarness();
      const result = await service.revokeVisibilityGrant('g-1');
      expect(grantsRepo.revoke).toHaveBeenCalledWith('g-1');
      expect(result.status).toBe('revoked');
    });
    it('rejects double revoke', async () => {
      const { service } = buildHarness({ grant: makeGrant('revoked') });
      await expect(service.revokeVisibilityGrant('g-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
    it('rejects revoke on expired grant', async () => {
      const { service } = buildHarness({ grant: makeGrant('expired') });
      await expect(service.revokeVisibilityGrant('g-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('pauseFollowerVault', () => {
    it('pauses an active vault and its parent subscription', async () => {
      const { service, vaultsRepo, subsRepo } = buildHarness();
      const result = await service.pauseFollowerVault('fv-1');
      expect(result.lifecycle_status).toBe('paused');
      expect(vaultsRepo.update).toHaveBeenCalledWith('fv-1', { lifecycleStatus: 'paused' });
      expect(subsRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({ status: 'paused' }),
      );
    });
    it('rejects pause when already paused', async () => {
      const { service } = buildHarness({ vault: makeVault('paused') });
      await expect(service.pauseFollowerVault('fv-1')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('rejects pause when closed', async () => {
      const { service } = buildHarness({ vault: makeVault('closed') });
      await expect(service.pauseFollowerVault('fv-1')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('does not flip subscription status when sub is not active', async () => {
      const { service, subsRepo } = buildHarness({ sub: makeSub('exiting') });
      await service.pauseFollowerVault('fv-1');
      expect(subsRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('recoverFollowerVault', () => {
    it('flips paused -> active', async () => {
      const { service, vaultsRepo, subsRepo } = buildHarness({
        vault: makeVault('paused'),
        sub: makeSub('paused'),
      });
      const result = await service.recoverFollowerVault('fv-1');
      expect(result.lifecycle_status).toBe('active');
      expect(vaultsRepo.update).toHaveBeenCalledWith('fv-1', { lifecycleStatus: 'active' });
      expect(subsRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({ status: 'active' }),
      );
    });
    it('rejects recover when not paused', async () => {
      const { service } = buildHarness({ vault: makeVault('active') });
      await expect(service.recoverFollowerVault('fv-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('retryPrivateCycle', () => {
    it('retries a failed cycle with new idempotency key', async () => {
      const { service, cyclesService } = buildHarness({
        cycle: makeCycle('failed', { notional: '5000' }),
      });
      const result = await service.retryPrivateCycle('c-1');
      expect(result.originalCycleId).toBe('c-1');
      expect(result.newCycle.id).toBe('c-2');
      expect(result.receiptCount).toBe(2);

      const callArgs = (cyclesService.startCycle as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe('dep-1');
      expect(callArgs[1]).toBe('wallet-creator');
      expect(callArgs[2].triggerType).toBe('price');
      expect(callArgs[2].notional).toBe('5000');
      expect(callArgs[2].idempotencyKey).toMatch(/^idem-1-retry-[0-9a-f]+$/);
    });
    it('rejects retry on running cycles', async () => {
      const { service } = buildHarness({ cycle: makeCycle('running') });
      await expect(service.retryPrivateCycle('c-1')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('rejects retry on accepted cycles', async () => {
      const { service } = buildHarness({ cycle: makeCycle('accepted') });
      await expect(service.retryPrivateCycle('c-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
