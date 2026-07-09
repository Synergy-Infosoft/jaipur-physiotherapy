# Project Context: Clinic CRM / Clinic Management System

Last updated: 2026-07-09

This document is a technical handoff for another developer or AI agent. It explains what this project is, why it exists, how it is structured, what services it uses, and which files/routes matter most.

## 1. What this project is

This is a multi-page clinic appointment, reception, patient, visit, treatment-package, payment-ledger, follow-up, reporting, and patient-portal system built with Next.js and Supabase.

It is intended to be sold or deployed as a product for multiple clinics. A clinic can customize branding, logo, theme colors, website link, doctor list, and registration hours from the admin settings page.

The product has four main surfaces:

1. Public patient registration
   - Patients scan a QR code or open `/register`.
   - They fill a 3-step mobile-friendly form.
   - They select a consultation date/time from the clinic's configured schedule.
   - They choose the initial payment method, cash or online, with no default preselected.
   - The system creates/updates the patient and creates a visit/token.
   - The confirmation page shows the token and queue status.

2. Staff dashboard
   - Admin, receptionist, doctor, therapist, and follow-up agent users log in through Supabase Auth.
   - Staff manage the daily queue, patients, visits, packages, payments, sessions, follow-ups, reports, QR code, and settings according to role.
   - Admin can create/delete staff users and manage tenant settings.

3. Public patient portal
   - Patients can open a tokenized `/portal/[token]` link.
   - The portal shows package balances, sessions used/remaining, and payment history.
   - Portal links can be regenerated/revoked by admin workflow.

4. Anti-fraud financial/reporting layer
   - Billing is based on append-only treatment packages and payment transactions.
   - Financial records are never edited or deleted; corrections are inserted as new rows.
   - Payment method is locked at registration and can only be changed by admin override with a required reason.
   - WhatsApp notifications are logged for registrations, packages, portal links, sessions, and payments.
   - Admin master report reads from all Phase 1-6 tables and writes nothing.

## 1.1 Current phase status

Implemented and pushed through Phase 7.

Recent commits:

```text
c7f2593 docs: update whatsapp template placeholders
d587288 fix: use configured app url for portal links
0f9e31c fix: expose webhook endpoint for Meta verification
0c7bec5 docs: refresh project context through phase 7
e32fad3 feat: add admin master report
62c8727 feat: add follow-up task workflow
083ae42 docs: update phase verification log
afdbd57 feat: add session portal workflow
bdbfe06 feat: add cash reconciliation workflow
```

Phase summary:

- Phase 1/2 baseline: public registration, queue, patients, invoices, settings, branding, Supabase auth/database.
- Phase 3: payment method lock at registration plus admin-only override reason trail.
- Phase 4: cash reconciliation workflow.
- Phase 5: therapist session check-in and patient portal.
- Phase 6: daily follow-up task detection through Supabase Edge Function + cron.
- Phase 7: read-only admin master report.

Latest verification:

- `npm run check` passed after Phase 7 and again during the post-WhatsApp/portal status check.
- Linked Supabase DB had Phase 1-6 source tables available for the report.
- Phase 6 Edge Function `detect-follow-up-tasks` was deployed and cron job `detect-follow-up-tasks-daily` was active.
- Live Hostinger temporary domain is reachable and unauthenticated `/` redirects to `/login`.
- Current WhatsApp test failures are external setup issues:
  - template names must exist/translate in Meta;
  - recipient numbers must be in the allowed test list.

## 2. Problem it solves

Small clinics often use paper registers, WhatsApp, walk-in tokens, and manual billing. That causes:

- crowding at reception;
- duplicate or incomplete patient records;
- no clear queue/token visibility;
- invoice clutter from no-show registrations;
- difficulty tracking daily collection by cash/online;
- hard-coded clinic details that do not work for multiple clinics.

This system solves that by providing:

- QR-based public self-registration;
- token generation by appointment date;
- dynamic clinic schedule validation, including split shifts;
- staff-only dashboard access;
- manual invoice generation only after staff decide the patient actually needs billing;
- owner/admin analytics on invoices and collections;
- configurable branding and clinic profile data.

## 3. Tech stack

Runtime/app:

- Next.js 15 App Router
- React 18
- TypeScript 5
- Tailwind CSS 4
- lucide-react icons
- react-hook-form + zod for forms and validation
- date-fns for date formatting
- Zustand is installed, but most active data flow is via React state/context and `dataService`
- react-qr-code for QR rendering

Backend/service layer:

- Next.js Route Handlers under `src/app/api/**`
- Supabase Auth
- Supabase Postgres
- Supabase Realtime subscription for visit updates
- Supabase service-role admin client for trusted server-only actions

Tooling:

- ESLint 9
- Vitest 4
- TypeScript typecheck
- Supabase CLI migrations in `supabase/migrations`

Scripts:

```bash
npm run dev          # local Next.js development server
npm run build        # production build
npm run start        # serve production build
npm run lint         # eslint, max warnings 0
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
npm run check        # lint + typecheck + test + build
```

## 4. External services and integrations

### Supabase

Supabase is the main backend service.

Used for:

