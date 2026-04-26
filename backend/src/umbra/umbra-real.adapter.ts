import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import bs58 from 'bs58';
import {
  type UmbraAdapterPort,
  type UmbraDepositParams,
  type UmbraEncryptedBalance,
  type UmbraEncryptedBalanceParams,
  type UmbraGrantResult,
  type UmbraGrantViewerParams,
  type UmbraRegisterParams,
  type UmbraRegisterResult,
  type UmbraTransferParams,
  type UmbraTreasuryResult,
  type UmbraWithdrawParams,
} from './umbra.port';
import { UmbraDeploymentSignerService } from './umbra-deployment-signer.service';

/**
 * Real Umbra adapter — Week 4 implementation.
 *
 * Design notes:
 *   - We do not depend on the Umbra TS SDK package (not yet on npm). Instead
 *     we implement the registration / treasury operations as direct HTTP
 *     posts to the Umbra Queue endpoint (`UMBRA_QUEUE_URL`), with a
 *     deterministic per-deployment Ed25519 + X25519 keypair derived via
 *     `UmbraDeploymentSignerService`.
 *   - When `UMBRA_QUEUE_URL` is unset, the adapter operates in "local-only"
 *     mode: it still derives keys and returns the X25519 public key + signer
 *     pubkey + status='pending', but does not attempt to enqueue anything.
 *     This keeps the adapter useful for local devnet flows that hold their
 *     own Umbra instance.
 *   - All callbacks (post-MPC confirmations) are out of scope for Week 4 and
 *     remain Noop. The status moves to 'confirmed' only when an external
 *     webhook calls back.
 *   - `register` is idempotent because the signer derivation is
 *     deterministic; calling it twice for the same deployment yields the
 *     same X25519 key but a fresh `queueSignature` if the queue is enabled.
 */
