import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ description: 'User message to send to the AI', example: '幫我建一個每小時檢查 SOL 價格的 workflow' })
  @IsString()
  @IsNotEmpty()
  message: string;
}
