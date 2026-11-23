import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { searchParams } = new URL(req.url);

    const orgId = searchParams.get('orgId');
    if (!orgId) {
      return NextResponse.json(
        { error: 'orgId query parameter is required' },
        { status: 400 }
      );
    }

    const contractId = searchParams.get('contractId');
    const status = searchParams.get('status');

    let query = supabase
      .from('pm_visit')
      .select(`
        pm_visit_id, due_date, grace_days, status,
        contract_equipment!inner (
          contract_equipment_id,
          unit_id,
          contract!inner (
            contract_id,
            contract_no,
            org_id,
            status,
            party:party_id (
              party_id,
              name,
              phone
            )
          ),
          equipment_unit (
            unit_id,
            serial_no,
            product_model (
              name,
              brand_name
            ),
            site (
              site_id,
              name,
              address,
              contact_name,
              contact_phone,
              party:party_id (
                name
              )
            )
          )
        ),
        job (
          job_id,
          job_no,
          scheduled_start,
          scheduled_end,
          workflow_state (code, label)
        )
      `)
      .eq('contract_equipment.contract.org_id', orgId);

    if (contractId) {
      query = query.eq('contract_equipment.contract_id', contractId);
    }

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    query = query.order('due_date', { ascending: true });

    const { data: rawVisits, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const visits = (rawVisits || []).map((v: any) => {
      const ce = Array.isArray(v.contract_equipment)
        ? v.contract_equipment[0]
        : v.contract_equipment;
      const contract = Array.isArray(ce?.contract) ? ce.contract[0] : ce?.contract;
      const equip = Array.isArray(ce?.equipment_unit)
        ? ce.equipment_unit[0]
        : ce?.equipment_unit;
      const model = Array.isArray(equip?.product_model)
        ? equip.product_model[0]
        : equip?.product_model;
      const site = Array.isArray(equip?.site) ? equip.site[0] : equip?.site;
      const customer = contract?.party || site?.party;
      const jobList = Array.isArray(v.job) ? v.job : v.job ? [v.job] : [];
      const linkedJob = jobList[0] || null;

      return {
        pm_visit_id: v.pm_visit_id,
        due_date: v.due_date,
        grace_days: v.grace_days,
        status: v.status,
        contract: {
          contract_id: contract?.contract_id,
          contract_no: contract?.contract_no,
          status: contract?.status,
        },
        customer: {
          name: customer?.name || 'Customer Account',
          phone: customer?.phone || null,
        },
        site: {
          name: site?.name || 'Primary Site',
          address: site?.address || null,
          contact_name: site?.contact_name || null,
          contact_phone: site?.contact_phone || null,
        },
        equipment: {
          unit_id: equip?.unit_id || ce?.unit_id,
          serial_no: equip?.serial_no || 'N/A',
          model_name: model?.name || 'Equipment Unit',
          brand_name: model?.brand_name || null,
        },
        job: linkedJob
          ? {
              job_id: linkedJob.job_id,
              job_no: linkedJob.job_no,
              scheduled_start: linkedJob.scheduled_start,
              workflow_state: Array.isArray(linkedJob.workflow_state)
                ? linkedJob.workflow_state[0]
                : linkedJob.workflow_state,
            }
          : null,
      };
    });

    return NextResponse.json({ visits, count: visits.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch PM visits' },
      { status: 500 }
    );
  }
}
