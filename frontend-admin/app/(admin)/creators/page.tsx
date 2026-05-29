import { getCurrentAdmin } from '@/lib/auth';
import { CreatorsClient } from './creators-client';

export const dynamic = 'force-dynamic';

export default async function CreatorsPage() {
  const admin = await getCurrentAdmin();
  return <CreatorsClient role={admin?.role ?? 'viewer'} />;
}
