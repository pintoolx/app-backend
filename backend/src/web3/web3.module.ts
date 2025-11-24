import { Module } from '@nestjs/common';
import { ConnectionService } from './services/connection.service';
import { X402ClientService } from './services/x402-client.service';
import { DatabaseModule } from '../database/database.module';
import { EncryptionModule } from '../encryption/encryption.module';

@Module({
  imports: [DatabaseModule, EncryptionModule],
  providers: [ConnectionService, X402ClientService],
  exports: [ConnectionService, X402ClientService],
})
export class Web3Module { }
