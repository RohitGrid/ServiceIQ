import type { SupabaseClient } from '@supabase/supabase-js';

/** Roles allowed to offer assignments to technicians. Technicians cannot assign others. */
export const JOB_ASSIGN_ROLES = ['owner', 'dispatcher'] as const;

/** Roles allowed to transition job workflow state, including own jobs for technicians. */
export const JOB_TRANSITION_ROLES = ['owner', 'dispatcher', 'technician'] as const;

/** Successful completion state. Cancelled/skipped are terminal but not successful. */
export const SUCCESSFUL_COMPLETION_STATE = 'closed';

export class JobNotFoundError extends Error {
  constructor(message = 'Job not found') {
    super(message);
    this.name = 'JobNotFoundError';
  }
}

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransitionError';
  }
}

export class TargetStateNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetStateNotFoundError';
  }
}

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AssignmentNotFoundError extends Error {
  constructor(message = 'Assignment not found') {
    super(message);
    this.name = 'AssignmentNotFoundError';
  }
}

export class AssignmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssignmentConflictError';
  }
}

export interface ClosureMeta {
  technicianNotes?: string;
  customerSignature?: string;
  customerRating?: number;
  customerFeedback?: string;
  checklistAnswers?: Record<string, unknown>;
}

export interface TransitionMeta extends ClosureMeta {
  geoLat?: number | null;
  geoLng?: number | null;
  syncedOffline?: boolean | null;
  personId?: string | null;
}

export interface TransitionResult {
  ok: boolean;
  jobId: string;
  fromStateCode: string;
  fromStateId: string;
  toStateCode: string;
  toStateId: string;
  eventId: string;
  actualStart?: string | null;
  actualEnd?: string | null;
}

export interface ParsedTransitionInput {
  toStateCode: string;
  meta: TransitionMeta;
}

