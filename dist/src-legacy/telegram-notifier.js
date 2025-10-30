import { TelegramBot } from 'typescript-telegram-bot-api';
/**
 * Telegram 通知服務
 * 用於在 workflow 執行過程中發送通知
 */
export class TelegramNotifier {
    bot;
    chatId;
    enabled;
    constructor(config) {
        this.enabled = config?.enabled ?? false;
        if (config && config.botToken && config.chatId) {
            try {
                this.bot = new TelegramBot({ botToken: config.botToken });
                this.chatId = config.chatId;
                this.enabled = true;
            }
            catch (error) {
                console.warn('⚠️  Failed to initialize Telegram bot:', error);
                this.enabled = false;
            }
        }
    }
    /**
     * 檢查通知服務是否已啟用
     */
    isEnabled() {
        return this.enabled && !!this.bot && !!this.chatId;
    }
    /**
     * 發送節點執行結果通知
     */
    async sendNodeExecutionResult(nodeName, nodeType, result, success = true) {
        if (!this.isEnabled()) {
            return;
        }
        try {
            const status = success ? '✅' : '❌';
            const resultPreview = this.formatResult(result);
            const message = `${status} **Node Execution Result**\n\n` +
                `**Node:** ${nodeName}\n` +
                `**Type:** ${nodeType}\n` +
                `**Status:** ${success ? 'Success' : 'Failed'}\n\n` +
                `**Result:**\n\`\`\`json\n${resultPreview}\n\`\`\``;
            await this.bot.sendMessage({
                chat_id: this.chatId,
                text: message,
                parse_mode: 'Markdown',
            });
        }
        catch (error) {
            console.error('Failed to send Telegram notification:', error);
        }
    }
    /**
     * 發送自定義訊息
     */
    async sendMessage(message) {
        if (!this.isEnabled()) {
            return;
        }
        try {
            await this.bot.sendMessage({
                chat_id: this.chatId,
                text: message,
                parse_mode: 'Markdown',
            });
        }
        catch (error) {
            console.error('Failed to send Telegram message:', error);
        }
    }
    /**
     * 發送 Workflow 開始通知
     */
    async sendWorkflowStart(workflowName) {
        if (!this.isEnabled()) {
            return;
        }
        const message = `🚀 **Workflow Started**\n\n` +
            (workflowName ? `Name: ${workflowName}\n` : '') +
            `Time: ${new Date().toISOString()}`;
        await this.sendMessage(message);
    }
    /**
     * 發送 Workflow 完成通知
     */
    async sendWorkflowComplete(totalNodes, duration) {
        if (!this.isEnabled()) {
            return;
        }
        const message = `✅ **Workflow Completed**\n\n` +
            `Total Nodes: ${totalNodes}\n` +
            (duration ? `Duration: ${duration}ms\n` : '') +
            `Time: ${new Date().toISOString()}`;
        await this.sendMessage(message);
    }
    /**
     * 發送 Workflow 錯誤通知
     */
    async sendWorkflowError(nodeName, error) {
        if (!this.isEnabled()) {
            return;
        }
        const message = `❌ **Workflow Error**\n\n` +
            `**Failed Node:** ${nodeName}\n` +
            `**Error:** ${error.message}\n\n` +
            `**Stack:**\n\`\`\`\n${error.stack?.substring(0, 500) || 'N/A'}\n\`\`\``;
        await this.sendMessage(message);
    }
    /**
     * 格式化執行結果為可讀的字串
     */
    formatResult(result) {
        try {
            const jsonStr = JSON.stringify(result, null, 2);
            // 限制長度，避免訊息過長
            if (jsonStr.length > 1000) {
                return jsonStr.substring(0, 1000) + '\n...(truncated)';
            }
            return jsonStr;
        }
        catch (error) {
            return String(result);
        }
    }
}
/**
 * 從環境變數建立 Telegram 通知服務
 */
export function createTelegramNotifierFromEnv() {
    // 从环境变量读取配置
    const botToken = process.env['TELEGRAM_BOT_TOKEN'];
    const chatId = process.env['TELEGRAM_CHAT_ID'];
    const enabled = process.env['TELEGRAM_NOTIFY_ENABLED'] === 'true';
    // 如果没有配置，返回未启用的通知器
    if (!botToken || !chatId || !enabled) {
        return new TelegramNotifier();
    }
    const config = {
        botToken,
        chatId,
        enabled: true,
    };
    return new TelegramNotifier(config);
}
//# sourceMappingURL=telegram-notifier.js.map