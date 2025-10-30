import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../web3-workflow-types';
import { executeJupiterSwap, type TokenTicker } from '../utils/jupiter-swap';
import { NodeDataAccessor } from '../utils/node-data-accessor';

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
        displayName: 'Input Token',
        name: 'inputToken',
        type: 'string' as const,
        default: 'USDC',
        description: 'Input token ticker (e.g., USDC, SOL, JITOSOL). See src/utils/constant.ts for available tokens.'
      },
      {
        displayName: 'Output Token',
        name: 'outputToken',
        type: 'string' as const,
        default: 'SOL',
        description: 'Output token ticker (e.g., SOL, USDC, JITOSOL). See src/utils/constant.ts for available tokens.'
      },
      {
        displayName: 'Amount',
        name: 'amount',
        type: 'string' as const,
        default: 'auto',
        description: 'Amount to swap. Use "auto" to use output from previous node, "all" for all input amount, "half" for half, or specify a number (e.g., 1, 0.5, 100)'
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
        const inputToken = context.getNodeParameter('inputToken', itemIndex) as TokenTicker;
        const outputToken = context.getNodeParameter('outputToken', itemIndex) as TokenTicker;
        const amountParam = context.getNodeParameter('amount', itemIndex) as string;
        const slippageBps = parseInt(context.getNodeParameter('slippageBps', itemIndex, '50') as string);

        // 解析 amount，使用標準化的資料存取工具
        console.log('=== Swap Node Execution ===');
        console.log('Previous node output:', items.length > 0 && items[0] ? JSON.stringify(items[0].json, null, 2) : 'No input data');
        console.log(`Amount parameter: "${amountParam}"`);

        // 使用 NodeDataAccessor 統一解析金額
        const amountDecimal = NodeDataAccessor.parseAmountParameter(
          amountParam,
          items,
          null, // SwapNode 不使用當前餘額
          'SwapNode'
        );

        // 轉換為 number (jupiter-swap 需要 number 類型)
        const amount = amountDecimal.toNumber();

        console.log(`Final swap parameters:`);
        console.log(`  - Input Token: ${inputToken}`);
        console.log(`  - Output Token: ${outputToken}`);
        console.log(`  - Amount: ${amount}`);
        console.log(`  - Slippage BPS: ${slippageBps}`);
        console.log('===========================');

        // 使用可復用的 executeJupiterSwap 工具函數
        const swapResult = await executeJupiterSwap({
          rpcUrl,
          keypairPath,
          inputToken,
          outputToken,
          amount,
          slippageBps
        });

        // 返回結果
        returnData.push({
          json: {
            success: true,
            operation: 'swap',
            ...swapResult,
            outputType: 'tokens' // ✅ Swap 總是輸出 tokens
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
            inputToken: context.getNodeParameter('inputToken', itemIndex),
            outputToken: context.getNodeParameter('outputToken', itemIndex),
            amount: context.getNodeParameter('amount', itemIndex)
          }
        });
      }
    }

    return [returnData];
  }
}
