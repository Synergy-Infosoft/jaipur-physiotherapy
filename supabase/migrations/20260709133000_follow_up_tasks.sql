-- Phase 6: follow-up tasks for missed expected therapy sessions.
-- Detection is run by the detect-follow-up-tasks Edge Function on a daily cron schedule.

create table public.follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  patient_package_id uuid not null references public.patient_packages(id),
  reason text not null check (reason in ('missed_expected_session', 'discontinued_early')),
  assigned_to uuid references public.profiles(id),
  status text not null default 'pending' check (status in ('pending', 'contacted', 'resolved')),
  outcome text check (outcome in ('rescheduled', 'discontinued_reason', 'no_answer') or outcome is null),
  outcome_notes text,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  constraint follow_up_tasks_resolved_at_status_check
    check (
      (status = 'resolved' and resolved_at is not null)
      or (status <> 'resolved' and resolved_at is null)
    )
);

create index follow_up_tasks_assigned_status_created_idx
  on public.follow_up_tasks (assigned_to, status, created_at desc);

create index follow_up_tasks_package_open_idx
  on public.follow_up_tasks (patient_package_id, status)
  where status in ('pending', 'contacted');

alter table public.follow_up_tasks enable row level security;

revoke all on public.follow_up_tasks from public, anon, authenticated;
grant select, update on public.follow_up_tasks to authenticated;
grant all on public.follow_up_tasks to service_role;

drop policy if exists "follow_up_tasks_select" on public.follow_up_tasks;
create policy "follow_up_tasks_select"
on public.follow_up_tasks for select
to authenticated
using (
  (select private.current_user_role()) = 'admin'
  or (
    (select private.current_user_role()) = 'follow_up_agent'
    and assigned_to = (select auth.uid())
  )
);

drop policy if exists "follow_up_tasks_update" on public.follow_up_tasks;
create policy "follow_up_tasks_update"
on public.follow_up_tasks for update
to authenticated
using (
  (select private.current_user_role()) = 'admin'
  or (
    (select private.current_user_role()) = 'follow_up_agent'
    and assigned_to = (select auth.uid())
  )
)
with check (
  (select private.current_user_role()) = 'admin'
  or (
    (select private.current_user_role()) = 'follow_up_agent'
    and assigned_to = (select auth.uid())
  )
);

create or replace function public.detect_follow_up_tasks_atomic()
returns table (
  inserted_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  follow_agent_id uuid;
  inserted integer := 0;
begin
  select profiles.id
  into follow_agent_id
  from public.profiles
  where profiles.role = 'follow_up_agent'
  order by profiles.created_at asc, profiles.id asc
  limit 1;

  with package_status as (
    select
      pp.id as patient_package_id,
      pp.patient_id,
      least(
        greatest((current_date - pp.created_at::date), 0),
        pp.total_sessions
      )::integer as expected_sessions,
      coalesce(count(ps.id) filter (where ps.is_voided = false), 0)::integer as sessions_used
    from public.patient_packages pp
    left join public.package_sessions ps
      on ps.patient_package_id = pp.id
    where pp.status = 'active'
    group by pp.id, pp.patient_id, pp.created_at, pp.total_sessions
  ), inserted_tasks as (
    insert into public.follow_up_tasks (
      patient_id,
      patient_package_id,
      reason,
      assigned_to
    )
    select
      package_status.patient_id,
      package_status.patient_package_id,
      'missed_expected_session',
      follow_agent_id
    from package_status
    where package_status.sessions_used < package_status.expected_sessions
      and not exists (
        select 1
        from public.follow_up_tasks fut
        where fut.patient_package_id = package_status.patient_package_id
          and fut.status in ('pending', 'contacted')
      )
    returning 1
  )
  select count(*)::integer into inserted
  from inserted_tasks;

  return query select inserted;
end;
$$;

revoke all on function public.detect_follow_up_tasks_atomic() from public, anon, authenticated;
grant execute on function public.detect_follow_up_tasks_atomic() to service_role;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Supabase schedules Edge Functions with pg_cron + pg_net. The function URL
-- and token are read from Vault so no real secrets are committed here.
-- Required Vault secrets for hosted scheduling:
--   project_url: https://<project-ref>.supabase.co
--   follow_up_cron_token: a service-role or publishable token accepted by the Edge gateway
-- Optional:
--   follow_up_cron_secret: shared value sent as x-cron-secret to the Edge Function
select cron.unschedule('detect-follow-up-tasks-daily')
where exists (
  select 1 from cron.job where jobname = 'detect-follow-up-tasks-daily'
);

select cron.schedule(
  'detect-follow-up-tasks-daily',
  '30 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/detect-follow-up-tasks',
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'follow_up_cron_token'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'follow_up_cron_secret')
    )),
    body := jsonb_build_object('scheduled_at', now())
  ) as request_id;
  $$
);

comment on table public.follow_up_tasks
  is 'Follow-up call queue for active treatment packages that are behind expected session cadence.';

comment on function public.detect_follow_up_tasks_atomic()
  is 'Creates missed-session follow-up tasks for active packages where expected sessions exceed delivered sessions.';