export type UserRole = 'admin' | 'receptionist' | 'doctor' | 'therapist' | 'follow_up_agent'

export type VisitStatus = 'pending' | 'completed' | 'cancelled'

export type PaymentStatus = 'pending' | 'paid_cash' | 'paid_online'

export type PaymentMethod = 'cash' | 'online_upi' | null

export type LedgerPaymentMethod = 'cash' | 'online'

export type PackageStatus = 'active' | 'completed' | 'cancelled'

export type FollowUpReason = 'missed_expected_session' | 'discontinued_early'
export type FollowUpStatus = 'pending' | 'contacted' | 'resolved'
export type FollowUpOutcome = 'rescheduled' | 'discontinued_reason' | 'no_answer'

export interface FollowUpTask {
  id: string
  patient_id: string
  patient_package_id: string
  reason: FollowUpReason
  assigned_to: string | null
  status: FollowUpStatus
  outcome: FollowUpOutcome | null
  outcome_notes: string | null
  created_at: string
  resolved_at: string | null
  patient?: Patient | null
  patient_package?: PatientPackage | null
}

export interface AdminReportStaffMember {
  id: string
  full_name: string
  role: UserRole
}

export interface AdminReportCollections {
  date_from: string
  date_to: string
  staff_id: string | null
  cash_total: number
  online_total: number
  total_collected: number
  transaction_count: number
  cash_transaction_count: number
  online_transaction_count: number
  reconciliation_variance_total: number
  reconciliation_count: number
  reconciliation_variances: Array<{
    id: string
    shift_date: string
    system_cash_total: number
    counted_cash: number
    variance: number
    closed_by_name: string | null
    created_at: string
  }>
}

export interface AdminReportPackageSummary {
  sold_count: number
  sold_quoted_total: number
  outstanding_past_expected_count: number
  outstanding_past_expected_balance: number
  outstanding_packages: Array<{
    id: string
    patient_name: string
    package_name: string
    status: PackageStatus
    total_sessions: number
    quoted_amount: number
    paid_total: number
    balance_due: number
    expected_end_date: string
    created_at: string
  }>
}

export interface AdminReportSessionSummary {
  active_package_count: number
  expected_total: number
  delivered_total: number
  overrun_count: number
  underrun_count: number
  rows: Array<{
    id: string
    patient_name: string
    package_name: string
    total_sessions: number
    expected_sessions: number
    sessions_used: number
    status: 'on_track' | 'overrun' | 'underrun'
  }>
}

export interface AdminReportOverrideSummary {
  total_count: number
  by_staff: Array<{
    staff_id: string
    staff_name: string
    count: number
    most_recent_at: string
  }>
  recent: Array<{
    id: string
    patient_name: string
    payment_method: LedgerPaymentMethod
    reason: string
    staff_name: string
    updated_at: string
  }>
}

export interface AdminReportRepeatPatientRate {
  patient_count: number
  repeat_patient_count: number
  rate: number
}

export interface AdminReportFollowUpOutcomes {
  total_resolved: number
  outcomes: Array<{
    outcome: FollowUpOutcome | 'not_logged'
    count: number
  }>
}

export interface AdminReportWhatsAppHealth {
  total_last_7_days: number
  failed_last_7_days: number
  failure_rate: number
  sent: number
  queued: number
  failed: number
}

export interface AdminMasterReport {
  generated_at: string
  staff_members: AdminReportStaffMember[]
  collections: AdminReportCollections
  packages: AdminReportPackageSummary
  sessions: AdminReportSessionSummary
  overrides: AdminReportOverrideSummary
  repeat_patient_rate: AdminReportRepeatPatientRate
  follow_up_outcomes: AdminReportFollowUpOutcomes
  whatsapp_health: AdminReportWhatsAppHealth
}
export type WhatsAppNotificationType =
  | 'registration_confirmation'
  | 'payment_receipt'
  | 'session_reminder'
  | 'follow_up'
  | 'portal_link'

export type WhatsAppNotificationStatus = 'queued' | 'sent' | 'failed'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  email: string
  created_at: string
}

export interface Doctor {
  id: string
  name: string
  specialization: string | null
  is_active: boolean
}

export interface Patient {
  id: string
  full_name: string
  age: number
  gender: 'male' | 'female' | 'other'
  phone: string
  address: string | null
  father_name: string | null
  referral_source: string | null
  blood_group: string | null
  created_at: string
  updated_at?: string
}

export interface Visit {
  id: string
  patient_id: string
  doctor_id: string | null
  token_number: number
  token_date: string
  chief_complaint: string
  consultation_date: string
  consultation_time: string
  visit_type: 'first_visit' | 'follow_up'
  status: VisitStatus
  notes: string | null
  prescription: string | null
  registered_by: 'self' | 'receptionist'
  payment_method: LedgerPaymentMethod | null
  payment_method_locked_at: string | null
  payment_method_override_by: string | null
  payment_method_override_reason: string | null
  confirmation_token?: string
  created_at: string
  updated_at?: string
  patient?: Patient
  doctor?: Doctor
}

