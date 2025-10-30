import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import { toTokenAmount, formatTokenAmount } from '../utils/token';
import { TOKEN_ADDRESS } from '../constants';
import fs from 'fs';

export type TokenTicker = keyof typeof TOKEN_ADDRESS;

export interface JupiterSwapOptions {
  rpcUrl: string;
  keypairPath: string;
  inputToken: TokenTicker; // 使用 TICKER 代替 inputMint
  outputToken: TokenTicker; // 使用 TICKER 代替 outputMint
  amount: number; // 人類可讀數字 (e.g., 1, 0.5, 100)
  slippageBps?: number; // 滑點 (basis points), 默認 50 = 0.5%
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
export async function executeJupiterSwap(options: JupiterSwapOptions): Promise<JupiterSwapResult> {
  const {
    rpcUrl,
    keypairPath,
    inputToken,
    outputToken,
    amount: humanAmount,
    slippageBps = 50,
  } = options;

  // 从 constant 中获取 token addresses
  const inputMint = TOKEN_ADDRESS[inputToken];
  const outputMint = TOKEN_ADDRESS[outputToken];

  if (!inputMint) {
    throw new Error(
      `Unknown input token: ${inputToken}. Please check src/utils/constant.ts for available tokens.`,
    );
  }
  if (!outputMint) {
    throw new Error(
      `Unknown output token: ${outputToken}. Please check src/utils/constant.ts for available tokens.`,
    );
  }

  // 初始化連接和客戶端
  const connection = new Connection(rpcUrl);
  const jupiterApi = createJupiterApiClient();
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8'))),
  );

  // 轉換為最小單位
  const amount = await toTokenAmount(connection, inputMint, humanAmount);

  // 1. 獲取報價
  const quote = await jupiterApi.quoteGet({
    inputMint,
    outputMint,
    amount,
    slippageBps,
  });

  // 顯示預期輸出
  const outputFormatted = await formatTokenAmount(connection, outputMint, quote.outAmount);
  console.log(`從 ${humanAmount} ${inputToken} 換到 ${outputFormatted} ${outputToken}`);

  // 2. 獲取序列化交易
  const swapResult = await jupiterApi.swapPost({
    swapRequest: {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
    },
  });

  // 3. 反序列化並簽名
  const swapTransactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  transaction.sign([wallet]);

  // 4. 發送交易
  const rawTransaction = transaction.serialize();
  const txid = await connection.sendRawTransaction(rawTransaction);

  // 5. 確認
  await connection.confirmTransaction(txid);
  console.log('成功！交易:', txid);

  return {
    signature: txid,
    inputToken,
    outputToken,
    inputAmount: humanAmount,
    outputAmount: outputFormatted,
    walletAddress: wallet.publicKey.toBase58(),
    slippageBps,
  };
}

/**
 * 獲取 Jupiter Swap 報價（不執行交易）
 * @param options Swap 配置選項
 * @returns Promise 報價信息
 */
export async function getJupiterQuote(options: {
  rpcUrl: string;
  inputToken: TokenTicker;
  outputToken: TokenTicker;
  amount: number;
  slippageBps?: number;
}) {
  const { rpcUrl, inputToken, outputToken, amount: humanAmount, slippageBps = 50 } = options;

  // 从 constant 中获取 token addresses
  const inputMint = TOKEN_ADDRESS[inputToken];
  const outputMint = TOKEN_ADDRESS[outputToken];

  if (!inputMint) {
    throw new Error(`Unknown input token: ${inputToken}`);
  }
  if (!outputMint) {
    throw new Error(`Unknown output token: ${outputToken}`);
  }

  const connection = new Connection(rpcUrl);
  const jupiterApi = createJupiterApiClient();

  // 轉換為最小單位
  const amount = await toTokenAmount(connection, inputMint, humanAmount);

  // 獲取報價
  const quote = await jupiterApi.quoteGet({
    inputMint,
    outputMint,
    amount,
    slippageBps,
  });

  // 格式化輸出金額
  const outputFormatted = await formatTokenAmount(connection, outputMint, quote.outAmount);

  return {
    inputToken,
    outputToken,
    inputAmount: humanAmount,
    outputAmount: outputFormatted,
    priceImpactPct: quote.priceImpactPct,
    slippageBps,
    routePlan: quote.routePlan,
  };
}
