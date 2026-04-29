import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getUserRegistrationFunction,
  getUserAccountQuerierFunction,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction,
  getEncryptedBalanceQuerierFunction,
  getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction,
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getClaimableUtxoScannerFunction,
} from '@umbra-privacy/sdk';
import {
  type UmbraAdapterPort,
  type UmbraClaimTransferParams,
  type UmbraClaimTransferResult,
  type UmbraCreateTransferIntentParams,
  type UmbraCreateTransferIntentResult,
  type UmbraDepositParams,
  type UmbraEncryptedBalance,
  type UmbraEncryptedBalanceParams,
  type UmbraGrantResult,
  type UmbraGrantViewerParams,
  type UmbraRegisterParams,
  type UmbraRegisterResult,
  type UmbraScanClaimableParams,
  type UmbraScanClaimableResult,
  type UmbraTransferParams,
  type UmbraTreasuryResult,
  type UmbraWithdrawParams,
} from './umbra.port';
import { UmbraClientService } from './umbra-client.service';
import {
  UMBRA_ZK_PROVER_PROVIDER,
  type UmbraZkProverProviderPort,
} from './umbra-zk-prover.port';

const DEFAULT_SCAN_TREE_INDEX = 0;
const DEFAULT_SCAN_START = 0;
const DEFAULT_SCAN_END = 10_000;

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

  constructor(
    private readonly clientService: UmbraClientService,
    @Optional()
    private readonly configService?: ConfigService,
    @Optional()
    @Inject(UMBRA_ZK_PROVER_PROVIDER)
    private readonly zkProverProvider?: UmbraZkProverProviderPort,
  ) {}

  /**
   * Phase-5 feature flag. When `UMBRA_TRANSFER_ENABLED` is unset or false,
   * the claimable-UTXO transfer surface short-circuits to a `failed` /
   * `unavailable` response so accidental rollouts of confidential transfer
   * cannot happen ahead of relayer + zkProver wiring. The deposit /
   * withdraw / register surfaces are always live.
   */
  private isTransferEnabled(): boolean {
    return this.configService?.get<string>('UMBRA_TRANSFER_ENABLED') === 'true';
  }

  async registerEncryptedUserAccount(
    params: UmbraRegisterParams & { deploymentId?: string },
  ): Promise<UmbraRegisterResult> {
    try {
      const runWithClient = async (clientRaw: unknown): Promise<UmbraRegisterResult> => {
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
          txSignatures: Array.isArray(signatures) ? (signatures as string[]) : [],
          status: 'confirmed',
        };
      };

      if (params.signerOverride) {
        // Phase-2 isolation: build a scoped Umbra client backed by the
        // follower-vault's HKDF-derived signer so the registration ETA is
        // owned by the per-vault identity rather than the platform keeper.
        return await this.clientService.withSigner(
          params.signerOverride.secretKey,
          runWithClient,
        );
      }
      const clientRaw = await this.clientService.getClient();
      return await runWithClient(clientRaw);
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
      const runDeposit = async (client: unknown): Promise<UmbraTreasuryResult> => {
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
      };

      if (params.signerOverride) {
        return await this.clientService.withSigner(
          params.signerOverride.secretKey,
          runDeposit,
        );
      }
      const client = await this.clientService.getClient();
      return await runDeposit(client);
    } catch (err) {
      this.logger.error(
        `umbra.deposit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { queueSignature: null, callbackSignature: null, status: 'failed' };
    }
  }

  async withdraw(params: UmbraWithdrawParams): Promise<UmbraTreasuryResult> {
    try {
      const runWithdraw = async (client: unknown): Promise<UmbraTreasuryResult> => {
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
      };

      if (params.signerOverride) {
        return await this.clientService.withSigner(
          params.signerOverride.secretKey,
          runWithdraw,
        );
      }
      const client = await this.clientService.getClient();
      return await runWithdraw(client);
    } catch (err) {
      this.logger.error(
        `umbra.withdraw failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { queueSignature: null, callbackSignature: null, status: 'failed' };
    }
  }

  async transfer(params: UmbraTransferParams): Promise<UmbraTreasuryResult> {
    this.logger.warn(
      `umbra.transfer is deprecated; SDK 4.0 uses claimable UTXO. deployment=${params.deploymentId}`,
    );
    return { queueSignature: null, callbackSignature: null, status: 'failed' };
  }

  /**
   * Phase-5: publish a receiver-claimable UTXO addressed to
   * `params.toRecipientPubkey`. The flow is:
   *
   *  1. Build a scoped Umbra client backed by the sender's per-vault HKDF
   *     signer (so the sender's main encrypted balance is the source).
   *  2. Invoke `getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction`
   *     with the platform-provided `zkProver`.
   *  3. Map the SDK's `CreateUtxoFromEncryptedBalanceResult` to the port
   *     contract. SDK 4.0 does NOT return a UTXO ref directly — the
   *     recipient discovers UTXOs via the indexer scanner. We use the
   *     queue signature as the platform-side tracking key so the
   *     `treasury_settlement_intents` row can correlate later.
   *
   * When the feature flag is off OR the zkProver suite has not been wired
   * we return a `failed` result with an `unavailableReason`-style log so
   * the cycle / settlement layer can record the deferred state without
   * crashing the request.
   */
  async createEncryptedTransferIntent(
    params: UmbraCreateTransferIntentParams,
  ): Promise<UmbraCreateTransferIntentResult> {
    if (!this.isTransferEnabled()) {
      this.logger.warn(
        `umbra.createEncryptedTransferIntent skipped: UMBRA_TRANSFER_ENABLED is not 'true'.`,
      );
      return this.failedTransferIntent('feature-flag-disabled');
    }
    const suite = await this.zkProverProvider?.getZkProverSuite();
    if (!suite || !suite.utxoReceiverClaimable) {
      this.logger.warn(
        `umbra.createEncryptedTransferIntent skipped: zkProverSuite.utxoReceiverClaimable not configured.`,
      );
      return this.failedTransferIntent('zkprover-not-configured');
    }
    try {
      return await this.clientService.withSigner(
        params.fromSigner.secretKey,
        async (clientRaw) => {
          // Build the SDK function with the sender's scoped client and the
          // platform-injected zkProver. The cast through `unknown` is
          // intentional: the SDK exports branded types we deliberately
          // keep out of the port interface.
          const factory =
            getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction as unknown as (
              args: { client: unknown },
              deps: { zkProver: unknown },
            ) => (input: {
              amount: bigint;
              destinationAddress: string;
              mint: string;
            }) => Promise<{
              queueSignature?: string;
              callbackSignature?: string;
              callbackStatus?: 'finalized' | 'pruned' | 'timed-out';
            }>;
          const fn = factory({ client: clientRaw }, { zkProver: suite.utxoReceiverClaimable });
          const result = await fn({
            amount: BigInt(params.amount),
            destinationAddress: params.toRecipientPubkey,
            mint: params.mint,
          });
          const status: 'pending' | 'confirmed' | 'failed' =
            result.callbackStatus === 'finalized'
              ? 'confirmed'
              : result.callbackStatus === 'timed-out'
                ? 'failed'
                : 'pending';
          this.logger.log(
            `umbra.createEncryptedTransferIntent deployment=${params.deploymentId} mint=${params.mint} qsig=${result.queueSignature ?? 'null'} status=${status}`,
          );
          return {
            // SDK 4.0 doesn't surface a structured UTXO reference; we use
            // the queue signature as the platform-side correlation key.
            claimableUtxoRef: result.queueSignature ?? null,
            queueSignature: result.queueSignature ?? null,
            callbackSignature: result.callbackSignature ?? null,
            status,
          };
        },
      );
    } catch (err) {
      this.logger.error(
        `umbra.createEncryptedTransferIntent failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.failedTransferIntent('sdk-error');
    }
  }

  /**
   * Phase-5: claim every receiver-flow UTXO addressed to the recipient's
   * signer. Performs scan → claim in one call. SDK 4.0 organises results
   * into batches (up to 4 UTXOs per ZK proof), so the returned status is
   * "applied" if every batch succeeds, "partial" → modelled as `failed`
   * for the platform-side enum since callers re-trigger as needed.
   */
  async claimEncryptedTransfer(
    params: UmbraClaimTransferParams,
  ): Promise<UmbraClaimTransferResult> {
    if (!this.isTransferEnabled()) {
      this.logger.warn(
        `umbra.claimEncryptedTransfer skipped: UMBRA_TRANSFER_ENABLED is not 'true'.`,
      );
      return this.failedClaim('feature-flag-disabled');
    }
    const suite = await this.zkProverProvider?.getZkProverSuite();
    const relayer = await this.zkProverProvider?.getRelayer();
    if (!suite || !suite.claimReceiverClaimableIntoEncryptedBalance) {
      return this.failedClaim('zkprover-not-configured');
    }
    if (!relayer) {
      return this.failedClaim('relayer-not-configured');
    }
    try {
      return await this.clientService.withSigner(
        params.recipientSigner.secretKey,
        async (clientRaw) => {
          const scanned = await this.runScanner(clientRaw, params.scanWindow);
          if (!scanned || scanned.receiver.length === 0) {
            this.logger.log(
              `umbra.claimEncryptedTransfer no receiver-flow UTXOs to claim`,
            );
            return {
              queueSignature: null,
              callbackSignature: null,
              status: 'confirmed' as const,
              claimedCount: 0,
            };
          }
          const factory =
            getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction as unknown as (
              args: { client: unknown },
              deps: { zkProver: unknown; relayer: unknown },
            ) => (utxos: readonly unknown[]) => Promise<{
              batches: Map<
                number,
                {
                  status?: string;
                  txSignature?: string;
                  callbackSignature?: string;
                  failureReason?: string | null;
                }
              >;
            }>;
          const fn = factory(
            { client: clientRaw },
            {
              zkProver: suite.claimReceiverClaimableIntoEncryptedBalance,
              relayer,
            },
          );
          const result = await fn(scanned.receiver);
          const batches = Array.from(result.batches.values());
          const succeeded = batches.filter((b) => b.status === 'completed').length;
          const failed = batches.filter(
            (b) => b.status && !['completed', 'pending', 'submitted'].includes(b.status),
          ).length;
          const firstSuccess = batches.find((b) => b.status === 'completed');
          const status: 'pending' | 'confirmed' | 'failed' =
            failed > 0 && succeeded === 0
              ? 'failed'
              : succeeded === batches.length
                ? 'confirmed'
                : 'pending';
          this.logger.log(
            `umbra.claimEncryptedTransfer batches=${batches.length} succeeded=${succeeded} failed=${failed}`,
          );
          return {
            queueSignature: firstSuccess?.txSignature ?? null,
            callbackSignature: firstSuccess?.callbackSignature ?? null,
            status,
            claimedCount: scanned.receiver.length,
          };
        },
      );
    } catch (err) {
      this.logger.error(
        `umbra.claimEncryptedTransfer failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.failedClaim('sdk-error');
    }
  }

  async scanClaimableUtxos(
    params: UmbraScanClaimableParams,
  ): Promise<UmbraScanClaimableResult> {
    if (!this.isTransferEnabled()) {
      return {
        receiverCount: 0,
        ephemeralCount: 0,
        unavailable: true,
        unavailableReason: 'feature-flag-disabled',
      };
    }
    try {
      return await this.clientService.withSigner(
        params.recipientSigner.secretKey,
        async (clientRaw) => {
          const scanned = await this.runScanner(clientRaw, params.scanWindow);
          if (!scanned) {
            return {
              receiverCount: 0,
              ephemeralCount: 0,
              unavailable: true,
              unavailableReason: 'scanner-unavailable',
            };
          }
          return {
            receiverCount: scanned.receiver.length,
            ephemeralCount: scanned.ephemeral.length,
            unavailable: false,
          };
        },
      );
    } catch (err) {
      this.logger.warn(
        `umbra.scanClaimableUtxos failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        receiverCount: 0,
        ephemeralCount: 0,
        unavailable: true,
        unavailableReason: 'scanner-error',
      };
    }
  }

  // ---------------------------------------------------------------- helpers

  private failedTransferIntent(reason: string): UmbraCreateTransferIntentResult {
    this.logger.debug(`umbra.createEncryptedTransferIntent unavailable=${reason}`);
    return {
      claimableUtxoRef: null,
      queueSignature: null,
      callbackSignature: null,
      status: 'failed',
    };
  }

  private failedClaim(reason: string): UmbraClaimTransferResult {
    return {
      queueSignature: null,
      callbackSignature: null,
      status: 'failed',
      claimedCount: 0,
      unavailableReason: reason,
    };
  }

  /**
   * Wraps the SDK scanner so call sites don't repeat default-window math.
   * Returns null when the scanner factory is unavailable (e.g. SDK shape
   * drift); callers downgrade the call to `unavailable`.
   */
  private async runScanner(
    clientRaw: unknown,
    window: UmbraScanClaimableParams['scanWindow'],
  ): Promise<{ receiver: readonly unknown[]; ephemeral: readonly unknown[] } | null> {
    const treeIndex = window?.treeIndex ?? DEFAULT_SCAN_TREE_INDEX;
    const startInsertionIndex = window?.startInsertionIndex ?? DEFAULT_SCAN_START;
    const endInsertionIndex = window?.endInsertionIndex ?? DEFAULT_SCAN_END;
    try {
      const factory = getClaimableUtxoScannerFunction as unknown as (
        args: { client: unknown },
      ) => (
        treeIndex: number,
        start: number,
        end?: number,
      ) => Promise<{ receiver: readonly unknown[]; ephemeral: readonly unknown[] }>;
      const fn = factory({ client: clientRaw });
      return await fn(treeIndex, startInsertionIndex, endInsertionIndex);
    } catch (err) {
      this.logger.warn(
        `umbra scanner failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
  async getEncryptedBalance(params: UmbraEncryptedBalanceParams): Promise<UmbraEncryptedBalance> {
    try {
      const runQuery = async (client: unknown): Promise<UmbraEncryptedBalance> => {
        const querier = getEncryptedBalanceQuerierFunction(
          { client } as Parameters<typeof getEncryptedBalanceQuerierFunction>[0],
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const address = params.walletAddress as any;
        const resultMap = await querier(address);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = resultMap instanceof Map ? resultMap.get(address) : (resultMap as any);
        return {
          encryptedTokenAccount:
            typeof result?.encryptedTokenAccount === 'string' ? result.encryptedTokenAccount : null,
          ciphertext: typeof result?.ciphertext === 'string' ? result.ciphertext : null,
          decryptedAmount: result?.decryptedAmount != null ? String(result.decryptedAmount) : null,
        };
      };

      if (params.signerOverride) {
        return await this.clientService.withSigner(
          params.signerOverride.secretKey,
          runQuery,
        );
      }
      const client = await this.clientService.getClient();
      return await runQuery(client);
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
      payload: {
        mint: params.mint,
        grantee: params.granteeWallet,
        expiresAt: params.expiresAt ?? null,
      },
    };
  }
}
