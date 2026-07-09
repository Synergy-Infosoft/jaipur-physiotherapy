import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const closeCashShiftSchema = z.object({
  counted_cash: z.coerce.number().nonnegative('Counted cash must be zero or greater'),
  notes: z.string().trim().max(500).nullable().optional(),
})

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

async function requireAdminAccess() {
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
  if (!profile || !['admin', 'receptionist'].includes(profile.role)) {
    return { response: jsonResponse({ error: 'Billing access required' }, 403) }
  }

  return { admin, userId: user.id }
}

export async function GET() {
  try {
    const auth = await requireAdminAccess()
    if ('response' in auth && auth.response) return auth.response

    const admin = auth.admin
    const today = new Date().toISOString().slice(0, 10)

    const { data: history, error: historyError } = await admin
      .from('cash_reconciliations')
      .select('*, profiles(full_name)')
      .eq('shift_date', today)
      .order('created_at', { ascending: false })

    if (historyError) throw historyError

    const { data: paymentData, error: paymentError } = await admin
      .from('payment_transactions')
      .select('amount,payment_method')
      .eq('payment_method', 'cash')
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lt('created_at', `${today}T23:59:59.999Z`)

    if (paymentError) throw paymentError

    const systemCashTotal = (paymentData ?? []).reduce((sum, item) => sum + Number(item.amount), 0)
    const historyRows = (history ?? []) as Array<{
      id: string
      shift_date: string
      system_cash_total: number
      counted_cash: number
      variance: number
      notes: string | null
      closed_by: string | null
      created_at: string
      profiles?: { full_name?: string | null } | null
    }>

    return jsonResponse({
      shift_date: today,
      system_cash_total: Number(systemCashTotal.toFixed(2)),
      history: historyRows.map((record) => ({
        ...record,
        profiles: record.profiles ?? null,
      })),
    })
  } catch (error) {
    console.error('Failed to load cash reconciliation', error)
    return jsonResponse({ error: 'Unable to load cash reconciliation summary' }, 503)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminAccess()
    if ('response' in auth && auth.response) return auth.response

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body' }, 400)
    }

    const parsed = closeCashShiftSchema.safeParse(body)
    if (!parsed.success) {
      return jsonResponse({ error: 'Invalid reconciliation request', details: parsed.error.flatten().fieldErrors }, 400)
    }

    const admin = auth.admin
    const today = new Date().toISOString().slice(0, 10)

    const { data, error } = await admin.rpc('close_cash_shift_atomic', {
      p_counted_cash: parsed.data.counted_cash,
      p_notes: parsed.data.notes ?? null,
      p_closed_by: auth.userId,
      p_shift_date: today,
    })

    if (error) throw error

    const reconciliation = Array.isArray(data) ? data[0] : data
    return jsonResponse({ reconciliation: { ...reconciliation, profiles: null } }, 201)
  } catch (error) {
    console.error('Cash shift close failed', error)
    return jsonResponse({ error: 'Unable to close cash shift' }, 503)
  }
}
