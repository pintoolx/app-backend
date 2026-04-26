/* eslint-disable no-console */
/**
 * Admin CLI — bootstrap and manage admin_users without touching SQL by hand.
 *
 * Subcommands:
 *   create          : interactive provisioning (email, password, role, TOTP)
 *   reset-totp      : rotate TOTP secret for an existing admin
 *   reset-password  : change password for an existing admin
 *   list            : print existing admins (no secrets)
 *   disable         : set status='disabled'
 *   enable          : set status='active' and clear lockout
 *
 * All commands require these env vars (see backend/.env):
 *   ADMIN_TOTP_ENC_KEY (32-byte hex)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (or SUPABASE_KEY for older setups)
 *
 * Usage:
 *   npm run admin:create -- --email ops@x.com --role superadmin
 *   npm run admin:reset-totp -- --email ops@x.com
 *   npm run admin:list
 */
// `prompts` is a CommonJS module (`module.exports = prompts`); the `import =` form
// is the canonical interop without enabling esModuleInterop globally.
import promptsImport = require('prompts');
const prompts = promptsImport;
import * as qrcode from 'qrcode-terminal';
import {
  fatal,
  getSupabase,
  hashPassword,
  info,
  isAdminRole,
  loadEnv,
  ok,
  provisionTotp,
  scrub,
  warn,
  type AdminRole,
} from './_lib';

type Subcommand = 'create' | 'reset-totp' | 'reset-password' | 'list' | 'disable' | 'enable';

interface CliFlags {
  email?: string;
  role?: string;
}

function parseFlags(argv: string[]): CliFlags {
  const out: CliFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--email' && argv[i + 1]) {
      out.email = argv[++i].trim().toLowerCase();
    } else if (arg === '--role' && argv[i + 1]) {
      out.role = argv[++i].trim().toLowerCase();
    }
  }
  return out;
}

function detectSubcommand(argv: string[]): Subcommand {
  const direct = argv[0];
  if (
    direct === 'create' ||
    direct === 'reset-totp' ||
    direct === 'reset-password' ||
    direct === 'list' ||
    direct === 'disable' ||
    direct === 'enable'
  ) {
    return direct;
  }
  fatal(
    `Unknown or missing subcommand: ${direct ?? '<none>'}\n` +
      'Expected one of: create | reset-totp | reset-password | list | disable | enable',
  );
}

async function promptForEmail(initial?: string): Promise<string> {
  if (initial) return initial;
  const res = await prompts({
    type: 'text',
    name: 'email',
    message: 'Admin email',
    validate: (v: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? true : 'Invalid email'),
  });
  if (!res.email) fatal('Cancelled');
  return res.email.trim().toLowerCase();
}

async function promptForPassword(): Promise<string> {
  const res = await prompts([
    {
      type: 'password',
      name: 'password',
      message: 'Password (>= 12 chars recommended)',
      validate: (v: string) => (v.length >= 8 ? true : 'At least 8 chars'),
    },
    {
      type: 'password',
      name: 'confirm',
      message: 'Confirm password',
    },
  ]);
  if (!res.password || res.password !== res.confirm) {
    fatal('Passwords do not match — aborting');
  }
  scrub(res.confirm);
  return res.password;
}

async function promptForRole(initial?: string): Promise<AdminRole> {
  if (initial && isAdminRole(initial)) return initial;
  if (initial && !isAdminRole(initial)) {
    fatal(`Invalid --role: ${initial}. Use viewer | operator | superadmin`);
  }
  const res = await prompts({
    type: 'select',
    name: 'role',
    message: 'Role',
    choices: [
      { title: 'operator (default)', value: 'operator' },
      { title: 'viewer', value: 'viewer' },
      { title: 'superadmin', value: 'superadmin' },
    ],
    initial: 0,
  });
  if (!res.role || !isAdminRole(res.role)) fatal('Cancelled');
  return res.role;
}

async function showQr(label: string, otpauthUrl: string): Promise<void> {
  info('\n--- Scan this QR with Google Authenticator / 1Password / Authy ---\n');
  await new Promise<void>((resolve) => {
    qrcode.generate(otpauthUrl, { small: true }, (asciiQr: string) => {
      info(asciiQr);
      resolve();
    });
  });
  info(`Account label : ${label}`);
  info(`Manual URL    : ${otpauthUrl}`);
  info(
    '\nIf the QR is hard to scan in this terminal, copy the URL into\n' +
      '  https://www.qrcode-monkey.com  to render a fresh QR.\n',
  );
  await prompts({
    type: 'confirm',
    name: 'scanned',
    message: 'Have you saved the secret in your authenticator?',
    initial: false,
  });
}

