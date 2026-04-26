import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { MagicBlockPerClientService } from './magicblock-per-client.service';
import { PerAuthTokensRepository } from './per-auth-tokens.repository';
import { PerGroupsRepository } from './per-groups.repository';
import {
  type MagicBlockPerAdapterPort,
  type PerAuthChallenge,
  type PerAuthChallengeParams,
  type PerAuthVerifyParams,
  type PerAuthVerifyResult,
  type PerCreateGroupParams,
  type PerCreateGroupResult,
  type PerPrivateStateParams,
  type PerPrivateStateResult,
} from './magicblock.port';

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_AUTH_TTL_MIN = 30;

interface PerCreateRemote {
  groupId?: string;
  signature?: string;
}

interface PerPrivateStateRemote {
  state?: Record<string, unknown> | null;
  logs?: Array<Record<string, unknown>>;
}

@Injectable()
export class MagicBlockPerRealAdapter implements MagicBlockPerAdapterPort {
  private readonly logger = new Logger(MagicBlockPerRealAdapter.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly perClient: MagicBlockPerClientService,
    private readonly groupsRepo: PerGroupsRepository,
    private readonly tokensRepo: PerAuthTokensRepository,
  ) {}

  async createPermissionGroup(params: PerCreateGroupParams): Promise<PerCreateGroupResult> {
    const remote = await this.perClient.post<PerCreateRemote>('/v1/groups', {
      deploymentId: params.deploymentId,
      members: params.members,
    });
    const groupId = remote?.groupId ?? `per-${params.deploymentId}`;
    const signature = remote?.signature ?? null;
    this.logger.log(`per.createPermissionGroup deployment=${params.deploymentId} group=${groupId}`);
    return { groupId, signature };
  }

  /**
   * Mints a server-side challenge nonce, persists it as a `challenge` row in
   * `per_auth_tokens` (so we can correlate the verify call), and returns the
   * raw nonce (base58) plus expiry.
   */
  async requestAuthChallenge(params: PerAuthChallengeParams): Promise<PerAuthChallenge> {
    const ttlMs = this.getChallengeTtlMs();
    const nonce = randomBytes(32);
    const challenge = bs58.encode(nonce);
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    const group = await this.groupsRepo.getByDeployment(params.deploymentId);
    await this.tokensRepo.insertChallenge({
      token: challenge,
      deploymentId: params.deploymentId,
      wallet: params.walletAddress,
      groupId: group?.group_id ?? null,
      expiresAt,
      scopes: ['per:auth-challenge'],
    });

    this.logger.log(
      `per.requestAuthChallenge deployment=${params.deploymentId} wallet=${params.walletAddress}`,
    );
    return { challenge, expiresAt };
  }

  /**
   * Promotes a challenge into an active token after verifying the wallet
   * signed the same nonce we issued. The signature is base58-encoded; the
   * wallet is a base58 ed25519 public key.
   */
  async verifyAuthSignature(params: PerAuthVerifyParams): Promise<PerAuthVerifyResult> {
    const challengeRow = await this.tokensRepo.getByToken(params.challenge);
    if (!challengeRow) {
      throw new UnauthorizedException('Unknown challenge');
    }
    if (challengeRow.status !== 'challenge') {
      throw new UnauthorizedException(`Challenge is ${challengeRow.status}`);
    }
    if (challengeRow.deployment_id !== params.deploymentId) {
      throw new UnauthorizedException('Challenge does not belong to this deployment');
    }
    if (challengeRow.wallet !== params.walletAddress) {
      throw new UnauthorizedException('Challenge does not belong to this wallet');
    }
    if (new Date(challengeRow.expires_at).getTime() <= Date.now()) {
      throw new UnauthorizedException('Challenge expired');
    }

    if (!this.verifySignature(params.walletAddress, params.challenge, params.signature)) {
      throw new UnauthorizedException('Signature verification failed');
    }

    // Optional: gate access on the wallet actually being a member.
    const member = await this.groupsRepo.findMembership(params.deploymentId, params.walletAddress);
    if (!member) {
      throw new UnauthorizedException('Wallet is not a member of this PER group');
    }

    const ttlMin = this.getAuthTtlMinutes();
    const newExpiry = new Date(Date.now() + ttlMin * 60 * 1000).toISOString();
    const promoted = await this.tokensRepo.promoteChallenge(params.challenge, newExpiry);

    this.logger.log(
      `per.verifyAuthSignature deployment=${params.deploymentId} wallet=${params.walletAddress}`,
    );
    return { authToken: promoted.token, expiresAt: newExpiry };
  }

  async getPrivateState(params: PerPrivateStateParams): Promise<PerPrivateStateResult> {
    const tokenRow = await this.tokensRepo.getActiveOrThrow(params.authToken);
    if (tokenRow.deployment_id !== params.deploymentId) {
      throw new UnauthorizedException('Token does not belong to this deployment');
    }
    const remote = await this.perClient.get<PerPrivateStateRemote>('/v1/private-state', {
      deploymentId: params.deploymentId,
      wallet: tokenRow.wallet,
    });
    return {
      state: remote?.state ?? null,
      logs: Array.isArray(remote?.logs) ? remote!.logs : [],
    };
  }

  // ---------------- helpers ----------------

  private verifySignature(walletAddress: string, challenge: string, signature: string): boolean {
    try {
      const pubkey = new PublicKey(walletAddress).toBytes();
      const sigBytes = bs58.decode(signature);
      const msg = bs58.decode(challenge);
      return nacl.sign.detached.verify(msg, sigBytes, pubkey);
    } catch (err) {
      this.logger.warn(
        `per.verifySignature decoding failed: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }

  private getChallengeTtlMs(): number {
    const raw = this.configService.get<string>('PER_CHALLENGE_TTL_MIN');
    const minutes = raw ? Number(raw) : NaN;
    if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes * 60 * 1000);
    return DEFAULT_CHALLENGE_TTL_MS;
  }

  private getAuthTtlMinutes(): number {
    const raw = this.configService.get<string>('PER_AUTH_TOKEN_TTL_MIN');
    const minutes = raw ? Number(raw) : NaN;
    if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes);
    return DEFAULT_AUTH_TTL_MIN;
  }
}
