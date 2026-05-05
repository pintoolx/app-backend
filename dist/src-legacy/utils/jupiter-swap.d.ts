import { TOKEN_ADDRESS } from './constant';
export type TokenTicker = keyof typeof TOKEN_ADDRESS;
export interface JupiterSwapOptions {
    rpcUrl: string;
    keypairPath: string;
    inputToken: TokenTicker;
    outputToken: TokenTicker;
    amount: number;
    slippageBps?: number;
}
export interface JupiterSwapResult {
    signature: string;
    inputToken: string;
    outputToken: string;
    inputAmount: number;
    outputAmount: string;
    walletAddress: string;
    slippageBps: number;
}
/**
 * 執行 Jupiter Token Swap
 * @param options Swap 配置選項
 * @returns Promise<JupiterSwapResult> 交易結果
 */
export declare function executeJupiterSwap(options: JupiterSwapOptions): Promise<JupiterSwapResult>;
/**
 * 獲取 Jupiter Swap 報價（不執行交易）
 * @param options Swap 配置選項
 * @returns Promise 報價信息
 */
export declare function getJupiterQuote(options: {
    rpcUrl: string;
    inputToken: TokenTicker;
    outputToken: TokenTicker;
    amount: number;
    slippageBps?: number;
}): Promise<{
    inputToken: "JITOSOL" | "SOL" | "USDC";
    outputToken: "JITOSOL" | "SOL" | "USDC";
    inputAmount: number;
    outputAmount: string;
    priceImpactPct: string;
    slippageBps: number;
    routePlan: import("@jup-ag/api").RoutePlanStep[];
}>;
