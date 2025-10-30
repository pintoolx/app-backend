import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../web3-workflow-types';
import { KaminoClient } from '../kamino-client';
import { type Address } from '@solana/kit';
import { KAMINO_VAULT } from '../utils/constant';
import { NodeDataAccessor } from '../utils/node-data-accessor';

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

  throw new Error(`Vault "${vaultName}" not found in KAMINO_VAULT configuration. Please check src/utils/constant.ts for available vault names.`);
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
            value: 'deposit'
          },
          {
            name: 'Withdraw',
            value: 'withdraw'
          }
        ]
      },
      {
        displayName: 'Vault Name',
        name: 'vaultName',
        type: 'string' as const,
        default: '',
        description: 'The name of the Kamino vault (e.g., USDC_Prime, MEV_Capital_SOL)'
      },
      {
        displayName: 'Amount',
        name: 'amount',
        type: 'string' as const,
        default: 'auto',
        description: 'Amount to deposit. Use "auto" to use output from previous node, "all" for all input amount, "half" for half, or specify a number (for deposit operation)'
      },
      {
        displayName: 'Share Amount',
        name: 'shareAmount',
        type: 'string' as const,
        default: 'all',
        description: 'Share amount to withdraw. Use "all" to withdraw all shares, "half" for half, or specify a number (for withdraw operation)'
      },
      {
        displayName: 'Keypair Path',
        name: 'keypairPath',
        type: 'string' as const,
        default: './keypair.json',
        description: 'Path to the wallet keypair file'
      }
    ]
  };

  async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
    const items = context.getInputData();
    const returnData: NodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        // 獲取參數
        const operation = context.getNodeParameter('operation', itemIndex) as 'deposit' | 'withdraw';
        const vaultName = context.getNodeParameter('vaultName', itemIndex) as string;
        const amountParam = context.getNodeParameter('amount', itemIndex, '0') as string;
        const shareAmountParam = context.getNodeParameter('shareAmount', itemIndex, '0') as string;
        const keypairPath = context.getNodeParameter('keypairPath', itemIndex, './keypair.json') as string;

        // 從 vault name 獲取 vault address
        const vaultAddress = getVaultAddress(vaultName);

        // 初始化 Kamino Client
        const kaminoClient = await KaminoClient.initialize({
          keypairPath,
          isMainnet: true
        });

        let operationDetails: Record<string, any>;

        if (operation === 'deposit') {
          // 執行存款操作，使用標準化的資料存取工具
          console.log('=== Kamino Deposit Operation ===');
          console.log('Previous node output:', items.length > 0 && items[0] ? JSON.stringify(items[0].json, null, 2) : 'No input data');
          console.log(`Amount parameter: "${amountParam}"`);

          const depositAmount = NodeDataAccessor.parseAmountParameter(
            amountParam,
            items,
            null, // Deposit 不使用當前餘額
            `KaminoNode(${vaultName})`
          );

          console.log(`Deposit amount: ${depositAmount.toString()}`);
          console.log('================================');

          const depositResult = await kaminoClient.deposit(
            vaultAddress as Address,
            depositAmount
          );

          operationDetails = {
            operation: 'deposit',
            vaultName,
            vaultAddress,
            depositAmount: depositAmount.toString(), // 存入的 token amount
            receivedShares: depositResult.receivedShares.toString(), // 獲得的 shares
            outputAmount: depositResult.receivedShares.toString(), // ✅ 標準化輸出 = shares
            outputType: 'shares', // ✅ 標識資料類型
            signature: depositResult.signature,
            success: true
          };

        } else if (operation === 'withdraw') {
          // 執行提款操作
          console.log('=== Kamino Withdraw Operation ===');
          console.log(`Share amount parameter: "${shareAmountParam}"`);
          console.log('Previous node output:', items.length > 0 && items[0] ? JSON.stringify(items[0].json, null, 2) : 'No input data');

          // 獲取當前的 share balance
          const currentShareBalance = await kaminoClient.getUserShareBalance(vaultAddress as Address);
          console.log(`Current share balance: ${currentShareBalance.toString()}`);

          // 使用 NodeDataAccessor 解析 share 數量
          // "auto": 從前一個節點讀取 outputAmount（如果前一個是 deposit，會獲得 shares）
          // "all": 使用當前所有 share balance
          // "half": 使用當前 share balance 的一半
          // 數字: 使用指定的 share 數量
          const withdrawShareAmount = NodeDataAccessor.parseAmountParameter(
            shareAmountParam,
            items,
            currentShareBalance, // 提供當前 share balance 供 "all"/"half" 使用
            `KaminoNode(${vaultName})`
          );

          console.log(`Withdraw share amount: ${withdrawShareAmount.toString()}`);
          console.log('=================================');

          const withdrawResult = await kaminoClient.withdraw(
            vaultAddress as Address,
            withdrawShareAmount
          );

          operationDetails = {
            operation: 'withdraw',
            vaultName,
            vaultAddress,
            withdrawnShares: withdrawShareAmount.toString(), // 提取的 shares
            withdrawnTokens: withdrawResult.withdrawnAmount.toString(), // 獲得的 tokens
            outputAmount: withdrawResult.withdrawnAmount.toString(), // ✅ 標準化輸出 = tokens
            outputType: 'tokens', // ✅ 標識資料類型
            signature: withdrawResult.signature,
            success: true
          };

        } else {
          throw new Error(`Unknown operation: ${operation}`);
        }

        returnData.push({
          json: operationDetails
        });

      } catch (error) {
        // 錯誤處理
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        returnData.push({
          json: {
            success: false,
            error: errorMessage,
            operation: context.getNodeParameter('operation', itemIndex),
            vaultName: context.getNodeParameter('vaultName', itemIndex)
          }
        });
      }
    }

    return [returnData];
  }
}
