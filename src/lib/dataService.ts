/**
 * Supabase Data Service
 * Replaces the mock backend with real Supabase database calls.
 */

import { createClient } from './supabase/client'
import { format } from 'date-fns'
import { normalizeWorkingSchedule } from './registration'
import { defaultBrandTheme, normalizeBrandTheme } from './brandTheme'
import type {
  Patient,
  Visit,
  Invoice,
  Doctor,
  ChargePreset,
  LineItem,
  DashboardStats,
  ClinicSettings,
  UserRole,
  PatientPackage,
  PaymentTransaction,
  LedgerPaymentMethod,
  WhatsAppNotification,
  PaymentMethodOverrideVisit,
  CashReconciliationRecord,
  MarkSessionResult,
  PatientPortalOverview,
  TherapistActivePackage,
  FollowUpOutcome,
  FollowUpStatus,
  FollowUpTask,
} from '../types'
import type { Database } from '../types/database'

export interface SelfRegisterPayload {
  full_name: string
  age: number
  gender: 'male' | 'female' | 'other'
  phone: string
  chief_complaint: string
  doctor_id?: string
  address?: string
  father_name?: string
  referral_source?: string
  visit_type: 'first_visit' | 'follow_up'
  consultation_date: string
  consultation_time: string
  payment_method: LedgerPaymentMethod
}

export interface StaffUser {
  id: string
  full_name: string
  email: string | null
  role: UserRole
  created_at: string
}

export interface CreateStaffUserPayload {
  full_name: string
  email: string
  password: string
  role: Extract<UserRole, 'receptionist' | 'doctor' | 'therapist' | 'follow_up_agent'>
}

export interface CreatePatientPackagePayload {
  patient_id: string
  visit_id?: string | null
  package_name: string
  total_sessions: number
  quoted_amount: number
}

export interface RecordPaymentPayload {
  patient_id: string
  patient_package_id?: string | null
  visit_id?: string | null
  amount: number
  payment_method: LedgerPaymentMethod
}

export interface PaymentHistoryFilters {
  patientId?: string
  packageId?: string
}

export interface RecordPaymentResult {
  payment_transaction_id: string
  patient_package_id: string | null
  paid_total: number
  balance: number | null
}

export interface OverridePaymentMethodPayload {
  visit_id: string
  payment_method: LedgerPaymentMethod
  reason: string
}

export interface CloseCashShiftPayload {
  counted_cash: number
  notes?: string | null
}

export interface UpdateFollowUpTaskPayload {
  id: string
  status: FollowUpStatus
  outcome?: FollowUpOutcome | null
  outcome_notes?: string | null
}

// ─── Patients ─────────────────────────────────────────────────────────────────

export async function getPatients(): Promise<Patient[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Patient[]
}

export async function getPatientById(id: string): Promise<Patient | null> {
  const supabase = createClient()
  const { data, error } = await supabase.from('patients').select('*').eq('id', id).single()
  if (error) return null
  return data as Patient
}

export async function getPatientByPhone(phone: string): Promise<Patient | null> {
  const supabase = createClient()
  const { data } = await supabase.from('patients').select('*').eq('phone', phone).maybeSingle()
  return data as Patient | null
}

export async function createPatient(
  data: Omit<Patient, 'id' | 'created_at' | 'updated_at'>
): Promise<Patient> {
  const supabase = createClient()
  const { data: patient, error } = await supabase
    .from('patients')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return patient as Patient
}

export async function updatePatient(id: string, updates: Partial<Patient>): Promise<Patient> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('patients')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Patient
}

// ─── Visits ───────────────────────────────────────────────────────────────────

export async function getVisits(date?: string): Promise<Visit[]> {
  const supabase = createClient()
  let query = supabase
    .from('visits')
    .select('*, patient:patients(*), doctor:doctors(*)')
    .order('token_number', { ascending: true })
  if (date) query = query.eq('consultation_date', date)
  const { data, error } = await query
  if (error) throw error
  return data as Visit[]
}

export async function getVisitById(id: string): Promise<Visit | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('visits')
    .select('*, patient:patients(*), doctor:doctors(*)')
    .eq('id', id)
    .single()
  if (error) return null
  return data as Visit
}

export async function getVisitsByPatient(patientId: string): Promise<Visit[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('visits')
    .select('*, doctor:doctors(*)')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Visit[]
}

export async function createVisit(
  data: Omit<Visit, 'id' | 'created_at' | 'updated_at' | 'patient' | 'doctor'>
): Promise<Visit> {
  const supabase = createClient()
  const { data: visit, error } = await supabase.from('visits').insert(data).select().single()
  if (error) throw error
  return visit as Visit
}

