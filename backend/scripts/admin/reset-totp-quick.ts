const { createCipheriv, randomBytes } = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { generateSecret, generateURI } = require('otplib');

const SUPABASE_URL = 'https://mdvisqatcodrewgjpnsx.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kdmlzcWF0Y29kcmV3Z2pwbnN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDUyMjI3MiwiZXhwIjoyMDc2MDk4MjcyfQ.b4bGfS-ziUgvWKSy1asLhHvrzseSqKxU8wGJGMgo5VQ';
const TOTP_ENC_KEY = Buffer.from('10c58bf361d9fed6181614634a4acbfbd63e6559023cf0cdb012b6bbca04259e', 'hex');
const EMAIL = 'charlie011111@gmail.com';

function encryptTotp(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', TOTP_ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64');
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const secret = generateSecret();
  const encrypted = encryptTotp(secret);
  const otpauthUrl = generateURI({ issuer: 'PinTool Admin', label: EMAIL, secret });

  const { error } = await supabase
    .from('admin_users')
    .update({ totp_secret_enc: encrypted, updated_at: new Date().toISOString() })
    .eq('email', EMAIL);

  if (error) {
    console.error('Failed to update TOTP:', error);
    process.exit(1);
  }

  console.log('\n✅ TOTP has been reset for', EMAIL);
  console.log('\n🔐 New Secret (base32):', secret);
  console.log('\n📱 OTP Auth URL:', otpauthUrl);
  console.log('\n💡 You can:');
  console.log('   1. Open https://www.qrcode-monkey.com and paste the URL above to generate a QR code');
  console.log('   2. Or manually add this secret to Google Authenticator / Authy / 1Password');
  console.log('\n⚠️  The old TOTP binding is now invalid.\n');
}

main().catch(console.error);