- Auth users and sessions;
- staff profiles/roles;
- clinic settings;
- doctors;
- patients;
- visits and tokens;
- invoices and charge presets;
- append-only patient packages and payment transactions;
- cash reconciliation;
- WhatsApp notification logs;
- therapist package sessions;
- public patient portal links;
- follow-up task queue;
- daily missed-session follow-up detection through Edge Functions, `pg_cron`, `pg_net`, and Vault;
- realtime visit updates;
- security-definer RPC functions for atomic registration, invoice generation, payment/package/session flows, payment method overrides, and follow-up detection.

Important Supabase files:

- Browser client: `src/lib/supabase/client.ts`
- Server session client: `src/lib/supabase/server.ts`
- Service-role admin client: `src/lib/supabase/admin.ts`
- Migrations: `supabase/migrations/*.sql`
- Local Supabase config: `supabase/config.toml`
- Edge Function: `supabase/functions/detect-follow-up-tasks/index.ts`

Security rule: never expose `SUPABASE_SERVICE_ROLE_KEY` to client code. Only use it in server-only Route Handlers or server utilities.

### WhatsApp / Meta Cloud API

WhatsApp Cloud API support is wired server-side.

Used for:

- registration confirmation attempts;
- package-created attempts;
- payment receipt attempts;
- portal-link attempts;
- session reminder attempts;
- webhook status updates;
- patient-detail WhatsApp status badges;
- admin report delivery-health metric.

Important files:

- Server utility: `src/lib/whatsapp.ts`
- Webhook route: `src/app/api/webhooks/whatsapp/route.ts`
- Notification log table migration: `supabase/migrations/20260708100549_add_whatsapp_notifications.sql`

Current setup expectation:

- Testing can use Meta's Cloud API test phone number and approved test recipient numbers.
- Production needs real WhatsApp Business number, approved templates, billing setup, and final webhook domain.
- Current placeholder template names in `.env.example` are:
  - `registration_confirmation`
  - `payment_receipt`
  - `package_created`
  - `portal_link`
  - `session_reminder`
- If Meta approves different template names, update the host environment variables instead of hard-coding names.
- Real tokens must only be stored in `.env.local`, host environment variables, or Supabase secrets. They must never be committed.

### Hosting

The app has been tested/deployed on a Hostinger temporary domain during development. The code itself is standard Next.js and can also be deployed to Vercel or another Next-compatible host.

Production deployments must set `NEXT_PUBLIC_APP_URL` to the final production origin, for example:

```env
NEXT_PUBLIC_APP_URL=https://clinic.example.com
```

This is used for QR URLs and request-origin checks.

### TestSprite

A `.mcp.json` exists for TestSprite MCP testing. Generated TestSprite artifacts may be present under `testsprite_tests/` if tests were generated/run locally. Treat those as test assets, not app runtime code.

## 5. Environment variables

See `.env.example` for the safe template.

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
REGISTRATION_RATE_LIMIT_SALT=replace-with-a-long-random-server-only-value
APP_ALLOWED_ORIGINS=https://your-production-domain.com
META_WHATSAPP_ACCESS_TOKEN=your-meta-whatsapp-access-token
META_WHATSAPP_PHONE_NUMBER_ID=your-meta-whatsapp-phone-number-id
META_WHATSAPP_BUSINESS_ACCOUNT_ID=your-meta-whatsapp-business-account-id
META_WHATSAPP_WEBHOOK_VERIFY_TOKEN=replace-with-a-random-webhook-verify-token
REGISTRATION_CONFIRMATION_TEMPLATE_NAME=registration_confirmation
PAYMENT_RECEIPT_TEMPLATE_NAME=payment_receipt
PACKAGE_CREATED_TEMPLATE_NAME=package_created
PORTAL_LINK_TEMPLATE_NAME=portal_link
SESSION_REMINDER_TEMPLATE_NAME=session_reminder
WHATSAPP_TEMPLATE_LANGUAGE=en
FOLLOW_UP_CRON_SECRET=replace-with-a-random-follow-up-cron-secret
```

Meaning:

- `NEXT_PUBLIC_SUPABASE_URL`
  - Public Supabase project URL.
  - Safe for browser.

- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Public anon/publishable key used by browser and server session clients.
  - Safe for browser, but still depends on RLS and policies.

- `SUPABASE_SERVICE_ROLE_KEY`
  - Server-only key used by `src/lib/supabase/admin.ts`.
  - Required for public registration RPC, staff user admin actions, public config loading, confirmation status lookup, and invoice creation APIs.
  - Never add `NEXT_PUBLIC_` to this key.

- `NEXT_PUBLIC_APP_URL`
  - Canonical app origin.
  - Must be changed from localhost when live.
  - Used for QR links, patient portal magic links, WhatsApp/portal URLs, and origin validation.
  - Important: if this is missing or wrong, portal links may be generated with a local origin such as `0.0.0.0:3000`.

- `REGISTRATION_RATE_LIMIT_SALT`
  - Server-only salt used to hash client IPs for public registration rate limiting.
  - Use a long random value in production.

- `APP_ALLOWED_ORIGINS`
  - Optional comma-separated extra allowed origins.
  - Useful when the app is accessed through temporary/staging/custom domains.

- `META_WHATSAPP_ACCESS_TOKEN`
  - Server-only Meta Cloud API token.
  - Used by `src/lib/whatsapp.ts`.

- `META_WHATSAPP_PHONE_NUMBER_ID`
  - Server-only Cloud API phone number ID.
  - The app posts template messages to `https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages`.

- `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
  - Server-only WhatsApp Business Account ID.
  - Reserved for template/business-account management flows.

- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
  - Server-only random string used for Meta webhook GET verification.

- `*_TEMPLATE_NAME`
  - Template names configured in Meta Business Manager.
  - Keep names in env because approved template names may change.

- `WHATSAPP_TEMPLATE_LANGUAGE`
  - Defaults to `en` if omitted.

- `FOLLOW_UP_CRON_SECRET`
  - Shared secret checked by the `detect-follow-up-tasks` Edge Function.
  - In hosted Supabase, this is configured in Edge Function secrets and Vault. The placeholder in `.env.example` is not a real value.

Do not commit `.env.local`.

Current temporary public app URL used during development:

```text
https://palegoldenrod-horse-305406.hostingersite.com
```

This should be set as `NEXT_PUBLIC_APP_URL` and included in `APP_ALLOWED_ORIGINS` on the host while the temporary domain is active.

## 6. Project structure

Important paths:

```text
src/app/
  layout.tsx                         Root layout/providers
  globals.css                        Global Tailwind/CSS variables
  page.tsx                           Root redirect/entry page
  register/page.tsx                  Public patient registration form
  confirmation/page.tsx              Public token confirmation page
  (auth)/login/page.tsx              Staff login
  (dashboard)/dashboard/page.tsx     Dashboard summary and queue
  (dashboard)/visits/page.tsx        Today's queue / visit management
  (dashboard)/patients/page.tsx      Patient list
  (dashboard)/patients/[id]/page.tsx Patient details
  (dashboard)/invoices/page.tsx      Invoice analytics/list
  (dashboard)/invoices/[id]/page.tsx Invoice detail
  (dashboard)/qr-code/page.tsx       Registration QR code
  (dashboard)/settings/page.tsx      Admin settings, branding, doctors, staff
  (dashboard)/therapist/page.tsx     Therapist package/session workbench
  (dashboard)/follow-up/page.tsx     Follow-up task queue
  (dashboard)/reports/page.tsx       Admin master report
  portal/[token]/page.tsx            Public patient portal
  api/register/route.ts              Public/manual patient registration API
  api/public-config/route.ts         Public clinic config + doctor list API
  api/registration-status/route.ts   Public confirmation status API
  api/admin/invoices/route.ts        Staff invoice generation API
  api/admin/packages/route.ts        Package sale API
  api/admin/payments/route.ts        Append-only payment API
  api/admin/cash-reconciliation/route.ts Cash shift close/report API
  api/admin/reports/route.ts         Admin master report aggregate API
  api/admin/staff-users/route.ts     Admin staff create/delete/list API
  api/admin/visits/[id]/payment-method/route.ts Admin payment method override API
  api/admin/patients/[id]/portal-link/route.ts Admin portal link regeneration API
  api/therapist/sessions/route.ts    Session check-in API
  api/follow-up/tasks/route.ts       Follow-up task list/update API
  api/portal/route.ts                Public portal data API
  api/webhooks/whatsapp/route.ts     Meta WhatsApp webhook API

src/components/
  layout/                            Dashboard layout/header/sidebar/mobile nav
  shared/                            BrandLogo, status badges, empty/loading states
  ui/                                Lightweight local UI primitives
  patients/                          Patient form components
  visits/                            Visit dialog components
  invoices/                          Invoice form components

src/context/
  AuthContext.tsx                    Supabase auth session and sign in/out
  BrandingContext.tsx                Fetches public config and applies brand theme CSS variables

src/lib/
  dataService.ts                     Main client-side data access wrapper
  registration.ts                    Registration schema, schedule normalization, slot validation
  registration.test.ts               Schedule/registration tests
  brandTheme.ts                      Theme normalization and CSS variable application
  mockData.ts                        Legacy/mock helpers if any
  supabase/                          Supabase clients

src/types/
  index.ts                           Main app domain types
  database.ts                        Supabase database typing

supabase/
  config.toml                        Local Supabase CLI config
  migrations/*.sql                   Database schema and function migrations
```

## 7. Main user roles

Roles are stored in `profiles.role`:

- `admin`
  - Full dashboard access.
  - Can manage clinic settings, doctors, staff users, charge presets, invoices, patients, visits, portal links, reports, package/payment views, cash reconciliation, follow-up tasks, and payment method overrides.

- `receptionist`
  - Staff workflow access.
  - Can manage patients/visits/invoices depending on page checks.
  - Can create packages and record append-only payments.
  - Can close cash shifts through the dashboard cash reconciliation workflow.

- `doctor`
  - Staff role for clinical workflow.
  - Doctor accounts are separate from the doctor list shown on the registration form.
  - Read-oriented access to patient/package/payment data is expected; write permissions are intentionally limited.

- `therapist`
  - Can use the therapist workbench.
  - Can mark package sessions through `mark_session_atomic`.
  - Session counters are computed from `package_sessions`, not stored on packages.

- `follow_up_agent`
  - Can use the follow-up task queue.
  - Can view and update tasks assigned to them.
  - Admin can view/update all follow-up tasks.

