"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import {
  ArrowLeft,
  BadgeInfo,
  Calendar,
  Clock,
  CreditCard,
  FileText,
  Hash,
  IndianRupee,
  Link2,
  NotebookText,
  Package,
  Phone,
  Pill,
  Plus,
  Stethoscope,
  Wallet,
} from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { formatDate, formatDateTime } from '@/lib/utils'
import * as dataService from '@/lib/dataService'
import type {
  LedgerPaymentMethod,
  Patient,
  PatientPackage,
  PaymentTransaction,
  Visit,
  WhatsAppNotificationStatus,
} from '@/types'

interface DetailItemProps {
  label: string
  value: string | number | null | undefined
  icon: ComponentType<{ className?: string }>
  tone?: 'emerald' | 'blue' | 'amber' | 'purple' | 'slate' | 'rose' | 'indigo'
}

type PackagePaymentForm = {
  target: 'new' | string
  therapyType: 'package' | 'single'
  visitId: string
  packageName: string
  totalSessions: string
  quotedAmount: string
  paymentAmount: string
  paymentMethod: '' | LedgerPaymentMethod
}

const emptyPackagePaymentForm: PackagePaymentForm = {
  target: 'new',
  therapyType: 'package',
  visitId: '',
  packageName: '',
  totalSessions: '1',
  quotedAmount: '',
  paymentAmount: '',
  paymentMethod: '',
}

const toneClasses: Record<NonNullable<DetailItemProps['tone']>, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  purple: 'bg-purple-50 text-purple-700 border-purple-100',
  slate: 'bg-slate-50 text-slate-700 border-slate-100',
  rose: 'bg-rose-50 text-rose-700 border-rose-100',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
}

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

function formatCurrency(value: number | null | undefined): string {
  return currencyFormatter.format(Number(value ?? 0))
}

function formatOptional(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Not provided'
  return String(value)
}

function formatReferralSource(source: string | null | undefined): string {
  const labels: Record<string, string> = {
    google: 'Google',
    youtube: 'YouTube',
    social_media: 'Social Media',
    friend_family: 'Friend / Family',
    doctor_referral: 'Doctor Referral',
    walk_in: 'Walk-in / Signboard',
    other: 'Other',
  }

  if (!source) return 'Not provided'
  return labels[source] ?? source.replace(/_/g, ' ')
}

function formatVisitType(type: Visit['visit_type'] | null | undefined): string {
  if (type === 'first_visit') return 'First-time visit'
  if (type === 'follow_up') return 'Repeat / follow-up'
  return 'Not provided'
}

function formatRegisteredBy(value: Visit['registered_by'] | null | undefined): string {
  if (value === 'self') return 'Self registration'
  if (value === 'receptionist') return 'Reception desk'
  return 'Not provided'
}

function formatTimeValue(value: string | null | undefined): string {
  if (!value) return 'Not provided'
  return value.slice(0, 5)
}

function getPaymentMethodLabel(method: LedgerPaymentMethod) {
  return method === 'cash' ? 'Cash' : 'Online'
}

function getWhatsAppBadgeClass(status: WhatsAppNotificationStatus) {
  if (status === 'sent') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 border-rose-200'
  return 'bg-amber-50 text-amber-700 border-amber-200'
}

function DetailItem({ label, value, icon: Icon, tone = 'slate' }: DetailItemProps) {
  return (
    <div className="flex gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${toneClasses[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 break-words text-sm font-semibold text-slate-900">{formatOptional(value)}</p>
      </div>
    </div>
  )
}