export async function updateVisit(id: string, updates: Partial<Visit>): Promise<Visit> {
  const supabase = createClient()
  const { status, doctor_id, notes, prescription } = updates as any
  const patch: Database['public']['Tables']['visits']['Update'] = {}
  if (status !== undefined) patch.status = status
  if (doctor_id !== undefined) patch.doctor_id = doctor_id
  if (notes !== undefined) patch.notes = notes
  if (prescription !== undefined) patch.prescription = prescription

  const { data, error } = await supabase
    .from('visits')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Visit
}

export async function overrideVisitPaymentMethod(payload: OverridePaymentMethodPayload): Promise<Visit> {
  const response = await fetch(`/api/admin/visits/${encodeURIComponent(payload.visit_id)}/payment-method`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_method: payload.payment_method,
      reason: payload.reason,
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to override payment method')
  }

  return result.visit as Visit
}

export async function getRecentPaymentMethodOverrides(limit = 10): Promise<PaymentMethodOverrideVisit[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('visits')
    .select('*, patient:patients(*)')
    .not('payment_method_override_by', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as PaymentMethodOverrideVisit[]
}

// ─── Token ────────────────────────────────────────────────────────────────────

export async function getNextToken(date: string = format(new Date(), 'yyyy-MM-dd')): Promise<number> {
  const supabase = createClient()
  const { count } = await supabase
    .from('visits')
    .select('*', { count: 'exact', head: true })
    .eq('token_date', date)
  return (count ?? 0) + 1
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export async function getInvoices(fromDate?: string, toDate?: string): Promise<Invoice[]> {
  const supabase = createClient()
  let query = supabase
    .from('invoices')
    .select('*, patient:patients(*), visit:visits(*)')
    .order('created_at', { ascending: false })
  if (fromDate) query = query.gte('created_at', fromDate)
  if (toDate) query = query.lte('created_at', toDate + 'T23:59:59')
  const { data, error } = await query
  if (error) throw error
  return data as Invoice[]
}

export async function getInvoiceById(id: string): Promise<Invoice | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('invoices')
    .select('*, patient:patients(*), visit:visits(*)')
    .eq('id', id)
    .single()
  if (error) return null
  return data as Invoice
}

export async function getInvoiceByVisit(visitId: string): Promise<Invoice | null> {
  const supabase = createClient()
  const { data } = await supabase
    .from('invoices')
    .select('*')
    .eq('visit_id', visitId)
    .maybeSingle()
  return data as Invoice | null
}

export async function generateInvoiceForVisit(visitId: string): Promise<Invoice> {
  const response = await fetch('/api/admin/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visit_id: visitId }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : 'Unable to generate invoice'
    throw new Error(message)
  }

  return payload.invoice as Invoice
}

export async function updateInvoice(id: string, updates: Partial<Invoice>): Promise<Invoice> {
  const supabase = createClient()
  const patch: Database['public']['Tables']['invoices']['Update'] = {}

  // Recalculate totals if line_items changed
  if (updates.line_items !== undefined) {
    patch.line_items = updates.line_items
    patch.subtotal = updates.line_items.reduce(
      (acc: number, item: LineItem) => acc + item.amount * item.quantity,
      0
    )
    patch.total = patch.subtotal - (updates.discount ?? 0)
  }
  if (updates.discount !== undefined && patch.subtotal === undefined) {
    // Need current subtotal — fetch first
    const current = await getInvoiceById(id)
    if (current) patch.total = current.subtotal - updates.discount
  }

  if (updates.discount !== undefined) patch.discount = updates.discount
  if (updates.payment_status !== undefined) patch.payment_status = updates.payment_status
  if (updates.payment_method !== undefined) patch.payment_method = updates.payment_method

  // Handle payment
  if (updates.payment_status && updates.payment_status !== 'pending') {
    patch.paid_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Invoice
}

// ─── Doctors ──────────────────────────────────────────────────────────────────

function withComputedPackageBalances(
  packages: PatientPackage[],
  payments: PaymentTransaction[]
): PatientPackage[] {
  return packages.map((patientPackage) => {
    const packagePayments = payments.filter(
      (payment) => payment.patient_package_id === patientPackage.id
    )
    const paidTotal = packagePayments.reduce((total, payment) => total + Number(payment.amount), 0)

    return {
      ...patientPackage,
      paid_total: paidTotal,
      balance: Number(patientPackage.quoted_amount) - paidTotal,
      payments: packagePayments,
    }
  })
}

export async function getPatientPackages(patientId: string): Promise<PatientPackage[]> {
  const supabase = createClient()
  const [{ data: packages, error: packagesError }, payments] = await Promise.all([
    supabase
      .from('patient_packages')
      .select('*, visit:visits(*)')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false }),
    getPaymentHistory({ patientId }),
  ])

  if (packagesError) throw packagesError

  const packageRows = (packages ?? []) as PatientPackage[]
  const packageIds = packageRows.map((patientPackage) => patientPackage.id)
  const sessionsByPackage = new Map<string, number>()

  if (packageIds.length > 0) {
    const { data: sessions, error: sessionsError } = await supabase
      .from('package_sessions')
      .select('patient_package_id, is_voided')
      .in('patient_package_id', packageIds)

    if (sessionsError) throw sessionsError

    for (const session of (sessions ?? []) as Array<{ patient_package_id: string; is_voided: boolean }>) {
      if (session.is_voided) continue
      sessionsByPackage.set(session.patient_package_id, (sessionsByPackage.get(session.patient_package_id) ?? 0) + 1)
    }
  }

  return withComputedPackageBalances(packageRows, payments).map((patientPackage) => {
    const sessionsUsed = sessionsByPackage.get(patientPackage.id) ?? 0
    return {
      ...patientPackage,
      sessions_used: sessionsUsed,
      sessions_remaining: Math.max(Number(patientPackage.total_sessions) - sessionsUsed, 0),
    }
  })
}

