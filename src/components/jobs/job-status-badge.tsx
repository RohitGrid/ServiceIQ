import { Badge } from '@/components/ui/badge';
import type { JobStatus, Priority, TicketStatus } from '@/types';

export function JobStatusBadge({ status }: { status: string | undefined | null }) {
  const s = (status || 'open').toLowerCase();

  switch (s) {
    case 'open':
      return <Badge variant="neutral">Open</Badge>;
    case 'assigned':
      return <Badge variant="secondary" className="bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">Assigned</Badge>;
    case 'en_route':
      return <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">En Route</Badge>;
    case 'on_site':
      return <Badge variant="warning">On Site</Badge>;
    case 'awaiting_parts':
      return <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">Awaiting Parts</Badge>;
    case 'closed':
    case 'completed':
    case 'installed':
      return <Badge variant="success">Closed</Badge>;
    case 'cancelled':
    case 'skipped':
      return <Badge variant="destructive">Cancelled</Badge>;
    case 'scheduled':
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800">Scheduled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function PriorityBadge({ priority }: { priority: Priority | string | undefined | null }) {
  const p = (priority || 'P2').toUpperCase();
  switch (p) {
    case 'P1':
      return <Badge variant="danger" className="font-bold">P1</Badge>;
    case 'P2':
      return <Badge variant="warning" className="font-semibold">P2</Badge>;
    case 'P3':
    default:
      return <Badge variant="neutral">P3</Badge>;
  }
}

export function TicketStatusBadge({ status }: { status: TicketStatus | string | undefined | null }) {
  const s = (status || 'open').toLowerCase();
  switch (s) {
    case 'open':
      return <Badge variant="neutral">Open</Badge>;
    case 'in_progress':
      return <Badge variant="secondary" className="bg-sky-100 text-sky-800">In Progress</Badge>;
    case 'awaiting_parts':
      return <Badge variant="secondary" className="bg-purple-100 text-purple-800">Awaiting Parts</Badge>;
    case 'closed':
      return <Badge variant="success">Closed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

