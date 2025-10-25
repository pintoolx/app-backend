import { KaminoManager, KaminoVault } from '@kamino-finance/klend-sdk';
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
   * Deposit 到指定的 vault  
   */  
  async deposit(vaultAddress: Address, amount: Decimal): Promise<Signature> {  
    const vault = new KaminoVault(vaultAddress, undefined, this.kvaultProgramId);  
    const vaultState = await vault.getState(getConnectionPool().rpc as any);  
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
  
    return sig;  
  }  
  
  /**  
   * 從指定的 vault withdraw  
   */  
  async withdraw(vaultAddress: Address, shareAmount: Decimal): Promise<Signature> {  
    const vault = new KaminoVault(vaultAddress, undefined, this.kvaultProgramId);  
    const currentSlot = await getConnectionPool().rpc.getSlot({ commitment: 'confirmed' }).send();  

    const vaultState = await vault.getState(getConnectionPool().rpc as any);  
      
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

    return sig;
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