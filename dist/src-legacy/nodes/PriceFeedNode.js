import { monitorPrice } from '../utils/price-monitor';
export class PriceFeedNode {
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
                displayName: '',
                name: 'priceId',
                type: 'string',
                default: '',
                description: 'Pyth price feed ID to monitor (e.g., SOL/USD feed ID)'
            },
            {
                displayName: 'Target Price',
                name: 'targetPrice',
                type: 'string',
                default: '0',
                description: 'Target price to trigger the workflow'
            },
            {
                displayName: 'Condition',
                name: 'condition',
                type: 'options',
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
                type: 'string',
                default: 'https://hermes.pyth.network',
                description: 'Pyth Hermes endpoint URL'
            }
        ]
    };
    async execute(context) {
        const items = context.getInputData();
        const returnData = [];
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                // 獲取參數
                const ticker = context.getNodeParameter('priceId', itemIndex);
                const targetPrice = parseFloat(context.getNodeParameter('targetPrice', itemIndex));
                const condition = context.getNodeParameter('condition', itemIndex);
                const hermesEndpoint = context.getNodeParameter('hermesEndpoint', itemIndex, 'https://hermes.pyth.network');
                // 使用可復用的 monitorPrice 工具函數
                const priceReached = await monitorPrice({
                    ticker: ticker,
                    targetPrice,
                    condition,
                    hermesEndpoint,
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
                        ticker: priceReached.ticker,
                        timestamp: priceReached.timestamp,
                        message: `Price ${condition} ${targetPrice} reached at ${priceReached.currentPrice}`
                    }
                });
            }
            catch (error) {
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
//# sourceMappingURL=PriceFeedNode.js.map