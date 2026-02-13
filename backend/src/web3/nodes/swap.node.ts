import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';
import { AgentKitService } from '../services/agent-kit.service';
import { TOKEN_ADDRESS } from '../constants';

export type TokenTicker = keyof typeof TOKEN_ADDRESS;

/**
 * Parse amount from input, supporting "all", "half", or numeric values
 * @param amountStr - Amount string ("all", "half", "auto", or numeric)
 * @param availableAmount - Available amount to use for "all" or "half"
 * @returns Parsed number amount
 */
function parseSwapAmount(amountStr: string, availableAmount: number): number {
  const normalized = amountStr.toLowerCase().trim();

  if (normalized === 'all' || normalized === 'auto') {
    return availableAmount;
  } else if (normalized === 'half') {
    return availableAmount / 2;
  } else {
    return parseFloat(amountStr);
  }
}

/**
 * Get amount from previous node output
 * @param inputData - Input data from previous node
 * @returns Amount as number, or null if not found
 */
function getSwapAmountFromInput(inputData: any[]): number | null {
  if (inputData.length === 0) {
    return null;
  }

  const previousOutput = inputData[0].json;

  // Try to get amount from different possible fields
  if (previousOutput.amount !== undefined) {
    // From Kamino withdraw or other nodes
    return parseFloat(previousOutput.amount);
  } else if (previousOutput.outputAmount !== undefined) {
    // From another Swap node
    return parseFloat(previousOutput.outputAmount);
  }

  return null;
}

export class SwapNode implements INodeType {
  description = {
    displayName: 'Jupiter Swap',
    name: 'jupiterSwap',
    group: ['swap'],
    version: 1,
    description: 'Swap tokens using Jupiter aggregator with Crossmint custodial wallet',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: true,
    isTrigger: false,
    properties: [
      {
        displayName: 'Account ID',
        name: 'accountId',
        type: 'string' as const,
        default: '',
        description: 'Account ID to use for the swap (uses Crossmint custodial wallet)',
      },
      {
        displayName: 'Input Token',
        name: 'inputToken',
        type: 'string' as const,
        default: 'USDC',
        description:
          'Input token ticker (e.g., USDC, SOL, JITOSOL). See src/web3/constants.ts for available tokens.',
      },
      {
        displayName: 'Output Token',
        name: 'outputToken',
        type: 'string' as const,
        default: 'SOL',
        description:
          'Output token ticker (e.g., SOL, USDC, JITOSOL). See src/web3/constants.ts for available tokens.',
      },
      {
        displayName: 'Amount',
        name: 'amount',
        type: 'string' as const,
        default: 'auto',
        description:
          'Amount to swap. Use "auto" to use output from previous node, "all" for all input amount, "half" for half, or specify a number (e.g., 1, 0.5, 100)',
      },
      {
        displayName: 'Slippage (bps)',
        name: 'slippageBps',
        type: 'string' as const,
        default: '50',
        description: 'Slippage tolerance in basis points (50 = 0.5%)',
      },
    ],
  };

  async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
    const items = context.getInputData();
    const returnData: NodeExecutionData[] = [];

    // 從 context 獲取 AgentKitService (在 executor 中注入)
    const agentKitService = context.getNodeParameter('agentKitService', 0) as AgentKitService;

    if (!agentKitService) {
      throw new Error('AgentKitService not available in execution context');
    }

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        // 獲取參數
        const accountId = context.getNodeParameter('accountId', itemIndex) as string;
        const inputToken = context.getNodeParameter('inputToken', itemIndex) as TokenTicker;
        const outputToken = context.getNodeParameter('outputToken', itemIndex) as TokenTicker;
        const amountParam = context.getNodeParameter('amount', itemIndex) as string;
        const slippageBps = parseInt(
          context.getNodeParameter('slippageBps', itemIndex, '50') as string,
        );

        if (!accountId) {
          throw new Error('Account ID is required');
        }

        // 從 constants 獲取 token addresses
        const inputMint = TOKEN_ADDRESS[inputToken];
        const outputMint = TOKEN_ADDRESS[outputToken];

        if (!inputMint) {
          throw new Error(
            `Unknown input token: ${inputToken}. Please check src/web3/constants.ts for available tokens.`,
          );
        }
        if (!outputMint) {
          throw new Error(
            `Unknown output token: ${outputToken}. Please check src/web3/constants.ts for available tokens.`,
          );
        }

        // 解析 amount，支持從前一個節點讀取
        let amount: number;
        const inputAmount = getSwapAmountFromInput(items);

        if (inputAmount !== null && (amountParam === '0' || amountParam.toLowerCase() === 'auto')) {
          // 使用前一個節點的輸出金額
          amount = inputAmount;
          console.log(`Use output amount from previous node: ${amount}`);
        } else if (amountParam.toLowerCase() === 'all' || amountParam.toLowerCase() === 'half') {
          // 對於 "all" 或 "half"，使用前一個節點的輸出金額
          if (inputAmount === null) {
            throw new Error('Cannot use "all" or "half" without input from previous node');
          }
          amount = parseSwapAmount(amountParam, inputAmount);
          console.log(`Use ${amountParam}: ${amount}`);
        } else {
          // 使用指定的固定金額
          amount = parseFloat(amountParam);
        }

        console.log(`\nSwap Node: Executing swap via Crossmint wallet`);
        console.log(`  Account: ${accountId}`);
        console.log(`  ${amount} ${inputToken} → ${outputToken}`);

        // 使用 AgentKitService 執行 swap
        const swapResult = await agentKitService.executeSwap(
          accountId,
          inputMint,
          outputMint,
          amount,
          slippageBps,
        );

        // 返回結果
        returnData.push({
          json: {
            success: true,
            operation: 'swap',
            signature: swapResult.signature,
            inputToken,
            outputToken,
            inputAmount: swapResult.inputAmount,
            outputAmount: swapResult.outputAmount,
            accountId,
            slippageBps,
          },
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
            amount: context.getNodeParameter('amount', itemIndex),
          },
        });
      }
    }

    return [returnData];
  }
}
