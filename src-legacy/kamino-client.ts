import { KaminoManager, KaminoVault, sleep } from '@kamino-finance/klend-sdk';
import {
  address,
  type Address,
  type TransactionSigner,
  Signature
} from '@solana/kit';
import { parseKeypairFile } from '@kamino-finance/klend-sdk/dist/utils/signer.js';
import Decimal from 'decimal.js';
import { sendAndConfirmTx } from './utils/tx';
import { getConnectionPool } from './utils/connection';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
  
export interface KaminoClientConfig {  
  keypairPath: string;  
  isMainnet: boolean;  
}  
  
export interface VaultInfo {  
  address: Address;  
  name: string;  
  totalValueUSD: Decimal;  
}  
  
export class KaminoClient {  
  private wallet: TransactionSigner;  
  private manager: KaminoManager;  
  private kvaultProgramId: Address;  
  private isMainnet: boolean;  
  
  private constructor(    
    wallet: TransactionSigner,  
    manager: KaminoManager,  
    kvaultProgramId: Address,  
    isMainnet: boolean  
  ) {    
    this.wallet = wallet;  
    this.manager = manager;  
    this.kvaultProgramId = kvaultProgramId;  
    this.isMainnet = isMainnet;  
  }
  
  /**  
   * 初始化 KaminoClient  
   */  
  static async initialize(config: KaminoClientConfig): Promise<KaminoClient> {   
    const wallet = await parseKeypairFile(config.keypairPath);  
  
    const klendProgramId = config.isMainnet  
      ? address('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD')  
      : address('SLendK7ySfcEzyaFqy93gDnD3RtrpXJcnRwb6zFHJSh');  
  
    const kvaultProgramId = config.isMainnet  
      ? address('KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd')  
      : address('stKvQfwRsQiKnLtMNVLHKS3exFJmZFsgfzBPWHECUYK');    
  
    const manager = new KaminoManager(  
      getConnectionPool().rpc as any,
      400, // recentSlotDurationMs  
      klendProgramId,  
      kvaultProgramId  
    );  
  
    return new KaminoClient(wallet, manager, kvaultProgramId, config.isMainnet);  
  }  
  
  /**  
   * 獲取所有可用的 vaults  
   */  
  async getAllVaults(): Promise<KaminoVault[]> {  
    return await this.manager.getAllVaults();  
  }  
  
  /**  
   * 獲取特定代幣的所有 vaults  
   */  
  async getAllVaultsForToken(tokenMint: Address): Promise<KaminoVault[]> {  
    return await this.manager.getAllVaultsForToken(tokenMint);  
  }  
  
  /**  
   * 篩選 deposit value 大於指定金額的 vaults  
   */  
  async getVaultsAboveValue(minValueUSD: number): Promise<VaultInfo[]> {  
    const allVaults = await this.getAllVaults();  
    const currentSlot = await getConnectionPool().rpc.getSlot({ commitment: 'confirmed' }).send();  
    const vaultsAboveValue: VaultInfo[] = [];  
  
    for (const vault of allVaults) {  
      const vaultState = await vault.getState(getConnectionPool().rpc as any);
        
      // 假設代幣價格為 1.0 (USDC)，實際應用中需要從 oracle 獲取  
      const tokenPrice = new Decimal(1.0);  
        
      const holdingsWithPrice = await this.manager.getVaultHoldingsWithPrice(  
        vaultState as any,  
        tokenPrice,  
        currentSlot  
      );  
  
      if (holdingsWithPrice.totalUSDIncludingFees.greaterThan(minValueUSD)) {  
        const vaultName = this.manager.getDecodedVaultName(vaultState);  
        vaultsAboveValue.push({  
          address: vault.address,  
          name: vaultName,  
          totalValueUSD: holdingsWithPrice.totalUSDIncludingFees  
        });  
      }  
    }  
  
    return vaultsAboveValue;  
  }  
  
  /**  
   * 獲取 vault 的詳細概覽  
   */  
  async getVaultOverview(vaultAddress: Address, tokenPrice: Decimal = new Decimal(1.0)) {  
    const vault = new KaminoVault(vaultAddress, undefined, this.kvaultProgramId);  
    const vaultState = await vault.getState(getConnectionPool().rpc as any);  
    const currentSlot = await getConnectionPool().rpc.getSlot({ commitment: 'confirmed' }).send();  
  
    return await this.manager.getVaultOverview(  
      vaultState as any,  
      tokenPrice,  
      currentSlot  
    );  
  }  
  
