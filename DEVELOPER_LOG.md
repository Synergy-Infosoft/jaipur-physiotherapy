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
