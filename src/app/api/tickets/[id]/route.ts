import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: ticket, error: ticketError } = await supabase
      .from('ticket')
      .select(`
        ticket_id, ticket_no, public_token, priority, status, source, reported_at, fault_description, created_at, org_id,
        site(site_id, name, address, contact_name, contact_phone, party(party_id, name, phone)),
        equipment_unit(unit_id, serial_no, status, warranty_end, product_model(name, brand_name, spec))
      `)
      .eq('ticket_id', params.id)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: ticketError?.message || 'Ticket not found' }, { status: 404 });
    }

    const { data: jobs, error: jobsError } = await supabase
      .from('job')
      .select(`
        job_id, job_no, created_at, scheduled_start, scheduled_end, actual_start, actual_end,
        response_due, resolution_due, breached,
        workflow_state(code, label, is_terminal),
        job_assignment(
          person_id, is_lead, status,
          person(full_name, phone)
        )
      `)
      .eq('ticket_id', params.id)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      ticket,
      jobs: jobs || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const body = await req.json();
    const { priority, status, faultDescription, siteId, unitId } = body;

    const updates: Record<string, any> = {};
    if (priority !== undefined) updates.priority = priority;
    if (status !== undefined) updates.status = status;
    if (faultDescription !== undefined) updates.fault_description = faultDescription.trim();
    if (siteId !== undefined) updates.site_id = siteId || null;
    if (unitId !== undefined) updates.unit_id = unitId || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update provided' }, { status: 400 });
    }

    const { data: updated, error } = await supabase
      .from('ticket')
      .update(updates)
      .eq('ticket_id', params.id)
      .select('ticket_id, ticket_no, priority, status, fault_description, source, reported_at')
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: error?.message || 'Failed to update ticket' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, ticket: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

