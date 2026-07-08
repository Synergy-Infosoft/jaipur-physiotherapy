import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sendWhatsAppNotification } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

const recordPaymentSchema = z.object({
  patient_id: z.string().uuid('Invalid patient id'),
  patient_package_id: z.string().uuid('Invalid package id').nullable().optional(),
  visit_id: z.string().uuid('Invalid visit id').nullable().optional(),
  amount: z.coerce.number().positive('Payment amount must be greater than 0'),
  payment_method: z.enum(['cash', 'online'], {
    error: 'Payment method is required',
  }),
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

function getPaymentRpcStatus(message: string) {
  if (/PATIENT_NOT_FOUND/i.test(message)) return { status: 404, error: 'Patient not found' }
  if (/PACKAGE_NOT_FOUND/i.test(message)) return { status: 404, error: 'Package not found for this patient' }
  if (/VISIT_NOT_FOUND/i.test(message)) return { status: 404, error: 'Visit not found for this patient' }
  if (/BILLING_ACCESS_REQUIRED/i.test(message)) return { status: 403, error: 'Billing access required' }
  if (/INVALID_PAYMENT_AMOUNT/i.test(message)) return { status: 400, error: 'Payment amount must be greater than 0' }
  if (/INVALID_PAYMENT_METHOD/i.test(message)) return { status: 400, error: 'Payment method is required' }
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

  const parsed = recordPaymentSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse({ error: 'Invalid payment request', details: parsed.error.flatten().fieldErrors }, 400)
  }

  try {
    const auth = await requireBillingAccess()
    if (auth.response) return auth.response

    const input = parsed.data
    const { data: rpcData, error: rpcError } = await auth.userClient.rpc('record_payment_atomic', {
      p_patient_id: input.patient_id,
      p_patient_package_id: input.patient_package_id || null,
      p_visit_id: input.visit_id || null,
      p_amount: input.amount,
      p_payment_method: input.payment_method,
    })

    if (rpcError) {
      const mapped = getPaymentRpcStatus(rpcError.message)
      if (mapped) return jsonResponse({ error: mapped.error }, mapped.status)
      throw rpcError
    }

    const paymentResult = Array.isArray(rpcData) ? rpcData[0] : rpcData
    if (!paymentResult?.payment_transaction_id) throw new Error('Payment RPC did not return a payment result')

    const whatsapp = await sendWhatsAppNotification({
      patientId: input.patient_id,
      notificationType: 'payment_receipt',
      templateName: process.env.PAYMENT_RECEIPT_TEMPLATE_NAME,
      payload: {
        event_type: 'payment_recorded',
        payment_transaction_id: paymentResult.payment_transaction_id,
        patient_package_id: paymentResult.patient_package_id,
        visit_id: input.visit_id || null,
        amount: input.amount,
        payment_method: input.payment_method,
        paid_total: paymentResult.paid_total,
        balance: paymentResult.balance,
      },
      bodyParameters: [
        input.amount,
        input.payment_method,
        paymentResult.balance ?? 'N/A',
      ],
    })

    return jsonResponse({ payment: paymentResult, whatsapp }, 201)
  } catch (error) {
    console.error('Payment recording failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to record payment' }, 503)
  }
}
