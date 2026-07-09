"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  IndianRupee,
  Loader2,
  MessageCircleWarning,
  PackageCheck,
  Repeat2,
  ShieldAlert,
  Stethoscope,
  UserCog,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import * as dataService from '@/lib/dataService'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import type { AdminMasterReport, FollowUpOutcome } from '@/types'

const dayMs = 24 * 60 * 60 * 1000

function defaultDateFrom() {
  return new Date(Date.now() - 30 * dayMs).toISOString().slice(0, 10)
}

function defaultDateTo() {
  return new Date().toISOString().slice(0, 10)
}

function percent(value: number) {
  return `${value.toFixed(1)}%`
}

function outcomeLabel(outcome: FollowUpOutcome | 'not_logged') {
  if (outcome === 'rescheduled') return 'Rescheduled'
  if (outcome === 'discontinued_reason') return 'Discontinued reason'
  if (outcome === 'no_answer') return 'No answer'
  return 'Not logged'
}

function statusClass(status: 'overrun' | 'underrun' | 'on_track') {
  if (status === 'overrun') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status === 'underrun') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

function MetricCard({
  label,
  value,
  helper,
  tone = 'slate',
  icon: Icon,
}: {
  label: string
  value: string | number
  helper?: string
  tone?: 'slate' | 'emerald' | 'blue' | 'amber' | 'rose'
  icon: LucideIcon
}) {
  const toneClasses = {
    slate: 'bg-slate-50 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
          {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClasses[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const toast = useToast()
  const { profile, loading: authLoading } = useAuth()
  const [report, setReport] = useState<AdminMasterReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(defaultDateTo)
  const [staffId, setStaffId] = useState('')

  const canAccess = profile?.role === 'admin'

  const loadReport = useCallback(async () => {
    try {
      setLoading(true)
      const data = await dataService.getAdminMasterReport({
        date_from: dateFrom,
        date_to: dateTo,
        staff_id: staffId || null,
      })
      setReport(data)
    } catch (error) {
      console.error('Failed to load admin report:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to load admin report')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, staffId, toast])

  useEffect(() => {
    if (!authLoading && canAccess) loadReport()
    if (!authLoading && !canAccess) setLoading(false)
  }, [authLoading, canAccess, loadReport])

  const staffOptions = useMemo(() => [
    { value: '', label: 'All staff' },
    ...(report?.staff_members ?? []).map((staff) => ({
      value: staff.id,
      label: `${staff.full_name} (${staff.role.replaceAll('_', ' ')})`,
    })),
  ], [report?.staff_members])

  if (!authLoading && !canAccess) {
    return (
      <DashboardLayout>
        <div className="p-4 md:p-6">
          <div className="card mx-auto mt-10 max-w-xl p-8 text-center">
            <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-amber-500" />
            <h1 className="mb-2 text-xl font-bold text-slate-900">Admin access required</h1>
            <p className="text-sm text-slate-500">The master report is visible only to administrators.</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <PageHeader
          title="Admin Master Report"
          description="Collections, package balances, sessions, overrides, follow-up outcomes, and WhatsApp delivery health."
          actions={
            <Button type="button" onClick={loadReport} disabled={loading || authLoading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
              Refresh
            </Button>
          }
        />

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end">
            <Input
              label="Date from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
            <Input
              label="Date to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
            <Select
              label="Staff member"
              value={staffId}
              options={staffOptions}
              onChange={(event) => setStaffId(event.target.value)}
            />
            <Button type="button" variant="outline" onClick={loadReport} disabled={loading || authLoading}>
              Apply filters
            </Button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Date and staff filters apply to collections and packages sold. Operational health sections remain all-time or last-7-days as labelled.
          </p>
        </section>

        {loading || authLoading || !report ? (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-12 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading master report...
          </div>
        ) : (
          <>
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Collections</h2>
                  <p className="text-sm text-slate-500">
                    {formatDate(report.collections.date_from)} to {formatDate(report.collections.date_to)}
                  </p>
                </div>
                {report.collections.reconciliation_variance_total !== 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Variance {formatCurrency(report.collections.reconciliation_variance_total)}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <MetricCard label="Cash" value={formatCurrency(report.collections.cash_total)} helper={`${report.collections.cash_transaction_count} transactions`} tone="emerald" icon={IndianRupee} />
                <MetricCard label="Online" value={formatCurrency(report.collections.online_total)} helper={`${report.collections.online_transaction_count} transactions`} tone="blue" icon={IndianRupee} />
                <MetricCard label="Total collected" value={formatCurrency(report.collections.total_collected)} helper={`${report.collections.transaction_count} ledger rows`} icon={IndianRupee} />
                <MetricCard label="Cash variance" value={formatCurrency(report.collections.reconciliation_variance_total)} helper={`${report.collections.reconciliation_count} reconciliations`} tone={report.collections.reconciliation_variance_total === 0 ? 'emerald' : 'rose'} icon={AlertTriangle} />
              </div>

              {report.collections.reconciliation_variances.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-rose-100 bg-white">
                  <div className="border-b border-rose-100 bg-rose-50 px-4 py-3">
                    <p className="text-sm font-semibold text-rose-800">Variance details</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Shift date</th>
                          <th className="px-4 py-3">Closed by</th>
                          <th className="px-4 py-3">System cash</th>
                          <th className="px-4 py-3">Counted</th>
                          <th className="px-4 py-3">Variance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.collections.reconciliation_variances.map((record) => (
                          <tr key={record.id}>
                            <td className="px-4 py-3 font-medium text-slate-900">{formatDate(record.shift_date)}</td>
                            <td className="px-4 py-3 text-slate-600">{record.closed_by_name ?? 'Staff'}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCurrency(record.system_cash_total)}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCurrency(record.counted_cash)}</td>
                            <td className="px-4 py-3 font-semibold text-rose-700">{formatCurrency(record.variance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <PackageCheck className="h-5 w-5 text-[var(--primary)]" />
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Packages</h2>
                    <p className="text-sm text-slate-500">Sold in filtered period and outstanding past expected completion.</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard label="Sold" value={report.packages.sold_count} helper={formatCurrency(report.packages.sold_quoted_total)} tone="blue" icon={PackageCheck} />
                  <MetricCard label="Past expected balance" value={formatCurrency(report.packages.outstanding_past_expected_balance)} helper={`${report.packages.outstanding_past_expected_count} packages`} tone={report.packages.outstanding_past_expected_count ? 'amber' : 'emerald'} icon={AlertTriangle} />
                </div>

                <div className="mt-4 space-y-3">
                  {report.packages.outstanding_packages.length === 0 ? (
                    <p className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-700">No overdue outstanding package balances found.</p>
                  ) : report.packages.outstanding_packages.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-100 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{item.patient_name}</p>
                          <p className="text-sm text-slate-500">{item.package_name} - expected by {formatDate(item.expected_end_date)}</p>
                        </div>
                        <span className="text-sm font-bold text-amber-700">{formatCurrency(item.balance_due)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <Stethoscope className="h-5 w-5 text-[var(--primary)]" />
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Sessions</h2>
                    <p className="text-sm text-slate-500">Delivered vs expected for active packages.</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard label="Expected" value={report.sessions.expected_total} helper={`${report.sessions.active_package_count} active packages`} icon={Stethoscope} />
                  <MetricCard label="Delivered" value={report.sessions.delivered_total} helper={`${report.sessions.underrun_count} underrun, ${report.sessions.overrun_count} overrun`} tone={report.sessions.overrun_count ? 'rose' : report.sessions.underrun_count ? 'amber' : 'emerald'} icon={CheckCircle2} />
                </div>

                <div className="mt-4 space-y-3">
                  {report.sessions.rows.length === 0 ? (
                    <p className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-700">No active session overrun or underrun flags.</p>
                  ) : report.sessions.rows.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-100 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{item.patient_name}</p>
                          <p className="text-sm text-slate-500">{item.package_name}: {item.sessions_used} delivered / {item.expected_sessions} expected / {item.total_sessions} total</p>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusClass(item.status)}`}>
                          {item.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <UserCog className="h-5 w-5 text-[var(--primary)]" />
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Payment Method Overrides</h2>
                    <p className="text-sm text-slate-500">Counts by staff member, sorted by most recent override.</p>
                  </div>
                </div>
                {report.overrides.by_staff.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No payment method overrides recorded.</p>
                ) : (
                  <div className="space-y-3">
                    {report.overrides.by_staff.map((item) => (
                      <div key={item.staff_id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                        <div>
                          <p className="font-semibold text-slate-900">{item.staff_name}</p>
                          <p className="text-xs text-slate-500">Latest {formatDateTime(item.most_recent_at)}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-sm font-bold ${item.count >= 5 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>{item.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <Repeat2 className="h-5 w-5 text-[var(--primary)]" />
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Repeat Patient Rate</h2>
                    <p className="text-sm text-slate-500">Patients with more than one package row.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MetricCard label="Rate" value={percent(report.repeat_patient_rate.rate)} tone="blue" icon={Repeat2} />
                  <MetricCard label="Repeat patients" value={report.repeat_patient_rate.repeat_patient_count} icon={Users} />
                  <MetricCard label="All patients" value={report.repeat_patient_rate.patient_count} icon={Users} />
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-[var(--primary)]" />
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Follow-up Outcomes</h2>
                    <p className="text-sm text-slate-500">Resolved follow-up tasks by outcome.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {report.follow_up_outcomes.outcomes.map((item) => (
                    <div key={item.outcome} className="flex items-center justify-between rounded-xl border border-slate-100 p-3">
                      <span className="font-medium text-slate-700">{outcomeLabel(item.outcome)}</span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-700">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <MessageCircleWarning className="h-5 w-5 text-[var(--primary)]" />
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">WhatsApp Delivery Health</h2>
                    <p className="text-sm text-slate-500">Failure percentage in the last 7 days.</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard label="Failure rate" value={percent(report.whatsapp_health.failure_rate)} helper={`${report.whatsapp_health.failed_last_7_days} failed of ${report.whatsapp_health.total_last_7_days}`} tone={report.whatsapp_health.failure_rate > 10 ? 'rose' : 'emerald'} icon={MessageCircleWarning} />
                  <MetricCard label="Sent" value={report.whatsapp_health.sent} helper={`${report.whatsapp_health.queued} queued`} tone="blue" icon={CheckCircle2} />
                </div>
              </div>
            </section>

            <p className="text-right text-xs text-slate-400">Generated {formatDateTime(report.generated_at)}</p>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
