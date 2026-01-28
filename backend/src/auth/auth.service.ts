import { Injectable, Inject, forwardRef, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';

@Injectable()
export class AuthService {
  constructor(
    @Inject(forwardRef(() => SupabaseService))
    private supabaseService: SupabaseService,
  ) {
    // Clean expired challenges every 5 minutes
    setInterval(() => this.cleanExpiredChallenges(), 5 * 60 * 1000);
  }

  /**
   * Generate a challenge message for wallet signature
   */
  async generateChallenge(walletAddress: string): Promise<string> {
    const nonce = this.generateRandomNonce();
    const timestamp = Date.now();
    const expiresIn = 5 * 60 * 1000; // 5 minutes

    const challenge = `Sign this message to authenticate with PinTool:\n\nNonce: ${nonce}\nTimestamp: ${timestamp}\nWallet: ${walletAddress}`;
    const expiresAt = new Date(Date.now() + expiresIn).toISOString();

    // Store in DB (Upsert)
    const { error } = await this.supabaseService.client.from('auth_challenges').upsert({
      wallet_address: walletAddress,
      challenge: challenge,
      expires_at: expiresAt,
    });

    if (error) {
      console.error('❌ Failed to store challenge:', error);
      throw new InternalServerErrorException('Failed to generate challenge');
    } else {
      console.log('DEBUG: Upsert success for wallet:', walletAddress);
    }

    console.log(`✅ Generated challenge for wallet: ${walletAddress}`);
    return challenge;
  }

  /**
   * Verify signature and consume challenge (For direct signature auth)
   * Returns true if valid, false otherwise.
   */
  async verifyAndConsumeChallenge(walletAddress: string, signature: string): Promise<boolean> {
    // 1. Get Challenge from DB
    // 1. Get Challenge from DB
    const cleanAddress = walletAddress.trim();
    const { data: rows, error } = await this.supabaseService.client
      .from('auth_challenges')
      .select('*')
      .eq('wallet_address', cleanAddress);

    if (error || !rows || rows.length === 0) {
      return false; // Challenge not found
    }

    const cached = rows[0];

    // 2. Check Expiry
    if (new Date() > new Date(cached.expires_at)) {
      await this.deleteChallenge(walletAddress);
      return false; // Expired
    }

    // 3. Verify Signature
    const isValid = this.verifyWalletSignature(cached.challenge, signature, walletAddress);

    // 4. Consume (Delete) Challenge
    if (isValid) {
      // Ensure user exists (to satisfy FK constraints)
      await this.createOrUpdateUser(cleanAddress);

      await this.deleteChallenge(walletAddress);
      return true;
    }

    return false;

    return false;
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
      throw new InternalServerErrorException('Failed to create user');
    }
  }

  /**
   * Delete challenge from DB
   */
  private async deleteChallenge(walletAddress: string) {
    await this.supabaseService.client
      .from('auth_challenges')
      .delete()
      .eq('wallet_address', walletAddress);
  }

  /**
   * Clean expired challenges from DB
   */
  private async cleanExpiredChallenges() {
    const { error, count } = await this.supabaseService.client
      .from('auth_challenges')
      .delete({ count: 'exact' })
      .lt('expires_at', new Date().toISOString());

    if (!error && count && count > 0) {
      console.log(`🧹 Cleaned ${count} expired challenges`);
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
