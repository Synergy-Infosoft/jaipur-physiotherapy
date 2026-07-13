import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const reminderTemplatePayloadSchema = z.object({
  id: z.string().uuid('Invalid template id').optional(),
  label: z.string().trim().min(1, 'Template label is required').max(160),
  meta_template_name: z.string().trim().min(1, 'Meta template name is required').max(160),
  is_active: z.boolean().optional(),
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

async function requireReminderTemplateAccess() {
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
    return { admin: null, userId: user.id, role: profile?.role ?? null, response: jsonResponse({ error: 'Follow-up reminder template access required' }, 403) }
  }

  return { admin, userId: user.id, role: profile.role, response: null }
}

export async function GET() {
  try {
    const auth = await requireReminderTemplateAccess()
    if (auth.response) return auth.response

    const admin = auth.admin
    if (!admin) return jsonResponse({ error: 'Follow-up reminder template access required' }, 403)

    let query = admin
      .from('follow_up_reminder_templates')
      .select('*')
      .order('is_active', { ascending: false })
      .order('label', { ascending: true })

    if (auth.role !== 'admin') query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) throw error

    return jsonResponse({ templates: data ?? [] })
  } catch (error) {
    console.error('Follow-up reminder templates load failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to load follow-up reminder templates' }, 503)
  }
}

export async function POST(request: NextRequest) {
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

  const parsed = reminderTemplatePayloadSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse({ error: 'Please correct the highlighted fields', details: parsed.error.flatten().fieldErrors }, 400)
  }

  try {
    const auth = await requireReminderTemplateAccess()
    if (auth.response) return auth.response
    if (auth.role !== 'admin' || !auth.admin || !auth.userId) {
      return jsonResponse({ error: 'Admin access required' }, 403)
    }

    const input = parsed.data
    const payload = {
      label: input.label,
      meta_template_name: input.meta_template_name,
      is_active: input.is_active ?? true,
    }

    const { data, error } = input.id
      ? await auth.admin
        .from('follow_up_reminder_templates')
        .update(payload)
        .eq('id', input.id)
        .select()
        .single()
      : await auth.admin
        .from('follow_up_reminder_templates')
        .insert({ ...payload, created_by: auth.userId })
        .select()
        .single()

    if (error) throw error

    return jsonResponse({ template: data }, input.id ? 200 : 201)
  } catch (error) {
    console.error('Follow-up reminder template save failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to save follow-up reminder template' }, 503)
  }
}
