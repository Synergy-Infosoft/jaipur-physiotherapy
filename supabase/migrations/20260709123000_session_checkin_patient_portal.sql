-- Phase 5: real-time therapy session check-in and public patient portal.
-- Session usage is computed from package_sessions rows. No stored counters.

create table public.package_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_package_id uuid not null references public.patient_packages(id),
  session_date date not null default current_date,
  marked_by uuid references public.profiles(id),
  marked_at timestamp with time zone not null default now(),
  is_voided boolean not null default false,
  void_reason text,
  notes text,
  constraint package_sessions_void_reason_required
    check (
      (is_voided = false and void_reason is null)
      or (is_voided = true and length(trim(coalesce(void_reason, ''))) > 0)
    )
);

create table public.patient_portal_links (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  token uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  revoked_at timestamp with time zone,
  last_accessed_at timestamp with time zone,
  constraint patient_portal_links_token_unique unique (token)
);

create unique index patient_portal_links_one_active_per_patient_idx
  on public.patient_portal_links (patient_id)
  where revoked_at is null;

create index package_sessions_package_id_marked_at_idx
  on public.package_sessions (patient_package_id, marked_at desc);

create index patient_portal_links_patient_id_created_at_idx
  on public.patient_portal_links (patient_id, created_at desc);

alter table public.package_sessions enable row level security;
alter table public.patient_portal_links enable row level security;

revoke all on public.package_sessions from public, anon, authenticated;
revoke all on public.patient_portal_links from public, anon, authenticated;

grant select, insert on public.package_sessions to authenticated;
grant select on public.patient_portal_links to authenticated;
grant all on public.package_sessions to service_role;
grant all on public.patient_portal_links to service_role;

drop policy if exists "package_sessions_staff_select" on public.package_sessions;
create policy "package_sessions_staff_select"
on public.package_sessions for select
to authenticated
using ((select private.current_user_role()) in ('admin', 'receptionist', 'doctor', 'therapist'));

drop policy if exists "package_sessions_therapist_insert" on public.package_sessions;
create policy "package_sessions_therapist_insert"
on public.package_sessions for insert
to authenticated
with check (
  (select private.current_user_role()) = 'therapist'
  and marked_by = (select auth.uid())
);

drop policy if exists "patient_portal_links_admin_select" on public.patient_portal_links;
create policy "patient_portal_links_admin_select"
on public.patient_portal_links for select
to authenticated
using ((select private.current_user_role()) = 'admin');

