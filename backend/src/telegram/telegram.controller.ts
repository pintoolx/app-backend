import { Controller, Post, Body, Headers, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { TelegramBotService } from './telegram-bot.service';

@ApiTags('Telegram')
@Controller('telegram')
export class TelegramController {
  constructor(
    private telegramBotService: TelegramBotService,
    private configService: ConfigService,
  ) {}

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
  async handleWebhook(
    @Headers('x-telegram-bot-api-secret-token') secretToken: string,
    @Body() update: any,
  ) {
    const expectedSecret = this.configService.get<string>('telegram.webhookSecret');
    if (expectedSecret && secretToken !== expectedSecret) {
      throw new ForbiddenException('Invalid secret token');
    }

    this.telegramBotService.handleUpdate(update);
    return { ok: true };
  }
}
