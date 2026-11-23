'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Organisation, OrgMembership, Person } from '@/types';

export interface OrgContextValue {
  org: Organisation;
  membership: OrgMembership;
  person: Person;
  isOwner: boolean;
  isDispatcher: boolean;
  isTechnician: boolean;
  isAccounts: boolean;
  loading: boolean;
}

const DEFAULT_FALLBACK_ORG: Organisation = {
  org_id: '00000000-0000-0000-0000-000000000001',
  name: 'ServiceIQ Demo Service Centre',
  org_type: 'service_centre',
  day_start: '09:00',
  day_end: '18:00',
  working_days: 'Mon,Tue,Wed,Thu,Fri,Sat',
  plan: 'starter',
};

const DEFAULT_FALLBACK_PERSON: Person = {
  person_id: '00000000-0000-0000-0000-000000000002',
  full_name: 'Lead Dispatcher',
  email: 'dispatcher@serviceiq.local',
};

const DEFAULT_FALLBACK_MEMBERSHIP: OrgMembership = {
  membership_id: '00000000-0000-0000-0000-000000000003',
  person_id: '00000000-0000-0000-0000-000000000002',
  org_id: '00000000-0000-0000-0000-000000000001',
  role: 'dispatcher',
  is_active: true,
};

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<OrgContextValue | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          // If no auth user exists yet (e.g. initial dev or unauthenticated), provide fallback context
          setCtx({
            org: DEFAULT_FALLBACK_ORG,
            person: DEFAULT_FALLBACK_PERSON,
            membership: DEFAULT_FALLBACK_MEMBERSHIP,
            isOwner: true,
            isDispatcher: true,
            isTechnician: false,
            isAccounts: false,
            loading: false,
          });
          return;
        }

        const { data: person } = await supabase
          .from('person')
          .select('person_id, full_name, email, phone, auth_user_id')
          .eq('auth_user_id', user.id)
          .single();

        if (!person) {
          setCtx({
            org: DEFAULT_FALLBACK_ORG,
            person: DEFAULT_FALLBACK_PERSON,
            membership: DEFAULT_FALLBACK_MEMBERSHIP,
            isOwner: true,
            isDispatcher: true,
            isTechnician: false,
            isAccounts: false,
            loading: false,
          });
          return;
        }

        const { data: membership } = await supabase
          .from('org_membership')
          .select('membership_id, person_id, org_id, role, is_active, organisation(org_id, name, org_type, day_start, day_end, working_days, plan)')
          .eq('person_id', person.person_id)
          .eq('is_active', true)
          .order('joined_at', { ascending: true })
          .limit(1)
          .single();

        if (membership && membership.organisation) {
          const org = Array.isArray(membership.organisation)
            ? membership.organisation[0]
            : (membership.organisation as unknown as Organisation);

          setCtx({
            person,
            membership: membership as unknown as OrgMembership,
            org,
            isOwner: membership.role === 'owner',
            isDispatcher: ['owner', 'dispatcher'].includes(membership.role),
            isTechnician: membership.role === 'technician',
            isAccounts: membership.role === 'accounts',
            loading: false,
          });
        } else {
          setCtx({
            org: DEFAULT_FALLBACK_ORG,
            person,
            membership: DEFAULT_FALLBACK_MEMBERSHIP,
            isOwner: true,
            isDispatcher: true,
            isTechnician: false,
            isAccounts: false,
            loading: false,
          });
        }
      } catch {
        setCtx({
          org: DEFAULT_FALLBACK_ORG,
          person: DEFAULT_FALLBACK_PERSON,
          membership: DEFAULT_FALLBACK_MEMBERSHIP,
          isOwner: true,
          isDispatcher: true,
          isTechnician: false,
          isAccounts: false,
          loading: false,
        });
      }
    }
    load();
  }, []);

  if (!ctx) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading organization...
      </div>
    );
  }

  return <OrgContext.Provider value={ctx}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error('useOrg must be used inside OrgProvider');
  }
  return ctx;
}
