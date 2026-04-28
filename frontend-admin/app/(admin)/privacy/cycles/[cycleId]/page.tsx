import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';
import { CycleDetailClient } from './cycle-detail-client';

export const dynamic = 'force-dynamic';

interface CycleDetailPageProps {
  params: { cycleId: string };
}

export default async function CycleDetailPage({ params }: CycleDetailPageProps) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/login');
  return <CycleDetailClient cycleId={params.cycleId} />;
}
