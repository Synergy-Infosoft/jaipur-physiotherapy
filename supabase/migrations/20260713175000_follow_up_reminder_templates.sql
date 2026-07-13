-- Follow-up reminder templates map staff-friendly labels to approved Meta
-- WhatsApp template names. Rows are soft-deactivated, never hard-deleted, so
-- notification logs can always explain which reminder preset was used.

create table public.follow_up_reminder_templates (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  meta_template_name text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamp with time zone default now(),
  constraint follow_up_reminder_templates_label_not_blank
    check (length(trim(label)) > 0),
  constraint follow_up_reminder_templates_meta_template_name_not_blank
    check (length(trim(meta_template_name)) > 0)
);

create index follow_up_reminder_templates_active_label_idx
  on public.follow_up_reminder_templates (is_active, label);

alter table public.follow_up_reminder_templates enable row level security;

revoke all on public.follow_up_reminder_templates from public, anon, authenticated;
grant select, insert, update on public.follow_up_reminder_templates to authenticated;
grant all on public.follow_up_reminder_templates to service_role;

drop policy if exists "follow_up_reminder_templates_admin_select_all" on public.follow_up_reminder_templates;
create policy "follow_up_reminder_templates_admin_select_all"
on public.follow_up_reminder_templates for select
to authenticated
using ((select private.current_user_role()) = 'admin');

drop policy if exists "follow_up_reminder_templates_agent_select_active" on public.follow_up_reminder_templates;
create policy "follow_up_reminder_templates_agent_select_active"
on public.follow_up_reminder_templates for select
to authenticated
using (
  is_active = true
  and (select private.current_user_role()) in ('follow_up_agent')
);

drop policy if exists "follow_up_reminder_templates_admin_insert" on public.follow_up_reminder_templates;
create policy "follow_up_reminder_templates_admin_insert"
on public.follow_up_reminder_templates for insert
to authenticated
with check ((select private.current_user_role()) = 'admin');

drop policy if exists "follow_up_reminder_templates_admin_update" on public.follow_up_reminder_templates;
create policy "follow_up_reminder_templates_admin_update"
on public.follow_up_reminder_templates for update
to authenticated
using ((select private.current_user_role()) = 'admin')
with check ((select private.current_user_role()) = 'admin');

insert into public.follow_up_reminder_templates (label, meta_template_name)
values ('Missed session reminder', 'follow_up_reminder');

comment on table public.follow_up_reminder_templates
  is 'Admin-managed mapping from follow-up reminder labels to approved Meta WhatsApp template names.';