Important product decision:

- The `doctors` table is the public doctor list for patient selection.
- A doctor Auth account/profile is a staff login.
- These are currently manually related by process, not automatically linked.
- Adding a doctor to the doctor list does not automatically create a Supabase Auth user.

## 8. Public pages

### `/register`

Public patient registration.

Current form fields include:

- full name;
- optional father name;
- age;
- gender;
- phone;
- optional address;
- visit type: first-time or follow-up;
- disease/symptoms/chief complaint, minimum 5 characters;
- optional doctor preference from active doctors;
- optional referral source: Google, YouTube, social media, friend/family, doctor referral, walk-in/signboard, other;
- consultation date;
- consultation time.

Important behavior:

- Uses dynamic settings from `/api/public-config`.
- Uses `clinic_settings.working_schedule`, not hard-coded timings.
- Supports split-shift schedules, e.g. 8 AM-2 PM and 5 PM-9 PM.
- Lets users register any time of day, even if reception is currently closed.
- Still blocks invalid selected appointment slots:
  - past dates;
  - past times on current date;
  - closed days;
  - times outside configured working slots.
- Shows current reception status as information only.
- Shows a View timings modal instead of permanently rendering a large schedule block.

### `/confirmation`

Public confirmation page. It loads token status through `/api/registration-status?ref=<confirmation_uuid>`.

The confirmation reference is a UUID stored on `visits.confirmation_token`.

## 9. Staff dashboard pages

### `/login`

Supabase email/password login. No public signup. Staff users are created by an admin.

### `/dashboard`

Summary cards and queue overview. Uses `dataService.getDashboardStats()` and visits data.

Includes cash reconciliation UI and recent payment method override list for admin.

### `/visits`

Visit/queue management. Visit statuses are currently generic:

- `pending`
- `completed`
- `cancelled`

### `/patients`

Patient list/search. Patient detail page shows collected patient details and visit history.

Patient detail also shows:

- package cards with computed balance and sessions used/remaining;
- append-only payment history;
- WhatsApp delivery badges for payment rows;
- package/payment flow entry points;
- admin portal link regeneration;
- payment method read-only/override UI depending on role.

### `/invoices`

Invoice analytics/list. Includes collection summary and filters. Invoices are not automatically created on registration anymore. Staff generate invoice manually when needed.

Invoice pages are now legacy/manual invoice surfaces alongside the newer append-only package/payment ledger.

### `/settings`

Admin-focused settings page. Current sections include:

- branding: logo URL, theme presets, primary/hover/light colors;
- clinic profile: name, address, phone, registration number, website URL;
- doctor list: active doctors shown on registration;
- registration hours: working days and split slots;
- staff users: admin-created receptionist/doctor/therapist/follow-up agent accounts.

### `/therapist`

Therapist/admin workbench for active packages.

- Lists active packages with patient phone, total sessions, sessions used, and sessions remaining.
- Marks delivered sessions through `mark_session_atomic`.
- Sends/logs session reminder WhatsApp attempts.

### `/follow-up`

Follow-up agent/admin task queue.

- Lists pending/contacted/resolved tasks.
- Shows patient name, phone, reason, package, and session counts.
- Lets assigned follow-up agent or admin set status, outcome, and notes.

### `/reports`

Admin-only master report.

Sections:

- collections: cash vs online totals, date/staff filters, cash reconciliation variance;
- packages: sold and overdue outstanding balances;
- sessions: delivered vs expected per active package, overrun/underrun flags;
- payment method overrides: count by staff and recent entries;
- repeat-patient rate;
- follow-up outcomes;
- WhatsApp delivery health for last 7 days.

No writes happen from this page. It calls `GET /api/admin/reports`.

### `/portal/[token]`

Public patient portal page.

- Read-only package/payment/session overview.
- Uses tokenized portal links.
- No patient login is required.
- Admin can regenerate the portal magic link from the patient detail page.
- Regenerated links use `NEXT_PUBLIC_APP_URL` via `buildPatientPortalUrl(...)`; do not use `request.nextUrl.origin` here because local access through `0.0.0.0:3000` creates unusable mobile links.

Known theme behavior:

- `globals.css` contains default green CSS variables.
- `BrandingProvider` fetches `/api/public-config` client-side and then applies saved colors.
- This can cause a short flash of default green on reload before tenant colors hydrate.
- Best future fix: server-side critical branding in `src/app/layout.tsx`, or an inline pre-hydration theme script.

## 10. API routes

