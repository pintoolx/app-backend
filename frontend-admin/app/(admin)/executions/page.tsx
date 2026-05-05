import { Metadata } from 'next';
import { getCurrentAdmin } from '@/lib/auth';
import { ExecutionsClient } from './executions-client';

export const metadata: Metadata = {
  title: 'Workflow Executions',
};

export default async function ExecutionsPage() {
  const admin = await getCurrentAdmin();
  return <ExecutionsClient role={admin?.role ?? 'viewer'} />;
}
