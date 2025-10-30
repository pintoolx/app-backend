import { Pyth_Price_Feed_ID } from './constant';
export type TokenTicker = keyof typeof Pyth_Price_Feed_ID;
export interface PriceMonitorOptions {
    ticker: TokenTicker;
    targetPrice: number;
    condition: 'above' | 'below' | 'equal';
    hermesEndpoint?: string;
    onPriceUpdate?: (currentPrice: number) => void;
}
export interface PriceMonitorResult {
    triggered: boolean;
    currentPrice: number;
    targetPrice: number;
    condition: string;
    ticker: TokenTicker;
    timestamp: number;
}
/**
 * 监听价格并在达到目标时触发
 * @param options 监听配置选项
 * @returns Promise<PriceMonitorResult> 当价格达到目标时 resolve
 */
export declare function monitorPrice(options: PriceMonitorOptions): Promise<PriceMonitorResult>;
/**
 * 检查价格是否满足条件
 * @param currentPrice 当前价格
 * @param targetPrice 目标价格
 * @param condition 条件类型
 * @returns boolean 是否满足条件
 */
export declare function checkPriceCondition(currentPrice: number, targetPrice: number, condition: 'above' | 'below' | 'equal'): boolean;
/**
 * 简单的价格获取（非监听）
 * @param tickers TICKER 数组
 * @param hermesEndpoint Hermes 端点
 * @returns Promise 当前价格数据
 */
export declare function getCurrentPrices(tickers: TokenTicker[], hermesEndpoint?: string): Promise<Array<{
    ticker: string;
    price: number;
    expo: number;
}>>;
