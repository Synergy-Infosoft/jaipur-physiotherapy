"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ClipboardCheck, Loader2, MessageCircle, Phone, ShieldAlert } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { formatDateTime } from '@/lib/utils'
import * as dataService from '@/lib/dataService'
import type { FollowUpOutcome, FollowUpReminderTemplate, FollowUpStatus, FollowUpTask } from '@/types'

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

function getInitial(name: string | null | undefined) {
  return name?.trim().charAt(0).toUpperCase() || 'P'
}

function getStatusSortRank(status: FollowUpStatus) {
  if (status === 'pending') return 0
  if (status === 'contacted') return 1
  return 2
}

type TaskFormState = {
  status: FollowUpStatus
  outcome: '' | FollowUpOutcome
  outcome_notes: string
}

export default function FollowUpPage() {
  const toast = useToast()
  const { profile, loading: authLoading } = useAuth()
  const [tasks, setTasks] = useState<FollowUpTask[]>([])
  const [reminderTemplates, setReminderTemplates] = useState<FollowUpReminderTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [sendingReminderTaskId, setSendingReminderTaskId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedReminderTemplateId, setSelectedReminderTemplateId] = useState('')
  const [taskFilter, setTaskFilter] = useState<'pending' | 'all'>('pending')
  const [forms, setForms] = useState<Record<string, TaskFormState>>({})

  const canAccess = profile?.role === 'follow_up_agent' || profile?.role === 'admin'

  const activeReminderTemplates = useMemo(
    () => reminderTemplates.filter((template) => template.is_active),
    [reminderTemplates]
  )

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  )

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

  const loadReminderTemplates = useCallback(async () => {
    try {
      const templates = await dataService.getFollowUpReminderTemplates()
      setReminderTemplates(templates)
      const firstActive = templates.find((template) => template.is_active)
      setSelectedReminderTemplateId((current) => current || firstActive?.id || '')
    } catch (error) {
      console.error('Failed to load follow-up reminder templates:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to load reminder templates')
    }
  }, [toast])

  useEffect(() => {
    if (!authLoading && canAccess) {
      loadTasks()
      loadReminderTemplates()
    }
    if (!authLoading && !canAccess) setLoading(false)
  }, [authLoading, canAccess, loadReminderTemplates, loadTasks])

  const stats = useMemo(() => ({
    pending: tasks.filter((task) => task.status === 'pending').length,
    contacted: tasks.filter((task) => task.status === 'contacted').length,
    resolved: tasks.filter((task) => task.status === 'resolved').length,
  }), [tasks])

  const visibleTasks = useMemo(() => {
    const filtered = taskFilter === 'pending'
      ? tasks.filter((task) => task.status === 'pending')
      : [...tasks]

    return filtered.sort((a, b) => {
      if (taskFilter === 'all' && a.status !== b.status) {
        return getStatusSortRank(a.status) - getStatusSortRank(b.status)
      }

      const aTime = new Date(a.created_at).getTime()
      const bTime = new Date(b.created_at).getTime()
      return a.status === 'pending' && b.status === 'pending'
        ? aTime - bTime
        : bTime - aTime
    })
  }, [taskFilter, tasks])

  const updateForm = (taskId: string, patch: Partial<TaskFormState>) => {
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

  const openTaskModal = (task: FollowUpTask) => {
    setForms((current) => ({
      ...current,
      [task.id]: current[task.id] ?? {
        status: task.status,
        outcome: task.outcome ?? '',
        outcome_notes: task.outcome_notes ?? '',
      },
    }))
    setSelectedTaskId(task.id)
    if (!selectedReminderTemplateId && activeReminderTemplates[0]) {
      setSelectedReminderTemplateId(activeReminderTemplates[0].id)
    }
  }

  const closeTaskModal = () => {
    setSelectedTaskId(null)
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
      setForms((current) => ({
        ...current,
        [updated.id]: {
          status: updated.status,
          outcome: updated.outcome ?? '',
          outcome_notes: updated.outcome_notes ?? '',
        },
      }))
      toast.success('Follow-up task updated')
    } catch (error) {
      console.error('Failed to update follow-up task:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to update task')
    } finally {
      setSavingTaskId(null)
    }
  }

  const sendReminder = async (task: FollowUpTask) => {
    if (!selectedReminderTemplateId) {
      toast.error('Select a reminder template first')
      return
    }

    setSendingReminderTaskId(task.id)
    try {
      const result = await dataService.sendFollowUpReminder(task.id, selectedReminderTemplateId)
      await loadTasks()
      if (result.status === 'sent') {
        toast.success('WhatsApp reminder sent')
      } else {
        toast.error(result.errorMessage || 'WhatsApp reminder was logged but not sent')
      }
    } catch (error) {
      console.error('Failed to send follow-up reminder:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to send reminder')
    } finally {
      setSendingReminderTaskId(null)
    }
  }

  const selectedForm = selectedTask ? forms[selectedTask.id] ?? {
    status: selectedTask.status,
    outcome: selectedTask.outcome ?? '',
    outcome_notes: selectedTask.outcome_notes ?? '',
  } : null

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
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
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
          <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Task queue</h2>
              <p className="mt-1 text-sm text-slate-500">Pending tasks are sorted oldest first, so overdue callbacks stay at the top.</p>
            </div>
            <div className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-50 p-1 sm:w-auto">
              <button
                type="button"
                onClick={() => setTaskFilter('pending')}
                className={`h-9 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors sm:flex-none ${
                  taskFilter === 'pending'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Pending only
              </button>
              <button
                type="button"
                onClick={() => setTaskFilter('all')}
                className={`h-9 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors sm:flex-none ${
                  taskFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                All statuses
              </button>
            </div>
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
          ) : visibleTasks.length === 0 ? (
            <div className="p-10 text-center">
              <ClipboardCheck className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <p className="text-sm font-semibold text-slate-800">No pending follow-up tasks</p>
              <p className="mt-1 text-sm text-slate-500">Switch to all statuses to review contacted or resolved work.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleTasks.map((task) => (
                <article
                  key={task.id}
                  className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(220px,1.25fr)_minmax(150px,1fr)_minmax(150px,0.9fr)_110px_150px_110px_auto] lg:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-sm font-bold text-cyan-700">
                      {getInitial(task.patient?.full_name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{task.patient?.full_name ?? 'Unknown patient'}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                        <Phone className="h-3.5 w-3.5" />
                        {task.patient?.phone ?? 'No phone'}
                      </p>
                    </div>
                  </div>

                  <div className="min-w-0 text-sm">
                    <p className="truncate font-semibold text-slate-900">{task.patient_package?.package_name ?? 'Treatment package'}</p>
                    <p className="text-xs text-slate-500">Package</p>
                  </div>

                  <div className="text-sm">
                    <p className="font-semibold text-slate-800">{reasonLabels[task.reason]}</p>
                    <p className="text-xs text-slate-500">Reason</p>
                  </div>

                  <div className="text-sm">
                    <p className="font-semibold text-slate-900">
                      {task.patient_package?.sessions_used ?? 0}/{task.patient_package?.total_sessions ?? 0}
                    </p>
                    <p className="text-xs text-slate-500">Sessions</p>
                  </div>

                  <div className="text-sm">
                    <p className="font-semibold text-slate-900">{formatDateTime(task.created_at)}</p>
                    <p className="text-xs text-slate-500">Created</p>
                  </div>

                  <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${getStatusClass(task.status)}`}>
                    {task.status}
                  </span>

                  <Button type="button" variant="outline" size="sm" onClick={() => openTaskModal(task)} className="w-full lg:w-auto">
                    Manage
                  </Button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <Modal isOpen={Boolean(selectedTask)} onClose={closeTaskModal} title="Manage follow-up task" size="xl">
        {selectedTask && selectedForm && (
          <div className="space-y-5 p-5">
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-50 font-bold text-cyan-700">
                    {getInitial(selectedTask.patient?.full_name)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold text-slate-900">{selectedTask.patient?.full_name ?? 'Unknown patient'}</h3>
                    <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                      <Phone className="h-4 w-4" />
                      {selectedTask.patient?.phone ?? 'No phone'}
                    </p>
                  </div>
                </div>
                <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${getStatusClass(selectedTask.status)}`}>
                  {selectedTask.status}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Package</p>
                  <p className="mt-1 font-semibold text-slate-900">{selectedTask.patient_package?.package_name ?? 'Treatment package'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</p>
                  <p className="mt-1 font-semibold text-slate-900">{reasonLabels[selectedTask.reason]}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sessions</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {selectedTask.patient_package?.sessions_used ?? 0} used / {selectedTask.patient_package?.total_sessions ?? 0} total
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Created</p>
                  <p className="mt-1 font-semibold text-slate-900">{formatDateTime(selectedTask.created_at)}</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-[var(--primary)]" />
                <h3 className="font-semibold text-slate-900">Outcome logging</h3>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select
                  label="Status"
                  value={selectedForm.status}
                  options={statusOptions}
                  onChange={(event) => updateForm(selectedTask.id, { status: event.target.value as FollowUpStatus })}
                />
                <Select
                  label="Outcome"
                  value={selectedForm.outcome}
                  options={outcomeOptions}
                  onChange={(event) => updateForm(selectedTask.id, { outcome: event.target.value as '' | FollowUpOutcome })}
                />
              </div>
              <div className="mt-3">
                <Textarea
                  label="Outcome notes"
                  rows={3}
                  value={selectedForm.outcome_notes}
                  onChange={(event) => updateForm(selectedTask.id, { outcome_notes: event.target.value })}
                  placeholder="Call notes, reschedule date, reason for stopping..."
                />
              </div>
              <div className="mt-4 flex justify-end">
                <Button type="button" onClick={() => saveTask(selectedTask)} loading={savingTaskId === selectedTask.id}>
                  Save outcome
                </Button>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-[var(--primary)]" />
                <h3 className="font-semibold text-slate-900">Send WhatsApp reminder</h3>
              </div>

              {selectedTask.last_reminder ? (
                <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Last reminder: <span className="font-semibold text-slate-900">{formatDateTime(selectedTask.last_reminder.created_at)}</span>
                  {' '}via <span className="font-semibold text-slate-900">{selectedTask.last_reminder.template_label ?? selectedTask.last_reminder.template_name ?? 'template'}</span>
                  <span className={`ml-2 rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${getStatusClass(selectedTask.last_reminder.status === 'sent' ? 'resolved' : selectedTask.last_reminder.status === 'queued' ? 'contacted' : 'pending')}`}>
                    {selectedTask.last_reminder.status}
                  </span>
                </div>
              ) : (
                <div className="mb-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  No follow-up reminder has been logged for this patient yet.
                </div>
              )}

              {activeReminderTemplates.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  No active reminder templates are available. Admin can add or activate one in Settings.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <Select
                    label="Reminder template"
                    value={selectedReminderTemplateId}
                    options={activeReminderTemplates.map((template) => ({
                      value: template.id,
                      label: `${template.label} - ${template.meta_template_name}`,
                    }))}
                    onChange={(event) => setSelectedReminderTemplateId(event.target.value)}
                  />
                  <Button
                    type="button"
                    onClick={() => sendReminder(selectedTask)}
                    loading={sendingReminderTaskId === selectedTask.id}
                    className="min-w-32"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Send
                  </Button>
                </div>
              )}
              <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                <CalendarDays className="h-3.5 w-3.5" />
                Sending a reminder does not mark the task contacted or resolved.
              </p>
            </section>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  )
}
