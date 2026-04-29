import { FollowerVaultAllocationsService } from './follower-vault-allocations.service';
import { type StrategySubscriptionRow } from './subscriptions.repository';

const baseSub = (overrides: Partial<StrategySubscriptionRow>): StrategySubscriptionRow => ({
  id: overrides.id ?? 'sub-1',
  deployment_id: 'dep-1',
  follower_wallet: overrides.follower_wallet ?? 'wallet-1',
  subscription_pda: null,
  follower_vault_pda: null,
  vault_authority_pda: null,
  status: 'active',
  visibility_preset: 'subscriber-self',
  max_capital: overrides.max_capital ?? null,
  allocation_mode: overrides.allocation_mode ?? 'proportional',
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

describe('FollowerVaultAllocationsService', () => {
  const service = new FollowerVaultAllocationsService();

  it('returns zero allocations when notional is zero', () => {
    const subs = [baseSub({ id: 's1', max_capital: '100' })];
    const result = service.computeAllocations(service.fromRows(subs), 0n);
    expect(result).toEqual([
      {
        subscriptionId: 's1',
        followerWallet: 'wallet-1',
        allocationPctBps: 0,
        allocationAmount: '0',
      },
    ]);
  });

  it('splits proportionally by max_capital weight', () => {
    const subs = [
      baseSub({ id: 's1', follower_wallet: 'w1', max_capital: '100' }),
      baseSub({ id: 's2', follower_wallet: 'w2', max_capital: '300' }),
    ];
    const result = service.computeAllocations(service.fromRows(subs), 1_000n);
    expect(result.find((r) => r.subscriptionId === 's1')).toEqual({
      subscriptionId: 's1',
      followerWallet: 'w1',
      allocationPctBps: 2500,
      allocationAmount: '100',
    });
    expect(result.find((r) => r.subscriptionId === 's2')).toEqual({
      subscriptionId: 's2',
      followerWallet: 'w2',
      allocationPctBps: 7500,
      allocationAmount: '300',
    });
  });

  it('caps each follower at their max_capital', () => {
    const subs = [
      baseSub({ id: 's1', max_capital: '100' }), // very small cap
      baseSub({ id: 's2', max_capital: '100' }),
    ];
    // Notional much larger than total weight — share should still be capped.
    const result = service.computeAllocations(service.fromRows(subs), 10_000n);
    for (const row of result) {
      expect(BigInt(row.allocationAmount)).toBeLessThanOrEqual(100n);
    }
  });

  it('fixed mode caps each follower to their max_capital', () => {
    const subs = [
      baseSub({ id: 's1', max_capital: '100', allocation_mode: 'fixed' }),
      baseSub({ id: 's2', max_capital: '500', allocation_mode: 'fixed' }),
    ];
    // Notional larger than max_capital for s1, smaller for s2.
    const result = service.computeAllocations(service.fromRows(subs), 200n);
    expect(result.find((r) => r.subscriptionId === 's1')?.allocationAmount).toBe('100');
    expect(result.find((r) => r.subscriptionId === 's2')?.allocationAmount).toBe('200');
  });

  it('mirror mode requires a strategy output and returns zero without one', () => {
    const subs = [baseSub({ id: 's1', max_capital: '100', allocation_mode: 'mirror' })];
    const result = service.computeAllocations(service.fromRows(subs), 1_000n);
    expect(result[0].allocationAmount).toBe('0');
  });

  it('handles followers with no max_capital declared', () => {
    const subs = [
      baseSub({ id: 's1', max_capital: null }),
      baseSub({ id: 's2', max_capital: '500' }),
    ];
    const result = service.computeAllocations(service.fromRows(subs), 1_000n);
    expect(result.find((r) => r.subscriptionId === 's1')?.allocationAmount).toBe('0');
    // The lone weighted subscription gets the full notional, capped by its cap.
    expect(result.find((r) => r.subscriptionId === 's2')?.allocationAmount).toBe('500');
  });
});
