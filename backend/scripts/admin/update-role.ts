/* eslint-disable no-console */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const email = 'pintoolhq@gmail.com';
  const newRole = 'superadmin';

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from('admin_users')
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq('email', email)
    .select('id, email, role, status')
    .single();

  if (error || !data) {
    console.error(`Failed to update role: ${error?.message ?? 'not found'}`);
    process.exit(1);
  }

  console.log(`[OK] Updated ${data.email} -> role=${data.role} status=${data.status}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
