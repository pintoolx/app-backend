'use client';

import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import {
  LogOut,
  ShieldAlert,
  Menu,
  LayoutDashboard,
  Users,
  Workflow,
  Boxes,
  ShieldCheck,
  Settings,
  ScrollText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { AdminRole } from '@/lib/auth';

export interface TopbarProps {
  admin: { email: string; role: AdminRole };
}

const ROLE_VARIANT: Record<AdminRole, 'default' | 'secondary' | 'destructive'> = {
  viewer: 'secondary',
  operator: 'default',
  superadmin: 'destructive',
};

export function Topbar({ admin }: TopbarProps) {
  const locale = useLocale();
  const t = useTranslations('topbar');
  const tA11y = useTranslations('a11y');
  const tLocale = useTranslations('locale');
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [localePending, setLocalePending] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      const r = await fetch('/api/admin/logout', { method: 'POST' });
      if (!r.ok) toast.error(t('logoutFailed'));
    } finally {
      setPending(false);
      router.replace('/login');
      router.refresh();
    }
  }

  async function handleLocaleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextLocale = event.target.value;
    setLocalePending(true);
    try {
      await fetch('/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: nextLocale }),
      });
      router.refresh();
    } finally {
      setLocalePending(false);
    }
  }

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={tA11y('openNavigation')}
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldAlert className="h-4 w-4" />
            {t('console')}
          </div>
        </div>
        <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 sm:flex">
          <label htmlFor="topbar-locale" className="sr-only">
            {tA11y('languageSwitcher')}
          </label>
          <select
            id="topbar-locale"
            value={locale}
            onChange={handleLocaleChange}
            disabled={localePending}
            aria-label={tA11y('languageSwitcher')}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="en">{tLocale('english')}</option>
            <option value="zh-TW">{tLocale('traditionalChinese')}</option>
          </select>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              aria-label={tA11y('accountMenu')}
            >
              <span className="font-medium">{admin.email}</span>
              <Badge variant={ROLE_VARIANT[admin.role]}>{admin.role}</Badge>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t('signedInAs')}</DropdownMenuLabel>
            <DropdownMenuItem disabled>{admin.email}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              disabled={pending}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {pending ? t('loggingOut') : t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </header>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent className="sm:max-w-xs p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle className="text-base">{t('console')}</DialogTitle>
          </DialogHeader>
          <MobileNav onNavigate={() => setMobileOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function MobileNav({ onNavigate }: { onNavigate: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const items = [
    { href: '/overview', labelKey: 'overview', icon: LayoutDashboard },
    { href: '/users', labelKey: 'users', icon: Users },
    { href: '/strategies', labelKey: 'strategies', icon: Workflow },
    { href: '/deployments', labelKey: 'deployments', icon: Boxes },
    { href: '/privacy', labelKey: 'privacy', icon: ShieldCheck },
    { href: '/system', labelKey: 'system', icon: Settings },
    { href: '/audit', labelKey: 'audit', icon: ScrollText },
  ] as const;

  return (
    <nav className="p-2 space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              active && 'bg-accent text-foreground font-medium',
            )}
          >
            <Icon className="h-4 w-4" />
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
