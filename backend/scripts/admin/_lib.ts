import { createCipheriv, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { generateSecret as otpGenerateSecret, generateURI } from 'otplib';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const AES_ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

export type AdminRole = 'viewer' | 'operator' | 'superadmin';

export interface AdminEnv {
  totpEncKey: Buffer;
  totpIssuer: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
}

/**
 * Loads and validates the env required for admin CLI ops. Aborts with a
 * helpful message when ADMIN_TOTP_ENC_KEY is missing or malformed — this
 * mirrors the runtime check in `TotpService` so CLI output stays in sync.
 */
export function loadEnv(): AdminEnv {
  const totpEncKeyHex = process.env.ADMIN_TOTP_ENC_KEY;
  if (!totpEncKeyHex) {
    fatal(
      [
        'ADMIN_TOTP_ENC_KEY is not set.',
        'Generate one and add it to your .env:',
        '  echo "ADMIN_TOTP_ENC_KEY=$(openssl rand -hex 32)" >> .env',
      ].join('\n'),
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(totpEncKeyHex)) {
    fatal('ADMIN_TOTP_ENC_KEY must be 32 random bytes encoded as 64 hex chars.');
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    fatal(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) must be set in .env to run admin CLI.',
    );
  }
  return {
    totpEncKey: Buffer.from(totpEncKeyHex, 'hex'),
    totpIssuer: process.env.ADMIN_TOTP_ISSUER || 'PinTool Admin',
    supabaseUrl,
    supabaseServiceKey,
  };
}

export function getSupabase(env: AdminEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, 12);
}

export interface TotpProvision {
  secret: string;
  encrypted: string;
  otpauthUrl: string;
}

export function provisionTotp(label: string, env: AdminEnv): TotpProvision {
  const secret = otpGenerateSecret();
  const encrypted = encryptTotp(secret, env.totpEncKey);
  const otpauthUrl = generateURI({ issuer: env.totpIssuer, label, secret });
  return { secret, encrypted, otpauthUrl };
}

export function encryptTotp(secret: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64');
}

/** Wipes a string by overwriting the underlying Buffer copy (best-effort). */
export function scrub(value: string | undefined | null): void {
  if (!value) return;
  const buf = Buffer.from(value, 'utf8');
  buf.fill(0);
}

export function isAdminRole(value: unknown): value is AdminRole {
  return value === 'viewer' || value === 'operator' || value === 'superadmin';
}

export function fatal(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`\n[ERROR] ${message}\n`);
  process.exit(1);
}

export function info(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}

export function ok(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[OK] ${message}`);
}

export function warn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[WARN] ${message}`);
}
