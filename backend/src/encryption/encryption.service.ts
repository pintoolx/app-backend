import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private configService: ConfigService) {
    const secret = this.configService.get<string>('encryption.secret');

    if (!secret || secret.length < 32) {
      throw new Error('ENCRYPTION_SECRET must be at least 32 characters long');
    }

    // Derive a 32-byte key from the secret
    this.key = crypto.scryptSync(secret, 'salt', 32);
    console.log('✅ Encryption service initialized');
  }

  /**
   * Encrypt a private key using AES-256-GCM
   * @param plaintext - The private key in plaintext
   * @returns Encrypted string in format: iv:authTag:encrypted
   */
  encrypt(plaintext: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      // Return format: iv:authTag:encrypted
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      console.error('❌ Encryption failed:', error.message);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt an encrypted private key
   * @param ciphertext - Encrypted string in format: iv:authTag:encrypted
   * @returns Decrypted plaintext
   */
  decrypt(ciphertext: string): string {
    try {
      const [ivHex, authTagHex, encrypted] = ciphertext.split(':');

      if (!ivHex || !authTagHex || !encrypted) {
        throw new Error('Invalid ciphertext format');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('❌ Decryption failed:', error.message);
      throw new Error('Failed to decrypt data');
    }
  }
}
