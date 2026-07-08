alter table public.visits
  add column if not exists payment_method text
    check (payment_method in ('cash', 'online')),
  add column if not exists payment_method_locked_at timestamp with time zone,
  add column if not exists payment_method_override_by uuid references public.profiles(id),
  add column if not exists payment_method_override_reason text;

alter table public.visits
  drop constraint if exists visits_payment_method_override_pair_check;

alter table public.visits
  add constraint visits_payment_method_override_pair_check
  check (
    (
      payment_method_override_by is null
      and payment_method_override_reason is null
    )
    or (
      payment_method_override_by is not null
      and length(trim(coalesce(payment_method_override_reason, ''))) > 0
    )
  );

create index if not exists visits_payment_method_override_idx
  on public.visits (payment_method_override_by, updated_at desc)
  where payment_method_override_by is not null;

create or replace function private.prevent_visit_payment_method_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    old.payment_method is distinct from new.payment_method
    or old.payment_method_locked_at is distinct from new.payment_method_locked_at
    or old.payment_method_override_by is distinct from new.payment_method_override_by
    or old.payment_method_override_reason is distinct from new.payment_method_override_reason
  )
  and coalesce(current_setting('app.allow_payment_method_override', true), '') <> 'on' then
    raise exception 'PAYMENT_METHOD_LOCKED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists visits_payment_method_locked on public.visits;
create trigger visits_payment_method_locked
before update on public.visits
for each row execute function private.prevent_visit_payment_method_mutation();

drop function if exists public.register_patient_atomic(
  text, integer, text, text, text, uuid, text, text, text, text, date, time without time zone, text, text
);

create or replace function public.register_patient_atomic(
  p_full_name text,
  p_age integer,
  p_gender text,
  p_phone text,
  p_chief_complaint text,
  p_doctor_id uuid default null,
  p_address text default null,
  p_father_name text default null,
  p_referral_source text default null,
  p_visit_type text default 'first_visit',
  p_consultation_date date default current_date,
  p_consultation_time time without time zone default localtime(0),
  p_registered_by text default 'self',
  p_request_hash text default null,
  p_payment_method text default null
)
returns table (
  token_number integer,
  visit_id uuid,
  patient_name text,
  confirmation_token uuid,
  duplicate_registration boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_phone text;
  current_patient public.patients%rowtype;
  existing_visit public.visits%rowtype;
  created_visit public.visits%rowtype;
  next_token integer;
  rate_limit_count integer;
begin
  normalized_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');

  if length(trim(coalesce(p_full_name, ''))) < 2 or length(p_full_name) > 120 then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_father_name, ''))) > 120 then
    raise exception 'INVALID_FATHER_NAME' using errcode = '22023';
  end if;
  if p_age < 1 or p_age > 120 then
    raise exception 'INVALID_AGE' using errcode = '22023';
  end if;
  if p_gender not in ('male', 'female', 'other') then
    raise exception 'INVALID_GENDER' using errcode = '22023';
  end if;
  if normalized_phone !~ '^[0-9]{10}$' then
    raise exception 'INVALID_PHONE' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_chief_complaint, ''))) < 5
     or length(p_chief_complaint) > 1000 then
    raise exception 'INVALID_COMPLAINT' using errcode = '22023';
  end if;
  if p_registered_by not in ('self', 'receptionist') then
    raise exception 'INVALID_REGISTRATION_SOURCE' using errcode = '22023';
  end if;
  if p_visit_type not in ('first_visit', 'follow_up') then
    raise exception 'INVALID_VISIT_TYPE' using errcode = '22023';
  end if;
  if p_payment_method not in ('cash', 'online') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_referral_source, '')), '') is not null
     and p_referral_source not in (
       'google', 'youtube', 'social_media', 'friend_family',
       'doctor_referral', 'walk_in', 'other'
     ) then
    raise exception 'INVALID_REFERRAL_SOURCE' using errcode = '22023';
  end if;

  if p_request_hash is not null then
    insert into private.registration_rate_limits (
      identifier_hash,
      window_started_at,
      attempt_count
    )
    values (p_request_hash, now(), 1)
    on conflict (identifier_hash) do update
      set window_started_at = case
            when private.registration_rate_limits.window_started_at < now() - interval '15 minutes'
              then now()
            else private.registration_rate_limits.window_started_at
          end,
          attempt_count = case
            when private.registration_rate_limits.window_started_at < now() - interval '15 minutes'
              then 1
            else private.registration_rate_limits.attempt_count + 1
          end
    returning attempt_count into rate_limit_count;

    if rate_limit_count > 5 then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
  end if;

  select * into current_patient
  from public.patients
  where regexp_replace(phone, '[^0-9]', '', 'g') = normalized_phone
  order by created_at asc
  limit 1
  for update;

  if current_patient.id is not null then
    select * into existing_visit
    from public.visits
    where patient_id = current_patient.id
      and consultation_date = p_consultation_date
      and status <> 'cancelled'
    order by created_at desc
    limit 1;

    if existing_visit.id is not null then
      return query
      select
        existing_visit.token_number,
        existing_visit.id,
        current_patient.full_name,
        existing_visit.confirmation_token,
        true;
      return;
    end if;

    update public.patients
    set full_name = trim(p_full_name),
        age = p_age,
        gender = p_gender,
        address = coalesce(nullif(trim(p_address), ''), address),
        father_name = coalesce(nullif(trim(p_father_name), ''), father_name),
        referral_source = coalesce(nullif(trim(p_referral_source), ''), referral_source),
        updated_at = now()
    where id = current_patient.id
    returning * into current_patient;
  else
    insert into public.patients (
      full_name, age, gender, phone, address, father_name, referral_source
    )
    values (
      trim(p_full_name),
      p_age,
      p_gender,
      normalized_phone,
      nullif(trim(p_address), ''),
      nullif(trim(p_father_name), ''),
      nullif(trim(p_referral_source), '')
    )
    returning * into current_patient;
  end if;

  insert into public.token_counters (counter_date, last_token)
  values (p_consultation_date, 1)
  on conflict (counter_date) do update
    set last_token = public.token_counters.last_token + 1
  returning last_token into next_token;

  insert into public.visits (
    patient_id,
    doctor_id,
    token_number,
    token_date,
    consultation_date,
    consultation_time,
    visit_type,
    chief_complaint,
    status,
    notes,
    prescription,
    registered_by,
    payment_method,
    payment_method_locked_at
  )
  values (
    current_patient.id,
    p_doctor_id,
    next_token,
    p_consultation_date,
    p_consultation_date,
    p_consultation_time,
    p_visit_type,
    trim(p_chief_complaint),
    'pending',
    null,
    null,
    p_registered_by,
    p_payment_method,
    now()
  )
  returning * into created_visit;

  return query
  select
    created_visit.token_number,
    created_visit.id,
    current_patient.full_name,
    created_visit.confirmation_token,
    false;
