import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sendWhatsAppNotification } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

const markSessionSchema = z.object({
  patient_package_id: z.string().uuid('Invalid package id'),
})

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

async function requireTherapistAccess() {
  const userClient = await createClient()
  const { data: { user }, error: userError } = await userClient.auth.getUser()

  if (userError || !user) {
    return { userClient, userId: null, response: jsonResponse({ error: 'Authentication required' }, 401) }
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw profileError

  if (!profile || !['admin', 'therapist'].includes(profile.role)) {
    return { userClient, userId: user.id, response: jsonResponse({ error: 'Therapist access required' }, 403) }
  }

  return { userClient, userId: user.id, response: null }
}

export async function GET() {
  try {
    const auth = await requireTherapistAccess()
    if (auth.response) return auth.response

    const admin = createAdminClient()
    const { data: packages, error: packagesError } = await admin
      .from('patient_packages')
      .select('id, patient_id, package_name, total_sessions, status, created_at, patient:patients(id, full_name, phone)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })

    if (packagesError) throw packagesError

    const packageRows = (packages ?? []) as Array<{
      id: string
      patient_id: string
      package_name: string
      total_sessions: number
      patient?: { id: string; full_name: string; phone: string | null } | null
    }>
    const packageIds = packageRows.map((row) => row.id)

    const { data: sessions, error: sessionsError } = packageIds.length > 0
      ? await admin
        .from('package_sessions')
        .select('patient_package_id, is_voided, marked_at')
        .in('patient_package_id', packageIds)
      : { data: [], error: null }

    if (sessionsError) throw sessionsError

    const sessionsByPackage = new Map<string, { used: number; last: string | null }>()
    for (const session of (sessions ?? []) as Array<{ patient_package_id: string; is_voided: boolean; marked_at: string }>) {
      const current = sessionsByPackage.get(session.patient_package_id) ?? { used: 0, last: null }
      if (!session.is_voided) current.used += 1
      if (!current.last || session.marked_at > current.last) current.last = session.marked_at
      sessionsByPackage.set(session.patient_package_id, current)
    }

    return jsonResponse({
      packages: packageRows.map((row) => {
        const counts = sessionsByPackage.get(row.id) ?? { used: 0, last: null }
        return {
          patient_package_id: row.id,
          patient_id: row.patient_id,
          patient_name: row.patient?.full_name ?? 'Unknown patient',
          patient_phone: row.patient?.phone ?? null,
          package_name: row.package_name,
          total_sessions: row.total_sessions,
          sessions_used: counts.used,
          sessions_remaining: Math.max(row.total_sessions - counts.used, 0),
          last_session_at: counts.last,
        }
      }),
    })
  } catch (error) {
    console.error('Therapist package list failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to load active therapy packages' }, 503)
  }
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400)
  }

  const parsed = markSessionSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse({ error: 'Invalid session request', details: parsed.error.flatten().fieldErrors }, 400)
  }

  try {
    const auth = await requireTherapistAccess()
    if (auth.response) return auth.response
    if (!auth.userId) return jsonResponse({ error: 'Authentication required' }, 401)

    const { data: rpcData, error: rpcError } = await auth.userClient.rpc('mark_session_atomic', {
      p_patient_package_id: parsed.data.patient_package_id,
      p_marked_by: auth.userId,
    })

    if (rpcError) {
      if (/ACTIVE_PACKAGE_NOT_FOUND/i.test(rpcError.message)) return jsonResponse({ error: 'Active package not found' }, 404)
      if (/PACKAGE_SESSIONS_EXHAUSTED/i.test(rpcError.message)) return jsonResponse({ error: 'No sessions remaining for this package' }, 409)
      if (/THERAPIST_ACCESS_REQUIRED/i.test(rpcError.message)) return jsonResponse({ error: 'Therapist access required' }, 403)
      throw rpcError
    }

    const sessionResult = Array.isArray(rpcData) ? rpcData[0] : rpcData
    if (!sessionResult?.session_id) throw new Error('Session RPC did not return a result')

    const whatsapp = await sendWhatsAppNotification({
      patientId: sessionResult.patient_id,
      notificationType: 'session_reminder',
      templateName: process.env.SESSION_REMINDER_TEMPLATE_NAME,
      payload: {
        event_type: 'session_marked',
        session_id: sessionResult.session_id,
        patient_package_id: sessionResult.patient_package_id,
        package_name: sessionResult.package_name,
        sessions_used: sessionResult.sessions_used,
        sessions_remaining: sessionResult.sessions_remaining,
      },
      bodyParameters: [
        sessionResult.package_name,
        sessionResult.sessions_used,
        sessionResult.sessions_remaining,
      ],
    })

    return jsonResponse({ session: { ...sessionResult, whatsapp } }, 201)
  } catch (error) {
    console.error('Session mark failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to mark session complete' }, 503)
  }
}