const NOTES_MAX = 8000;
const SIGNATURE_MAX = 2048;
const FEEDBACK_MAX = 8000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${field} cannot be empty`);
  }
  if (trimmed.length > max) {
    throw new ValidationError(`${field} exceeds maximum length of ${max}`);
  }
  return trimmed;
}

/**
 * Validates Track D close-out metadata. Fields are optional individually,
 * but any provided value is type-checked before any database write.
 */
export function parseClosureMeta(raw: Record<string, unknown>): ClosureMeta {
  const closure: ClosureMeta = {};

  if (raw.technicianNotes !== undefined) {
    closure.technicianNotes = optionalString(raw.technicianNotes, 'technicianNotes', NOTES_MAX);
  }
  if (raw.customerSignature !== undefined) {
    closure.customerSignature = optionalString(
      raw.customerSignature,
      'customerSignature',
      SIGNATURE_MAX
    );
  }
  if (raw.customerRating !== undefined && raw.customerRating !== null) {
    const rating = raw.customerRating;
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ValidationError('customerRating must be an integer between 1 and 5');
    }
    closure.customerRating = rating;
  }
  if (raw.customerFeedback !== undefined) {
    closure.customerFeedback = optionalString(
      raw.customerFeedback,
      'customerFeedback',
      FEEDBACK_MAX
    );
  }
  if (raw.checklistAnswers !== undefined && raw.checklistAnswers !== null) {
    if (!isPlainObject(raw.checklistAnswers)) {
      throw new ValidationError('checklistAnswers must be a JSON object');
    }
    closure.checklistAnswers = raw.checklistAnswers;
  }

  return closure;
}

export function hasClosureFields(meta: ClosureMeta | undefined): boolean {
  if (!meta) return false;
  return (
    meta.technicianNotes !== undefined ||
    meta.customerSignature !== undefined ||
    meta.customerRating !== undefined ||
    meta.customerFeedback !== undefined ||
    meta.checklistAnswers !== undefined
  );
}

function applyClosureUpdates(updates: Record<string, unknown>, meta: TransitionMeta) {
  if (meta.technicianNotes !== undefined) {
    updates.technician_notes = meta.technicianNotes;
  }
  if (meta.customerSignature !== undefined) {
    updates.signature_url = meta.customerSignature;
  }
  if (meta.customerRating !== undefined) {
    updates.customer_rating = meta.customerRating;
  }
  if (meta.customerFeedback !== undefined) {
    updates.customer_feedback = meta.customerFeedback;
  }
  if (meta.checklistAnswers !== undefined) {
    updates.checklist_answers = meta.checklistAnswers;
  }
}

/**
 * Parses POST /api/jobs/[id]/transition JSON. Rejects invalid geo or closure metadata
 * before any write is attempted.
 */
export function parseTransitionInput(body: unknown): ParsedTransitionInput {
  if (!isPlainObject(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }

  const toStateCode = body.toStateCode;
  if (!toStateCode || typeof toStateCode !== 'string' || !toStateCode.trim()) {
    throw new ValidationError('Target state code (toStateCode) is required');
  }

  let geoLat: number | null = null;
  let geoLng: number | null = null;

  if (body.geoLat !== undefined && body.geoLat !== null) {
    if (typeof body.geoLat !== 'number' || Number.isNaN(body.geoLat) || body.geoLat < -90 || body.geoLat > 90) {
      throw new ValidationError('geoLat must be a number between -90 and 90');
    }
    geoLat = body.geoLat;
  }
  if (body.geoLng !== undefined && body.geoLng !== null) {
    if (typeof body.geoLng !== 'number' || Number.isNaN(body.geoLng) || body.geoLng < -180 || body.geoLng > 180) {
      throw new ValidationError('geoLng must be a number between -180 and 180');
    }
    geoLng = body.geoLng;
  }

  const closure = parseClosureMeta(body);
  if (hasClosureFields(closure) && toStateCode.trim() !== SUCCESSFUL_COMPLETION_STATE) {
    throw new ValidationError(
      'technicianNotes, customerSignature, customerRating, customerFeedback and checklistAnswers are only allowed when toStateCode is "closed"'
    );
  }

  return {
    toStateCode: toStateCode.trim(),
    meta: {
      ...closure,
      geoLat,
      geoLng,
      syncedOffline: Boolean(body.syncedOffline),
    },
  };
}

export function canAssignJobs(role: string | undefined | null): boolean {
  return !!role && (JOB_ASSIGN_ROLES as readonly string[]).includes(role);
}

export function canTransitionJobs(role: string | undefined | null): boolean {
  return !!role && (JOB_TRANSITION_ROLES as readonly string[]).includes(role);
}

/**
 * Executes a job status transition.
 *
 * Writes are ordered: validate → audit event → job row (state + optional close-out
 * fields in one UPDATE) → related completion rows. Independent PostgREST calls are
 * not a database transaction. True atomicity requires fn_transition_job (see
 * supabase/proposed/fn_transition_job.sql) which is not applied until approved.
 */
export async function transitionJob(
  supabase: SupabaseClient,
  jobId: string,
  toStateCode: string,
  meta?: TransitionMeta
): Promise<TransitionResult> {
  if (hasClosureFields(meta) && toStateCode !== SUCCESSFUL_COMPLETION_STATE) {
    throw new ValidationError(
      'Close-out metadata is only allowed when transitioning to closed'
    );
  }

  const { data: job, error: jobError } = await supabase
    .from('job')
    .select(`
      job_id, current_state_id, job_type_id, org_id, ticket_id, pm_visit_id, actual_start, actual_end,
      workflow_state (
        state_id, code, label, allowed_next, is_terminal, stops_sla_clock
      )
    `)
    .eq('job_id', jobId)
    .single();

  if (jobError || !job) {
    throw new JobNotFoundError(jobError?.message || `Job "${jobId}" not found`);
  }

  const currentState = Array.isArray(job.workflow_state)
    ? job.workflow_state[0]
    : (job.workflow_state as {
        state_id: string;
        code: string;
        label: string;
        allowed_next: string[];
      } | null);

  if (!currentState) {
    throw new InvalidTransitionError('Current workflow state missing on job');
  }

  const { data: toState, error: toStateError } = await supabase
    .from('workflow_state')
    .select('state_id, code, label, stops_sla_clock, is_terminal')
    .eq('job_type_id', job.job_type_id)
    .eq('code', toStateCode)
    .single();

  if (toStateError || !toState) {
    throw new TargetStateNotFoundError(
      `Target workflow state "${toStateCode}" not found for job type`
    );
  }

  const allowed = currentState.allowed_next || [];
  if (!allowed.includes(toStateCode)) {
    throw new InvalidTransitionError(
      `Cannot transition from "${currentState.code}" to "${toStateCode}". Allowed transitions: ${
        allowed.join(', ') || 'none'
      }`
    );
  }

  let changedBy = meta?.personId;
  if (!changedBy && supabase.auth) {
    try {
      const authRes = await supabase.auth.getUser();
      const user = authRes?.data?.user;
      if (user) {
        const { data: person } = await supabase
          .from('person')
          .select('person_id')
          .eq('auth_user_id', user.id)
          .single();
        if (person) {
          changedBy = person.person_id;
        }
      }
    } catch {
      // Ignore auth user resolution error in non-auth contexts
    }
  }

  const { data: event, error: eventError } = await supabase
    .from('job_status_event')
    .insert({
      job_id: jobId,
      from_state_id: currentState.state_id,
      to_state_id: toState.state_id,
      changed_by: changedBy || null,
      geo_lat: meta?.geoLat ?? null,
      geo_lng: meta?.geoLng ?? null,
      synced_offline: meta?.syncedOffline ?? false,
    })
    .select('event_id')
    .single();

  if (eventError || !event) {
    throw new DatabaseError(
      `Failed to record job status event: ${eventError?.message || 'Unknown error'}`
    );
  }

  const updates: Record<string, unknown> = {
    current_state_id: toState.state_id,
  };

  if (toStateCode === 'on_site' && !job.actual_start) {
    updates.actual_start = new Date().toISOString();
  }

  if (toState.is_terminal && !job.actual_end) {
    updates.actual_end = new Date().toISOString();
  }

  if (toStateCode === SUCCESSFUL_COMPLETION_STATE) {
    applyClosureUpdates(updates, meta || {});
  }

  const { error: updateError } = await supabase
    .from('job')
    .update(updates)
    .eq('job_id', jobId);

  if (updateError) {
    await supabase.from('job_status_event').delete().eq('event_id', event.event_id);
    throw new DatabaseError(`Failed to update job: ${updateError.message}`);
  }

  const isSuccessfulCompletion =
    toState.is_terminal === true && toStateCode === SUCCESSFUL_COMPLETION_STATE;

  if (isSuccessfulCompletion) {
    const { error: assignmentCompleteError } = await supabase
      .from('job_assignment')
      .update({ status: 'completed' })
      .eq('job_id', jobId)
      .eq('status', 'accepted');

    if (assignmentCompleteError) {
      throw new DatabaseError(
        `Job closed but failed to mark assignments completed: ${assignmentCompleteError.message}. Apply fn_transition_job for transactional consistency.`
      );
    }

    if (job.pm_visit_id) {
      const { error: pmError } = await supabase
        .from('pm_visit')
        .update({ status: 'done' })
        .eq('pm_visit_id', job.pm_visit_id)
        .eq('status', 'scheduled');

      if (pmError) {
        throw new DatabaseError(
          `Job closed but failed to complete linked PM visit: ${pmError.message}. Apply fn_transition_job for transactional consistency.`
        );
      }
    }
  }

  if (job.ticket_id) {
    if (toStateCode === 'closed') {
      await supabase
        .from('ticket')
        .update({ status: 'closed' })
        .eq('ticket_id', job.ticket_id);
    } else if (toStateCode === 'awaiting_parts') {
      await supabase
        .from('ticket')
        .update({ status: 'awaiting_parts' })
        .eq('ticket_id', job.ticket_id);
    } else if (['assigned', 'en_route', 'on_site'].includes(toStateCode)) {
      await supabase
        .from('ticket')
        .update({ status: 'in_progress' })
        .eq('ticket_id', job.ticket_id);
    }
  }

  return {
    ok: true,
    jobId,
    fromStateCode: currentState.code,
    fromStateId: currentState.state_id,
    toStateCode: toState.code,
    toStateId: toState.state_id,
    eventId: event.event_id,
    actualStart: (updates.actual_start as string) || job.actual_start,
    actualEnd: (updates.actual_end as string) || job.actual_end,
  };
}

/**
 * Calculates response and resolution SLA deadlines using the active contract
 * or defaults (P1 = 60m, P2 = 240m, P3 = 480m) and saves them on the job.
 * Resolution SLA is 4x response SLA.
 */
export async function setSlaDeadlines(
  supabase: SupabaseClient,
  jobId: string,
  unitId: string | null | undefined,
  priority: string
) {
  if (!jobId) return null;

  let targets: Record<string, number> = {
    P1_response_mins: 60,
    P2_response_mins: 240,
    P3_response_mins: 480,
  };

  if (unitId) {
    const { data: ceRecords, error: ceError } = await supabase
      .from('contract_equipment')
      .select(`
        contract_id,
        contract (
          contract_id,
          status,
          sla_targets
        )
      `)
      .eq('unit_id', unitId);

    if (!ceError && ceRecords && ceRecords.length > 0) {
      for (const item of ceRecords) {
        const c = Array.isArray(item.contract) ? item.contract[0] : item.contract;
        if (c && c.status === 'active' && c.sla_targets) {
          const parsedTargets =
            typeof c.sla_targets === 'string'
              ? JSON.parse(c.sla_targets)
              : c.sla_targets;
          targets = { ...targets, ...parsedTargets };
          break;
        }
      }
    }
  }

  const responseKey = `${priority}_response_mins`;
  const defaultMins = priority === 'P1' ? 60 : priority === 'P3' ? 480 : 240;
  const responseMins =
    typeof targets[responseKey] === 'number' ? targets[responseKey] : defaultMins;
  const resolutionMins = responseMins * 4;

  const now = new Date();
  const responseDue = new Date(now.getTime() + responseMins * 60 * 1000).toISOString();
  const resolutionDue = new Date(now.getTime() + resolutionMins * 60 * 1000).toISOString();

  await supabase
    .from('job')
    .update({
      response_due: responseDue,
      resolution_due: resolutionDue,
      breached: false,
    })
    .eq('job_id', jobId);

  return {
    responseDue,
    resolutionDue,
    responseMins,
    resolutionMins,
  };
}

export interface SchedulePmJobParams {
  orgId: string;
  pmVisitId: string;
  unitId: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  technicianId?: string | null;
  isLead?: boolean;
}

/**
 * Creates a PM Job from a scheduled PM Visit record.
 * Validates PM visit status, prevents duplicate jobs, assigns technician if selected,
 * and updates pm_visit status to 'scheduled' with rollback on error.
 */
export async function schedulePmJob(
  supabase: SupabaseClient,
  params: SchedulePmJobParams
) {
  const {
    orgId,
    pmVisitId,
    unitId,
    scheduledStart,
    scheduledEnd,
    technicianId,
    isLead = true,
  } = params;

  const { data: pmVisit, error: visitFetchError } = await supabase
    .from('pm_visit')
    .select('pm_visit_id, status, due_date')
    .eq('pm_visit_id', pmVisitId)
    .single();

  if (visitFetchError || !pmVisit) {
    throw new Error('PM visit not found');
  }

  if (['scheduled', 'done'].includes(pmVisit.status)) {
    throw new Error(`PM visit is already ${pmVisit.status}`);
  }

  const existingJobRes = await supabase
    .from('job')
    .select('job_id, job_no, current_state_id, workflow_state(code, is_terminal)')
    .eq('pm_visit_id', pmVisitId)
    .limit(1)
    .maybeSingle();

  const existingJob = existingJobRes?.data;

  if (existingJob) {
    const ws = Array.isArray(existingJob.workflow_state)
      ? existingJob.workflow_state[0]
      : existingJob.workflow_state;
    if (ws?.code !== 'cancelled') {
      throw new Error(`Job ${existingJob.job_no} already exists for this PM visit`);
    }
  }

  const { data: pmJobType, error: jobTypeError } = await supabase
    .from('job_type')
    .select('job_type_id')
    .eq('org_id', orgId)
    .eq('code', 'pm')
    .single();

  if (jobTypeError || !pmJobType) {
    throw new Error('Preventive Maintenance job type not configured for this organization');
  }

  const { data: initialState, error: stateError } = await supabase
    .from('workflow_state')
    .select('state_id')
    .eq('job_type_id', pmJobType.job_type_id)
    .eq('is_initial', true)
    .single();

  if (stateError || !initialState) {
    throw new Error('Initial state for PM job type not found');
  }

  const { data: job, error: insertError } = await supabase
    .from('job')
    .insert({
      org_id: orgId,
      pm_visit_id: pmVisitId,
      unit_id: unitId,
      job_type_id: pmJobType.job_type_id,
      current_state_id: initialState.state_id,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd || null,
    })
    .select('job_id, job_no')
    .single();

  if (insertError || !job) {
    throw new Error(insertError?.message || 'Failed to create PM job');
  }

  if (technicianId) {
    try {
      const { data: techMem } = await supabase
        .from('org_membership')
        .select('person_id')
        .eq('person_id', technicianId)
        .eq('org_id', orgId)
        .eq('role', 'technician')
        .eq('is_active', true)
        .single();

      if (techMem) {
        await supabase.from('job_assignment').insert({
          job_id: job.job_id,
          person_id: technicianId,
          slot_start: scheduledStart,
          slot_end: scheduledEnd || null,
          is_lead: isLead,
          status: 'offered',
        });
      }
    } catch (techErr: any) {
      console.warn('Technician assignment notice during PM scheduling:', techErr.message);
    }
  }

  const { error: visitUpdateError } = await supabase
    .from('pm_visit')
    .update({ status: 'scheduled' })
    .eq('pm_visit_id', pmVisitId);

  if (visitUpdateError) {
    await supabase.from('job').delete().eq('job_id', job.job_id);
    throw new Error(
      `Failed to update PM visit status: ${visitUpdateError.message}. Job creation rolled back.`
    );
  }

  return job;
}

export interface AcceptAssignmentParams {
  jobId: string;
  assignmentId: string;
  actorPersonId: string;
  actorRole: string;
}

function rangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  return startA < endB && endA > startB;
}

/**
 * Accepts an offered assignment after a fresh overlap check.
 *
 * Concurrent safety: the UPDATE is constrained to status='offered', and Postgres
 * exclusion constraint no_double_booking (status='accepted' overlapping tstzrange)
 * rejects a second concurrent accept with 23P01 even if both reads passed.
 *
 * Track D should call POST /api/jobs/[id]/assignments/accept rather than a raw
 * table update, so conflict detection cannot be skipped.
 */
export async function acceptAssignment(
  supabase: SupabaseClient,
  params: AcceptAssignmentParams
) {
  const { jobId, assignmentId, actorPersonId, actorRole } = params;

  const { data: assignment, error: fetchError } = await supabase
    .from('job_assignment')
    .select('assignment_id, job_id, person_id, status, slot_start, slot_end')
    .eq('assignment_id', assignmentId)
    .eq('job_id', jobId)
    .single();

  if (fetchError || !assignment) {
    throw new AssignmentNotFoundError(fetchError?.message || 'Assignment not found');
  }

  const isOwn = assignment.person_id === actorPersonId;
  const isDispatcher = canAssignJobs(actorRole);
  if (!isOwn && !isDispatcher) {
    throw new ValidationError('Forbidden: you can only accept your own assignment');
  }

  if (assignment.status === 'accepted') {
    return { ok: true, assignment, alreadyAccepted: true };
  }

  if (assignment.status !== 'offered') {
    throw new AssignmentConflictError(
      `Assignment cannot be accepted from status "${assignment.status}"`
    );
  }

  if (!assignment.slot_start || !assignment.slot_end) {
    throw new ValidationError(
      'Assignment is missing slot_start/slot_end; cannot verify double-booking'
    );
  }

  const { data: existingAccepted, error: overlapError } = await supabase
    .from('job_assignment')
    .select('assignment_id, slot_start, slot_end, status')
    .eq('person_id', assignment.person_id)
    .eq('status', 'accepted');

  if (overlapError) {
    throw new DatabaseError(`Failed to check assignment conflicts: ${overlapError.message}`);
  }

  const conflict = (existingAccepted || []).find((row: { assignment_id: string; slot_start: string | null; slot_end: string | null }) => {
    if (row.assignment_id === assignmentId) return false;
    if (!row.slot_start || !row.slot_end) return false;
    return rangesOverlap(assignment.slot_start, assignment.slot_end, row.slot_start, row.slot_end);
  });

  if (conflict) {
    throw new AssignmentConflictError(
      'This technician already has an accepted job in that time slot.'
    );
  }

  const respondedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('job_assignment')
    .update({
      status: 'accepted',
      responded_at: respondedAt,
    })
    .eq('assignment_id', assignmentId)
    .eq('status', 'offered')
    .select('assignment_id, job_id, person_id, status, slot_start, slot_end, responded_at')
    .maybeSingle();

  if (updateError) {
    if (updateError.code === '23P01') {
      throw new AssignmentConflictError(
        'This technician already has an accepted job in that time slot.'
      );
    }
    throw new DatabaseError(`Failed to accept assignment: ${updateError.message}`);
  }

  if (!updated) {
    throw new AssignmentConflictError(
      'Assignment is no longer offered (accepted or withdrawn concurrently)'
    );
  }

  return { ok: true, assignment: updated, alreadyAccepted: false };
}
