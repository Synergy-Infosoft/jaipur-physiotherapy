create table public.whatsapp_notifications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  notification_type text not null
    check (
      notification_type in (
        'registration_confirmation',
        'payment_receipt',
        'session_reminder',
        'follow_up',
        'portal_link'
      )
    ),
  payload jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed')),
  meta_message_id text,
  error_message text,
  created_at timestamp with time zone not null default now()
);

create index whatsapp_notifications_patient_id_created_at_idx
  on public.whatsapp_notifications (patient_id, created_at desc);

create index whatsapp_notifications_meta_message_id_idx
  on public.whatsapp_notifications (meta_message_id)
  where meta_message_id is not null;

create index whatsapp_notifications_payment_transaction_payload_idx
  on public.whatsapp_notifications ((payload ->> 'payment_transaction_id'))
  where notification_type = 'payment_receipt';

revoke all on public.whatsapp_notifications from public, anon, authenticated;
grant select on public.whatsapp_notifications to authenticated;
grant all on public.whatsapp_notifications to service_role;

alter table public.whatsapp_notifications enable row level security;

create policy "whatsapp_notifications_staff_select"
on public.whatsapp_notifications for select
to authenticated
using ((select private.current_user_role()) in ('admin', 'receptionist', 'doctor'));

comment on table public.whatsapp_notifications
  is 'Server-written WhatsApp delivery log for patient-facing anti-fraud notifications.';
