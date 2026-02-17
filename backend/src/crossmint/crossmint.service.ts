import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  BadRequestException,
  RequestTimeoutException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  getMint,
  createTransferInstruction,
  createCloseAccountInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { SupabaseService } from '../database/supabase.service';
import { CrossmintWalletAdapter, CrossmintSolanaWallet } from './crossmint-wallet.adapter';
import { WorkflowLifecycleManager } from '../workflows/workflow-lifecycle.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createLimiter = (max: number) => {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    }
  };
};

const withRetry = async <T>(
  fn: () => Promise<T>,
  attempts: number = 3,
  baseDelay: number = 200,
  maxDelay: number = 2000,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      const delay = Math.min(maxDelay, baseDelay * 2 ** attempt);
      const jitter = Math.floor(Math.random() * delay * 0.2);
      await sleep(delay + jitter);
    }
  }
  throw lastError;
};

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number = 10000,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const externalApiLimiter = createLimiter(5);

/**
 * Crossmint API 回應類型
 */
interface CrossmintWalletResponse {
  address: string;
  type: string;
  linkedUser?: string;
}

/**
 * Crossmint Service
 *
 * 負責管理 Crossmint 託管錢包的創建和獲取
 * 使用 Crossmint Server API 進行所有錢包操作
 */
