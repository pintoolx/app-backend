import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UmbraClientService } from './umbra-client.service';

/**
 * Umbra Deployment Signer Service — v2 SDK rewrite.
 *
 * Previously derived per-deployment Ed25519/X25519 keypairs from a static
 * UMBRA_MASTER_SEED. With the SDK integration, key derivation is handled
 * internally by @umbra-privacy/sdk via KMAC256(wallet_signature).
 *
 * This service now provides account-state querying and seed-source
 * introspection for the Admin Dashboard.
 */
@Injectable()
export class UmbraDeploymentSignerService {
  private readonly logger = new Logger(UmbraDeploymentSignerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly clientService: UmbraClientService,
  ) {}

  isConfigured(): boolean {
    return this.clientService.isEnabled();
  }

  getResolvedSource(): 'keeper' | null {
    return this.isConfigured() ? 'keeper' : null;
  }
}
