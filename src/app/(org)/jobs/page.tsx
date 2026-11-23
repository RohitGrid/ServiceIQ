'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '@/hooks/use-org';
import { createClient } from '@/lib/supabase/client';
import type { Job } from '@/types';
import { JobStatusBadge, PriorityBadge } from '@/components/jobs/job-status-badge';
import { AssignmentModal } from '@/components/jobs/assignment-modal';
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
  Wrench,
  Search,
  Filter,
  AlertCircle,
  Plus,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  UserCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';

type SortField = 'scheduled_start' | 'created_at' | 'resolution_due' | 'job_no';
type SortOrder = 'asc' | 'desc';

export default function JobsPage() {
  const { org } = useOrg();
  const queryClient = useQueryClient();

  // Search & Filters state
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [breachFilter, setBreachFilter] = useState<string>('all');

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Pagination state
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Quick Assignment Modal state
  const [assignJob, setAssignJob] = useState<{ id: string; no: string } | null>(null);

  const isFilterActive =
    searchTerm !== '' ||
    statusFilter !== 'all' ||
    typeFilter !== 'all' ||
    priorityFilter !== 'all' ||
    breachFilter !== 'all';

  function resetFilters() {
    setSearchTerm('');
    setStatusFilter('all');
    setTypeFilter('all');
    setPriorityFilter('all');
    setBreachFilter('all');
    setPage(1);
  }

  const {
    data: jobs = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['all_jobs', org?.org_id],
    queryFn: async () => {
      if (!org?.org_id) return [];
      const supabase = createClient();

      const { data, error } = await supabase
        .from('job')
        .select(`
          job_id, job_no, created_at, scheduled_start, scheduled_end, actual_start, actual_end,
          response_due, resolution_due, breached,
          workflow_state(code, label, is_terminal),
          job_type(code, name),
          ticket(ticket_id, ticket_no, priority, fault_description,
            site(name, party(name)),
            equipment_unit(serial_no, product_model(name, brand_name))),
          equipment_unit(serial_no,
            site(name, party(name)),
            product_model(name, brand_name)),
          job_assignment(
            assignment_id, person_id, is_lead, status, slot_start, slot_end,
            person(person_id, full_name, phone))
        `)
        .eq('org_id', org.org_id)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      return (data as unknown as Job[]) || [];
    },
    enabled: Boolean(org?.org_id),
  });

  // Calculate high-level KPIs
  const kpis = useMemo(() => {
    let unassigned = 0;
    let inProgress = 0;
    let awaitingParts = 0;
    let breachedCount = 0;

    for (const j of jobs) {
      const state = Array.isArray(j.workflow_state) ? j.workflow_state[0] : j.workflow_state;
      const code = state?.code || 'open';
      const assignments = j.job_assignment || [];

      if (assignments.length === 0 || code === 'open') {
        unassigned++;
      }
      if (['assigned', 'en_route', 'on_site'].includes(code)) {
        inProgress++;
      }
      if (code === 'awaiting_parts') {
        awaitingParts++;
      }
      if (j.breached) {
        breachedCount++;
      }
    }

    return {
      total: jobs.length,
      unassigned,
      inProgress,
      awaitingParts,
      breachedCount,
    };
  }, [jobs]);

  // Extract distinct job types for the filter dropdown
  const availableJobTypes = useMemo(() => {
    const set = new Map<string, string>();
    for (const j of jobs) {
      const jt = Array.isArray(j.job_type) ? j.job_type[0] : j.job_type;
      if (jt?.code) {
        set.set(jt.code, jt.name || jt.code);
      }
    }
    return Array.from(set.entries());
  }, [jobs]);

  // Filtering & Searching
  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      const state = Array.isArray(j.workflow_state) ? j.workflow_state[0] : j.workflow_state;
      const code = state?.code || 'open';
      const jt = Array.isArray(j.job_type) ? j.job_type[0] : j.job_type;
      const jobTypeCode = jt?.code || '';
      const priority = j.ticket?.priority || 'P2';

      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'closed' && !['closed', 'completed'].includes(code)) {
          return false;
        } else if (statusFilter !== 'closed' && code !== statusFilter) {
          return false;
        }
      }

      // Type filter
      if (typeFilter !== 'all' && jobTypeCode !== typeFilter) {
        return false;
      }

      // Priority filter
      if (priorityFilter !== 'all' && priority !== priorityFilter) {
        return false;
      }

      // Breach filter
      if (breachFilter === 'breached' && !j.breached) {
        return false;
      }
      if (breachFilter === 'on_track' && j.breached) {
        return false;
      }

      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const jNo = j.job_no.toLowerCase();
        const tNo = j.ticket?.ticket_no?.toLowerCase() || '';
        const customer = (j.ticket?.site?.party?.name || j.equipment_unit?.site?.party?.name || '').toLowerCase();
        const site = (j.ticket?.site?.name || j.equipment_unit?.site?.name || '').toLowerCase();
        const equipment = (
          j.ticket?.equipment_unit?.product_model?.name ||
          j.equipment_unit?.product_model?.name ||
          ''
        ).toLowerCase();
        const serial = (j.ticket?.equipment_unit?.serial_no || j.equipment_unit?.serial_no || '').toLowerCase();
        const assignments = j.job_assignment || [];
        const techMatch = assignments.some((a) => a.person?.full_name?.toLowerCase().includes(q));

        if (
          !jNo.includes(q) &&
          !tNo.includes(q) &&
          !customer.includes(q) &&
          !site.includes(q) &&
          !equipment.includes(q) &&
          !serial.includes(q) &&
          !techMatch
        ) {
          return false;
        }
      }

      return true;
    });
  }, [jobs, statusFilter, typeFilter, priorityFilter, breachFilter, searchTerm]);

  // Sorting
  const sortedJobs = useMemo(() => {
    return [...filteredJobs].sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';

      if (sortField === 'scheduled_start') {
        aVal = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
        bVal = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
      } else if (sortField === 'resolution_due') {
        aVal = a.resolution_due ? new Date(a.resolution_due).getTime() : 0;
        bVal = b.resolution_due ? new Date(b.resolution_due).getTime() : 0;
      } else if (sortField === 'job_no') {
        aVal = a.job_no;
        bVal = b.job_no;
      } else {
        // created_at default
        aVal = new Date(a.created_at).getTime();
        bVal = new Date(b.created_at).getTime();
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredJobs, sortField, sortOrder]);

  // Pagination calculations
  const totalItems = sortedJobs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedJobs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedJobs.slice(start, start + pageSize);
  }, [sortedJobs, currentPage, pageSize]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wrench className="w-6 h-6 text-primary" />
            Field Service Jobs
          </h2>
          <p className="text-sm text-muted-foreground">
            Complete management, tracking, and scheduling of all breakdown and maintenance jobs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/dispatch">
            <Button variant="outline" className="gap-1.5 shadow-sm">
              <LayoutGrid className="w-4 h-4" />
              Dispatch Board
            </Button>
          </Link>
          <Link href="/tickets/new">
            <Button className="gap-1.5 shadow-sm">
              <Plus className="w-4 h-4" />
              New Ticket
            </Button>
          </Link>
        </div>
      </div>

      {/* Metric KPI Cards (Interactive Filters) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div
          onClick={() => resetFilters()}
          className={`p-3.5 rounded-xl border bg-card text-card-foreground shadow-2xs transition-all cursor-pointer hover:border-primary/50 hover:shadow-xs ${
            !isFilterActive ? 'ring-2 ring-primary/40 border-primary/40' : ''
          }`}
          title="Click to reset filters and view all jobs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Jobs</span>
            <Wrench className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-bold mt-1 font-mono">{kpis.total}</div>
        </div>

        <div
          onClick={() => {
            setStatusFilter(statusFilter === 'open' ? 'all' : 'open');
            setPage(1);
          }}
          className={`p-3.5 rounded-xl border bg-card text-card-foreground shadow-2xs transition-all cursor-pointer hover:border-blue-400 hover:shadow-xs ${
            statusFilter === 'open' ? 'ring-2 ring-blue-500 border-blue-400' : ''
          }`}
          title="Click to filter by Open / Unassigned"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Open / Unassigned</span>
            <AlertCircle className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold mt-1 text-blue-600 font-mono">{kpis.unassigned}</div>
        </div>

        <div
          onClick={() => {
            setStatusFilter(statusFilter === 'in_progress' ? 'all' : 'in_progress');
            setPage(1);
          }}
          className={`p-3.5 rounded-xl border bg-card text-card-foreground shadow-2xs transition-all cursor-pointer hover:border-amber-400 hover:shadow-xs ${
            statusFilter === 'in_progress' ? 'ring-2 ring-amber-500 border-amber-400' : ''
          }`}
          title="Click to filter by In Progress"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">In Progress</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold mt-1 text-amber-600 font-mono">{kpis.inProgress}</div>
        </div>

        <div
          onClick={() => {
            setStatusFilter(statusFilter === 'awaiting_parts' ? 'all' : 'awaiting_parts');
            setPage(1);
          }}
          className={`p-3.5 rounded-xl border bg-card text-card-foreground shadow-2xs transition-all cursor-pointer hover:border-purple-400 hover:shadow-xs ${
            statusFilter === 'awaiting_parts' ? 'ring-2 ring-purple-500 border-purple-400' : ''
          }`}
          title="Click to filter by Awaiting Parts"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Awaiting Parts</span>
            <AlertTriangle className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-bold mt-1 text-purple-600 font-mono">{kpis.awaitingParts}</div>
        </div>

        <div
          onClick={() => {
            setBreachFilter(breachFilter === 'breached' ? 'all' : 'breached');
            setPage(1);
          }}
          className={`p-3.5 rounded-xl border bg-card text-card-foreground shadow-2xs transition-all cursor-pointer hover:border-rose-400 hover:shadow-xs ${
            breachFilter === 'breached' ? 'ring-2 ring-rose-500 border-rose-400' : ''
          }`}
          title="Click to filter by Breached SLAs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">SLA Breached</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold mt-1 text-rose-600 font-mono">{kpis.breachedCount}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-card p-3 rounded-xl border shadow-2xs">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
          <Input
            placeholder="Search by job no, ticket no, customer, equipment, serial, or technician..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            className="pl-9 h-10 w-full"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="h-10 px-3 rounded-md border border-input bg-background text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="assigned">Assigned</option>
            <option value="en_route">En Route</option>
            <option value="on_site">On Site</option>
            <option value="awaiting_parts">Awaiting Parts</option>
            <option value="closed">Closed / Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Job Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="h-10 px-3 rounded-md border border-input bg-background text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Job Types</option>
            {availableJobTypes.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => {
              setPriorityFilter(e.target.value);
              setPage(1);
            }}
            className="h-10 px-3 rounded-md border border-input bg-background text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Priorities</option>
            <option value="P1">P1 - Critical</option>
            <option value="P2">P2 - Moderate</option>
            <option value="P3">P3 - Low</option>
          </select>

          {/* SLA Breach filter */}
          <select
            value={breachFilter}
            onChange={(e) => {
              setBreachFilter(e.target.value);
              setPage(1);
            }}
            className="h-10 px-3 rounded-md border border-input bg-background text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All SLAs</option>
            <option value="breached">Breached Only</option>
            <option value="on_track">On Track Only</option>
          </select>

          {isFilterActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-10 text-xs px-2.5 text-muted-foreground hover:text-foreground"
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {isError && (
        <div className="p-4 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>Error loading jobs: {(error as Error)?.message}</span>
        </div>
      )}

      {/* Main Jobs Table */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 text-xs">
                <TableHead
                  className="cursor-pointer select-none font-semibold"
                  onClick={() => handleSort('job_no')}
                >
                  <div className="flex items-center gap-1">
                    Job Number
                    <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                  </div>
                </TableHead>
                <TableHead className="font-semibold">Linked Ticket</TableHead>
                <TableHead className="font-semibold">Customer</TableHead>
                <TableHead className="font-semibold">Equipment</TableHead>
                <TableHead className="font-semibold">Job Type</TableHead>
                <TableHead className="font-semibold">Workflow Status</TableHead>
                <TableHead className="font-semibold">Assigned Technician</TableHead>
                <TableHead
                  className="cursor-pointer select-none font-semibold"
                  onClick={() => handleSort('scheduled_start')}
                >
                  <div className="flex items-center gap-1">
                    Scheduled Start
                    <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                  </div>
                </TableHead>
                <TableHead className="font-semibold">Response Due</TableHead>
                <TableHead
                  className="cursor-pointer select-none font-semibold"
                  onClick={() => handleSort('resolution_due')}
                >
                  <div className="flex items-center gap-1">
                    Resolution Due
                    <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
                  </div>
                </TableHead>
                <TableHead className="font-semibold text-center">Breach Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3, 4, 5, 6].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={11} className="h-12 animate-pulse bg-muted/20" />
                  </TableRow>
                ))
              ) : paginatedJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-44 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center space-y-2 py-6">
                      <Search className="w-8 h-8 text-muted-foreground/30" />
                      <p className="font-semibold text-foreground text-sm">No jobs match your search criteria</p>
                      <p className="text-xs text-muted-foreground max-w-sm">
                        Try modifying your search keywords, status filter, or reset all active filters.
                      </p>
                      {isFilterActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2 text-xs h-8 shadow-2xs"
                          onClick={resetFilters}
                        >
                          Reset All Filters
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedJobs.map((j) => {
                  const state = Array.isArray(j.workflow_state) ? j.workflow_state[0] : j.workflow_state;
                  const jt = Array.isArray(j.job_type) ? j.job_type[0] : j.job_type;
                  const customer =
                    j.ticket?.site?.party?.name ||
                    j.equipment_unit?.site?.party?.name ||
                    'Walk-in Customer';
                  const siteName = j.ticket?.site?.name || j.equipment_unit?.site?.name;
                  const modelName =
                    j.ticket?.equipment_unit?.product_model?.name ||
                    j.equipment_unit?.product_model?.name ||
                    'Standard Unit';
                  const brandName =
                    j.ticket?.equipment_unit?.product_model?.brand_name ||
                    j.equipment_unit?.product_model?.brand_name;
                  const serial = j.ticket?.equipment_unit?.serial_no || j.equipment_unit?.serial_no;
                  const assignments = j.job_assignment || [];
                  const leadAssignment = assignments.find((a) => a.is_lead) || assignments[0];
                  const leadTech = leadAssignment?.person?.full_name;

                  return (
                    <TableRow key={j.job_id} className="hover:bg-muted/40 transition-colors text-xs">
                      {/* Job Number */}
                      <TableCell className="font-semibold whitespace-nowrap">
                        <Link
                          href={`/jobs/${j.job_id}`}
                          className="text-primary font-mono font-medium hover:underline flex items-center gap-1"
                        >
                          {j.job_no}
                        </Link>
                      </TableCell>

                      {/* Linked Ticket */}
                      <TableCell className="whitespace-nowrap">
                        {j.ticket?.ticket_no ? (
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/tickets/${j.ticket_id}`}
                              className="font-mono text-muted-foreground hover:text-foreground hover:underline"
                            >
                              {j.ticket.ticket_no}
                            </Link>
                            <PriorityBadge priority={j.ticket.priority} />
                          </div>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                            PM Visit
                          </Badge>
                        )}
                      </TableCell>

                      {/* Customer */}
                      <TableCell className="max-w-[160px]">
                        <div className="font-medium text-foreground truncate" title={customer}>
                          {customer}
                        </div>
                        {siteName && (
                          <div className="text-[11px] text-muted-foreground truncate" title={siteName}>
                            {siteName}
                          </div>
                        )}
                      </TableCell>

                      {/* Equipment */}
                      <TableCell className="max-w-[160px]">
                        <div className="truncate font-medium text-foreground" title={modelName}>
                          {modelName} {brandName ? `(${brandName})` : ''}
                        </div>
                        {serial && (
                          <div className="font-mono text-[10px] text-muted-foreground">
                            SN: {serial}
                          </div>
                        )}
                      </TableCell>

                      {/* Job Type */}
                      <TableCell className="whitespace-nowrap">
                        <span className="capitalize px-2 py-0.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground border">
                          {jt?.name || jt?.code || 'Breakdown'}
                        </span>
                      </TableCell>

                      {/* Workflow Status */}
                      <TableCell className="whitespace-nowrap">
                        <JobStatusBadge status={state?.code} />
                      </TableCell>

                      {/* Assigned Technician */}
                      <TableCell className="whitespace-nowrap">
                        {leadTech ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground">{leadTech}</span>
                            {leadAssignment?.status && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                ({leadAssignment.status})
                              </span>
                            )}
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[11px] px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                            onClick={() => setAssignJob({ id: j.job_id, no: j.job_no })}
                          >
                            <UserCheck className="w-3 h-3 mr-1" />
                            Assign
                          </Button>
                        )}
                      </TableCell>

                      {/* Scheduled Start */}
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {j.scheduled_start ? (
                          format(new Date(j.scheduled_start), 'MMM dd, HH:mm')
                        ) : (
                          <span className="text-muted-foreground italic">Unscheduled</span>
                        )}
                      </TableCell>

                      {/* Response Deadline */}
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {j.response_due ? (
                          format(new Date(j.response_due), 'MMM dd, HH:mm')
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* Resolution Deadline */}
                      <TableCell className="whitespace-nowrap text-muted-foreground font-mono">
                        {j.resolution_due ? (
                          format(new Date(j.resolution_due), 'MMM dd, HH:mm')
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* Breached Status */}
                      <TableCell className="whitespace-nowrap text-center">
                        {j.breached ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-200">
                            <AlertCircle className="w-3 h-3 text-rose-600" />
                            Breached
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            On Track
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between p-3 gap-3 border-t bg-muted/20 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="h-8 px-2 rounded border border-input bg-background font-medium text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span>
              Showing {totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, totalItems)} of {totalItems} jobs
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 gap-1 text-xs"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1 || isLoading}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </Button>
            <span className="px-2 font-medium text-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 gap-1 text-xs"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages || isLoading}
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Quick Assignment Modal */}
      {assignJob && (
        <AssignmentModal
          jobId={assignJob.id}
          jobNo={assignJob.no}
          isOpen={Boolean(assignJob)}
          onClose={() => setAssignJob(null)}
          onSuccess={() => {
            setAssignJob(null);
            refetch();
            queryClient.invalidateQueries({ queryKey: ['dispatch_jobs', org?.org_id] });
          }}
        />
      )}
    </div>
  );
}
