import { Module } from '@nestjs/common';
import { X402Controller } from './x402.controller';
import { X402Service } from './x402.service';

/**
 * X402 Payment Module
 *
 * Provides x402 payment protocol functionality for the application.
 * Includes service for payment processing and controller for demo endpoints.
 */
@Module({
  controllers: [X402Controller],
  providers: [X402Service],
  exports: [X402Service], // Export service for use in other modules
})
export class X402Module {}