@Injectable()
export class CrossmintService implements OnModuleInit {
  private readonly logger = new Logger(CrossmintService.name);
  private apiKey: string;
  private baseUrl: string;

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    @Inject(forwardRef(() => WorkflowLifecycleManager))
    private lifecycleManager: WorkflowLifecycleManager,
  ) {}

  onModuleInit() {
    this.apiKey = this.configService.get<string>('crossmint.serverApiKey');
    const environment = this.configService.get<string>('crossmint.environment') || 'production';

    this.baseUrl =
      environment === 'staging'
        ? 'https://staging.crossmint.com/api'
        : 'https://www.crossmint.com/api';

    if (!this.apiKey) {
      this.logger.warn('CROSSMINT_SERVER_API_KEY is not configured');
    } else {
      this.logger.log(`Crossmint service initialized (${environment})`);
    }
  }

  /**
   * 為用戶創建新的 Crossmint 錢包
   *
   * @param userId - 用戶 ID
   * @param accountIndex - 帳戶索引（用於區分同一用戶的多個錢包）
   * @returns 錢包的 locator 和地址
   */
  async createWalletForUser(
    userId: string,
    accountIndex: number = 0,
  ): Promise<{
    locator: string;
    address: string;
  }> {
    const locator = `userId:${userId}:solana:mpc:${accountIndex}`;

    this.logger.log(`Creating Crossmint wallet for user: ${userId}, index: ${accountIndex}`);

    try {
      const response = await withRetry(() =>
        externalApiLimiter(() =>
          fetchWithTimeout(
            `${this.baseUrl}/2025-06-09/wallets`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': this.apiKey,
              },
              body: JSON.stringify({
                chainType: 'solana',
                type: 'smart',
                owner: locator,
              }),
            },
            15000,
          ),
        ),
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new InternalServerErrorException(
          `Failed to create Crossmint wallet: ${response.status} - ${errorText}`,
        );
      }

      const wallet: CrossmintWalletResponse = await response.json();

      this.logger.log(`Crossmint wallet created: ${wallet.address}`);

      return {
        locator,
        address: wallet.address,
      };
    } catch (error) {
      this.logger.error(`Failed to create Crossmint wallet: ${error.message}`);
      throw error;
    }
  }

  /**
   * 獲取 account 的 Crossmint 錢包
   *
   * @param accountId - Account ID (UUID)
   * @returns CrossmintWalletAdapter 實例
   */
  async getWalletForAccount(accountId: string): Promise<CrossmintWalletAdapter> {
    // 從資料庫獲取 account 的 wallet locator
    const { data: account, error } = await this.supabaseService.client
      .from('accounts')
      .select('crossmint_wallet_locator, crossmint_wallet_address')
      .eq('id', accountId)
      .single();

    if (error || !account) {
      throw new NotFoundException(`Account not found: ${accountId}`);
    }

    if (!account.crossmint_wallet_locator) {
      throw new BadRequestException(`Account ${accountId} has no Crossmint wallet configured`);
    }

    // 獲取 Crossmint 錢包
    const crossmintWallet = await this.getWalletByLocator(account.crossmint_wallet_locator);

    return new CrossmintWalletAdapter(crossmintWallet);
  }

  /**
   * 透過 locator 獲取 Crossmint 錢包
   *
   * @param locator - Wallet locator (e.g., "userId:xxx:solana:mpc:0")
   * @returns Crossmint SolanaWallet 實例
   */
  async getWalletByLocator(locator: string): Promise<CrossmintSolanaWallet> {
    this.logger.debug(`Getting Crossmint wallet: ${locator}`);

    try {
      const response = await withRetry(() =>
        externalApiLimiter(() =>
          fetchWithTimeout(
            `${this.baseUrl}/2025-06-09/wallets/${encodeURIComponent(locator)}`,
            {
              method: 'GET',
              headers: {
                'X-API-KEY': this.apiKey,
              },
            },
            10000,
          ),
        ),
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new InternalServerErrorException(
          `Failed to get Crossmint wallet: ${response.status} - ${errorText}`,
        );
      }

      const walletData: CrossmintWalletResponse = await response.json();

      // 創建一個符合 CrossmintSolanaWallet 接口的對象
      const wallet: CrossmintSolanaWallet = {
        address: walletData.address,
        sendTransaction: async (transaction, options) => {
          return this.sendTransaction(locator, transaction, options);
        },
      };

      return wallet;
    } catch (error) {
      this.logger.error(`Failed to get Crossmint wallet: ${error.message}`);
      throw error;
    }
  }

  /**
   * 透過 Crossmint API 發送交易
   *
   * @param locator - Wallet locator
   * @param transaction - Solana 交易
   * @param options - 選項
   */
  private async sendTransaction(
    locator: string,
    transaction: any,
    options?: { experimental_prepareOnly?: boolean },
  ): Promise<{
    hash?: string;
    signedTransaction?: any;
  }> {
    // 序列化交易
    const serializedTx = Buffer.from(transaction.serialize()).toString('base64');

    // 創建交易
    const createResponse = await withRetry(() =>
      externalApiLimiter(() =>
        fetchWithTimeout(
          `${this.baseUrl}/2025-06-09/wallets/${encodeURIComponent(locator)}/transactions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-KEY': this.apiKey,
            },
            body: JSON.stringify({
              params: {
                transaction: serializedTx,
              },
            }),
          },
          15000,
        ),
      ),
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new InternalServerErrorException(
        `Failed to create transaction: ${createResponse.status} - ${errorText}`,
      );
    }

    const txResult = await createResponse.json();

    // 如果只是準備（簽名但不發送）
    if (options?.experimental_prepareOnly) {
      // 等待交易被簽名
      const signedTx = await this.waitForTransactionSigned(locator, txResult.id);
      return { signedTransaction: signedTx };
    }

    // 等待交易完成
    const finalResult = await this.waitForTransactionComplete(locator, txResult.id);

    return { hash: finalResult.onChain?.txId };
  }

  /**
   * 等待交易被簽名
   */
  private async waitForTransactionSigned(
    locator: string,
    transactionId: string,
    maxAttempts: number = 30,
  ): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await withRetry(() =>
        externalApiLimiter(() =>
          fetchWithTimeout(
            `${this.baseUrl}/2025-06-09/wallets/${encodeURIComponent(locator)}/transactions/${transactionId}`,
            {
              headers: { 'X-API-KEY': this.apiKey },
            },
            10000,
          ),
        ),
      );

      if (!response.ok) {
        throw new InternalServerErrorException(
          `Failed to get transaction status: ${response.status}`,
        );
      }

      const tx = await response.json();

      if (tx.status === 'signed' || tx.status === 'completed') {
        // 返回已簽名的交易（如果有）
        return tx.signedTransaction;
      }

      if (tx.status === 'failed') {
        throw new InternalServerErrorException(`Transaction failed: ${tx.error}`);
      }

      // 等待 1 秒後重試
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new RequestTimeoutException('Transaction signing timeout');
  }

  /**
   * 等待交易完成
   */
  private async waitForTransactionComplete(
    locator: string,
    transactionId: string,
    maxAttempts: number = 60,
  ): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await withRetry(() =>
        externalApiLimiter(() =>
          fetchWithTimeout(
            `${this.baseUrl}/2025-06-09/wallets/${encodeURIComponent(locator)}/transactions/${transactionId}`,
            {
              headers: { 'X-API-KEY': this.apiKey },
            },
            10000,
          ),
        ),
      );

      if (!response.ok) {
        throw new InternalServerErrorException(
          `Failed to get transaction status: ${response.status}`,
        );
      }

      const tx = await response.json();

      if (tx.status === 'completed') {
        return tx;
      }

      if (tx.status === 'failed') {
        throw new InternalServerErrorException(
          `Transaction failed: ${tx.error || 'Unknown error'}`,
        );
      }

      // 等待 1 秒後重試
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new RequestTimeoutException('Transaction completion timeout');
  }

  /**
   * 創建 account 並自動創建 Crossmint 錢包
   *
   * @param ownerWalletAddress - 用戶錢包地址
   * @param accountName - Account 名稱
   * @returns 新創建的 account
   */
  async createAccountWithWallet(
    ownerWalletAddress: string,
    accountName: string,
  ): Promise<{
    id: string;
    name: string;
    crossmint_wallet_locator: string;
    crossmint_wallet_address: string;
  }> {
    // 使用隨機 index 避免併發建立時的 race condition
    const accountIndex = randomBytes(4).readUInt32BE(0);

    // 創建 Crossmint 錢包 (使用 owner wallet address 作為 userId)
    const wallet = await this.createWalletForUser(ownerWalletAddress, accountIndex);

    // 創建 account 記錄
    const { data: account, error } = await this.supabaseService.client
      .from('accounts')
      .insert({
        owner_wallet_address: ownerWalletAddress,
        name: accountName,
        crossmint_wallet_locator: wallet.locator,
        crossmint_wallet_address: wallet.address,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to create account: ${error.message}`);
      throw new InternalServerErrorException(`Failed to create account: ${error.message}`);
    }

    this.logger.log(`Account created with Crossmint wallet: ${account.id}`);

    this.lifecycleManager.startWorkflowForAccount(account.id).catch((err) => {
      this.logger.error(`Failed to start workflow for account ${account.id}`, err);
    });

    return account;
  }

  /**
   * Withdraw all assets (SPL tokens + SOL) from the Crossmint wallet back to the owner wallet
   */
  async withdrawAllAssets(
    accountId: string,
    ownerWalletAddress: string,
  ): Promise<{
    transfers: Array<{ token: string; amount: number; signature: string }>;
    errors: string[];
  }> {
    const transfers: Array<{ token: string; amount: number; signature: string }> = [];
    const errors: string[] = [];

    // 1. Get the Crossmint wallet for this account
    const wallet = await this.getWalletForAccount(accountId);

    // 2. Get RPC connection
    const rpcUrl = this.configService.get<string>('solana.rpcUrl');
    const connection = new Connection(rpcUrl);
    const ownerPubkey = new PublicKey(ownerWalletAddress);

    // 3. Get ALL SPL token accounts owned by this wallet
    const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    });

    // 4. For each SPL token account with balance > 0, transfer and close
    for (const { pubkey, account } of tokenAccounts.value) {
      try {
        const tokenAccountInfo = await getAccount(connection, pubkey);
        const balance = tokenAccountInfo.amount;
        const mint = tokenAccountInfo.mint;

        if (balance <= 0n) {
          // No balance, just close the account to reclaim rent
          const closeIx = createCloseAccountInstruction(
            pubkey,
            wallet.publicKey,
            wallet.publicKey,
          );
          const tx = new Transaction().add(closeIx);
          tx.feePayer = wallet.publicKey;
          tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

          try {
            await wallet.signAndSendTransaction(tx);
          } catch (closeErr) {
            errors.push(`Failed to close empty token account ${pubkey.toBase58()}: ${closeErr.message}`);
          }
          continue;
        }

        const mintInfo = await getMint(connection, mint);
        const humanAmount = Number(balance) / 10 ** mintInfo.decimals;

        // Get or create the owner's associated token account
        const ownerAta = getAssociatedTokenAddressSync(mint, ownerPubkey);

        const tx = new Transaction();

        // Check if owner's ATA exists, if not create it
        const ownerAtaInfo = await connection.getAccountInfo(ownerAta);
        if (!ownerAtaInfo) {
          tx.add(
            createAssociatedTokenAccountInstruction(
              wallet.publicKey,
              ownerAta,
              ownerPubkey,
              mint,
            ),
          );
        }

        // Transfer all tokens
        tx.add(
          createTransferInstruction(
            pubkey,
            ownerAta,
            wallet.publicKey,
            balance,
          ),
        );

        // Close the now-empty token account to reclaim rent
        tx.add(
          createCloseAccountInstruction(
            pubkey,
            wallet.publicKey,
            wallet.publicKey,
          ),
        );

        tx.feePayer = wallet.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        const result = await wallet.signAndSendTransaction(tx);
        transfers.push({
          token: mint.toBase58(),
          amount: humanAmount,
          signature: result.signature,
        });
      } catch (err) {
        errors.push(`Failed to transfer token account ${pubkey.toBase58()}: ${err.message}`);
      }
    }

    // 5. LAST: Transfer remaining SOL (after all SPL transfers, so we have SOL for gas)
    try {
      const solBalance = await connection.getBalance(wallet.publicKey);
      // Reserve enough for tx fee + priority fee buffer
      const minReserve = 100_000; // 0.0001 SOL — conservative buffer for fees

      if (solBalance > minReserve) {
        const transferAmount = solBalance - minReserve;
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: ownerPubkey,
            lamports: transferAmount,
          }),
        );
        tx.feePayer = wallet.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        const result = await wallet.signAndSendTransaction(tx);
        transfers.push({
          token: 'SOL',
          amount: transferAmount / LAMPORTS_PER_SOL,
          signature: result.signature,
        });
      } else {
        this.logger.log(`SOL balance too low to transfer (${solBalance} lamports), skipping`);
      }
    } catch (err) {
      errors.push(`Failed to transfer SOL: ${err.message}`);
    }

    return { transfers, errors };
  }

  /**
   * Delete (Archive) an account's wallet
   */
  async deleteWallet(
    accountId: string,
    ownerWalletAddress: string,
  ): Promise<{
    withdrawResult: { transfers: any[]; errors: string[] };
  }> {
    // 1. Verify Ownership
    const { data: account, error } = await this.supabaseService.client
      .from('accounts')
      .select('owner_wallet_address')
      .eq('id', accountId)
      .single();

    if (error || !account) {
      throw new NotFoundException('Account not found');
    }

    if (account.owner_wallet_address !== ownerWalletAddress) {
      throw new ForbiddenException('Unauthorized: Ownership verification failed');
    }

    // 2. Withdraw all assets to owner wallet
    const withdrawResult = await this.withdrawAllAssets(accountId, ownerWalletAddress);
    this.logger.log(
      `Assets withdrawn for account ${accountId}: ${withdrawResult.transfers.length} transfers, ${withdrawResult.errors.length} errors`,
    );

    // 3. Abort if any withdrawal failed (don't close account with assets still inside)
    if (withdrawResult.errors.length > 0) {
      this.logger.error(`Withdrawal incomplete for account ${accountId}:`, withdrawResult.errors);
      throw new BadRequestException({
        message: 'Cannot close account: some assets failed to withdraw',
        withdrawResult,
      });
    }

    // 4. Perform Deletion (Soft Delete) — only if all assets withdrawn successfully
    const { error: deleteError } = await this.supabaseService.client
      .from('accounts')
      .update({ is_active: false })
      .eq('id', accountId);

    if (deleteError) {
      throw new InternalServerErrorException(`Failed to delete account: ${deleteError.message}`);
    }

    this.logger.log(`Account soft deleted: ${accountId} by owner ${ownerWalletAddress}`);

    return { withdrawResult };
  }
}
