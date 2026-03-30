import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseJwtVerifierService } from './supabase-jwt-verifier.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SupabaseJwtVerifierService],
  exports: [AuthService, SupabaseJwtVerifierService],
})
export class AuthModule {}