@Injectable()
export class UmbraRealAdapter implements UmbraAdapterPort {
  private readonly logger = new Logger(UmbraRealAdapter.name);
  private queueClient: AxiosInstance | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly deploymentSignerService: UmbraDeploymentSignerService,
  ) {}

  async registerEncryptedUserAccount(
    params: UmbraRegisterParams & { deploymentId?: string },
  ): Promise<UmbraRegisterResult> {
    const deploymentId = params.deploymentId ?? `wallet-${params.walletAddress}`;
    const signer = await this.deploymentSignerService.deriveForDeployment(deploymentId);
    const x25519Pubkey = bs58.encode(signer.x25519.publicKey);
    const signerPubkey = signer.ed25519.publicKey.toBase58();

    const queueUrl = this.getQueueUrl();
    if (!queueUrl) {
      this.logger.log(
        `umbra.register local-only deployment=${deploymentId} signer=${signerPubkey}`,
      );
      return {
        encryptedUserAccount: signerPubkey,
        x25519PublicKey: x25519Pubkey,
        queueSignature: null,
        callbackSignature: null,
        status: 'pending',
      };
    }

    const queueSignature = await this.postQueue('/v1/register', {
      deploymentId,
      walletAddress: params.walletAddress,
      mode: params.mode,
      signerPubkey,
      x25519Pubkey,
    });

    this.logger.log(
      `umbra.register queued deployment=${deploymentId} signer=${signerPubkey} qsig=${queueSignature}`,
    );
    return {
      encryptedUserAccount: signerPubkey,
      x25519PublicKey: x25519Pubkey,
      queueSignature,
      callbackSignature: null,
      status: 'pending',
    };
  }

  async deposit(params: UmbraDepositParams): Promise<UmbraTreasuryResult> {
    return this.queueTreasury('deposit', '/v1/deposit', { ...params });
  }

  async withdraw(params: UmbraWithdrawParams): Promise<UmbraTreasuryResult> {
    return this.queueTreasury('withdraw', '/v1/withdraw', { ...params });
  }

  async transfer(params: UmbraTransferParams): Promise<UmbraTreasuryResult> {
    return this.queueTreasury('transfer', '/v1/transfer', { ...params });
  }

  async getEncryptedBalance(params: UmbraEncryptedBalanceParams): Promise<UmbraEncryptedBalance> {
    const indexerUrl = this.getIndexerUrl();
    if (!indexerUrl) {
      this.logger.debug(
        `umbra.getEncryptedBalance local-only deployment=${params.deploymentId} mint=${params.mint}`,
      );
      return { encryptedTokenAccount: null, ciphertext: null, decryptedAmount: null };
    }
    try {
      const res = await axios.get(`${indexerUrl}/v1/balance`, {
        params: {
          deploymentId: params.deploymentId,
          wallet: params.walletAddress,
          mint: params.mint,
        },
        timeout: 10_000,
      });
      const data = res.data ?? {};
      return {
        encryptedTokenAccount: typeof data.eta === 'string' ? data.eta : null,
        ciphertext: typeof data.ciphertext === 'string' ? data.ciphertext : null,
        decryptedAmount: typeof data.decryptedAmount === 'string' ? data.decryptedAmount : null,
      };
    } catch (err) {
      this.logger.warn(
        `umbra.getEncryptedBalance indexer call failed: ${this.toRpcErrorMessage(err)}`,
      );
      return { encryptedTokenAccount: null, ciphertext: null, decryptedAmount: null };
    }
  }

  async grantViewer(params: UmbraGrantViewerParams): Promise<UmbraGrantResult> {
    const queueUrl = this.getQueueUrl();
    const grantId = `umbra-grant-${params.deploymentId}-${params.granteeWallet.slice(0, 8)}`;
    const payload: Record<string, unknown> = {
      deploymentId: params.deploymentId,
      granteeWallet: params.granteeWallet,
      mint: params.mint,
      expiresAt: params.expiresAt ?? null,
    };

    if (!queueUrl) {
      this.logger.log(
        `umbra.grantViewer local-only deployment=${params.deploymentId} grantee=${params.granteeWallet}`,
      );
      return { grantId, payload };
    }
    try {
      const res = await this.getQueueClient().post('/v1/grant', payload);
      const remoteId =
        res.data && typeof res.data.grantId === 'string' ? (res.data.grantId as string) : grantId;
      return { grantId: remoteId, payload };
    } catch (err) {
      this.logger.warn(`umbra.grantViewer queue call failed: ${this.toRpcErrorMessage(err)}`);
      return { grantId, payload };
    }
  }

  // ------------------------- helpers -------------------------

  private async queueTreasury(
    op: 'deposit' | 'withdraw' | 'transfer',
    path: string,
    params: { deploymentId: string; [key: string]: unknown },
  ): Promise<UmbraTreasuryResult> {
    const queueUrl = this.getQueueUrl();
    if (!queueUrl) {
      this.logger.log(`umbra.${op} local-only deployment=${params.deploymentId}`);
      return { queueSignature: null, callbackSignature: null, status: 'pending' };
    }
    try {
      const queueSignature = await this.postQueue(path, params);
      return { queueSignature, callbackSignature: null, status: 'pending' };
    } catch (err) {
      this.logger.error(`umbra.${op} failed: ${this.toRpcErrorMessage(err)}`);
      return { queueSignature: null, callbackSignature: null, status: 'failed' };
    }
  }

  private async postQueue(path: string, body: Record<string, unknown>): Promise<string | null> {
    const client = this.getQueueClient();
    try {
      const res = await client.post(path, body);
      const data = res.data ?? {};
      const sig = typeof data.signature === 'string' ? data.signature : null;
      const id = typeof data.id === 'string' ? data.id : null;
      return sig ?? id ?? null;
    } catch (err) {
      if (
        axios.isAxiosError(err) &&
        err.response &&
        err.response.status >= 400 &&
        err.response.status < 500
      ) {
        throw new BadRequestException(
          `Umbra queue rejected request: ${this.toRpcErrorMessage(err)}`,
        );
      }
      throw err;
    }
  }

  private getQueueClient(): AxiosInstance {
    if (this.queueClient) return this.queueClient;
    const url = this.getQueueUrl();
    if (!url) {
      throw new BadRequestException('UMBRA_QUEUE_URL is not configured');
    }
    this.queueClient = axios.create({
      baseURL: url,
      timeout: 15_000,
      headers: { 'content-type': 'application/json' },
    });
    return this.queueClient;
  }

  private getQueueUrl(): string | null {
    const url = this.configService.get<string>('UMBRA_QUEUE_URL');
    return url && url.trim().length > 0 ? url.trim() : null;
  }

  private getIndexerUrl(): string | null {
    const url = this.configService.get<string>('UMBRA_INDEXER_URL');
    return url && url.trim().length > 0 ? url.trim() : null;
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
