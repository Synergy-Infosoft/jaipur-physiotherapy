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
      status: 'active' | 'completed' | 'cancelled'
      created_at: string
      patient?: { id: string; full_name: string; phone: string | null } | null
    }>
    const patientIds = Array.from(new Set(packageRows.map((row) => row.patient_id)))

    const { data: packageHistory, error: packageHistoryError } = patientIds.length > 0
      ? await admin
        .from('patient_packages')
        .select('id, patient_id, package_name, total_sessions, status, created_at')
        .in('patient_id', patientIds)
        .order('created_at', { ascending: true })
      : { data: [], error: null }

    if (packageHistoryError) throw packageHistoryError

    const historyRows = (packageHistory ?? []) as Array<{
      id: string
      patient_id: string
      package_name: string
      total_sessions: number
      status: 'active' | 'completed' | 'cancelled'
      created_at: string
    }>
    const historyPackageIds = historyRows.map((row) => row.id)

    const { data: sessions, error: sessionsError } = historyPackageIds.length > 0
      ? await admin
        .from('package_sessions')
        .select('id, patient_package_id, session_date, marked_at, is_voided, notes')
        .in('patient_package_id', historyPackageIds)
        .order('marked_at', { ascending: true })
      : { data: [], error: null }

    if (sessionsError) throw sessionsError

    const todayKey = new Date().toISOString().slice(0, 10)
    const sessionsByPackage = new Map<string, {
      used: number
      last: string | null
      today: number
      sessions: Array<{
        id: string
        patient_package_id: string
        session_date: string
        marked_at: string
        is_voided: boolean
        notes: string | null
      }>
    }>()

    for (const session of (sessions ?? []) as Array<{
      id: string
      patient_package_id: string
      session_date: string
      marked_at: string
      is_voided: boolean
      notes: string | null
    }>) {
      const current = sessionsByPackage.get(session.patient_package_id) ?? { used: 0, last: null, today: 0, sessions: [] }
      current.sessions.push(session)
      if (!session.is_voided) {
        current.used += 1
        if (session.session_date === todayKey) current.today += 1
        if (!current.last || session.marked_at > current.last) current.last = session.marked_at
      }
      sessionsByPackage.set(session.patient_package_id, current)
    }

    const historyByPatient = new Map<string, Array<{
      id: string
      package_name: string
      total_sessions: number
      status: 'active' | 'completed' | 'cancelled'
      created_at: string
      sessions_used: number
      sessions_remaining: number
      last_session_at: string | null
      sessions: Array<{
        id: string
        patient_package_id: string
        session_date: string
        marked_at: string
        is_voided: boolean
        notes: string | null
      }>
    }>>()

    for (const row of historyRows) {
      const counts = sessionsByPackage.get(row.id) ?? { used: 0, last: null, today: 0, sessions: [] }
      const item = {
        id: row.id,
        package_name: row.package_name,
        total_sessions: row.total_sessions,
        status: row.status,
        created_at: row.created_at,
        sessions_used: counts.used,
        sessions_remaining: Math.max(row.total_sessions - counts.used, 0),
        last_session_at: counts.last,
        sessions: counts.sessions,
      }
      historyByPatient.set(row.patient_id, [...(historyByPatient.get(row.patient_id) ?? []), item])
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
          today_sessions: 'today' in counts ? counts.today : 0,
          package_history: historyByPatient.get(row.patient_id) ?? [],
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
      if (/PACKAGE_DAILY_SESSION_LIMIT_REACHED/i.test(rpcError.message)) return jsonResponse({ error: 'This package already has 2 sessions marked today' }, 409)
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
