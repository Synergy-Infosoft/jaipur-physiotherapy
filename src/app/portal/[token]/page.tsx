"use client"

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { CalendarCheck, CreditCard, HeartPulse, IndianRupee, Lock, Package } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import * as dataService from '@/lib/dataService'
import type { PatientPortalOverview } from '@/types'

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

function formatCurrency(value: number | null | undefined) {
  return currencyFormatter.format(Number(value ?? 0))
}

export default function PatientPortalPage() {
  const params = useParams()
  const token = String(params?.token ?? '')
  const [overview, setOverview] = useState<PatientPortalOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadPortal = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await dataService.getPatientPortalOverview(token)
        setOverview(data)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load patient portal')
      } finally {
        setLoading(false)
      }
    }

    if (token) loadPortal()
  }, [token])

  const totals = useMemo(() => {
    const packages = overview?.packages ?? []
    return {
      sessionsRemaining: packages.reduce((sum, patientPackage) => sum + patientPackage.sessions_remaining, 0),
      balance: packages.reduce((sum, patientPackage) => sum + patientPackage.balance, 0),
    }
  }, [overview?.packages])

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Jaipur Physiotherapy</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">
                {overview?.patient_name ?? 'Patient portal'}
              </h1>
              <p className="mt-2 text-sm text-slate-500">Read-only package, session, and payment summary.</p>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
              <Lock className="h-3.5 w-3.5" />
              Secure portal link
            </span>
          </div>
        </header>

        {loading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
            <p className="mt-3 text-sm text-slate-500">Loading your portal...</p>
          </section>
        ) : error ? (
          <section className="rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm">
            <HeartPulse className="mx-auto mb-3 h-10 w-10 text-rose-500" />
            <h2 className="text-lg font-bold text-slate-900">Portal unavailable</h2>
            <p className="mt-2 text-sm text-slate-500">{error}</p>
          </section>
        ) : overview ? (
          <>
            <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active packages</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{overview.packages.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sessions remaining</p>
                <p className="mt-2 text-2xl font-bold text-emerald-700">{totals.sessionsRemaining}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total balance</p>
                <p className="mt-2 text-2xl font-bold text-amber-700">{formatCurrency(totals.balance)}</p>
              </div>
            </section>

            {overview.packages.length === 0 ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
                <Package className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                <p className="text-sm font-semibold text-slate-800">No active package found</p>
                <p className="mt-1 text-sm text-slate-500">Your clinic will update this portal after a package is created.</p>
              </section>
            ) : (
              <section className="space-y-4">
                {overview.packages.map((patientPackage) => (
                  <article key={patientPackage.package_id} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-100 p-5">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                            <Package className="h-5 w-5 text-emerald-700" />
                            {patientPackage.package_name}
                          </h2>
                          <p className="mt-1 text-sm text-slate-500">{patientPackage.total_sessions} total sessions</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                          <div className="rounded-xl bg-slate-50 p-3 text-center">
                            <p className="text-xs font-semibold text-slate-500">Used</p>
                            <p className="font-bold text-slate-900">{patientPackage.sessions_used}</p>
                          </div>
                          <div className="rounded-xl bg-emerald-50 p-3 text-center">
                            <p className="text-xs font-semibold text-emerald-700">Remaining</p>
                            <p className="font-bold text-emerald-800">{patientPackage.sessions_remaining}</p>
                          </div>
                          <div className="rounded-xl bg-blue-50 p-3 text-center">
                            <p className="text-xs font-semibold text-blue-700">Paid</p>
                            <p className="font-bold text-blue-800">{formatCurrency(patientPackage.paid_total)}</p>
                          </div>
                          <div className="rounded-xl bg-amber-50 p-3 text-center">
                            <p className="text-xs font-semibold text-amber-700">Balance</p>
                            <p className="font-bold text-amber-800">{formatCurrency(patientPackage.balance)}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="p-5">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
                        <CreditCard className="h-4 w-4 text-slate-500" />
                        Payment history
                      </h3>
                      {patientPackage.payment_history.length === 0 ? (
                        <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No payments recorded for this package yet.</p>
                      ) : (
                        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
                          {patientPackage.payment_history.map((payment) => (
                            <div key={payment.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                  <IndianRupee className="h-4 w-4 text-emerald-700" />
                                  {payment.payment_method === 'cash' ? 'Cash' : 'Online'} payment
                                </p>
                                <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                                  <CalendarCheck className="h-3.5 w-3.5" />
                                  {formatDateTime(payment.created_at)}
                                </p>
                                {payment.correction_reason && (
                                  <p className="mt-1 text-xs font-semibold text-rose-700">{payment.correction_reason}</p>
                                )}
                              </div>
                              <p className={`text-base font-bold ${payment.amount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                                {formatCurrency(payment.amount)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        ) : null}
      </div>
    </main>
  )
}