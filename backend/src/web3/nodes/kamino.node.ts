import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';
import { KaminoClient } from '../services/kamino.service';
import { type Address } from '@solana/kit';
import Decimal from 'decimal.js';
import { KAMINO_VAULT } from '../constants';

/**
 * Helper function to get vault address from vault name
 * @param vaultName - The name of the vault (e.g., "USDC_Prime", "MEV_Capital_SOL")
 * @returns The vault address
 */
function getVaultAddress(vaultName: string): string {
  // Search in all token categories
  for (const tokenType of Object.keys(KAMINO_VAULT)) {
    const vaults = KAMINO_VAULT[tokenType as keyof typeof KAMINO_VAULT];
    if (vaultName in vaults) {
      return vaults[vaultName as keyof typeof vaults];
    }
  }

  throw new Error(
    `Vault "${vaultName}" not found in KAMINO_VAULT configuration. Please check src/utils/constant.ts for available vault names.`,
  );
}

/**
 * Parse amount from input, supporting "all", "half", or numeric values
 * @param amountStr - Amount string ("all", "half", or numeric)
 * @param availableAmount - Available amount to use for "all" or "half"
 * @returns Parsed Decimal amount
 */
function parseAmount(amountStr: string, availableAmount: Decimal): Decimal {
  const normalized = amountStr.toLowerCase().trim();

  if (normalized === 'all') {
    return availableAmount;
  } else if (normalized === 'half') {
    return availableAmount.div(2);
  } else {
    return new Decimal(amountStr);
  }
}

/**
 * Get amount from previous node output
 * @param inputData - Input data from previous node
 * @returns Amount as Decimal, or null if not found
 */
function getAmountFromInput(inputData: any[]): Decimal | null {
  if (inputData.length === 0) {
    return null;
  }

  const previousOutput = inputData[0].json;

  // Try to get amount from different possible fields
  if (previousOutput.outputAmount !== undefined) {
    // From Swap node
    return new Decimal(previousOutput.outputAmount);
  } else if (previousOutput.amount !== undefined) {
    // From other nodes
    return new Decimal(previousOutput.amount);
  }

  return null;
}

export class KaminoNode implements INodeType {
  description = {
    displayName: 'Kamino',
    name: 'kamino',
    group: ['vault'],
    version: 1,
    description: 'Interact with Kamino vaults - deposit or withdraw tokens',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: true, // 啟用此 node 的 Telegram 通知
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options' as const,
        default: 'deposit',
        description: 'The operation to perform',
        options: [
          {
            name: 'Deposit',
            value: 'deposit',
          },
          {
            name: 'Withdraw',
            value: 'withdraw',
          },
        ],
      },
      {
        displayName: 'Vault Name',
        name: 'vaultName',
        type: 'string' as const,
        default: '',
        description: 'The name of the Kamino vault (e.g., USDC_Prime, MEV_Capital_SOL)',
      },
      {
        displayName: 'Amount',
        name: 'amount',
        type: 'string' as const,
        default: 'auto',
        description:
          'Amount to deposit. Use "auto" to use output from previous node, "all" for all input amount, "half" for half, or specify a number (for deposit operation)',
      },
      {
        displayName: 'Share Amount',
        name: 'shareAmount',
        type: 'string' as const,
        default: 'all',
        description:
          'Share amount to withdraw. Use "all" to withdraw all shares, "half" for half, or specify a number (for withdraw operation)',
      },
      {
        displayName: 'Keypair Path',
        name: 'keypairPath',
        type: 'string' as const,
        default: './keypair.json',
        description: 'Path to the wallet keypair file',
      },
    ],
  };

  async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
    const items = context.getInputData();
    const returnData: NodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        // 獲取參數
        const operation = context.getNodeParameter('operation', itemIndex) as
          | 'deposit'
          | 'withdraw';
        const vaultName = context.getNodeParameter('vaultName', itemIndex) as string;
        const amountParam = context.getNodeParameter('amount', itemIndex, '0') as string;
        const shareAmountParam = context.getNodeParameter('shareAmount', itemIndex, '0') as string;
        const keypairPath = context.getNodeParameter(
          'keypairPath',
          itemIndex,
          './keypair.json',
        ) as string;

        // 從 vault name 獲取 vault address
        const vaultAddress = getVaultAddress(vaultName);

        // 初始化 Kamino Client
        const kaminoClient = await KaminoClient.initialize({
          keypairPath,
          isMainnet: true,
        });

        let signature: string;
        let operationDetails: Record<string, any>;

        if (operation === 'deposit') {
          // 執行存款操作
          let depositAmount: Decimal;

          // 檢查是否要從前一個節點讀取金額
          const inputAmount = getAmountFromInput(items);
          if (
            inputAmount !== null &&
            (amountParam === '0' || amountParam.toLowerCase() === 'auto')
          ) {
            // 使用前一個節點的輸出金額
            depositAmount = inputAmount;
            console.log(`Use output amount from previous node: ${depositAmount.toString()}`);
          } else if (amountParam.toLowerCase() === 'all' || amountParam.toLowerCase() === 'half') {
            // 對於 "all" 或 "half"，使用前一個節點的輸出金額
            if (inputAmount === null) {
              throw new Error('Cannot use "all" or "half" without input from previous node');
            }
            depositAmount = parseAmount(amountParam, inputAmount);
            console.log(`Use ${amountParam}: ${depositAmount.toString()}`);
          } else {
            // 使用指定的固定金額
            depositAmount = new Decimal(amountParam);
          }

          signature = await kaminoClient.deposit(vaultAddress as Address, depositAmount);

          operationDetails = {
            operation: 'deposit',
            vaultName,
            vaultAddress,
            amount: depositAmount.toString(),
            signature,
            success: true,
          };
        } else if (operation === 'withdraw') {
          // 執行提款操作
          let withdrawShareAmount: Decimal;

          // 檢查是否使用 "all" 或 "half"
          if (
            shareAmountParam.toLowerCase() === 'all' ||
            shareAmountParam.toLowerCase() === 'half'
          ) {
            // 獲取當前的 share balance
            const currentShareBalance = await kaminoClient.getUserShareBalance(
              vaultAddress as Address,
            );
            console.log(`Current share balance: ${currentShareBalance.toString()}`);

            withdrawShareAmount = parseAmount(shareAmountParam, currentShareBalance);
            console.log(`Withdraw ${shareAmountParam}: ${withdrawShareAmount.toString()}`);
          } else {
            // 使用指定的固定數量
            withdrawShareAmount = new Decimal(shareAmountParam);
          }

          const withdrawResult = await kaminoClient.withdraw(vaultAddress as Address, withdrawShareAmount);

          operationDetails = {
            operation: 'withdraw',
            vaultName,
            vaultAddress,
            shareAmount: withdrawShareAmount.toString(),
            amount: withdrawResult.withdrawnAmount.toString(),
            signature: withdrawResult.signature,
            success: true,
          };
        } else {
          throw new Error(`Unknown operation: ${operation}`);
        }

        returnData.push({
          json: operationDetails,
        });
      } catch (error) {
        // 錯誤處理
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        returnData.push({
          json: {
            success: false,
            error: errorMessage,
            operation: context.getNodeParameter('operation', itemIndex),
            vaultName: context.getNodeParameter('vaultName', itemIndex),
          },
        });
      }
    }

    return [returnData];
  }
}
