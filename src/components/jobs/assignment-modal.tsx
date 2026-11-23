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
import { UserCheck, Calendar, Clock, AlertCircle } from 'lucide-react';

interface AssignmentModalProps {
  jobId: string | null;
  jobNo?: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultTechnicianId?: string;
  defaultDate?: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  defaultIsLead?: boolean;
}

interface TechnicianOption {
  person_id: string;
  full_name: string;
  phone?: string | null;
}

export function AssignmentModal({
  jobId,
  jobNo,
  isOpen,
  onClose,
  onSuccess,
  defaultTechnicianId,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  defaultIsLead = true,
}: AssignmentModalProps) {
  const { org } = useOrg();
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [selectedTech, setSelectedTech] = useState<string>('');
  const [date, setDate] = useState<string>(
    () => defaultDate || new Date().toISOString().split('T')[0]
  );
  const [startTime, setStartTime] = useState<string>(defaultStartTime || '10:00');
  const [endTime, setEndTime] = useState<string>(defaultEndTime || '12:00');
  const [isLead, setIsLead] = useState<boolean>(defaultIsLead);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setErrorMsg(null);
    if (defaultDate) setDate(defaultDate);
    if (defaultStartTime) setStartTime(defaultStartTime);
    if (defaultEndTime) setEndTime(defaultEndTime);
    if (defaultIsLead !== undefined) setIsLead(defaultIsLead);

    if (!org?.org_id) return;

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
        setSelectedTech((prev) => {
          if (defaultTechnicianId) return defaultTechnicianId;
          return prev || (list.length > 0 ? list[0].person_id : '');
        });
      }
    }

    loadTechnicians();
  }, [isOpen, org?.org_id, defaultTechnicianId, defaultDate, defaultStartTime, defaultEndTime, defaultIsLead]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobId || !selectedTech) {
      setErrorMsg('Please select a technician');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const slotStart = new Date(`${date}T${startTime}:00`).toISOString();
      const slotEnd = new Date(`${date}T${endTime}:00`).toISOString();

      if (new Date(slotEnd) <= new Date(slotStart)) {
        setErrorMsg('End time must be after start time');
        setLoading(false);
        return;
      }

      const res = await fetch(`/api/jobs/${jobId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personId: selectedTech,
          slotStart,
          slotEnd,
          isLead,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Assignment failed');
        setLoading(false);
        return;
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-primary" />
            Assign Technician
          </DialogTitle>
          <DialogDescription>
            {jobNo ? `Assigning job ${jobNo}` : 'Select a technician and schedule a visit slot.'}
          </DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <div className="flex items-center gap-2 p-3 text-xs rounded-md bg-rose-50 text-rose-800 border border-rose-200">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="tech-select">Technician</Label>
            {technicians.length === 0 ? (
              <div className="text-xs text-muted-foreground p-2 border rounded bg-muted/40">
                No active technicians found in this organisation. (Add technicians in Settings / Technicians)
              </div>
            ) : (
              <select
                id="tech-select"
                value={selectedTech}
                onChange={(e) => setSelectedTech(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              >
                {technicians.map((t) => (
                  <option key={t.person_id} value={t.person_id}>
                    {t.full_name} {t.phone ? `(${t.phone})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slot-date" className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Visit Date
            </Label>
            <Input
              id="slot-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

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

          {/* Slot duration preview */}
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-muted/30 border text-[11px] text-muted-foreground font-mono">
            <span>Slot Duration:</span>
            <span className="font-semibold text-foreground">
              {(() => {
                try {
                  const s = new Date(`1970-01-01T${startTime}:00`).getTime();
                  const e = new Date(`1970-01-01T${endTime}:00`).getTime();
                  const diffMins = Math.floor((e - s) / 60000);
                  if (diffMins > 0) {
                    const h = Math.floor(diffMins / 60);
                    const m = diffMins % 60;
                    return `${h > 0 ? `${h}h ` : ''}${m > 0 ? `${m}m` : ''}`.trim();
                  }
                  return 'Invalid duration';
                } catch {
                  return '—';
                }
              })()}
            </span>
          </div>

          <div className="flex items-center space-x-2 pt-1">
            <input
              type="checkbox"
              id="is-lead"
              checked={isLead}
              onChange={(e) => setIsLead(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <Label htmlFor="is-lead" className="text-sm font-normal cursor-pointer">
              Assign as lead technician for this job
            </Label>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !selectedTech}>
              {loading ? 'Assigning...' : 'Confirm Assignment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
