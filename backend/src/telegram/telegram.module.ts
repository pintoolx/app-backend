import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramNotifierService } from './telegram-notifier.service';
import { TelegramController } from './telegram.controller';

@Module({
  controllers: [TelegramController],
  providers: [TelegramBotService, TelegramNotifierService],
  exports: [TelegramNotifierService, TelegramBotService],
})
export class TelegramModule {
  constructor(private telegramBotService: TelegramBotService) {}

  async onModuleInit() {
    await this.telegramBotService.startBot();
  }
}
