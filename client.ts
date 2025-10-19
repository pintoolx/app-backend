import { type DepositIxs, KaminoManager, KaminoVault, type WithdrawIxs } from '@kamino-finance/klend-sdk';  
import { 
  createSolanaRpc, 
  address, 
  type Address, 
  type TransactionSigner, 
  type Rpc, 
  type SolanaRpcApi
} from '@solana/kit';  
import { parseKeypairFile } from '@kamino-finance/klend-sdk/dist/utils/signer.js';  
import Decimal from 'decimal.js';  
  
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
  private rpc: Rpc<SolanaRpcApi>;  
  private wallet: TransactionSigner;  
  private manager: KaminoManager;  
  private kvaultProgramId: Address;  
  private isMainnet: boolean;  
  
  private constructor(  
    rpc: Rpc<SolanaRpcApi>,  
    wallet: TransactionSigner,  
    manager: KaminoManager,  
    kvaultProgramId: Address,  
    isMainnet: boolean  
  ) {  
    this.rpc = rpc;  
    this.wallet = wallet;  
    this.manager = manager;  
    this.kvaultProgramId = kvaultProgramId;  
    this.isMainnet = isMainnet;  
  }  
  
  /**  
   * 初始化 KaminoClient  
   */  
  static async initialize(config: KaminoClientConfig): Promise<KaminoClient> {  

    const rpcUrl = config.isMainnet   
      ? 'https://api.mainnet-beta.solana.com'  
      : 'https://api.devnet.solana.com';

    const rpc = createSolanaRpc(rpcUrl);  
    const wallet = await parseKeypairFile(config.keypairPath);  
  
    const klendProgramId = config.isMainnet  
      ? address('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD')  
      : address('SLendK7ySfcEzyaFqy93gDnD3RtrpXJcnRwb6zFHJSh');  
  
    const kvaultProgramId = config.isMainnet  
      ? address('KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd')  
      : address('stKvQfwRsQiKnLtMNVLHKS3exFJmZFsgfzBPWHECUYK');    
  
    const manager = new KaminoManager(  
      rpc as any,
      400, // recentSlotDurationMs  
      klendProgramId,  
      kvaultProgramId  
    );  
  
    return new KaminoClient(rpc, wallet, manager, kvaultProgramId, config.isMainnet);  
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
    const currentSlot = await this.rpc.getSlot({ commitment: 'confirmed' }).send();  
    const vaultsAboveValue: VaultInfo[] = [];  
  
    for (const vault of allVaults) {  
      const vaultState = await vault.getState(this.rpc as any);
        
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
    const vaultState = await vault.getState(this.rpc as any);  
    const currentSlot = await this.rpc.getSlot({ commitment: 'confirmed' }).send();  
  
    return await this.manager.getVaultOverview(  
      vaultState as any,  
      tokenPrice,  
      currentSlot  
    );  
  }  
  
  /**  
   * Deposit 到指定的 vault  
   */  
  async deposit(vaultAddress: Address, amount: Decimal): Promise<DepositIxs> {  
    const vault = new KaminoVault(vaultAddress, undefined, this.kvaultProgramId);  
    const depositIxs = await this.manager.depositToVaultIxs(  
      this.wallet as any,
      vault,  
      amount  
    );  
  
    return depositIxs;  
  }  
  
  /**  
   * 從指定的 vault withdraw  
   */  
  async withdraw(vaultAddress: Address, shareAmount: Decimal): Promise<WithdrawIxs> {  
    const vault = new KaminoVault(vaultAddress, undefined, this.kvaultProgramId);  
    const currentSlot = await this.rpc.getSlot({ commitment: 'confirmed' }).send();  
      
    const withdrawIxs = await this.manager.withdrawFromVaultIxs(  
      this.wallet as any,  
      vault,  
      shareAmount,  
      currentSlot  
    );  
  
    return withdrawIxs;  
  }  
}