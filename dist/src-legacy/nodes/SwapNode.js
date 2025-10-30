import { executeJupiterSwap } from '../utils/jupiter-swap';
/**
 * Parse amount from input, supporting "all", "half", or numeric values
 * @param amountStr - Amount string ("all", "half", "auto", or numeric)
 * @param availableAmount - Available amount to use for "all" or "half"
 * @returns Parsed number amount
 */
function parseSwapAmount(amountStr, availableAmount) {
    const normalized = amountStr.toLowerCase().trim();
    if (normalized === 'all' || normalized === 'auto') {
        return availableAmount;
    }
    else if (normalized === 'half') {
        return availableAmount / 2;
    }
    else {
        return parseFloat(amountStr);
    }
}
/**
 * Get amount from previous node output
 * @param inputData - Input data from previous node
 * @returns Amount as number, or null if not found
 */
function getSwapAmountFromInput(inputData) {
    if (inputData.length === 0) {
        return null;
    }
    const previousOutput = inputData[0].json;
    // Try to get amount from different possible fields
    if (previousOutput.amount !== undefined) {
        // From Kamino withdraw or other nodes
        return parseFloat(previousOutput.amount);
    }
    else if (previousOutput.outputAmount !== undefined) {
        // From another Swap node
        return parseFloat(previousOutput.outputAmount);
    }
    return null;
}
export class SwapNode {
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
                type: 'string',
                default: 'https://api.mainnet-beta.solana.com',
                description: 'Solana RPC endpoint URL'
            },
            {
                displayName: 'Keypair Path',
                name: 'keypairPath',
                type: 'string',
                default: './keypair.json',
                description: 'Path to the wallet keypair file'
            },
            {
                displayName: 'Input Token',
                name: 'inputToken',
                type: 'string',
                default: 'USDC',
                description: 'Input token ticker (e.g., USDC, SOL, JITOSOL). See src/utils/constant.ts for available tokens.'
            },
            {
                displayName: 'Output Token',
                name: 'outputToken',
                type: 'string',
                default: 'SOL',
                description: 'Output token ticker (e.g., SOL, USDC, JITOSOL). See src/utils/constant.ts for available tokens.'
            },
            {
                displayName: 'Amount',
                name: 'amount',
                type: 'string',
                default: 'auto',
                description: 'Amount to swap. Use "auto" to use output from previous node, "all" for all input amount, "half" for half, or specify a number (e.g., 1, 0.5, 100)'
            },
            {
                displayName: 'Slippage (bps)',
                name: 'slippageBps',
                type: 'string',
                default: '50',
                description: 'Slippage tolerance in basis points (50 = 0.5%)'
            }
        ]
    };
    async execute(context) {
        const items = context.getInputData();
        const returnData = [];
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                // 獲取參數
                const rpcUrl = context.getNodeParameter('rpcUrl', itemIndex);
                const keypairPath = context.getNodeParameter('keypairPath', itemIndex);
                const inputToken = context.getNodeParameter('inputToken', itemIndex);
                const outputToken = context.getNodeParameter('outputToken', itemIndex);
                const amountParam = context.getNodeParameter('amount', itemIndex);
                const slippageBps = parseInt(context.getNodeParameter('slippageBps', itemIndex, '50'));
                // 解析 amount，支持從前一個節點讀取
                console.log('=== Swap Node Execution ===');
                console.log('Previous node output:', items.length > 0 && items[0] ? JSON.stringify(items[0].json, null, 2) : 'No input data');
                console.log(`Amount parameter: "${amountParam}"`);
                let amount;
                const inputAmount = getSwapAmountFromInput(items);
                console.log(`Extracted input amount from previous node: ${inputAmount}`);
                if (inputAmount !== null && (amountParam === '0' || amountParam.toLowerCase() === 'auto')) {
                    // 使用前一個節點的輸出金額
                    amount = inputAmount;
                    console.log(`✓ Using output amount from previous node: ${amount}`);
                }
                else if (amountParam.toLowerCase() === 'all' || amountParam.toLowerCase() === 'half') {
                    // 對於 "all" 或 "half"，使用前一個節點的輸出金額
                    if (inputAmount === null) {
                        throw new Error('Cannot use "all" or "half" without input from previous node');
                    }
                    amount = parseSwapAmount(amountParam, inputAmount);
                    console.log(`✓ Using ${amountParam} of input amount: ${amount}`);
                }
                else {
                    // 使用指定的固定金額
                    amount = parseFloat(amountParam);
                    console.log(`✓ Using fixed amount: ${amount}`);
                }
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
                        ...swapResult
                    }
                });
            }
            catch (error) {
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
//# sourceMappingURL=SwapNode.js.map