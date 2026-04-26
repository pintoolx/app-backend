import { Injectable, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { createCipheriv, createDecipheriv, randomBytes as cryptoRandomBytes } from 'crypto';

const AES_ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Encrypts and verifies TOTP secrets for admin users.
 *
 * The plaintext secret never touches the database — we encrypt with AES-256-GCM
 * keyed by `ADMIN_TOTP_ENC_KEY` (32-byte hex). Each ciphertext is wrapped with
 * a fresh IV and the GCM auth tag so a compromise of the encryption key
 * without the DB still cannot recover secrets, and a leaked DB without the
 * key reveals no secrets either.
 *
 * Cipher format (base64): `iv | ciphertext | tag`.
 */
@Injectable()
export class TotpService implements OnModuleInit {
  private encKey: Buffer | null = null;
  private issuer = 'PinTool Admin';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const hex = this.configService.get<string>('admin.totpEncKey');
    this.issuer = this.configService.get<string>('admin.totpIssuer') || this.issuer;
    if (!hex) {
      // We let the service boot in degraded mode so noop / dev environments
      // can still load AdminModule. Calls into encrypt/decrypt will throw.
      return;
    }
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new InternalServerErrorException(
        'ADMIN_TOTP_ENC_KEY must be a 32-byte hex string (64 chars)',
      );
    }
    this.encKey = Buffer.from(hex, 'hex');
  }

  generateSecret(): string {
    return generateSecret();
  }

  buildOtpauthUrl(label: string, secret: string): string {
    return generateURI({ issuer: this.issuer, label, secret });
  }

  /**
   * Returns true if `code` matches `secret` in the current step or in the
   * immediately adjacent ±1 steps. The ±1 tolerance smooths over clock skew
   * between the admin's authenticator app and the server (typically <30s).
   * `verifySync` already uses constant-time HMAC comparison internally.
   */
  verify(code: string, secret: string): boolean {
    if (!code || !secret) return false;
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) return false;
    const result = verifySync({ secret, token: trimmed, epochTolerance: 30 });
    return Boolean(result?.valid);
  }

  encryptSecret(secret: string): string {
    const key = this.requireKey();
    const iv = cryptoRandomBytes(IV_BYTES);
    const cipher = createCipheriv(AES_ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, encrypted, tag]).toString('base64');
  }

  decryptSecret(payload: string): string {
    const key = this.requireKey();
    const buf = Buffer.from(payload, 'base64');
    if (buf.length < IV_BYTES + TAG_BYTES + 1) {
      throw new InternalServerErrorException('Corrupt TOTP secret payload');
    }
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(buf.length - TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
    const decipher = createDecipheriv(AES_ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.encKey) {
      throw new InternalServerErrorException(
        'ADMIN_TOTP_ENC_KEY is not configured; admin 2FA is disabled',
      );
    }
    return this.encKey;
  }
}
