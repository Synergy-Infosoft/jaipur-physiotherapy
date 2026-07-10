-- Package templates are admin-managed starter definitions for common therapy
-- packages. Seed rows below are placeholders only; clinic admins should rename,
-- reprice, or deactivate them to match real clinic pricing.

create table public.package_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  total_sessions integer not null,
  default_price numeric not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamp with time zone default now(),
  constraint package_templates_name_not_blank
    check (length(trim(name)) > 0),
  constraint package_templates_total_sessions_positive
    check (total_sessions > 0),
  constraint package_templates_default_price_non_negative
    check (default_price >= 0)
);

create index package_templates_active_name_idx
  on public.package_templates (is_active, name);

alter table public.package_templates enable row level security;

revoke all on public.package_templates from public, anon, authenticated;
grant select, insert, update on public.package_templates to authenticated;
grant all on public.package_templates to service_role;

drop policy if exists "package_templates_admin_select_all" on public.package_templates;
create policy "package_templates_admin_select_all"
on public.package_templates for select
to authenticated
using ((select private.current_user_role()) = 'admin');

drop policy if exists "package_templates_active_staff_select" on public.package_templates;
create policy "package_templates_active_staff_select"
on public.package_templates for select
to authenticated
using (
  is_active = true
  and (select private.current_user_role()) in ('receptionist', 'therapist')
);

drop policy if exists "package_templates_admin_insert" on public.package_templates;
create policy "package_templates_admin_insert"
on public.package_templates for insert
to authenticated
with check ((select private.current_user_role()) = 'admin');

drop policy if exists "package_templates_admin_update" on public.package_templates;
create policy "package_templates_admin_update"
on public.package_templates for update
to authenticated
using ((select private.current_user_role()) = 'admin')
with check ((select private.current_user_role()) = 'admin');

insert into public.package_templates (name, total_sessions, default_price)
values
  ('Single Session', 1, 500),
  ('10 Day Combo', 10, 10000),
  ('30 Days Back Massage', 30, 20000);

alter table public.patient_packages
  add column template_id uuid references public.package_templates(id);

create index patient_packages_template_id_idx
  on public.patient_packages (template_id)
  where template_id is not null;

drop function if exists public.create_patient_package_atomic(uuid, uuid, text, integer, numeric);

create or replace function public.create_patient_package_atomic(
  p_patient_id uuid,
  p_visit_id uuid default null,
  p_package_name text default null,
  p_total_sessions integer default null,
  p_quoted_amount numeric default null,
  p_template_id uuid default null
)
returns table (
  id uuid,
  patient_id uuid,
  visit_id uuid,
  template_id uuid,
  package_name text,
  total_sessions integer,
  quoted_amount numeric,
  created_by uuid,
  status text,
  created_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  target_package public.patient_packages%rowtype;
begin
  select role into actor_role
  from public.profiles
  where public.profiles.id = actor_id;

  if actor_id is null or actor_role not in ('admin', 'receptionist') then
    raise exception 'BILLING_ACCESS_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.patients where public.patients.id = p_patient_id) then
    raise exception 'PATIENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_visit_id is not null and not exists (
    select 1
    from public.visits
    where public.visits.id = p_visit_id
      and public.visits.patient_id = p_patient_id
  ) then
    raise exception 'VISIT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_template_id is not null and not exists (
    select 1
    from public.package_templates
    where public.package_templates.id = p_template_id
  ) then
    raise exception 'TEMPLATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if length(trim(coalesce(p_package_name, ''))) = 0 then
    raise exception 'INVALID_PACKAGE_NAME' using errcode = '22023';
  end if;

  if p_total_sessions is null or p_total_sessions <= 0 then
    raise exception 'INVALID_TOTAL_SESSIONS' using errcode = '22023';
  end if;

  if p_quoted_amount is null or p_quoted_amount < 0 then
    raise exception 'INVALID_QUOTED_AMOUNT' using errcode = '22023';
  end if;

  insert into public.patient_packages (
    patient_id,
    visit_id,
    template_id,
    package_name,
    total_sessions,
    quoted_amount,
    created_by
  )
  values (
    p_patient_id,
    p_visit_id,
    p_template_id,
    trim(p_package_name),
    p_total_sessions,
    p_quoted_amount,
    actor_id
  )
  returning * into target_package;

  return query
  select
    target_package.id,
    target_package.patient_id,
    target_package.visit_id,
    target_package.template_id,
    target_package.package_name,
    target_package.total_sessions,
    target_package.quoted_amount,
    target_package.created_by,
    target_package.status,
    target_package.created_at;
end;
$$;

revoke all on function public.create_patient_package_atomic(
  uuid, uuid, text, integer, numeric, uuid
) from public, anon, authenticated;

grant execute on function public.create_patient_package_atomic(
  uuid, uuid, text, integer, numeric, uuid
) to authenticated, service_role;

comment on table public.package_templates
  is 'Admin-managed package templates for common therapy packages. Patient packages copy actual binding values at sale time.';

comment on column public.patient_packages.template_id
  is 'Optional provenance link to the package template used at creation time. Package values remain binding on the patient_packages row.';

comment on function public.create_patient_package_atomic(uuid, uuid, text, integer, numeric, uuid)
  is 'Append-only patient package creator. Optional template_id records provenance only; total_sessions and quoted_amount remain copied package values.';
