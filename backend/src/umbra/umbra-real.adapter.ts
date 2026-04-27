import { Injectable, Logger } from '@nestjs/common';
import {
  getUserRegistrationFunction,
  getUserAccountQuerierFunction,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getEncryptedBalanceQuerierFunction,
} from '@umbra-privacy/sdk';
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
import { UmbraClientService } from './umbra-client.service';

/**
 * Real Umbra adapter — v2 SDK rewrite.
 *
 * Uses @umbra-privacy/sdk backed by the platform keeper keypair.
 * The SDK uses branded types (@solana/kit Address, U64, etc.) which we
 * cast through to keep the adapter layer type-safe against our own port
 * interface while delegating SDK complexity to runtime.
 */
@Injectable()
export class UmbraRealAdapter implements UmbraAdapterPort {
  private readonly logger = new Logger(UmbraRealAdapter.name);

  constructor(private readonly clientService: UmbraClientService) {}

  async registerEncryptedUserAccount(
    params: UmbraRegisterParams & { deploymentId?: string },
  ): Promise<UmbraRegisterResult> {
    try {
      const clientRaw = await this.clientService.getClient();
      const client = clientRaw as { signer: { address: string } };
      const register = getUserRegistrationFunction({ client } as Parameters<typeof getUserRegistrationFunction>[0]);

      const options = {
        confidential: true,
        anonymous: params.mode === 'anonymous',
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const signatures = await register(options as Parameters<typeof register>[0]);

      const querier = getUserAccountQuerierFunction({ client } as Parameters<typeof getUserAccountQuerierFunction>[0]);
      const accountResult = await querier(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.signer.address as any,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const account = accountResult as any;

      this.logger.log(
        `umbra.register signer=${client.signer.address} status=confirmed`,
      );

      return {
        encryptedUserAccount: account?.x25519PublicKey ?? account?.x25519_public_key ?? null,
        x25519PublicKey: account?.x25519PublicKey ?? account?.x25519_public_key ?? null,
        signerPubkey: client.signer.address ?? null,
        txSignatures: Array.isArray(signatures) ? signatures as string[] : [],
        status: 'confirmed',
      };
    } catch (err) {
      this.logger.error(
        `umbra.register failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        encryptedUserAccount: null,
        x25519PublicKey: null,
        signerPubkey: null,
        txSignatures: [],
        status: 'failed',
      };
    }
  }

  async deposit(params: UmbraDepositParams): Promise<UmbraTreasuryResult> {
    try {
      const client = await this.clientService.getClient();
      const depositFn = getPublicBalanceToEncryptedBalanceDirectDepositorFunction(
        { client } as Parameters<typeof getPublicBalanceToEncryptedBalanceDirectDepositorFunction>[0],
      );

      const amount = BigInt(params.amount);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await depositFn(
        params.fromWallet as any,
        params.mint as any,
        amount as any,
      )) as { queueSignature?: string; callbackSignature?: string };

      this.logger.log(
        `umbra.deposit deployment=${params.deploymentId} mint=${params.mint} qsig=${result.queueSignature}`,
      );

      return {
        queueSignature: result.queueSignature ?? null,
        callbackSignature: result.callbackSignature ?? null,
        status: 'confirmed',
      };
    } catch (err) {
      this.logger.error(
        `umbra.deposit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { queueSignature: null, callbackSignature: null, status: 'failed' };
    }
  }

  async withdraw(params: UmbraWithdrawParams): Promise<UmbraTreasuryResult> {
    try {
      const client = await this.clientService.getClient();
      const withdrawFn = getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction(
        { client } as Parameters<typeof getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction>[0],
      );

      const amount = BigInt(params.amount);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await withdrawFn(
        params.toWallet as any,
        params.mint as any,
        amount as any,
      )) as { queueSignature?: string; callbackSignature?: string };

      this.logger.log(
        `umbra.withdraw deployment=${params.deploymentId} mint=${params.mint} qsig=${result.queueSignature}`,
      );

      return {
        queueSignature: result.queueSignature ?? null,
        callbackSignature: result.callbackSignature ?? null,
        status: 'confirmed',
      };
    } catch (err) {
      this.logger.error(
        `umbra.withdraw failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { queueSignature: null, callbackSignature: null, status: 'failed' };
    }
  }

  async transfer(params: UmbraTransferParams): Promise<UmbraTreasuryResult> {
    this.logger.warn(
      `umbra.transfer not implemented (requires ZK prover). deployment=${params.deploymentId}`,
    );
    return { queueSignature: null, callbackSignature: null, status: 'failed' };
  }

  async getEncryptedBalance(params: UmbraEncryptedBalanceParams): Promise<UmbraEncryptedBalance> {
    try {
      const client = await this.clientService.getClient();
      const querier = getEncryptedBalanceQuerierFunction(
        { client } as Parameters<typeof getEncryptedBalanceQuerierFunction>[0],
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const address = params.walletAddress as any;
      const resultMap = await querier(address);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = resultMap instanceof Map ? resultMap.get(address) : (resultMap as any);

      return {
        encryptedTokenAccount: typeof result?.encryptedTokenAccount === 'string' ? result.encryptedTokenAccount : null,
        ciphertext: typeof result?.ciphertext === 'string' ? result.ciphertext : null,
        decryptedAmount: result?.decryptedAmount != null ? String(result.decryptedAmount) : null,
      };
    } catch (err) {
      this.logger.warn(
        `umbra.getEncryptedBalance failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { encryptedTokenAccount: null, ciphertext: null, decryptedAmount: null };
    }
  }

  async grantViewer(params: UmbraGrantViewerParams): Promise<UmbraGrantResult> {
    // Compliance grants require deeper SDK type integration (CreateUserGrantedComplianceGrantFunction
    // takes 4-6 branded arguments). Deferred to a future release.
    // The noop path returns a deterministic grantId for tracking.
    const grantId = `umbra-grant-${params.deploymentId}-${params.granteeWallet.slice(0, 8)}`;
    this.logger.warn(
      `umbra.grantViewer compliance grants not yet implemented. deployment=${params.deploymentId} grantee=${params.granteeWallet}`,
    );
    return {
      grantId,
      payload: { mint: params.mint, grantee: params.granteeWallet, expiresAt: params.expiresAt ?? null },
    };
  }
}
