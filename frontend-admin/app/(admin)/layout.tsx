import * as React from 'react';
import { AdminShell } from '@/components/admin/admin-shell';

export default function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
