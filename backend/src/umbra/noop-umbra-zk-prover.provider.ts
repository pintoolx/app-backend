import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type UmbraZkProverProviderPort,
  type UmbraZkProverSuite,
} from './umbra-zk-prover.port';

/**
 * Default Phase-5 provider. Returns `null` until production wiring lands:
 *
 * - `getZkProverSuite()` requires loading Groth16 zkey + WASM circuit
 *   files for `ReceiverClaimableUtxo` and `ClaimReceiverClaimableUtxo`
 *   (4 batch-size variants). Until those artifacts are available, the
 *   transfer surface short-circuits with a clear "not configured" status.
 * - `getRelayer()` reads `UMBRA_RELAYER_ENDPOINT`. When set, lazily builds
 *   an `IUmbraRelayer` via `getUmbraRelayer({ apiEndpoint })` so the
 *   submit/poll plumbing is ready even if zkProvers are still missing.
 */
@Injectable()
export class NoopUmbraZkProverProvider implements UmbraZkProverProviderPort {
  private readonly logger = new Logger(NoopUmbraZkProverProvider.name);
  private cachedRelayer: unknown | null = null;

  constructor(private readonly configService: ConfigService) {}

  async getZkProverSuite(): Promise<UmbraZkProverSuite | null> {
    this.logger.debug(
      'Umbra zkProver suite not configured (returning null). Set UMBRA_TRANSFER_ENABLED=true and provide a real provider before invoking confidential transfers.',
    );
    return null;
  }

  async getRelayer(): Promise<unknown | null> {
    const apiEndpoint = this.configService.get<string>('UMBRA_RELAYER_ENDPOINT');
    if (!apiEndpoint) {
      this.logger.debug(
        'UMBRA_RELAYER_ENDPOINT not set; relayer-backed flows unavailable.',
      );
      return null;
    }
    if (this.cachedRelayer) return this.cachedRelayer;
    try {
      // Lazy import so dev environments without UMBRA_ENABLED still build
      // without exercising the SDK's heavy module graph.
      const sdk = await import('@umbra-privacy/sdk');
      const factory = (sdk as Record<string, unknown>).getUmbraRelayer as
        | ((args: { apiEndpoint: string }) => unknown)
        | undefined;
      if (typeof factory !== 'function') {
        this.logger.warn(
          '@umbra-privacy/sdk does not export getUmbraRelayer; skipping relayer build.',
        );
        return null;
      }
      this.cachedRelayer = factory({ apiEndpoint });
      this.logger.log(`Umbra relayer initialised endpoint=${apiEndpoint}`);
      return this.cachedRelayer;
    } catch (err) {
      this.logger.warn(
        `Failed to build Umbra relayer from endpoint=${apiEndpoint}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return null;
    }
  }
}
