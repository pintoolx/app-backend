import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';
import { UsersClient } from './users-client';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/login');
  return <UsersClient role={admin.role} />;
}
