'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOrg } from '@/hooks/use-org';
import { cn } from '@/lib/utils';
import {
  LayoutGrid,
  AlertCircle,
  Wrench,
  Package,
  FileText,
  RefreshCw,
  Users,
  Box,
  BarChart2,
  Settings,
  ShieldCheck,
} from 'lucide-react';

const NAV = [
  { href: '/dispatch', label: 'Dispatch', icon: LayoutGrid },
  { href: '/tickets', label: 'Tickets', icon: AlertCircle },
  { href: '/jobs', label: 'Jobs', icon: Wrench },
  { href: '/equipment', label: 'Equipment', icon: Package },
  { href: '/contracts', label: 'Contracts', icon: FileText },
  { href: '/renewals', label: 'Renewals', icon: RefreshCw },
  { href: '/technicians', label: 'Technicians', icon: Users },
  { href: '/parts', label: 'Parts', icon: Box },
  { href: '/dashboard', label: 'Dashboard', icon: BarChart2 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { org, person, membership } = useOrg();

  return (
    <aside className="hidden md:flex flex-col w-64 border-r bg-card h-screen shrink-0">
      <div className="p-4 border-b flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold">
          SIQ
        </div>
        <div className="overflow-hidden">
          <h1 className="font-semibold text-sm truncate">{org?.name || 'ServiceIQ'}</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-600" />
            <span className="capitalize">{membership?.role || 'Dispatcher'}</span>
          </p>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t text-xs text-muted-foreground flex items-center justify-between">
        <span className="truncate">{person?.full_name || 'Signed In'}</span>
        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded uppercase">Track C</span>
      </div>
    </aside>
  );
}

