"use client";

import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import {
  Users,
  Clock,
  CheckCircle,
  DollarSign,
  Plus,
  ChevronRight,
  Stethoscope,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/Button'
import { AddVisitDialog } from '@/components/visits/AddVisitDialog'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { formatCurrency, formatDateTime, formatTime } from '@/lib/utils'
import * as dataService from '@/lib/dataService'
import type { Visit, DashboardStats, Doctor, PaymentMethodOverrideVisit, CashReconciliationRecord } from '@/types'
import { StatsCardSkeleton } from '@/components/shared/LoadingSkeleton'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { calculateVariance, getVarianceTone } from '@/lib/cashReconciliation'

function RecentPaymentMethodOverrides() {
  const [overrides, setOverrides] = useState<PaymentMethodOverrideVisit[]>([])
  const [loading, setLoading] = useState(true)

  const loadOverrides = useCallback(async () => {
    try {
      const data = await dataService.getRecentPaymentMethodOverrides(5)
      setOverrides(data)
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadOverrides()
  }, [loadOverrides])

  if (loading) return null
  if (overrides.length === 0) return null

  return (
    <div className="card overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600" />
          <h2 className="text-base font-semibold text-slate-900">Recent Payment Method Overrides</h2>
        </div>
        <button onClick={loadOverrides} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>
      <div className="divide-y divide-slate-50">
        {overrides.map((visit) => (
          <div key={visit.id} className="px-5 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">{visit.patient?.full_name || 'Unknown'}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Token #{visit.token_number} · {formatDateTime(visit.updated_at || visit.created_at)}
              </p>
              {visit.payment_method_override_reason && (
                <p className="text-xs text-amber-700 mt-0.5">
                  Reason: {visit.payment_method_override_reason}
                </p>
              )}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
              visit.payment_method === 'cash'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-blue-50 text-blue-700 border-blue-200'
            }`}>
              {visit.payment_method === 'cash' ? 'Cash' : 'Online'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const toast = useToast()
  const { profile } = useAuth()
  const canManageBilling = profile?.role === 'admin' || profile?.role === 'receptionist'
  const canManageQueue = profile?.role === 'admin' || profile?.role === 'receptionist' || profile?.role === 'doctor'
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddVisit, setShowAddVisit] = useState(false)
  const [cancelVisitId, setCancelVisitId] = useState<string | null>(null)
  const [generatingInvoiceVisitId, setGeneratingInvoiceVisitId] = useState<string | null>(null)
  const [showReconciliationModal, setShowReconciliationModal] = useState(false)
  const [reconciliationSummary, setReconciliationSummary] = useState<{
    shift_date: string
    system_cash_total: number
    history: CashReconciliationRecord[]
  } | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [reconciliationError, setReconciliationError] = useState<string | null>(null)
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<{ counted_cash: string; notes: string }>({
    defaultValues: { counted_cash: '', notes: '' },
  })

  const countedCashValue = Number(watch('counted_cash') || 0)
  const variance = calculateVariance(countedCashValue, reconciliationSummary?.system_cash_total ?? 0)

  const loadData = useCallback(async () => {
    try {
      const today = format(new Date(), 'yyyy-MM-dd')
      const [visitsData, statsData, doctorsData] = await Promise.all([
        dataService.getVisits(today),
        dataService.getDashboardStats(),
        dataService.getDoctors(),
      ])
      setVisits(visitsData)
      setStats(statsData)
      setDoctors(doctorsData)
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (profile?.role === 'therapist') {
      router.replace('/therapist')
      setLoading(false)
      return
    }

    loadData()
    const interval = setInterval(loadData, 30000)
    const handleChange = () => { loadData() }
    const unsub = dataService.subscribeToVisits(handleChange)
    return () => {
      clearInterval(interval)
      unsub()
    }
  }, [loadData, profile?.role, router])

  const handleStatusChange = async (visitId: string, status: Visit['status']) => {
    try {
      await dataService.updateVisit(visitId, { status })
      await loadData()
      const labels: Record<string, string> = {
        completed: 'Marked as Completed',
        cancelled: 'Visit Cancelled',
      }
      toast.success(labels[status] || 'Status updated')
    } catch {
      toast.error('Failed to update status')
    }
  }

  const handleCancelConfirm = async () => {
    if (cancelVisitId) {
      await handleStatusChange(cancelVisitId, 'cancelled')
      setCancelVisitId(null)
    }
  }

  const handleInvoiceAction = async (visit: Visit) => {
    setGeneratingInvoiceVisitId(visit.id)
    try {
      const invoice = await dataService.generateInvoiceForVisit(visit.id)
      toast.success('Invoice ready')
      router.push(`/invoices/${invoice.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to generate invoice')
    } finally {
      setGeneratingInvoiceVisitId(null)
    }
  }

  const loadReconciliationSummary = useCallback(async () => {
    try {
      const summary = await dataService.getCashReconciliationSummary()
      setReconciliationSummary(summary)
    } catch {
      setReconciliationSummary(null)
    }
  }, [])

  useEffect(() => {
    loadReconciliationSummary()
  }, [loadReconciliationSummary])

  const onCloseShift = async (values: { counted_cash: string; notes: string }) => {
    setReconciling(true)
    setReconciliationError(null)
    try {
      await dataService.closeCashShift({
        counted_cash: Number(values.counted_cash),
        notes: values.notes.trim() || null,
      })
      await loadReconciliationSummary()
      reset({ counted_cash: '', notes: '' })
      setShowReconciliationModal(false)
      toast.success('Cash shift closed')
    } catch (error) {
      setReconciliationError(error instanceof Error ? error.message : 'Unable to close shift')
    } finally {
      setReconciling(false)
    }
  }

  const statCards = stats
    ? [
        {
          label: 'Patients Today',
          value: stats.patients_today,
          icon: Users,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          desc: 'Total registrations',
        },
        {
          label: 'Pending',
          value: stats.pending,
          icon: Clock,
          color: 'text-amber-600',
          bg: 'bg-amber-50',
          desc: 'Awaiting consultation',
        },
        {
          label: 'Completed',
          value: stats.completed,
          icon: CheckCircle,
          color: 'text-emerald-600',
          bg: 'bg-emerald-50',
          desc: 'Visits done today',
        },
        {
          label: 'Revenue Today',
          value: formatCurrency(stats.revenue_today),
          icon: DollarSign,
          color: 'text-purple-600',
          bg: 'bg-purple-50',
          desc: `${stats.pending_invoices} pending`,
        },
      ]
    : []

  if (profile?.role === 'therapist') {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center p-10 text-sm text-slate-500">
          Opening therapist sessions...
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6">
        <PageHeader
          title="Dashboard"
          description={`Today — ${format(new Date(), 'EEEE, d MMMM yyyy')}`}
          actions={(canManageBilling || canManageQueue) ? (
            <div className="flex items-center gap-2">
              {canManageBilling && (
                <Button variant="outline" onClick={() => setShowReconciliationModal(true)} size="sm">
                  Close Shift
                </Button>
              )}
              {canManageQueue && (
                <Button onClick={() => setShowAddVisit(true)} size="sm">
                  <Plus className="w-4 h-4" />
                  Add Patient
                </Button>
              )}
            </div>
          ) : undefined}
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <StatsCardSkeleton key={i} />)
            : statCards.map(({ label, value, icon: Icon, color, bg, desc }) => (
                <div key={label} className="card p-5 hover-card">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-sm font-medium text-slate-600">{label}</p>
                    <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${color}`} />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-slate-900">{value}</p>
                  <p className="text-xs text-slate-500 mt-1">{desc}</p>
                </div>
              ))}
        </div>

        {/* Today's Queue */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Today{"'"}s Queue</h2>
            <button
              onClick={() => router.push('/visits')}
              className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1"
            >
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : visits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Stethoscope className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-base font-semibold text-slate-700 mb-1">No patients yet today</h3>
              <p className="text-sm text-slate-500 max-w-xs">
                QR code registrations will appear here in real-time. You can also add patients manually.
              </p>
              {canManageQueue && (
                <Button onClick={() => setShowAddVisit(true)} size="sm" className="mt-4">
                  <Plus className="w-4 h-4" />
                  Add First Patient
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3 w-16">#</th>
                    <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3">Patient</th>
                    <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3 hidden md:table-cell">
                      Complaint
                    </th>
                    <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3">Status</th>
                    <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3 hidden lg:table-cell">
                      Time
                    </th>
                    <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {visits.map((visit) => (
                    <tr key={visit.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="w-8 h-8 bg-[var(--primary-light)] rounded-lg flex items-center justify-center">
                          <span className="text-xs font-bold text-[var(--primary)]">{visit.token_number}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-slate-900">
                          {visit.patient?.full_name || 'Unknown'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {visit.patient?.age}y · {visit.patient?.gender}
                          {visit.doctor && ` · ${visit.doctor.name}`}
                        </p>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <p className="text-xs text-slate-600 line-clamp-2 max-w-[200px]">
                          {visit.chief_complaint}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={visit.status} />
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-xs text-slate-500">{visit.consultation_time?.slice(0, 5) || formatTime(visit.created_at)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {visit.status === 'pending' && (
                            <button
                              onClick={() => handleStatusChange(visit.id, 'completed')}
                              className="text-xs px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors font-medium whitespace-nowrap"
                            >
                              Complete
                            </button>
                          )}
                          {canManageBilling && visit.status !== 'cancelled' && (
                            <button
                              onClick={() => handleInvoiceAction(visit)}
                              disabled={generatingInvoiceVisitId === visit.id}
                              className="text-xs px-2.5 py-1 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 disabled:opacity-60 transition-colors font-medium whitespace-nowrap"
                            >
                              {generatingInvoiceVisitId === visit.id ? 'Preparing...' : 'Generate invoice'}
                            </button>
                          )}
                          {visit.status !== 'cancelled' && visit.status !== 'completed' && (
                            <button
                              onClick={() => setCancelVisitId(visit.id)}
                              className="text-xs px-2.5 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {canManageBilling && (
        <div className="card overflow-hidden mt-6">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Cash Reconciliation</h2>
              <p className="text-sm text-slate-500 mt-1">
                Today&apos;s expected cash: {formatCurrency(reconciliationSummary?.system_cash_total ?? 0)}
              </p>
            </div>
            <Button variant="outline" onClick={() => setShowReconciliationModal(true)} size="sm">
              Close shift
            </Button>
          </div>
          <div className="p-5">
            <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-900">Variance preview</p>
                <p className="mt-2 text-sm text-slate-600">
                  Enter the counted cash to see the difference versus the system total.
                </p>
                <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">Expected</span>
                    <span className="text-sm font-semibold text-slate-900">{formatCurrency(reconciliationSummary?.system_cash_total ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm text-slate-600">Counted</span>
                    <span className="text-sm font-semibold text-slate-900">{formatCurrency(countedCashValue)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-3 border-t border-slate-200 pt-3">
                    <span className="text-sm text-slate-600">Variance</span>
                    <span className={`text-sm font-semibold ${getVarianceTone(variance) === 'balanced' ? 'text-slate-900' : variance > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-900">Recent reconciliations</p>
                {reconciliationSummary?.history.length ? (
                  <div className="mt-3 space-y-3">
                    {[...reconciliationSummary.history]
                      .sort((a, b) => b.variance - a.variance)
                      .slice(0, 5)
                      .map((record) => (
                        <div key={record.id} className="rounded-lg border border-slate-100 p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-slate-900">{record.profiles?.full_name || 'Staff'}</p>
                            <span className={`text-xs font-semibold ${record.variance === 0 ? 'text-slate-700' : record.variance > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {record.variance >= 0 ? '+' : ''}{formatCurrency(record.variance)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{formatDateTime(record.created_at)}</p>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">No cash reconciliation has been closed today yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Recent Overrides — admin only */}
        {profile?.role === 'admin' && <RecentPaymentMethodOverrides />}
      </div>

      {/* Modals */}
      {canManageQueue && (
      <AddVisitDialog
        isOpen={showAddVisit}
        onClose={() => setShowAddVisit(false)}
        onSuccess={(_, tokenNumber) => {
          toast.success(`New patient registered — Token #${tokenNumber}`)
          loadData()
        }}
        doctors={doctors}
      />
      )}

      <ConfirmDialog
        isOpen={!!cancelVisitId}
        onClose={() => setCancelVisitId(null)}
        onConfirm={handleCancelConfirm}
        title="Cancel Visit"
        description="Are you sure you want to cancel this visit? This action cannot be undone."
        confirmLabel="Yes, Cancel Visit"
      />

      {canManageBilling && (
      <Modal
        isOpen={showReconciliationModal}
        onClose={() => {
          setShowReconciliationModal(false)
          reset({ counted_cash: '', notes: '' })
          setReconciliationError(null)
        }}
        title="Close cash shift"
        size="md"
      >
        <form onSubmit={handleSubmit(onCloseShift)} className="p-6 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Expected cash</p>
            <p className="mt-1 text-sm text-slate-600">
              Today&apos;s system total: {formatCurrency(reconciliationSummary?.system_cash_total ?? 0)}
            </p>
          </div>

          <Input
            label="Counted cash"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            placeholder="0.00"
            error={errors.counted_cash?.message}
            {...register('counted_cash', {
              required: 'Counted cash is required',
              validate: (value) => Number(value) >= 0 || 'Counted cash cannot be negative',
            })}
          />

          <Textarea
            label="Notes"
            rows={4}
            placeholder="Add any note about the shift or a mismatch"
            helperText="Optional"
            error={errors.notes?.message}
            {...register('notes')}
          />

          {reconciliationError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {reconciliationError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => {
              setShowReconciliationModal(false)
              reset({ counted_cash: '', notes: '' })
              setReconciliationError(null)
            }}>
              Cancel
            </Button>
            <Button type="submit" loading={reconciling}>
              Save reconciliation
            </Button>
          </div>
        </form>
      </Modal>
      )}
    </DashboardLayout>
  )
}