  /**
   * Deposit 到指定的 vault，並返回獲得的 share amount
   */
  async deposit(vaultAddress: Address, amount: Decimal): Promise<{ signature: Signature; receivedShares: Decimal }> {
    const vault = new KaminoVault(vaultAddress, undefined, this.kvaultProgramId);
    const vaultState = await vault.getState(getConnectionPool().rpc as any);

    console.log('=== Kamino Deposit - Share Tracking ===');
    console.log(`Vault Address: ${vaultAddress}`);
    console.log(`Deposit Amount: ${amount.toString()}`);

    // Get share balance before deposit
    const sharesBefore = await this.getUserShareBalance(vaultAddress);
    console.log(`Shares BEFORE deposit: ${sharesBefore.toString()}`);

    const depositIxs = await this.manager.depositToVaultIxs(
      this.wallet as any,
      vault,
      amount
    );

    const sig = await sendAndConfirmTx(
      getConnectionPool(),
      this.wallet,
      [...depositIxs.depositIxs, ...depositIxs.stakeInFarmIfNeededIxs],
      [],
      [vaultState.vaultLookupTable],
      'DepositToVault'
    );

    console.log('Deposit transaction confirmed, waiting for share balance update...');
    // Wait for balance to update
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get share balance after deposit
    const sharesAfter = await this.getUserShareBalance(vaultAddress);
    console.log(`Shares AFTER deposit: ${sharesAfter.toString()}`);

    // Calculate received shares
    const receivedShares = sharesAfter.minus(sharesBefore);
    console.log(`Received shares: ${receivedShares.toString()}`);
    console.log('=========================================');

    return {
      signature: sig,
      receivedShares,
    };
  }  
  
  /**
   * 獲取用戶在指定 token 的餘額
   */
  private async getTokenBalance(tokenMint: Address): Promise<Decimal> {
    try {
      const tokenAccount = await getAssociatedTokenAddress(
        new PublicKey(tokenMint),
        new PublicKey(this.wallet.address),
      );
      console.log(`  Token Account Address: ${tokenAccount.toString()}`);

      const account = await getAccount(getConnectionPool().rpc as any, tokenAccount);
      const balance = new Decimal(account.amount.toString());
      console.log(`  Token Balance Retrieved: ${balance.toString()} (base units)`);
      return balance;
    } catch (error) {
      // If account doesn't exist, return 0
      console.log(`  ⚠️ Failed to get token balance:`, error instanceof Error ? error.message : error);
      console.log(`  Returning 0 as default`);
      return new Decimal(0);
    }
  }

  /**
   * 從指定的 vault withdraw，並返回提領的數量
   */
  async withdraw(vaultAddress: Address, shareAmount: Decimal): Promise<{ signature: Signature; withdrawnAmount: Decimal }> {
    sleep(100);
    const vault = new KaminoVault(vaultAddress, undefined, this.kvaultProgramId);
    const currentSlot = await getConnectionPool().rpc.getSlot({ commitment: 'confirmed' }).send();

    const vaultState = await vault.getState(getConnectionPool().rpc as any);

    // Get the token mint from vault state
    const tokenMint = vaultState.tokenMint.toString() as Address;
    console.log('=== Kamino Withdraw - Balance Tracking ===');
    console.log(`Token Mint: ${tokenMint}`);
    console.log(`Wallet Address: ${this.wallet.address}`);

    // Get balance before withdrawal
    const balanceBefore = await this.getTokenBalance(tokenMint);
    console.log(`Balance BEFORE withdrawal (base units): ${balanceBefore.toString()}`);

    const withdrawIxs = await this.manager.withdrawFromVaultIxs(
      this.wallet as any,
      vault,
      shareAmount,
      currentSlot
    );

    const sig = await sendAndConfirmTx(
      getConnectionPool(),
      this.wallet,
      [...withdrawIxs.unstakeFromFarmIfNeededIxs, ...withdrawIxs.withdrawIxs, ...withdrawIxs.postWithdrawIxs],
      [],
      [vaultState.vaultLookupTable],
      'WithdrawFromVault'
    );

    console.log('Withdrawal transaction confirmed, waiting for balance update...');
    // Wait a bit for balance to update
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get balance after withdrawal
    const balanceAfter = await this.getTokenBalance(tokenMint);
    console.log(`Balance AFTER withdrawal (base units): ${balanceAfter.toString()}`);

    // Calculate withdrawn amount (in base units)
    const withdrawnAmountRaw = balanceAfter.minus(balanceBefore);
    console.log(`Withdrawn amount RAW (base units): ${withdrawnAmountRaw.toString()}`);

    // Convert to human-readable amount (divide by 10^decimals)
    // Most tokens use 6 decimals (USDC, USDT) or 9 decimals (SOL)
    const decimals = 6; // USDC default, could be enhanced to detect from mint
    const withdrawnAmount = withdrawnAmountRaw.div(new Decimal(10).pow(decimals));
    console.log(`Withdrawn amount (human-readable with ${decimals} decimals): ${withdrawnAmount.toString()}`);
    console.log('==========================================');

    return {
      signature: sig,
      withdrawnAmount,
    };
  }

  /**
   * 獲取用戶在指定 vault 中的 share balance
   */
  async getUserShareBalance(vaultAddress: Address): Promise<Decimal> {
    const vault = new KaminoVault(vaultAddress, undefined, this.kvaultProgramId);
    await vault.getState(getConnectionPool().rpc as any);

    const userShares = await this.manager.getUserSharesBalanceSingleVault(
      this.wallet.address,
      vault
    );

    return userShares.stakedShares;
  }
}