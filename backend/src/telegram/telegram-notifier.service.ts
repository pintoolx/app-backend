import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramBot } from 'typescript-telegram-bot-api';

@Injectable()
export class TelegramNotifierService {
  private bot: TelegramBot;
  private enabled: boolean;
  private queue: Array<{ chatId: string; text: string; parse_mode: 'Markdown' }> = [];
  private processingTimer: NodeJS.Timeout | null = null;
  private lastSentAt = 0;
  private readonly MIN_INTERVAL_MS = 250;

  constructor(private configService: ConfigService) {
    const token = this.configService.get<string>('telegram.botToken');
    this.enabled = this.configService.get<boolean>('telegram.notifyEnabled', false);

    if (this.enabled && token) {
      this.bot = new TelegramBot({ botToken: token });
      console.log('✅ Telegram notifier initialized');
    } else {
      console.log('⚠️  Telegram notifications disabled');
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async sendWorkflowStartNotification(chatId: string, workflowName: string, executionId: string) {
    if (!this.enabled || !chatId) return;

    const message = `
🚀 *Workflow Started*

Name: ${workflowName}
Execution ID: \`${executionId}\`
Time: ${new Date().toLocaleString('en-US')}
    `.trim();

    this.enqueueMessage(chatId, message);
  }

  async sendNodeExecutionNotification(
    chatId: string,
    nodeName: string,
    nodeType: string,
    result: any,
  ) {
    if (!this.enabled || !chatId) return;

    let message = `✅ *Node Completed*\n\n`;
    message += `Node: ${nodeName}\n`;
    message += `Type: ${this.getNodeTypeEmoji(nodeType)} ${nodeType}\n`;

    if (nodeType === 'pythPriceFeed') {
      message += `\nPrice: $${result.price}\n`;
      message += `Triggered: ${result.triggered ? '✅ Yes' : '❌ No'}`;
    } else if (nodeType === 'jupiterSwap') {
      message += `\nSwap: ${result.inputAmount} ${result.inputToken} → ${result.outputAmount} ${result.outputToken}\n`;
      message += `TX: \`${result.transactionSignature}\``;
    } else if (nodeType === 'kamino') {
      message += `\nOperation: ${result.operation === 'deposit' ? 'Deposit' : 'Withdraw'}\n`;
      message += `Amount: ${result.amount}\n`;
      message += `TX: \`${result.transactionSignature}\``;
    }

    this.enqueueMessage(chatId, message);
  }

  async sendWorkflowCompleteNotification(
    chatId: string,
    workflowName: string,
    executionId: string,
  ) {
    if (!this.enabled || !chatId) return;

    const message = `
✅ *Workflow Completed*

Name: ${workflowName}
Execution ID: \`${executionId}\`
Completed: ${new Date().toLocaleString('en-US')}

All nodes executed successfully.
    `.trim();

    this.enqueueMessage(chatId, message);
  }

  async sendWorkflowErrorNotification(
    chatId: string,
    workflowName: string,
    executionId: string,
    error: string,
  ) {
    if (!this.enabled || !chatId) return;

    const message = `
❌ *Workflow Failed*

Name: ${workflowName}
Execution ID: \`${executionId}\`
Failed: ${new Date().toLocaleString('en-US')}

Error:
\`\`\`
${error}
\`\`\`
    `.trim();

    this.enqueueMessage(chatId, message);
  }

  private getNodeTypeEmoji(nodeType: string): string {
    const emojiMap = {
      pythPriceFeed: '📊',
      jupiterSwap: '🔄',
      kamino: '🏦',
    };
    return emojiMap[nodeType] || '🔧';
  }

  private enqueueMessage(chatId: string, message: string) {
    if (!this.enabled || !chatId) return;
    this.queue.push({ chatId, text: message, parse_mode: 'Markdown' });
    this.scheduleProcessing();
  }

  private scheduleProcessing() {
    if (this.processingTimer) return;
    const delay = Math.max(0, this.MIN_INTERVAL_MS - (Date.now() - this.lastSentAt));
    this.processingTimer = setTimeout(() => {
      this.processingTimer = null;
      this.processQueue();
    }, delay);
  }

  private async processQueue() {
    if (this.queue.length === 0) {
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      return;
    }

    try {
      await this.bot.sendMessage({
        chat_id: next.chatId,
        text: next.text,
        parse_mode: next.parse_mode,
      });
      this.lastSentAt = Date.now();
    } catch (error) {
      console.error('❌ Failed to send Telegram notification:', error.message);
      this.lastSentAt = Date.now();
    } finally {
      if (this.queue.length > 0) {
        this.scheduleProcessing();
      }
    }
  }

  // Wrapper methods for compatibility with WorkflowExecutor
  async sendWorkflowStart(workflowName: string) {
    // For executor, we don't have chatId yet, so this is a no-op
    // In actual use, chatId will be passed from workflows.service
    console.log(`⚙️ Workflow started: ${workflowName}`);
  }

  async sendWorkflowComplete(nodeCount: number, duration: number) {
    console.log(`✅ Workflow completed: ${nodeCount} nodes in ${duration}ms`);
  }

  async sendWorkflowError(context: string, error: Error) {
    console.error(`❌ Workflow error in ${context}:`, error.message);
  }

  async sendNodeExecutionResult(nodeName: string, nodeType: string, _result: any) {
    console.log(`✅ Node executed: ${nodeName} (${nodeType})`);
  }
}
