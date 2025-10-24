import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../web3-workflow-types';
import { monitorPrice } from '../utils/price-monitor';

export class PriceFeedNode implements INodeType {
  description = {
    displayName: 'Pyth Price Feed',
    name: 'pythPriceFeed',
    group: ['trigger'],
    version: 1,
    description: 'Monitor token price and trigger workflow when target price is reached',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: true,
    properties: [
      {
        displayName: 'Price Feed ID',
        name: 'priceId',
        type: 'string' as const,
        default: '',
        description: 'Pyth price feed ID to monitor (e.g., SOL/USD feed ID)'
      },
      {
        displayName: 'Target Price',
        name: 'targetPrice',
        type: 'string' as const,
        default: '0',
        description: 'Target price to trigger the workflow'
      },
      {
        displayName: 'Condition',
        name: 'condition',
        type: 'options' as const,
        default: 'above',
        description: 'Price condition to trigger',
        options: [
          {
            name: 'Above',
            value: 'above'
          },
          {
            name: 'Below',
            value: 'below'
          },
          {
            name: 'Equal',
            value: 'equal'
          }
        ]
      },
      {
        displayName: 'Hermes Endpoint',
        name: 'hermesEndpoint',
        type: 'string' as const,
        default: 'https://hermes.pyth.network',
        description: 'Pyth Hermes endpoint URL'
      },
      {
        displayName: 'Timeout (seconds)',
        name: 'timeout',
        type: 'string' as const,
        default: '300',
        description: 'Maximum time to wait for target price (0 = no timeout)'
      }
    ]
  };

  async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
    const items = context.getInputData();
    const returnData: NodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        // 獲取參數
        const priceId = context.getNodeParameter('priceId', itemIndex) as string;
        const targetPrice = parseFloat(context.getNodeParameter('targetPrice', itemIndex) as string);
        const condition = context.getNodeParameter('condition', itemIndex) as 'above' | 'below' | 'equal';
        const hermesEndpoint = context.getNodeParameter('hermesEndpoint', itemIndex, 'https://hermes.pyth.network') as string;
        const timeout = parseInt(context.getNodeParameter('timeout', itemIndex, '300') as string);

        // 使用可復用的 monitorPrice 工具函數
        const priceReached = await monitorPrice({
          priceId,
          targetPrice,
          condition,
          hermesEndpoint,
          timeout,
          onPriceUpdate: (currentPrice) => {
            console.log(`Current price: ${currentPrice}, Target: ${targetPrice}, Condition: ${condition}`);
          }
        });

        // 價格達到目標，觸發後續節點
        returnData.push({
          json: {
            success: true,
            triggered: priceReached.triggered,
            currentPrice: priceReached.currentPrice,
            targetPrice: priceReached.targetPrice,
            condition: priceReached.condition,
            priceId: priceReached.priceId,
            timestamp: priceReached.timestamp,
            message: `Price ${condition} ${targetPrice} reached at ${priceReached.currentPrice}`
          }
        });

      } catch (error) {
        // 錯誤處理
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        returnData.push({
          json: {
            success: false,
            triggered: false,
            error: errorMessage,
            priceId: context.getNodeParameter('priceId', itemIndex),
            targetPrice: context.getNodeParameter('targetPrice', itemIndex),
            condition: context.getNodeParameter('condition', itemIndex)
          }
        });
      }
    }

    return [returnData];
  }
}
