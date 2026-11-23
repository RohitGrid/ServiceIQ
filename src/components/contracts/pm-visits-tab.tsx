'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '@/hooks/use-org';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Calendar,
  Wrench,
  Search,
  Filter,
  AlertCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { PmScheduleModal, type PmVisitDetails } from '@/components/jobs/pm-schedule-modal';

interface PmVisitsTabProps {
  contractId?: string;
  className?: string;
}

export function PmVisitsTab({ contractId, className = '' }: PmVisitsTabProps) {
  const { org } = useOrg();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedVisit, setSelectedVisit] = useState<PmVisitDetails | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['pm_visits', org?.org_id, contractId, statusFilter],
    queryFn: async () => {
      if (!org?.org_id) return { visits: [], count: 0 };
      const url = new URL('/api/pm-visits', window.location.origin);
      url.searchParams.set('orgId', org.org_id);
      if (contractId) url.searchParams.set('contractId', contractId);
      if (statusFilter !== 'all') url.searchParams.set('status', statusFilter);

      const res = await fetch(url.toString());
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load PM visits');
      }
      return res.json();
    },
    enabled: Boolean(org?.org_id),
  });

  const visits: PmVisitDetails[] = data?.visits || [];

  const filteredVisits = visits.filter((v: any) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    const contractNo = v.contract?.contract_no?.toLowerCase() || '';
    const customer = v.customer?.name?.toLowerCase() || '';
    const model = v.equipment?.model_name?.toLowerCase() || '';
    const serial = v.equipment?.serial_no?.toLowerCase() || '';
    const jobNo = v.job?.job_no?.toLowerCase() || '';

    return (
      contractNo.includes(q) ||
      customer.includes(q) ||
      model.includes(q) ||
      serial.includes(q) ||
      jobNo.includes(q)
    );
  });

  function getStatusBadge(status: string) {
    switch (status) {
      case 'scheduled':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="w-3 h-3 text-blue-600" />
            Scheduled
          </span>
        );
      case 'done':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Completed
          </span>
        );
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            Skipped
          </span>
        );
      case 'breached':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            Overdue / Breached
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            Pending
          </span>
        );
    }
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="w-full sm:w-80 relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
          <Input
            placeholder="Search customer, equipment, serial, contract..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-2.5 rounded-md border border-input bg-background text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending Only</option>
            <option value="scheduled">Scheduled Only</option>
            <option value="done">Completed</option>
            <option value="breached">Breached / Overdue</option>
            <option value="skipped">Skipped</option>
          </select>
        </div>
      </div>

      {isError && (
        <div className="p-3 text-xs rounded-md bg-rose-50 text-rose-800 border border-rose-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>Error loading PM visits: {(error as Error)?.message}</span>
        </div>
      )}

      {/* PM Visits Table */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 text-xs">
                <TableHead className="font-semibold">PM Due Date</TableHead>
                <TableHead className="font-semibold">Customer</TableHead>
                <TableHead className="font-semibold">Equipment Model</TableHead>
                <TableHead className="font-semibold">Serial Number</TableHead>
                <TableHead className="font-semibold">Contract Number</TableHead>
                <TableHead className="font-semibold">PM Status</TableHead>
                <TableHead className="font-semibold text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3, 4].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7} className="h-10 animate-pulse bg-muted/20" />
                  </TableRow>
                ))
              ) : filteredVisits.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-28 text-center text-muted-foreground text-xs">
                    No preventive maintenance visits found matching criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredVisits.map((v: any) => {
                  const canSchedule = v.status === 'pending' || v.status === 'breached';

                  return (
                    <TableRow key={v.pm_visit_id} className="hover:bg-muted/40 transition-colors text-xs">
                      {/* PM Due Date */}
                      <TableCell className="font-medium whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>{format(new Date(v.due_date), 'MMM dd, yyyy')}</span>
                          {v.grace_days != null && (
                            <span className="text-[10px] text-muted-foreground">
                              (+{v.grace_days}d)
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Customer */}
                      <TableCell className="max-w-[150px]">
                        <div className="font-medium text-foreground truncate" title={v.customer?.name}>
                          {v.customer?.name || 'Walk-in'}
                        </div>
                        {v.site?.name && (
                          <div className="text-[11px] text-muted-foreground truncate" title={v.site.name}>
                            {v.site.name}
                          </div>
                        )}
                      </TableCell>

                      {/* Equipment Model */}
                      <TableCell className="max-w-[150px]">
                        <div className="truncate font-medium text-foreground" title={v.equipment?.model_name}>
                          {v.equipment?.model_name || 'Equipment'}
                        </div>
                        {v.equipment?.brand_name && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {v.equipment.brand_name}
                          </div>
                        )}
                      </TableCell>

                      {/* Serial Number */}
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {v.equipment?.serial_no || 'N/A'}
                      </TableCell>

                      {/* Contract Number */}
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {v.contract?.contract_no ? (
                          <span className="text-muted-foreground">{v.contract.contract_no}</span>
                        ) : (
                          <span className="text-muted-foreground italic">None</span>
                        )}
                      </TableCell>

                      {/* Status */}
                      <TableCell className="whitespace-nowrap">
                        {getStatusBadge(v.status)}
                      </TableCell>

                      {/* Action */}
                      <TableCell className="text-right whitespace-nowrap">
                        {canSchedule ? (
                          <Button
                            size="sm"
                            className="h-7 px-2.5 text-xs gap-1 shadow-sm"
                            onClick={() => setSelectedVisit(v)}
                          >
                            <Wrench className="w-3.5 h-3.5" />
                            Schedule
                          </Button>
                        ) : v.job ? (
                          <Link href={`/jobs/${v.job.job_id}`}>
                            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs gap-1">
                              View {v.job.job_no}
                              <ArrowRight className="w-3 h-3" />
                            </Button>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">Scheduled</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Schedule PM Visit Modal */}
      <PmScheduleModal
        visit={selectedVisit}
        isOpen={Boolean(selectedVisit)}
        onClose={() => setSelectedVisit(null)}
        onSuccess={() => {
          setSelectedVisit(null);
          refetch();
          queryClient.invalidateQueries({ queryKey: ['dispatch_jobs', org?.org_id] });
          queryClient.invalidateQueries({ queryKey: ['all_jobs', org?.org_id] });
        }}
      />
    </div>
  );
}
