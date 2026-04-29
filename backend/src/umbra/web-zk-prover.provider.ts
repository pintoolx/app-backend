import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type UmbraZkProverProviderPort,
  type UmbraZkProverSuite,
} from './umbra-zk-prover.port';

/**
 * Production Phase-5 provider, backed by `@umbra-privacy/web-zk-prover`.
 *
 * The official package wraps `snarkjs` + the Umbra Groth16 circuits and
 * (by default) fetches the `.zkey` / `.wasm` artefacts from Umbra's CDN
 * via `getCdnZkAssetProvider()`. That gives us a fully working zkProver
 * suite without needing to host the circuit artefacts ourselves.
 *
 * Relayer is built from `UMBRA_RELAYER_ENDPOINT` (Umbra's hosted relayer
 * for production: `https://relayer.api.umbraprivacy.com`).
 *
 * Imports are lazy so dev/test workloads that never enable confidential
 * transfer never pull the snarkjs runtime onto the require graph.
 *
 * To enable in `umbra.module.ts`, replace
 * `useExisting: NoopUmbraZkProverProvider` with this class:
 *
 * ```ts
 * { provide: UMBRA_ZK_PROVER_PROVIDER, useExisting: WebZkProverProvider }
 * ```
 */
@Injectable()
export class WebZkProverProvider implements UmbraZkProverProviderPort {
  private readonly logger = new Logger(WebZkProverProvider.name);
  private cachedSuite: UmbraZkProverSuite | null = null;
  private cachedRelayer: unknown | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Build (and cache) the two provers we need today: receiver-claimable
   * UTXO creator + receiver-claim into encrypted balance. Both use the
   * default CDN asset provider so no further configuration is required.
   *
   * Add more provers to the suite as the platform exercises additional
   * flows (e.g. self-claimable, claim into public balance).
   */
  async getZkProverSuite(): Promise<UmbraZkProverSuite | null> {
    if (this.cachedSuite) return this.cachedSuite;
    try {
      const sdk = (await import('@umbra-privacy/web-zk-prover')) as Record<
        string,
        unknown
      >;
      const utxoCreatorFactory =
        sdk.getCreateReceiverClaimableUtxoFromEncryptedBalanceProver as
          | (() => unknown)
          | undefined;
      const claimerFactory =
        sdk.getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver as
          | (() => unknown)
          | undefined;
      if (typeof utxoCreatorFactory !== 'function' || typeof claimerFactory !== 'function') {
        this.logger.warn(
          '@umbra-privacy/web-zk-prover does not export expected factories; falling back to null suite.',
        );
        return null;
      }
      this.cachedSuite = {
        utxoReceiverClaimable: utxoCreatorFactory(),
        claimReceiverClaimableIntoEncryptedBalance: claimerFactory(),
      };
      this.logger.log(
        'Umbra zkProver suite initialised (web-zk-prover, CDN asset provider).',
      );
      return this.cachedSuite;
    } catch (err) {
      this.logger.error(
        `Failed to initialise Umbra zkProver suite: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /**
   * Lazy-build the `IUmbraRelayer`. Reads `UMBRA_RELAYER_ENDPOINT` from
   * env so we don't need a different binary for devnet vs mainnet \u2014
   * just point the env var at the right relayer URL.
   */
  async getRelayer(): Promise<unknown | null> {
    if (this.cachedRelayer) return this.cachedRelayer;
    const apiEndpoint = this.configService.get<string>('UMBRA_RELAYER_ENDPOINT');
    if (!apiEndpoint) {
      this.logger.warn(
        'UMBRA_RELAYER_ENDPOINT not set; transfer claim flow will short-circuit.',
      );
      return null;
    }
    try {
      const sdk = (await import('@umbra-privacy/sdk')) as Record<string, unknown>;
      const factory = sdk.getUmbraRelayer as
        | ((args: { apiEndpoint: string }) => unknown)
        | undefined;
      if (typeof factory !== 'function') {
        this.logger.warn(
          '@umbra-privacy/sdk does not export getUmbraRelayer; cannot build relayer.',
        );
        return null;
      }
      this.cachedRelayer = factory({ apiEndpoint });
      this.logger.log(`Umbra relayer initialised endpoint=${apiEndpoint}`);
      return this.cachedRelayer;
    } catch (err) {
      this.logger.error(
        `Failed to initialise Umbra relayer: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
