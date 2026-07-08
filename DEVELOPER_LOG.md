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