export default function PatientProfilePage() {
  const params = useParams()
  const router = useRouter()
  const toast = useToast()
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canManageBilling = profile?.role === 'admin' || profile?.role === 'receptionist'
  const id = params?.id as string

  const [patient, setPatient] = useState<Patient | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [patientPackages, setPatientPackages] = useState<PatientPackage[]>([])
  const [payments, setPayments] = useState<PaymentTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [savingPayment, setSavingPayment] = useState(false)
  const [form, setForm] = useState<PackagePaymentForm>(emptyPackagePaymentForm)
  const [overrideVisitId, setOverrideVisitId] = useState<string | null>(null)
  const [overridePaymentMethod, setOverridePaymentMethod] = useState<LedgerPaymentMethod>('cash')
  const [overrideReason, setOverrideReason] = useState('')
  const [savingOverride, setSavingOverride] = useState(false)
  const [regeneratingPortalLink, setRegeneratingPortalLink] = useState(false)
  const [portalUrl, setPortalUrl] = useState<string | null>(null)
  const paymentFormRef = useRef<HTMLElement | null>(null)
  const relatedVisitSelectRef = useRef<HTMLSelectElement | null>(null)

  const loadPatientLedger = async (patientId: string) => {
    const [packagesData, paymentData] = await Promise.all([
      dataService.getPatientPackages(patientId),
      dataService.getPaymentHistory({ patientId }),
    ])
    setPatientPackages(packagesData)
    setPayments(paymentData)
  }

  useEffect(() => {
    const loadData = async () => {
      try {
        const [patientData, visitsData, packagesData, paymentData] = await Promise.all([
          dataService.getPatientById(id),
          dataService.getVisitsByPatient(id),
          dataService.getPatientPackages(id),
          dataService.getPaymentHistory({ patientId: id }),
        ])
        setPatient(patientData)
        setVisits(visitsData)
        setPatientPackages(packagesData)
        setPayments(paymentData)
      } catch (error) {
        console.error('Failed to load patient data:', error)
      } finally {
        setLoading(false)
      }
    }
    if (id) loadData()
  }, [id])

  const activePackages = useMemo(
    () => patientPackages.filter((patientPackage) => patientPackage.status === 'active'),
    [patientPackages]
  )
  const pastPackages = useMemo(
    () => patientPackages.filter((patientPackage) => patientPackage.status !== 'active'),
    [patientPackages]
  )

  const selectedExistingPackage = form.target === 'new'
    ? null
    : patientPackages.find((patientPackage) => patientPackage.id === form.target) ?? null

  const focusPaymentForm = () => {
    window.requestAnimationFrame(() => {
      paymentFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      relatedVisitSelectRef.current?.focus({ preventScroll: true })
    })
  }

  const selectVisitForPayment = (visit: Visit) => {
    setForm((current) => ({
      ...current,
      target: 'new',
      therapyType: visit.visit_type === 'follow_up' ? 'single' : 'package',
      visitId: visit.id,
      packageName: visit.visit_type === 'follow_up' ? 'Single-time therapy' : 'Treatment package',
      totalSessions: visit.visit_type === 'follow_up' ? '1' : current.totalSessions || '1',
    }))
    focusPaymentForm()
  }

  const resetPaymentForm = () => {
    setForm(emptyPackagePaymentForm)
  }

  const handlePackagePaymentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!patient) return

    if (!form.paymentMethod) {
      toast.error('Payment method is required')
      return
    }

    const paymentAmount = Number(form.paymentAmount)
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      toast.error('Payment amount must be greater than 0')
      return
    }

    setSavingPayment(true)
    try {
      let packageId: string | null = null
      let visitId = form.visitId || null

      if (form.target === 'new') {
        const isSingleTimeTherapy = form.therapyType === 'single'
        const totalSessions = isSingleTimeTherapy ? 1 : Number(form.totalSessions)
        const quotedAmount = Number(form.quotedAmount)
        const packageName = form.packageName.trim() || (isSingleTimeTherapy ? 'Single-time therapy' : '')
        if (!packageName) throw new Error('Package name is required')
        if (!Number.isInteger(totalSessions) || totalSessions <= 0) throw new Error('Total sessions must be at least 1')
        if (!Number.isFinite(quotedAmount) || quotedAmount < 0) throw new Error('Quoted amount must be 0 or greater')

        const createdPackage = await dataService.createPatientPackage({
          patient_id: patient.id,
          visit_id: visitId,
          package_name: packageName,
          total_sessions: totalSessions,
          quoted_amount: quotedAmount,
        })
        packageId = createdPackage.id
      } else {
        packageId = form.target
        visitId = selectedExistingPackage?.visit_id ?? visitId
      }

      await dataService.recordPayment({
        patient_id: patient.id,
        patient_package_id: packageId,
        visit_id: visitId,
        amount: paymentAmount,
        payment_method: form.paymentMethod,
      })

      await loadPatientLedger(patient.id)
      resetPaymentForm()
      toast.success('Payment recorded in the append-only ledger')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save package payment')
    } finally {
      setSavingPayment(false)
    }
  }

  const openOverrideDialog = (visit: Visit) => {
    setOverrideVisitId(visit.id)
    setOverridePaymentMethod(visit.payment_method ?? 'cash')
    setOverrideReason('')
  }

  const handleOverrideSubmit = async () => {
    if (!overrideVisitId) return
    if (overrideReason.trim().length < 5) {
      toast.error('Override reason must be at least 5 characters')
      return
    }

    setSavingOverride(true)
    try {
      const updatedVisit = await dataService.overrideVisitPaymentMethod({
        visit_id: overrideVisitId,
        payment_method: overridePaymentMethod,
        reason: overrideReason.trim(),
      })

      setVisits((current) => current.map((visit) => visit.id === overrideVisitId ? {
        ...visit,
        payment_method: updatedVisit.payment_method,
        payment_method_override_by: updatedVisit.payment_method_override_by,
        payment_method_override_reason: updatedVisit.payment_method_override_reason,
      } : visit))
      setOverrideVisitId(null)
      setOverrideReason('')
      toast.success('Payment method updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to override payment method')
    } finally {
      setSavingOverride(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center p-6">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
        </div>
      </DashboardLayout>
    )
  }

  if (!patient) {
    return (
      <DashboardLayout>
        <div className="p-6 text-center">
          <h2 className="text-xl font-bold text-slate-800">Patient not found</h2>
          <Button onClick={() => router.push('/patients')} className="mt-4">
            Back to Patients
          </Button>
        </div>
      </DashboardLayout>
    )
  }

  const regeneratePortalLink = async () => {
    if (!patient) return
    const confirmed = window.confirm(
      'Regenerate this patient portal link? The previous link will be revoked immediately.'
    )
    if (!confirmed) return

    setRegeneratingPortalLink(true)
    try {
      const result = await dataService.regeneratePatientPortalLink(patient.id)
      setPortalUrl(result.portal_url)
      await navigator.clipboard?.writeText(result.portal_url)
      toast.success('Portal link regenerated and copied')
    } catch (error) {
      console.error('Failed to regenerate portal link:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to regenerate portal link')
    } finally {
      setRegeneratingPortalLink(false)
    }
  }

  const latestVisit = visits[0]
  const latestOverrideVisit = visits.find((visit) => visit.payment_method)
  const completedVisits = visits.filter((visit) => visit.status === 'completed').length
  const pendingVisits = visits.filter((visit) => visit.status === 'pending').length
  const patientInitial = patient.full_name.trim().charAt(0).toUpperCase() || '?'
  const headerMeta = [
    patient.father_name ? `Father: ${patient.father_name}` : null,
    patient.address ? `Address: ${patient.address}` : null,
    patient.referral_source ? `Heard about us: ${formatReferralSource(patient.referral_source)}` : null,
    `Registered: ${formatDateTime(patient.created_at)}`,
  ].filter(Boolean)

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
          <button
            type="button"
            aria-label="Back to patients"
            onClick={() => router.push('/patients')}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">Patient profile</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">{patient.full_name}</h1>
            <p className="mt-1 text-sm text-slate-500">Registered on {formatDate(patient.created_at, 'MMMM d, yyyy')}</p>
          </div>
          </div>
          {isAdmin && (
            <Button type="button" variant="outline" onClick={regeneratePortalLink} loading={regeneratingPortalLink}>
              <Link2 className="h-4 w-4" />
              Regenerate portal link
            </Button>
          )}
        </div>
        {portalUrl && (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            New portal link copied: <span className="font-semibold break-all">{portalUrl}</span>
          </div>
        )}

        <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div className="bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-5 md:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-3xl bg-[var(--primary)] text-4xl font-bold text-white shadow-sm">
                  {patientInitial}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-bold text-slate-900">{patient.full_name}</h2>
                    {latestVisit && <StatusBadge status={latestVisit.status} />}
                  </div>
                  <p className="mt-2 text-sm font-medium capitalize text-slate-600">
                    {patient.age} years | {patient.gender}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
                      <Phone className="h-3.5 w-3.5 text-[var(--primary)]" />
                      {patient.phone}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
                      <Calendar className="h-3.5 w-3.5 text-blue-600" />
                      {visits.length} visit{visits.length === 1 ? '' : 's'}
                    </span>
                    {latestVisit && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
                        <Hash className="h-3.5 w-3.5 text-amber-600" />
                        Latest token #{latestVisit.token_number}
                      </span>
                    )}
                    {latestVisit?.payment_method && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
                        <Wallet className="h-3.5 w-3.5 text-emerald-600" />
                        {latestVisit.payment_method === 'cash' ? 'Cash' : 'Online'}
                      </span>
                    )}
                  </div>
                  {headerMeta.length > 0 && (
                    <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-muted, #64748b)' }}>
                      {headerMeta.join(' | ')}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white/80 p-3 shadow-sm">
                <div className="text-center">
                  <p className="text-2xl font-bold text-slate-900">{visits.length}</p>
                  <p className="text-xs font-medium text-slate-500">Total visits</p>
                </div>
                <div className="border-x border-slate-100 px-3 text-center">
                  <p className="text-2xl font-bold text-emerald-700">{completedVisits}</p>
                  <p className="text-xs font-medium text-slate-500">Completed</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-amber-700">{pendingVisits}</p>
                  <p className="text-xs font-medium text-slate-500">Pending</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className={`grid grid-cols-1 gap-6 ${canManageBilling ? 'xl:grid-cols-[420px_minmax(0,1fr)]' : ''}`}>
          {canManageBilling && (
            <div className="space-y-6">
              <div className="space-y-4 xl:sticky xl:top-6">
                <section ref={paymentFormRef} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm scroll-mt-6">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                        <Wallet className="h-5 w-5 text-[var(--primary)]" />
                        Sell package / record payment
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">Creates append-only package and payment rows.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={resetPaymentForm}>
                      Clear
                    </Button>
                  </div>

                  <form className="space-y-4" onSubmit={handlePackagePaymentSubmit}>
                    <label className="block">
                      <span className="text-sm font-semibold text-slate-700">Apply payment to</span>
                      <select
                        value={form.target}
                        onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                      >
                        <option value="new">New package / one-time visit</option>
                        {activePackages.map((patientPackage) => (
                          <option key={patientPackage.id} value={patientPackage.id}>
                            {patientPackage.package_name} - balance {formatCurrency(patientPackage.balance)}
                          </option>
                        ))}
                      </select>
                    </label>

                    {form.target === 'new' && (
                      <div className="grid grid-cols-1 gap-3">
                        <div>
                          <span className="text-sm font-semibold text-slate-700">Therapy type</span>
                          <div className="mt-1 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                            {([
                              ['package', 'Package'],
                              ['single', 'Single-time therapy'],
                            ] as const).map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setForm((current) => ({
                                  ...current,
                                  therapyType: value,
                                  totalSessions: value === 'single' ? '1' : current.totalSessions,
                                  packageName: value === 'single' && !current.packageName.trim()
                                    ? 'Single-time therapy'
                                    : current.packageName,
                                }))}
                                className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                                  form.therapyType === value
                                    ? 'bg-white text-[var(--primary)] shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="block">
                          <span className="text-sm font-semibold text-slate-700">
                            {form.therapyType === 'single' ? 'Therapy description' : 'Package name'}
                          </span>
                          <input
                            value={form.packageName}
                            onChange={(event) => setForm((current) => ({ ...current, packageName: event.target.value }))}
                            placeholder={form.therapyType === 'single' ? 'Single-time therapy' : 'Treatment package'}
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                            required
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Total sessions</span>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={form.totalSessions}
                              onChange={(event) => setForm((current) => ({ ...current, totalSessions: event.target.value }))}
                              disabled={form.therapyType === 'single'}
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 disabled:bg-slate-100 disabled:text-slate-500"
                              required
                            />
                          </label>
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Quoted amount</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={form.quotedAmount}
                              onChange={(event) => setForm((current) => ({ ...current, quotedAmount: event.target.value }))}
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                              required
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    {selectedExistingPackage && (
                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
                        Balance for {selectedExistingPackage.package_name}: <strong>{formatCurrency(selectedExistingPackage.balance)}</strong>
                      </div>
                    )}

                    <label className="block">
                      <span className="text-sm font-semibold text-slate-700">Related visit</span>
                      <select
                        ref={relatedVisitSelectRef}
                        value={form.visitId}
                        onChange={(event) => setForm((current) => ({ ...current, visitId: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                      >
                        <option value="">No visit selected</option>
                        {visits.map((visit) => (
                          <option key={visit.id} value={visit.id}>
                            {formatDate(visit.consultation_date || visit.token_date)} - Token #{visit.token_number}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-sm font-semibold text-slate-700">Payment amount</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={form.paymentAmount}
                          onChange={(event) => setForm((current) => ({ ...current, paymentAmount: event.target.value }))}
                          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                          required
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold text-slate-700">Payment method</span>
                        <select
                          value={form.paymentMethod}
                          onChange={(event) => setForm((current) => ({
                            ...current,
                            paymentMethod: event.target.value as PackagePaymentForm['paymentMethod'],
                          }))}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                          required
                        >
                          <option value="">Select method</option>
                          <option value="cash">Cash</option>
                          <option value="online">Online</option>
                        </select>
                      </label>
                    </div>

                    <Button type="submit" loading={savingPayment} className="w-full justify-center">
                      <Plus className="h-4 w-4" />
                      Record payment
                    </Button>
                  </form>
                </section>

                {isAdmin && (
                  <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-900">Quick actions</h2>
                    <p className="mt-1 text-sm text-slate-500">Admin shortcuts for this patient.</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => latestOverrideVisit && openOverrideDialog(latestOverrideVisit)}
                      disabled={!latestOverrideVisit}
                      className="mt-4 w-full justify-center"
                    >
                      Override payment method
                    </Button>
                    {!latestOverrideVisit && (
                      <p className="mt-2 text-xs text-slate-500">No locked payment method is available to override yet.</p>
                    )}
                  </section>
                )}
              </div>
            </div>
          )}

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-100 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    <Package className="h-5 w-5 text-[var(--primary)]" />
                    Treatment packages
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">Balances are computed from payment transactions.</p>
                </div>
                <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {patientPackages.length} package{patientPackages.length === 1 ? '' : 's'}
                </span>
              </div>

              {patientPackages.length === 0 ? (
                <div className="p-10 text-center">
                  <Package className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                  <p className="text-sm text-slate-500">No package or one-time visit has been sold yet.</p>
                </div>
              ) : (
                <div className="space-y-5 p-5">
                  {([
                    ['Active packages', activePackages],
                    ['Past packages', pastPackages],
                  ] as const).map(([label, group]) => (
                    <div key={label} className={group.length === 0 ? 'hidden' : 'space-y-3'}>
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</h3>
                      {group.map((patientPackage) => (
                        <article key={patientPackage.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-bold text-slate-900">{patientPackage.package_name}</h4>
                                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold capitalize text-slate-600">
                                  {patientPackage.status}
                                </span>
                              </div>
                              <p className="mt-1 text-sm text-slate-500">
                                {patientPackage.total_sessions} session{patientPackage.total_sessions === 1 ? '' : 's'} | Sold {formatDateTime(patientPackage.created_at)}
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-5">
                              <div>
                                <p className="text-xs font-semibold text-slate-500">Used</p>
                                <p className="font-bold text-blue-700">{patientPackage.sessions_used ?? 0}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-500">Left</p>
                                <p className="font-bold text-emerald-700">{patientPackage.sessions_remaining ?? patientPackage.total_sessions}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-500">Quoted</p>
                                <p className="font-bold text-slate-900">{formatCurrency(patientPackage.quoted_amount)}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-500">Paid</p>
                                <p className="font-bold text-emerald-700">{formatCurrency(patientPackage.paid_total)}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-500">Balance</p>
                                <p className="font-bold text-amber-700">{formatCurrency(patientPackage.balance)}</p>
                              </div>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-100 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    <CreditCard className="h-5 w-5 text-[var(--primary)]" />
                    Payment history
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">Read-only append-only ledger. Corrections appear as negative rows.</p>
                </div>
                <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {payments.length} transaction{payments.length === 1 ? '' : 's'}
                </span>
              </div>

              {payments.length === 0 ? (
                <div className="p-10 text-center">
                  <IndianRupee className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                  <p className="text-sm text-slate-500">No payments recorded yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {payments.map((payment) => (
                    <article key={payment.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-slate-900">
                            {payment.patient_package?.package_name ?? 'Unassigned payment'}
                          </p>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                            {getPaymentMethodLabel(payment.payment_method)}
                          </span>
                          {payment.is_correction && (
                            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                              Correction
                            </span>
                          )}
                          {payment.whatsapp_notification ? (
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${getWhatsAppBadgeClass(payment.whatsapp_notification.status)}`}>
                              WhatsApp: {payment.whatsapp_notification.status}
                            </span>
                          ) : (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500">
                              WhatsApp: not logged
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{formatDateTime(payment.created_at)}</p>
                        {payment.correction_reason && (
                          <p className="mt-1 text-sm text-rose-700">{payment.correction_reason}</p>
                        )}
                      </div>
                      <p className={`text-lg font-bold ${payment.amount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {formatCurrency(payment.amount)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-100 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    <Calendar className="h-5 w-5 text-[var(--primary)]" />
                    Visit history
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">Complete visit, scheduling, and clinical details.</p>
                </div>
                <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {visits.length} visit{visits.length === 1 ? '' : 's'}
                </span>
              </div>

              {visits.length === 0 ? (
                <div className="p-10 text-center">
                  <FileText className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                  <p className="text-sm text-slate-500">No visits recorded for this patient yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {visits.map((visit) => (
                    <article key={visit.id} className="p-5 transition-colors hover:bg-slate-50/70">
                      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-bold text-slate-900">
                              {format(new Date(visit.consultation_date || visit.token_date), 'MMMM d, yyyy')}
                            </p>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                              Token #{visit.token_number}
                            </span>
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                              {formatVisitType(visit.visit_type)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-500">
                            {formatTimeValue(visit.consultation_time)} | {formatRegisteredBy(visit.registered_by)}
                            {visit.doctor ? ` | Dr. ${visit.doctor.name.replace(/^Dr\.?\s*/i, '')}` : ' | Doctor not assigned'}
                            {visit.payment_method && ` | ${visit.payment_method === 'cash' ? 'Cash' : 'Online'}`}
                            {visit.payment_method_override_by && ' (Overridden)'}
                          </p>
                        </div>
                        <div className="flex flex-col items-start gap-2 lg:items-end">
                          <StatusBadge status={visit.status} />
                          {visit.payment_method && (
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${
                              visit.payment_method === 'cash'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}>
                              {visit.payment_method === 'cash' ? 'Cash' : 'Online'}
                            </span>
                          )}
                          {canManageBilling && visit.status !== 'cancelled' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => selectVisitForPayment(visit)}
                              className="whitespace-nowrap"
                            >
                              <Wallet className="h-3.5 w-3.5" />
                              Sell package / payment
                            </Button>
                          )}
                          {isAdmin && visit.payment_method && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openOverrideDialog(visit)}
                              className="whitespace-nowrap"
                            >
                              Override payment
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailItem label="Consultation date" value={formatDate(visit.consultation_date || visit.token_date)} icon={Calendar} tone="blue" />
                        <DetailItem label="Consultation time" value={formatTimeValue(visit.consultation_time)} icon={Clock} tone="amber" />
                        <DetailItem label="Registered by" value={formatRegisteredBy(visit.registered_by)} icon={BadgeInfo} tone="slate" />
                        <DetailItem label="Doctor" value={visit.doctor?.name ?? 'Not assigned'} icon={Stethoscope} tone="emerald" />
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3">
                        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <div className="mb-2 flex items-center gap-2">
                            <NotebookText className="h-4 w-4 text-slate-500" />
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Disease / chief complaint</span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm font-medium text-slate-800">{visit.chief_complaint || 'Not provided'}</p>
                        </div>

                        {visit.notes && (
                          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                            <div className="mb-2 flex items-center gap-2">
                              <FileText className="h-4 w-4 text-blue-600" />
                              <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">Doctor notes</span>
                            </div>
                            <p className="whitespace-pre-wrap text-sm text-slate-800">{visit.notes}</p>
                          </div>
                        )}

                        {visit.prescription && (
                          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                            <div className="mb-2 flex items-center gap-2">
                              <Pill className="h-4 w-4 text-emerald-600" />
                              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Prescription</span>
                            </div>
                            <p className="whitespace-pre-wrap text-sm text-slate-800">{visit.prescription}</p>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      <Modal
        isOpen={!!overrideVisitId}
        onClose={() => { setOverrideVisitId(null); setOverrideReason('') }}
        title="Override payment method"
        size="sm"
      >
        <div className="space-y-4 p-6">
          <p className="text-sm text-slate-600">
            This update is logged for audit purposes and requires an explicit admin reason.
          </p>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">New payment method</span>
            <select
              value={overridePaymentMethod}
              onChange={(event) => setOverridePaymentMethod(event.target.value as LedgerPaymentMethod)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
            >
              <option value="cash">Cash</option>
              <option value="online">Online</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Reason <span className="text-red-500">*</span></span>
            <textarea
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              rows={3}
              placeholder="Explain why the payment method is being changed"
              className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
            />
            {overrideReason.length > 0 && overrideReason.trim().length < 5 && (
              <p className="mt-1 text-xs text-red-600">Reason must be at least 5 characters</p>
            )}
          </label>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => { setOverrideVisitId(null); setOverrideReason('') }} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleOverrideSubmit} loading={savingOverride} disabled={overrideReason.trim().length < 5} className="flex-1">
              Confirm override
            </Button>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  )
}
