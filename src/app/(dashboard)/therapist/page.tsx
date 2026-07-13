"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Loader2,
  Phone,
  Search,
  ShieldAlert,
  UserRound,
} from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import * as dataService from '@/lib/dataService'
import type {
  TherapistPackageHistoryItem,
  TherapistPatientCard,
  TherapistPatientsPagination,
  TherapistPatientsStats,
  TherapistSessionTab,
} from '@/types'

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pageSize = 12

const tabs: Array<{ value: TherapistSessionTab; label: string; description: string }> = [
  { value: 'active', label: 'Active therapy', description: 'Patients who still need sessions marked.' },
  { value: 'completed', label: 'Completed therapy', description: 'Finished multi-session packages.' },
  { value: 'single', label: 'Single-time sessions', description: 'One-session therapies and their history.' },
]

function getDateKey(value: string | Date) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10)
  }
  return new Date(value).toISOString().slice(0, 10)
}

function getMonthCells(referenceDate = new Date()) {
  const year = referenceDate.getFullYear()
  const month = referenceDate.getMonth()
  const firstDayOffset = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingCells = Array.from({ length: firstDayOffset }, () => null)
  const dayCells = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1
    return {
      day,
      key: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    }
  })

  return [...leadingCells, ...dayCells]
}

function getSessionCountsByDate(patientPackage: TherapistPackageHistoryItem | null) {
  const counts = new Map<string, number>()
  for (const session of patientPackage?.sessions ?? []) {
    if (session.is_voided) continue
    const key = getDateKey(session.session_date)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function getPackageKindLabel(patientPackage: Pick<TherapistPackageHistoryItem, 'total_sessions'>) {
  return patientPackage.total_sessions === 1 ? 'Single-time therapy' : `${patientPackage.total_sessions} day package`
}

function getStatusClass(status: TherapistPackageHistoryItem['status']) {
  if (status === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'cancelled') return 'bg-slate-100 text-slate-600 border-slate-200'
  return 'bg-blue-50 text-blue-700 border-blue-200'
}

function getSessionsRemaining(patientPackage: TherapistPackageHistoryItem) {
  return patientPackage.sessions_remaining
}

function isTherapyMarkable(patientPackage: TherapistPackageHistoryItem) {
  return patientPackage.status === 'active' && getSessionsRemaining(patientPackage) > 0
}

function getTherapyStatusLabel(patientPackage: TherapistPackageHistoryItem) {
  return getSessionsRemaining(patientPackage) <= 0 ? 'done' : patientPackage.status
}

function getTherapyStatusClass(patientPackage: TherapistPackageHistoryItem) {
  if (getSessionsRemaining(patientPackage) <= 0) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return getStatusClass(patientPackage.status)
}

function getPackagesForTab(patient: TherapistPatientCard, tab: TherapistSessionTab) {
  if (tab === 'completed') return patient.completed_packages
  if (tab === 'single') return patient.single_time_packages
  return patient.active_packages
}

function getLatestSessionAt(packages: TherapistPackageHistoryItem[]) {
  return packages
    .map((patientPackage) => patientPackage.last_session_at ?? patientPackage.created_at)
    .sort((a, b) => b.localeCompare(a))[0] ?? null
}

function getDefaultSelectedPackage(patient: TherapistPatientCard | null, tab: TherapistSessionTab) {
  if (!patient) return null
  const tabPackages = getPackagesForTab(patient, tab).filter(isTherapyMarkable)
  return tabPackages[0]?.id ?? patient.package_history.find(isTherapyMarkable)?.id ?? null
}

function getEmptyLabel(tab: TherapistSessionTab) {
  if (tab === 'completed') return 'No completed therapy records found'
  if (tab === 'single') return 'No single-time therapy sessions found'
  return 'No active therapy patients found'
}

export default function TherapistPage() {
  const toast = useToast()
  const { profile, loading: authLoading } = useAuth()
  const [patients, setPatients] = useState<TherapistPatientCard[]>([])
  const [pagination, setPagination] = useState<TherapistPatientsPagination>({
    page: 1,
    pageSize,
    totalItems: 0,
    totalPages: 1,
  })
  const [stats, setStats] = useState<TherapistPatientsStats>({
    activePatients: 0,
    activePackages: 0,
    sessionsRemaining: 0,
    completedPatients: 0,
    completedPackages: 0,
    singleTimePatients: 0,
    singleTimePackages: 0,
  })
  const [activeTab, setActiveTab] = useState<TherapistSessionTab>('active')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [markingPackageId, setMarkingPackageId] = useState<string | null>(null)
  const [selectedPatient, setSelectedPatient] = useState<TherapistPatientCard | null>(null)
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null)

  const canAccess = profile?.role === 'therapist' || profile?.role === 'admin'
  const canBypassDailyLimit = profile?.role === 'admin'

  const loadPatients = useCallback(async () => {
    try {
      setLoading(true)
      const result = await dataService.getTherapistPatients({
        tab: activeTab,
        search,
        page,
        pageSize,
      })
      setPatients(result.patients)
      setPagination(result.pagination)
      setStats(result.stats)
      setSelectedPatient((current) => {
        if (!current) return null
        return result.patients.find((patient) => patient.patient_id === current.patient_id) ?? null
      })
      return result.patients
    } catch (error) {
      console.error('Failed to load therapist patients:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to load therapy patients')
      return []
    } finally {
      setLoading(false)
    }
  }, [activeTab, page, search, toast])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 250)

    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (!authLoading && canAccess) loadPatients()
    if (!authLoading && !canAccess) setLoading(false)
  }, [authLoading, canAccess, loadPatients])

  const selectableTherapies = useMemo(
    () => selectedPatient?.package_history.filter(isTherapyMarkable) ?? [],
    [selectedPatient]
  )

  useEffect(() => {
    if (!selectedPatient) return
    setSelectedPackageId((current) => {
      if (current && selectableTherapies.some((patientPackage) => patientPackage.id === current)) return current
      return selectableTherapies[0]?.id ?? null
    })
  }, [selectableTherapies, selectedPatient])

  const currentPackage = useMemo(() => {
    const fallbackId = selectableTherapies[0]?.id ?? null
    const id = selectedPackageId && selectableTherapies.some((patientPackage) => patientPackage.id === selectedPackageId)
      ? selectedPackageId
      : fallbackId
    return selectableTherapies.find((item) => item.id === id) ?? null
  }, [selectableTherapies, selectedPackageId])

  const currentSessionCounts = useMemo(
    () => getSessionCountsByDate(currentPackage),
    [currentPackage]
  )

  const monthCells = useMemo(() => getMonthCells(), [])
  const todayKey = getDateKey(new Date())
  const multiSessionRecords = selectedPatient?.package_history.filter((item) => item.total_sessions !== 1) ?? []
  const singleTimeRecords = selectedPatient?.single_time_packages ?? []

  const activeDescription = tabs.find((tab) => tab.value === activeTab)?.description ?? ''

  const openRecord = (patient: TherapistPatientCard) => {
    setSelectedPatient(patient)
    setSelectedPackageId(getDefaultSelectedPackage(patient, activeTab))
  }

  const switchTab = (tab: TherapistSessionTab) => {
    setActiveTab(tab)
    setPage(1)
    setSelectedPatient(null)
    setSelectedPackageId(null)
  }

  const markSession = async (patientPackage: TherapistPackageHistoryItem | null) => {
    if (!patientPackage || patientPackage.sessions_remaining <= 0) return
    if (!canBypassDailyLimit && patientPackage.today_sessions >= 2) {
      toast.error('This package already has 2 sessions marked today')
      return
    }

    setMarkingPackageId(patientPackage.id)
    try {
      const result = await dataService.markSessionComplete(patientPackage.id)
      await loadPatients()
      toast.success('Session marked complete')
      if (result.whatsapp?.status === 'failed') {
        toast.warning('Session saved, but WhatsApp delivery failed and was logged')
      }
    } catch (error) {
      console.error('Failed to mark session:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to mark session complete')
    } finally {
      setMarkingPackageId(null)
    }
  }

  const markFromCard = (patient: TherapistPatientCard) => {
    const markablePackages = patient.active_packages.filter(isTherapyMarkable)

    if (markablePackages.length === 1) {
      markSession(markablePackages[0])
      return
    }

    openRecord(patient)
  }

  if (!authLoading && !canAccess) {
    return (
      <DashboardLayout>
        <div className="p-4 md:p-6">
          <div className="card mx-auto mt-10 max-w-xl p-8 text-center">
            <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-amber-500" />
            <h1 className="mb-2 text-xl font-bold text-slate-900">Therapist access required</h1>
            <p className="text-sm text-slate-500">Only therapists and admins can mark therapy sessions.</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        <PageHeader
          title="Therapist Sessions"
          description="One patient card per person, with full package records inside the patient file."
          actions={
            <Button type="button" variant="outline" onClick={loadPatients} disabled={loading || authLoading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
              Refresh
            </Button>
          }
        />

        <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active patients</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{stats.activePatients}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active therapies</p>
            <p className="mt-2 text-2xl font-bold text-blue-700">{stats.activePackages}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sessions remaining</p>
            <p className="mt-2 text-2xl font-bold text-emerald-700">{stats.sessionsRemaining}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Single-time records</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{stats.singleTimePackages}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="space-y-4 border-b border-slate-100 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Therapy patients</h2>
                <p className="mt-1 text-sm text-slate-500">{activeDescription}</p>
              </div>
              <label className="relative block w-full lg:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search patient, phone, or therapy..."
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => switchTab(tab.value)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                    activeTab === tab.value
                      ? 'border-[var(--primary)] bg-[var(--primary)] text-white shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {loading || authLoading ? (
            <div className="flex items-center justify-center gap-3 p-10 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading therapy patients...
            </div>
          ) : patients.length === 0 ? (
            <div className="p-10 text-center">
              <CalendarCheck className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <p className="text-sm font-semibold text-slate-800">{getEmptyLabel(activeTab)}</p>
              <p className="mt-1 text-sm text-slate-500">Try another tab or search term.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {patients.map((patient) => {
                  const visiblePackages = getPackagesForTab(patient, activeTab)
                  const markablePackages = patient.active_packages.filter(isTherapyMarkable)
                  const canMark = markablePackages.length > 0 && activeTab !== 'completed'
                  const aggregateUsed = visiblePackages.reduce((sum, patientPackage) => sum + patientPackage.sessions_used, 0)
                  const aggregateRemaining = visiblePackages.reduce((sum, patientPackage) => sum + patientPackage.sessions_remaining, 0)
                  const aggregateToday = visiblePackages.reduce((sum, patientPackage) => sum + patientPackage.today_sessions, 0)
                  const latestSessionAt = getLatestSessionAt(visiblePackages)

                  return (
                    <article key={patient.patient_id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                          <UserRound className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-bold text-slate-900">{patient.patient_name}</h3>
                          {patient.patient_phone && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-slate-500">
                              <Phone className="h-3.5 w-3.5" />
                              {patient.patient_phone}
                            </p>
                          )}
                        </div>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-600">
                          {visiblePackages.length} {visiblePackages.length === 1 ? 'therapy' : 'therapies'}
                        </span>
                      </div>

                      <div className="mt-4 space-y-2">
                        {visiblePackages.slice(0, 2).map((patientPackage) => {
                          const progress = Math.min((patientPackage.sessions_used / Math.max(patientPackage.total_sessions, 1)) * 100, 100)
                          return (
                            <div key={patientPackage.id} className="rounded-lg bg-white p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-bold text-slate-900">{patientPackage.package_name}</p>
                                  <p className="mt-0.5 text-xs text-slate-500">{getPackageKindLabel(patientPackage)}</p>
                                </div>
                                <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold capitalize', getTherapyStatusClass(patientPackage))}>
                                  {getTherapyStatusLabel(patientPackage)}
                                </span>
                              </div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${progress}%` }} />
                              </div>
                            </div>
                          )
                        })}
                        {visiblePackages.length > 2 && (
                          <p className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-500">
                            +{visiblePackages.length - 2} more in patient record
                          </p>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold">
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">Used {aggregateUsed}</span>
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Left {aggregateRemaining}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">Today {aggregateToday}</span>
                      </div>

                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                        <Clock3 className="h-3.5 w-3.5" />
                        {latestSessionAt ? `Last: ${formatDateTime(latestSessionAt)}` : 'No session marked yet'}
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => openRecord(patient)}>
                          <Eye className="h-4 w-4" />
                          Record
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => markFromCard(patient)}
                          disabled={!canMark || Boolean(markingPackageId)}
                        >
                          <CalendarCheck className="h-4 w-4" />
                          {activeTab === 'completed' ? 'Done' : markablePackages.length > 1 ? 'Choose' : 'Mark'}
                        </Button>
                      </div>
                    </article>
                  )
                })}
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-100 p-4 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <p>
                  Showing {patients.length === 0 ? 0 : ((pagination.page - 1) * pagination.pageSize) + 1}
                  {'-'}
                  {Math.min(pagination.page * pagination.pageSize, pagination.totalItems)} of {pagination.totalItems}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.max(current - 1, 1))}
                    disabled={pagination.page <= 1 || loading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                    Page {pagination.page} / {pagination.totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.min(current + 1, pagination.totalPages))}
                    disabled={pagination.page >= pagination.totalPages || loading}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <Modal
        isOpen={Boolean(selectedPatient)}
        onClose={() => setSelectedPatient(null)}
        title={selectedPatient ? `${selectedPatient.patient_name} therapy record` : 'Therapy record'}
        size="full"
      >
        {selectedPatient && (
          <div className="space-y-3 p-4">
            <section className="grid grid-cols-1 gap-3 lg:grid-cols-[0.75fr_1.25fr]">
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Patient</p>
                <h3 className="mt-0.5 text-base font-bold text-slate-900">{selectedPatient.patient_name}</h3>
                {selectedPatient.patient_phone && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-slate-500">
                    <Phone className="h-3.5 w-3.5" />
                    {selectedPatient.patient_phone}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-slate-100 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Choose therapy</p>
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    {selectableTherapies.length} available
                  </span>
                </div>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {selectableTherapies.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
                      No active therapy has sessions remaining.
                    </p>
                  ) : (
                    selectableTherapies.map((patientPackage) => (
                      <button
                        key={patientPackage.id}
                        type="button"
                        onClick={() => setSelectedPackageId(patientPackage.id)}
                        className={cn(
                          'flex min-w-64 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition',
                          currentPackage?.id === patientPackage.id
                            ? 'border-[var(--primary)] bg-emerald-50'
                            : 'border-slate-100 bg-slate-50 hover:border-slate-200'
                        )}
                      >
                        <span className="min-w-0 truncate text-sm font-bold text-slate-900">{patientPackage.package_name}</span>
                        <span className="shrink-0 text-[11px] font-bold text-slate-500">
                          Used {patientPackage.sessions_used}/{patientPackage.total_sessions} | Left {getSessionsRemaining(patientPackage)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Selected therapy</p>
                  <h3 className="mt-0.5 truncate text-base font-bold text-slate-900">{currentPackage?.package_name ?? 'No active therapy selected'}</h3>
                  <p className="text-xs text-slate-500">{currentPackage ? getPackageKindLabel(currentPackage) : 'Choose an available therapy above.'}</p>
                </div>
                <div className="flex shrink-0 gap-2 text-center text-xs">
                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                    <p className="font-bold uppercase tracking-wide text-blue-700">Used</p>
                    <p className="text-lg font-bold text-blue-900">{currentPackage?.sessions_used ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                    <p className="font-bold uppercase tracking-wide text-emerald-700">Left</p>
                    <p className="text-lg font-bold text-emerald-900">{currentPackage ? getSessionsRemaining(currentPackage) : 0}</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-3 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-xl border border-slate-100 bg-white p-3">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 font-bold text-slate-900">
                      <CalendarDays className="h-5 w-5 text-[var(--primary)]" />
                      Session calendar
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Therapists can mark up to two sessions per package per day. Admin can bypass this.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => markSession(currentPackage)}
                    loading={currentPackage ? markingPackageId === currentPackage.id : false}
                    disabled={
                      !currentPackage ||
                      currentPackage.sessions_remaining <= 0 ||
                      (!canBypassDailyLimit && currentPackage.today_sessions >= 2) ||
                      Boolean(markingPackageId)
                    }
                  >
                    <CalendarCheck className="h-4 w-4" />
                    {!currentPackage ? 'Select therapy' : !canBypassDailyLimit && currentPackage.today_sessions >= 2 ? 'Daily limit reached' : 'Mark today'}
                  </Button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-500">
                  {weekdayLabels.map((label) => <div key={label} className="py-1">{label}</div>)}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {monthCells.map((cell, index) => {
                    if (!cell) return <div key={`empty-${index}`} className="min-h-16 rounded-lg bg-slate-50/60" />
                    const calendarPackage = currentPackage
                    const count = currentSessionCounts.get(cell.key) ?? 0
                    const isToday = cell.key === todayKey
                    const canMarkToday = calendarPackage
                      ? isToday
                        && calendarPackage.sessions_remaining > 0
                        && (canBypassDailyLimit || calendarPackage.today_sessions < 2)
                        && !markingPackageId
                      : false
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        disabled={!canMarkToday}
                        onClick={() => markSession(currentPackage)}
                        className={cn(
                          'min-h-16 rounded-lg border p-2 text-left transition-colors',
                          count > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-100 bg-white text-slate-600',
                          isToday && 'ring-2 ring-[var(--primary)]/30',
                          canMarkToday ? 'hover:border-[var(--primary)] hover:bg-emerald-50' : 'disabled:cursor-default'
                        )}
                      >
                        <span className="block text-xs font-bold">{cell.day}</span>
                        {count > 0 && (
                          <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                            <CalendarCheck className="h-3 w-3" />
                            {count}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <section className="rounded-xl border border-slate-100 bg-white">
                  <div className="border-b border-slate-100 p-3">
                    <h3 className="font-bold text-slate-900">Package history</h3>
                    <p className="mt-1 text-sm text-slate-500">Multi-session therapies only. Single-time sessions stay below.</p>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto p-3">
                    {multiSessionRecords.length === 0 ? (
                      <p className="text-sm text-slate-500">No multi-session packages recorded.</p>
                    ) : (
                      multiSessionRecords.map((historyItem, index) => (
                        <article key={historyItem.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-slate-900">
                                {index + 1}. {historyItem.package_name}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {getPackageKindLabel(historyItem)} | Started {formatDate(historyItem.created_at)}
                              </p>
                            </div>
                            <span className={cn('rounded-full border px-2 py-0.5 text-xs font-bold capitalize', getTherapyStatusClass(historyItem))}>
                              {getTherapyStatusLabel(historyItem)}
                            </span>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                            <div className="rounded-lg bg-white p-2">
                              <p className="font-semibold text-slate-500">Total</p>
                              <p className="font-bold text-slate-900">{historyItem.total_sessions}</p>
                            </div>
                            <div className="rounded-lg bg-white p-2">
                              <p className="font-semibold text-slate-500">Used</p>
                              <p className="font-bold text-blue-700">{historyItem.sessions_used}</p>
                            </div>
                            <div className="rounded-lg bg-white p-2">
                              <p className="font-semibold text-slate-500">Left</p>
                              <p className="font-bold text-emerald-700">{historyItem.sessions_remaining}</p>
                            </div>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </section>

                <section className="rounded-xl border border-slate-100 bg-white">
                  <div className="border-b border-slate-100 p-3">
                    <h3 className="font-bold text-slate-900">Single-time therapy sessions</h3>
                    <p className="mt-1 text-sm text-slate-500">One-session therapies appear here only, never duplicated above.</p>
                  </div>
                  <div className="max-h-56 space-y-2 overflow-y-auto p-3">
                    {singleTimeRecords.length === 0 ? (
                      <p className="text-sm text-slate-500">No single-time therapy sessions recorded.</p>
                    ) : (
                      singleTimeRecords.map((historyItem) => (
                        <article key={historyItem.id} className="rounded-lg bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-slate-900">{historyItem.package_name}</p>
                              <p className="text-xs text-slate-500">Created {formatDate(historyItem.created_at)}</p>
                            </div>
                            <span className={cn('rounded-full border px-2 py-0.5 text-xs font-bold capitalize', getTherapyStatusClass(historyItem))}>
                              {getTherapyStatusLabel(historyItem)}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {historyItem.sessions.length === 0 ? (
                              <span className="text-xs text-slate-500">No session marked yet</span>
                            ) : (
                              historyItem.sessions.filter((session) => !session.is_voided).map((session) => (
                                <span key={session.id} className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">
                                  {formatDate(session.session_date)}
                                </span>
                              ))
                            )}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </section>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  )
}
