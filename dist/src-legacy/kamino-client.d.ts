import { KaminoVault } from '@kamino-finance/klend-sdk';
import { type Address, Signature } from '@solana/kit';
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
export declare class KaminoClient {
    private wallet;
    private manager;
    private kvaultProgramId;
    private isMainnet;
    private constructor();
    /**
     * 初始化 KaminoClient
     */
    static initialize(config: KaminoClientConfig): Promise<KaminoClient>;
    /**
     * 獲取所有可用的 vaults
     */
    getAllVaults(): Promise<KaminoVault[]>;
    /**
     * 獲取特定代幣的所有 vaults
     */
    getAllVaultsForToken(tokenMint: Address): Promise<KaminoVault[]>;
    /**
     * 篩選 deposit value 大於指定金額的 vaults
     */
    getVaultsAboveValue(minValueUSD: number): Promise<VaultInfo[]>;
    /**
     * 獲取 vault 的詳細概覽
     */
    getVaultOverview(vaultAddress: Address, tokenPrice?: Decimal): Promise<import("@kamino-finance/klend-sdk").VaultOverview>;
    /**
     * Deposit 到指定的 vault
     */
    deposit(vaultAddress: Address, amount: Decimal): Promise<Signature>;
    /**
     * 獲取用戶在指定 token 的餘額
     */
    private getTokenBalance;
    /**
     * 從指定的 vault withdraw，並返回提領的數量
     */
    withdraw(vaultAddress: Address, shareAmount: Decimal): Promise<{
        signature: Signature;
        withdrawnAmount: Decimal;
    }>;
    /**
     * 獲取用戶在指定 vault 中的 share balance
     */
    getUserShareBalance(vaultAddress: Address): Promise<Decimal>;
}
