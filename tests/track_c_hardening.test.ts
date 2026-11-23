import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  transitionJob,
  acceptAssignment,
  setSlaDeadlines,
  parseTransitionInput,
  parseClosureMeta,
  canAssignJobs,
  canTransitionJobs,
  JOB_ASSIGN_ROLES,
  JOB_TRANSITION_ROLES,
  InvalidTransitionError,
  ValidationError,
  AssignmentConflictError,
} from '../src/lib/jobs';
import {
  sendTicketCreatedNotification,
  notifyTechnicianAssigned,
} from '../src/lib/whatsapp';
import { createMockSupabase, emptyDb } from './helpers/mock-supabase';

const BD = 'jt-bd';
const PM = 'jt-pm';
const states = {
  open: { state_id: 'st-open', job_type_id: BD, code: 'open', label: 'Open', allowed_next: ['assigned'], is_initial: true, is_terminal: false, stops_sla_clock: false },
  assigned: { state_id: 'st-assigned', job_type_id: BD, code: 'assigned', label: 'Assigned', allowed_next: ['en_route', 'cancelled'], is_initial: false, is_terminal: false, stops_sla_clock: false },
  en_route: { state_id: 'st-enroute', job_type_id: BD, code: 'en_route', label: 'En Route', allowed_next: ['on_site'], is_initial: false, is_terminal: false, stops_sla_clock: false },
  on_site: { state_id: 'st-onsite', job_type_id: BD, code: 'on_site', label: 'On Site', allowed_next: ['awaiting_parts', 'closed'], is_initial: false, is_terminal: false, stops_sla_clock: false },
  awaiting_parts: { state_id: 'st-parts', job_type_id: BD, code: 'awaiting_parts', label: 'Awaiting Parts', allowed_next: ['on_site'], is_initial: false, is_terminal: false, stops_sla_clock: true },
  closed: { state_id: 'st-closed', job_type_id: BD, code: 'closed', label: 'Closed', allowed_next: [], is_initial: false, is_terminal: true, stops_sla_clock: true },
  cancelled: { state_id: 'st-cancelled', job_type_id: BD, code: 'cancelled', label: 'Cancelled', allowed_next: [], is_initial: false, is_terminal: true, stops_sla_clock: true },
  pm_scheduled: { state_id: 'st-pm-sched', job_type_id: PM, code: 'scheduled', label: 'Scheduled', allowed_next: ['en_route', 'skipped'], is_initial: true, is_terminal: false, stops_sla_clock: false },
  pm_en_route: { state_id: 'st-pm-en', job_type_id: PM, code: 'en_route', label: 'En Route', allowed_next: ['on_site'], is_initial: false, is_terminal: false, stops_sla_clock: false },
  pm_on_site: { state_id: 'st-pm-on', job_type_id: PM, code: 'on_site', label: 'On Site', allowed_next: ['closed'], is_initial: false, is_terminal: false, stops_sla_clock: false },
  pm_closed: { state_id: 'st-pm-closed', job_type_id: PM, code: 'closed', label: 'Completed', allowed_next: [], is_initial: false, is_terminal: true, stops_sla_clock: true },
  pm_skipped: { state_id: 'st-pm-skip', job_type_id: PM, code: 'skipped', label: 'Skipped', allowed_next: [], is_initial: false, is_terminal: true, stops_sla_clock: true },
};

function breakdownOnSiteJob(extra: Record<string, unknown> = {}) {
  return {
    job_id: 'job-1',
    job_no: 'JOB-1001',
    org_id: 'org-1',
    ticket_id: 'tkt-1',
    pm_visit_id: null,
    unit_id: 'unit-1',
    job_type_id: BD,
    current_state_id: states.on_site.state_id,
    actual_start: '2026-01-01T10:00:00.000Z',
    actual_end: null,
    ...extra,
  };
}

