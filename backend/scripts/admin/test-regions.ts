import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const DB_PASSWORD = process.env.PASSWORD;
if (!DB_PASSWORD) {
  console.error('Missing PASSWORD in .env');
  process.exit(1);
}

const regions = [
  'aws-0-us-east-1.pooler.supabase.com',
  'aws-0-us-west-2.pooler.supabase.com',
  'aws-0-eu-west-1.pooler.supabase.com',
  'aws-0-eu-central-1.pooler.supabase.com',
  'aws-0-ap-southeast-1.pooler.supabase.com',
  'aws-0-ap-northeast-1.pooler.supabase.com',
];

async function testRegion(host: string) {
  const connStr = `postgres://postgres.mdvisqatcodrewgjpnsx:${DB_PASSWORD}@${host}:5432/postgres`;
  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const res = await client.query('SELECT current_database()');
    console.log(`✅ SUCCESS: ${host} -> ${res.rows[0].current_database}`);
    await client.end();
    return true;
  } catch (e: any) {
    console.log(`❌ ${host}: ${e.message}`);
    try { await client.end(); } catch {}
    return false;
  }
}

(async () => {
  for (const region of regions) {
    if (await testRegion(region)) {
      process.exit(0);
    }
  }
  console.error('No working region found.');
  process.exit(1);
})();