export async function getPaymentHistory(filters: PaymentHistoryFilters): Promise<PaymentTransaction[]> {
  if (!filters.patientId && !filters.packageId) {
    throw new Error('Patient id or package id is required to load payment history')
  }

  const supabase = createClient()
  let query = supabase
    .from('payment_transactions')
    .select('*, patient_package:patient_packages(*), visit:visits(*)')
    .order('created_at', { ascending: false })

  if (filters.packageId) query = query.eq('patient_package_id', filters.packageId)
  if (filters.patientId) query = query.eq('patient_id', filters.patientId)

  const { data, error } = await query
  if (error) throw error
  return attachWhatsAppNotifications((data ?? []) as PaymentTransaction[])
}

async function attachWhatsAppNotifications(payments: PaymentTransaction[]): Promise<PaymentTransaction[]> {
  const patientIds = Array.from(new Set(payments.map((payment) => payment.patient_id).filter(Boolean)))
  if (patientIds.length === 0) return payments

  const supabase = createClient()
  const { data, error } = await supabase
    .from('whatsapp_notifications')
    .select('*')
    .in('patient_id', patientIds)
    .eq('notification_type', 'payment_receipt')
    .order('created_at', { ascending: false })

  if (error) throw error

  const notificationsByPaymentId = new Map<string, WhatsAppNotification>()
  for (const notification of (data ?? []) as WhatsAppNotification[]) {
    const paymentTransactionId = typeof notification.payload?.payment_transaction_id === 'string'
      ? notification.payload.payment_transaction_id
      : null

    if (paymentTransactionId && !notificationsByPaymentId.has(paymentTransactionId)) {
      notificationsByPaymentId.set(paymentTransactionId, notification)
    }
  }

  return payments.map((payment) => ({
    ...payment,
    whatsapp_notification: notificationsByPaymentId.get(payment.id) ?? null,
  }))
}

export async function createPatientPackage(payload: CreatePatientPackagePayload): Promise<PatientPackage> {
  const response = await fetch('/api/admin/packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to create patient package')
  }

  return result.package as PatientPackage
}

export async function recordPayment(payload: RecordPaymentPayload): Promise<RecordPaymentResult> {
  const response = await fetch('/api/admin/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to record payment')
  }

  return result.payment as RecordPaymentResult
}

