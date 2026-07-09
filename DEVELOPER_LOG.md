# Developer Log

This file records major project changes, database migrations, verification steps, and operational notes for future developers.

## 2026-07-08 - Append-only package and payment ledger

### Summary
- Replaced patient-detail invoice action with a treatment package and append-only payment ledger workflow.
- Added package sale and payment recording flows for admin/receptionist users.
- Added read-only package balances and payment history on the patient detail page.
- Added future-valid staff roles: `therapist` and `follow_up_agent`.

### Database
- Added migration: `supabase/migrations/20260708094515_append_only_payment_ledger.sql`.
- Added `patient_packages` table.
- Added `payment_transactions` table.
- Added immutable triggers that block `UPDATE` and `DELETE` on both financial tables.
- Added RPCs:
  - `create_patient_package_atomic`
  - `record_payment_atomic`
- Balance is intentionally computed from `quoted_amount - sum(payment_transactions.amount)` and is not stored.
- Migration was applied to the linked Supabase project with `supabase db push --linked --yes`.

### Backend
- Added `POST /api/admin/packages`.
- Added `POST /api/admin/payments`.
- Both routes follow existing admin route origin validation and auth-session checks.

### Frontend
- Updated `src/app/(dashboard)/patients/[id]/page.tsx`.
- Added package/payment form with required `cash` or `online` payment method.
- Added active/past package display with computed balances.
- Added read-only payment history list with no edit/delete controls.

### Types and Services
- Updated `src/types/index.ts`.
- Updated `src/types/database.ts`.
- Extended `src/lib/dataService.ts` with:
  - `createPatientPackage`
  - `recordPayment`
  - `getPatientPackages`
  - `getPaymentHistory`

### Verification
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `supabase db push --linked --dry-run` showed only the ledger migration before applying.

### Notes
- Do not add update/delete policies for `payment_transactions`.
- Corrections must be represented as new negative payment rows with `is_correction = true`.
- Do not add stored `balance` or `sessions_remaining` columns.

## 2026-07-08 - WhatsApp anti-fraud notification log

### Summary
- Added server-side WhatsApp template sending for package creation and payment receipt events.
- Added delivery-attempt logging so WhatsApp failures do not block package/payment writes.
- Added Meta webhook route for verification and delivery status callbacks.
- Added patient-detail WhatsApp status badges next to payment ledger rows.

### Database
- Added migration: `supabase/migrations/20260708100549_add_whatsapp_notifications.sql`.
- Added `whatsapp_notifications` table with status values `queued`, `sent`, and `failed`.
- Staff roles can read notification logs through RLS; writes are reserved for server-side service-role code.
- Migration was applied to the linked Supabase project with `supabase db push --linked --yes`.

### Backend
- Added server-only utility: `src/lib/whatsapp.ts`.
- Added webhook route: `GET/POST /api/webhooks/whatsapp`.
- Updated `POST /api/admin/packages` to send/log a package-created WhatsApp template attempt.
- Updated `POST /api/admin/payments` to send/log a payment receipt WhatsApp template attempt.
- WhatsApp send failure is logged and returned in the API response, but it does not roll back the financial insert.

### Frontend
- Updated payment history rows on `src/app/(dashboard)/patients/[id]/page.tsx` with a small WhatsApp status badge.

### Env Vars
- Added placeholder-only server env vars to `.env.example`:
  - `META_WHATSAPP_ACCESS_TOKEN`
  - `META_WHATSAPP_PHONE_NUMBER_ID`
  - `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
  - `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
  - `PAYMENT_RECEIPT_TEMPLATE_NAME`
  - `PACKAGE_CREATED_TEMPLATE_NAME`
  - `WHATSAPP_TEMPLATE_LANGUAGE`

### Verification
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `supabase db push --linked --dry-run` showed only the WhatsApp notification migration before applying.
- `supabase db query --linked` confirmed `public.whatsapp_notifications` exists.
- `.env.local` remains gitignored; `.env.example` contains placeholder values only.

### Notes
- Meta template names are intentionally read from env vars because approved template names can change.
- The current notification type check does not include a dedicated `package_created` value, so package creation attempts are logged with `notification_type = 'payment_receipt'` and `payload.event_type = 'package_created'`.
- `supabase db advisors --linked` still reports existing warnings for the intentionally callable ledger RPCs and some pre-existing auth/policy settings; no new warning was reported for `whatsapp_notifications`.

## 2026-07-09 - Phase 3/4 verification and Phase 5 session portal

### Phase 3 Verification
- Confirmed payment method locking migration exists: `supabase/migrations/20260708101504_lock_visit_payment_method.sql`.
- Confirmed `/api/register` passes `p_payment_method` into `register_patient_atomic`.
- Confirmed registration schema and public registration form require `cash` or `online` with no default preselection.
- Confirmed admin override route/UI exists for visit payment method changes with mandatory reason.
- Confirmed recent overrides are shown on the dashboard.

### Phase 4 Verification
- Confirmed cash reconciliation migration exists: `supabase/migrations/20260709120000_cash_reconciliation.sql`.
- Confirmed `GET/POST /api/admin/cash-reconciliation` and dashboard close-shift UI exist.
- Note for future hardening: the Phase 4 table policy currently allows any authenticated user to select/insert cash reconciliation rows. The API route limits access to admin/receptionist, but RLS could be tightened in a follow-up migration.

