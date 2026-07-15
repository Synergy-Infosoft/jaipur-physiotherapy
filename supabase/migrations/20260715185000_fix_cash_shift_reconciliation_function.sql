-- Fix ambiguous column references in close_cash_shift_atomic. The function
-- returns a created_at column, so unqualified created_at references inside
-- PL/pgSQL can be confused with the output variable.

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
  v_reconciliation_id uuid;
begin
  select coalesce(sum(pt.amount), 0)
  into v_system_cash_total
  from public.payment_transactions pt
  where pt.payment_method = 'cash'
    and pt.created_at >= p_shift_date::timestamp at time zone 'UTC'
    and pt.created_at < (p_shift_date + interval '1 day')::timestamp at time zone 'UTC';

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
  )
  returning public.cash_reconciliations.id into v_reconciliation_id;

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
  where cr.id = v_reconciliation_id;
end;
$$;
