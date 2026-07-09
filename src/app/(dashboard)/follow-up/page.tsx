"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Loader2, Phone, ShieldAlert, UserRound } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { formatDateTime } from '@/lib/utils'
import * as dataService from '@/lib/dataService'
import type { FollowUpOutcome, FollowUpStatus, FollowUpTask } from '@/types'

const reasonLabels: Record<FollowUpTask['reason'], string> = {
  missed_expected_session: 'Missed expected session',
  discontinued_early: 'Discontinued early',
}

const outcomeOptions: { value: '' | FollowUpOutcome; label: string }[] = [
  { value: '', label: 'Select outcome' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'discontinued_reason', label: 'Discontinued reason logged' },
  { value: 'no_answer', label: 'No answer' },
]

const statusOptions: { value: FollowUpStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'resolved', label: 'Resolved' },
]

function getStatusClass(status: FollowUpStatus) {
  if (status === 'resolved') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'contacted') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

export default function FollowUpPage() {
  const toast = useToast()
  const { profile, loading: authLoading } = useAuth()
  const [tasks, setTasks] = useState<FollowUpTask[]>([])
  const [loading, setLoading] = useState(true)
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, { status: FollowUpStatus; outcome: '' | FollowUpOutcome; outcome_notes: string }>>({})

  const canAccess = profile?.role === 'follow_up_agent' || profile?.role === 'admin'

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true)
      const data = await dataService.getFollowUpTasks()
      setTasks(data)
      setForms((current) => {
        const next = { ...current }
        for (const task of data) {
          if (!next[task.id]) {
            next[task.id] = {
              status: task.status,
              outcome: task.outcome ?? '',
              outcome_notes: task.outcome_notes ?? '',
            }
          }
        }
        return next
      })
    } catch (error) {
      console.error('Failed to load follow-up tasks:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to load follow-up tasks')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (!authLoading && canAccess) loadTasks()
    if (!authLoading && !canAccess) setLoading(false)
  }, [authLoading, canAccess, loadTasks])

  const stats = useMemo(() => ({
    pending: tasks.filter((task) => task.status === 'pending').length,
    contacted: tasks.filter((task) => task.status === 'contacted').length,
    resolved: tasks.filter((task) => task.status === 'resolved').length,
  }), [tasks])

  const updateForm = (taskId: string, patch: Partial<{ status: FollowUpStatus; outcome: '' | FollowUpOutcome; outcome_notes: string }>) => {
    setForms((current) => ({
      ...current,
      [taskId]: {
        status: current[taskId]?.status ?? 'pending',
        outcome: current[taskId]?.outcome ?? '',
        outcome_notes: current[taskId]?.outcome_notes ?? '',
        ...patch,
      },
    }))
  }

  const saveTask = async (task: FollowUpTask) => {
    const form = forms[task.id]
    if (!form) return
    if (form.status === 'resolved' && !form.outcome) {
      toast.error('Select an outcome before resolving the task')
      return
    }

    setSavingTaskId(task.id)
    try {
      const updated = await dataService.updateFollowUpTask({
        id: task.id,
        status: form.status,
        outcome: form.outcome || null,
        outcome_notes: form.outcome_notes,
      })
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item))
      toast.success('Follow-up task updated')
    } catch (error) {
      console.error('Failed to update follow-up task:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to update task')
    } finally {
      setSavingTaskId(null)
    }
  }

  if (!authLoading && !canAccess) {
    return (
      <DashboardLayout>
        <div className="p-4 md:p-6">
          <div className="card mx-auto mt-10 max-w-xl p-8 text-center">
            <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-amber-500" />
            <h1 className="mb-2 text-xl font-bold text-slate-900">Follow-up access required</h1>
            <p className="text-sm text-slate-500">Only follow-up agents and admins can manage missed-session tasks.</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <PageHeader
          title="Follow-up Tasks"
          description="Call patients whose active packages are behind expected session cadence."
          actions={
            <Button type="button" variant="outline" onClick={loadTasks} disabled={loading || authLoading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              Refresh
            </Button>
          }
        />

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending</p>
            <p className="mt-2 text-2xl font-bold text-amber-700">{stats.pending}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contacted</p>
            <p className="mt-2 text-2xl font-bold text-blue-700">{stats.contacted}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resolved</p>
            <p className="mt-2 text-2xl font-bold text-emerald-700">{stats.resolved}</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-lg font-bold text-slate-900">Task queue</h2>
            <p className="mt-1 text-sm text-slate-500">Finished or cancelled packages are not flagged here.</p>
          </div>

          {loading || authLoading ? (
            <div className="flex items-center justify-center gap-3 p-10 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading tasks...
            </div>
          ) : tasks.length === 0 ? (
            <div className="p-10 text-center">
              <ClipboardCheck className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <p className="text-sm font-semibold text-slate-800">No follow-up tasks</p>
              <p className="mt-1 text-sm text-slate-500">Missed expected sessions will appear here after the daily detection job runs.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {tasks.map((task) => {
                const form = forms[task.id] ?? {
                  status: task.status,
                  outcome: task.outcome ?? '',
                  outcome_notes: task.outcome_notes ?? '',
                }

                return (
                  <article key={task.id} className="p-5">
                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                            <UserRound className="h-5 w-5" />
                          </span>
                          <div>
                            <h3 className="font-bold text-slate-900">{task.patient?.full_name ?? 'Unknown patient'}</h3>
                            <p className="text-sm text-slate-500">{task.patient_package?.package_name ?? 'Treatment package'}</p>
                          </div>
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${getStatusClass(task.status)}`}>
                            {task.status}
                          </span>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                          <div className="rounded-xl bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</p>
                            <p className="mt-1 flex items-center gap-1 font-semibold text-slate-900">
                              <Phone className="h-3.5 w-3.5 text-cyan-700" />
                              {task.patient?.phone ?? 'Not provided'}
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</p>
                            <p className="mt-1 font-semibold text-slate-900">{reasonLabels[task.reason]}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Created</p>
                            <p className="mt-1 font-semibold text-slate-900">{formatDateTime(task.created_at)}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sessions</p>
                            <p className="mt-1 font-semibold text-slate-900">
                              {task.patient_package?.sessions_used ?? 0} used / {task.patient_package?.total_sessions ?? 0} total
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Status</span>
                            <select
                              value={form.status}
                              onChange={(event) => updateForm(task.id, { status: event.target.value as FollowUpStatus })}
                              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                            >
                              {statusOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <span className="text-sm font-semibold text-slate-700">Outcome</span>
                            <select
                              value={form.outcome}
                              onChange={(event) => updateForm(task.id, { outcome: event.target.value as '' | FollowUpOutcome })}
                              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
                            >
                              {outcomeOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="mt-3">
                          <Textarea
                            label="Outcome notes"
                            rows={3}
                            value={form.outcome_notes}
                            onChange={(event) => updateForm(task.id, { outcome_notes: event.target.value })}
                            placeholder="Call notes, reschedule date, reason for stopping..."
                          />
                        </div>

                        <Button
                          type="button"
                          className="mt-3 w-full justify-center"
                          onClick={() => saveTask(task)}
                          loading={savingTaskId === task.id}
                        >
                          Save outcome
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