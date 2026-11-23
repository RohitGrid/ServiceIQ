'use client';

import { useEffect, useState } from 'react';
import { Clock, AlertTriangle, PauseCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SlaTimerProps {
  resolutionDue: string | null | undefined;
  breached?: boolean;
  stopsSlaClock?: boolean;
  isTerminal?: boolean;
  className?: string;
  compact?: boolean;
}

export function SlaTimer({
  resolutionDue,
  breached: breachedProp,
  stopsSlaClock = false,
  isTerminal = false,
  className,
  compact = false,
}: SlaTimerProps) {
  const [, setTick] = useState(0);

  // Update timer every 30 seconds
  useEffect(() => {
    if (isTerminal || stopsSlaClock || !resolutionDue) return;
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, [isTerminal, stopsSlaClock, resolutionDue]);

  if (isTerminal) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/60',
          className
        )}
      >
        <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        <span>SLA Closed</span>
      </div>
    );
  }

  if (stopsSlaClock) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200/60',
          className
        )}
        title="SLA clock paused while awaiting parts"
      >
        <PauseCircle className="w-3.5 h-3.5 shrink-0 text-purple-600" />
        <span>SLA Paused</span>
      </div>
    );
  }

  if (!resolutionDue) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        No SLA target
      </span>
    );
  }

  const dueTime = new Date(resolutionDue).getTime();
  const diff = dueTime - Date.now();
  const isBreached = breachedProp || diff < 0;
  const absDiff = Math.abs(diff);

  const days = Math.floor(absDiff / 86400000);
  const hours = Math.floor((absDiff % 86400000) / 3600000);
  const mins = Math.floor((absDiff % 3600000) / 60000);

  let formattedTime = '';
  if (days > 0) {
    formattedTime = `${days}d ${hours}h`;
  } else if (hours > 0) {
    formattedTime = `${hours}h ${mins}m`;
  } else {
    formattedTime = `${mins}m`;
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border transition-colors',
        isBreached
          ? 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800 font-bold animate-pulse'
          : diff < 3600000 // less than 1 hour remaining
          ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800 font-semibold'
          : 'bg-muted/70 text-muted-foreground border-border/60',
        className
      )}
      title={
        isBreached
          ? `SLA Breached by ${days > 0 ? `${days}d ` : ''}${hours}h ${mins}m`
          : `Target deadline: ${new Date(resolutionDue).toLocaleString()}`
      }
    >
      {isBreached ? (
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
      ) : (
        <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="whitespace-nowrap">
        {isBreached
          ? compact
            ? `BREACHED ${formattedTime}`
            : `BREACHED ${formattedTime} ago`
          : compact
            ? `Due in ${formattedTime}`
            : `Due in ${formattedTime}`}
      </span>
    </div>
  );
}

export {
  ResponseCountdown,
  ResolutionCountdown,
  BreachedIndicator,
  CompletedTerminalBadge,
} from '@/components/jobs/sla-components';

