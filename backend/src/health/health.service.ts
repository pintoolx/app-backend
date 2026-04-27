import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Connection } from '@solana/web3.js';
import { SupabaseService } from '../database/supabase.service';
import { MagicBlockClientService } from '../magicblock/magicblock-client.service';

export interface ProbeResult {
  status: 'ok' | 'degraded' | 'fail' | 'skipped';
  latencyMs: number;
  note?: string;
}

export interface ReadinessReport {
  status: 'ok' | 'degraded' | 'fail';
  uptimeSeconds: number;
  checks: Record<string, ProbeResult>;
}

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';

/**
 * Week 6.2 — Cross-cutting readiness probe.
 *
 * Each adapter family's probe runs in real mode only; when the adapter is
 * Noop (env unset) the probe returns `skipped` so a Noop deployment can still
 * be considered "ready" for local dev / hackathon demos.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly bootedAt = Date.now();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly magicBlockClient: MagicBlockClientService,
    private readonly configService: ConfigService,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const [db, rpc, er, per, pp, umbra] = await Promise.all([
      this.probeDatabase(),
      this.probeSolanaRpc(),
      this.probeMagicBlockRouter(),
      this.probePerEndpoint(),
      this.probePpEndpoint(),
      this.probeUmbra(),
    ]);

    const checks: Record<string, ProbeResult> = {
      db,
      'solana-rpc': rpc,
      'magicblock-er': er,
      'magicblock-per': per,
      'magicblock-pp': pp,
      umbra,
    };

    const status = this.summarize(checks);
    return {
      status,
      uptimeSeconds: Math.max(0, Math.round((Date.now() - this.bootedAt) / 1000)),
      checks,
    };
  }

  // ---------------- probes ----------------

  private async probeDatabase(): Promise<ProbeResult> {
    const t = Date.now();
    try {
      const { error } = await this.supabase.client
        .from('strategies')
        .select('id', { count: 'exact', head: true })
        .limit(1);
      if (error) throw new Error(error.message);
      return { status: 'ok', latencyMs: Date.now() - t };
    } catch (err) {
      return {
        status: 'fail',
        latencyMs: Date.now() - t,
        note: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async probeSolanaRpc(): Promise<ProbeResult> {
    const t = Date.now();
    try {
      const url = this.configService.get<string>('SOLANA_RPC_URL') ?? DEFAULT_RPC_URL;
      const conn = new Connection(url, 'confirmed');
      const v = await conn.getVersion();
      return {
        status: 'ok',
        latencyMs: Date.now() - t,
        note: `solana-core ${v['solana-core'] ?? 'unknown'}`,
      };
    } catch (err) {
      return {
        status: 'fail',
        latencyMs: Date.now() - t,
        note: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async probeMagicBlockRouter(): Promise<ProbeResult> {
    const url = this.magicBlockClient.getRouterUrl();
    if (!url) return { status: 'skipped', latencyMs: 0, note: 'MAGICBLOCK_ROUTER_URL unset' };
    return this.probeHttp(`${url.replace(/\/$/, '')}/health`);
  }

  private async probePerEndpoint(): Promise<ProbeResult> {
    const endpoint = this.configService.get<string>('MAGICBLOCK_PER_ENDPOINT');
    if (!endpoint || !endpoint.trim())
      return { status: 'skipped', latencyMs: 0, note: 'MAGICBLOCK_PER_ENDPOINT unset' };
    return this.probeHttp(`${endpoint.trim().replace(/\/$/, '')}/v1/health`);
  }

  private async probePpEndpoint(): Promise<ProbeResult> {
    const endpoint = this.configService.get<string>('MAGICBLOCK_PP_ENDPOINT');
    if (!endpoint || !endpoint.trim())
      return { status: 'skipped', latencyMs: 0, note: 'MAGICBLOCK_PP_ENDPOINT unset' };
    return this.probeHttp(`${endpoint.trim().replace(/\/$/, '')}/v1/health`);
  }

  private async probeUmbra(): Promise<ProbeResult> {
    const enabled = this.configService.get<string>('UMBRA_ENABLED') === 'true';
    if (!enabled) return { status: 'skipped', latencyMs: 0, note: 'UMBRA_ENABLED is not true' };
    const indexer =
      this.configService.get<string>('UMBRA_INDEXER_API_ENDPOINT') ??
      'https://utxo-indexer.api.umbraprivacy.com';
    return this.probeHttp(indexer);
  }

  private async probeHttp(url: string): Promise<ProbeResult> {
    const t = Date.now();
    try {
      const res = await axios.get(url, { timeout: 2000, validateStatus: () => true });
      const ok = res.status >= 200 && res.status < 500;
      return {
        status: ok ? 'ok' : 'fail',
        latencyMs: Date.now() - t,
        note: `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        status: 'fail',
        latencyMs: Date.now() - t,
        note: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private summarize(checks: Record<string, ProbeResult>): 'ok' | 'degraded' | 'fail' {
    const values = Object.values(checks);
    if (values.some((c) => c.status === 'fail')) return 'fail';
    if (values.every((c) => c.status === 'ok' || c.status === 'skipped')) return 'ok';
    return 'degraded';
  }
}
