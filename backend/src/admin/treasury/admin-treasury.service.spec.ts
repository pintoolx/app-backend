import { BadRequestException } from '@nestjs/common';
import { AdminTreasuryService } from './admin-treasury.service';
import { type SupabaseService } from '../../database/supabase.service';
import { type OnchainAdapterPort, type VaultTokenBalance } from '../../onchain/onchain-adapter.port';

const MINT = 'MintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const vaultRows = [
  { id: 'v1', subscription_id: 's1', deployment_id: 'd1', authority_pda: 'auth1', vault_pda: 'vp1', lifecycle_status: 'active', custody_mode: 'program_owned' },
  { id: 'v2', subscription_id: 's2', deployment_id: 'd1', authority_pda: 'auth2', vault_pda: 'vp2', lifecycle_status: 'active', custody_mode: 'program_owned' },
  { id: 'v3', subscription_id: 's3', deployment_id: 'd2', authority_pda: 'auth3', vault_pda: 'vp3', lifecycle_status: 'paused', custody_mode: 'program_owned' },
  // No authority_pda → skipped from balance reads.
  { id: 'v4', subscription_id: 's4', deployment_id: 'd2', authority_pda: null, vault_pda: null, lifecycle_status: 'pending_funding', custody_mode: 'self_custody' },
];

// Balances keyed by authority PDA. 6 decimals (USDC-like).
const balances: Record<string, { raw: string; ui: number; exists: boolean }> = {
  auth1: { raw: '1000000', ui: 1, exists: true },
  auth2: { raw: '2500000', ui: 2.5, exists: true },
  auth3: { raw: '0', ui: 0, exists: false },
};

const buildSupabase = (rows = vaultRows) =>
  ({
    client: {
      from: () => {
        const builder: any = {
          select: () => builder,
          order: () => builder,
          neq: () => builder,
          limit: () => builder,
          then: (r: (v: unknown) => unknown) =>
            Promise.resolve({ data: rows, error: null }).then(r),
        };
        return builder;
      },
    },
  }) as unknown as SupabaseService;

const onchain = {
  async readVaultTokenBalance({
    vaultAuthorityPda,
    mint,
  }: {
    vaultAuthorityPda: string;
    mint: string;
  }): Promise<VaultTokenBalance> {
    const b = balances[vaultAuthorityPda] ?? { raw: '0', ui: 0, exists: false };
    return {
      vaultAuthorityPda,
      vaultTokenAccount: `${vaultAuthorityPda}-ata`,
      mint,
      rawAmount: b.raw,
      uiAmount: b.ui,
      decimals: 6,
      exists: b.exists,
    };
  },
} as unknown as OnchainAdapterPort;

describe('AdminTreasuryService.getAum', () => {
  it('sums on-chain balances, counts funded vaults and groups by status', async () => {
    const service = new AdminTreasuryService(buildSupabase(), onchain);
    const aum = await service.getAum({ mint: MINT });

    expect(aum.mint).toBe(MINT);
    expect(aum.decimals).toBe(6);
    expect(aum.vaultsRead).toBe(3); // v4 skipped (no authority_pda)
    expect(aum.fundedVaults).toBe(2); // v1, v2
    expect(aum.totalRawAmount).toBe('3500000'); // 1.0 + 2.5 + 0
    expect(aum.totalUiAmount).toBeCloseTo(3.5);
    expect(aum.byStatus.active).toBe('3500000');
    expect(aum.byStatus.paused).toBe('0');
    expect(aum.truncated).toBe(false);
  });

  it('rejects when no mint is supplied', async () => {
    const service = new AdminTreasuryService(buildSupabase(), onchain);
    await expect(service.getAum({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('flags truncation when the vault list exceeds the cap', async () => {
    const many = Array.from({ length: 3 }, (_, i) => ({
      id: `m${i}`,
      subscription_id: `s${i}`,
      deployment_id: 'd1',
      authority_pda: `auth1`,
      vault_pda: 'vp',
      lifecycle_status: 'active',
      custody_mode: 'program_owned',
    }));
    const service = new AdminTreasuryService(buildSupabase(many), onchain);
    const aum = await service.getAum({ mint: MINT, limit: 2 });
    expect(aum.truncated).toBe(true);
    expect(aum.vaultsRead).toBe(2);
  });
});