All route paths are relative to `NEXT_PUBLIC_APP_URL`.

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/public-config` | Public | Returns clinic settings, active doctors, and current open/closed status. |
| `POST` | `/api/register` | Public or authenticated staff | Validates registration payload, checks appointment slot for public users, rate-limits public attempts, calls `register_patient_atomic`. |
| `GET` | `/api/registration-status?ref=<uuid>` | Public | Returns token/status/queue position for a confirmation reference. |
| `POST` | `/api/admin/invoices` | Authenticated admin/receptionist | Creates or returns an invoice for a visit using `create_invoice_for_visit`. |
| `POST` | `/api/admin/packages` | Authenticated admin/receptionist | Creates a treatment package and logs WhatsApp attempts. |
| `POST` | `/api/admin/payments` | Authenticated admin/receptionist | Records an append-only payment transaction and logs WhatsApp attempts. |
| `GET` | `/api/admin/cash-reconciliation` | Authenticated admin/receptionist | Returns current shift cash reconciliation summary. |
| `POST` | `/api/admin/cash-reconciliation` | Authenticated admin/receptionist | Closes a cash shift using `close_cash_shift_atomic`. |
| `PATCH` | `/api/admin/visits/[id]/payment-method` | Admin | Overrides locked visit payment method with mandatory reason using `override_payment_method_atomic`. |
| `POST` | `/api/admin/patients/[id]/portal-link` | Admin | Regenerates/reuses a portal link for a patient. |
| `GET` | `/api/admin/reports` | Admin | Read-only aggregate master report across collections, packages, sessions, overrides, follow-ups, and WhatsApp health. |
| `GET` | `/api/admin/staff-users` | Admin | Lists staff profiles merged with Supabase Auth user emails. |
| `POST` | `/api/admin/staff-users` | Admin | Creates Supabase Auth user and matching `profiles` row for receptionist/doctor/therapist/follow-up agent. |
| `DELETE` | `/api/admin/staff-users?id=<uuid>` | Admin | Deletes a staff Supabase Auth user. Prevents deleting the currently signed-in admin. |
| `GET/POST` | `/api/therapist/sessions` | Therapist/admin | Lists active packages and marks delivered sessions. |
| `GET/PATCH` | `/api/follow-up/tasks` | Follow-up agent/admin | Lists assigned/all follow-up tasks and records status/outcome. |
| `GET` | `/api/portal?token=<uuid>` | Public | Returns public read-only portal package/payment/session overview. |
| `GET/POST` | `/api/webhooks/whatsapp` | Public webhook | Handles Meta verification challenge and delivery-status callbacks. |

Important API security patterns:

- Mutating APIs validate request origin using:
  - current request origin;
  - `NEXT_PUBLIC_APP_URL`;
  - `APP_ALLOWED_ORIGINS`;
  - forwarded host/proto headers.
- Public registration requires `Content-Type: application/json`.
- Admin/staff APIs use `createClient()` to get the current Supabase session, then `createAdminClient()` for trusted server work.
- Service-role RPCs are intentionally called only from server routes.

## 11. Database model

Main public tables:

- `profiles`
  - Auth user profile and role.
  - Columns include `id`, `full_name`, `role`, `created_at`.
  - Roles currently accepted: `admin`, `receptionist`, `doctor`, `therapist`, `follow_up_agent`.

- `doctors`
  - Public doctor list for registration.
  - Columns include `id`, `name`, `specialization`, `is_active`, `created_at`.

- `patients`
  - Master patient record.
  - Columns include `full_name`, `age`, `gender`, `phone`, `address`, `father_name`, `referral_source`, `blood_group`, timestamps.
  - Blood group exists historically in DB/types but has been removed from current registration UI.

- `visits`
  - One appointment/visit/token.
  - Columns include `patient_id`, `doctor_id`, `token_number`, `token_date`, `consultation_date`, `consultation_time`, `visit_type`, `chief_complaint`, `status`, `confirmation_token`, `registered_by`.
  - Phase 3 columns include `payment_method`, `payment_method_locked_at`, `payment_method_override_by`, `payment_method_override_reason`.
  - Payment method is locked at registration and protected by DB trigger; only admin RPC override can change it.

- `token_counters`
  - Per-date token number counter.

- `invoices`
  - Billing record for a visit.
  - Current flow creates invoices manually through `create_invoice_for_visit`, not automatically during public registration.
  - Invoice-only billing is no longer the primary anti-fraud design; treatment packages and payment ledger are now the core financial model.

- `patient_packages`
  - Append-only treatment package rows.
  - Columns include `patient_id`, optional `visit_id`, `package_name`, `total_sessions`, `quoted_amount`, `created_by`, `status`, `created_at`.
  - No stored balance or sessions remaining column.

- `payment_transactions`
  - Append-only payment ledger.
  - Columns include `patient_id`, optional `patient_package_id`, optional `visit_id`, `amount`, `payment_method`, `recorded_by`, `is_correction`, `correction_reason`, `created_at`.
  - No update/delete policy is allowed. Corrections are new rows, usually negative amounts with `is_correction = true`.

- `cash_reconciliations`
  - Closed-shift cash reconciliation rows.
  - Stores system cash total, counted cash, variance, closed_by, notes, and timestamp.

- `whatsapp_notifications`
  - Log of WhatsApp notification attempts and webhook delivery status.
  - Status values: `queued`, `sent`, `failed`.
  - Stores payload, Meta message ID, and error message.

- `package_sessions`
  - Append-only delivered therapy session rows.
  - Voiding is supported with `is_voided` and `void_reason`.
  - Sessions used is computed from non-voided rows.

- `patient_portal_links`
  - Tokenized public portal links.
  - Supports revocation and last accessed timestamp.

- `follow_up_tasks`
  - Follow-up queue for missed expected sessions or early discontinuation.
  - Status values: `pending`, `contacted`, `resolved`.
  - Outcomes: `rescheduled`, `discontinued_reason`, `no_answer`.

- `charge_presets`
  - Reusable billing items such as consultation fee.

- `clinic_settings`
  - Singleton row with `id = 1`.
  - Stores clinic profile, website URL, logo URL, theme colors, timezone, working days, and `working_schedule` JSONB.

- `audit_logs`
  - DB-level audit log for sensitive table changes from migration triggers.

Private schema tables:

- `private.registration_rate_limits`
  - Stores hashed request identifiers and attempt counts for public registration throttling.

- `private.invoice_counters`
  - Per-day invoice sequence counter.

## 12. Important database functions/RPCs

### `public.register_patient_atomic(...)`

Server-only RPC used by `/api/register`.

Responsibilities:

- normalize phone number;
- validate core patient/visit data at DB level;
- apply public registration rate limiting when `p_request_hash` is supplied;
- find existing patient by phone or create a new one;
- prevent duplicate non-cancelled visit for same patient and consultation date;
- generate token number for selected consultation date;
- insert visit;
- return token, visit ID, patient name, confirmation token, and duplicate flag.

As of the manual invoice migration, it does not create an invoice.
It now also stores the locked `payment_method` and `payment_method_locked_at` values for the visit.

### `public.create_invoice_for_visit(p_visit_id uuid)`

Server-only RPC used by `/api/admin/invoices`.

Responsibilities:

- validate visit exists;
- block invoice creation for cancelled visits;
- return existing invoice if one already exists;
- generate invoice number using private counter;
- prefill active consultation fee if available;
- insert invoice.

### `public.create_patient_package_atomic(...)`

Server-only RPC used by `/api/admin/packages`.

Responsibilities:

- require admin/receptionist role;
- insert a treatment package;
- return the created package row.

### `public.record_payment_atomic(...)`

Server-only RPC used by `/api/admin/payments`.

Responsibilities:

- require admin/receptionist role;
- insert a payment transaction;
- compute and return paid total and balance from ledger rows;
- never store balance on the package.

### `public.override_payment_method_atomic(...)`

Server-only RPC used by `/api/admin/visits/[id]/payment-method`.

Responsibilities:

- require admin role;
- update visit payment method;
- set override staff and reason;
- bypass the DB trigger only inside the controlled function.

### `public.close_cash_shift_atomic(...)`

Server-only RPC used by `/api/admin/cash-reconciliation`.

Responsibilities:

- compute cash total from payment transactions for the shift date;
- insert the counted cash and variance record.

### `public.mark_session_atomic(...)`

Server-only RPC used by `/api/therapist/sessions`.

Responsibilities:

- require therapist/admin role;
- insert a delivered package session;
- compute sessions used and remaining from non-voided `package_sessions`.

### `public.void_package_session_atomic(...)`

Admin-only RPC for voiding session rows while preserving auditability.

### `public.get_patient_portal_overview(...)`

Public token-based portal RPC used by `/api/portal`.

Responsibilities:

- validate a non-revoked portal token;
- return patient package, session, payment, and balance data;
- compute balances and sessions dynamically.

### `public.detect_follow_up_tasks_atomic()`

Service-role RPC called by the `detect-follow-up-tasks` Edge Function.

Responsibilities:

- scan active packages;
- compute expected sessions as days since package creation capped by total sessions;
- compare against non-voided delivered sessions;
- insert one open `missed_expected_session` follow-up task per behind package;
- never flag completed or cancelled packages.

### `public.get_next_token()` and `public.generate_invoice_number()`

Older/general helper functions still exist from earlier migrations. Newer flows mostly use the more specific RPCs above.

## 13. Registration and schedule validation

Core logic is in `src/lib/registration.ts`.

Important functions:

- `registrationSchema`
  - Zod schema shared by registration API and form concepts.

- `normalizeWorkingSchedule(...)`
  - Normalizes `clinic_settings.working_schedule` into a full week, Monday-Saturday then Sunday order.
  - Allows up to 3 slots per day.
  - Drops invalid slots.

- `getWorkingSlotsForDate(settings, date)`
  - Returns enabled slots for a selected date.

- `getAvailableConsultationTimes(settings, date, intervalMinutes)`
  - Produces selectable appointment times.
  - Excludes past times for the current clinic date unless `includePast` is true.

- `getConsultationSlotError(settings, date, time)`
  - Server/client validation for public appointment slots.
  - Blocks past dates, past times, closed days, and times outside working slots.

- `isClinicOpenNow(settings)`
  - Used for display/open status only.
  - Public registration is no longer blocked just because the clinic is closed at the current moment.

## 14. Authentication and route protection

Middleware file: `src/middleware.ts`

Public routes:

- `/login`
- `/register`
- `/confirmation`
- `/portal/[token]`

Public API prefixes:

- `/api/register`
- `/api/public-config`
- `/api/registration-status`
- `/api/portal`
- `/api/webhooks`

Everything else requires a Supabase session. Unauthenticated page requests redirect to `/login?next=<path>`. Unauthenticated protected API requests receive `401` JSON.

`/api/webhooks` is public so Meta can perform WhatsApp webhook verification and delivery callbacks without a logged-in dashboard session.

If an authenticated user visits `/login`, middleware redirects to `/dashboard`.

## 15. Branding and tenant customization

Branding data lives in `clinic_settings`:

- `clinic_name`
- `doctor_name`
- `address`
- `phone`
- `registration_number`
- `website_url`
- `logo_url`
- `theme_color`
- `theme_color_hover`
- `theme_color_light`

Frontend branding logic:

- `src/lib/brandTheme.ts` validates/normalizes theme colors.
- `src/context/BrandingContext.tsx` fetches `/api/public-config` and applies CSS variables:
  - `--primary`
  - `--primary-hover`
  - `--primary-light`
- `src/components/shared/BrandLogo.tsx` renders the configured logo/name.

Theme presets are defined in `src/app/(dashboard)/settings/page.tsx`.

## 16. Data access layer

`src/lib/dataService.ts` is the main client-side data access wrapper.

Key groups:

- patients:
  - `getPatients`
  - `getPatientById`
  - `getPatientByPhone`
  - `createPatient`
  - `updatePatient`

- visits:
  - `getVisits`
  - `getVisitById`
  - `getVisitsByPatient`
  - `createVisit`
  - `updateVisit`
  - `subscribeToVisits`

- invoices:
  - `getInvoices`
  - `getInvoiceById`
  - `getInvoiceByVisit`
  - `generateInvoiceForVisit`
  - `updateInvoice`

- packages/payments:
  - `createPatientPackage`
  - `recordPayment`
  - `getPatientPackages`
  - `getPaymentHistory`

- sessions/portal:
  - `getTherapistActivePackages`
  - `markPackageSession`
  - `regeneratePatientPortalLink`

- cash reconciliation:
  - `getCashReconciliationSummary`
  - `closeCashShift`

- follow-up:
  - `getFollowUpTasks`
  - `updateFollowUpTask`

- reports:
  - `getAdminMasterReport`

- doctors:
  - `getDoctors`
  - `getAllDoctors`
  - `createDoctor`
  - `updateDoctor`
  - `deleteDoctor`

- staff:
  - `getStaffUsers`
  - `createStaffUser`
  - `deleteStaffUser`

- settings:
  - `getClinicSettings`
  - `updateClinicSettings`

- public registration:
  - `selfRegister`

- dashboard:
  - `getDashboardStats`
  - `getVisitCount`
  - `getTotalSpent`
  - `getRecentPaymentMethodOverrides`

## 17. Realtime

Realtime subscription lives in `dataService.subscribeToVisits(callback)`.

It subscribes to `postgres_changes` on the `visits` table through a channel named `visits-realtime` and invokes the callback on changes.

Supabase Realtime must be enabled for the relevant table/publication in the database for this to work reliably.

## 18. Current product decisions and caveats

### Public registration versus appointment availability

Patients can open and submit registration any time. Current open/closed status is informational. The selected appointment date/time is what gets validated.

### Manual invoice generation

Public registration creates a patient and visit/token only. It does not create an invoice. This keeps invoice analytics clean when someone registers but never arrives.

Staff can generate an invoice from a visit row when appropriate.

### Append-only financial ledger

The core financial design is now treatment packages plus `payment_transactions`.

- No staff role should update or delete `payment_transactions`.
- No stored package balance should be added.
- Balance is computed as `quoted_amount - sum(payment_transactions.amount)`.
- Corrections must be inserted as new rows, not edits.

### Payment method lock

Visit `payment_method` is captured during registration and locked. Admin override requires a reason and is visible in dashboard/reporting.

### Sessions are computed, not stored

Sessions used/remaining are computed from non-voided `package_sessions`. Do not add a `sessions_remaining` column to `patient_packages`.

### WhatsApp delivery is non-blocking

WhatsApp send failures must be logged in `whatsapp_notifications` but must not roll back package, payment, registration, or session workflows.

Current known testing failure modes:

- `(#132001) Template name does not exist in the translation`
  - The configured template name/language does not exist or is not approved in Meta.
- `(#131030) Recipient phone number not in allowed list`
  - The patient/test recipient number has not been added to the Meta Cloud API test recipient list.

### Follow-up detection

The daily Edge Function creates follow-up tasks only for active packages that are behind expected session cadence. Completed/cancelled packages should not be flagged.

### Doctor list versus doctor login

The public doctor list and staff doctor Auth accounts are separate. This avoids automatically creating login users just because a clinic wants a doctor name shown on the registration form.

### Theme flash on reload

There is currently a short default-theme flash because CSS defaults load before client-fetched settings. If the product needs more polish here, implement server-side critical branding or a pre-hydration inline theme script.

### Deployment asset caching

If users see MIME type errors or chunk-load errors after deployment, it has previously been caused by stale browser/CDN cache serving old Next.js chunks. Clearing cache fixed it during development.

## 19. Local development setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` using `.env.example`.

3. Link/push Supabase if needed:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

4. Run development server:

```bash
npm run dev
```

5. Open:

```text
http://localhost:3000
```

## 20. Deployment checklist

Before production deployment:

- Set all environment variables on the host.
- Set `NEXT_PUBLIC_APP_URL` to the production domain.
- Set `APP_ALLOWED_ORIGINS` if using staging/temp/custom domains.
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- Configure Meta WhatsApp env vars and approved template names before expecting WhatsApp sends to succeed.
- Configure the Meta webhook callback to `/api/webhooks/whatsapp`.
- Ensure Supabase Vault and Edge Function secrets are configured for `detect-follow-up-tasks`.
- Run:

```bash
npm run check
```

- Push Supabase migrations:

```bash
supabase db push
```

- In Supabase Auth settings, enable recommended password security features such as leaked password protection.
- Ensure staff users are created by an admin, not through public signup.
- Confirm RLS/policies and service-role-only RPC grants after schema changes.

## 21. Useful commands

```bash
# See changed files
git status --short

# Run all checks
npm run check

# Run only registration tests
npm run test -- src/lib/registration.test.ts

# Build production output
npm run build

# Supabase migration list
supabase migration list

# Push local migrations to linked Supabase project
supabase db push

# Supabase security advisors
supabase db advisors --linked --type security
```

## 22. Files to read first when making changes

For public registration changes:

1. `src/app/register/page.tsx`
2. `src/app/api/register/route.ts`
3. `src/lib/registration.ts`
4. `supabase/migrations/20260626114625_manual_invoice_generation.sql`

For settings/branding changes:

1. `src/app/(dashboard)/settings/page.tsx`
2. `src/context/BrandingContext.tsx`
3. `src/lib/brandTheme.ts`
4. `src/app/api/public-config/route.ts`
5. `src/lib/dataService.ts`

For staff/admin changes:

1. `src/app/api/admin/staff-users/route.ts`
2. `src/context/AuthContext.tsx`
3. `src/middleware.ts`
4. `src/components/layout/Sidebar.tsx`

For billing changes:

1. `src/app/(dashboard)/invoices/page.tsx`
2. `src/app/(dashboard)/invoices/[id]/page.tsx`
3. `src/app/api/admin/invoices/route.ts`
4. `src/components/invoices/InvoiceForm.tsx`
5. `src/lib/dataService.ts`

For package/payment ledger changes:

1. `src/app/api/admin/packages/route.ts`
2. `src/app/api/admin/payments/route.ts`
3. `src/app/(dashboard)/patients/[id]/page.tsx`
4. `src/lib/dataService.ts`
5. `supabase/migrations/20260708094515_append_only_payment_ledger.sql`

For WhatsApp changes:

1. `src/lib/whatsapp.ts`
2. `src/app/api/webhooks/whatsapp/route.ts`
3. `src/app/api/register/route.ts`
4. `src/app/api/admin/packages/route.ts`
5. `src/app/api/admin/payments/route.ts`
6. `src/app/api/therapist/sessions/route.ts`

For session/portal changes:

1. `src/app/(dashboard)/therapist/page.tsx`
2. `src/app/portal/[token]/page.tsx`
3. `src/app/api/therapist/sessions/route.ts`
4. `src/app/api/portal/route.ts`
5. `src/lib/patientPortal.ts`
6. `supabase/migrations/20260709123000_session_checkin_patient_portal.sql`

For follow-up changes:

1. `src/app/(dashboard)/follow-up/page.tsx`
2. `src/app/api/follow-up/tasks/route.ts`
3. `supabase/functions/detect-follow-up-tasks/index.ts`
4. `supabase/migrations/20260709133000_follow_up_tasks.sql`

For reports changes:

1. `src/app/(dashboard)/reports/page.tsx`
2. `src/app/api/admin/reports/route.ts`
3. `src/lib/dataService.ts`
4. `src/types/index.ts`

## 23. High-level request flow examples

### Public registration flow

```text
/register
  -> GET /api/public-config
  -> patient fills form
  -> POST /api/register
      -> validate origin/content-type/body
      -> load clinic_settings
      -> validate selected appointment slot
      -> hash IP with REGISTRATION_RATE_LIMIT_SALT
      -> RPC register_patient_atomic(...)
  -> redirect /confirmation?ref=<confirmation_uuid>
  -> GET /api/registration-status?ref=<confirmation_uuid>
```

### Manual invoice flow

```text
Staff dashboard visit row
  -> click generate/create invoice
  -> POST /api/admin/invoices { visit_id }
      -> require admin/receptionist role
      -> RPC create_invoice_for_visit(visit_id)
      -> return invoice with patient/visit
  -> invoice page/detail
```

### Staff creation flow

```text
/settings staff section
  -> POST /api/admin/staff-users
      -> require admin role
      -> Supabase Auth admin createUser
      -> upsert profiles row
  -> staff can log in through /login
```

## 24. Notes for future AI agents

- Prefer reading the actual code over `projectprompt.md`; the prompt is historical and partially outdated.
- Do not change `.env.local` unless explicitly asked, and never print secrets.
- Use migrations for database schema/RPC changes.
- Keep public registration compatible with dynamic tenant settings; avoid hard-coded clinic-specific names/timings.
- Preserve the product direction: multi-clinic configurable SaaS-style app, not a one-off clinic website.
- Preserve anti-fraud invariants: append-only payment ledger, computed package balances, computed session counts, admin-only payment method override with reason, and non-blocking WhatsApp failure logging.
- After touching registration, invoices, auth, settings, ledger, sessions, follow-up, reports, or Supabase types, run `npm run check` when feasible; run targeted Vitest when changing schedule/registration logic.
