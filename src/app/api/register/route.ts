import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { fallbackClinicSettings, getConsultationSlotError, normalizeWorkingSchedule, registrationSchema } from '@/lib/registration'

export const dynamic = 'force-dynamic'

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status, headers: { 'Cache-Control': 'no-store' } })
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

function getMissingSupabaseConfig() {
  const missing: string[] = []
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  return missing
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

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return errorResponse('Invalid request origin', 403)
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return errorResponse('Content-Type must be application/json', 415)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid JSON request body', 400)
  }

  const parsed = registrationSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('Please correct the highlighted fields', 400, parsed.error.flatten().fieldErrors)
  }

  const input = parsed.data

  try {
    const missingSupabaseConfig = getMissingSupabaseConfig()
    if (missingSupabaseConfig.length > 0) {
      const message = `Registration is unavailable because Supabase is not fully configured: ${missingSupabaseConfig.join(', ')}`
      console.error(message)
      return errorResponse('Registration is temporarily unavailable. Please contact reception.', 503)
    }

    const admin = createAdminClient()
    const { data: settingsRow } = await admin
      .from('clinic_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    const settings = {
      ...fallbackClinicSettings,
      ...(settingsRow ?? {}),
      working_hours_start: String(settingsRow?.working_hours_start ?? fallbackClinicSettings.working_hours_start).slice(0, 5),
      working_hours_end: String(settingsRow?.working_hours_end ?? fallbackClinicSettings.working_hours_end).slice(0, 5),
      working_schedule: normalizeWorkingSchedule(
        settingsRow?.working_schedule,
        settingsRow?.working_days ?? fallbackClinicSettings.working_days,
        String(settingsRow?.working_hours_start ?? fallbackClinicSettings.working_hours_start).slice(0, 5),
        String(settingsRow?.working_hours_end ?? fallbackClinicSettings.working_hours_end).slice(0, 5)
      ),
    }

    const userClient = await createClient()
    const { data: { user } } = await userClient.auth.getUser()


    if (!user) {
      const slotError = getConsultationSlotError(settings, input.consultation_date, input.consultation_time)
      if (slotError) return errorResponse(slotError, 400)
    }

    const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    const clientIp = forwardedFor || request.headers.get('x-real-ip') || 'unknown'
    const salt = process.env.REGISTRATION_RATE_LIMIT_SALT || process.env.NEXT_PUBLIC_SUPABASE_URL || 'clinic-registration'
    const requestHash = user
      ? null
      : createHash('sha256').update(`${salt}:${clientIp}`).digest('hex')

    const rpcPayload = {
      p_full_name: input.full_name,
      p_age: input.age,
      p_gender: input.gender,
      p_phone: input.phone,
      p_chief_complaint: input.chief_complaint,
      p_doctor_id: input.doctor_id || null,
      p_address: input.address || null,
      p_father_name: input.father_name || null,
      p_referral_source: input.referral_source || null,
      p_visit_type: input.visit_type,
      p_consultation_date: input.consultation_date,
      p_consultation_time: input.consultation_time,
      p_registered_by: user ? 'receptionist' : 'self',
      p_request_hash: requestHash,
      p_payment_method: input.payment_method,
    }

    const { data, error } = await admin.rpc('register_patient_atomic', rpcPayload)

    if (error) {
      const isLegacyRpcSignature = /does not exist|parameter|missing required|invalid input syntax|function .*register_patient_atomic/i.test(error.message)
      if (isLegacyRpcSignature) {
        const { data: legacyData, error: legacyError } = await admin.rpc('register_patient_atomic', {
          ...rpcPayload,
          p_payment_method: undefined,
        })

        if (!legacyError) {
          return NextResponse.json(
            {
              token_number: legacyData?.[0]?.token_number,
              visit_id: legacyData?.[0]?.visit_id,
              patient_name: legacyData?.[0]?.patient_name,
              confirmation_ref: legacyData?.[0]?.confirmation_token,
              duplicate_registration: legacyData?.[0]?.duplicate_registration,
            },
            { status: legacyData?.[0]?.duplicate_registration ? 200 : 201, headers: { 'Cache-Control': 'no-store' } }
          )
        }
      }

      if (error.message.includes('RATE_LIMITED')) {
        return errorResponse('Too many registration attempts. Please wait 15 minutes and try again.', 429)
      }
      if (error.code === '23505') {
        return errorResponse('A registration conflict occurred. Please retry once.', 409)
      }
      throw error
    }

    const result = Array.isArray(data) ? data[0] : data
    if (!result) throw new Error('Registration did not return a result')

    return NextResponse.json(
      {
        token_number: result.token_number,
        visit_id: result.visit_id,
        patient_name: result.patient_name,
        confirmation_ref: result.confirmation_token,
        duplicate_registration: result.duplicate_registration,
      },
      { status: result.duplicate_registration ? 200 : 201, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('Patient registration failed', error instanceof Error ? error.message : 'Unknown error')
    return errorResponse('Registration is temporarily unavailable. Please contact reception.', 503)
  }
}
