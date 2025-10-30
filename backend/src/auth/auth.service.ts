import { Injectable, UnauthorizedException, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../database/supabase.service';
import { PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';

interface ChallengeCache {
  challenge: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private challengeCache: Map<string, ChallengeCache> = new Map();

  constructor(
    private jwtService: JwtService,
    @Inject(forwardRef(() => SupabaseService))
    private supabaseService: SupabaseService,
  ) {
    // Clean expired challenges every 5 minutes
    setInterval(() => this.cleanExpiredChallenges(), 5 * 60 * 1000);
  }

  /**
   * Generate a challenge message for wallet signature
   */
  generateChallenge(walletAddress: string): string {
    const nonce = this.generateRandomNonce();
    const timestamp = Date.now();
    const expiresIn = 5 * 60 * 1000; // 5 minutes

    const challenge = `Sign this message to authenticate with PinTool:\n\nNonce: ${nonce}\nTimestamp: ${timestamp}\nWallet: ${walletAddress}`;

    this.challengeCache.set(walletAddress, {
      challenge,
      expiresAt: Date.now() + expiresIn,
    });

    console.log(`✅ Generated challenge for wallet: ${walletAddress}`);
    return challenge;
  }

  /**
   * Verify wallet signature and issue JWT token
   */
  async verifySignature(
    walletAddress: string,
    signature: string,
  ): Promise<{ accessToken: string }> {
    const cached = this.challengeCache.get(walletAddress);

    if (!cached) {
      throw new UnauthorizedException('Challenge not found or expired');
    }

    if (Date.now() > cached.expiresAt) {
      this.challengeCache.delete(walletAddress);
      throw new UnauthorizedException('Challenge has expired');
    }

    const isValid = this.verifyWalletSignature(cached.challenge, signature, walletAddress);

    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    // Remove used challenge
    this.challengeCache.delete(walletAddress);

    // Create or update user in database
    await this.createOrUpdateUser(walletAddress);

    // Generate JWT token
    const payload = { walletAddress };
    const accessToken = this.jwtService.sign(payload);

    console.log(`✅ User authenticated successfully: ${walletAddress}`);
    return { accessToken };
  }

  /**
   * Verify Solana wallet signature using ed25519
   */
  private verifyWalletSignature(
    message: string,
    signature: string,
    walletAddress: string,
  ): boolean {
    try {
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);
      const publicKeyBytes = new PublicKey(walletAddress).toBytes();

      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch (error) {
      console.error('❌ Signature verification failed:', error.message);
      return false;
    }
  }

  /**
   * Create or update user in Supabase
   */
  private async createOrUpdateUser(walletAddress: string) {
    const { error } = await this.supabaseService.client.from('users').upsert(
      {
        wallet_address: walletAddress,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'wallet_address',
      },
    );

    if (error) {
      console.error('❌ Failed to create/update user:', error);
      throw new Error('Failed to create user');
    }
  }

  /**
   * Clean expired challenges from cache
   */
  private cleanExpiredChallenges() {
    const now = Date.now();
    let cleaned = 0;

    for (const [walletAddress, cache] of this.challengeCache.entries()) {
      if (now > cache.expiresAt) {
        this.challengeCache.delete(walletAddress);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} expired challenges`);
    }
  }

  /**
   * Generate a random nonce
   */
  private generateRandomNonce(): string {
    return (
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );
  }
}
