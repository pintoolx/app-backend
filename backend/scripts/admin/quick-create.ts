/* eslint-disable no-console */
/**
 * Quick non-interactive admin creator. Use when you can't run the interactive
 * `admin:create` command (e.g., in CI or remote environments).
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/admin/quick-create.ts \
 *     --email charlie011111@gmail.com --role superadmin --password "YourPass123!"
 */
import { createClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';
import { generateSecret as otpGenerateSecret, generateURI } from 'otplib';
import * as qrcode from 'qrcode-terminal';
import { createCipheriv, randomBytes } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const AES_ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function parseFlags(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--email' || argv[i] === '--role' || argv[i] === '--password') && argv[i + 1]) {
      out[argv[i].replace('--', '')] = argv[++i];
    }
  }
  return out;
}

function fatal(msg: string): never {
  console.error(`\n[ERROR] ${msg}\n`);
  process.exit(1);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const email = flags.email?.trim().toLowerCase();
  const role = flags.role;
  const password = flags.password;

  if (!email) fatal('--email is required');
  if (!role || !['viewer', 'operator', 'superadmin'].includes(role)) fatal('--role must be viewer | operator | superadmin');
  if (!password || password.length < 8) fatal('--password is required (min 8 chars)');

  const totpEncKeyHex = process.env.ADMIN_TOTP_ENC_KEY;
  if (!totpEncKeyHex || !/^[0-9a-fA-F]{64}$/.test(totpEncKeyHex)) {
    fatal('ADMIN_TOTP_ENC_KEY must be set (64 hex chars)');
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) fatal('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Check existing
  const { data: existing } = await supabase
    .from('admin_users')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();
  if (existing) fatal(`Admin already exists: ${email}`);

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // Generate + encrypt TOTP
  const totpEncKey = Buffer.from(totpEncKeyHex, 'hex');
  const totpSecret = otpGenerateSecret();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGO, totpEncKey, iv);
  const enc = Buffer.concat([cipher.update(totpSecret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encryptedTotp = Buffer.concat([iv, enc, tag]).toString('base64');

  const issuer = process.env.ADMIN_TOTP_ISSUER || 'PinTool Admin';
  const otpauthUrl = generateURI({ issuer, label: email, secret: totpSecret });

  // Insert
  const { data: inserted, error } = await supabase
    .from('admin_users')
    .insert({
      email,
      password_hash: passwordHash,
      totp_secret_enc: encryptedTotp,
      role,
      status: 'active',
    })
    .select('id, email, role, status')
    .single();

  if (error || !inserted) fatal(`Failed to insert: ${error?.message ?? 'unknown'}`);

  console.log(`[OK] Admin created  id=${inserted.id}  email=${inserted.email}  role=${inserted.role}`);

  // Show QR
  console.log('\n--- Scan this QR with Google Authenticator / 1Password / Authy ---\n');
  await new Promise<void>((resolve) => {
    qrcode.generate(otpauthUrl, { small: true }, (asciiQr: string) => {
      console.log(asciiQr);
      resolve();
    });
  });
  console.log(`Manual URL: ${otpauthUrl}`);
  console.log('\nDone.');
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
