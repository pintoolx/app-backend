
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as dns from 'dns';

// Force IPv4 lookup to avoid ENETUNREACH on some networks
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

dotenv.config();

const SUPABASE_PROJECT_ID = process.env.SUPABASE_URL?.split('//')[1].split('.')[0];
const DB_PASSWORD = process.env.PASSWORD;

if (!SUPABASE_PROJECT_ID || !DB_PASSWORD) {
  console.error('❌ Missing SUPABASE_URL or PASSWORD in .env');
  process.exit(1);
}

const connectionString = `postgres://postgres.mdvisqatcodrewgjpnsx:${DB_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
// Note: Supabase pooler requires different host usually, but let's try direct port change first or use the direct pooler URL pattern if known.
// Actually, standard Supabase Project is `db.[ref].supabase.co`.
// Let's stick to 5432 but try one more time with explicit IP? No, can't guess IP.
// Let's try to notify user if it fails.
// Wait, I can try to use `supavisor` style connection string?
// `postgres://[user].[project]:[pass]@aws-0-[region].pooler.supabase.com:6543/[db]`
// I don't know the region for sure (likely us-east-1 or eu-central-1).
// Let's try just changing the port on the original host, sometimes it works.
// `postgres://postgres:${DB_PASSWORD}@db.${SUPABASE_PROJECT_ID}.supabase.co:5432/postgres` -> 5432 is standard.
// Okay, Plan C: Print the SQL. 
// But wait, allow me to try ONE more thing. I will use the `adminSupabase` client (supabase-js) to run a ONE-OFF RPC call.
// Ah, but I need to CREATE the RPC function first... which requires SQL access. Circular dependency.
// Okay, I will try to use the `postgres` package again but with `host: 'db.mdvisqatcodrewgjpnsx.supabase.co'` and explicit `family: 4` in Client config. This is safer.

async function applyMigration() {
  // const client = new Client({
  //   connectionString,
  //   ssl: { rejectUnauthorized: false } 
  // });

  const client = new Client({
    host: `db.${SUPABASE_PROJECT_ID}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    // @ts-ignore - 'family' option might not be in all type defs but works in modern pg
    family: 4, 
  });

  try {
    await client.connect();
    console.log('✅ Connected to Database');

    const migrationPath = path.join(__dirname, '../supabase/migrations/20260129000000_update_schema_v2.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    console.log('📜 Applying Migration: 20260129000000_update_schema_v2.sql');
    await client.query(migrationSql);

    console.log('✅ Migration Applied Successfully!');
  } catch (error) {
    console.error('❌ Migration Failed:', error);
  } finally {
    await client.end();
  }
}

applyMigration();