end;
$$;

create or replace function public.override_payment_method_atomic(
  p_visit_id uuid,
  p_new_method text,
  p_reason text,
  p_admin_id uuid
)
returns table (
  id uuid,
  patient_id uuid,
  payment_method text,
  payment_method_locked_at timestamp with time zone,
  payment_method_override_by uuid,
  payment_method_override_reason text,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role text;
  target_visit public.visits%rowtype;
begin
  select role into admin_role
  from public.profiles
  where public.profiles.id = p_admin_id;

  if p_admin_id is null or admin_role <> 'admin' then
    raise exception 'ADMIN_ACCESS_REQUIRED' using errcode = 'P0001';
  end if;

  if p_new_method not in ('cash', 'online') then
    raise exception 'INVALID_PAYMENT_METHOD' using errcode = '22023';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'OVERRIDE_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into target_visit
  from public.visits
  where public.visits.id = p_visit_id
  for update;

  if target_visit.id is null then
    raise exception 'VISIT_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform set_config('app.allow_payment_method_override', 'on', true);

  update public.visits
  set payment_method = p_new_method,
      payment_method_locked_at = coalesce(payment_method_locked_at, now()),
      payment_method_override_by = p_admin_id,
      payment_method_override_reason = trim(p_reason),
      updated_at = now()
  where public.visits.id = p_visit_id
  returning * into target_visit;

  perform set_config('app.allow_payment_method_override', 'off', true);

  return query
  select
    target_visit.id,
    target_visit.patient_id,
    target_visit.payment_method,
    target_visit.payment_method_locked_at,
    target_visit.payment_method_override_by,
    target_visit.payment_method_override_reason,
    target_visit.updated_at;
end;
$$;

revoke all on function private.prevent_visit_payment_method_mutation() from public, anon, authenticated;

revoke all on function public.register_patient_atomic(
  text, integer, text, text, text, uuid, text, text, text, text, date, time without time zone, text, text, text
) from public, anon, authenticated;

grant execute on function public.register_patient_atomic(
  text, integer, text, text, text, uuid, text, text, text, text, date, time without time zone, text, text, text
) to service_role;

revoke all on function public.override_payment_method_atomic(
  uuid, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.override_payment_method_atomic(
  uuid, text, text, uuid
) to service_role;

comment on function public.register_patient_atomic(
  text, integer, text, text, text, uuid, text, text, text, text, date, time without time zone, text, text, text
) is 'Server-only atomic patient registration. Captures and locks payment method at visit creation.';

comment on function public.override_payment_method_atomic(
  uuid, text, text, uuid
) is 'Server-only admin override for locked visit payment method with mandatory reason.';
