import { HermesClient } from '@pythnetwork/hermes-client';
import { Pyth_Price_Feed_ID } from './constant';
/**
 * 监听价格并在达到目标时触发
 * @param options 监听配置选项
 * @returns Promise<PriceMonitorResult> 当价格达到目标时 resolve
 */
export async function monitorPrice(options) {
    const { ticker, targetPrice, condition, hermesEndpoint = 'https://hermes.pyth.network', onPriceUpdate } = options;
    // 从 constant 中获取 priceId
    const priceId = Pyth_Price_Feed_ID[ticker];
    if (!priceId) {
        throw new Error(`Unknown ticker: ${ticker}. Please check src/utils/constant.ts for available tickers.`);
    }
    // 初始化 Hermes Client
    const hermesClient = new HermesClient(hermesEndpoint, {});
    return new Promise((resolve, reject) => {
        let eventSource;
        const cleanup = () => {
            if (eventSource) {
                eventSource.close();
            }
        };
        // 开始监听价格
        hermesClient.getPriceUpdatesStream([priceId])
            .then((es) => {
            eventSource = es;
            eventSource.onmessage = (event) => {
                try {
                    const priceUpdate = JSON.parse(event.data);
                    const priceData = priceUpdate.parsed[0].price;
                    const currentPrice = parseFloat(priceData.price) * Math.pow(10, priceData.expo);
                    // 调用回调函数（如果提供）
                    if (onPriceUpdate) {
                        onPriceUpdate(currentPrice);
                    }
                    // 检查是否达到目标价格
                    const conditionMet = checkPriceCondition(currentPrice, targetPrice, condition);
                    if (conditionMet) {
                        console.log(`Target price reached! Current: ${currentPrice}, Target: ${targetPrice}`);
                        cleanup();
                        resolve({
                            triggered: true,
                            currentPrice,
                            targetPrice,
                            condition,
                            ticker,
                            timestamp: Date.now()
                        });
                    }
                }
                catch (err) {
                    cleanup();
                    reject(err);
                }
            };
            eventSource.onerror = (error) => {
                cleanup();
                reject(new Error('Error receiving price updates from Hermes'));
            };
        })
            .catch((err) => {
            cleanup();
            reject(err);
        });
    });
}
/**
 * 检查价格是否满足条件
 * @param currentPrice 当前价格
 * @param targetPrice 目标价格
 * @param condition 条件类型
 * @returns boolean 是否满足条件
 */
export function checkPriceCondition(currentPrice, targetPrice, condition) {
    switch (condition) {
        case 'above':
            return currentPrice >= targetPrice;
        case 'below':
            return currentPrice <= targetPrice;
        case 'equal':
            // 使用 0.1% 容差来判断相等（因为浮点数比较）
            const tolerance = targetPrice * 0.001;
            return Math.abs(currentPrice - targetPrice) <= tolerance;
        default:
            return false;
    }
}
/**
 * 简单的价格获取（非监听）
 * @param tickers TICKER 数组
 * @param hermesEndpoint Hermes 端点
 * @returns Promise 当前价格数据
 */
export async function getCurrentPrices(tickers, hermesEndpoint = 'https://hermes.pyth.network') {
    const hermesClient = new HermesClient(hermesEndpoint, {});
    // 转换 tickers 为 priceIds
    const priceIds = tickers.map(ticker => {
        const priceId = Pyth_Price_Feed_ID[ticker];
        if (!priceId) {
            throw new Error(`Unknown ticker: ${ticker}`);
        }
        return priceId;
    });
    return new Promise((resolve, reject) => {
        const prices = [];
        hermesClient.getPriceUpdatesStream(priceIds)
            .then((eventSource) => {
            eventSource.onmessage = (event) => {
                try {
                    const priceUpdate = JSON.parse(event.data);
                    priceUpdate.parsed.forEach((p, index) => {
                        prices.push({
                            ticker: tickers[index],
                            price: parseFloat(p.price.price) * Math.pow(10, p.price.expo),
                            expo: p.price.expo
                        });
                    });
                    // 获取一次后立即关闭
                    eventSource.close();
                    resolve(prices);
                }
                catch (err) {
                    eventSource.close();
                    reject(err);
                }
            };
            eventSource.onerror = (error) => {
                eventSource.close();
                reject(new Error('Error receiving price updates'));
            };
        })
            .catch(reject);
    });
}
//# sourceMappingURL=price-monitor.js.map