create or replace function public.mark_session_atomic(
  p_patient_package_id uuid,
  p_marked_by uuid
)
returns table (
  session_id uuid,
  patient_package_id uuid,
  patient_id uuid,
  package_name text,
  total_sessions integer,
  sessions_used integer,
  sessions_remaining integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  package_row public.patient_packages%rowtype;
  inserted_session public.package_sessions%rowtype;
  used_count integer := 0;
begin
  select role into actor_role
  from public.profiles
  where id = p_marked_by;

  if p_marked_by is null or actor_role not in ('admin', 'therapist') then
    raise exception 'THERAPIST_ACCESS_REQUIRED' using errcode = 'P0001';
  end if;

  select * into package_row
  from public.patient_packages
  where id = p_patient_package_id
    and status = 'active';

  if package_row.id is null then
    raise exception 'ACTIVE_PACKAGE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into used_count
  from public.package_sessions
  where package_sessions.patient_package_id = p_patient_package_id
    and is_voided = false;

  if used_count >= package_row.total_sessions then
    raise exception 'PACKAGE_SESSIONS_EXHAUSTED' using errcode = 'P0001';
  end if;

  insert into public.package_sessions (
    patient_package_id,
    marked_by
  )
  values (
    p_patient_package_id,
    p_marked_by
  )
  returning * into inserted_session;

  used_count := used_count + 1;

  return query
  select
    inserted_session.id,
    package_row.id,
    package_row.patient_id,
    package_row.package_name,
    package_row.total_sessions,
    used_count,
    greatest(package_row.total_sessions - used_count, 0);
end;
$$;

create or replace function public.void_package_session_atomic(
  p_session_id uuid,
  p_reason text,
  p_admin_id uuid
)
returns table (
  id uuid,
  patient_package_id uuid,
  is_voided boolean,
  void_reason text,
  marked_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  target_session public.package_sessions%rowtype;
begin
  select role into actor_role
  from public.profiles
  where id = p_admin_id;

  if p_admin_id is null or actor_role <> 'admin' then
    raise exception 'ADMIN_ACCESS_REQUIRED' using errcode = 'P0001';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'VOID_REASON_REQUIRED' using errcode = '22023';
  end if;

  update public.package_sessions
  set is_voided = true,
      void_reason = trim(p_reason)
  where package_sessions.id = p_session_id
  returning * into target_session;

  if target_session.id is null then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  return query
  select
    target_session.id,
    target_session.patient_package_id,
    target_session.is_voided,
    target_session.void_reason,
    target_session.marked_at;
end;
$$;

create or replace function public.get_patient_portal_overview(
  p_token uuid
)
returns table (
  patient_id uuid,
  patient_name text,
  package_id uuid,
  package_name text,
  status text,
  total_sessions integer,
  sessions_used integer,
  sessions_remaining integer,
  quoted_amount numeric,
  paid_total numeric,
  balance numeric,
  payment_history jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  portal_patient_id uuid;
begin
  select patient_portal_links.patient_id
  into portal_patient_id
  from public.patient_portal_links
  where token = p_token
    and revoked_at is null;

  if portal_patient_id is null then
    raise exception 'PORTAL_LINK_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.patient_portal_links
  set last_accessed_at = now()
  where token = p_token
    and revoked_at is null;

  return query
  select
    p.id,
    p.full_name,
    pp.id,
    pp.package_name,
    pp.status,
    pp.total_sessions,
    coalesce(session_counts.sessions_used, 0)::integer,
    greatest(coalesce(pp.total_sessions, 0) - coalesce(session_counts.sessions_used, 0), 0)::integer,
    pp.quoted_amount,
    coalesce(payment_totals.paid_total, 0),
    coalesce(pp.quoted_amount, 0) - coalesce(payment_totals.paid_total, 0),
    coalesce(payment_rows.payment_history, '[]'::jsonb)
  from public.patients p
  left join public.patient_packages pp
    on pp.patient_id = p.id
   and pp.status = 'active'
  left join lateral (
    select count(*)::integer as sessions_used
    from public.package_sessions ps
    where ps.patient_package_id = pp.id
      and ps.is_voided = false
  ) session_counts on true
  left join lateral (
    select coalesce(sum(pt.amount), 0) as paid_total
    from public.payment_transactions pt
    where pt.patient_package_id = pp.id
  ) payment_totals on true
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', pt.id,
          'amount', pt.amount,
          'payment_method', pt.payment_method,
          'is_correction', pt.is_correction,
          'correction_reason', pt.correction_reason,
          'created_at', pt.created_at
        )
        order by pt.created_at desc
      ),
      '[]'::jsonb
    ) as payment_history
    from public.payment_transactions pt
    where pt.patient_package_id = pp.id
  ) payment_rows on true
  where p.id = portal_patient_id
  order by pp.created_at desc nulls last;
end;
$$;

revoke all on function public.mark_session_atomic(uuid, uuid) from public, anon, authenticated;
revoke all on function public.void_package_session_atomic(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.get_patient_portal_overview(uuid) from public, anon, authenticated;

grant execute on function public.mark_session_atomic(uuid, uuid) to authenticated, service_role;
grant execute on function public.void_package_session_atomic(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.get_patient_portal_overview(uuid) to anon, authenticated, service_role;

comment on table public.package_sessions
  is 'Append-only delivered therapy session ledger. Remaining sessions are computed from non-voided rows.';

comment on table public.patient_portal_links
  is 'Revocable public portal tokens for patient read-only access.';

comment on function public.mark_session_atomic(uuid, uuid)
  is 'Marks one delivered therapy session and returns computed sessions used and remaining.';

comment on function public.get_patient_portal_overview(uuid)
  is 'Public token lookup for patient portal; returns computed package balances and session counts.';
