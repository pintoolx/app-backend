import * as React from 'react';
import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { MaintenanceBanner } from './maintenance-banner';

/**
 * Server-rendered admin chrome.
 *
 * Verifies the access cookie on every request (cheap; happens after the
 * middleware presence-check). On failure, bounces to /login.
 */
export async function AdminShell({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/login');

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar admin={admin} />
        <MaintenanceBanner />
        <main id="main-content" className="flex-1 overflow-x-auto p-6" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
