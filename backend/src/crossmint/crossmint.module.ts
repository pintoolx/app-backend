import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CrossmintService } from './crossmint.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [ConfigModule, forwardRef(() => DatabaseModule)],
  providers: [CrossmintService],
  exports: [CrossmintService],
})
export class CrossmintModule {}
