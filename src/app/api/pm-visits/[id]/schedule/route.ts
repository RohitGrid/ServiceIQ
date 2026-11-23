import { createClient } from '@/lib/supabase/server';
import { schedulePmJob } from '@/lib/jobs';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const body = await req.json();
    const {
      orgId,
      scheduledStart,
      scheduledEnd,
      technicianId,
      isLead = true,
    } = body;

    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization ID is required' },
        { status: 400 }
      );
    }
    if (!scheduledStart) {
      return NextResponse.json(
        { error: 'Scheduled start date is required' },
        { status: 400 }
      );
    }

    // 1. Fetch PM visit, contract_equipment.unit_id, and contract info
    const { data: pmVisit, error: visitError } = await supabase
      .from('pm_visit')
      .select(`
        pm_visit_id, due_date, status,
        contract_equipment (
          unit_id,
          contract (org_id)
        )
      `)
      .eq('pm_visit_id', params.id)
      .single();

    if (visitError || !pmVisit) {
      return NextResponse.json(
        { error: 'PM visit not found' },
        { status: 404 }
      );
    }

    if (pmVisit.status === 'scheduled') {
      return NextResponse.json(
        { error: 'This PM visit is already scheduled' },
        { status: 409 }
      );
    }

    const ce: any = Array.isArray(pmVisit.contract_equipment)
      ? pmVisit.contract_equipment[0]
      : pmVisit.contract_equipment;

    const unitId = ce?.unit_id;
    if (!unitId) {
      return NextResponse.json(
        { error: 'Associated equipment unit not found on contract equipment' },
        { status: 400 }
      );
    }

    // 2. Call the enhanced schedulePmJob helper with duplicate check and technician assignment
    const job = await schedulePmJob(supabase, {
      orgId,
      pmVisitId: params.id,
      unitId,
      scheduledStart,
      scheduledEnd,
      technicianId,
      isLead,
    });

    return NextResponse.json({ ok: true, job });
  } catch (err: any) {
    const message = err.message || 'Failed to schedule PM visit';
    const isConflict = message.includes('already') || message.includes('exists');
    return NextResponse.json(
      { error: message },
      { status: isConflict ? 409 : 500 }
    );
  }
}
