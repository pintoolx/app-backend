import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Commitment, VersionedTransaction, Transaction } from '@solana/web3.js';
import { ConnectionMagicRouter } from '@magicblock-labs/ephemeral-rollups-sdk';
import axios, { AxiosError, AxiosInstance } from 'axios';

const DEFAULT_COMMITMENT: Commitment = 'confirmed';

/**
 * Lightweight client wrapping Magic Router + ER RPC connections.
 *
 * Magic Router (https://docs.magicblock.gg/pages/get-started/how-to-integrate-magicblock/typescript)
 * is the user-facing endpoint that smart-routes traffic between mainnet and
 * an ER session based on which accounts are delegated. We use it for two
 * purposes:
 *   1. Submitting `delegate` / `commit_and_undelegate` instructions targeting
 *      MagicBlock's delegation program (without needing CPI from our own
 *      strategy_runtime program).
 *   2. Forwarding raw, base64-encoded user transactions while a deployment is
 *      ER-active.
 *
 * The ER RPC URL is the direct Ephemeral Rollups RPC endpoint, used when we
 * need to query rollup-only state (commitments, latest blockhash inside the
 * rollup). For Week 4 we mainly rely on the Router, but the field is exposed
 * so future work can hit ER directly.
 *
 * If neither URL is configured the client throws on any operation; callers
 * are expected to gate this behind the env-presence module factory.
 */
@Injectable()
export class MagicBlockClientService {
  private readonly logger = new Logger(MagicBlockClientService.name);
  private routerConnection: ConnectionMagicRouter | null = null;
  private erConnection: Connection | null = null;
  private routerHttp: AxiosInstance | null = null;

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.getRouterUrl() ?? this.getErRpcUrl());
  }

  getRouterUrl(): string | null {
    const url = this.configService.get<string>('MAGICBLOCK_ROUTER_URL');
    return url && url.trim().length > 0 ? url.trim() : null;
  }

  getErRpcUrl(): string | null {
    const url = this.configService.get<string>('MAGICBLOCK_ER_RPC_URL');
    return url && url.trim().length > 0 ? url.trim() : null;
  }

  getDelegateProgramId(): string | null {
    const id = this.configService.get<string>('MAGICBLOCK_DELEGATE_PROGRAM_ID');
    return id && id.trim().length > 0 ? id.trim() : null;
  }

  /**
   * Returns a Solana web3.js Connection pointed at Magic Router. Use this for
   * transaction submission and account fetches that should respect MagicBlock
   * routing semantics.
   */
  getRouterConnection(): ConnectionMagicRouter {
    if (this.routerConnection) return this.routerConnection;
    const url = this.getRouterUrl();
    if (!url) {
      throw new InternalServerErrorException('MAGICBLOCK_ROUTER_URL is not configured');
    }
    const commitment =
      (this.configService.get<string>('MAGICBLOCK_COMMITMENT') as Commitment | undefined) ??
      DEFAULT_COMMITMENT;
    const wsEndpoint = url.replace(/^https?/, 'wss');
    this.routerConnection = new ConnectionMagicRouter(url, {
      wsEndpoint,
      commitment,
    });
    this.logger.log(`MagicBlock router connection initialised at ${url}`);
    return this.routerConnection;
  }

  /**
   * Returns a Solana web3.js Connection pointed at the ER RPC. Optional —
   * Week 4 paths default to the Router, but bots that want to read pre-commit
   * state may fall back to this.
   */
  getErConnection(): Connection {
    if (this.erConnection) return this.erConnection;
    const url = this.getErRpcUrl();
    if (!url) {
      throw new InternalServerErrorException('MAGICBLOCK_ER_RPC_URL is not configured');
    }
    const commitment =
      (this.configService.get<string>('MAGICBLOCK_COMMITMENT') as Commitment | undefined) ??
      DEFAULT_COMMITMENT;
    this.erConnection = new Connection(url, commitment);
    this.logger.log(`MagicBlock ER connection initialised at ${url}`);
    return this.erConnection;
  }

  /**
   * Lazy axios HTTP client for Magic Router auxiliary REST endpoints (not the
   * Solana JSON-RPC layer). Used for routes such as
   * `/api/v1/sessions/lookup` if the deployer ever needs to introspect a
   * session id outside of standard RPC.
   */
  getRouterHttp(): AxiosInstance {
    if (this.routerHttp) return this.routerHttp;
    const url = this.getRouterUrl();
    if (!url) {
      throw new InternalServerErrorException('MAGICBLOCK_ROUTER_URL is not configured');
    }
    this.routerHttp = axios.create({
      baseURL: url,
      timeout: 10_000,
    });
    return this.routerHttp;
  }

  /**
   * Submits a base64-encoded versioned or legacy transaction through Magic
   * Router. Returns the resulting signature. Surfaces a sanitized error
   * message on failure.
   */
  async submitBase64Transaction(base64Tx: string): Promise<string> {
    let raw: Buffer;
    try {
      raw = Buffer.from(base64Tx, 'base64');
    } catch (err) {
      throw new InternalServerErrorException('Invalid base64 transaction payload');
    }
    if (raw.length === 0) {
      throw new InternalServerErrorException('Empty transaction payload');
    }

    let serialized: Uint8Array;
    try {
      // Try versioned first; fall back to legacy on deserialise failure.
      const versioned = VersionedTransaction.deserialize(raw);
      serialized = versioned.serialize();
    } catch {
      try {
        const legacy = Transaction.from(raw);
        serialized = legacy.serialize({ requireAllSignatures: false, verifySignatures: false });
      } catch (innerErr) {
        throw new InternalServerErrorException('Failed to deserialise transaction payload');
      }
    }

    const connection = this.getRouterConnection();
    try {
      const sig = await connection.sendRawTransaction(serialized, {
        skipPreflight: true,
        preflightCommitment:
          (this.configService.get<string>('MAGICBLOCK_COMMITMENT') as Commitment | undefined) ??
          DEFAULT_COMMITMENT,
      });
      this.logger.log(`router.submit signature=${sig}`);
      return sig;
    } catch (err) {
      const msg = this.toRpcErrorMessage(err);
      this.logger.error(`router.submit failed: ${msg}`);
      throw new InternalServerErrorException(`Magic Router submission failed: ${msg}`);
    }
  }

  private toRpcErrorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError;
      const data = ax.response?.data;
      if (typeof data === 'string') return data.slice(0, 240);
      if (data && typeof data === 'object') return JSON.stringify(data).slice(0, 240);
      return ax.message;
    }
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
