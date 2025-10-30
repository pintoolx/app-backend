import { IsString, IsBoolean, IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorkflowDto {
  @ApiProperty({
    description: 'Workflow name',
    example: 'SOL Price Monitor & Swap',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Workflow description',
    example: 'Monitor SOL price and execute swap when price reaches target',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Workflow definition (nodes and connections)',
    example: {
      nodes: [
        {
          id: 'node-1',
          type: 'pythPriceFeed',
          name: 'SOL Price Feed',
          parameters: {
            priceId: 'SOL',
            targetPrice: '100',
            condition: 'above',
          },
          telegramNotify: true,
        },
      ],
      connections: {
        'node-1': {
          main: [[{ node: 'node-2', type: 'main', index: 0 }]],
        },
      },
    },
  })
  @IsObject()
  definition: any;

  @ApiPropertyOptional({
    description: 'Whether the workflow is active',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Telegram chat ID for notifications',
    example: '123456789',
  })
  @IsString()
  @IsOptional()
  telegramChatId?: string;
}
