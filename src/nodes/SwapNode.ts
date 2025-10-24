import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../web3-workflow-types';
import { executeJupiterSwap } from '../utils/jupiter-swap';

export class SwapNode implements INodeType {
  description = {
    displayName: 'Jupiter Swap',
    name: 'jupiterSwap',
    group: ['swap'],
    version: 1,
    description: 'Swap tokens using Jupiter aggregator',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: true,
    properties: [
      {
        displayName: 'RPC URL',
        name: 'rpcUrl',
        type: 'string' as const,
        default: 'https://api.mainnet-beta.solana.com',
        description: 'Solana RPC endpoint URL'
      },
      {
        displayName: 'Keypair Path',
        name: 'keypairPath',
        type: 'string' as const,
        default: './keypair.json',
        description: 'Path to the wallet keypair file'
      },
      {
        displayName: 'Input Token Mint',
        name: 'inputMint',
        type: 'string' as const,
        default: '',
        description: 'Input token mint address (token to sell)'
      },
      {
        displayName: 'Output Token Mint',
        name: 'outputMint',
        type: 'string' as const,
        default: '',
        description: 'Output token mint address (token to buy)'
      },
      {
        displayName: 'Amount',
        name: 'amount',
        type: 'string' as const,
        default: '0',
        description: 'Amount to swap (human-readable, e.g., 1, 0.5, 100)'
      },
      {
        displayName: 'Slippage (bps)',
        name: 'slippageBps',
        type: 'string' as const,
        default: '50',
        description: 'Slippage tolerance in basis points (50 = 0.5%)'
      }
    ]
  };

  async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
    const items = context.getInputData();
    const returnData: NodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        // 獲取參數
        const rpcUrl = context.getNodeParameter('rpcUrl', itemIndex) as string;
        const keypairPath = context.getNodeParameter('keypairPath', itemIndex) as string;
        const inputMint = context.getNodeParameter('inputMint', itemIndex) as string;
        const outputMint = context.getNodeParameter('outputMint', itemIndex) as string;
        const amount = parseFloat(context.getNodeParameter('amount', itemIndex) as string);
        const slippageBps = parseInt(context.getNodeParameter('slippageBps', itemIndex, '50') as string);

        // 使用可復用的 executeJupiterSwap 工具函數
        const swapResult = await executeJupiterSwap({
          rpcUrl,
          keypairPath,
          inputMint,
          outputMint,
          amount,
          slippageBps
        });

        // 返回結果
        returnData.push({
          json: {
            success: true,
            operation: 'swap',
            ...swapResult
          }
        });

      } catch (error) {
        // 錯誤處理
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        returnData.push({
          json: {
            success: false,
            error: errorMessage,
            operation: 'swap',
            inputMint: context.getNodeParameter('inputMint', itemIndex),
            outputMint: context.getNodeParameter('outputMint', itemIndex),
            amount: context.getNodeParameter('amount', itemIndex)
          }
        });
      }
    }

    return [returnData];
  }
}
