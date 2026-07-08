# Project Context: Clinic CRM / Clinic Management System

Last updated: 2026-07-07

This document is a technical handoff for another developer or AI agent. It explains what this project is, why it exists, how it is structured, what services it uses, and which files/routes matter most.

## 1. What this project is

This is a multi-page clinic appointment, reception, patient, visit, and billing management system built with Next.js and Supabase.

It is intended to be sold or deployed as a product for multiple clinics. A clinic can customize branding, logo, theme colors, website link, doctor list, and registration hours from the admin settings page.

The product has two main surfaces:

1. Public patient registration
   - Patients scan a QR code or open `/register`.
   - They fill a 3-step mobile-friendly form.
   - They select a consultation date/time from the clinic's configured schedule.
   - The system creates/updates the patient and creates a visit/token.
   - The confirmation page shows the token and queue status.

2. Staff dashboard
   - Admin, receptionist, and doctor users log in through Supabase Auth.
   - Staff manage the daily queue, patients, visits, invoices, QR code, and settings.
   - Admin can create/delete staff users and manage tenant settings.

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
- realtime visit updates;
- security-definer RPC functions for atomic registration and invoice generation.

Important Supabase files:

- Browser client: `src/lib/supabase/client.ts`
- Server session client: `src/lib/supabase/server.ts`
- Service-role admin client: `src/lib/supabase/admin.ts`
- Migrations: `supabase/migrations/*.sql`
- Local Supabase config: `supabase/config.toml`

Security rule: never expose `SUPABASE_SERVICE_ROLE_KEY` to client code. Only use it in server-only Route Handlers or server utilities.

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
  - Used for QR links and origin validation.

- `REGISTRATION_RATE_LIMIT_SALT`
  - Server-only salt used to hash client IPs for public registration rate limiting.
  - Use a long random value in production.

- `APP_ALLOWED_ORIGINS`
  - Optional comma-separated extra allowed origins.
  - Useful when the app is accessed through temporary/staging/custom domains.

Do not commit `.env.local`.

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
  api/register/route.ts              Public/manual patient registration API
  api/public-config/route.ts         Public clinic config + doctor list API
  api/registration-status/route.ts   Public confirmation status API
  api/admin/invoices/route.ts        Staff invoice generation API
  api/admin/staff-users/route.ts     Admin staff create/delete/list API

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
  - Can manage clinic settings, doctors, staff users, charge presets, invoices, patients, visits.

- `receptionist`
  - Staff workflow access.
  - Can manage patients/visits/invoices depending on page checks.
  - Can generate invoices for visits.

- `doctor`
  - Staff role for clinical workflow.
  - Doctor accounts are separate from the doctor list shown on the registration form.

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

### `/visits`

Visit/queue management. Visit statuses are currently generic:

- `pending`
- `completed`
- `cancelled`

### `/patients`

Patient list/search. Patient detail page shows collected patient details and visit history.

### `/invoices`

Invoice analytics/list. Includes collection summary and filters. Invoices are not automatically created on registration anymore. Staff generate invoice manually when needed.

### `/settings`

Admin-focused settings page. Current sections include:

- branding: logo URL, theme presets, primary/hover/light colors;
- clinic profile: name, address, phone, registration number, website URL;
- doctor list: active doctors shown on registration;
- registration hours: working days and split slots;
- staff users: admin-created receptionist/doctor accounts.

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
| `GET` | `/api/admin/staff-users` | Admin | Lists staff profiles merged with Supabase Auth user emails. |
| `POST` | `/api/admin/staff-users` | Admin | Creates Supabase Auth user and matching `profiles` row for receptionist/doctor. |
| `DELETE` | `/api/admin/staff-users?id=<uuid>` | Admin | Deletes a staff Supabase Auth user. Prevents deleting the currently signed-in admin. |

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

- `token_counters`
  - Per-date token number counter.

- `invoices`
  - Billing record for a visit.
  - Current flow creates invoices manually through `create_invoice_for_visit`, not automatically during public registration.

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

### `public.create_invoice_for_visit(p_visit_id uuid)`

Server-only RPC used by `/api/admin/invoices`.

Responsibilities:

- validate visit exists;
- block invoice creation for cancelled visits;
- return existing invoice if one already exists;
- generate invoice number using private counter;
- prefill active consultation fee if available;
- insert invoice.

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

Public API prefixes:

- `/api/register`
- `/api/public-config`
- `/api/registration-status`

Everything else requires a Supabase session. Unauthenticated page requests redirect to `/login?next=<path>`. Unauthenticated protected API requests receive `401` JSON.

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
- After touching registration, invoices, auth, or settings, run at least `npm run typecheck`, `npm run lint`, and `npm run build`; run Vitest when changing schedule/registration logic.