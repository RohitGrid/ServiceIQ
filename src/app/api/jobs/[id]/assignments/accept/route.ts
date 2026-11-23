import { createClient } from '@/lib/supabase/server';
import {
  acceptAssignment,
  AssignmentNotFoundError,
  AssignmentConflictError,
  DatabaseError,
  ValidationError,
} from '@/lib/jobs';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Track D (and dispatcher-on-behalf) acceptance endpoint.
 * Re-checks overlapping accepted assignments at accept time and relies on
 * Postgres exclusion constraint no_double_booking for concurrent races.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const body = await req.json().catch(() => ({}));
    const assignmentId =
      typeof body?.assignmentId === 'string' ? body.assignmentId.trim() : '';

    if (!assignmentId) {
      return NextResponse.json(
        { error: 'assignmentId is required' },
        { status: 400 }
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { data: job, error: jobError } = await supabase
      .from('job')
      .select('job_id, org_id')
      .eq('job_id', params.id)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const { data: person } = await supabase
      .from('person')
      .select('person_id')
      .eq('auth_user_id', user.id)
      .single();

    if (!person) {
      return NextResponse.json(
        { error: 'Forbidden: No person profile associated with user' },
        { status: 403 }
      );
    }

    const { data: membership } = await supabase
      .from('org_membership')
      .select('role, is_active')
      .eq('person_id', person.person_id)
      .eq('org_id', job.org_id)
      .eq('is_active', true)
      .single();

    if (!membership) {
      return NextResponse.json(
        { error: 'Forbidden: You do not belong to this organisation' },
        { status: 403 }
      );
    }

    const result = await acceptAssignment(supabase, {
      jobId: params.id,
      assignmentId,
      actorPersonId: person.person_id,
      actorRole: membership.role,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      const status = err.message.startsWith('Forbidden') ? 403 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    if (err instanceof AssignmentNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AssignmentConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof DatabaseError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }

    return NextResponse.json(
      { error: err.message || 'Failed to accept assignment' },
      { status: 500 }
    );
  }
}