describe('Track C existing transition behaviour', () => {
  it('rejects transitions not in allowed_next', async () => {
    const db = emptyDb({
      job: [breakdownOnSiteJob()],
      workflow_state: Object.values(states),
    });
    await assert.rejects(
      () => transitionJob(createMockSupabase(db), 'job-1', 'assigned'),
      InvalidTransitionError
    );
    assert.equal(db.job_status_event.length, 0);
  });

  it('writes job_status_event then updates current_state_id', async () => {
    const db = emptyDb({
      job: [breakdownOnSiteJob()],
      workflow_state: Object.values(states),
      ticket: [{ ticket_id: 'tkt-1', status: 'in_progress' }],
    });
    const result = await transitionJob(createMockSupabase(db), 'job-1', 'closed');
    assert.equal(result.ok, true);
    assert.equal(db.job_status_event.length, 1);
    assert.equal(db.job[0].current_state_id, states.closed.state_id);
    assert.ok(db.job[0].actual_end);
    assert.equal(db.ticket[0].status, 'closed');
  });

  it('does not mark assignments completed on cancelled jobs', async () => {
    const db = emptyDb({
      job: [breakdownOnSiteJob({ current_state_id: states.assigned.state_id })],
      workflow_state: Object.values(states),
      job_assignment: [
        {
          assignment_id: 'asg-1',
          job_id: 'job-1',
          person_id: 'tech-1',
          status: 'accepted',
          slot_start: '2026-01-01T09:00:00.000Z',
          slot_end: '2026-01-01T11:00:00.000Z',
        },
      ],
    });
    await transitionJob(createMockSupabase(db), 'job-1', 'cancelled');
    assert.equal(db.job_assignment[0].status, 'accepted');
    assert.equal(db.job[0].current_state_id, states.cancelled.state_id);
  });
});

describe('Test 45: PM visit status synchronization on job closure', () => {
  it('sets linked pm_visit.status to done only on successful closed, not skipped', async () => {
    const db = emptyDb({
      job: [
        breakdownOnSiteJob({
          job_id: 'pm-job',
          ticket_id: null,
          pm_visit_id: 'pmv-1',
          job_type_id: PM,
          current_state_id: states.pm_on_site.state_id,
        }),
      ],
      workflow_state: Object.values(states),
      pm_visit: [{ pm_visit_id: 'pmv-1', status: 'scheduled' }],
    });

    await transitionJob(createMockSupabase(db), 'pm-job', 'closed');
    assert.equal(db.pm_visit[0].status, 'done');
    assert.equal(db.job[0].current_state_id, states.pm_closed.state_id);
  });

  it('does not mark PM visit done when job is skipped', async () => {
    const db = emptyDb({
      job: [
        {
          job_id: 'pm-job-skip',
          org_id: 'org-1',
          ticket_id: null,
          pm_visit_id: 'pmv-2',
          job_type_id: PM,
          current_state_id: states.pm_scheduled.state_id,
          actual_start: null,
          actual_end: null,
        },
      ],
      workflow_state: Object.values(states),
      pm_visit: [{ pm_visit_id: 'pmv-2', status: 'scheduled' }],
    });

    await transitionJob(createMockSupabase(db), 'pm-job-skip', 'skipped');
    assert.equal(db.pm_visit[0].status, 'scheduled');
    assert.ok(db.job[0].actual_end);
  });
});

describe('Test 46: job_assignment.status completed on successful closure', () => {
  it('advances accepted assignments to completed when job closes', async () => {
    const db = emptyDb({
      job: [breakdownOnSiteJob()],
      workflow_state: Object.values(states),
      ticket: [{ ticket_id: 'tkt-1', status: 'in_progress' }],
      job_assignment: [
        {
          assignment_id: 'asg-acc',
          job_id: 'job-1',
          person_id: 'tech-1',
          status: 'accepted',
          slot_start: '2026-01-01T09:00:00.000Z',
          slot_end: '2026-01-01T11:00:00.000Z',
        },
        {
          assignment_id: 'asg-off',
          job_id: 'job-1',
          person_id: 'tech-2',
          status: 'offered',
          slot_start: '2026-01-01T09:00:00.000Z',
          slot_end: '2026-01-01T11:00:00.000Z',
        },
      ],
    });

    await transitionJob(createMockSupabase(db), 'job-1', 'closed');
    assert.equal(db.job_assignment.find((a) => a.assignment_id === 'asg-acc')?.status, 'completed');
    assert.equal(db.job_assignment.find((a) => a.assignment_id === 'asg-off')?.status, 'offered');
  });
});

