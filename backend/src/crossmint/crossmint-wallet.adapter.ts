import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  SendOptions,
  TransactionSignature,
} from '@solana/web3.js';
import { SolanaWallet } from '@crossmint/wallets-sdk';

/**
 * Crossmint Wallet Adapter
 *
 * 實作 Solana Agent Kit 的 BaseWallet 接口
 * 將 Crossmint 的託管錢包包裝成標準的 Solana wallet adapter
 */
export class CrossmintWalletAdapter {
  public readonly publicKey: PublicKey;
  private crossmintWallet: SolanaWallet;

  constructor(crossmintWallet: SolanaWallet) {
    this.crossmintWallet = crossmintWallet;
    this.publicKey = new PublicKey(crossmintWallet.address);
  }

  /**
   * 獲取錢包地址
   */
  get address(): string {
    return this.crossmintWallet.address;
  }

  /**
   * 簽名單一交易（不發送）
   */
  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    const serializedTransaction = Buffer.from(transaction.serialize()).toString('base64');

    await this.crossmintWallet.sendTransaction({
      serializedTransaction,
      options: { experimental_prepareOnly: true },
    });

    return transaction;
  }

  /**
   * 批量簽名交易
   */
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    const signedTransactions: T[] = [];

    for (const tx of transactions) {
      const signed = await this.signTransaction(tx);
      signedTransactions.push(signed);
    }

    return signedTransactions;
  }

  /**
   * 簽名並發送交易
   */
  async signAndSendTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
    _options?: SendOptions,
  ): Promise<{ signature: TransactionSignature }> {
    const serializedTransaction = Buffer.from(transaction.serialize()).toString('base64');

    const result = await this.crossmintWallet.sendTransaction({
      serializedTransaction,
    });

    return { signature: result.hash as TransactionSignature };
  }

  /**
   * 簽名訊息
   * 注意：Crossmint Solana wallet 目前對 signMessage 支援有限
   */
  async signMessage(_message: Uint8Array): Promise<Uint8Array> {
    throw new Error(
      'signMessage is not currently supported for Crossmint Solana wallets. ' +
        'Use transaction signing instead.',
    );
  }
}
