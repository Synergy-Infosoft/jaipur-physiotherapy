"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageCircleWarning,
  RefreshCcw,
  Search,
  ShieldAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { formatDateTime } from '@/lib/utils'
import * as dataService from '@/lib/dataService'
import type { WhatsAppNotificationLog, WhatsAppNotificationStatus, WhatsAppNotificationType } from '@/types'

const dayMs = 24 * 60 * 60 * 1000

const statusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
]

const typeOptions = [
  { value: '', label: 'All notification types' },
  { value: 'registration_confirmation', label: 'Registration confirmation' },
  { value: 'payment_receipt', label: 'Payment receipt / package created' },
  { value: 'portal_link', label: 'Portal link' },
  { value: 'session_reminder', label: 'Session update' },
  { value: 'follow_up', label: 'Follow-up' },
]

function defaultDateFrom() {
  return new Date(Date.now() - 7 * dayMs).toISOString().slice(0, 10)
}

function defaultDateTo() {
  return new Date().toISOString().slice(0, 10)
}

function statusClass(status: WhatsAppNotificationStatus) {
  if (status === 'sent') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'failed') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function typeLabel(type: WhatsAppNotificationType) {
  if (type === 'registration_confirmation') return 'Registration'
  if (type === 'payment_receipt') return 'Payment / package'
  if (type === 'portal_link') return 'Portal link'
  if (type === 'session_reminder') return 'Session'
  return 'Follow-up'
}

function getTemplateName(log: WhatsAppNotificationLog) {
  const value = log.payload?.whatsapp_template_name
  return typeof value === 'string' && value.trim() ? value : '-'
}

function getEventLabel(log: WhatsAppNotificationLog) {
  const eventType = log.payload?.event_type
  if (typeof eventType === 'string' && eventType.trim()) return eventType.replaceAll('_', ' ')
  return typeLabel(log.notification_type)
}

function getPayloadSummary(log: WhatsAppNotificationLog) {
  const payload = log.payload ?? {}
  const values = [
    typeof payload.package_name === 'string' ? payload.package_name : null,
    typeof payload.amount === 'number' ? `Amount ${payload.amount}` : null,
    typeof payload.payment_method === 'string' ? `Method ${payload.payment_method}` : null,
    typeof payload.balance === 'number' ? `Balance ${payload.balance}` : null,
    typeof payload.total_sessions === 'number' ? `${payload.total_sessions} sessions` : null,
  ].filter(Boolean)

  return values.length > 0 ? values.join(' | ') : '-'
}

function MetricCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string
  value: number
  tone: string
  icon: LucideIcon
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  )
}

export default function WhatsAppLogsPage() {
  const toast = useToast()
  const { profile, loading: authLoading } = useAuth()
  const [logs, setLogs] = useState<WhatsAppNotificationLog[]>([])
  const [summary, setSummary] = useState({ total: 0, queued: 0, sent: 0, failed: 0 })
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(defaultDateTo)
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')

  const canAccess = profile?.role === 'admin'

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true)
      const result = await dataService.getWhatsAppLogs({
        date_from: dateFrom,
        date_to: dateTo,
        status,
        type,
        q: search,
        limit: 250,
      })
      setLogs(result.logs)
      setSummary(result.summary)
    } catch (error) {
      console.error('Failed to load WhatsApp logs:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to load WhatsApp logs')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, search, status, toast, type])

  useEffect(() => {
    if (!authLoading && canAccess) loadLogs()
    if (!authLoading && !canAccess) setLoading(false)
  }, [authLoading, canAccess, loadLogs])

  const failureRate = useMemo(() => {
    if (summary.total === 0) return '0.0%'
    return `${((summary.failed / summary.total) * 100).toFixed(1)}%`
  }, [summary.failed, summary.total])

  if (!authLoading && !canAccess) {
    return (
      <DashboardLayout>
        <div className="p-4 md:p-6">
          <div className="card mx-auto mt-10 max-w-xl p-8 text-center">
            <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-amber-500" />
            <h1 className="mb-2 text-xl font-bold text-slate-900">Admin access required</h1>
            <p className="text-sm text-slate-500">WhatsApp delivery logs are visible only to administrators.</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <PageHeader
          title="WhatsApp Logs"
          description="Read-only delivery and failure logs for patient-facing WhatsApp notifications."
          actions={
            <Button type="button" onClick={loadLogs} disabled={loading || authLoading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Refresh
            </Button>
          }
        />

        <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <MetricCard label="Total logs" value={summary.total} tone="bg-slate-50 text-slate-700" icon={MessageCircleWarning} />
          <MetricCard label="Sent" value={summary.sent} tone="bg-emerald-50 text-emerald-700" icon={CheckCircle2} />
          <MetricCard label="Queued" value={summary.queued} tone="bg-amber-50 text-amber-700" icon={Clock3} />
          <MetricCard label={`Failed (${failureRate})`} value={summary.failed} tone="bg-rose-50 text-rose-700" icon={AlertTriangle} />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1.4fr_auto] lg:items-end">
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
              label="Status"
              value={status}
              options={statusOptions}
              onChange={(event) => setStatus(event.target.value)}
            />
            <Select
              label="Type"
              value={type}
              options={typeOptions}
              onChange={(event) => setType(event.target.value)}
            />
            <div className="relative">
              <Input
                label="Search"
                value={search}
                placeholder="Patient, phone, template, error..."
                onChange={(event) => setSearch(event.target.value)}
              />
              <Search className="pointer-events-none absolute bottom-3 right-3 h-4 w-4 text-slate-400" />
            </div>
            <Button type="button" variant="outline" onClick={loadLogs} disabled={loading}>
              Apply
            </Button>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-lg font-bold text-slate-900">Notification attempts</h2>
            <p className="mt-1 text-sm text-slate-500">Latest {logs.length} log rows for the selected filters.</p>
          </div>

          {loading || authLoading ? (
            <div className="flex items-center justify-center gap-3 p-10 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading WhatsApp logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="p-10 text-center">
              <MessageCircleWarning className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <p className="text-sm font-semibold text-slate-800">No WhatsApp logs found</p>
              <p className="mt-1 text-sm text-slate-500">Try widening the date range or clearing filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px]">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Patient</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Template</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Meta ID / Error</th>
                    <th className="px-4 py-3">Payload</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((log) => (
                    <tr key={log.id} className="align-top hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-500">
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-bold text-slate-900">{log.patient?.full_name ?? 'Unknown patient'}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{log.patient?.phone ?? '-'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-slate-800">{typeLabel(log.notification_type)}</p>
                        <p className="mt-0.5 text-xs capitalize text-slate-500">{getEventLabel(log)}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{getTemplateName(log)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-bold capitalize ${statusClass(log.status)}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        {log.error_message ? (
                          <p className="break-words text-xs font-semibold text-rose-700">{log.error_message}</p>
                        ) : (
                          <p className="break-words text-xs text-slate-500">{log.meta_message_id ?? '-'}</p>
                        )}
                      </td>
                      <td className="max-w-sm px-4 py-3">
                        <p className="break-words text-xs text-slate-600">{getPayloadSummary(log)}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  )
}