describe('Test 47: Transition API close-out payload', () => {
  it('persists technicianNotes, rating and signature on closed', async () => {
    const parsed = parseTransitionInput({
      toStateCode: 'closed',
      technicianNotes: 'Replaced capacitor',
      customerSignature: 'https://files.example/sig.png',
      customerRating: 5,
      customerFeedback: 'Great work',
      checklistAnswers: { filter_cleaned: true },
    });

    const db = emptyDb({
      job: [breakdownOnSiteJob()],
      workflow_state: Object.values(states),
      ticket: [{ ticket_id: 'tkt-1', status: 'in_progress' }],
    });

    await transitionJob(createMockSupabase(db), 'job-1', parsed.toStateCode, parsed.meta);
    assert.equal(db.job[0].technician_notes, 'Replaced capacitor');
    assert.equal(db.job[0].signature_url, 'https://files.example/sig.png');
    assert.equal(db.job[0].customer_rating, 5);
    assert.equal(db.job[0].customer_feedback, 'Great work');
    assert.deepEqual(db.job[0].checklist_answers, { filter_cleaned: true });
  });

  it('rejects invalid rating and close-out on non-closed transitions before writes', () => {
    assert.throws(
      () => parseClosureMeta({ customerRating: 9 }),
      (err: unknown) => err instanceof ValidationError
    );
    assert.throws(
      () =>
        parseTransitionInput({
          toStateCode: 'en_route',
          technicianNotes: 'too early',
        }),
      ValidationError
    );
  });
});

describe('Test 48: Contract SLA targets vs defaults', () => {
  it('uses active contract P1 override instead of 60 minute default', async () => {
    const db = emptyDb({
      job: [breakdownOnSiteJob()],
      contract_equipment: [
        {
          contract_id: 'c-1',
          unit_id: 'unit-1',
          contract: { contract_id: 'c-1', status: 'active', sla_targets: { P1_response_mins: 30 } },
        },
      ],
    });

    const sla = await setSlaDeadlines(createMockSupabase(db), 'job-1', 'unit-1', 'P1');
    assert.equal(sla?.responseMins, 30);
    assert.equal(sla?.resolutionMins, 120);
  });

  it('falls back to defaults when no active contract exists', async () => {
    const db = emptyDb({
      job: [breakdownOnSiteJob()],
      contract_equipment: [
        {
          contract_id: 'c-2',
          unit_id: 'unit-1',
          contract: { contract_id: 'c-2', status: 'draft', sla_targets: { P2_response_mins: 10 } },
        },
      ],
    });

    const sla = await setSlaDeadlines(createMockSupabase(db), 'job-1', 'unit-1', 'P2');
    assert.equal(sla?.responseMins, 240);
  });
});

