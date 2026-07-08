import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const createPackageSchema = z.object({
  patient_id: z.string().uuid('Invalid patient id'),
  visit_id: z.string().uuid('Invalid visit id').nullable().optional(),
  package_name: z.string().trim().min(1, 'Package name is required').max(160),
  total_sessions: z.coerce.number().int().min(1, 'Total sessions must be at least 1').max(500),
  quoted_amount: z.coerce.number().min(0, 'Quoted amount cannot be negative'),
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

async function requireBillingAccess() {
  const userClient = await createClient()
  const { data: { user }, error: userError } = await userClient.auth.getUser()

  if (userError || !user) {
    return { userClient, response: jsonResponse({ error: 'Authentication required' }, 401) }
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw profileError

  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { userClient, response: jsonResponse({ error: 'Billing access required' }, 403) }
  }

  return { userClient, response: null }
}

function getPackageRpcStatus(message: string) {
  if (/PATIENT_NOT_FOUND/i.test(message)) return { status: 404, error: 'Patient not found' }
  if (/VISIT_NOT_FOUND/i.test(message)) return { status: 404, error: 'Visit not found for this patient' }
  if (/BILLING_ACCESS_REQUIRED/i.test(message)) return { status: 403, error: 'Billing access required' }
  if (/INVALID_PACKAGE_NAME/i.test(message)) return { status: 400, error: 'Package name is required' }
  if (/INVALID_TOTAL_SESSIONS/i.test(message)) return { status: 400, error: 'Total sessions must be at least 1' }
  if (/INVALID_QUOTED_AMOUNT/i.test(message)) return { status: 400, error: 'Quoted amount cannot be negative' }
  return null
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

  const parsed = createPackageSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse({ error: 'Invalid package request', details: parsed.error.flatten().fieldErrors }, 400)
  }

  try {
    const auth = await requireBillingAccess()
    if (auth.response) return auth.response

    const input = parsed.data
    const { data: rpcData, error: rpcError } = await auth.userClient.rpc('create_patient_package_atomic', {
      p_patient_id: input.patient_id,
      p_visit_id: input.visit_id || null,
      p_package_name: input.package_name,
      p_total_sessions: input.total_sessions,
      p_quoted_amount: input.quoted_amount,
    })

    if (rpcError) {
      const mapped = getPackageRpcStatus(rpcError.message)
      if (mapped) return jsonResponse({ error: mapped.error }, mapped.status)
      throw rpcError
    }

    const packageRow = Array.isArray(rpcData) ? rpcData[0] : rpcData
    if (!packageRow?.id) throw new Error('Package RPC did not return a package')

    return jsonResponse({ package: packageRow }, 201)
  } catch (error) {
    console.error('Package creation failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to create package' }, 503)
  }
}
