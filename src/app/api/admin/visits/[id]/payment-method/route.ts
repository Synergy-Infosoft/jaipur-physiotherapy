import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const overrideSchema = z.object({
  payment_method: z.enum(['cash', 'online'], {
    error: 'Payment method is required',
  }),
  reason: z.string().trim().min(5, 'Override reason must be at least 5 characters').max(500),
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

function getOverrideRpcStatus(message: string) {
  if (/VISIT_NOT_FOUND/i.test(message)) return { status: 404, error: 'Visit not found' }
  if (/ADMIN_ACCESS_REQUIRED/i.test(message)) return { status: 403, error: 'Admin access required' }
  if (/INVALID_PAYMENT_METHOD/i.test(message)) return { status: 400, error: 'Payment method is required' }
  if (/OVERRIDE_REASON_REQUIRED/i.test(message)) return { status: 400, error: 'Override reason is required' }
  return null
}

async function requireAdminAccess() {
  const userClient = await createClient()
  const { data: { user }, error: userError } = await userClient.auth.getUser()

  if (userError || !user) {
    return { userId: null, response: jsonResponse({ error: 'Authentication required' }, 401) }
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw profileError

  if (!profile || profile.role !== 'admin') {
    return { userId: user.id, response: jsonResponse({ error: 'Admin access required' }, 403) }
  }

  return { userId: user.id, response: null }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!isAllowedRequestOrigin(request)) {
    return jsonResponse({ error: 'Invalid request origin' }, 403)
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, 415)
  }

  const { id } = await context.params
  const visitId = z.string().uuid().safeParse(id)
  if (!visitId.success) {
    return jsonResponse({ error: 'Invalid visit id' }, 400)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400)
  }

  const parsed = overrideSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse({ error: 'Invalid override request', details: parsed.error.flatten().fieldErrors }, 400)
  }

  try {
    const auth = await requireAdminAccess()
    if (auth.response) return auth.response
    if (!auth.userId) return jsonResponse({ error: 'Authentication required' }, 401)

    const admin = createAdminClient()
    const { data: rpcData, error: rpcError } = await admin.rpc('override_payment_method_atomic', {
      p_visit_id: visitId.data,
      p_new_method: parsed.data.payment_method,
      p_reason: parsed.data.reason,
      p_admin_id: auth.userId,
    })

    if (rpcError) {
      const mapped = getOverrideRpcStatus(rpcError.message)
      if (mapped) return jsonResponse({ error: mapped.error }, mapped.status)
      throw rpcError
    }

    const visit = Array.isArray(rpcData) ? rpcData[0] : rpcData
    if (!visit?.id) throw new Error('Payment method override RPC did not return a visit')

    return jsonResponse({ visit })
  } catch (error) {
    console.error('Payment method override failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to override payment method' }, 503)
  }
}
