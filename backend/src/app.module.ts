import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { EncryptionModule } from './encryption/encryption.module';
import { AuthModule } from './auth/auth.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { TelegramModule } from './telegram/telegram.module';
import { Web3Module } from './web3/web3.module';
import { X402Module } from './x402/x402.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    EncryptionModule,
    AuthModule,
    WorkflowsModule,
    TelegramModule,
    Web3Module,
    X402Module,
  ],
})
export class AppModule {}
