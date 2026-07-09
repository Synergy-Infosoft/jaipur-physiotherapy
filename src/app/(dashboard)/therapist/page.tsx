"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CalendarCheck,
  CalendarDays,
  Clock3,
  Eye,
  Loader2,
  Phone,
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
import type { TherapistActivePackage, TherapistPackageHistoryItem } from '@/types'

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

export default function TherapistPage() {
  const toast = useToast()
  const { profile, loading: authLoading } = useAuth()
  const [packages, setPackages] = useState<TherapistActivePackage[]>([])
  const [loading, setLoading] = useState(true)
  const [markingPackageId, setMarkingPackageId] = useState<string | null>(null)
  const [selectedPackage, setSelectedPackage] = useState<TherapistActivePackage | null>(null)

  const canAccess = profile?.role === 'therapist' || profile?.role === 'admin'

  const loadPackages = useCallback(async (selectedPackageId?: string) => {
    try {
      setLoading(true)
      const activePackages = await dataService.getTherapistActivePackages()
      setPackages(activePackages)
      if (selectedPackageId) {
        setSelectedPackage(activePackages.find((item) => item.patient_package_id === selectedPackageId) ?? null)
      }
      return activePackages
    } catch (error) {
      console.error('Failed to load therapist packages:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to load therapy packages')
      return []
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (!authLoading && canAccess) loadPackages()
    if (!authLoading && !canAccess) setLoading(false)
  }, [authLoading, canAccess, loadPackages])

  const stats = useMemo(() => ({
    active: packages.length,
    remaining: packages.reduce((sum, patientPackage) => sum + patientPackage.sessions_remaining, 0),
    singleTime: packages.filter((patientPackage) => patientPackage.total_sessions === 1).length,
  }), [packages])

  const currentHistoryPackage = useMemo(() => {
    if (!selectedPackage) return null
    return selectedPackage.package_history.find((item) => item.id === selectedPackage.patient_package_id) ?? null
  }, [selectedPackage])

  const currentSessionCounts = useMemo(
    () => getSessionCountsByDate(currentHistoryPackage),
    [currentHistoryPackage]
  )

  const monthCells = useMemo(() => getMonthCells(), [])
  const todayKey = getDateKey(new Date())
  const singleTimeRecords = selectedPackage?.package_history.filter((item) => item.total_sessions === 1) ?? []

  const markSession = async (patientPackage: TherapistActivePackage) => {
    if (patientPackage.sessions_remaining <= 0) return
    if (patientPackage.today_sessions >= 2) {
      toast.error('This package already has 2 sessions marked today')
      return
    }

    setMarkingPackageId(patientPackage.patient_package_id)
    try {
      const result = await dataService.markSessionComplete(patientPackage.patient_package_id)
      await loadPackages(patientPackage.patient_package_id)
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
          description="Compact active patient list with package records and session calendar in each patient file."
          actions={
            <Button type="button" variant="outline" onClick={() => loadPackages(selectedPackage?.patient_package_id)} disabled={loading || authLoading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
              Refresh
            </Button>
          }
        />

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active patients</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{stats.active}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sessions remaining</p>
            <p className="mt-2 text-2xl font-bold text-emerald-700">{stats.remaining}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Single-time active</p>
            <p className="mt-2 text-2xl font-bold text-blue-700">{stats.singleTime}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-lg font-bold text-slate-900">Active therapy patients</h2>
            <p className="mt-1 text-sm text-slate-500">Open the patient record for history, calendar marks, and single-time sessions.</p>
          </div>

          {loading || authLoading ? (
            <div className="flex items-center justify-center gap-3 p-10 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading packages...
            </div>
          ) : packages.length === 0 ? (
            <div className="p-10 text-center">
              <CalendarCheck className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <p className="text-sm font-semibold text-slate-800">No active therapy packages found</p>
              <p className="mt-1 text-sm text-slate-500">New package and single-time therapy records will appear here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {packages.map((patientPackage) => {
                const isExhausted = patientPackage.sessions_remaining <= 0
                const reachedDailyLimit = patientPackage.today_sessions >= 2
                return (
                  <article key={patientPackage.patient_package_id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                            <UserRound className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <h3 className="truncate font-bold text-slate-900">{patientPackage.patient_name}</h3>
                            {patientPackage.patient_phone && (
                              <p className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                                <Phone className="h-3.5 w-3.5" />
                                {patientPackage.patient_phone}
                              </p>
                            )}
                          </div>
                        </div>
                        <p className="mt-3 line-clamp-1 text-sm font-semibold text-slate-800">{patientPackage.package_name}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
                          <span className="rounded-full bg-white px-2 py-1 text-slate-600">{getPackageKindLabel(patientPackage)}</span>
                          <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">Used {patientPackage.sessions_used}</span>
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Left {patientPackage.sessions_remaining}</span>
                          <span className={cn(
                            'rounded-full px-2 py-1',
                            reachedDailyLimit ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                          )}>
                            Today {patientPackage.today_sessions}/2
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
                      <div
                        className="h-full rounded-full bg-[var(--primary)]"
                        style={{ width: `${Math.min((patientPackage.sessions_used / Math.max(patientPackage.total_sessions, 1)) * 100, 100)}%` }}
                      />
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                      <Clock3 className="h-3.5 w-3.5" />
                      {patientPackage.last_session_at ? `Last: ${formatDateTime(patientPackage.last_session_at)}` : 'No session marked yet'}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setSelectedPackage(patientPackage)}>
                        <Eye className="h-4 w-4" />
                        Record
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => markSession(patientPackage)}
                        loading={markingPackageId === patientPackage.patient_package_id}
                        disabled={isExhausted || reachedDailyLimit || Boolean(markingPackageId)}
                      >
                        <CalendarCheck className="h-4 w-4" />
                        {isExhausted ? 'Done' : reachedDailyLimit ? 'Limit' : 'Mark'}
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <Modal
        isOpen={Boolean(selectedPackage)}
        onClose={() => setSelectedPackage(null)}
        title={selectedPackage ? `${selectedPackage.patient_name} therapy record` : 'Therapy record'}
        size="full"
      >
        {selectedPackage && (
          <div className="space-y-5 p-5">
            <section className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 lg:col-span-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Current package</p>
                <h3 className="mt-1 text-lg font-bold text-slate-900">{selectedPackage.package_name}</h3>
                <p className="mt-1 text-sm text-slate-500">{getPackageKindLabel(selectedPackage)}</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Used</p>
                <p className="mt-1 text-2xl font-bold text-blue-900">{selectedPackage.sessions_used}</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Left</p>
                <p className="mt-1 text-2xl font-bold text-emerald-900">{selectedPackage.sessions_remaining}</p>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-xl border border-slate-100 bg-white p-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 font-bold text-slate-900">
                      <CalendarDays className="h-5 w-5 text-[var(--primary)]" />
                      Session calendar
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">Tap today to mark a session. A package can be marked twice per day.</p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => markSession(selectedPackage)}
                    loading={markingPackageId === selectedPackage.patient_package_id}
                    disabled={selectedPackage.sessions_remaining <= 0 || selectedPackage.today_sessions >= 2 || Boolean(markingPackageId)}
                  >
                    <CalendarCheck className="h-4 w-4" />
                    {selectedPackage.today_sessions >= 2 ? 'Daily limit reached' : 'Mark today'}
                  </Button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-500">
                  {weekdayLabels.map((label) => <div key={label} className="py-1">{label}</div>)}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {monthCells.map((cell, index) => {
                    if (!cell) return <div key={`empty-${index}`} className="min-h-16 rounded-lg bg-slate-50/60" />
                    const count = currentSessionCounts.get(cell.key) ?? 0
                    const isToday = cell.key === todayKey
                    const canMarkToday = isToday && selectedPackage.sessions_remaining > 0 && selectedPackage.today_sessions < 2 && !markingPackageId
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        disabled={!canMarkToday}
                        onClick={() => markSession(selectedPackage)}
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

              <div className="space-y-5">
                <section className="rounded-xl border border-slate-100 bg-white">
                  <div className="border-b border-slate-100 p-4">
                    <h3 className="font-bold text-slate-900">Package list</h3>
                    <p className="mt-1 text-sm text-slate-500">Repeat packages and completed packages stay visible for history.</p>
                  </div>
                  <div className="max-h-72 space-y-3 overflow-y-auto p-4">
                    {selectedPackage.package_history.map((historyItem, index) => (
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
                          <span className={cn('rounded-full border px-2 py-0.5 text-xs font-bold capitalize', getStatusClass(historyItem.status))}>
                            {historyItem.status}
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
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-slate-100 bg-white">
                  <div className="border-b border-slate-100 p-4">
                    <h3 className="font-bold text-slate-900">Single-time therapy sessions</h3>
                    <p className="mt-1 text-sm text-slate-500">One-session therapies are kept separate for quick review.</p>
                  </div>
                  <div className="max-h-56 space-y-2 overflow-y-auto p-4">
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
                            <span className={cn('rounded-full border px-2 py-0.5 text-xs font-bold capitalize', getStatusClass(historyItem.status))}>
                              {historyItem.status}
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
