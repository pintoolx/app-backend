import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';

export default async function HomePage() {
  const admin = await getCurrentAdmin();
  redirect(admin ? '/overview' : '/login');
}