### Phase 5 Database
- Added migration: `supabase/migrations/20260709123000_session_checkin_patient_portal.sql`.
- Added `package_sessions` table for append-only delivered therapy session rows.
- Added `patient_portal_links` table for revocable public portal tokens.
- Added RPCs:
  - `mark_session_atomic`
  - `void_package_session_atomic`
  - `get_patient_portal_overview`
- Sessions used and sessions remaining are computed from non-voided `package_sessions` rows. No stored counter column was added.

### Phase 5 Backend
- Added `src/lib/patientPortal.ts` for server-only portal link creation/regeneration and URL building.
- Added `GET/POST /api/therapist/sessions` for therapist/admin session workflows.
- Added `GET /api/portal?token=<uuid>` for public read-only portal data.
- Added `POST /api/admin/patients/[id]/portal-link` for admin portal-link regeneration.
- Updated registration and package creation routes to create/reuse portal links and log WhatsApp attempts.

### Phase 5 Frontend
- Added public patient portal page: `src/app/portal/[token]/page.tsx`.
- Added therapist workbench: `src/app/(dashboard)/therapist/page.tsx`.
- Added therapist nav item for therapist role in `src/components/layout/Sidebar.tsx`.
- Updated patient detail package cards with computed session used/remaining counts.
- Added admin portal link regeneration action on patient detail.
- Updated Settings/staff creation to allow therapist users.

### Env Vars
- Added placeholder-only template env vars to `.env.example`:
  - `REGISTRATION_CONFIRMATION_TEMPLATE_NAME`
  - `PORTAL_LINK_TEMPLATE_NAME`
  - `SESSION_REMINDER_TEMPLATE_NAME`

### Verification
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run test -- src/lib/registration.test.ts` passed.
- `npm run build` passed.
- `supabase db push --linked --dry-run` confirmed the remote database is up to date after applying Phase 3, Phase 4, and Phase 5 migrations.

## 2026-07-09 - Phase 6 follow-up tasks

### Database
- Added migration: `supabase/migrations/20260709133000_follow_up_tasks.sql`.
- Added `follow_up_tasks` for missed expected sessions and early discontinuation follow-up work.
- Added `detect_follow_up_tasks_atomic()` to create one open missed-session task per active package when expected sessions exceed non-voided delivered sessions.
- Scheduled the daily `detect-follow-up-tasks-daily` cron job through `pg_cron` + `pg_net`, with URL/token values read from Supabase Vault.
- Confirmed the remote cron job is active and the detection RPC currently inserts `0` tasks against existing data.

### Edge Function
- Added `supabase/functions/detect-follow-up-tasks` to call the detection RPC using the service-role key.
- Added `FOLLOW_UP_CRON_SECRET` support so hosted cron calls can be protected by an `x-cron-secret` header.
- Deployed the Edge Function to the linked Supabase project and confirmed a request without the secret is rejected with HTTP 401.

### Backend
- Added `GET/PATCH /api/follow-up/tasks` for admin and follow-up agent roles.
- Follow-up agents only see and update tasks assigned to them; admins can see and update all tasks.
- Added computed `sessions_used` enrichment from `package_sessions` so the UI does not store session counters.

### Frontend
- Added the `/follow-up` dashboard page for admin and follow-up agent users.
- Added a role-gated Follow-up sidebar item.
- Extended staff creation to support `follow_up_agent` users.

### Env Vars
- Added placeholder-only `FOLLOW_UP_CRON_SECRET` to `.env.example`.
- `.env.local` remains gitignored; the real scheduled-job secret was configured in Supabase secrets/Vault only.

### Verification
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `supabase db push --linked --dry-run` confirmed the remote database is up to date after applying the Phase 6 migration.

## 2026-07-09 - Phase 7 admin master report

### Backend
- Added read-only admin report API: `GET /api/admin/reports`.
- Aggregates collections from `payment_transactions`, cash variances from `cash_reconciliations`, package balances from `patient_packages` + `payment_transactions`, delivered sessions from non-voided `package_sessions`, overrides from `visits`, follow-up outcomes from `follow_up_tasks`, and WhatsApp health from `whatsapp_notifications`.
- No new report tables, stored balances, stored session counters, or RPCs were added.

### Frontend
- Added admin-only report page: `src/app/(dashboard)/reports/page.tsx`.
- Added admin-only Reports sidebar link.
- Report sections include collections, package balance risk, active package session gaps, payment method overrides, repeat-patient rate, follow-up outcomes, and WhatsApp delivery health.
- Collections and packages sold can be filtered by date range and staff member.

### Verification
- `npm run check` passed.
- `supabase db query --linked` confirmed the Phase 1-6 source tables used by the report exist on the linked database.

## 2026-07-09 - Project context handoff refresh

### Documentation
- Updated `PROJECT_CONTEXT.md` through Phase 7.
- Added current phase status, recent commits, Supabase/WhatsApp/Edge Function setup notes, expanded env var guidance, new route map entries, updated roles, new database tables/RPCs, anti-fraud invariants, and read-first file guidance for future developers.

## 2026-07-09 - Project context post-WhatsApp/portal refresh

### Documentation
- Updated `PROJECT_CONTEXT.md` with the latest WhatsApp template placeholder names, public webhook middleware note, temporary Hostinger domain, portal magic-link URL behavior, and current WhatsApp testing failure modes.
