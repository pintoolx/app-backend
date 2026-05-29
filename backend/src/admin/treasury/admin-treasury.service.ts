import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { ONCHAIN_ADAPTER, type OnchainAdapterPort } from '../../onchain/onchain-adapter.port';

/**
 * Live follower-vault AUM/TVL by reading each vault's on-chain SPL token
 * balance for a given treasury mint. The mint is required because it is not
 * stored per vault — it is supplied at deposit time — so the caller (operator)
 * names the treasury asset to denominate AUM in (typically the USDC mint).
 *
 * Balance reads go through the onchain adapter (noop in unconfigured envs, in
 * which case every vault reports a zero / non-existent ATA). Reads are bounded
 * by a vault cap and run in small concurrency chunks to avoid hammering RPC.
 */

const DEFAULT_VAULT_CAP = 100;
const MAX_VAULT_CAP = 500;
const READ_CONCURRENCY = 8;

interface FollowerVaultRow {
  id: string;
  subscription_id: string;
  deployment_id: string;
  authority_pda: string | null;
  vault_pda: string | null;
  lifecycle_status: string;
  custody_mode: string;
}

export interface AumVaultEntry {
  vaultId: string;
  subscriptionId: string;
  deploymentId: string;
  lifecycleStatus: string;
  custodyMode: string;
  authorityPda: string;
  vaultTokenAccount: string | null;
  rawAmount: string;
  uiAmount: number;
  decimals: number;
  exists: boolean;
}

export interface TreasuryAum {
  generatedAt: string;
  mint: string;
  decimals: number;
  /** Vaults whose balance was read this request. */
  vaultsRead: number;
  /** Vaults holding a non-zero balance of `mint`. */
  fundedVaults: number;
  totalRawAmount: string;
  totalUiAmount: number;
  /** Raw-amount subtotal per lifecycle_status. */
  byStatus: Record<string, string>;
  vaults: AumVaultEntry[];
  /** True if the vault list was capped (read MAX) — totals understate. */
  truncated: boolean;
}

function toBig(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

@Injectable()
export class AdminTreasuryService {
  private readonly logger = new Logger(AdminTreasuryService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    @Inject(ONCHAIN_ADAPTER) private readonly onchainAdapter: OnchainAdapterPort,
  ) {}

  async getAum(params: {
    mint?: string;
    limit?: number;
    includeClosed?: boolean;
  }): Promise<TreasuryAum> {
    const mint = params.mint?.trim();
    if (!mint) {
      throw new BadRequestException('mint query parameter is required to denominate AUM');
    }
    const cap = Math.min(Math.max(params.limit ?? DEFAULT_VAULT_CAP, 1), MAX_VAULT_CAP);

    let q = this.supabaseService.client
      .from('follower_vaults')
      .select('id, subscription_id, deployment_id, authority_pda, vault_pda, lifecycle_status, custody_mode')
      .order('created_at', { ascending: false })
      .limit(cap + 1); // fetch one extra to detect truncation
    if (!params.includeClosed) q = q.neq('lifecycle_status', 'closed');

    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list follower vaults for AUM', error);
      throw new BadRequestException('Failed to list follower vaults');
    }
    const allRows = (data ?? []) as unknown as FollowerVaultRow[];
    const truncated = allRows.length > cap;
    const rows = allRows.slice(0, cap).filter((r) => r.authority_pda);
    if (truncated) {
      this.logger.warn(`Treasury AUM hit vault cap (${cap}); totals understate platform TVL.`);
    }

    const entries = await this.readBalancesChunked(rows, mint);

    let totalRaw = 0n;
    let fundedVaults = 0;
    const byStatus: Record<string, string> = {};
    for (const e of entries) {
      const raw = toBig(e.rawAmount);
      totalRaw += raw;
      if (e.exists && raw > 0n) fundedVaults += 1;
      byStatus[e.lifecycleStatus] = (
        toBig(byStatus[e.lifecycleStatus] ?? '0') + raw
      ).toString();
    }
    // Mint decimals are uniform; take the largest non-zero value the adapter
    // reported (the anchor adapter resolves decimals even for empty ATAs).
    const decimals = entries.reduce((max, e) => Math.max(max, e.decimals), 0);
    const totalUiAmount = decimals > 0 ? Number(totalRaw) / 10 ** decimals : Number(totalRaw);

    return {
      generatedAt: new Date().toISOString(),
      mint,
      decimals,
      vaultsRead: entries.length,
      fundedVaults,
      totalRawAmount: totalRaw.toString(),
      totalUiAmount,
      byStatus,
      vaults: entries,
      truncated,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async readBalancesChunked(
    rows: FollowerVaultRow[],
    mint: string,
  ): Promise<AumVaultEntry[]> {
    const out: AumVaultEntry[] = [];
    for (let i = 0; i < rows.length; i += READ_CONCURRENCY) {
      const chunk = rows.slice(i, i + READ_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (row): Promise<AumVaultEntry> => {
          const base = {
            vaultId: row.id,
            subscriptionId: row.subscription_id,
            deploymentId: row.deployment_id,
            lifecycleStatus: row.lifecycle_status,
            custodyMode: row.custody_mode,
            authorityPda: row.authority_pda as string,
          };
          try {
            const bal = await this.onchainAdapter.readVaultTokenBalance({
              vaultAuthorityPda: row.authority_pda as string,
              mint,
            });
            return {
              ...base,
              vaultTokenAccount: bal.vaultTokenAccount,
              rawAmount: bal.rawAmount,
              uiAmount: bal.uiAmount,
              decimals: bal.decimals,
              exists: bal.exists,
            };
          } catch (err) {
            this.logger.warn(
              `AUM balance read failed for vault ${row.id}: ${
                err instanceof Error ? err.message : err
              }`,
            );
            return {
              ...base,
              vaultTokenAccount: null,
              rawAmount: '0',
              uiAmount: 0,
              decimals: 0,
              exists: false,
            };
          }
        }),
      );
      out.push(...results);
    }
    return out;
  }
}
