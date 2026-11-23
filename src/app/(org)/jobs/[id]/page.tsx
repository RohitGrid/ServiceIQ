'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '@/hooks/use-org';
import { createClient } from '@/lib/supabase/client';
import type { Job, JobStatusEvent } from '@/types';
import { JobStatusBadge, PriorityBadge } from '@/components/jobs/job-status-badge';
import { SlaTimer } from '@/components/dispatch/sla-timer';
import {
  ResponseCountdown,
  ResolutionCountdown,
  BreachedIndicator,
  CompletedTerminalBadge,
} from '@/components/jobs/sla-components';
import { AssignmentModal } from '@/components/jobs/assignment-modal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Building2,
  MapPin,
  Cpu,
  Clock,
  User,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Phone,
  Package,
  PauseCircle,
  Navigation,
  FileText,
  Star,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { format } from 'date-fns';

export default function JobDetailPage({ params }: { params: { id: string } }) {
  const { org } = useOrg();
  const queryClient = useQueryClient();
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['job_detail', params.id],
    queryFn: async () => {
      const supabase = createClient();

      // 1. Fetch Job with related Ticket, Equipment, JobType, and Assignments
      const { data: job, error: jobError } = await supabase
        .from('job')
        .select(`
          job_id, job_no, created_at, scheduled_start, scheduled_end, actual_start, actual_end,
          response_due, resolution_due, paused_minutes, breached, customer_rating, customer_feedback, technician_notes,
          job_type(code, name),
          workflow_state(code, label, allowed_next, is_terminal, stops_sla_clock),
          ticket(ticket_id, ticket_no, priority, fault_description, source, reported_at,
            site(name, address, pincode, contact_name, contact_phone, party(name, phone)),
            equipment_unit(unit_id, serial_no, warranty_end, status, product_model(name, brand_name))
          ),
          equipment_unit(unit_id, serial_no, warranty_end, status,
            product_model(name, brand_name),
            site(name, address, party(name, phone))
          ),
          job_assignment(
            assignment_id, person_id, is_lead, status, slot_start, slot_end, offered_at, responded_at, payout_amount,
            person(person_id, full_name, phone, email)
          )
        `)
        .eq('job_id', params.id)
        .single();

      if (jobError || !job) {
        throw new Error(jobError?.message || 'Job not found');
      }

      // 2. Fetch Status History Audit Events
      const { data: statusEvents, error: eventsError } = await supabase
        .from('job_status_event')
        .select(`
          event_id, changed_at, geo_lat, geo_lng, synced_offline,
          from_state:from_state_id(code, label),
          to_state:to_state_id(code, label),
          person:changed_by(full_name)
        `)
        .eq('job_id', params.id)
        .order('changed_at', { ascending: false });

      if (eventsError) {
        console.warn('Status events query warning:', eventsError);
      }

      // 3. Fetch Logged Job Parts & Entitlements
      const { data: parts, error: partsError } = await supabase
        .from('job_part')
        .select(`
          job_part_id, quantity, unit_price, is_chargeable, coverage_source, coverage_explanation,
          part(name, part_no, sell_price)
        `)
        .eq('job_id', params.id);

      if (partsError) {
        console.warn('Job parts query warning:', partsError);
      }

      return {
        job: job as unknown as Job,
        statusEvents: (statusEvents || []) as unknown as JobStatusEvent[],
        parts: parts || [],
      };
    },
  });

  async function handleTransition(toStateCode: string) {
    setTransitioning(true);
    setTransitionError(null);
    try {
      const res = await fetch(`/api/jobs/${params.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStateCode }),
      });

      const json = await res.json();
      if (!res.ok) {
        setTransitionError(json.error || 'Transition failed');
        setTransitioning(false);
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['job_detail', params.id] });
      await queryClient.invalidateQueries({ queryKey: ['dispatch_jobs', org?.org_id] });
      await queryClient.invalidateQueries({ queryKey: ['all_jobs', org?.org_id] });
    } catch (err: any) {
      setTransitionError(err.message || 'Network error occurred');
    } finally {
      setTransitioning(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-96 md:col-span-2 bg-muted animate-pulse rounded-lg" />
          <div className="h-96 bg-muted animate-pulse rounded-lg" />
        </div>
      </div>
    );
  }

  if (isError || !data?.job) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
        <h3 className="text-lg font-semibold">Failed to load job details</h3>
        <p className="text-sm text-muted-foreground">{(error as Error)?.message || 'Job not found'}</p>
        <Link href="/jobs">
          <Button variant="outline">Back to Jobs</Button>
        </Link>
      </div>
    );
  }

  const { job, statusEvents, parts } = data;
  const currentState: any = Array.isArray(job.workflow_state)
    ? job.workflow_state[0]
    : job.workflow_state;
  const jobType: any = Array.isArray(job.job_type) ? job.job_type[0] : job.job_type;
  const allowedNext: string[] = currentState?.allowed_next || [];
  const assignments = job.job_assignment || [];
  const leadAssignment = assignments.find((a) => a.is_lead) || assignments[0];

  // Resolve Customer & Site details (supporting both ticket-origin and PM-origin jobs)
  const site: any = job.ticket?.site || job.equipment_unit?.site;
  const party: any = site?.party;
  const equipment: any = job.ticket?.equipment_unit || job.equipment_unit;

  // Determine SLA status display
  const isTerminal = currentState?.is_terminal || false;
  const isAwaitingParts = currentState?.code === 'awaiting_parts';

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Header & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/jobs">
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              <ArrowLeft className="w-4 h-4" />
              All Jobs
            </Button>
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight font-mono">{job.job_no}</h2>
              <JobStatusBadge status={currentState?.code} />
              {jobType && (
                <Badge variant="outline" className="capitalize text-xs font-medium">
                  {jobType.name || jobType.code}
                </Badge>
              )}
              {job.ticket?.priority && <PriorityBadge priority={job.ticket.priority} />}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Created on {format(new Date(job.created_at), 'PPP pp')}
              {job.ticket?.ticket_no && (
                <span>
                  {' '}• Origin:{' '}
                  <Link href={`/tickets/${job.ticket_id}`} className="text-primary hover:underline font-mono font-medium">
                    {job.ticket.ticket_no}
                  </Link>
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SlaTimer resolutionDue={job.resolution_due} breached={job.breached} />
          <Button
            size="sm"
            onClick={() => setIsAssignOpen(true)}
            className="gap-1.5 shadow-sm"
          >
            <User className="w-4 h-4" />
            {assignments.length > 0 ? 'Reassign / Schedule' : 'Assign Technician'}
          </Button>
        </div>
      </div>

      {transitionError && (
        <div className="p-3.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{transitionError}</span>
        </div>
      )}

      {/* Lifecycle Stage Stepper */}
      {(() => {
        const currentCode = currentState?.code || 'open';
        const stepOrder: Record<string, number> = {
          open: 1,
          assigned: 2,
          en_route: 3,
          on_site: 4,
          awaiting_parts: 4,
          completed: 5,
          closed: 5,
          cancelled: -1,
        };
        const currentStepNum = stepOrder[currentCode] ?? 1;
        const mainStages = [
          { num: 1, label: 'Logged / Open' },
          { num: 2, label: 'Assigned' },
          { num: 3, label: 'En Route' },
          { num: 4, label: 'On Site' },
          { num: 5, label: 'Resolved' },
        ];

        return (
          <div className="bg-card border rounded-xl p-4 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-3">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-primary" />
                Job Execution Lifecycle
              </span>
              {currentCode === 'awaiting_parts' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                  <PauseCircle className="w-3 h-3 text-amber-600" />
                  Clock Paused: Awaiting Parts
                </span>
              )}
              {currentCode === 'cancelled' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200">
                  <AlertCircle className="w-3 h-3 text-rose-600" />
                  Cancelled
                </span>
              )}
            </div>

            <div className="grid grid-cols-5 gap-2">
              {mainStages.map((stage) => {
                const isPast = currentStepNum > stage.num;
                const isCurrent = currentStepNum === stage.num;

                return (
                  <div key={stage.num} className="space-y-1.5 text-center">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        isPast
                          ? 'bg-primary'
                          : isCurrent
                          ? currentCode === 'awaiting_parts'
                            ? 'bg-amber-500'
                            : 'bg-primary ring-2 ring-primary/20'
                          : 'bg-muted'
                      }`}
                    />
                    <p
                      className={`text-[11px] truncate font-medium ${
                        isCurrent
                          ? 'text-primary font-bold'
                          : isPast
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {stage.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Workflow Transition Action Bar */}
      {allowedNext.length > 0 && (
        <Card className="bg-primary/5 border-primary/20 shadow-sm">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                Workflow Actions Available
              </p>
              <p className="text-xs text-muted-foreground">
                Current status is &quot;{currentState?.label || currentState?.code}&quot;. Select the next workflow state:
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {allowedNext.map((nextCode) => {
                const label = nextCode
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, (c) => c.toUpperCase());

                const isCancel = nextCode === 'cancelled';

                return (
                  <Button
                    key={nextCode}
                    size="sm"
                    disabled={transitioning}
                    onClick={() => {
                      if (isCancel) {
                        setConfirmCancelOpen(true);
                      } else {
                        handleTransition(nextCode);
                      }
                    }}
                    variant={isCancel ? 'destructive' : 'default'}
                    className="capitalize gap-1.5 text-xs shadow-sm"
                  >
                    Transition to {label}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column (Overview, Timeline, Consumed Parts) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Section 1: Overview */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  Job Overview & Fault Description
                </span>
                <span className="text-xs font-mono font-normal text-muted-foreground">
                  ID: {job.job_id.slice(0, 8)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {/* Fault description */}
              <div>
                <span className="text-xs font-semibold uppercase text-muted-foreground block mb-1">
                  Reported Fault / Service Description
                </span>
                <div className="p-3.5 rounded-lg bg-muted/40 border text-sm whitespace-pre-wrap leading-relaxed">
                  {job.ticket?.fault_description || 'Preventive Maintenance visit or standard inspection.'}
                </div>
              </div>

              {/* Technician Work Notes if present */}
              {job.technician_notes && (
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase text-muted-foreground block">
                    Field Technician Work Notes
                  </span>
                  <div className="p-3.5 rounded-lg bg-amber-50/50 border border-amber-200/60 text-sm italic text-foreground">
                    &quot;{job.technician_notes}&quot;
                  </div>
                </div>
              )}

              {/* Customer Rating & Feedback if closed */}
              {job.customer_rating && (
                <div className="p-3 rounded-lg border bg-emerald-50/30 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                    <span className="font-semibold">Customer Rating: {job.customer_rating} / 5</span>
                  </div>
                  {job.customer_feedback && (
                    <span className="italic text-muted-foreground truncate max-w-xs">
                      &quot;{job.customer_feedback}&quot;
                    </span>
                  )}
                </div>
              )}

              {/* Timestamp Matrix */}
              <div className="pt-2 border-t">
                <span className="text-xs font-semibold uppercase text-muted-foreground block mb-2">
                  Scheduled & Actual Service Timestamps
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-2.5 rounded bg-muted/20 border">
                    <span className="text-muted-foreground block">Scheduled Start</span>
                    <span className="font-medium text-foreground mt-0.5 block">
                      {job.scheduled_start ? format(new Date(job.scheduled_start), 'MMM dd, HH:mm') : 'Unscheduled'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded bg-muted/20 border">
                    <span className="text-muted-foreground block">Scheduled End</span>
                    <span className="font-medium text-foreground mt-0.5 block">
                      {job.scheduled_end ? format(new Date(job.scheduled_end), 'MMM dd, HH:mm') : 'Unscheduled'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded bg-muted/20 border">
                    <span className="text-muted-foreground block">Actual Start</span>
                    <span className="font-medium text-foreground mt-0.5 block">
                      {job.actual_start ? format(new Date(job.actual_start), 'MMM dd, HH:mm') : 'Not started'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded bg-muted/20 border">
                    <span className="text-muted-foreground block">Actual End</span>
                    <span className="font-medium text-foreground mt-0.5 block">
                      {job.actual_end ? format(new Date(job.actual_end), 'MMM dd, HH:mm') : 'Pending completion'}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 4: Status History & Audit Timeline */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Status History & Audit Timeline
                </span>
                <span className="text-xs text-muted-foreground font-normal">
                  {statusEvents.length} recorded events
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {statusEvents.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                  No status transition events logged yet.
                </div>
              ) : (
                <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                  {statusEvents.map((evt) => (
                    <div key={evt.event_id} className="relative space-y-1">
                      <div className="absolute -left-6 top-1.5 w-3 h-3 rounded-full border-2 border-primary bg-background shadow-xs" />
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-foreground">
                          {evt.to_state?.label || evt.to_state?.code || 'Updated'}
                        </span>
                        {evt.from_state && (
                          <span className="text-muted-foreground text-[11px]">
                            (from {evt.from_state.label || evt.from_state.code})
                          </span>
                        )}
                        <span className="text-muted-foreground font-mono text-[11px]">
                          • {format(new Date(evt.changed_at), 'PPP pp')}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>Changed by: <strong className="text-foreground">{evt.person?.full_name || 'System / Dispatcher'}</strong></span>
                        {evt.geo_lat != null && evt.geo_lng != null && (
                          <span className="flex items-center gap-1 font-mono text-[11px] text-blue-600">
                            <Navigation className="w-3 h-3" />
                            GPS: {Number(evt.geo_lat).toFixed(4)}, {Number(evt.geo_lng).toFixed(4)}
                          </span>
                        )}
                        {evt.synced_offline && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1 text-amber-700 bg-amber-50">
                            Synced Offline
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 5: Consumed Parts & Entitlements */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Package className="w-4 h-4 text-primary" />
                  Consumed Spare Parts & Entitlement
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Spare parts logged for this job and their warranty / AMC entitlement.
                </p>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {parts.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                  No spare parts logged for this job.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {parts.map((p: any) => {
                    const totalVal = (Number(p.unit_price) || 0) * (Number(p.quantity) || 1);
                    return (
                      <div
                        key={p.job_part_id}
                        className="p-3.5 border rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs bg-card"
                      >
                        <div className="space-y-0.5">
                          <p className="font-semibold text-sm text-foreground">{p.part?.name || 'Spare Part'}</p>
                          <div className="text-muted-foreground font-mono text-[11px] flex items-center gap-2">
                            {p.part?.part_no && <span>PN: {p.part.part_no}</span>}
                            <span>Qty: {p.quantity}</span>
                            {p.unit_price != null && (
                              <span>• Unit: ₹{Number(p.unit_price).toLocaleString()}</span>
                            )}
                            {totalVal > 0 && (
                              <span className="font-semibold text-foreground">• Total: ₹{totalVal.toLocaleString()}</span>
                            )}
                          </div>
                        </div>

                        <div className="sm:text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                              p.is_chargeable
                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {p.is_chargeable ? 'Chargeable to Customer' : 'Covered by Contract / Warranty'}
                          </span>
                          {p.coverage_source && (
                            <p className="text-muted-foreground text-[10px] mt-0.5 font-mono">
                              Source: {p.coverage_source}
                            </p>
                          )}
                          {p.coverage_explanation && (
                            <p className="text-muted-foreground text-[11px] mt-0.5">
                              {p.coverage_explanation}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Cards (Assignment, SLA, Customer/Site, Equipment) */}
        <div className="space-y-6">
          {/* Section 2: Assignment */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                Technician Assignment
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2"
                onClick={() => setIsAssignOpen(true)}
              >
                {assignments.length > 0 ? 'Change' : 'Assign'}
              </Button>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              {assignments.length === 0 ? (
                <div className="text-center p-6 border border-dashed rounded-lg bg-muted/20">
                  <p className="text-xs text-rose-600 font-semibold mb-2">Currently Unassigned</p>
                  <Button
                    size="sm"
                    className="text-xs h-8 gap-1.5"
                    onClick={() => setIsAssignOpen(true)}
                  >
                    <User className="w-3.5 h-3.5" />
                    Assign Technician Now
                  </Button>
                </div>
              ) : (
                assignments.map((a: any) => (
                  <div key={a.assignment_id} className="p-3.5 border rounded-lg bg-card text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-foreground">
                        {a.person?.full_name || 'Assigned Technician'}
                      </span>
                      {a.is_lead && (
                        <span className="bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded text-[10px] font-bold">
                          Lead Technician
                        </span>
                      )}
                    </div>

                    {a.person?.phone && (
                      <p className="text-muted-foreground flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                        <a href={`tel:${a.person.phone}`} className="hover:underline">
                          {a.person.phone}
                        </a>
                      </p>
                    )}

                    {a.slot_start && (
                      <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px]">
                        <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span>
                          {format(new Date(a.slot_start), 'MMM dd, HH:mm')} -{' '}
                          {a.slot_end ? format(new Date(a.slot_end), 'HH:mm') : ''}
                        </span>
                      </div>
                    )}

                    <div className="pt-2 border-t flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Status:</span>
                      <span
                        className={`capitalize font-semibold px-2 py-0.5 rounded ${
                          a.status === 'accepted'
                            ? 'bg-emerald-100 text-emerald-800'
                            : a.status === 'declined'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Section 3: SLA Targets & Deadlines */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  SLA Deadlines & Compliance
                </span>
                <BreachedIndicator
                  breached={job.breached}
                  resolutionDue={job.resolution_due}
                  isTerminal={isTerminal}
                />
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3.5 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded bg-muted/20 border">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Response Deadline</span>
                  <span className="font-semibold text-foreground text-xs mt-0.5 block">
                    {job.response_due ? format(new Date(job.response_due), 'MMM dd, HH:mm') : 'None defined'}
                  </span>
                </div>
                <ResponseCountdown
                  responseDue={job.response_due}
                  actualStart={job.actual_start}
                  isTerminal={isTerminal}
                />
              </div>

              <div className="flex items-center justify-between p-2.5 rounded bg-muted/20 border">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Resolution Deadline</span>
                  <span className="font-semibold text-foreground text-xs mt-0.5 block font-mono">
                    {job.resolution_due ? format(new Date(job.resolution_due), 'MMM dd, HH:mm') : 'None defined'}
                  </span>
                </div>
                <ResolutionCountdown
                  resolutionDue={job.resolution_due}
                  breached={job.breached}
                  isPaused={isAwaitingParts}
                  isTerminal={isTerminal}
                  actualEnd={job.actual_end}
                />
              </div>

              {job.paused_minutes && job.paused_minutes > 0 ? (
                <div className="p-2 rounded bg-purple-50 text-purple-800 border border-purple-200 flex items-center gap-1.5 text-[11px]">
                  <PauseCircle className="w-3.5 h-3.5 shrink-0 text-purple-600" />
                  <span>SLA clock was paused for {job.paused_minutes} minutes (awaiting parts)</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Customer & Location Card */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                Customer & Site Details
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-sm">
              <div>
                <span className="text-xs text-muted-foreground uppercase font-mono block">Customer Account</span>
                <p className="font-bold text-foreground mt-0.5">{party?.name || 'Walk-in Customer'}</p>
                {party?.phone && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                    <a href={`tel:${party.phone}`} className="hover:underline font-mono text-primary">
                      {party.phone}
                    </a>
                  </p>
                )}
              </div>

              <div className="pt-2.5 border-t">
                <span className="text-xs text-muted-foreground uppercase font-mono block">Service Site Location</span>
                <p className="font-semibold text-foreground mt-0.5">{site?.name || 'Primary Site'}</p>
                {site?.address && (
                  <div className="mt-1 space-y-1">
                    <p className="text-xs text-muted-foreground flex items-start gap-1.5 leading-relaxed">
                      <MapPin className="w-3.5 h-3.5 shrink-0 text-muted-foreground mt-0.5" />
                      <span>{site.address} {site.pincode ? `(${site.pincode})` : ''}</span>
                    </p>
                    <a
                      href={`https://maps.google.com/?q=${encodeURIComponent(site.address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                    >
                      <span>Open in Maps</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                )}
                {site?.contact_name && (
                  <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-dashed">
                    <span className="font-medium text-foreground">Site POC:</span> {site.contact_name}{' '}
                    {site.contact_phone && (
                      <a href={`tel:${site.contact_phone}`} className="text-primary hover:underline font-mono">
                        ({site.contact_phone})
                      </a>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Equipment Unit Card */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Cpu className="w-4 h-4 text-primary" />
                Equipment Unit Details
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-sm">
              {equipment ? (
                <>
                  <div>
                    <span className="text-xs text-muted-foreground uppercase font-mono block">Model & Brand</span>
                    <p className="font-bold text-foreground mt-0.5">
                      {equipment.product_model?.name || 'Standard Equipment'}
                    </p>
                    {equipment.product_model?.brand_name && (
                      <p className="text-xs text-muted-foreground">
                        Brand: {equipment.product_model.brand_name}
                      </p>
                    )}
                  </div>
                  <div className="pt-2 border-t">
                    <span className="text-xs text-muted-foreground uppercase font-mono block">Serial Number</span>
                    <p className="font-mono text-xs font-semibold text-foreground mt-0.5 bg-muted/30 px-2 py-1 rounded inline-block border">
                      {equipment.serial_no || 'N/A'}
                    </p>
                  </div>
                  {equipment.warranty_end && (
                    <div className="pt-2 border-t">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground uppercase font-mono">Warranty Status</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                            new Date(equipment.warranty_end) > new Date()
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          {new Date(equipment.warranty_end) > new Date() ? 'Active' : 'Expired'}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-foreground mt-1">
                        Expires: {format(new Date(equipment.warranty_end), 'PPP')}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground p-4 border border-dashed rounded-lg text-center">
                  No equipment unit linked to this job.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      <Dialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
              Confirm Job Cancellation
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel Job <strong className="font-mono">{job.job_no}</strong>? This is a terminal state that will close out the job and halt further SLA tracking.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              variant="outline"
              onClick={() => setConfirmCancelOpen(false)}
              disabled={transitioning}
            >
              Nevermind
            </Button>
            <Button
              variant="destructive"
              disabled={transitioning}
              onClick={async () => {
                setConfirmCancelOpen(false);
                await handleTransition('cancelled');
              }}
            >
              {transitioning ? 'Cancelling...' : 'Yes, Cancel Job'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assignment Modal */}
      <AssignmentModal
        jobId={job.job_id}
        jobNo={job.job_no}
        isOpen={isAssignOpen}
        onClose={() => setIsAssignOpen(false)}
        defaultTechnicianId={leadAssignment?.person_id}
        defaultDate={job.scheduled_start ? job.scheduled_start.split('T')[0] : undefined}
        onSuccess={() => {
          refetch();
          queryClient.invalidateQueries({ queryKey: ['dispatch_jobs', org?.org_id] });
          queryClient.invalidateQueries({ queryKey: ['all_jobs', org?.org_id] });
        }}
      />
    </div>
  );
}
