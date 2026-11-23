type Row = Record<string, any>;

export interface MockDb {
  job: Row[];
  workflow_state: Row[];
  job_status_event: Row[];
  job_assignment: Row[];
  pm_visit: Row[];
  ticket: Row[];
  person: Row[];
  org_membership: Row[];
  job_type: Row[];
  contract_equipment: Row[];
}

export function emptyDb(overrides: Partial<MockDb> = {}): MockDb {
  return {
    job: [],
    workflow_state: [],
    job_status_event: [],
    job_assignment: [],
    pm_visit: [],
    ticket: [],
    person: [],
    org_membership: [],
    job_type: [],
    contract_equipment: [],
    ...overrides,
  };
}

function matchesFilters(row: Row, filters: { eq: Record<string, any>; neq: Record<string, any>; lt: Record<string, any>; gt: Record<string, any> }) {
  for (const [k, v] of Object.entries(filters.eq)) {
    if (row[k] !== v) return false;
  }
  for (const [k, v] of Object.entries(filters.neq)) {
    if (row[k] === v) return false;
  }
  for (const [k, v] of Object.entries(filters.lt)) {
    if (!(row[k] < v)) return false;
  }
  for (const [k, v] of Object.entries(filters.gt)) {
    if (!(row[k] > v)) return false;
  }
  return true;
}

function nestJob(row: Row, db: MockDb) {
  const ws = db.workflow_state.find((s) => s.state_id === row.current_state_id) || null;
  return { ...row, workflow_state: ws };
}

function applySelectShape(table: string, row: Row, db: MockDb, select: string) {
  if (table === 'job' && select.includes('workflow_state')) {
    return nestJob(row, db);
  }
  if (table === 'contract_equipment' && select.includes('contract')) {
    return row;
  }
  return { ...row };
}

export function createMockSupabase(db: MockDb) {
  const from = (table: keyof MockDb | string) => {
    const state = {
      table: String(table),
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      select: '*',
      payload: null as any,
      filters: { eq: {} as Record<string, any>, neq: {} as Record<string, any>, lt: {} as Record<string, any>, gt: {} as Record<string, any> },
      limitN: undefined as number | undefined,
    };

    const runSelect = () => {
      let rows = [...((db as any)[state.table] || [])] as Row[];
      rows = rows.filter((r) => matchesFilters(r, state.filters));
      if (state.limitN) rows = rows.slice(0, state.limitN);
      return rows.map((r) => applySelectShape(state.table, r, db, state.select));
    };

    const execute = () => {
      if (state.op === 'select') {
        return { data: runSelect(), error: null };
      }
      if (state.op === 'insert') {
        const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
        const inserted = rows.map((r) => {
          const row = {
            ...r,
            event_id: r.event_id || `evt-${Math.random().toString(16).slice(2)}`,
            assignment_id: r.assignment_id || `asg-${Math.random().toString(16).slice(2)}`,
            job_id: r.job_id || `job-${Math.random().toString(16).slice(2)}`,
            job_no: r.job_no || 'JOB-1001',
          };
          (db as any)[state.table].push(row);
          return row;
        });
        return { data: inserted, error: null };
      }
      if (state.op === 'update') {
        const tableRows: Row[] = (db as any)[state.table] || [];
        const matched = tableRows.filter((r) => matchesFilters(r, state.filters));

        if (state.table === 'job_assignment' && state.payload?.status === 'accepted') {
          const target = matched[0];
          if (target) {
            const overlap = tableRows.find((r) => {
              if (r.status !== 'accepted') return false;
              if (r.person_id !== target.person_id) return false;
              if (r.assignment_id === target.assignment_id) return false;
              if (!r.slot_start || !r.slot_end || !target.slot_start || !target.slot_end) return false;
              return r.slot_start < target.slot_end && r.slot_end > target.slot_start;
            });
            if (overlap) {
              return { data: null, error: { message: 'exclusion violation', code: '23P01' } };
            }
          }
        }

        const updated: Row[] = [];
        for (const row of matched) {
          Object.assign(row, state.payload);
          updated.push({ ...row });
        }
        return { data: updated, error: null };
      }
      if (state.op === 'delete') {
        const tableRows: Row[] = (db as any)[state.table] || [];
        (db as any)[state.table] = tableRows.filter((r) => !matchesFilters(r, state.filters));
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'unknown op' } };
    };

    const builder: any = {
      select(cols?: string) {
        state.select = cols || '*';
        return builder;
      },
      insert(payload: any) {
        state.op = 'insert';
        state.payload = payload;
        return builder;
      },
      update(payload: any) {
        state.op = 'update';
        state.payload = payload;
        return builder;
      },
      delete() {
        state.op = 'delete';
        return builder;
      },
      eq(k: string, v: any) {
        state.filters.eq[k] = v;
        return builder;
      },
      neq(k: string, v: any) {
        state.filters.neq[k] = v;
        return builder;
      },
      lt(k: string, v: any) {
        state.filters.lt[k] = v;
        return builder;
      },
      gt(k: string, v: any) {
        state.filters.gt[k] = v;
        return builder;
      },
      limit(n: number) {
        state.limitN = n;
        return builder;
      },
      async single() {
        const { data, error } = execute();
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return { data: null, error: error || { message: 'not found' } };
        return { data: row, error: null };
      },
      async maybeSingle() {
        const { data, error } = execute();
        if (error) return { data: null, error };
        const row = Array.isArray(data) ? data[0] || null : data;
        return { data: row, error: null };
      },
      then(resolve: any, reject: any) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };

    return builder;
  };

  return {
    from,
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  } as any;
}
