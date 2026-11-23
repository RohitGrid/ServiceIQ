'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useOrg } from '@/hooks/use-org';
import { createClient } from '@/lib/supabase/client';
import type { Ticket, Priority, TicketStatus } from '@/types';
import { PriorityBadge, TicketStatusBadge } from '@/components/jobs/job-status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Plus,
  Search,
  Filter,
  AlertCircle,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  LifeBuoy,
  Flame,
  CheckCircle2,
  Clock,
  Layers,
} from 'lucide-react';
import { format } from 'date-fns';

export function TicketList() {
  const { org } = useOrg();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sortDescending, setSortDescending] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const {
    data: tickets = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['tickets', org?.org_id],
    queryFn: async () => {
      if (!org?.org_id) return [];
      const supabase = createClient();

      const { data, error } = await supabase
        .from('ticket')
        .select(`
          ticket_id, ticket_no, priority, status, source, reported_at, fault_description,
          site(name, party(name)),
          equipment_unit(serial_no, product_model(name))
        `)
        .eq('org_id', org.org_id)
        .order('reported_at', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      return (data as unknown as Ticket[]) || [];
    },
    enabled: Boolean(org?.org_id),
  });

  // KPI Metrics Summary
  const metrics = useMemo(() => {
    let total = tickets.length;
    let p1Count = 0;
    let openCount = 0;
    let inProgressCount = 0;
    let closedCount = 0;

    for (const t of tickets) {
      if (t.priority === 'P1') p1Count++;
      if (t.status === 'open') openCount++;
      if (t.status === 'in_progress' || t.status === 'awaiting_parts') inProgressCount++;
      if (t.status === 'closed') closedCount++;
    }

    return { total, p1Count, openCount, inProgressCount, closedCount };
  }, [tickets]);

  // Filtering and Sorting
  const filteredAndSortedTickets = useMemo(() => {
    let result = tickets.filter((t) => {
      // Status filter
      if (statusFilter !== 'all' && t.status !== statusFilter) {
        return false;
      }
      // Priority filter
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) {
        return false;
      }
      // Search by ticket number, customer name, and fault description
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const ticketNo = t.ticket_no?.toLowerCase() || '';
        const customer = t.site?.party?.name?.toLowerCase() || '';
        const fault = t.fault_description?.toLowerCase() || '';
        const site = t.site?.name?.toLowerCase() || '';
        const serial = t.equipment_unit?.serial_no?.toLowerCase() || '';

        if (
          !ticketNo.includes(q) &&
          !customer.includes(q) &&
          !fault.includes(q) &&
          !site.includes(q) &&
          !serial.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });

    // Sorting by reported date
    result.sort((a, b) => {
      const timeA = new Date(a.reported_at).getTime();
      const timeB = new Date(b.reported_at).getTime();
      return sortDescending ? timeB - timeA : timeA - timeB;
    });

    return result;
  }, [tickets, statusFilter, priorityFilter, searchTerm, sortDescending]);

  // Pagination calculation
  const totalItems = filteredAndSortedTickets.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedTickets = filteredAndSortedTickets.slice(startIndex, endIndex);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <LifeBuoy className="w-6 h-6 text-primary" />
            Service Tickets
          </h2>
          <p className="text-sm text-muted-foreground">
            Customer breakdown requests, incident intake, and SLA tracking for {org?.name || 'this organisation'}.
          </p>
        </div>

        <Link href="/tickets/new">
          <Button className="gap-1.5 shadow-sm">
            <Plus className="w-4 h-4" />
            Raise New Ticket
          </Button>
        </Link>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card border rounded-lg p-3.5 shadow-sm space-y-1">
          <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-500" /> Total Tickets
          </span>
          <p className="text-2xl font-bold">{metrics.total}</p>
        </div>
        <div className="bg-card border rounded-lg p-3.5 shadow-sm space-y-1">
          <span className="text-xs text-rose-600 font-medium flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-rose-600" /> Critical P1
          </span>
          <p className="text-2xl font-bold text-rose-600">{metrics.p1Count}</p>
        </div>
        <div className="bg-card border rounded-lg p-3.5 shadow-sm space-y-1">
          <span className="text-xs text-amber-600 font-medium flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-500" /> Active / In Progress
          </span>
          <p className="text-2xl font-bold text-amber-600">{metrics.inProgressCount + metrics.openCount}</p>
        </div>
        <div className="bg-card border rounded-lg p-3.5 shadow-sm space-y-1">
          <span className="text-xs text-emerald-600 font-medium flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Resolved / Closed
          </span>
          <p className="text-2xl font-bold text-emerald-600">{metrics.closedCount}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col lg:flex-row items-center justify-between gap-3 bg-card p-3 rounded-lg border shadow-sm">
        <div className="flex-1 w-full lg:w-auto relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
          <Input
            placeholder="Search by ticket no, customer, or fault description..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="pl-9 h-10 w-full"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="awaiting_parts">Awaiting Parts</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => {
              setPriorityFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Priorities</option>
            <option value="P1">P1 (Critical)</option>
            <option value="P2">P2 (Standard)</option>
            <option value="P3">P3 (Low)</option>
          </select>

          {/* Date Sorting Toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortDescending(!sortDescending)}
            className="h-10 gap-1.5"
            title="Toggle reported date sort order"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span>Date: {sortDescending ? 'Newest' : 'Oldest'}</span>
            {sortDescending ? <ArrowDown className="w-3 h-3 ml-0.5" /> : <ArrowUp className="w-3 h-3 ml-0.5" />}
          </Button>
        </div>
      </div>

      {isError && (
        <div className="p-4 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>Error loading tickets: {(error as Error)?.message}</span>
        </div>
      )}

      {/* Tickets Table */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="font-semibold">Ticket No</TableHead>
              <TableHead className="font-semibold">Priority</TableHead>
              <TableHead className="font-semibold">Customer</TableHead>
              <TableHead className="font-semibold">Site Location</TableHead>
              <TableHead className="font-semibold">Equipment (Model / SN)</TableHead>
              <TableHead className="font-semibold">Source</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Reported At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3, 4, 5].map((i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8} className="h-12 animate-pulse bg-muted/20" />
                </TableRow>
              ))
            ) : paginatedTickets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-40 text-center">
                  <div className="flex flex-col items-center justify-center space-y-2 text-muted-foreground">
                    <LifeBuoy className="w-8 h-8 opacity-40" />
                    <p className="font-medium text-sm">No service tickets found</p>
                    <p className="text-xs">
                      {searchTerm || statusFilter !== 'all' || priorityFilter !== 'all'
                        ? 'Try clearing your filters or search terms.'
                        : 'Raise a new ticket to initiate customer service intake.'}
                    </p>
                    <Link href="/tickets/new" className="pt-2">
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Plus className="w-3.5 h-3.5" />
                        Raise Ticket
                      </Button>
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedTickets.map((t) => {
                const customerName = t.site?.party?.name || 'Walk-in / Direct';
                const siteName = t.site?.name || 'Primary Site';
                const modelName = t.equipment_unit?.product_model?.name || 'Equipment';
                const serialNo = t.equipment_unit?.serial_no;

                return (
                  <TableRow key={t.ticket_id} className="hover:bg-muted/40 transition-colors">
                    <TableCell className="font-semibold font-mono">
                      <Link
                        href={`/tickets/${t.ticket_id}`}
                        className="text-primary hover:underline"
                      >
                        {t.ticket_no}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={t.priority} />
                    </TableCell>
                    <TableCell className="font-medium max-w-[170px] truncate">
                      {customerName}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[150px] truncate text-xs">
                      {siteName}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                      <span className="text-foreground font-medium">{modelName}</span>
                      {serialNo && <span className="block font-mono text-[11px] text-muted-foreground">{serialNo}</span>}
                    </TableCell>
                    <TableCell className="text-xs uppercase font-mono text-muted-foreground">
                      <span className="px-2 py-0.5 rounded bg-muted/60">{t.source}</span>
                    </TableCell>
                    <TableCell>
                      <TicketStatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {t.reported_at ? format(new Date(t.reported_at), 'MMM dd, yyyy HH:mm') : '—'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination Bar */}
        {totalItems > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between p-3.5 border-t bg-muted/20 gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>
                Showing <strong className="text-foreground">{startIndex + 1}</strong> to{' '}
                <strong className="text-foreground">{endIndex}</strong> of{' '}
                <strong className="text-foreground">{totalItems}</strong> tickets
              </span>
              <span className="text-border">|</span>
              <div className="flex items-center gap-1">
                <span>Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="h-7 px-2 rounded border border-input bg-background text-xs"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={validCurrentPage <= 1}
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="sr-only">Previous Page</span>
              </Button>
              <span className="px-2">
                Page {validCurrentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={validCurrentPage >= totalPages}
              >
                <ChevronRight className="w-4 h-4" />
                <span className="sr-only">Next Page</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
