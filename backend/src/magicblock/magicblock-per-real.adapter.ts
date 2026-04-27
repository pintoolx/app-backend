import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
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

/** TEE /auth/challenge response shape */
interface TeeChallengeResponse {
  challenge?: string;
  error?: string;
}

/** TEE /auth/login response shape */
interface TeeLoginResponse {
  token?: string;
  expiresAt?: string;
  error?: string;
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
   * Proxies the auth challenge request to the TEE endpoint.
   * Instead of generating a server-side nonce, we ask the TEE for a
   * challenge that the client must sign.
   */
  async requestAuthChallenge(params: PerAuthChallengeParams): Promise<PerAuthChallenge> {
    const teeUrl = this.getTeeUrl();
    const challengeUrl = `${teeUrl.replace(/\/$/, '')}/auth/challenge?pubkey=${encodeURIComponent(params.walletAddress)}`;

    let challenge: string;
    try {
      const res = await axios.get<TeeChallengeResponse>(challengeUrl, { timeout: 10_000 });
      if (res.data.error) {
        throw new Error(res.data.error);
      }
      if (!res.data.challenge) {
        throw new Error('TEE returned no challenge');
      }
      challenge = res.data.challenge;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`TEE challenge request failed: ${msg}`);
      throw new UnauthorizedException(`Failed to request TEE challenge: ${msg}`);
    }

    const ttlMs = this.getChallengeTtlMs();
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
      `per.requestAuthChallenge deployment=${params.deploymentId} wallet=${params.walletAddress} tee=${teeUrl}`,
    );
    return { challenge, expiresAt, teeUrl };
  }

  /**
   * Proxies the signed challenge to the TEE /auth/login endpoint.
   * The TEE verifies the signature and returns a bearer token.
   * We persist the resulting token so that downstream guards and
   * private-state queries can use it.
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

    // Optional: gate access on the wallet actually being a member.
    const member = await this.groupsRepo.findMembership(params.deploymentId, params.walletAddress);
    if (!member) {
      throw new UnauthorizedException('Wallet is not a member of this PER group');
    }

    const teeUrl = this.getTeeUrl();
    const loginUrl = `${teeUrl.replace(/\/$/, '')}/auth/login`;

    let teeToken: string;
    let teeExpires: string;
    try {
      const res = await axios.post<TeeLoginResponse>(
        loginUrl,
        {
          pubkey: params.walletAddress,
          challenge: params.challenge,
          signature: params.signature,
        },
        { timeout: 10_000, headers: { 'Content-Type': 'application/json' } },
      );
      if (res.data.error) {
        throw new Error(res.data.error);
      }
      if (!res.data.token) {
        throw new Error('TEE returned no token');
      }
      teeToken = res.data.token;
      teeExpires = res.data.expiresAt ?? new Date(Date.now() + DEFAULT_AUTH_TTL_MIN * 60 * 1000).toISOString();
    } catch (err) {
      const msg = this.extractAxiosError(err);
      this.logger.error(`TEE login failed: ${msg}`);
      throw new UnauthorizedException(`Signature verification failed on TEE: ${msg}`);
    }

    // Store the TEE-issued token as an active token in our local registry
    // so that PerAuthGuard can still validate it.
    await this.tokensRepo.insertActive({
      token: teeToken,
      deploymentId: params.deploymentId,
      wallet: params.walletAddress,
      groupId: challengeRow.group_id ?? null,
      expiresAt: teeExpires,
      scopes: ['per:private-state'],
    });

    this.logger.log(
      `per.verifyAuthSignature deployment=${params.deploymentId} wallet=${params.walletAddress} teeToken=${teeToken.slice(0, 8)}…`,
    );
    return { authToken: teeToken, expiresAt: teeExpires };
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

  private getTeeUrl(): string {
    const url = this.configService.get<string>('MAGICBLOCK_PER_ENDPOINT');
    if (!url || !url.trim()) {
      throw new UnauthorizedException('MAGICBLOCK_PER_ENDPOINT is not configured');
    }
    return url.trim();
  }

  private getChallengeTtlMs(): number {
    const raw = this.configService.get<string>('PER_CHALLENGE_TTL_MIN');
    const minutes = raw ? Number(raw) : NaN;
    if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes * 60 * 1000);
    return DEFAULT_CHALLENGE_TTL_MS;
  }

  private extractAxiosError(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError;
      const data = ax.response?.data;
      if (data && typeof data === 'object') return JSON.stringify(data).slice(0, 240);
      return ax.message;
    }
    return err instanceof Error ? err.message : String(err);
  }
}
