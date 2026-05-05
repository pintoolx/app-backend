import { Metadata } from 'next';
import { getCurrentAdmin } from '@/lib/auth';
import { ReferralsClient } from './referrals-client';

export const metadata: Metadata = {
  title: 'Referrals',
};

export default async function ReferralsPage() {
  const admin = await getCurrentAdmin();
  return <ReferralsClient role={admin?.role ?? 'viewer'} />;
}
