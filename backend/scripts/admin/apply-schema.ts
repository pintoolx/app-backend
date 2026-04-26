import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const DB_PASSWORD = process.env.PASSWORD;
if (!DB_PASSWORD) {
  console.error('Missing PASSWORD in .env');
  process.exit(1);
}

async function main() {
  const connectionString = `postgresql://postgres:${DB_PASSWORD}@db.mdvisqatcodrewgjpnsx.supabase.co:5432/postgres`;
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to Supabase DB');

    const sqlPath = path.join(__dirname, '../src/database/schema/initial-6-admin.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('Applying admin schema...');
    await client.query(sql);
    console.log('Admin schema applied successfully!');
  } catch (err) {
    console.error('Failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
