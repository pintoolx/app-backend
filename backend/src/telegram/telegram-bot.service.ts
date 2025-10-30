import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramBot } from 'typescript-telegram-bot-api';
import { SupabaseService } from '../database/supabase.service';

@Injectable()
export class TelegramBotService {
  private bot: TelegramBot;

  constructor(
    private configService: ConfigService,
    @Inject(forwardRef(() => SupabaseService))
    private supabaseService: SupabaseService,
  ) {
    const token = this.configService.get<string>('telegram.botToken');

    if (token) {
      this.bot = new TelegramBot({ botToken: token });
      this.setupCommands();
      console.log('✅ Telegram Bot initialized');
    }
  }

  private setupCommands() {
    this.bot.on('message', async (message) => {
      const chatId = message.chat.id.toString();
      const text = message.text;

      if (text === '/start') {
        await this.handleStartCommand(chatId);
      } else if (text?.startsWith('/link ')) {
        const walletAddress = text.replace('/link ', '').trim();
        await this.handleLinkWallet(chatId, walletAddress);
      } else if (text === '/unlink') {
        await this.handleUnlinkWallet(chatId);
      } else if (text === '/status') {
        await this.handleStatusCommand(chatId);
      }
    });
  }

  private async handleStartCommand(chatId: string) {
    const message = `
🎉 Welcome to PinTool Workflow Notification Bot!

Please link your wallet using:
\`/link YOUR_WALLET_ADDRESS\`

Example:
\`/link 7xKgF2p3VQa...\`

After linking, you'll receive real-time workflow execution notifications.
    `.trim();

    await this.bot.sendMessage({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    });
  }

  private async handleLinkWallet(chatId: string, walletAddress: string) {
    try {
      if (!this.isValidSolanaAddress(walletAddress)) {
        await this.bot.sendMessage({
          chat_id: chatId,
          text: '❌ Invalid wallet address. Please provide a valid Solana wallet address.',
        });
        return;
      }

      const { data: user } = await this.supabaseService.client
        .from('users')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single();

      if (!user) {
        await this.bot.sendMessage({
          chat_id: chatId,
          text: '❌ Wallet not found. Please register on PinTool platform first.',
        });
        return;
      }

      const { error } = await this.supabaseService.client.from('telegram_mappings').upsert({
        wallet_address: walletAddress,
        chat_id: chatId,
        notifications_enabled: true,
        linked_at: new Date().toISOString(),
      });

      if (error) throw error;

      await this.bot.sendMessage({
        chat_id: chatId,
        text: `✅ Successfully linked!\n\nWallet: \`${walletAddress}\`\n\nYou will now receive workflow notifications.`,
        parse_mode: 'Markdown',
      });

      console.log(`✅ Wallet linked: ${walletAddress} → ${chatId}`);
    } catch (error) {
      console.error('❌ Link wallet error:', error);
      await this.bot.sendMessage({
        chat_id: chatId,
        text: '❌ Failed to link wallet. Please try again later.',
      });
    }
  }

  private async handleUnlinkWallet(chatId: string) {
    const { error } = await this.supabaseService.client
      .from('telegram_mappings')
      .delete()
      .eq('chat_id', chatId);

    if (error) {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: '❌ Failed to unlink wallet.',
      });
      return;
    }

    await this.bot.sendMessage({
      chat_id: chatId,
      text: '✅ Wallet unlinked successfully.',
    });

    console.log(`✅ Wallet unlinked for chat: ${chatId}`);
  }

  private async handleStatusCommand(chatId: string) {
    const { data: mapping } = await this.supabaseService.client
      .from('telegram_mappings')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    if (!mapping) {
      await this.bot.sendMessage({
        chat_id: chatId,
        text: '❌ No wallet linked. Use /link command to link your wallet.',
      });
      return;
    }

    const statusText = `
📊 Your Status

Wallet: \`${mapping.wallet_address}\`
Notifications: ${mapping.notifications_enabled ? '✅ Enabled' : '❌ Disabled'}
Linked: ${new Date(mapping.linked_at).toLocaleString('en-US')}
    `.trim();

    await this.bot.sendMessage({
      chat_id: chatId,
      text: statusText,
      parse_mode: 'Markdown',
    });
  }

  private isValidSolanaAddress(address: string): boolean {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }

  async startBot() {
    const webhookUrl = this.configService.get<string>('telegram.webhookUrl');

    if (webhookUrl) {
      await this.bot.setWebhook({ url: webhookUrl });
      console.log(`✅ Telegram webhook set: ${webhookUrl}`);
    } else {
      await this.bot.startPolling();
      console.log('✅ Telegram bot started (polling mode)');
    }
  }

  handleUpdate(update: any) {
    // Handle webhook update
    this.bot.processUpdate(update);
  }
}
