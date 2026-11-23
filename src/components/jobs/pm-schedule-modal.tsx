'use client';

import { useState, useEffect } from 'react';
import { useOrg } from '@/hooks/use-org';
import { createClient } from '@/lib/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Calendar,
  Clock,
  User,
  AlertCircle,
  Wrench,
  Building2,
  MapPin,
  Cpu,
  FileText,
} from 'lucide-react';
import { format } from 'date-fns';

export interface PmVisitDetails {
  pm_visit_id: string;
  due_date: string;
  grace_days?: number;
  status: string;
  contract?: {
    contract_id?: string;
    contract_no?: string;
  };
  customer?: {
    name?: string;
    phone?: string | null;
  };
  site?: {
    name?: string;
    address?: string | null;
    contact_name?: string | null;
    contact_phone?: string | null;
  };
  equipment?: {
    unit_id?: string;
    serial_no?: string;
    model_name?: string;
    brand_name?: string | null;
  };
}

interface TechnicianOption {
  person_id: string;
  full_name: string;
  phone?: string | null;
}

interface PmScheduleModalProps {
  visit: PmVisitDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (job: any) => void;
}

export function PmScheduleModal({
  visit,
  isOpen,
  onClose,
  onSuccess,
}: PmScheduleModalProps) {
  const { org } = useOrg();
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [selectedTech, setSelectedTech] = useState<string>('');
  const [scheduledDate, setScheduledDate] = useState<string>(
    () => new Date().toISOString().split('T')[0]
  );
  const [startTime, setStartTime] = useState<string>('10:00');
  const [endTime, setEndTime] = useState<string>('12:00');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Calculate slot duration preview
  const durationText = (() => {
    try {
      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);
      const totalStartMin = startH * 60 + startM;
      const totalEndMin = endH * 60 + endM;
      const diffMin = totalEndMin - totalStartMin;
      if (diffMin <= 0) return null;
      const hours = Math.floor(diffMin / 60);
      const mins = diffMin % 60;
      if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
      if (hours > 0) return `${hours}h`;
      return `${mins}m`;
    } catch {
      return null;
    }
  })();

  // Initialize form state when visit opens
  useEffect(() => {
    if (!isOpen || !visit) return;
    setErrorMsg(null);

    if (visit.due_date) {
      setScheduledDate(visit.due_date.split('T')[0]);
    }

    if (!org?.org_id) return;

    // Load active technicians
    async function loadTechnicians() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('org_membership')
        .select('person_id, role, is_active, person(person_id, full_name, phone)')
        .eq('org_id', org.org_id)
        .eq('role', 'technician')
        .eq('is_active', true);

      if (!error && data) {
        const list: TechnicianOption[] = [];
        for (const item of data) {
          const p = Array.isArray(item.person) ? item.person[0] : item.person;
          if (p) {
            list.push({
              person_id: p.person_id,
              full_name: p.full_name,
              phone: p.phone,
            });
          }
        }
        setTechnicians(list);
      }
    }

    loadTechnicians();
  }, [isOpen, visit, org?.org_id]);

  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!visit || !org?.org_id) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      const scheduledStart = new Date(`${scheduledDate}T${startTime}:00`).toISOString();
      const scheduledEnd = new Date(`${scheduledDate}T${endTime}:00`).toISOString();

      if (new Date(scheduledEnd) <= new Date(scheduledStart)) {
        setErrorMsg('End time must be after start time');
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/pm-visits/${visit.pm_visit_id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: org.org_id,
          scheduledStart,
          scheduledEnd,
          technicianId: selectedTech || null,
          isLead: true,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Failed to schedule PM visit');
        setLoading(false);
        return;
      }

      onSuccess(json.job);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error occurred while scheduling PM visit');
    } finally {
      setLoading(false);
    }
  }

  if (!visit) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-primary" />
            Schedule Preventive Maintenance Job
          </DialogTitle>
          <DialogDescription>
            Convert this pending PM visit into an active field service job.
          </DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <div className="p-3 text-xs rounded-md bg-rose-50 text-rose-800 border border-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="space-y-3 py-1 text-xs">
          {/* Equipment & Contract Details */}
          <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-primary" />
                {visit.equipment?.model_name || 'Equipment Unit'}{' '}
                {visit.equipment?.brand_name ? `(${visit.equipment.brand_name})` : ''}
              </span>
              <span className="font-mono text-muted-foreground text-[11px]">
                SN: {visit.equipment?.serial_no || 'N/A'}
              </span>
            </div>

            {visit.contract?.contract_no && (
              <p className="text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-muted-foreground" />
                Contract: <strong className="text-foreground font-mono">{visit.contract.contract_no}</strong>
              </p>
            )}
          </div>

          {/* Customer & Site Details */}
          <div className="p-3 rounded-lg border bg-muted/30 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-primary" />
                {visit.customer?.name || 'Customer'}
              </span>
              {visit.customer?.phone && (
                <span className="text-muted-foreground">{visit.customer.phone}</span>
              )}
            </div>
            {visit.site?.name && (
              <div className="text-muted-foreground flex items-center gap-1.5">
                <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="truncate">{visit.site.name} {visit.site.address ? `• ${visit.site.address}` : ''}</span>
              </div>
            )}
          </div>

          {/* PM Due Date Banner */}
          <div className="flex items-center justify-between px-3 py-2 rounded border bg-blue-50 text-blue-900 text-xs">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-blue-700" />
              PM Due Date: <strong>{format(new Date(visit.due_date), 'PPP')}</strong>
            </span>
            {visit.grace_days != null && (
              <span className="text-[11px] text-blue-700 font-mono">
                Grace: +{visit.grace_days}d
              </span>
            )}
          </div>
        </div>

        {/* Scheduling Form */}
        <form onSubmit={handleSchedule} className="space-y-4 pt-2">
          {/* Technician Selection */}
          <div className="space-y-1.5">
            <Label htmlFor="pm-tech" className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              Assign Technician (Optional)
            </Label>
            <select
              id="pm-tech"
              value={selectedTech}
              onChange={(e) => setSelectedTech(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Leave Unassigned (Assign Later on Dispatch Board)</option>
              {technicians.map((t) => (
                <option key={t.person_id} value={t.person_id}>
                  {t.full_name} {t.phone ? `(${t.phone})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Visit Date */}
          <div className="space-y-1.5">
            <Label htmlFor="pm-date" className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Scheduled Visit Date
            </Label>
            <Input
              id="pm-date"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              required
            />
          </div>

          {/* Time Slot */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start-time" className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Start Time
              </Label>
              <Input
                id="start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end-time" className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                End Time
              </Label>
              <Input
                id="end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          {durationText && (
            <div className="flex items-center justify-end">
              <span className="text-[11px] font-mono text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border inline-flex items-center gap-1 shadow-2xs">
                <Clock className="w-3 h-3 text-primary" />
                Slot Duration: <strong className="text-foreground">{durationText}</strong>
              </span>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating Job...' : 'Confirm & Schedule Job'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
