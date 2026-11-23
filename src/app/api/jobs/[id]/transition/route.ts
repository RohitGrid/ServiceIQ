import { createClient } from '@/lib/supabase/server';
import {
  transitionJob,
  parseTransitionInput,
  canTransitionJobs,
  JobNotFoundError,
  InvalidTransitionError,
  TargetStateNotFoundError,
  DatabaseError,
  ValidationError,
} from '@/lib/jobs';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const body = await req.json();
    const { toStateCode, meta } = parseTransitionInput(body);

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { data: job, error: jobError } = await supabase
      .from('job')
      .select('job_id, org_id')
      .eq('job_id', params.id)
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
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
      .select('membership_id, role, is_active')
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

    if (!canTransitionJobs(membership.role)) {
      return NextResponse.json(
        { error: 'Forbidden: Insufficient permissions to perform job status transitions' },
        { status: 403 }
      );
    }

    const result = await transitionJob(supabase, params.id, toStateCode, {
      ...meta,
      personId: person.person_id,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof JobNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof InvalidTransitionError || err instanceof TargetStateNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof DatabaseError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }

    console.error('Unexpected transition error:', err);
    return NextResponse.json(
      { error: err.message || 'Unexpected server error during status transition' },
      { status: 500 }
    );
  }
}
