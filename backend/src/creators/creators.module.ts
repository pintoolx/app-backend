import { Module } from '@nestjs/common';
import { CreatorSubscriptionsModule } from '../creator-subscriptions/creator-subscriptions.module';
import { StrategiesModule } from '../strategies/strategies.module';
import { CreatorsController } from './creators.controller';
import { CreatorsService } from './creators.service';

@Module({
  imports: [CreatorSubscriptionsModule, StrategiesModule],
  controllers: [CreatorsController],
  providers: [CreatorsService],
})
export class CreatorsModule {}
