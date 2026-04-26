'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Workflow,
  Boxes,
  ShieldCheck,
  Settings,
  ScrollText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

const SECTIONS = [
  {
    items: [
      { href: '/overview', labelKey: 'overview', icon: LayoutDashboard },
      { href: '/users', labelKey: 'users', icon: Users },
      { href: '/strategies', labelKey: 'strategies', icon: Workflow },
      { href: '/deployments', labelKey: 'deployments', icon: Boxes },
    ],
  },
  {
    items: [
      { href: '/privacy', labelKey: 'privacy', icon: ShieldCheck },
    ],
  },
  {
    items: [
      { href: '/system', labelKey: 'system', icon: Settings },
      { href: '/audit', labelKey: 'audit', icon: ScrollText },
    ],
  },
] as const;

export function Sidebar() {
  const t = useTranslations('nav');
  const tA11y = useTranslations('a11y');
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <span className="font-semibold">{t('title')}</span>
      </div>
      <nav
        className="flex-1 space-y-1 overflow-y-auto p-2 text-sm"
        aria-label={tA11y('mainNavigation')}
      >
        {SECTIONS.map((section, sIdx) => (
          <div key={sIdx} className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                    active && 'bg-accent text-foreground font-medium',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t(item.labelKey)}
                </Link>
              );
            })}
            {sIdx < SECTIONS.length - 1 ? (
              <Separator className="my-1.5" />
            ) : null}
          </div>
        ))}
      </nav>
      <div className="border-t px-4 py-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>v{process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0'}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono uppercase">
            {process.env.NODE_ENV === 'production' ? 'prod' : 'dev'}
          </span>
        </div>
      </div>
    </aside>
  );
}
