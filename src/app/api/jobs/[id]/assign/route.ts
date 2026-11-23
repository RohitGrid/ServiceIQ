import { createClient } from '@/lib/supabase/server';
import { transitionJob, canAssignJobs } from '@/lib/jobs';
import { notifyTechnicianAssigned } from '@/lib/whatsapp';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const body = await req.json();
    const { personId, slotStart, slotEnd, isLead = true } = body;

    if (!personId) {
      return NextResponse.json(
        { error: 'Technician (personId) is required' },
        { status: 400 }
      );
    }

    if (!slotStart || !slotEnd) {
      return NextResponse.json(
        { error: 'Both slotStart and slotEnd time slots are required' },
        { status: 400 }
      );
    }

    const start = new Date(slotStart);
    const end = new Date(slotEnd);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json(
        { error: 'Invalid datetime format for scheduling slot' },
        { status: 400 }
      );
    }

    if (end <= start) {
      return NextResponse.json(
        { error: 'Slot end time must be strictly after slot start time' },
        { status: 400 }
      );
    }

    // 1. Fetch Job and its organization
    const { data: job, error: jobFetchError } = await supabase
      .from('job')
      .select(`
        job_id, job_no, org_id, current_state_id,
        workflow_state(code),
        ticket(ticket_no, fault_description, site(name, party(name)))
      `)
      .eq('job_id', params.id)
      .single();

    if (jobFetchError || !job) {
      return NextResponse.json(
        { error: jobFetchError?.message || 'Job not found' },
        { status: 404 }
      );
    }

    // 2. Authenticate user & validate dispatcher/owner permissions
    const { data: { user } } = await supabase.auth.getUser();
    let callerPersonId: string | undefined;

    if (user) {
      const { data: callerPerson } = await supabase
        .from('person')
        .select('person_id')
        .eq('auth_user_id', user.id)
        .single();

      if (callerPerson) {
        callerPersonId = callerPerson.person_id;
        const { data: membership } = await supabase
          .from('org_membership')
          .select('role, is_active')
          .eq('person_id', callerPerson.person_id)
          .eq('org_id', job.org_id)
          .eq('is_active', true)
          .single();

        if (!membership || !canAssignJobs(membership.role)) {
          return NextResponse.json(
            { error: 'Forbidden: Dispatcher or Owner role required to assign jobs' },
            { status: 403 }
          );
        }
      }
    }

    // 3. Validate technician belongs to the organization and is an active technician
    const { data: techMembership, error: techError } = await supabase
      .from('org_membership')
      .select('membership_id, role, is_active, person(person_id, full_name, phone)')
      .eq('person_id', personId)
      .eq('org_id', job.org_id)
      .eq('role', 'technician')
      .eq('is_active', true)
      .single();

    if (techError || !techMembership) {
      return NextResponse.json(
        { error: 'Selected technician does not have an active technician membership in this organization' },
        { status: 400 }
      );
    }

    const techPerson: any = Array.isArray(techMembership.person)
      ? techMembership.person[0]
      : techMembership.person;

    // 4. Double-booking check:
    // Schema exclusion constraint no_double_booking applies to 'accepted' assignments.
    // Check if the technician already has an accepted assignment overlapping this slot
    const { data: conflictingAccepted, error: conflictCheckError } = await supabase
      .from('job_assignment')
      .select('assignment_id, slot_start, slot_end')
      .eq('person_id', personId)
      .eq('status', 'accepted')
      .lt('slot_start', slotEnd)
      .gt('slot_end', slotStart);

    if (!conflictCheckError && conflictingAccepted && conflictingAccepted.length > 0) {
      return NextResponse.json(
        { error: 'This technician already has an accepted job in that time slot.' },
        { status: 409 }
      );
    }

    // 5. If this is marked as lead, demote any previous lead assignment on this job
    if (isLead) {
      await supabase
        .from('job_assignment')
        .update({ is_lead: false })
        .eq('job_id', params.id)
        .eq('is_lead', true);
    }

    // Insert job_assignment with status 'offered'
    const { data: assignment, error: assignError } = await supabase
      .from('job_assignment')
      .insert({
        job_id: params.id,
        person_id: personId,
        slot_start: slotStart,
        slot_end: slotEnd,
        is_lead: isLead,
        status: 'offered',
      })
      .select('assignment_id, status, is_lead')
      .single();

    if (assignError) {
      // Postgres exclusion constraint violation error code is 23P01
      if (assignError.code === '23P01') {
        return NextResponse.json(
          { error: 'This technician already has an accepted job in that time slot.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: assignError.message }, { status: 400 });
    }

    // 6. Update job's scheduled_start and scheduled_end timestamps
    await supabase
      .from('job')
      .update({
        scheduled_start: slotStart,
        scheduled_end: slotEnd,
      })
      .eq('job_id', params.id);

    // 7. Transition job to 'assigned' state using the shared helper if not already assigned
    const currentState = Array.isArray(job.workflow_state)
      ? job.workflow_state[0]
      : (job.workflow_state as { code: string } | null);

    if (currentState?.code !== 'assigned') {
      await transitionJob(supabase, params.id, 'assigned', {
        personId: callerPersonId || personId,
      });
    }

    // 8. Safely invoke Track E's technician assignment notification helper
    const ticket: any = Array.isArray(job.ticket) ? job.ticket[0] : job.ticket;
    const site: any = Array.isArray(ticket?.site) ? ticket?.site[0] : ticket?.site;
    const party = site?.party;

    notifyTechnicianAssigned({
      jobId: job.job_id,
      jobNo: job.job_no,
      technicianName: techPerson?.full_name || 'Technician',
      technicianPhone: techPerson?.phone,
      slotStart,
      slotEnd,
      customerName: party?.name,
      siteName: site?.name,
    }).catch((err) => {
      console.warn('Track E assignment notification non-blocking exception:', err);
    });

    return NextResponse.json({ ok: true, assignment });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to assign job' },
      { status: 500 }
    );
  }
}
