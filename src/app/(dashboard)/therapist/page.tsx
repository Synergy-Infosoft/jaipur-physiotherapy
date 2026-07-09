"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, CalendarCheck, Loader2, Phone, ShieldAlert, UserRound } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { formatDateTime } from '@/lib/utils'
import * as dataService from '@/lib/dataService'
import type { TherapistActivePackage } from '@/types'

export default function TherapistPage() {
  const toast = useToast()
  const { profile, loading: authLoading } = useAuth()
  const [packages, setPackages] = useState<TherapistActivePackage[]>([])
  const [loading, setLoading] = useState(true)
  const [markingPackageId, setMarkingPackageId] = useState<string | null>(null)

  const canAccess = profile?.role === 'therapist' || profile?.role === 'admin'

  const loadPackages = useCallback(async () => {
    try {
      setLoading(true)
      const activePackages = await dataService.getTherapistActivePackages()
      setPackages(activePackages)
    } catch (error) {
      console.error('Failed to load therapist packages:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to load therapy packages')
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
  }), [packages])

  const markSession = async (patientPackage: TherapistActivePackage) => {
    setMarkingPackageId(patientPackage.patient_package_id)
    try {
      const result = await dataService.markSessionComplete(patientPackage.patient_package_id)
      setPackages((current) => current.map((item) => (
        item.patient_package_id === patientPackage.patient_package_id
          ? {
            ...item,
            sessions_used: result.sessions_used,
            sessions_remaining: result.sessions_remaining,
            last_session_at: new Date().toISOString(),
          }
          : item
      )))
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
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <PageHeader
          title="Therapist Sessions"
          description="Mark delivered sessions in real time. Counts are computed from the session ledger."
          actions={
            <Button type="button" variant="outline" onClick={loadPackages} disabled={loading || authLoading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
              Refresh
            </Button>
          }
        />

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active packages</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{stats.active}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total sessions remaining</p>
            <p className="mt-2 text-2xl font-bold text-emerald-700">{stats.remaining}</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-lg font-bold text-slate-900">Active therapy packages</h2>
            <p className="mt-1 text-sm text-slate-500">Use one row per delivered session. There are no edit buttons here.</p>
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
              <p className="mt-1 text-sm text-slate-500">Packages created by reception will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {packages.map((patientPackage) => {
                const isExhausted = patientPackage.sessions_remaining <= 0
                return (
                  <article key={patientPackage.patient_package_id} className="p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                            <UserRound className="h-5 w-5" />
                          </span>
                          <div>
                            <h3 className="font-bold text-slate-900">{patientPackage.patient_name}</h3>
                            <p className="text-sm text-slate-500">{patientPackage.package_name}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                          {patientPackage.patient_phone && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                              <Phone className="h-3.5 w-3.5" />
                              {patientPackage.patient_phone}
                            </span>
                          )}
                          {patientPackage.last_session_at && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
                              Last: {formatDateTime(patientPackage.last_session_at)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-xl bg-slate-50 p-3">
                            <p className="text-xs font-semibold text-slate-500">Total</p>
                            <p className="font-bold text-slate-900">{patientPackage.total_sessions}</p>
                          </div>
                          <div className="rounded-xl bg-blue-50 p-3">
                            <p className="text-xs font-semibold text-blue-700">Used</p>
                            <p className="font-bold text-blue-800">{patientPackage.sessions_used}</p>
                          </div>
                          <div className="rounded-xl bg-emerald-50 p-3">
                            <p className="text-xs font-semibold text-emerald-700">Left</p>
                            <p className="font-bold text-emerald-800">{patientPackage.sessions_remaining}</p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          onClick={() => markSession(patientPackage)}
                          loading={markingPackageId === patientPackage.patient_package_id}
                          disabled={isExhausted || Boolean(markingPackageId)}
                        >
                          <CalendarCheck className="h-4 w-4" />
                          {isExhausted ? 'No sessions left' : 'Mark session complete'}
                        </Button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  )
}