async function cmdCreate(flags: CliFlags): Promise<void> {
  const env = loadEnv();
  const supabase = getSupabase(env);
  const email = await promptForEmail(flags.email);

  const { data: existing } = await supabase
    .from('admin_users')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();
  if (existing) {
    fatal(
      `Admin already exists: ${email}. Use 'reset-password' or 'reset-totp' to update credentials, or 'enable/disable' for status.`,
    );
  }

  const password = await promptForPassword();
  const role = await promptForRole(flags.role);
  const passwordHash = await hashPassword(password);
  scrub(password);

  const { secret, encrypted, otpauthUrl } = provisionTotp(email, env);

  const { data: inserted, error } = await supabase
    .from('admin_users')
    .insert({
      email,
      password_hash: passwordHash,
      totp_secret_enc: encrypted,
      role,
      status: 'active',
    })
    .select('id, email, role, status')
    .single();
  scrub(secret);

  if (error || !inserted) {
    fatal(`Failed to insert admin: ${error?.message ?? 'unknown error'}`);
  }

  ok(`Admin created  id=${inserted.id}  email=${inserted.email}  role=${inserted.role}`);
  await showQr(email, otpauthUrl);
  info('Done. You can now POST to /admin/auth/login with this email + password.');
}

async function cmdResetTotp(flags: CliFlags): Promise<void> {
  const env = loadEnv();
  const supabase = getSupabase(env);
  const email = await promptForEmail(flags.email);

  const { data: existing, error: fetchError } = await supabase
    .from('admin_users')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();
  if (fetchError || !existing) fatal(`Admin not found: ${email}`);

  const ack = await prompts({
    type: 'confirm',
    name: 'ok',
    message: `Rotate TOTP for ${email}? The previous authenticator binding will stop working.`,
    initial: false,
  });
  if (!ack.ok) fatal('Cancelled');

  const { secret, encrypted, otpauthUrl } = provisionTotp(email, env);
  const { error } = await supabase
    .from('admin_users')
    .update({ totp_secret_enc: encrypted, updated_at: new Date().toISOString() })
    .eq('id', existing.id);
  scrub(secret);

  if (error) fatal(`Failed to rotate TOTP: ${error.message}`);
  ok(`TOTP rotated for ${email}`);
  await showQr(email, otpauthUrl);
}

async function cmdResetPassword(flags: CliFlags): Promise<void> {
  const env = loadEnv();
  const supabase = getSupabase(env);
  const email = await promptForEmail(flags.email);

  const { data: existing, error: fetchError } = await supabase
    .from('admin_users')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();
  if (fetchError || !existing) fatal(`Admin not found: ${email}`);

  const password = await promptForPassword();
  const passwordHash = await hashPassword(password);
  scrub(password);
  const { error } = await supabase
    .from('admin_users')
    .update({
      password_hash: passwordHash,
      failed_login_count: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);
  if (error) fatal(`Failed to reset password: ${error.message}`);
  ok(`Password reset for ${email}. Lockout cleared.`);
}

async function cmdList(): Promise<void> {
  const env = loadEnv();
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, email, role, status, failed_login_count, locked_until, last_login_at, created_at')
    .order('created_at', { ascending: true });
  if (error) fatal(`Failed to list admins: ${error.message}`);

  if (!data || data.length === 0) {
    warn('No admin_users rows yet. Run: npm run admin:create');
    return;
  }
  info('');
  info('email                          role        status     last_login           locked');
  info(
    '-----------------------------  ----------  ---------  -------------------  --------------------',
  );
  for (const row of data) {
    const email = row.email.padEnd(30, ' ').slice(0, 30);
    const role = String(row.role).padEnd(10, ' ');
    const status = String(row.status).padEnd(9, ' ');
    const last = (row.last_login_at ?? '-').slice(0, 19).padEnd(19, ' ');
    const locked = row.locked_until ? row.locked_until.slice(0, 19) : '-';
    info(`${email}  ${role}  ${status}  ${last}  ${locked}`);
  }
  info('');
}

async function cmdSetStatus(flags: CliFlags, status: 'active' | 'disabled'): Promise<void> {
  const env = loadEnv();
  const supabase = getSupabase(env);
  const email = await promptForEmail(flags.email);

  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === 'active') {
    update.failed_login_count = 0;
    update.locked_until = null;
  }
  const { error, data } = await supabase
    .from('admin_users')
    .update(update)
    .eq('email', email)
    .select('id, email, status')
    .maybeSingle();
  if (error || !data) fatal(`Failed to update status: ${error?.message ?? 'not found'}`);
  ok(`${data.email} -> status=${data.status}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sub = detectSubcommand(argv);
  const flags = parseFlags(argv.slice(1));

  switch (sub) {
    case 'create':
      await cmdCreate(flags);
      break;
    case 'reset-totp':
      await cmdResetTotp(flags);
      break;
    case 'reset-password':
      await cmdResetPassword(flags);
      break;
    case 'list':
      await cmdList();
      break;
    case 'disable':
      await cmdSetStatus(flags, 'disabled');
      break;
    case 'enable':
      await cmdSetStatus(flags, 'active');
      break;
  }
}

main().catch((err) => {
  fatal(err instanceof Error ? err.message : String(err));
});
