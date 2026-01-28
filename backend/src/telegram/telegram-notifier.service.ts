import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramBot } from 'typescript-telegram-bot-api';

@Injectable()
export class TelegramNotifierService {
  private bot: TelegramBot;
  private enabled: boolean;

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

    try {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      });
      console.log(`✅ Workflow start notification sent to ${chatId}`);
    } catch (error) {
      console.error('❌ Failed to send Telegram notification:', error.message);
    }
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

    try {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      });
      console.log(`✅ Node execution notification sent: ${nodeName}`);
    } catch (error) {
      console.error('❌ Failed to send node notification:', error.message);
    }
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

    try {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      });
      console.log(`✅ Workflow complete notification sent`);
    } catch (error) {
      console.error('❌ Failed to send completion notification:', error.message);
    }
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

    try {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      });
      console.log(`✅ Error notification sent`);
    } catch (error) {
      console.error('❌ Failed to send error notification:', error.message);
    }
  }

  private getNodeTypeEmoji(nodeType: string): string {
    const emojiMap = {
      pythPriceFeed: '📊',
      jupiterSwap: '🔄',
      kamino: '🏦',
    };
    return emojiMap[nodeType] || '🔧';
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
