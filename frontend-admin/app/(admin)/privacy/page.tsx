import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';
import { PrivacyClient } from './privacy-client';

export const dynamic = 'force-dynamic';

export default async function PrivacyPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/login');
  return <PrivacyClient role={admin.role} />;
}
