import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AnchorProvider,
  Program,
  Wallet,
  Idl,
  type AnchorProvider as AnchorProviderType,
} from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Commitment } from '@solana/web3.js';
import { KeeperKeypairService } from './keeper-keypair.service';
import idlJson from './anchor/strategy_runtime.json';
import { type StrategyRuntime } from './anchor/strategy_runtime';

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_COMMITMENT: Commitment = 'confirmed';

/**
 * Manages the Solana RPC Connection, AnchorProvider and Program instance for
 * the strategy_runtime program. Lazy-loaded so the module stays cheap at boot
 * even when the Noop adapter is in use.
 */
@Injectable()
export class AnchorClientService {
  private readonly logger = new Logger(AnchorClientService.name);
  private programInstance: Program<StrategyRuntime> | null = null;
  private providerInstance: AnchorProviderType | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly keeperKeypairService: KeeperKeypairService,
  ) {}

  getProgramId(): PublicKey {
    const id = this.configService.get<string>('STRATEGY_RUNTIME_PROGRAM_ID');
    if (!id) {
      throw new InternalServerErrorException('STRATEGY_RUNTIME_PROGRAM_ID env var not configured');
    }
    try {
      return new PublicKey(id);
    } catch (err) {
      throw new InternalServerErrorException(`Invalid STRATEGY_RUNTIME_PROGRAM_ID: ${id}`);
    }
  }

  async getProgram(): Promise<Program<StrategyRuntime>> {
    if (this.programInstance) return this.programInstance;

    const keeper = await this.keeperKeypairService.loadKeypair();
    const provider = this.buildProvider(keeper);
    const programId = this.getProgramId();

    // Override the IDL's address with the configured program ID so we never
    // accidentally talk to the placeholder declared in the JSON artifact.
    const idl = { ...(idlJson as unknown as Idl), address: programId.toBase58() };

    this.programInstance = new Program<StrategyRuntime>(
      idl as unknown as StrategyRuntime,
      provider,
    );
    this.providerInstance = provider;
    this.logger.log(`Anchor strategy_runtime program initialised at ${programId.toBase58()}`);
    return this.programInstance;
  }

  async getProvider(): Promise<AnchorProviderType> {
    if (!this.providerInstance) await this.getProgram();
    return this.providerInstance!;
  }

  private buildProvider(keeper: Keypair): AnchorProviderType {
    const rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') ?? DEFAULT_RPC_URL;
    const commitment =
      (this.configService.get<string>('STRATEGY_RUNTIME_COMMITMENT') as Commitment | undefined) ??
      DEFAULT_COMMITMENT;
    const connection = new Connection(rpcUrl, commitment);
    const wallet = new Wallet(keeper);
    return new AnchorProvider(connection, wallet, {
      commitment,
      preflightCommitment: commitment,
    });
  }
}
