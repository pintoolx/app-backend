import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';
import { DeploymentsClient } from './deployments-client';

export const dynamic = 'force-dynamic';

export default async function DeploymentsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/login');
  return <DeploymentsClient role={admin.role} />;
}
