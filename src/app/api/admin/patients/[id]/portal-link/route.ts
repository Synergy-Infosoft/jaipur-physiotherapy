import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { buildPatientPortalUrl, regeneratePatientPortalLink } from '@/lib/patientPortal'

export const dynamic = 'force-dynamic'

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

async function requireAdmin() {
  const userClient = await createClient()
  const { data: { user }, error: userError } = await userClient.auth.getUser()

  if (userError || !user) {
    return { response: jsonResponse({ error: 'Authentication required' }, 401) }
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw profileError
  if (profile?.role !== 'admin') return { response: jsonResponse({ error: 'Admin access required' }, 403) }

  return { response: null }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin()
    if (auth.response) return auth.response

    const { id } = await context.params
    const admin = createAdminClient()
    const { data: patient, error: patientError } = await admin
      .from('patients')
      .select('id')
      .eq('id', id)
      .maybeSingle()

    if (patientError) throw patientError
    if (!patient) return jsonResponse({ error: 'Patient not found' }, 404)

    const portalLink = await regeneratePatientPortalLink(id)
    const portalUrl = buildPatientPortalUrl(portalLink.token, request.nextUrl.origin)

    return jsonResponse({ portal_link: portalLink, portal_url: portalUrl }, 201)
  } catch (error) {
    console.error('Portal link regeneration failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to regenerate portal link' }, 503)
  }
}