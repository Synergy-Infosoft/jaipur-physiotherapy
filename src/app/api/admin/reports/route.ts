import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { AdminMasterReport, FollowUpOutcome, PackageStatus, UserRole } from '@/types'

export const dynamic = 'force-dynamic'

type AdminClient = ReturnType<typeof createAdminClient>

type ProfileRow = {
  id: string
  full_name: string
  role: UserRole
}

type PaymentRow = {
  amount: number
  payment_method: 'cash' | 'online'
  recorded_by: string | null
  created_at: string
}

type ReconciliationRow = {
  id: string
  shift_date: string
  system_cash_total: number
  counted_cash: number
  variance: number
  closed_by: string | null
  created_at: string
}

type PackageRow = {
  id: string
  patient_id: string
  package_name: string
  total_sessions: number
  quoted_amount: number
  created_by: string | null
  status: PackageStatus
  created_at: string
  patient?: { full_name?: string | null } | null
}

type PackagePaymentRow = {
  patient_package_id: string | null
  amount: number
}

type SessionRow = {
  patient_package_id: string
  is_voided: boolean
}

type VisitOverrideRow = {
  id: string
  payment_method: 'cash' | 'online' | null
  payment_method_override_by: string | null
  payment_method_override_reason: string | null
  updated_at: string | null
  created_at: string
  patient?: { full_name?: string | null } | null
}

type FollowUpTaskRow = {
  status: 'pending' | 'contacted' | 'resolved'
  outcome: FollowUpOutcome | null
}

type WhatsAppNotificationRow = {
  status: 'queued' | 'sent' | 'failed'
}

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10)
}

function parseDateParam(value: string | null, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return fallback
  return value
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return formatDateInput(date)
}

function getDateRange(request: NextRequest) {
  const today = new Date()
  const defaultTo = formatDateInput(today)
  const defaultFromDate = new Date(today)
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 30)
  const defaultFrom = formatDateInput(defaultFromDate)

  const dateFrom = parseDateParam(request.nextUrl.searchParams.get('date_from'), defaultFrom)
  const dateTo = parseDateParam(request.nextUrl.searchParams.get('date_to'), defaultTo)

  if (dateFrom > dateTo) return { dateFrom: dateTo, dateTo: dateFrom }
  return { dateFrom, dateTo }
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2))
}

function daysSince(dateValue: string) {
  const created = new Date(dateValue)
  if (Number.isNaN(created.getTime())) return 0

  const today = new Date()
  const start = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate())
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.max(0, Math.floor((end - start) / 86_400_000))
}

function expectedEndDate(packageRow: PackageRow) {
  return addDays(packageRow.created_at.slice(0, 10), packageRow.total_sessions)
}

