import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreatorSubscriptionsController } from './creator-subscriptions.controller';
import { CreatorSubscriptionsRepository } from './creator-subscriptions.repository';
import { CreatorSubscriptionsService } from './creator-subscriptions.service';

@Module({
  imports: [AuthModule],
  controllers: [CreatorSubscriptionsController],
  providers: [CreatorSubscriptionsService, CreatorSubscriptionsRepository],
  exports: [CreatorSubscriptionsService, CreatorSubscriptionsRepository],
})
export class CreatorSubscriptionsModule {}
