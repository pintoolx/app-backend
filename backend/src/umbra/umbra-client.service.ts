import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getUmbraClient,
  createSignerFromPrivateKeyBytes,
} from '@umbra-privacy/sdk';
import { KeeperKeypairService } from '../onchain/keeper-keypair.service';

/**
 * Manages the Umbra SDK client lifecycle for the platform.
 *
 * The platform keeper keypair is used as the Umbra signer. The SDK handles
 * master seed derivation internally via wallet-signed consent message
 * (KMAC256). The client is lazy-initialised on first use and cached for the
 * process lifetime.
 *
 * All deployments registered through this client share the same Umbra
 * identity (same X25519 key pair) but have separate Encrypted Token Accounts
 * (ETAs) differentiated by mint.
 */
@Injectable()
export class UmbraClientService {
  private readonly logger = new Logger(UmbraClientService.name);
  private client: unknown = null;
  private signerAddress: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly keeperService: KeeperKeypairService,
  ) {}

  isEnabled(): boolean {
    return this.configService.get<string>('UMBRA_ENABLED') === 'true';
  }

  async getClient(): Promise<unknown> {
    if (this.client) return this.client;

    const keeper = await this.keeperService.loadKeypair();
    // Keeper secretKey is 64 bytes: [seed(32) | pubkey(32)]
    const privateKeyBytes = keeper.secretKey.slice(0, 32);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const signer = await createSignerFromPrivateKeyBytes(privateKeyBytes);
    this.signerAddress = (signer as { address?: string }).address ?? null;

    const network = (this.configService.get<string>('UMBRA_NETWORK') ?? 'mainnet') as
      | 'mainnet'
      | 'devnet'
      | 'localnet';
    const rpcUrl =
      this.configService.get<string>('SOLANA_RPC_URL') ?? 'https://api.mainnet-beta.solana.com';
    const rpcSubscriptionsUrl =
      this.configService.get<string>('SOLANA_WS_URL') ?? 'wss://api.mainnet-beta.solana.com';

    const indexerApiEndpoint =
      this.configService.get<string>('UMBRA_INDEXER_API_ENDPOINT') ??
      (network === 'mainnet'
        ? 'https://utxo-indexer.api.umbraprivacy.com'
        : 'https://utxo-indexer.api-devnet.umbraprivacy.com');

    this.logger.log(
      `Initialising Umbra client — network=${network} signer=${this.signerAddress ?? 'unknown'}`,
    );

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.client = await getUmbraClient({
        signer,
        network,
        rpcUrl,
        rpcSubscriptionsUrl,
        indexerApiEndpoint,
      } as Parameters<typeof getUmbraClient>[0]);
      this.logger.log('Umbra client initialised successfully');
      return this.client;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to initialise Umbra client: ${msg}`);
      throw new InternalServerErrorException(`Umbra client init failed: ${msg}`);
    }
  }

  getSignerAddress(): string | null {
    return this.signerAddress;
  }
}