export async function getCashReconciliationSummary(): Promise<{
  shift_date: string
  system_cash_total: number
  history: CashReconciliationRecord[]
}> {
  const response = await fetch('/api/admin/cash-reconciliation', {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load cash reconciliation summary')
  }

  return payload as {
    shift_date: string
    system_cash_total: number
    history: CashReconciliationRecord[]
  }
}

export async function closeCashShift(payload: CloseCashShiftPayload): Promise<CashReconciliationRecord> {
  const response = await fetch('/api/admin/cash-reconciliation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(result.error || 'Unable to close cash shift')
  }

  return result.reconciliation as CashReconciliationRecord
}

export async function getTherapistActivePackages(): Promise<TherapistActivePackage[]> {
  const response = await fetch('/api/therapist/sessions', {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to load therapy packages')
  }

  return result.packages as TherapistActivePackage[]
}

export async function markSessionComplete(patientPackageId: string): Promise<MarkSessionResult> {
  const response = await fetch('/api/therapist/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient_package_id: patientPackageId }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to mark session complete')
  }

  return result.session as MarkSessionResult
}

export async function getPatientPortalOverview(token: string): Promise<PatientPortalOverview> {
  const response = await fetch(`/api/portal?token=${encodeURIComponent(token)}`, {
    cache: 'no-store',
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to load patient portal')
  }

  return result.overview as PatientPortalOverview
}

export async function regeneratePatientPortalLink(patientId: string): Promise<{ portal_url: string }> {
  const response = await fetch(`/api/admin/patients/${encodeURIComponent(patientId)}/portal-link`, {
    method: 'POST',
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to regenerate portal link')
  }

  return { portal_url: result.portal_url as string }
}

export async function getFollowUpTasks(): Promise<FollowUpTask[]> {
  const response = await fetch('/api/follow-up/tasks', {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to load follow-up tasks')
  }

  return result.tasks as FollowUpTask[]
}

export async function updateFollowUpTask(payload: UpdateFollowUpTaskPayload): Promise<FollowUpTask> {
  const response = await fetch('/api/follow-up/tasks', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to update follow-up task')
  }

  return result.task as FollowUpTask
}

export async function getDoctors(): Promise<Doctor[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('doctors')
    .select('*')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return data as Doctor[]
}

export async function getAllDoctors(): Promise<Doctor[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('doctors')
    .select('id, name, specialization, is_active')
    .order('is_active', { ascending: false })
    .order('name')
  if (error) throw error
  return data as Doctor[]
}

export async function createDoctor(data: Omit<Doctor, 'id'>): Promise<Doctor> {
  const supabase = createClient()
  const { data: doctor, error } = await supabase.from('doctors').insert(data).select().single()
  if (error) throw error
  return doctor as Doctor
}

export async function updateDoctor(id: string, updates: Partial<Doctor>): Promise<Doctor> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('doctors')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Doctor
}

export async function deleteDoctor(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('doctors')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ─── Staff Users ─────────────────────────────────────────────────────────────

export async function getStaffUsers(): Promise<StaffUser[]> {
  const response = await fetch('/api/admin/staff-users', { cache: 'no-store' })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to load staff users')
  }

  return result.staff as StaffUser[]
}

export async function createStaffUser(payload: CreateStaffUserPayload): Promise<StaffUser> {
  const response = await fetch('/api/admin/staff-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to create staff user')
  }

  return result.staff as StaffUser
}

export async function deleteStaffUser(id: string): Promise<void> {
  const response = await fetch(`/api/admin/staff-users?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Unable to delete staff user')
  }
}

// ─── Charge Presets ───────────────────────────────────────────────────────────

export async function getChargePresets(): Promise<ChargePreset[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('charge_presets')
    .select('*')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return data as ChargePreset[]
}

export async function createChargePreset(data: Omit<ChargePreset, 'id'>): Promise<ChargePreset> {
  const supabase = createClient()
  const { data: preset, error } = await supabase
    .from('charge_presets')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return preset as ChargePreset
}

export async function updateChargePreset(
  id: string,
  updates: Partial<ChargePreset>
): Promise<ChargePreset> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('charge_presets')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as ChargePreset
}

export async function deleteChargePreset(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('charge_presets').delete().eq('id', id)
  if (error) throw error
}

// ─── Self Registration ────────────────────────────────────────────────────────


// ??? Clinic Settings ??????????????????????????????????????????????????????????

export async function getClinicSettings(): Promise<ClinicSettings> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('clinic_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error

  return {
    clinic_name: data?.clinic_name ?? 'ClinicFlow Medical Center',
    address: data?.address ?? '',
    phone: data?.phone ?? '',
    doctor_name: data?.doctor_name ?? 'Clinic Doctor',
    registration_number: data?.registration_number ?? '',
    website_url: data?.website_url ?? '',
    ...normalizeBrandTheme({
      logo_url: data?.logo_url ?? defaultBrandTheme.logo_url,
      theme_color: data?.theme_color ?? defaultBrandTheme.theme_color,
      theme_color_hover: data?.theme_color_hover ?? defaultBrandTheme.theme_color_hover,
      theme_color_light: data?.theme_color_light ?? defaultBrandTheme.theme_color_light,
    }),
    working_hours_start: String(data?.working_hours_start ?? '09:00').slice(0, 5),
    working_hours_end: String(data?.working_hours_end ?? '18:00').slice(0, 5),
    working_days: data?.working_days ?? [1, 2, 3, 4, 5, 6],
    working_schedule: normalizeWorkingSchedule(
      data?.working_schedule,
      data?.working_days ?? [1, 2, 3, 4, 5, 6],
      String(data?.working_hours_start ?? '09:00').slice(0, 5),
      String(data?.working_hours_end ?? '18:00').slice(0, 5)
    ),
    timezone: data?.timezone ?? 'Asia/Kolkata',
  }
}

export async function updateClinicSettings(settings: ClinicSettings): Promise<ClinicSettings> {
  const supabase = createClient()
  const normalizedBrand = normalizeBrandTheme(settings)
  const { data, error } = await supabase
    .from('clinic_settings')
    .upsert({
      id: 1,
      clinic_name: settings.clinic_name.trim(),
      address: settings.address.trim(),
      phone: settings.phone.trim(),
      doctor_name: settings.doctor_name.trim(),
      registration_number: settings.registration_number.trim(),
      website_url: settings.website_url.trim(),
      logo_url: normalizedBrand.logo_url,
      theme_color: normalizedBrand.theme_color,
      theme_color_hover: normalizedBrand.theme_color_hover,
      theme_color_light: normalizedBrand.theme_color_light,
      working_hours_start: settings.working_hours_start,
      working_hours_end: settings.working_hours_end,
      working_days: settings.working_schedule.filter((day) => day.enabled).map((day) => day.day),
      working_schedule: JSON.parse(JSON.stringify(settings.working_schedule)),
      timezone: settings.timezone,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error

  return {
    clinic_name: data.clinic_name,
    address: data.address,
    phone: data.phone,
    doctor_name: data.doctor_name,
    registration_number: data.registration_number,
    website_url: data.website_url,
    ...normalizeBrandTheme({
      logo_url: data.logo_url,
      theme_color: data.theme_color,
      theme_color_hover: data.theme_color_hover,
      theme_color_light: data.theme_color_light,
    }),
    working_hours_start: String(data.working_hours_start).slice(0, 5),
    working_hours_end: String(data.working_hours_end).slice(0, 5),
    working_days: data.working_days,
    working_schedule: normalizeWorkingSchedule(
      data.working_schedule,
      data.working_days,
      String(data.working_hours_start).slice(0, 5),
      String(data.working_hours_end).slice(0, 5)
    ),
    timezone: data.timezone,
  }
}

export async function selfRegister(payload: SelfRegisterPayload): Promise<{
  token_number: number
  visit_id: string
  patient_name: string
  confirmation_ref: string
  duplicate_registration: boolean
}> {
  const response = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.error || 'Registration failed. Please try again.')
  }

  return result
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = createClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  const { data: todayVisits } = await supabase
    .from('visits')
    .select('status')
    .eq('token_date', today)

  const visits = todayVisits ?? []

  const { data: paidInvoices } = await supabase
    .from('invoices')
    .select('total')
    .gte('paid_at', today)
    .neq('payment_status', 'pending')

  const { count: pendingCount } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('payment_status', 'pending')

  return {
    patients_today: visits.length,
    pending: visits.filter((v) => v.status === 'pending').length,
    completed: visits.filter((v) => v.status === 'completed').length,
    revenue_today: (paidInvoices ?? []).reduce((acc, inv) => acc + inv.total, 0),
    pending_invoices: pendingCount ?? 0,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function getVisitCount(patientId: string): Promise<number> {
  const supabase = createClient()
  const { count } = await supabase
    .from('visits')
    .select('*', { count: 'exact', head: true })
    .eq('patient_id', patientId)
  return count ?? 0
}

export async function getTotalSpent(patientId: string): Promise<number> {
  const supabase = createClient()
  const { data } = await supabase
    .from('invoices')
    .select('total')
    .eq('patient_id', patientId)
    .neq('payment_status', 'pending')
  return (data ?? []).reduce((acc, inv) => acc + inv.total, 0)
}

// ─── Realtime (Supabase channels) ─────────────────────────────────────────────

type Listener = (data: unknown) => void
const _localListeners: Record<string, Listener[]> = {}

/** Subscribe to a local event (for components that still use the old subscribe API) */
export function subscribe(event: string, listener: Listener) {
  if (!_localListeners[event]) _localListeners[event] = []
  _localListeners[event].push(listener)
  return () => {
    _localListeners[event] = _localListeners[event].filter((l) => l !== listener)
  }
}

export function emit(event: string, data: unknown) {
  ;(_localListeners[event] || []).forEach((l) => l(data))
}

/** Subscribe to real Supabase realtime for visits table */
export function subscribeToVisits(callback: () => void): () => void {
  const supabase = createClient()
  const channel = supabase
    .channel('visits-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, callback)
    .subscribe()
  // Return synchronous cleanup — removeChannel is fire-and-forget
  return () => { supabase.removeChannel(channel) }
}
