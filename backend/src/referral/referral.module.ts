import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';
import { ReferralCodeGeneratorService } from './referral-code-generator.service';

@Module({
  // AuthModule is imported to provide SupabaseJwtVerifierService (used by JwtAuthGuard)
  imports: [AuthModule],
  controllers: [ReferralController],
  providers: [ReferralService, ReferralCodeGeneratorService],
  exports: [ReferralService],
})
export class ReferralModule {}
