/**
 * Telegram 通知配置接口
 */
export interface TelegramConfig {
    botToken: string;
    chatId: string | number;
    enabled?: boolean;
}
/**
 * Telegram 通知服務
 * 用於在 workflow 執行過程中發送通知
 */
export declare class TelegramNotifier {
    private bot?;
    private chatId?;
    private enabled;
    constructor(config?: TelegramConfig);
    /**
     * 檢查通知服務是否已啟用
     */
    isEnabled(): boolean;
    /**
     * 發送節點執行結果通知
     */
    sendNodeExecutionResult(nodeName: string, nodeType: string, result: any, success?: boolean): Promise<void>;
    /**
     * 發送自定義訊息
     */
    sendMessage(message: string): Promise<void>;
    /**
     * 發送 Workflow 開始通知
     */
    sendWorkflowStart(workflowName?: string): Promise<void>;
    /**
     * 發送 Workflow 完成通知
     */
    sendWorkflowComplete(totalNodes: number, duration?: number): Promise<void>;
    /**
     * 發送 Workflow 錯誤通知
     */
    sendWorkflowError(nodeName: string, error: Error): Promise<void>;
    /**
     * 格式化執行結果為可讀的字串
     */
    private formatResult;
}
/**
 * 從環境變數建立 Telegram 通知服務
 */
export declare function createTelegramNotifierFromEnv(): TelegramNotifier;
