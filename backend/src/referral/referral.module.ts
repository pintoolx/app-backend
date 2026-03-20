import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';
import { ReferralCodeGeneratorService } from './referral-code-generator.service';

@Module({
  imports: [AuthModule],
  controllers: [ReferralController],
  providers: [ReferralService, ReferralCodeGeneratorService],
  exports: [ReferralService],
})
export class ReferralModule {}
