'use client';

import { useState, useEffect } from 'react';
import { Clock, AlertTriangle, AlertCircle, CheckCircle2, PauseCircle } from 'lucide-react';
import { format } from 'date-fns';

interface SlaTimerProps {
  resolutionDue?: string | null;
  responseDue?: string | null;
  breached?: boolean;
  isPaused?: boolean;
  isTerminal?: boolean;
  actualStart?: string | null;
  actualEnd?: string | null;
  className?: string;
}

/**
 * Timezone-safe countdown calculation using UTC epoch milliseconds.
 */
function formatDuration(ms: number) {
  const absMs = Math.abs(ms);
  const totalMinutes = Math.floor(absMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * 1. Response Countdown Component
 * Displays time until initial technician arrival / first response deadline.
 */
export function ResponseCountdown({
  responseDue,
  actualStart,
  isTerminal = false,
  className = '',
}: {
  responseDue?: string | null;
  actualStart?: string | null;
  isTerminal?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!responseDue || actualStart || isTerminal) return;
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [responseDue, actualStart, isTerminal]);

  // If already responded (technician arrived on site)
  if (actualStart) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 ${className}`}
        title={`Responded at ${format(new Date(actualStart), 'PP p')}`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span>Responded</span>
      </span>
    );
  }

  if (!responseDue) {
    return <span className={`text-muted-foreground text-xs ${className}`}>No SLA</span>;
  }

  const dueTime = new Date(responseDue).getTime();
  const diff = dueTime - now;
  const isBreached = diff < 0;

  if (isBreached) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-300 ${className}`}
      >
        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 animate-pulse" />
        <span>Resp. BREACHED {formatDuration(diff)} ago</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-800 border border-blue-200 ${className}`}
    >
      <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
      <span>Resp. due in {formatDuration(diff)}</span>
    </span>
  );
}

/**
 * 2. Resolution Countdown Component
 * Displays live countdown until resolution, pausing on parts or terminal status.
 */
export function ResolutionCountdown({
  resolutionDue,
  breached = false,
  isPaused = false,
  isTerminal = false,
  actualEnd,
  className = '',
}: {
  resolutionDue?: string | null;
  breached?: boolean;
  isPaused?: boolean;
  isTerminal?: boolean;
  actualEnd?: string | null;
  className?: string;
}) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (isTerminal || isPaused || !resolutionDue) return;
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [resolutionDue, isTerminal, isPaused]);

  if (isTerminal) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium ${
          breached
            ? 'bg-rose-50 text-rose-700 border border-rose-200'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        } ${className}`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>Completed {breached ? '(SLA Breached)' : '(Within SLA)'}</span>
      </span>
    );
  }

  if (isPaused) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200 ${className}`}
      >
        <PauseCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        <span>SLA Paused</span>
      </span>
    );
  }

  if (!resolutionDue) {
    return <span className={`text-muted-foreground text-xs ${className}`}>No SLA</span>;
  }

  const dueTime = new Date(resolutionDue).getTime();
  const diff = dueTime - now;
  const isPast = diff < 0;

  if (breached || isPast) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-300 ${className}`}
      >
        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 animate-pulse" />
        <span>BREACHED {formatDuration(diff)} ago</span>
      </span>
    );
  }

  // Warning when less than 60 minutes remain
  const isUrgent = diff < 3600000;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium ${
        isUrgent
          ? 'bg-amber-100 text-amber-900 border border-amber-300'
          : 'bg-slate-100 text-slate-800 border border-slate-200'
      } ${className}`}
    >
      <Clock className={`w-3.5 h-3.5 shrink-0 ${isUrgent ? 'text-amber-700' : 'text-slate-600'}`} />
      <span>Due in {formatDuration(diff)}</span>
    </span>
  );
}

/**
 * 3. Breached Indicator Badge
 * Highlights whether the job breached SLA, is at imminent risk, or within SLA targets.
 */
export function BreachedIndicator({
  breached = false,
  resolutionDue,
  isTerminal = false,
  className = '',
}: {
  breached?: boolean;
  resolutionDue?: string | null;
  isTerminal?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (isTerminal || !resolutionDue) return;
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, [resolutionDue, isTerminal]);

  const dueTime = resolutionDue ? new Date(resolutionDue).getTime() : null;
  const isPast = dueTime ? dueTime < now : false;

  if (breached || isPast) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-300 ${className}`}
      >
        <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
        <span>Breached</span>
      </span>
    );
  }

  if (dueTime && dueTime - now < 3600000 && !isTerminal) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-900 border border-amber-300 ${className}`}
      >
        <Clock className="w-3 h-3 text-amber-700 shrink-0" />
        <span>At Risk</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 ${className}`}
    >
      <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
      <span>{isTerminal ? 'Met SLA' : 'On Track'}</span>
    </span>
  );
}

/**
 * 4. Completed / Terminal Job Badge
 * Clean badge summarizing terminal state resolution metrics.
 */
export function CompletedTerminalBadge({
  stateCode = 'closed',
  breached = false,
  actualEnd,
  className = '',
}: {
  stateCode?: string;
  breached?: boolean;
  actualEnd?: string | null;
  className?: string;
}) {
  const label =
    stateCode === 'cancelled'
      ? 'Cancelled'
      : stateCode === 'skipped'
      ? 'Skipped'
      : 'Resolved';

  return (
    <div className={`inline-flex items-center gap-1.5 text-xs ${className}`}>
      <span
        className={`px-2 py-0.5 rounded font-semibold text-[11px] ${
          stateCode === 'cancelled' || stateCode === 'skipped'
            ? 'bg-slate-100 text-slate-700 border'
            : breached
            ? 'bg-rose-100 text-rose-800 border border-rose-200'
            : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
        }`}
      >
        {label}
        {stateCode === 'closed' && (breached ? ' • Breached' : ' • Within SLA')}
      </span>
      {actualEnd && (
        <span className="text-[11px] text-muted-foreground font-mono">
          {format(new Date(actualEnd), 'MMM dd, HH:mm')}
        </span>
      )}
    </div>
  );
}
