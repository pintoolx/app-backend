import { executeJupiterSwap } from './utils/jupiter-swap';

// 使用重構後的工具函數
async function simpleSwap(
  rpcUrl: string,
  keypairPath: string,
  inputMint: string,
  outputMint: string,
  amount: number  // 直接輸入 1, 0.5, 100 等人類可讀數字！
) {
  const result = await executeJupiterSwap({
    rpcUrl,
    keypairPath,
    inputMint,
    outputMint,
    amount,
    slippageBps: 50
  });

  console.log('Swap 成功！', result);
  return result;
}

// 示例：從 USDC 換到 SOL 38.5
simpleSwap(
  'https://api.mainnet-beta.solana.com',
  './keypair.json',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'So11111111111111111111111111111111111111112',
  38.5
)
