'use client';

import Link from 'next/link';
import type { Job } from '@/types';
import { PriorityBadge } from '@/components/jobs/job-status-badge';
import { SlaTimer } from '@/components/dispatch/sla-timer';
import { Button } from '@/components/ui/button';
import {
  MapPin,
  Cpu,
  ArrowUpRight,
  Calendar,
  UserCheck,
  Wrench,
  Building2,
} from 'lucide-react';
import { format } from 'date-fns';

interface JobCardProps {
  job: Job;
  onAssignClick: (job: Job) => void;
}

export function JobCard({ job, onAssignClick }: JobCardProps) {
  // Extract customer and site (supporting both ticket-backed and PM-backed jobs)
  const site = job.ticket?.site || job.equipment_unit?.site;
  const party = site?.party;
  const customerName = party?.name || 'Walk-in / Direct Customer';
  const siteName = site?.name || 'Primary Site';

  // Extract equipment details
  const equipment = job.ticket?.equipment_unit || job.equipment_unit;
  const modelName = equipment?.product_model?.name || 'Equipment Unit';
  const brandName = equipment?.product_model?.brand_name;
  const serialNo = equipment?.serial_no;

  // Extract lead assignment
  const assignments = job.job_assignment || [];
  const activeAssignments = assignments.filter((a) => a.status !== 'declined');
  const leadAssignment =
    activeAssignments.find((a) => a.is_lead) || activeAssignments[0];
  const tech = leadAssignment?.person;
  const techName = tech?.full_name;

  // Workflow state properties
  const state = Array.isArray(job.workflow_state)
    ? job.workflow_state[0]
    : job.workflow_state;
  const isTerminal = state?.is_terminal ?? false;
  const stopsSlaClock = state?.stops_sla_clock ?? false;

  // Scheduled date/time
  const scheduledTime = job.scheduled_start
    ? format(new Date(job.scheduled_start), 'MMM dd, HH:mm')
    : null;

  // Get technician initials
  const initials = techName
    ? techName
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : null;

  return (
    <div className="group bg-card border border-border/70 rounded-xl p-3.5 shadow-xs hover:shadow-md hover:border-primary/40 hover:-translate-y-0.5 transition-all duration-200 space-y-3 relative">
      {/* Top Header: Job No, Ticket No & Priority */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link
              href={`/jobs/${job.job_id}`}
              className="font-bold text-sm text-foreground hover:text-primary transition-colors flex items-center gap-1 font-mono tracking-tight"
            >
              <span>{job.job_no}</span>
              <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
            </Link>
            <PriorityBadge priority={job.ticket?.priority} />
          </div>

          {/* Ticket Number or PM indicator */}
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            {job.ticket?.ticket_no ? (
              <span className="flex items-center gap-1 truncate">
                Origin:
                <Link
                  href={`/tickets/${job.ticket_id}`}
                  className="hover:text-primary hover:underline font-mono text-foreground/80 font-medium truncate"
                >
                  {job.ticket.ticket_no}
                </Link>
              </span>
            ) : job.pm_visit_id ? (
              <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold font-mono text-[10px]">
                <Wrench className="w-3 h-3" /> PM Routine Visit
              </span>
            ) : (
              <span className="font-mono text-[11px] text-muted-foreground">Direct Service</span>
            )}
          </div>
        </div>

        {/* SLA Timer */}
        <div className="shrink-0">
          <SlaTimer
            resolutionDue={job.resolution_due}
            breached={job.breached}
            stopsSlaClock={stopsSlaClock}
            isTerminal={isTerminal}
            compact
          />
        </div>
      </div>

      {/* Customer and Site Location */}
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-foreground truncate">
          <Building2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate" title={customerName}>{customerName}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground truncate text-[11px]">
          <MapPin className="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />
          <span className="truncate" title={siteName}>{siteName}</span>
        </div>
      </div>

      {/* Equipment Model & Serial Number */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 hover:bg-muted/50 transition-colors p-2 rounded-lg border border-border/40 truncate">
        <Cpu className="w-3.5 h-3.5 shrink-0 text-primary" />
        <span className="truncate text-[11px]">
          <strong className="text-foreground font-medium">{modelName}</strong>
          {brandName ? ` • ${brandName}` : ''}
          {serialNo ? <span className="font-mono text-muted-foreground"> • SN: {serialNo}</span> : ''}
        </span>
      </div>

      {/* Scheduled Time Banner if scheduled */}
      {scheduledTime && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono bg-blue-50/50 dark:bg-blue-950/20 px-2 py-1 rounded border border-blue-200/40">
          <Calendar className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span className="text-[11px]">Slot: <strong className="text-foreground font-medium">{scheduledTime}</strong></span>
        </div>
      )}

      {/* Fault Preview Description */}
      {job.ticket?.fault_description && (
        <p className="text-xs text-muted-foreground line-clamp-2 italic bg-muted/20 px-2.5 py-1.5 rounded-md border-l-2 border-primary/40 leading-relaxed">
          &ldquo;{job.ticket.fault_description}&rdquo;
        </p>
      )}

      {/* Bottom Footer: Technician & Assignment Action */}
      <div className="pt-2.5 border-t border-border/60 flex items-center justify-between gap-2 text-xs">
        <div className="truncate flex-1">
          {techName ? (
            <div className="flex items-center gap-1.5 truncate">
              {initials ? (
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-[9px] flex items-center justify-center shrink-0 border border-primary/20">
                  {initials}
                </span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              )}
              <span className="font-semibold text-foreground truncate text-[11px]">{techName}</span>
              {leadAssignment?.is_lead && (
                <span className="text-[9px] bg-primary/10 text-primary font-bold px-1 rounded uppercase tracking-wider">
                  Lead
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-rose-600 font-semibold truncate text-[11px]">
              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 animate-ping" />
              <span>Unassigned</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant={techName ? 'outline' : 'default'}
            className="h-7 text-xs px-2.5 shadow-2xs font-medium"
            onClick={() => onAssignClick(job)}
          >
            {techName ? (
              <span className="flex items-center gap-1">
                <UserCheck className="w-3 h-3" /> Reassign
              </span>
            ) : (
              <span className="flex items-center gap-1 font-semibold">
                <UserCheck className="w-3 h-3" /> Assign
              </span>
            )}
          </Button>

          <Link href={`/jobs/${job.job_id}`}>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-muted" title="View Job Details">
              <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
