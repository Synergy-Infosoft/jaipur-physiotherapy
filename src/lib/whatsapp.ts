import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'
import type { WhatsAppNotificationStatus, WhatsAppNotificationType } from '@/types'

type WhatsAppNotificationInsert = Database['public']['Tables']['whatsapp_notifications']['Insert']

interface SendWhatsAppNotificationInput {
  patientId: string
  notificationType: WhatsAppNotificationType
  templateName: string | undefined
  payload: Record<string, unknown>
  bodyParameters: Array<string | number | null | undefined>
  buttonUrlParameter?: string | number | null | undefined
  languageCode?: string
}

interface MetaWhatsAppResponse {
  messages?: Array<{ id?: string }>
  error?: {
    message?: string
    error_user_msg?: string
    type?: string
    code?: number
  }
}

export interface SendWhatsAppNotificationResult {
  notificationId: string | null
  status: WhatsAppNotificationStatus
  metaMessageId: string | null
  errorMessage: string | null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown WhatsApp send error'
}

function formatPhoneForWhatsApp(phone: string | null | undefined) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`
  if (digits.length >= 11 && digits.length <= 15) return digits
  return null
}

function getTemplateLanguage(languageCode?: string) {
  return languageCode || process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en'
}

function buildTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParameters: Array<string | number | null | undefined>,
  buttonUrlParameter?: string | number | null | undefined
) {
  const components: Array<{
    type: string
    sub_type?: string
    index?: string
    parameters: Array<{ type: 'text'; text: string }>
  }> = []

  if (bodyParameters.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParameters.map((value) => ({
        type: 'text',
        text: String(value ?? ''),
      })),
    })
  }

  if (buttonUrlParameter !== null && buttonUrlParameter !== undefined && String(buttonUrlParameter).trim()) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{
        type: 'text',
        text: String(buttonUrlParameter),
      }],
    })
  }

  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  }
}

async function sendMetaTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParameters: Array<string | number | null | undefined>,
  buttonUrlParameter?: string | number | null | undefined
) {
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID

  if (!accessToken || !phoneNumberId) {
    throw new Error('WhatsApp API credentials are not configured')
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildTemplateMessage(to, templateName, languageCode, bodyParameters, buttonUrlParameter)),
  })

  const body = await response.json().catch(() => ({})) as MetaWhatsAppResponse
  if (!response.ok) {
    throw new Error(
      body.error?.error_user_msg ||
      body.error?.message ||
      `WhatsApp API request failed with ${response.status}`
    )
  }

  return {
    metaMessageId: body.messages?.[0]?.id ?? null,
    response: body,
  }
}

export async function sendWhatsAppNotification(
  input: SendWhatsAppNotificationInput
): Promise<SendWhatsAppNotificationResult> {
  const admin = createAdminClient()
  const payload = {
    ...input.payload,
    whatsapp_template_name: input.templateName ?? null,
    whatsapp_button_url_parameter: input.buttonUrlParameter ?? null,
  }

  const insertPayload: WhatsAppNotificationInsert = {
    patient_id: input.patientId,
    notification_type: input.notificationType,
    payload: payload as WhatsAppNotificationInsert['payload'],
    status: 'queued',
  }

  const { data: notification, error: insertError } = await admin
    .from('whatsapp_notifications')
    .insert(insertPayload)
    .select('id')
    .single()

  if (insertError || !notification) {
    console.error('WhatsApp notification log insert failed', insertError?.message)
    return {
      notificationId: null,
      status: 'failed',
      metaMessageId: null,
      errorMessage: insertError?.message ?? 'Unable to create WhatsApp notification log',
    }
  }

  const notificationId = notification.id

  try {
    if (!input.templateName) {
      throw new Error('WhatsApp template name is not configured')
    }

    const { data: patient, error: patientError } = await admin
      .from('patients')
      .select('phone')
      .eq('id', input.patientId)
      .single()

    if (patientError) throw patientError

    const to = formatPhoneForWhatsApp(patient?.phone)
    if (!to) throw new Error('Patient phone number is not valid for WhatsApp')

    const result = await sendMetaTemplateMessage(
      to,
      input.templateName,
      getTemplateLanguage(input.languageCode),
      input.bodyParameters,
      input.buttonUrlParameter
    )

    await admin
      .from('whatsapp_notifications')
      .update({
        status: 'sent',
        meta_message_id: result.metaMessageId,
        error_message: null,
      })
      .eq('id', notificationId)

    return {
      notificationId,
      status: 'sent',
      metaMessageId: result.metaMessageId,
      errorMessage: null,
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error)

    await admin
      .from('whatsapp_notifications')
      .update({
        status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', notificationId)

    console.error('WhatsApp notification send failed', errorMessage)
    return {
      notificationId,
      status: 'failed',
      metaMessageId: null,
      errorMessage,
    }
  }
}
