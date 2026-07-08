-- Append-only treatment package and payment ledger.
-- Financial records are inserted only. Corrections are represented as new
-- negative payment rows, never edits to existing rows.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'receptionist', 'doctor', 'therapist', 'follow_up_agent'));

create table public.patient_packages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  visit_id uuid references public.visits(id),
  package_name text not null,
  total_sessions integer not null,
  quoted_amount numeric not null,
  created_by uuid references public.profiles(id),
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  created_at timestamp with time zone not null default now(),
  constraint patient_packages_package_name_not_blank
    check (length(trim(package_name)) > 0),
  constraint patient_packages_total_sessions_positive
    check (total_sessions > 0),
  constraint patient_packages_quoted_amount_non_negative
    check (quoted_amount >= 0)
);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  patient_package_id uuid references public.patient_packages(id),
  visit_id uuid references public.visits(id),
  amount numeric not null,
  payment_method text not null
    check (payment_method in ('cash', 'online')),
  recorded_by uuid references public.profiles(id),
  is_correction boolean not null default false,
  correction_reason text,
  created_at timestamp with time zone not null default now(),
  constraint payment_transactions_correction_reason_required
    check (
      (is_correction = false and correction_reason is null)
      or (is_correction = true and length(trim(coalesce(correction_reason, ''))) > 0)
    ),
  constraint payment_transactions_amount_direction
    check (
      (is_correction = false and amount > 0)
      or (is_correction = true and amount < 0)
    )
);

create index patient_packages_patient_id_created_at_idx
  on public.patient_packages (patient_id, created_at desc);

create index payment_transactions_patient_id_created_at_idx
  on public.payment_transactions (patient_id, created_at desc);

create index payment_transactions_package_id_created_at_idx
  on public.payment_transactions (patient_package_id, created_at desc)
  where patient_package_id is not null;

create or replace function private.prevent_financial_record_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'FINANCIAL_RECORDS_ARE_APPEND_ONLY' using errcode = 'P0001';
end;
$$;

drop trigger if exists patient_packages_append_only on public.patient_packages;
create trigger patient_packages_append_only
before update or delete on public.patient_packages
for each row execute function private.prevent_financial_record_mutation();

drop trigger if exists payment_transactions_append_only on public.payment_transactions;
create trigger payment_transactions_append_only
before update or delete on public.payment_transactions
for each row execute function private.prevent_financial_record_mutation();

revoke all on public.patient_packages from public, anon, authenticated;
revoke all on public.payment_transactions from public, anon, authenticated;

grant select, insert on public.patient_packages to authenticated;
grant select, insert on public.payment_transactions to authenticated;
grant all on public.patient_packages to service_role;
grant all on public.payment_transactions to service_role;

alter table public.patient_packages enable row level security;
alter table public.payment_transactions enable row level security;

create policy "patient_packages_staff_select"
on public.patient_packages for select
to authenticated
using ((select private.current_user_role()) in ('admin', 'receptionist', 'doctor'));

create policy "patient_packages_admin_receptionist_insert"
on public.patient_packages for insert
to authenticated
with check ((select private.current_user_role()) in ('admin', 'receptionist'));

create policy "payment_transactions_staff_select"
on public.payment_transactions for select
to authenticated
using ((select private.current_user_role()) in ('admin', 'receptionist', 'doctor'));

create policy "payment_transactions_admin_receptionist_insert"
on public.payment_transactions for insert
to authenticated
with check ((select private.current_user_role()) in ('admin', 'receptionist'));

create or replace function public.create_patient_package_atomic(
  p_patient_id uuid,
  p_visit_id uuid default null,
  p_package_name text default null,
  p_total_sessions integer default null,
  p_quoted_amount numeric default null
)
returns table (
  id uuid,
  patient_id uuid,
  visit_id uuid,
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
    package_name,
    total_sessions,
    quoted_amount,
    created_by
  )
  values (
    p_patient_id,
    p_visit_id,
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
    target_package.package_name,
    target_package.total_sessions,
    target_package.quoted_amount,
    target_package.created_by,
    target_package.status,
    target_package.created_at;
end;
$$;

create or replace function public.record_payment_atomic(
  p_patient_id uuid,
  p_patient_package_id uuid default null,
  p_visit_id uuid default null,
  p_amount numeric default null,
  p_payment_method text default null
)
returns table (
  payment_transaction_id uuid,
  patient_package_id uuid,
  paid_total numeric,
  balance numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  package_row public.patient_packages%rowtype;
  payment_row public.payment_transactions%rowtype;
  package_paid_total numeric := 0;
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

  if p_patient_package_id is not null then
    select * into package_row
    from public.patient_packages
    where public.patient_packages.id = p_patient_package_id
      and public.patient_packages.patient_id = p_patient_id;

    if package_row.id is null then
      raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  if p_visit_id is not null and not exists (
    select 1
    from public.visits
    where public.visits.id = p_visit_id
      and public.visits.patient_id = p_patient_id
  ) then
    raise exception 'VISIT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_PAYMENT_AMOUNT' using errcode = '22023';
  end if;

  if p_payment_method not in ('cash', 'online') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = '22023';
  end if;

  insert into public.payment_transactions (
    patient_id,
    patient_package_id,
    visit_id,
    amount,
    payment_method,
    recorded_by
  )
  values (
    p_patient_id,
    p_patient_package_id,
    p_visit_id,
    p_amount,
    p_payment_method,
    actor_id
  )
  returning * into payment_row;

  if p_patient_package_id is not null then
    select coalesce(sum(amount), 0)
    into package_paid_total
    from public.payment_transactions
    where public.payment_transactions.patient_package_id = p_patient_package_id;

    return query
    select
      payment_row.id,
      p_patient_package_id,
      package_paid_total,
      package_row.quoted_amount - package_paid_total;
  else
    return query
    select
      payment_row.id,
      null::uuid,
      p_amount,
      null::numeric;
  end if;
end;
$$;

revoke all on function private.prevent_financial_record_mutation() from public, anon, authenticated;

revoke all on function public.create_patient_package_atomic(
  uuid, uuid, text, integer, numeric
) from public, anon, authenticated;

revoke all on function public.record_payment_atomic(
  uuid, uuid, uuid, numeric, text
) from public, anon, authenticated;

grant execute on function public.create_patient_package_atomic(
  uuid, uuid, text, integer, numeric
) to authenticated, service_role;

grant execute on function public.record_payment_atomic(
  uuid, uuid, uuid, numeric, text
) to authenticated, service_role;

comment on table public.patient_packages
  is 'Append-only treatment package records. Balance is computed from payment_transactions and is never stored.';

comment on table public.payment_transactions
  is 'Append-only payment ledger. Corrections are new negative rows with correction reasons; no updates or deletes.';

comment on function public.create_patient_package_atomic(
  uuid, uuid, text, integer, numeric
) is 'Authenticated admin/receptionist RPC for append-only package creation.';

comment on function public.record_payment_atomic(
  uuid, uuid, uuid, numeric, text
) is 'Authenticated admin/receptionist RPC for append-only payment recording. Returns computed package balance.';
