import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { WhatsAppNotificationStatus, WhatsAppNotificationType } from '@/types'

export const dynamic = 'force-dynamic'

const validStatuses = new Set<WhatsAppNotificationStatus>(['queued', 'sent', 'failed'])
const validTypes = new Set<WhatsAppNotificationType>([
  'registration_confirmation',
  'payment_receipt',
  'session_reminder',
  'follow_up',
  'portal_link',
])

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function parseDateParam(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return value
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function requireAdmin() {
  const userClient = await createClient()
  const { data: { user }, error: userError } = await userClient.auth.getUser()

  if (userError || !user) {
    return { admin: null, response: jsonResponse({ error: 'Authentication required' }, 401) }
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw profileError

  if (profile?.role !== 'admin') {
    return { admin: null, response: jsonResponse({ error: 'Admin access required' }, 403) }
  }

  return { admin, response: null }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (auth.response) return auth.response
    if (!auth.admin) return jsonResponse({ error: 'Admin access required' }, 403)

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const type = searchParams.get('type')
    const queryText = searchParams.get('q')?.trim().toLowerCase() ?? ''
    const dateFrom = parseDateParam(searchParams.get('date_from'))
    const dateTo = parseDateParam(searchParams.get('date_to'))
    const limitParam = Number(searchParams.get('limit') ?? 100)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 20), 250) : 100

    let query = auth.admin
      .from('whatsapp_notifications')
      .select('*, patient:patients(id, full_name, phone)')
      .order('created_at', { ascending: false })
      .limit(limit)

    const statusFilter = status as WhatsAppNotificationStatus | null
    const typeFilter = type as WhatsAppNotificationType | null

    if (statusFilter && validStatuses.has(statusFilter)) {
      query = query.eq('status', statusFilter)
    }

    if (typeFilter && validTypes.has(typeFilter)) {
      query = query.eq('notification_type', typeFilter)
    }

    if (dateFrom) {
      query = query.gte('created_at', `${dateFrom}T00:00:00.000Z`)
    }

    if (dateTo) {
      const exclusiveTo = addDays(dateTo, 1)
      query = query.lt('created_at', `${exclusiveTo}T00:00:00.000Z`)
    }

    const { data: logs, error: logsError } = await query
    if (logsError) throw logsError

    const filteredLogs = queryText
      ? (logs ?? []).filter((log) => {
        const patient = Array.isArray(log.patient) ? log.patient[0] : log.patient
        const haystack = [
          log.notification_type,
          log.status,
          log.meta_message_id,
          log.error_message,
          patient?.full_name,
          patient?.phone,
          typeof log.payload === 'object' && log.payload ? JSON.stringify(log.payload) : '',
        ].filter(Boolean).join(' ').toLowerCase()

        return haystack.includes(queryText)
      })
      : (logs ?? [])

    const statuses = filteredLogs as Array<{ status: WhatsAppNotificationStatus }>
    const summary = {
      total: statuses.length,
      queued: statuses.filter((row) => row.status === 'queued').length,
      sent: statuses.filter((row) => row.status === 'sent').length,
      failed: statuses.filter((row) => row.status === 'failed').length,
    }

    return jsonResponse({ logs: filteredLogs, summary })
  } catch (error) {
    console.error('WhatsApp logs load failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to load WhatsApp logs' }, 503)
  }
}
