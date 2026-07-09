import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { PatientPortalLink } from '@/types'

function normalizeBaseUrl(baseUrl?: string | null) {
  const candidate = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  try {
    return new URL(candidate).origin
  } catch {
    return 'http://localhost:3000'
  }
}

export function buildPatientPortalUrl(token: string, baseUrl?: string | null) {
  return `${normalizeBaseUrl(baseUrl)}/portal/${token}`
}

export async function getOrCreatePatientPortalLink(patientId: string): Promise<PatientPortalLink> {
  const admin = createAdminClient()

  const { data: existing, error: existingError } = await admin
    .from('patient_portal_links')
    .select('*')
    .eq('patient_id', patientId)
    .is('revoked_at', null)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return existing as PatientPortalLink

  const { data: created, error: createError } = await admin
    .from('patient_portal_links')
    .insert({ patient_id: patientId })
    .select('*')
    .single()

  if (createError) throw createError
  return created as PatientPortalLink
}

export async function regeneratePatientPortalLink(patientId: string): Promise<PatientPortalLink> {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { error: revokeError } = await admin
    .from('patient_portal_links')
    .update({ revoked_at: now })
    .eq('patient_id', patientId)
    .is('revoked_at', null)

  if (revokeError) throw revokeError

  const { data: created, error: createError } = await admin
    .from('patient_portal_links')
    .insert({ patient_id: patientId })
    .select('*')
    .single()

  if (createError) throw createError
  return created as PatientPortalLink
}