import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { WhatsAppNotificationStatus } from '@/types'

export const dynamic = 'force-dynamic'

interface MetaWebhookStatus {
  id?: string
  status?: string
  errors?: Array<{
    title?: string
    message?: string
    error_data?: {
      details?: string
    }
  }>
}

interface MetaWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: MetaWebhookStatus[]
      }
    }>
  }>
}

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function mapMetaStatus(status: string | undefined): WhatsAppNotificationStatus {
  if (status === 'failed') return 'failed'
  if (status === 'sent' || status === 'delivered' || status === 'read') return 'sent'
  return 'queued'
}

function getWebhookErrorMessage(status: MetaWebhookStatus) {
  const firstError = status.errors?.[0]
  return firstError?.error_data?.details || firstError?.message || firstError?.title || null
}

function extractStatuses(payload: MetaWebhookPayload) {
  return (payload.entry ?? [])
    .flatMap((entry) => entry.changes ?? [])
    .flatMap((change) => change.value?.statuses ?? [])
    .filter((status): status is MetaWebhookStatus & { id: string } => Boolean(status.id))
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode')
  const token = request.nextUrl.searchParams.get('hub.verify_token')
  const challenge = request.nextUrl.searchParams.get('hub.challenge')
  const verifyToken = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN

  if (mode === 'subscribe' && token && token === verifyToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return jsonResponse({ error: 'Webhook verification failed' }, 403)
}

export async function POST(request: NextRequest) {
  let payload: MetaWebhookPayload
  try {
    payload = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400)
  }

  const statuses = extractStatuses(payload)
  if (statuses.length === 0) {
    return jsonResponse({ received: true, updated: 0 })
  }

  const admin = createAdminClient()
  let updated = 0

  for (const status of statuses) {
    const nextStatus = mapMetaStatus(status.status)
    const { error } = await admin
      .from('whatsapp_notifications')
      .update({
        status: nextStatus,
        meta_message_id: status.id,
        error_message: nextStatus === 'failed' ? getWebhookErrorMessage(status) : null,
      })
      .eq('meta_message_id', status.id)

    if (error) {
      console.error('WhatsApp webhook status update failed', error.message)
      continue
    }

    updated += 1
  }

  return jsonResponse({ received: true, updated })
}
