'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '@/hooks/use-org';
import { createClient } from '@/lib/supabase/client';
import type { Job, Priority } from '@/types';
import { JobCard } from '@/components/dispatch/job-card';
import { AssignmentModal } from '@/components/jobs/assignment-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Filter,
  UserCheck,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Clock,
  Layers,
  Wrench,
  Calendar,
  X,
  Truck,
  MapPin,
  PauseCircle,
  HelpCircle,
} from 'lucide-react';
import { format, isToday, isThisWeek } from 'date-fns';

interface ColumnDef {
  key: string;
  label: string;
  icon: React.ElementType;
  accentClass: string;
  badgeBg: string;
}

const COLUMNS: ColumnDef[] = [
  {
    key: 'open',
    label: 'Open',
    icon: HelpCircle,
    accentClass: 'border-t-gray-500',
    badgeBg: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  },
  {
    key: 'assigned',
    label: 'Assigned',
    icon: UserCheck,
    accentClass: 'border-t-sky-500',
    badgeBg: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  },
  {
    key: 'en_route',
    label: 'En Route',
    icon: Truck,
    accentClass: 'border-t-indigo-500',
    badgeBg: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  },
  {
    key: 'on_site',
    label: 'On Site',
    icon: MapPin,
    accentClass: 'border-t-amber-500',
    badgeBg: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  {
    key: 'awaiting_parts',
    label: 'Awaiting Parts',
    icon: PauseCircle,
    accentClass: 'border-t-purple-500',
    badgeBg: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
  },
];

export function DispatchBoard() {
  const { org } = useOrg();
  const queryClient = useQueryClient();

  // Filters state
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [techFilter, setTechFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');

  // Modal state
  const [selectedJobForAssign, setSelectedJobForAssign] = useState<Job | null>(null);

  // 1. Fetch Technicians for the organization
  const { data: technicians = [] } = useQuery({
    queryKey: ['dispatch_technicians', org?.org_id],
    queryFn: async () => {
      if (!org?.org_id) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from('org_membership')
        .select('person_id, role, is_active, person(person_id, full_name, phone)')
        .eq('org_id', org.org_id)
        .eq('role', 'technician')
        .eq('is_active', true);

      if (error || !data) return [];

      return data
        .map((m: any) => {
          const p = Array.isArray(m.person) ? m.person[0] : m.person;
          return p ? { person_id: p.person_id, full_name: p.full_name, phone: p.phone } : null;
        })
        .filter(Boolean) as { person_id: string; full_name: string; phone?: string | null }[];
    },
    enabled: Boolean(org?.org_id),
  });

  // 2. Fetch Non-Terminal Jobs with all linked relations
  const {
    data: allJobs = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['dispatch_jobs', org?.org_id],
    queryFn: async () => {
      if (!org?.org_id) return [];
      const supabase = createClient();

      const { data, error } = await supabase
        .from('job')
        .select(`
          job_id, job_no, created_at, scheduled_start, scheduled_end, actual_start, actual_end,
          response_due, resolution_due, paused_minutes, breached, current_state_id, job_type_id,
          pm_visit_id, unit_id,
          workflow_state(state_id, code, label, is_terminal, stops_sla_clock),
          ticket(
            ticket_id, ticket_no, priority, fault_description, source, reported_at,
            site(site_id, name, party(party_id, name, phone)),
            equipment_unit(unit_id, serial_no, product_model(name, brand_name))
          ),
          equipment_unit(
            unit_id, serial_no,
            site(site_id, name, party(party_id, name, phone)),
            product_model(name, brand_name)
          ),
          job_assignment(
            assignment_id, person_id, is_lead, status, slot_start, slot_end,
            person(person_id, full_name, phone)
          )
        `)
        .eq('org_id', org.org_id)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      // Filter out terminal states client-side (closed, cancelled, skipped)
      return ((data as unknown as Job[]) || []).filter((j) => {
        const state = Array.isArray(j.workflow_state)
          ? j.workflow_state[0]
          : j.workflow_state;
        return !state?.is_terminal;
      });
    },
    enabled: Boolean(org?.org_id),
  });

  // 3. Supabase Realtime Subscription on job and job_assignment
  useEffect(() => {
    if (!org?.org_id) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`dispatch-live-${org.org_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job',
          filter: `org_id=eq.${org.org_id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['dispatch_jobs', org.org_id] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_assignment',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['dispatch_jobs', org.org_id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [org?.org_id, queryClient]);

  // 4. Metrics calculation across active jobs
  const metrics = useMemo(() => {
    let total = allJobs.length;
    let unassigned = 0;
    let breached = 0;
    let onSite = 0;
    let p1Count = 0;

    for (const job of allJobs) {
      const assignments = (job.job_assignment || []).filter((a) => a.status !== 'declined');
      if (assignments.length === 0) unassigned++;

      const isBreached =
        job.breached ||
        (job.resolution_due && new Date(job.resolution_due).getTime() < Date.now());
      if (isBreached) breached++;

      const state = Array.isArray(job.workflow_state)
        ? job.workflow_state[0]
        : job.workflow_state;
      if (state?.code === 'on_site') onSite++;

      if (job.ticket?.priority === 'P1') p1Count++;
    }

    return { total, unassigned, breached, onSite, p1Count };
  }, [allJobs]);

  // 5. Apply Search & Filters
  const filteredJobs = useMemo(() => {
    return allJobs.filter((job) => {
      // Priority filter
      if (priorityFilter !== 'all' && job.ticket?.priority !== priorityFilter) {
        return false;
      }

      // Technician filter
      const activeAssignments = (job.job_assignment || []).filter(
        (a) => a.status !== 'declined'
      );
      if (techFilter === 'unassigned') {
        if (activeAssignments.length > 0) return false;
      } else if (techFilter !== 'all') {
        const assignedToTech = activeAssignments.some(
          (a) => a.person_id === techFilter || a.person?.full_name === techFilter
        );
        if (!assignedToTech) return false;
      }

      // Date filter
      if (dateFilter === 'today') {
        const dateToCheck = job.scheduled_start || job.created_at;
        if (!dateToCheck || !isToday(new Date(dateToCheck))) return false;
      } else if (dateFilter === 'this_week') {
        const dateToCheck = job.scheduled_start || job.created_at;
        if (!dateToCheck || !isThisWeek(new Date(dateToCheck))) return false;
      } else if (dateFilter === 'breached') {
        const isBreached =
          job.breached ||
          (job.resolution_due && new Date(job.resolution_due).getTime() < Date.now());
        if (!isBreached) return false;
      }

      // Text search
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const jobNo = job.job_no.toLowerCase();
        const ticketNo = job.ticket?.ticket_no?.toLowerCase() || '';
        const customer =
          job.ticket?.site?.party?.name?.toLowerCase() ||
          job.equipment_unit?.site?.party?.name?.toLowerCase() ||
          '';
        const site =
          job.ticket?.site?.name?.toLowerCase() ||
          job.equipment_unit?.site?.name?.toLowerCase() ||
          '';
        const model =
          job.ticket?.equipment_unit?.product_model?.name?.toLowerCase() ||
          job.equipment_unit?.product_model?.name?.toLowerCase() ||
          '';
        const serial =
          job.ticket?.equipment_unit?.serial_no?.toLowerCase() ||
          job.equipment_unit?.serial_no?.toLowerCase() ||
          '';

        const matchesTech = activeAssignments.some((a) =>
          a.person?.full_name?.toLowerCase().includes(q)
        );

        if (
          !jobNo.includes(q) &&
          !ticketNo.includes(q) &&
          !customer.includes(q) &&
          !site.includes(q) &&
          !model.includes(q) &&
          !serial.includes(q) &&
          !matchesTech
        ) {
          return false;
        }
      }

      return true;
    });
  }, [allJobs, priorityFilter, techFilter, dateFilter, searchTerm]);

  // 6. Group Jobs into Kanban Columns using actual workflow_state.code
  const groupedJobs: Record<string, Job[]> = useMemo(() => {
    const groups: Record<string, Job[]> = {
      open: [],
      assigned: [],
      en_route: [],
      on_site: [],
      awaiting_parts: [],
    };

    for (const job of filteredJobs) {
      const state = Array.isArray(job.workflow_state)
        ? job.workflow_state[0]
        : job.workflow_state;
      const code = state?.code || 'open';

      if (groups[code]) {
        groups[code].push(job);
      } else if (code === 'scheduled') {
        // Scheduled PM/Installation jobs: if technician assigned, place in 'assigned', else in 'open'
        const hasAssignment = (job.job_assignment || []).some(
          (a) => a.status !== 'declined'
        );
        if (hasAssignment) {
          groups['assigned'].push(job);
        } else {
          groups['open'].push(job);
        }
      } else {
        // Default unmapped non-terminal states to open
        groups['open'].push(job);
      }
    }

    return groups;
  }, [filteredJobs]);

  const hasActiveFilters =
    searchTerm !== '' ||
    priorityFilter !== 'all' ||
    techFilter !== 'all' ||
    dateFilter !== 'all';

  function resetFilters() {
    setSearchTerm('');
    setPriorityFilter('all');
    setTechFilter('all');
    setDateFilter('all');
  }

  return (
    <div className="space-y-6">
      {/* Board Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <LayoutGrid className="w-6 h-6 text-primary" />
            Live Dispatch Board
          </h2>
          <p className="text-sm text-muted-foreground">
            Realtime field service orchestration and job execution status across {org?.name || 'this organisation'}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 shadow-2xs mr-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Sync
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-9 gap-1.5 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Link href="/pm-visits">
            <Button variant="outline" size="sm" className="h-9 gap-1.5 shadow-sm">
              <Calendar className="w-3.5 h-3.5" />
              PM Visits
            </Button>
          </Link>

          <Link href="/tickets/new">
            <Button size="sm" className="h-9 gap-1.5 shadow-sm">
              <Plus className="w-4 h-4" />
              Raise Ticket
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Counters Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-card border rounded-lg p-3 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] text-muted-foreground font-medium uppercase font-mono">
              Active Jobs
            </span>
            <p className="text-xl font-bold text-foreground mt-0.5">{metrics.total}</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center">
            <Layers className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-card border rounded-lg p-3 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] text-muted-foreground font-medium uppercase font-mono">
              Unassigned
            </span>
            <p className="text-xl font-bold text-rose-600 mt-0.5">{metrics.unassigned}</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center">
            <UserCheck className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-card border rounded-lg p-3 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] text-muted-foreground font-medium uppercase font-mono">
              On Site
            </span>
            <p className="text-xl font-bold text-amber-600 mt-0.5">{metrics.onSite}</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center">
            <MapPin className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-card border rounded-lg p-3 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] text-muted-foreground font-medium uppercase font-mono">
              SLA Breached
            </span>
            <p className="text-xl font-bold text-rose-600 mt-0.5">{metrics.breached}</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-card border rounded-lg p-3 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] text-muted-foreground font-medium uppercase font-mono">
              Critical P1
            </span>
            <p className="text-xl font-bold text-rose-700 mt-0.5">{metrics.p1Count}</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-700 flex items-center justify-center">
            <Flame className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-card p-3 rounded-lg border shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
          <Input
            placeholder="Search job no, ticket, customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-10 w-full"
          />
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Priority filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All Priorities</option>
              <option value="P1">P1 (Critical)</option>
              <option value="P2">P2 (Standard)</option>
              <option value="P3">P3 (Low)</option>
            </select>
          </div>

          {/* Technician filter */}
          <select
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            className="h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Technicians</option>
            <option value="unassigned">Unassigned Only</option>
            {technicians.map((t) => (
              <option key={t.person_id} value={t.person_id}>
                {t.full_name}
              </option>
            ))}
          </select>

          {/* Date filter */}
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Dates</option>
            <option value="today">Scheduled Today</option>
            <option value="this_week">This Week</option>
            <option value="breached">SLA Overdue / Breached</option>
          </select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-10 text-xs text-muted-foreground hover:text-foreground gap-1"
            >
              <X className="w-3.5 h-3.5" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {isError && (
        <div className="p-4 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>Error loading dispatch board: {(error as Error)?.message}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8">
            Retry
          </Button>
        </div>
      )}

      {/* Horizontal Scroll Wrapper for Kanban Columns on Small Screens */}
      <div className="w-full overflow-x-auto pb-4">
        <div className="flex gap-4 min-w-[1280px] lg:min-w-full items-start">
          {COLUMNS.map((col) => {
            const colJobs = groupedJobs[col.key] || [];
            const ColIcon = col.icon;

            return (
              <div
                key={col.key}
                className={`flex-1 min-w-[280px] lg:min-w-[250px] flex flex-col bg-muted/30 rounded-xl border border-t-4 ${col.accentClass} p-3.5 min-h-[580px] shadow-sm`}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-3 mb-3 border-b">
                  <div className="flex items-center gap-2">
                    <ColIcon className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-sm tracking-tight">{col.label}</span>
                  </div>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-bold ${col.badgeBg}`}>
                    {colJobs.length}
                  </span>
                </div>

                {/* Column Cards */}
                <div className="space-y-3 flex-1 overflow-y-auto pr-0.5">
                  {isLoading ? (
                    <div className="space-y-3">
                      {[1, 2].map((i) => (
                        <div
                          key={i}
                          className="h-32 rounded-lg bg-muted/60 animate-pulse border border-border/40"
                        />
                      ))}
                    </div>
                  ) : colJobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-44 text-center text-xs text-muted-foreground border border-dashed rounded-lg p-4 space-y-1 bg-background/50">
                      <ColIcon className="w-6 h-6 opacity-30 text-muted-foreground" />
                      <p className="font-medium text-foreground">No jobs in {col.label}</p>
                      <p className="text-[11px]">
                        {hasActiveFilters ? 'No jobs match current filters.' : 'All clear for this stage.'}
                      </p>
                    </div>
                  ) : (
                    colJobs.map((job) => (
                      <JobCard
                        key={job.job_id}
                        job={job}
                        onAssignClick={(j) => setSelectedJobForAssign(j)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Technician Assignment Modal */}
      {selectedJobForAssign && (
        <AssignmentModal
          jobId={selectedJobForAssign.job_id}
          jobNo={selectedJobForAssign.job_no}
          isOpen={Boolean(selectedJobForAssign)}
          onClose={() => setSelectedJobForAssign(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['dispatch_jobs', org?.org_id] });
          }}
        />
      )}
    </div>
  );
}
