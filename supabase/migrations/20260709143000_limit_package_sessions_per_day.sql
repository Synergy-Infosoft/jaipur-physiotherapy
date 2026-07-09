-- Enforce a maximum of two delivered sessions per package per calendar day.
-- This keeps the session ledger append-only while preventing accidental duplicate marking.

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
  sessions_today integer := 0;
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

  select count(*)::integer
  into sessions_today
  from public.package_sessions
  where package_sessions.patient_package_id = p_patient_package_id
    and session_date = current_date
    and is_voided = false;

  if sessions_today >= 2 then
    raise exception 'PACKAGE_DAILY_SESSION_LIMIT_REACHED' using errcode = 'P0001';
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

revoke all on function public.mark_session_atomic(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_session_atomic(uuid, uuid) to authenticated, service_role;

comment on function public.mark_session_atomic(uuid, uuid)
  is 'Append-only package session marker for therapists/admins. Prevents exhausted packages and more than two sessions per package per day.';
