import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const updateTaskSchema = z.object({
  id: z.string().uuid('Invalid task id'),
  status: z.enum(['pending', 'contacted', 'resolved']),
  outcome: z.enum(['rescheduled', 'discontinued_reason', 'no_answer']).nullable().optional(),
  outcome_notes: z.string().trim().max(1000).nullable().optional(),
})

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

async function attachSessionsUsed(
  admin: ReturnType<typeof createAdminClient>,
  task: {
    patient_package_id?: string | null
    patient_package?: Record<string, unknown> | null
  }
) {
  if (!task.patient_package_id || !task.patient_package) return task

  const { data: sessions, error } = await admin
    .from('package_sessions')
    .select('id, is_voided')
    .eq('patient_package_id', task.patient_package_id)

  if (error) throw error

  const sessionsUsed = (sessions ?? []).filter((session) => !session.is_voided).length

  return {
    ...task,
    patient_package: {
      ...task.patient_package,
      sessions_used: sessionsUsed,
    },
  }
}

async function requireFollowUpAccess() {
  const userClient = await createClient()
  const { data: { user }, error: userError } = await userClient.auth.getUser()

  if (userError || !user) {
    return { admin: null, userId: null, role: null, response: jsonResponse({ error: 'Authentication required' }, 401) }
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw profileError

  if (!profile || !['admin', 'follow_up_agent'].includes(profile.role)) {
    return { admin: null, userId: user.id, role: profile?.role ?? null, response: jsonResponse({ error: 'Follow-up access required' }, 403) }
  }

  return { admin, userId: user.id, role: profile.role, response: null }
}

export async function GET() {
  try {
    const auth = await requireFollowUpAccess()
    if (auth.response) return auth.response
    if (!auth.admin || !auth.userId || !auth.role) return jsonResponse({ error: 'Follow-up access required' }, 403)

    let query = auth.admin
      .from('follow_up_tasks')
      .select('*, patient:patients(*), patient_package:patient_packages(*)')
      .order('created_at', { ascending: false })

    if (auth.role === 'follow_up_agent') {
      query = query.eq('assigned_to', auth.userId)
    }

    const { data, error } = await query
    if (error) throw error

    const rows = (data ?? []) as Array<{
      patient_package_id: string
      patient_package?: Record<string, unknown> | null
    }>
    const packageIds = Array.from(new Set(rows.map((task) => task.patient_package_id).filter(Boolean)))
    const sessionsByPackage = new Map<string, number>()

    if (packageIds.length > 0) {
      const { data: sessions, error: sessionsError } = await auth.admin
        .from('package_sessions')
        .select('patient_package_id, is_voided')
        .in('patient_package_id', packageIds)

      if (sessionsError) throw sessionsError

      for (const session of (sessions ?? []) as Array<{ patient_package_id: string; is_voided: boolean }>) {
        if (session.is_voided) continue
        sessionsByPackage.set(session.patient_package_id, (sessionsByPackage.get(session.patient_package_id) ?? 0) + 1)
      }
    }

    const tasks = rows.map((task) => ({
      ...task,
      patient_package: task.patient_package
        ? {
          ...task.patient_package,
          sessions_used: sessionsByPackage.get(task.patient_package_id) ?? 0,
        }
        : task.patient_package,
    }))

    return jsonResponse({ tasks })
  } catch (error) {
    console.error('Follow-up task list failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to load follow-up tasks' }, 503)
  }
}

export async function PATCH(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400)
  }

  const parsed = updateTaskSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse({ error: 'Invalid follow-up update', details: parsed.error.flatten().fieldErrors }, 400)
  }

  try {
    const auth = await requireFollowUpAccess()
    if (auth.response) return auth.response
    if (!auth.admin || !auth.userId || !auth.role) return jsonResponse({ error: 'Follow-up access required' }, 403)

    const { data: existing, error: existingError } = await auth.admin
      .from('follow_up_tasks')
      .select('id, assigned_to')
      .eq('id', parsed.data.id)
      .maybeSingle()

    if (existingError) throw existingError
    if (!existing) return jsonResponse({ error: 'Follow-up task not found' }, 404)
    if (auth.role === 'follow_up_agent' && existing.assigned_to !== auth.userId) {
      return jsonResponse({ error: 'Task is not assigned to this user' }, 403)
    }

    const patch = {
      status: parsed.data.status,
      outcome: parsed.data.outcome ?? null,
      outcome_notes: parsed.data.outcome_notes?.trim() || null,
      resolved_at: parsed.data.status === 'resolved' ? new Date().toISOString() : null,
    }

    const { data: updated, error: updateError } = await auth.admin
      .from('follow_up_tasks')
      .update(patch)
      .eq('id', parsed.data.id)
      .select('*, patient:patients(*), patient_package:patient_packages(*)')
      .single()

    if (updateError) throw updateError

    return jsonResponse({ task: await attachSessionsUsed(auth.admin, updated) })
  } catch (error) {
    console.error('Follow-up task update failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to update follow-up task' }, 503)
  }
}