export interface LineItem {
  id: string
  name: string
  quantity: number
  amount: number
}

export interface Invoice {
  id: string
  visit_id: string
  patient_id: string
  invoice_number: string
  line_items: LineItem[]
  subtotal: number
  discount: number
  total: number
  payment_status: PaymentStatus
  payment_method: PaymentMethod
  paid_at: string | null
  created_at: string
  updated_at?: string
  visit?: Visit
  patient?: Patient
}

export interface PaymentTransaction {
  id: string
  patient_id: string
  patient_package_id: string | null
  visit_id: string | null
  amount: number
  payment_method: LedgerPaymentMethod
  recorded_by: string | null
  is_correction: boolean
  correction_reason: string | null
  created_at: string
  patient_package?: PatientPackage | null
  visit?: Visit | null
  whatsapp_notification?: WhatsAppNotification | null
}

export interface PatientPackage {
  id: string
  patient_id: string
  visit_id: string | null
  package_name: string
  total_sessions: number
  quoted_amount: number
  created_by: string | null
  status: PackageStatus
  created_at: string
  paid_total?: number
  balance?: number
  payments?: PaymentTransaction[]
  sessions_used?: number
  sessions_remaining?: number
  visit?: Visit | null
}

export interface PatientPortalLink {
  id: string
  patient_id: string
  token: string
  created_at: string
  revoked_at: string | null
  last_accessed_at: string | null
}

export interface PackageSession {
  id: string
  patient_package_id: string
  session_date: string
  marked_by: string | null
  marked_at: string
  is_voided: boolean
  void_reason: string | null
  notes: string | null
}

export interface TherapistSessionRecord {
  id: string
  patient_package_id: string
  session_date: string
  marked_at: string
  is_voided: boolean
  notes: string | null
}

export interface TherapistPackageHistoryItem {
  id: string
  package_name: string
  total_sessions: number
  status: PackageStatus
  created_at: string
  sessions_used: number
  sessions_remaining: number
  last_session_at: string | null
  sessions: TherapistSessionRecord[]
}

export interface MarkSessionResult {
  session_id: string
  patient_package_id: string
  patient_id: string
  package_name: string
  total_sessions: number
  sessions_used: number
  sessions_remaining: number
  whatsapp?: {
    notificationId: string | null
    status: WhatsAppNotificationStatus
    metaMessageId: string | null
    errorMessage: string | null
  }
}

export interface TherapistActivePackage {
  patient_package_id: string
  patient_id: string
  patient_name: string
  patient_phone: string | null
  package_name: string
  total_sessions: number
  sessions_used: number
  sessions_remaining: number
  last_session_at: string | null
  today_sessions: number
  package_history: TherapistPackageHistoryItem[]
}

export interface PatientPortalPayment {
  id: string
  amount: number
  payment_method: LedgerPaymentMethod
  is_correction: boolean
  correction_reason: string | null
  created_at: string
}

export interface PatientPortalPackage {
  package_id: string
  package_name: string
  status: PackageStatus
  total_sessions: number
  sessions_used: number
  sessions_remaining: number
  quoted_amount: number
  paid_total: number
  balance: number
  payment_history: PatientPortalPayment[]
}

export interface PatientPortalOverview {
  patient_id: string
  patient_name: string
  packages: PatientPortalPackage[]
}
export interface WhatsAppNotification {
  id: string
  patient_id: string
  notification_type: WhatsAppNotificationType
  payload: Record<string, unknown>
  status: WhatsAppNotificationStatus
  meta_message_id: string | null
  error_message: string | null
  created_at: string
}

export interface WorkingHoursSlot {
  start: string
  end: string
}

export interface ClinicDaySchedule {
  day: number
  enabled: boolean
  slots: WorkingHoursSlot[]
}

export interface ChargePreset {
  id: string
  name: string
  amount: number
  category: string
  is_active: boolean
}

export interface ClinicSettings {
  clinic_name: string
  address: string
  phone: string
  doctor_name: string
  registration_number: string
  website_url: string
  logo_url: string
  theme_color: string
  theme_color_hover: string
  theme_color_light: string
  working_hours_start: string
  working_hours_end: string
  working_days: number[]
  working_schedule: ClinicDaySchedule[]
  timezone: string
}

export interface DashboardStats {
  patients_today: number
  pending: number
  completed: number
  revenue_today: number
  pending_invoices: number
}

export interface PaymentMethodOverrideVisit extends Visit {
  patient?: Patient
}

export interface CashReconciliationRecord {
  id: string
  shift_date: string
  system_cash_total: number
  counted_cash: number
  variance: number
  notes: string | null
  closed_by: string | null
  created_at: string
  profiles?: {
    full_name?: string | null
  } | null
}
