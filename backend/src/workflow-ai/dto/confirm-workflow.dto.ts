import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ConfirmWorkflowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  telegramChatId?: string;
}