describe('Test 49: WhatsApp notification non-blocking credential states', () => {
  it('skips when credentials are unconfigured', async () => {
    const prevToken = process.env.WHATSAPP_TOKEN;
    const prevPhone = process.env.WHATSAPP_PHONE_ID;
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_ID;

    const created = await sendTicketCreatedNotification({
      ticketId: 't1',
      ticketNo: 'TKT-1001',
      customerPhone: '+91111',
    });
    const assigned = await notifyTechnicianAssigned({
      jobId: 'j1',
      jobNo: 'JOB-1001',
      technicianName: 'Asha',
      technicianPhone: '+91222',
    });

    assert.equal(created.skipped, true);
    assert.equal(assigned.skipped, true);

    if (prevToken !== undefined) process.env.WHATSAPP_TOKEN = prevToken;
    if (prevPhone !== undefined) process.env.WHATSAPP_PHONE_ID = prevPhone;
  });

  it('succeeds when credentials and recipient phone are present', async () => {
    const prevToken = process.env.WHATSAPP_TOKEN;
    const prevPhone = process.env.WHATSAPP_PHONE_ID;
    process.env.WHATSAPP_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_ID = 'phone-id';

    const created = await sendTicketCreatedNotification({
      ticketId: 't1',
      ticketNo: 'TKT-1001',
      customerPhone: '+91111',
    });
    assert.equal(created.success, true);

    if (prevToken !== undefined) process.env.WHATSAPP_TOKEN = prevToken;
    else delete process.env.WHATSAPP_TOKEN;
    if (prevPhone !== undefined) process.env.WHATSAPP_PHONE_ID = prevPhone;
    else delete process.env.WHATSAPP_PHONE_ID;
  });
});

describe('Test 50: technician cannot assign others but can transition', () => {
  it('encodes assign vs transition role split matching API routes', () => {
    assert.equal(canAssignJobs('technician'), false);
    assert.equal(canAssignJobs('dispatcher'), true);
    assert.equal(canAssignJobs('owner'), true);
    assert.equal(canTransitionJobs('technician'), true);
    assert.equal(canTransitionJobs('accounts'), false);
    assert.deepEqual([...JOB_ASSIGN_ROLES], ['owner', 'dispatcher']);
    assert.ok((JOB_TRANSITION_ROLES as readonly string[]).includes('technician'));
  });
});

describe('INC-04: acceptAssignment overlap re-check', () => {
  it('rejects accepting an offered assignment that overlaps an accepted slot', async () => {
    const db = emptyDb({
      job_assignment: [
        {
          assignment_id: 'asg-old',
          job_id: 'job-a',
          person_id: 'tech-1',
          status: 'accepted',
          slot_start: '2026-01-01T09:00:00.000Z',
          slot_end: '2026-01-01T12:00:00.000Z',
        },
        {
          assignment_id: 'asg-new',
          job_id: 'job-b',
          person_id: 'tech-1',
          status: 'offered',
          slot_start: '2026-01-01T11:00:00.000Z',
          slot_end: '2026-01-01T13:00:00.000Z',
        },
      ],
    });

    await assert.rejects(
      () =>
        acceptAssignment(createMockSupabase(db), {
          jobId: 'job-b',
          assignmentId: 'asg-new',
          actorPersonId: 'tech-1',
          actorRole: 'technician',
        }),
      AssignmentConflictError
    );
    assert.equal(db.job_assignment.find((a) => a.assignment_id === 'asg-new')?.status, 'offered');
  });

  it('simulates exclusion constraint 23P01 when a concurrent accepted overlap appears at update time', async () => {
    const db = emptyDb({
      job_assignment: [
        {
          assignment_id: 'asg-race-existing',
          job_id: 'job-a',
          person_id: 'tech-1',
          status: 'offered',
          slot_start: '2026-01-01T09:00:00.000Z',
          slot_end: '2026-01-01T12:00:00.000Z',
        },
        {
          assignment_id: 'asg-race-new',
          job_id: 'job-b',
          person_id: 'tech-1',
          status: 'offered',
          slot_start: '2026-01-01T10:00:00.000Z',
          slot_end: '2026-01-01T11:00:00.000Z',
        },
      ],
    });

    const supabase = createMockSupabase(db);
    await acceptAssignment(supabase, {
      jobId: 'job-a',
      assignmentId: 'asg-race-existing',
      actorPersonId: 'tech-1',
      actorRole: 'technician',
    });

    await assert.rejects(
      () =>
        acceptAssignment(supabase, {
          jobId: 'job-b',
          assignmentId: 'asg-race-new',
          actorPersonId: 'tech-1',
          actorRole: 'technician',
        }),
      AssignmentConflictError
    );
  });
});