async function requireAdminAccess() {
  const userClient = await createClient()
  const { data: { user }, error: userError } = await userClient.auth.getUser()

  if (userError || !user) {
    return { admin: null, response: jsonResponse({ error: 'Authentication required' }, 401) }
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw profileError

  if (!profile || profile.role !== 'admin') {
    return { admin: null, response: jsonResponse({ error: 'Admin access required' }, 403) }
  }

  return { admin, response: null }
}

async function loadProfiles(admin: AdminClient) {
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, role')
    .order('full_name', { ascending: true })

  if (error) throw error
  return (data ?? []) as ProfileRow[]
}

async function loadCollections(
  admin: AdminClient,
  profileNameById: Map<string, string>,
  dateFrom: string,
  dateTo: string,
  staffId: string | null
): Promise<AdminMasterReport['collections']> {
  const startIso = `${dateFrom}T00:00:00.000Z`
  const endExclusiveIso = `${addDays(dateTo, 1)}T00:00:00.000Z`

  let paymentQuery = admin
    .from('payment_transactions')
    .select('amount, payment_method, recorded_by, created_at')
    .gte('created_at', startIso)
    .lt('created_at', endExclusiveIso)
    .limit(10000)

  if (staffId) paymentQuery = paymentQuery.eq('recorded_by', staffId)

  const { data: payments, error: paymentError } = await paymentQuery
  if (paymentError) throw paymentError

  let reconciliationQuery = admin
    .from('cash_reconciliations')
    .select('id, shift_date, system_cash_total, counted_cash, variance, closed_by, created_at')
    .gte('shift_date', dateFrom)
    .lte('shift_date', dateTo)
    .order('created_at', { ascending: false })
    .limit(10000)

  if (staffId) reconciliationQuery = reconciliationQuery.eq('closed_by', staffId)

  const { data: reconciliations, error: reconciliationError } = await reconciliationQuery
  if (reconciliationError) throw reconciliationError

  const paymentRows = (payments ?? []) as PaymentRow[]
  const cashRows = paymentRows.filter((payment) => payment.payment_method === 'cash')
  const onlineRows = paymentRows.filter((payment) => payment.payment_method === 'online')
  const cashTotal = cashRows.reduce((sum, payment) => sum + Number(payment.amount), 0)
  const onlineTotal = onlineRows.reduce((sum, payment) => sum + Number(payment.amount), 0)
  const reconciliationRows = (reconciliations ?? []) as ReconciliationRow[]
  const reconciliationVarianceTotal = reconciliationRows.reduce((sum, record) => sum + Number(record.variance), 0)

  return {
    date_from: dateFrom,
    date_to: dateTo,
    staff_id: staffId,
    cash_total: roundCurrency(cashTotal),
    online_total: roundCurrency(onlineTotal),
    total_collected: roundCurrency(cashTotal + onlineTotal),
    transaction_count: paymentRows.length,
    cash_transaction_count: cashRows.length,
    online_transaction_count: onlineRows.length,
    reconciliation_variance_total: roundCurrency(reconciliationVarianceTotal),
    reconciliation_count: reconciliationRows.length,
    reconciliation_variances: reconciliationRows
      .filter((record) => Number(record.variance) !== 0)
      .map((record) => ({
        id: record.id,
        shift_date: record.shift_date,
        system_cash_total: Number(record.system_cash_total),
        counted_cash: Number(record.counted_cash),
        variance: Number(record.variance),
        closed_by_name: record.closed_by ? profileNameById.get(record.closed_by) ?? 'Staff' : null,
        created_at: record.created_at,
      })),
  }
}

async function loadPackageAndSessionSummaries(
  admin: AdminClient,
  dateFrom: string,
  dateTo: string,
  staffId: string | null
): Promise<Pick<AdminMasterReport, 'packages' | 'sessions' | 'repeat_patient_rate'>> {
  const { data: packages, error: packageError } = await admin
    .from('patient_packages')
    .select('id, patient_id, package_name, total_sessions, quoted_amount, created_by, status, created_at, patient:patients(full_name)')
    .order('created_at', { ascending: false })
    .limit(10000)

  if (packageError) throw packageError

  const { data: packagePayments, error: paymentError } = await admin
    .from('payment_transactions')
    .select('patient_package_id, amount')
    .not('patient_package_id', 'is', null)
    .limit(10000)

  if (paymentError) throw paymentError

  const { data: sessions, error: sessionError } = await admin
    .from('package_sessions')
    .select('patient_package_id, is_voided')
    .limit(10000)

  if (sessionError) throw sessionError

  const { count: patientCount, error: patientCountError } = await admin
    .from('patients')
    .select('id', { count: 'exact', head: true })

  if (patientCountError) throw patientCountError

  const packageRows = (packages ?? []) as PackageRow[]
  const paymentsByPackage = new Map<string, number>()
  for (const payment of (packagePayments ?? []) as PackagePaymentRow[]) {
    if (!payment.patient_package_id) continue
    paymentsByPackage.set(
      payment.patient_package_id,
      (paymentsByPackage.get(payment.patient_package_id) ?? 0) + Number(payment.amount)
    )
  }

  const sessionsByPackage = new Map<string, number>()
  for (const session of (sessions ?? []) as SessionRow[]) {
    if (session.is_voided) continue
    sessionsByPackage.set(session.patient_package_id, (sessionsByPackage.get(session.patient_package_id) ?? 0) + 1)
  }

  const periodStart = `${dateFrom}T00:00:00.000Z`
  const periodEnd = `${addDays(dateTo, 1)}T00:00:00.000Z`
  const soldInPeriod = packageRows.filter((packageRow) => {
    const inDateRange = packageRow.created_at >= periodStart && packageRow.created_at < periodEnd
    const byStaff = !staffId || packageRow.created_by === staffId
    return inDateRange && byStaff
  })

  const today = formatDateInput(new Date())
  const outstandingPackages = packageRows
    .map((packageRow) => {
      const paidTotal = paymentsByPackage.get(packageRow.id) ?? 0
      const balanceDue = roundCurrency(Number(packageRow.quoted_amount) - paidTotal)
      const expectedEnd = expectedEndDate(packageRow)
      return { packageRow, paidTotal, balanceDue, expectedEnd }
    })
    .filter(({ packageRow, balanceDue, expectedEnd }) => (
      packageRow.status !== 'completed'
      && expectedEnd < today
      && balanceDue > 0
    ))

  const activePackages = packageRows.filter((packageRow) => packageRow.status === 'active')
  const sessionRows = activePackages.map((packageRow) => {
    const expectedSessions = Math.min(daysSince(packageRow.created_at), packageRow.total_sessions)
    const sessionsUsed = sessionsByPackage.get(packageRow.id) ?? 0
    const status: 'on_track' | 'overrun' | 'underrun' = sessionsUsed > packageRow.total_sessions
      ? 'overrun'
      : sessionsUsed < expectedSessions
        ? 'underrun'
        : 'on_track'

    return {
      id: packageRow.id,
      patient_name: packageRow.patient?.full_name ?? 'Unknown patient',
      package_name: packageRow.package_name,
      total_sessions: packageRow.total_sessions,
      expected_sessions: expectedSessions,
      sessions_used: sessionsUsed,
      status,
    }
  })

  const packageCountByPatient = new Map<string, number>()
  for (const packageRow of packageRows) {
    packageCountByPatient.set(packageRow.patient_id, (packageCountByPatient.get(packageRow.patient_id) ?? 0) + 1)
  }

  const repeatPatientCount = Array.from(packageCountByPatient.values()).filter((count) => count > 1).length
  const totalPatientCount = patientCount ?? 0

  return {
    packages: {
      sold_count: soldInPeriod.length,
      sold_quoted_total: roundCurrency(soldInPeriod.reduce((sum, packageRow) => sum + Number(packageRow.quoted_amount), 0)),
      outstanding_past_expected_count: outstandingPackages.length,
      outstanding_past_expected_balance: roundCurrency(outstandingPackages.reduce((sum, item) => sum + item.balanceDue, 0)),
      outstanding_packages: outstandingPackages
        .sort((a, b) => b.balanceDue - a.balanceDue)
        .slice(0, 12)
        .map(({ packageRow, paidTotal, balanceDue, expectedEnd }) => ({
          id: packageRow.id,
          patient_name: packageRow.patient?.full_name ?? 'Unknown patient',
          package_name: packageRow.package_name,
          status: packageRow.status,
          total_sessions: packageRow.total_sessions,
          quoted_amount: Number(packageRow.quoted_amount),
          paid_total: roundCurrency(paidTotal),
          balance_due: balanceDue,
          expected_end_date: expectedEnd,
          created_at: packageRow.created_at,
        })),
    },
    sessions: {
      active_package_count: activePackages.length,
      expected_total: sessionRows.reduce((sum, row) => sum + row.expected_sessions, 0),
      delivered_total: sessionRows.reduce((sum, row) => sum + row.sessions_used, 0),
      overrun_count: sessionRows.filter((row) => row.status === 'overrun').length,
      underrun_count: sessionRows.filter((row) => row.status === 'underrun').length,
      rows: sessionRows
        .filter((row) => row.status !== 'on_track')
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'overrun' ? -1 : 1
          return Math.abs(b.sessions_used - b.expected_sessions) - Math.abs(a.sessions_used - a.expected_sessions)
        })
        .slice(0, 20),
    },
    repeat_patient_rate: {
      patient_count: totalPatientCount,
      repeat_patient_count: repeatPatientCount,
      rate: totalPatientCount > 0 ? Number(((repeatPatientCount / totalPatientCount) * 100).toFixed(1)) : 0,
    },
  }
}

