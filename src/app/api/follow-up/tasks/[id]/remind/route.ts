import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sendWhatsAppNotification } from '@/lib/whatsapp'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const reminderPayloadSchema = z.object({
  template_id: z.string().uuid('Select a valid reminder template'),
})

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || null
}

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function addOrigin(origins: Set<string>, value: string | null | undefined) {
  const origin = normalizeOrigin(value)
  if (origin) origins.add(origin)
}

function getAllowedOrigins(request: NextRequest) {
  const origins = new Set<string>()
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'))
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'))
  const host = firstHeaderValue(request.headers.get('host'))
  const requestProtocol = request.nextUrl.protocol.replace(':', '') || 'https'
  const effectiveProtocol = forwardedProto || requestProtocol

  addOrigin(origins, request.nextUrl.origin)
  addOrigin(origins, process.env.NEXT_PUBLIC_APP_URL)

  const extraOrigins = process.env.APP_ALLOWED_ORIGINS?.split(',') ?? []
  for (const origin of extraOrigins) addOrigin(origins, origin.trim())

  for (const candidateHost of [forwardedHost, host]) {
    if (!candidateHost) continue
    addOrigin(origins, `${effectiveProtocol}://${candidateHost}`)
    if (!forwardedProto && !candidateHost.startsWith('localhost') && !candidateHost.startsWith('127.0.0.1')) {
      addOrigin(origins, `https://${candidateHost}`)
    }
  }

  return origins
}

function isAllowedRequestOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const normalizedOrigin = normalizeOrigin(origin)
  if (!normalizedOrigin) return false
  return getAllowedOrigins(request).has(normalizedOrigin)
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

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAllowedRequestOrigin(request)) {
    return jsonResponse({ error: 'Invalid request origin' }, 403)
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, 415)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400)
  }

  const parsed = reminderPayloadSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse({ error: 'Invalid reminder request', details: parsed.error.flatten().fieldErrors }, 400)
  }

  try {
    const auth = await requireFollowUpAccess()
    if (auth.response) return auth.response
    if (!auth.admin || !auth.userId || !auth.role) return jsonResponse({ error: 'Follow-up access required' }, 403)

    const { id } = await context.params

    const { data: task, error: taskError } = await auth.admin
      .from('follow_up_tasks')
      .select('*, patient:patients(id, full_name, phone), patient_package:patient_packages(id, package_name, total_sessions, status)')
      .eq('id', id)
      .maybeSingle()

    if (taskError) throw taskError
    if (!task) return jsonResponse({ error: 'Follow-up task not found' }, 404)
    if (auth.role === 'follow_up_agent' && task.assigned_to !== auth.userId) {
      return jsonResponse({ error: 'Task is not assigned to this user' }, 403)
    }

    const { data: template, error: templateError } = await auth.admin
      .from('follow_up_reminder_templates')
      .select('*')
      .eq('id', parsed.data.template_id)
      .eq('is_active', true)
      .maybeSingle()

    if (templateError) throw templateError
    if (!template) return jsonResponse({ error: 'Active reminder template not found' }, 404)

    const { data: sessions, error: sessionsError } = await auth.admin
      .from('package_sessions')
      .select('id, is_voided')
      .eq('patient_package_id', task.patient_package_id)

    if (sessionsError) throw sessionsError

    const sessionsUsed = (sessions ?? []).filter((session) => !session.is_voided).length
    const patient = Array.isArray(task.patient) ? task.patient[0] : task.patient
    const patientPackage = Array.isArray(task.patient_package) ? task.patient_package[0] : task.patient_package
    const totalSessions = Number(patientPackage?.total_sessions ?? 0)
    const sessionsRemaining = Math.max(0, totalSessions - sessionsUsed)
    const packageName = String(patientPackage?.package_name ?? 'Treatment package')
    const patientName = String(patient?.full_name ?? 'Patient')

    const reminder = await sendWhatsAppNotification({
      patientId: task.patient_id,
      notificationType: 'follow_up',
      templateName: template.meta_template_name,
      payload: {
        event_type: 'follow_up_reminder',
        follow_up_task_id: task.id,
        follow_up_reminder_template_id: template.id,
        follow_up_reminder_template_label: template.label,
        follow_up_reminder_template_name: template.meta_template_name,
        patient_package_id: task.patient_package_id,
        package_name: packageName,
        sessions_used: sessionsUsed,
        sessions_remaining: sessionsRemaining,
        total_sessions: totalSessions,
      },
      bodyParameters: [
        patientName,
        packageName,
        sessionsRemaining,
      ],
    })

    return jsonResponse({ reminder })
  } catch (error) {
    console.error('Follow-up reminder send failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to send follow-up reminder' }, 503)
  }
}
