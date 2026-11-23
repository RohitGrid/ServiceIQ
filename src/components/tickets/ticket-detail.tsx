'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useOrg } from '@/hooks/use-org';
import { createClient } from '@/lib/supabase/client';
import type { Priority, TicketStatus } from '@/types';
import { PriorityBadge, TicketStatusBadge, JobStatusBadge } from '@/components/jobs/job-status-badge';
import { SlaTimer } from '@/components/dispatch/sla-timer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Wrench,
  AlertCircle,
  ExternalLink,
  Phone,
  Edit,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { format } from 'date-fns';

interface TicketDetailProps {
  ticketId: string;
}

export function TicketDetail({ ticketId }: TicketDetailProps) {
  const { org } = useOrg();
  const queryClient = useQueryClient();

  // Edit Ticket Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editPriority, setEditPriority] = useState<Priority>('P2');
  const [editStatus, setEditStatus] = useState<TicketStatus>('in_progress');
  const [editFaultDescription, setEditFaultDescription] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['ticket_detail', ticketId],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${ticketId}`);
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Failed to fetch ticket');
      }
      return res.json();
    },
  });

  function openEditDialog() {
    if (!data?.ticket) return;
    setEditPriority(data.ticket.priority || 'P2');
    setEditStatus(data.ticket.status || 'open');
    setEditFaultDescription(data.ticket.fault_description || '');
    setSaveError(null);
    setSaveSuccessMsg(null);
    setIsEditModalOpen(true);
  }

  async function handleSaveTicketEdit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setSaveError(null);

    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priority: editPriority,
          status: editStatus,
          faultDescription: editFaultDescription,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to update ticket');
      }

      await queryClient.invalidateQueries({ queryKey: ['ticket_detail', ticketId] });
      await queryClient.invalidateQueries({ queryKey: ['tickets', org?.org_id] });
      setSaveSuccessMsg('Ticket updated successfully');
      setIsEditModalOpen(false);
    } catch (err: any) {
      setSaveError(err.message || 'Error updating ticket');
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-64 md:col-span-2 bg-muted animate-pulse rounded-lg" />
          <div className="h-64 bg-muted animate-pulse rounded-lg" />
        </div>
      </div>
    );
  }

  if (isError || !data?.ticket) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
        <h3 className="text-lg font-semibold">Failed to load ticket</h3>
        <p className="text-sm text-muted-foreground">{(error as Error)?.message || 'Ticket not found'}</p>
        <Link href="/tickets">
          <Button variant="outline">Back to Tickets</Button>
        </Link>
      </div>
    );
  }

  const { ticket, jobs } = data;
  const site: any = Array.isArray(ticket.site) ? ticket.site[0] : ticket.site;
  const party = site?.party;
  const equipment: any = Array.isArray(ticket.equipment_unit)
    ? ticket.equipment_unit[0]
    : ticket.equipment_unit;
  const model = equipment?.product_model;

  // Primary linked job
  const primaryJob = jobs && jobs.length > 0 ? jobs[0] : null;
  const isWarrantyActive =
    equipment?.warranty_end && new Date(equipment.warranty_end) > new Date();

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Header & Breadcrumbs */}
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Link href="/tickets" className="hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" />
            Tickets
          </Link>
          <span>/</span>
          <span className="font-mono text-foreground font-medium">{ticket.ticket_no}</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-2xl font-bold tracking-tight font-mono text-foreground">{ticket.ticket_no}</h2>
              <PriorityBadge priority={ticket.priority} />
              <TicketStatusBadge status={ticket.status} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Reported on {format(new Date(ticket.reported_at), 'PPP pp')} via{' '}
              <span className="uppercase font-mono px-1.5 py-0.5 rounded bg-muted/60 border text-[10px] font-medium text-foreground">
                {ticket.source}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={openEditDialog} className="gap-1.5 shadow-xs">
              <Edit className="w-3.5 h-3.5" />
              Edit Ticket
            </Button>

            {primaryJob && (
              <Link href={`/jobs/${primaryJob.job_id}`}>
                <Button size="sm" className="gap-1.5 shadow-xs">
                  <Wrench className="w-4 h-4" />
                  Associated Job ({primaryJob.job_no})
                </Button>
              </Link>
            )}

            <Link href="/dispatch">
              <Button variant="secondary" size="sm" className="gap-1.5 shadow-xs">
                Dispatch Board
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {saveSuccessMsg && (
        <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Column */}
        <div className="md:col-span-2 space-y-6">
          {/* Fault Description Card */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-semibold">Reported Fault Description</CardTitle>
              <Button variant="ghost" size="sm" onClick={openEditDialog} className="h-7 text-xs text-muted-foreground">
                Edit
              </Button>
            </CardHeader>
            <CardContent>
              <div className="p-4 rounded-lg bg-muted/40 border text-sm whitespace-pre-wrap leading-relaxed">
                {ticket.fault_description || 'No fault description provided.'}
              </div>
            </CardContent>
          </Card>

          {/* Linked Jobs Card */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-primary" />
                  Associated Field Service Jobs
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Visits and execution status linked to this ticket.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {jobs.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground border border-dashed rounded-lg bg-muted/10">
                  <Wrench className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="font-medium text-foreground">No field jobs linked yet</p>
                  <p className="text-xs text-muted-foreground mt-0.5">A job is automatically created when submitting tickets.</p>
                </div>
              ) : (
                jobs.map((job: any) => {
                  const state = Array.isArray(job.workflow_state)
                    ? job.workflow_state[0]
                    : job.workflow_state;
                  const assignments = job.job_assignment || [];
                  const leadAssignment =
                    assignments.find((a: any) => a.is_lead) || assignments[0];
                  const leadTech = leadAssignment?.person?.full_name;

                  return (
                    <div
                      key={job.job_id}
                      className="p-4 border rounded-xl hover:border-primary/40 hover:shadow-sm transition-all bg-card space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/jobs/${job.job_id}`}
                            className="font-bold text-base hover:underline flex items-center gap-1.5 text-primary font-mono tracking-tight"
                          >
                            <span>{job.job_no}</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                          <JobStatusBadge status={state?.code} />
                        </div>
                        <SlaTimer resolutionDue={job.resolution_due} breached={job.breached} />
                      </div>

                      {/* Job details grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2.5 border-t text-muted-foreground items-center">
                        <div className="flex items-center gap-2">
                          {leadTech ? (
                            <>
                              <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-[10px] shrink-0">
                                {leadTech.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                              </div>
                              <div className="truncate">
                                <span className="text-[10px] uppercase font-mono block text-muted-foreground">Lead Tech</span>
                                <span className="font-semibold text-foreground text-xs">{leadTech}</span>
                              </div>
                            </>
                          ) : (
                            <div>
                              <span className="text-[10px] uppercase font-mono block text-muted-foreground">Assignment</span>
                              <span className="text-rose-600 font-semibold text-xs flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                                Unassigned
                              </span>
                            </div>
                          )}
                        </div>

                        <div>
                          <span className="text-[10px] uppercase font-mono block text-muted-foreground">Scheduled Window</span>
                          <p className="font-medium text-foreground text-xs">
                            {job.scheduled_start ? format(new Date(job.scheduled_start), 'MMM dd, HH:mm') : 'Unscheduled'}
                          </p>
                        </div>

                        <div className="flex sm:justify-end">
                          <Link href={`/jobs/${job.job_id}`}>
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 w-full sm:w-auto shadow-2xs">
                              View Details
                              <ArrowRight className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Info Cards */}
        <div className="space-y-6">
          {/* Customer & Site Card */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                Customer & Site
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3.5 text-sm">
              <div>
                <span className="text-[11px] text-muted-foreground uppercase font-mono tracking-wider block">
                  Customer Party
                </span>
                <p className="font-bold text-foreground text-sm mt-0.5">{party?.name || 'Walk-in Customer'}</p>
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
                <span className="text-[11px] text-muted-foreground uppercase font-mono tracking-wider block">
                  Site / Branch
                </span>
                <p className="font-medium text-foreground mt-0.5">{site?.name || 'Primary Location'}</p>
                {site?.address && (
                  <div className="mt-1 space-y-1">
                    <p className="text-xs text-muted-foreground flex items-start gap-1.5 leading-relaxed">
                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                      <span>{site.address}</span>
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
                  <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-dashed">
                    Contact: <strong className="text-foreground">{site.contact_name}</strong>{' '}
                    {site.contact_phone && (
                      <a href={`tel:${site.contact_phone}`} className="font-mono text-primary hover:underline">
                        ({site.contact_phone})
                      </a>
                    )}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Equipment Unit Card */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Cpu className="w-4 h-4 text-primary" />
                Equipment Unit
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-sm">
              {equipment ? (
                <>
                  <div>
                    <span className="text-[11px] text-muted-foreground uppercase font-mono tracking-wider block">
                      Product Model
                    </span>
                    <p className="font-bold text-foreground mt-0.5">
                      {model?.name || 'Standard Equipment'}
                    </p>
                    {model?.brand_name && (
                      <p className="text-xs text-muted-foreground">
                        Brand: {model.brand_name}
                      </p>
                    )}
                  </div>
                  <div className="pt-2 border-t">
                    <span className="text-[11px] text-muted-foreground uppercase font-mono tracking-wider block">
                      Serial Number
                    </span>
                    <p className="font-mono text-xs font-semibold text-foreground mt-0.5 bg-muted/30 px-2 py-1 rounded inline-block border">
                      {equipment.serial_no || 'N/A'}
                    </p>
                  </div>
                  {equipment.warranty_end && (
                    <div className="pt-2 border-t">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground uppercase font-mono tracking-wider">
                          Warranty Status
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                            isWarrantyActive
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          {isWarrantyActive ? 'Active Warranty' : 'Expired'}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-foreground mt-1">
                        Expires: {format(new Date(equipment.warranty_end), 'PPP')}
                      </p>
                    </div>
                  )}
                  {equipment.unit_id && (
                    <div className="pt-2">
                      <Link href={`/equipment/${equipment.unit_id}`}>
                        <Button size="sm" variant="outline" className="w-full text-xs shadow-2xs">
                          View Equipment History
                        </Button>
                      </Link>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground p-4 text-center border border-dashed rounded-lg">
                  No specific equipment unit linked to this ticket.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Ticket Modal Dialog */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-4 h-4 text-primary" />
              Edit Ticket: {ticket.ticket_no}
            </DialogTitle>
            <DialogDescription>
              Update priority, ticket status, or the fault description.
            </DialogDescription>
          </DialogHeader>

          {saveError && (
            <div className="p-3 text-xs rounded-md bg-rose-50 text-rose-800 border border-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{saveError}</span>
            </div>
          )}

          <form onSubmit={handleSaveTicketEdit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-priority">Priority</Label>
                <select
                  id="edit-priority"
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as Priority)}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                >
                  <option value="P1">P1 (Critical)</option>
                  <option value="P2">P2 (Standard)</option>
                  <option value="P3">P3 (Low)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-status">Status</Label>
                <select
                  id="edit-status"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as TicketStatus)}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="awaiting_parts">Awaiting Parts</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">Fault Description</Label>
              <Textarea
                id="edit-desc"
                rows={4}
                value={editFaultDescription}
                onChange={(e) => setEditFaultDescription(e.target.value)}
                required
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditModalOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving Changes...' : 'Save Ticket Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
