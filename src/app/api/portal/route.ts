import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { LedgerPaymentMethod, PackageStatus, PatientPortalOverview, PatientPortalPayment } from '@/types'

export const dynamic = 'force-dynamic'

const tokenSchema = z.string().uuid()

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function normalizePaymentHistory(value: unknown): PatientPortalPayment[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      const row = item as Record<string, unknown>
      if (typeof row.id !== 'string' || typeof row.payment_method !== 'string' || typeof row.created_at !== 'string') return null
      return {
        id: row.id,
        amount: Number(row.amount ?? 0),
        payment_method: row.payment_method as LedgerPaymentMethod,
        is_correction: Boolean(row.is_correction),
        correction_reason: typeof row.correction_reason === 'string' ? row.correction_reason : null,
        created_at: row.created_at,
      }
    })
    .filter((item): item is PatientPortalPayment => Boolean(item))
}

export async function GET(request: NextRequest) {
  const parsed = tokenSchema.safeParse(request.nextUrl.searchParams.get('token'))
  if (!parsed.success) return jsonResponse({ error: 'Invalid portal token' }, 400)

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('get_patient_portal_overview', {
      p_token: parsed.data,
    })

    if (error) {
      if (/PORTAL_LINK_NOT_FOUND/i.test(error.message)) return jsonResponse({ error: 'Portal link not found or revoked' }, 404)
      throw error
    }

    const rows = data ?? []
    if (rows.length === 0) return jsonResponse({ error: 'Portal link not found or revoked' }, 404)

    const first = rows[0]
    const overview: PatientPortalOverview = {
      patient_id: first.patient_id,
      patient_name: first.patient_name,
      packages: rows
        .filter((row) => row.package_id && row.package_name && row.status)
        .map((row) => ({
          package_id: row.package_id as string,
          package_name: row.package_name as string,
          status: row.status as PackageStatus,
          total_sessions: Number(row.total_sessions ?? 0),
          sessions_used: Number(row.sessions_used ?? 0),
          sessions_remaining: Number(row.sessions_remaining ?? 0),
          quoted_amount: Number(row.quoted_amount ?? 0),
          paid_total: Number(row.paid_total ?? 0),
          balance: Number(row.balance ?? 0),
          payment_history: normalizePaymentHistory(row.payment_history),
        })),
    }

    return jsonResponse({ overview })
  } catch (error) {
    console.error('Portal lookup failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to load portal overview' }, 503)
  }
}