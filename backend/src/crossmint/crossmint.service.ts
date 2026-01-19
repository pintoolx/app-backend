import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../database/supabase.service';
import { CrossmintWalletAdapter, CrossmintSolanaWallet } from './crossmint-wallet.adapter';

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
      const response = await fetch(`${this.baseUrl}/2025-06-09/wallets`, {
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
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create Crossmint wallet: ${response.status} - ${errorText}`);
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
      throw new Error(`Account not found: ${accountId}`);
    }

    if (!account.crossmint_wallet_locator) {
      throw new Error(`Account ${accountId} has no Crossmint wallet configured`);
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
      const response = await fetch(
        `${this.baseUrl}/2025-06-09/wallets/${encodeURIComponent(locator)}`,
        {
          method: 'GET',
          headers: {
            'X-API-KEY': this.apiKey,
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get Crossmint wallet: ${response.status} - ${errorText}`);
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
    const createResponse = await fetch(
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
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Failed to create transaction: ${createResponse.status} - ${errorText}`);
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
      const response = await fetch(
        `${this.baseUrl}/2025-06-09/wallets/${encodeURIComponent(locator)}/transactions/${transactionId}`,
        {
          headers: { 'X-API-KEY': this.apiKey },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to get transaction status: ${response.status}`);
      }

      const tx = await response.json();

      if (tx.status === 'signed' || tx.status === 'completed') {
        // 返回已簽名的交易（如果有）
        return tx.signedTransaction;
      }

      if (tx.status === 'failed') {
        throw new Error(`Transaction failed: ${tx.error}`);
      }

      // 等待 1 秒後重試
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error('Transaction signing timeout');
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
      const response = await fetch(
        `${this.baseUrl}/2025-06-09/wallets/${encodeURIComponent(locator)}/transactions/${transactionId}`,
        {
          headers: { 'X-API-KEY': this.apiKey },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to get transaction status: ${response.status}`);
      }

      const tx = await response.json();

      if (tx.status === 'completed') {
        return tx;
      }

      if (tx.status === 'failed') {
        throw new Error(`Transaction failed: ${tx.error || 'Unknown error'}`);
      }

      // 等待 1 秒後重試
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error('Transaction completion timeout');
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
    // 獲取用戶現有的 account 數量作為 index
    const { count } = await this.supabaseService.client
      .from('accounts')
      .select('*', { count: 'exact', head: true })
      .eq('owner_wallet_address', ownerWalletAddress);

    const accountIndex = count || 0;

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
      throw new Error(`Failed to create account: ${error.message}`);
    }

    this.logger.log(`Account created with Crossmint wallet: ${account.id}`);

    return account;
  }
}
