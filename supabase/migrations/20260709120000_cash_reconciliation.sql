create table if not exists public.cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null,
  system_cash_total numeric(10,2) not null default 0,
  counted_cash numeric(10,2) not null,
  variance numeric(10,2) not null,
  notes text,
  closed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.cash_reconciliations enable row level security;

revoke all on public.cash_reconciliations from public, anon, authenticated;
grant select, insert on public.cash_reconciliations to authenticated;
grant all on public.cash_reconciliations to service_role;

drop policy if exists "Allow staff to read reconciliations" on public.cash_reconciliations;
create policy "Allow staff to read reconciliations"
  on public.cash_reconciliations
  for select
  to authenticated
  using ((select private.current_user_role()) in ('admin', 'receptionist'));

drop policy if exists "Allow staff to insert reconciliations" on public.cash_reconciliations;
create policy "Allow staff to insert reconciliations"
  on public.cash_reconciliations
  for insert
  to authenticated
  with check ((select private.current_user_role()) in ('admin', 'receptionist'));

create or replace function public.close_cash_shift_atomic(
  p_counted_cash numeric,
  p_notes text default null,
  p_closed_by uuid default null,
  p_shift_date date default current_date
)
returns table (
  id uuid,
  shift_date date,
  system_cash_total numeric,
  counted_cash numeric,
  variance numeric,
  notes text,
  closed_by uuid,
  created_at timestamptz
)
language plpgsql
as $$
declare
  v_system_cash_total numeric := 0;
  v_variance numeric;
begin
  select coalesce(sum(amount), 0)
  into v_system_cash_total
  from public.payment_transactions
  where payment_method = 'cash'
    and created_at >= p_shift_date::timestamp at time zone 'UTC'
    and created_at < (p_shift_date + interval '1 day')::timestamp at time zone 'UTC';

  v_variance := round(coalesce(p_counted_cash, 0) - v_system_cash_total, 2);

  insert into public.cash_reconciliations (
    shift_date,
    system_cash_total,
    counted_cash,
    variance,
    notes,
    closed_by
  ) values (
    p_shift_date,
    v_system_cash_total,
    coalesce(p_counted_cash, 0),
    v_variance,
    p_notes,
    p_closed_by
  );

  return query
  select
    cr.id,
    cr.shift_date,
    cr.system_cash_total,
    cr.counted_cash,
    cr.variance,
    cr.notes,
    cr.closed_by,
    cr.created_at
  from public.cash_reconciliations cr
  where cr.id = (select id from public.cash_reconciliations order by created_at desc, id desc limit 1);
end;
$$;
