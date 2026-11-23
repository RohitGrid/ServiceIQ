'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PmVisitsTab } from '@/components/contracts/pm-visits-tab';
import { Wrench, LayoutGrid, Calendar } from 'lucide-react';

export default function PmVisitsPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary" />
            Preventive Maintenance Visits
          </h2>
          <p className="text-sm text-muted-foreground">
            View contract maintenance obligations and convert pending PM visits into scheduled dispatch jobs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/dispatch">
            <Button variant="outline" className="gap-1.5 shadow-sm text-xs">
              <LayoutGrid className="w-4 h-4" />
              Dispatch Board
            </Button>
          </Link>
          <Link href="/jobs">
            <Button variant="outline" className="gap-1.5 shadow-sm text-xs">
              <Wrench className="w-4 h-4" />
              All Jobs
            </Button>
          </Link>
        </div>
      </div>

      {/* Main PM Visits Component */}
      <PmVisitsTab />
    </div>
  );
}
