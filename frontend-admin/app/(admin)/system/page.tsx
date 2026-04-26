import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';
import { SystemClient } from './system-client';

export const dynamic = 'force-dynamic';

export default async function SystemPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/login');
  return <SystemClient role={admin.role} />;
}
