import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { TelegramBotService } from './telegram-bot.service';

@ApiTags('Telegram')
@Controller('telegram')
export class TelegramController {
  constructor(private telegramBotService: TelegramBotService) {}

  @Post('webhook')
  @ApiExcludeEndpoint() // Hide from Swagger UI as this is for Telegram internal use
  @ApiOperation({
    summary: 'Telegram webhook endpoint',
    description:
      'Internal endpoint for receiving updates from Telegram Bot API. ' +
      'This endpoint should be configured in Telegram Bot settings.',
  })
  @ApiResponse({
    status: 200,
    description: 'Update received successfully',
    schema: {
      example: {
        ok: true,
      },
    },
  })
  async handleWebhook(@Body() update: any) {
    this.telegramBotService.handleUpdate(update);
    return { ok: true };
  }
}
