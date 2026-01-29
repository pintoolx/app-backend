import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrossmintService } from '../../crossmint/crossmint.service';
import { CrossmintWalletAdapter } from '../../crossmint/crossmint-wallet.adapter';

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

const externalApiLimiter = createLimiter(5);

/**
 * Agent Kit Service
 *
 * 為 workflow nodes 提供統一的 Solana Agent Kit 實例管理
 * 整合 Crossmint 託管錢包
 */
@Injectable()
export class AgentKitService {
  private readonly logger = new Logger(AgentKitService.name);
  private rpcUrl: string;

  constructor(
    private crossmintService: CrossmintService,
    private configService: ConfigService,
  ) {
    this.rpcUrl = this.configService.get<string>('solana.rpcUrl');
  }

  /**
   * 為特定 account 獲取 Crossmint Wallet Adapter
   *
   * @param accountId - Account ID
   * @returns CrossmintWalletAdapter 實例
   */
  async getWalletForAccount(accountId: string): Promise<CrossmintWalletAdapter> {
    this.logger.debug(`Getting wallet adapter for account: ${accountId}`);
    return this.crossmintService.getWalletForAccount(accountId);
  }

  /**
   * 獲取 RPC URL
   */
  getRpcUrl(): string {
    return this.rpcUrl;
  }

  /**
   * 執行 Jupiter Swap
   *
   * 使用 Jupiter API 進行代幣交換
   * 交易由 Crossmint 託管錢包簽名
   *
   * @param accountId - Account ID
   * @param inputMint - 輸入代幣地址
   * @param outputMint - 輸出代幣地址
   * @param amount - 交換數量（最小單位）
   * @param slippageBps - 滑點（basis points）
   * @returns 交易結果
   */
  async executeSwap(
    accountId: string,
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50,
  ): Promise<{
    signature: string;
    inputAmount: number;
    outputAmount: string;
  }> {
    const wallet = await this.getWalletForAccount(accountId);

    this.logger.log(`Executing swap for account ${accountId}`);
    this.logger.log(`  Input: ${inputMint}, Output: ${outputMint}, Amount: ${amount}`);

    // 使用 Jupiter API 獲取報價和交易
    const { createJupiterApiClient } = await import('@jup-ag/api');
    const jupiterApi = createJupiterApiClient();

    // 1. 獲取報價
    const quote = await withRetry(() =>
      externalApiLimiter(() =>
        jupiterApi.quoteGet({
          inputMint,
          outputMint,
          amount,
          slippageBps,
        }),
      ),
    );

    this.logger.log(`  Quote received: ${quote.outAmount} output tokens`);

    // 2. 獲取序列化交易
    const swapResult = await withRetry(() =>
      externalApiLimiter(() =>
        jupiterApi.swapPost({
          swapRequest: {
            quoteResponse: quote,
            userPublicKey: wallet.publicKey.toBase58(),
            wrapAndUnwrapSol: true,
          },
        }),
      ),
    );

    // 3. 反序列化交易
    const { VersionedTransaction } = await import('@solana/web3.js');
    const swapTransactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // 4. 使用 Crossmint 錢包簽名並發送
    const result = await wallet.signAndSendTransaction(transaction);

    this.logger.log(`  Swap completed: ${result.signature}`);

    return {
      signature: result.signature,
      inputAmount: amount,
      outputAmount: quote.outAmount,
    };
  }
}