async function loadOverrideSummary(
  admin: AdminClient,
  profileNameById: Map<string, string>
): Promise<AdminMasterReport['overrides']> {
  const { data, error } = await admin
    .from('visits')
    .select('id, payment_method, payment_method_override_by, payment_method_override_reason, updated_at, created_at, patient:patients(full_name)')
    .not('payment_method_override_by', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(10000)

  if (error) throw error

  const rows = (data ?? []) as VisitOverrideRow[]
  const byStaff = new Map<string, { staff_id: string; staff_name: string; count: number; most_recent_at: string }>()

  for (const row of rows) {
    if (!row.payment_method_override_by) continue
    const date = row.updated_at ?? row.created_at
    const current = byStaff.get(row.payment_method_override_by)
    if (current) {
      current.count += 1
      if (date > current.most_recent_at) current.most_recent_at = date
    } else {
      byStaff.set(row.payment_method_override_by, {
        staff_id: row.payment_method_override_by,
        staff_name: profileNameById.get(row.payment_method_override_by) ?? 'Staff',
        count: 1,
        most_recent_at: date,
      })
    }
  }

  return {
    total_count: rows.length,
    by_staff: Array.from(byStaff.values()).sort((a, b) => b.most_recent_at.localeCompare(a.most_recent_at)),
    recent: rows.slice(0, 12).map((row) => ({
      id: row.id,
      patient_name: row.patient?.full_name ?? 'Unknown patient',
      payment_method: row.payment_method ?? 'cash',
      reason: row.payment_method_override_reason ?? 'No reason recorded',
      staff_name: row.payment_method_override_by ? profileNameById.get(row.payment_method_override_by) ?? 'Staff' : 'Staff',
      updated_at: row.updated_at ?? row.created_at,
    })),
  }
}

async function loadFollowUpOutcomes(admin: AdminClient): Promise<AdminMasterReport['follow_up_outcomes']> {
  const { data, error } = await admin
    .from('follow_up_tasks')
    .select('status, outcome')
    .eq('status', 'resolved')
    .limit(10000)

  if (error) throw error

  const counts = new Map<FollowUpOutcome | 'not_logged', number>()
  for (const row of (data ?? []) as FollowUpTaskRow[]) {
    const key = row.outcome ?? 'not_logged'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return {
    total_resolved: data?.length ?? 0,
    outcomes: (['rescheduled', 'discontinued_reason', 'no_answer', 'not_logged'] as Array<FollowUpOutcome | 'not_logged'>)
      .map((outcome) => ({ outcome, count: counts.get(outcome) ?? 0 })),
  }
}

async function loadWhatsAppHealth(admin: AdminClient): Promise<AdminMasterReport['whatsapp_health']> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 7)

  const { data, error } = await admin
    .from('whatsapp_notifications')
    .select('status')
    .gte('created_at', since.toISOString())
    .limit(10000)

  if (error) throw error

  const rows = (data ?? []) as WhatsAppNotificationRow[]
  const failed = rows.filter((row) => row.status === 'failed').length
  const sent = rows.filter((row) => row.status === 'sent').length
  const queued = rows.filter((row) => row.status === 'queued').length

  return {
    total_last_7_days: rows.length,
    failed_last_7_days: failed,
    failure_rate: rows.length > 0 ? Number(((failed / rows.length) * 100).toFixed(1)) : 0,
    sent,
    queued,
    failed,
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminAccess()
    if (auth.response) return auth.response
    if (!auth.admin) return jsonResponse({ error: 'Admin access required' }, 403)

    const { dateFrom, dateTo } = getDateRange(request)
    const staffId = request.nextUrl.searchParams.get('staff_id') || null
    const profiles = await loadProfiles(auth.admin)
    const profileNameById = new Map(profiles.map((profile) => [profile.id, profile.full_name]))

    const [collections, packageSessionSummary, overrides, followUpOutcomes, whatsappHealth] = await Promise.all([
      loadCollections(auth.admin, profileNameById, dateFrom, dateTo, staffId),
      loadPackageAndSessionSummaries(auth.admin, dateFrom, dateTo, staffId),
      loadOverrideSummary(auth.admin, profileNameById),
      loadFollowUpOutcomes(auth.admin),
      loadWhatsAppHealth(auth.admin),
    ])

    const report: AdminMasterReport = {
      generated_at: new Date().toISOString(),
      staff_members: profiles,
      collections,
      packages: packageSessionSummary.packages,
      sessions: packageSessionSummary.sessions,
      overrides,
      repeat_patient_rate: packageSessionSummary.repeat_patient_rate,
      follow_up_outcomes: followUpOutcomes,
      whatsapp_health: whatsappHealth,
    }

    return jsonResponse({ report })
  } catch (error) {
    console.error('Admin report failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to load admin report' }, 503)
  }
}
