import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../web3-workflow-types';
import { KaminoClient } from '../kamino-client';
import { type Address } from '@solana/kit';
import Decimal from 'decimal.js';

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
        displayName: 'Vault Address',
        name: 'vaultAddress',
        type: 'string' as const,
        default: '',
        description: 'The address of the Kamino vault'
      },
      {
        displayName: 'Amount',
        name: 'amount',
        type: 'string' as const,
        default: '0',
        description: 'Amount to deposit (for deposit operation)'
      },
      {
        displayName: 'Share Amount',
        name: 'shareAmount',
        type: 'string' as const,
        default: '0',
        description: 'Share amount to withdraw (for withdraw operation)'
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
        const vaultAddress = context.getNodeParameter('vaultAddress', itemIndex) as string;
        const amount = context.getNodeParameter('amount', itemIndex, '0') as string;
        const shareAmount = context.getNodeParameter('shareAmount', itemIndex, '0') as string;
        const keypairPath = context.getNodeParameter('keypairPath', itemIndex, './keypair.json') as string;

        // 初始化 Kamino Client
        const kaminoClient = await KaminoClient.initialize({
          keypairPath,
          isMainnet: true
        });

        let signature: string;
        let operationDetails: Record<string, any>;

        if (operation === 'deposit') {
          // 執行存款操作
          const depositAmount = new Decimal(amount);
          signature = await kaminoClient.deposit(
            vaultAddress as Address,
            depositAmount
          );

          operationDetails = {
            operation: 'deposit',
            vaultAddress,
            amount: amount,
            signature,
            success: true
          };

        } else if (operation === 'withdraw') {
          // 執行提款操作
          const withdrawShareAmount = new Decimal(shareAmount);
          signature = await kaminoClient.withdraw(
            vaultAddress as Address,
            withdrawShareAmount
          );

          operationDetails = {
            operation: 'withdraw',
            vaultAddress,
            shareAmount: shareAmount,
            signature,
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
            vaultAddress: context.getNodeParameter('vaultAddress', itemIndex)
          }
        });
      }
    }

    return [returnData];
  }
}
