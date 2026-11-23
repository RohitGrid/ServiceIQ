import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { sendTicketCreatedNotification } from '@/lib/whatsapp';

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { searchParams } = new URL(req.url);

    const orgId = searchParams.get('orgId');
    if (!orgId) {
      return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
    }

    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const search = searchParams.get('search')?.trim().toLowerCase();
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? true : false;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('ticket')
      .select(`
        ticket_id, ticket_no, public_token, priority, status, source, reported_at, fault_description, created_at,
        site(name, party(name, phone)),
        equipment_unit(serial_no, product_model(name))
      `, { count: 'exact' })
      .eq('org_id', orgId);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    if (priority && priority !== 'all') {
      query = query.eq('priority', priority);
    }

    query = query.order('reported_at', { ascending: sortOrder });

    // Client-side text filter or DB filter
    const { data: tickets, count, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let result = tickets || [];

    // Filter in JS if search is provided to handle joined table fields safely
    if (search) {
      result = result.filter((t: any) => {
        const ticketNo = t.ticket_no?.toLowerCase() || '';
        const fault = t.fault_description?.toLowerCase() || '';
        const customer = t.site?.party?.name?.toLowerCase() || '';
        const site = t.site?.name?.toLowerCase() || '';
        const serial = t.equipment_unit?.serial_no?.toLowerCase() || '';
        return (
          ticketNo.includes(search) ||
          fault.includes(search) ||
          customer.includes(search) ||
          site.includes(search) ||
          serial.includes(search)
        );
      });
    }

    const totalFiltered = result.length;
    const paginated = result.slice(offset, offset + limit);

    return NextResponse.json({
      tickets: paginated,
      total: totalFiltered,
      totalRaw: count ?? totalFiltered,
      page,
      limit,
      totalPages: Math.ceil(totalFiltered / limit) || 1,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch tickets' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  let createdTicketId: string | null = null;

  try {
    const body = await req.json();
    const {
      orgId,
      siteId,
      unitId,
      source = 'phone',
      priority = 'P2',
      faultDescription,
      customerName,
      customerPhone,
      siteName,
    } = body;

    // 1. Validation
    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }
    if (!faultDescription || !faultDescription.trim()) {
      return NextResponse.json({ error: 'Fault description is required' }, { status: 400 });
    }

    // 2. Pre-verify breakdown job type and initial workflow state before modifying DB
    const { data: jobType, error: jobTypeError } = await supabase
      .from('job_type')
      .select('job_type_id')
      .eq('org_id', orgId)
      .eq('code', 'breakdown')
      .single();

    if (jobTypeError || !jobType) {
      return NextResponse.json(
        { error: 'Default breakdown job type not found for this organization. Ensure organisation is seeded.' },
        { status: 400 }
      );
    }

    const { data: initialState, error: stateError } = await supabase
      .from('workflow_state')
      .select('state_id')
      .eq('job_type_id', jobType.job_type_id)
      .eq('is_initial', true)
      .single();

    if (stateError || !initialState) {
      return NextResponse.json(
        { error: 'Initial workflow state for breakdown job not found' },
        { status: 400 }
      );
    }

    // 3. Pre-calculate SLA deadlines using contract SLA targets
    let targets: Record<string, number> = {
      P1_response_mins: 60,
      P2_response_mins: 240,
      P3_response_mins: 480,
    };

    if (unitId) {
      const { data: contractEquipment } = await supabase
        .from('contract_equipment')
        .select('contract_id, contract(status, sla_targets)')
        .eq('unit_id', unitId)
        .limit(1)
        .single();

      if (contractEquipment?.contract) {
        const contract = Array.isArray(contractEquipment.contract)
          ? contractEquipment.contract[0]
          : (contractEquipment.contract as { status: string; sla_targets: Record<string, number> });

        if (contract.status === 'active' && contract.sla_targets) {
          targets = { ...targets, ...contract.sla_targets };
        }
      }
    }

    const responseKey = `${priority}_response_mins`;
    const responseMins = targets[responseKey] ?? 240;
    const now = new Date();
    const responseDue = new Date(now.getTime() + responseMins * 60000);
    const resolutionDue = new Date(now.getTime() + responseMins * 4 * 60000);

    // 4. Insert Ticket
    const { data: ticket, error: ticketError } = await supabase
      .from('ticket')
      .insert({
        org_id: orgId,
        site_id: siteId || null,
        unit_id: unitId || null,
        source,
        priority,
        fault_description: faultDescription.trim(),
        status: 'open',
      })
      .select('ticket_id, ticket_no, priority, status, fault_description')
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json(
        { error: `Ticket creation failed: ${ticketError?.message || 'Unknown database error'}` },
        { status: 400 }
      );
    }

    createdTicketId = ticket.ticket_id;

    // 5. Automatically create the first job linked to the ticket
    const { data: job, error: jobError } = await supabase
      .from('job')
      .insert({
        org_id: orgId,
        ticket_id: ticket.ticket_id,
        unit_id: unitId || null,
        job_type_id: jobType.job_type_id,
        current_state_id: initialState.state_id,
        response_due: responseDue.toISOString(),
        resolution_due: resolutionDue.toISOString(),
      })
      .select('job_id, job_no')
      .single();

    // 6. Transactional Compensation: rollback ticket if job creation fails
    if (jobError || !job) {
      await supabase.from('ticket').delete().eq('ticket_id', createdTicketId);
      return NextResponse.json(
        { error: `Job auto-creation failed: ${jobError?.message || 'Unknown error'}. Ticket was rolled back to prevent orphans.` },
        { status: 500 }
      );
    }

    // 7. Update ticket status to in_progress
    await supabase
      .from('ticket')
      .update({ status: 'in_progress' })
      .eq('ticket_id', ticket.ticket_id);

    // 8. Safely trigger Track E's WhatsApp notification helper
    sendTicketCreatedNotification({
      ticketId: ticket.ticket_id,
      ticketNo: ticket.ticket_no,
      customerName,
      customerPhone,
      faultDescription,
      priority,
      siteName,
    }).catch((err) => {
      console.warn('Track E notification non-blocking exception:', err);
    });

    return NextResponse.json({
      ok: true,
      ticket: { ...ticket, status: 'in_progress' },
      job,
    });
  } catch (err: any) {
    // If ticket was created before an unexpected error, roll it back
    if (createdTicketId) {
      try {
        await supabase.from('ticket').delete().eq('ticket_id', createdTicketId);
      } catch {
        // Ignore rollback cleanup error
      }
    }
    return NextResponse.json(
      { error: err.message || 'An error occurred during ticket intake' },
      { status: 500 }
    );
  }
}

