import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const staffRoles = ['receptionist', 'doctor', 'therapist'] as const

const createStaffSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name is required').max(80),
  email: z.string().trim().email('Enter a valid email').max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  role: z.enum(staffRoles),
})

const deleteStaffSchema = z.string().uuid()

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

async function requireAdmin() {
  const userClient = await createClient()
  const { data: { user }, error: userError } = await userClient.auth.getUser()

  if (userError || !user) {
    return { admin: null, userId: null, response: jsonResponse({ error: 'Authentication required' }, 401) }
  }

  const admin = createAdminClient()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) throw profileError

  if (profile?.role !== 'admin') {
    return { admin: null, userId: user.id, response: jsonResponse({ error: 'Admin access required' }, 403) }
  }

  return { admin, userId: user.id, response: null }
}

export async function GET() {
  try {
    const auth = await requireAdmin()
    if (auth.response) return auth.response

    const admin = auth.admin
    if (!admin) return jsonResponse({ error: 'Admin access required' }, 403)

    const [{ data: profiles, error: profilesError }, { data: usersData, error: usersError }] = await Promise.all([
      admin
        .from('profiles')
        .select('id, full_name, role, created_at')
        .in('role', ['admin', ...staffRoles])
        .order('created_at', { ascending: false }),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ])

    if (profilesError) throw profilesError
    if (usersError) throw usersError

    const emailById = new Map((usersData.users ?? []).map((user) => [user.id, user.email ?? null]))
    const staff = (profiles ?? []).map((profile) => ({
      ...profile,
      email: emailById.get(profile.id) ?? null,
    }))

    return jsonResponse({ staff })
  } catch (error) {
    console.error('Staff users load failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to load staff users' }, 503)
  }
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

  const parsed = createStaffSchema.safeParse(body)
  if (!parsed.success) {
    return jsonResponse({ error: 'Please correct the highlighted fields', details: parsed.error.flatten().fieldErrors }, 400)
  }

  try {
    const auth = await requireAdmin()
    if (auth.response) return auth.response

    const admin = auth.admin
    if (!admin) return jsonResponse({ error: 'Admin access required' }, 403)

    const input = parsed.data
    const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
      app_metadata: { role: input.role },
    })

    if (createError) {
      if (createError.status === 422 || /already|exists|registered/i.test(createError.message)) {
        return jsonResponse({ error: 'A staff user with this email already exists' }, 409)
      }
      throw createError
    }

    const userId = createdUser.user?.id
    if (!userId) throw new Error('Supabase did not return a created user id')

    const { error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: userId,
        full_name: input.full_name,
        role: input.role,
      }, { onConflict: 'id' })

    if (profileError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(userId)
      if (cleanupError) {
        console.error('Created auth user cleanup failed', cleanupError.message)
      }
      throw profileError
    }

    return jsonResponse({
      staff: {
        id: userId,
        full_name: input.full_name,
        role: input.role,
        email: input.email,
        created_at: new Date().toISOString(),
      },
    }, 201)
  } catch (error) {
    console.error('Staff user creation failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to create staff user' }, 503)
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return jsonResponse({ error: 'Invalid request origin' }, 403)
  }

  const parsed = deleteStaffSchema.safeParse(request.nextUrl.searchParams.get('id'))
  if (!parsed.success) {
    return jsonResponse({ error: 'Invalid staff user id' }, 400)
  }

  try {
    const auth = await requireAdmin()
    if (auth.response) return auth.response

    const admin = auth.admin
    if (!admin || !auth.userId) return jsonResponse({ error: 'Admin access required' }, 403)

    const targetUserId = parsed.data
    if (targetUserId === auth.userId) {
      return jsonResponse({ error: 'You cannot delete the account you are currently using' }, 409)
    }

    const { data: targetProfile, error: targetProfileError } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', targetUserId)
      .maybeSingle()

    if (targetProfileError) throw targetProfileError
    if (!targetProfile) {
      return jsonResponse({ error: 'Staff user not found' }, 404)
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId)
    if (deleteError) throw deleteError

    return jsonResponse({ deleted_id: targetUserId })
  } catch (error) {
    console.error('Staff user deletion failed', error instanceof Error ? error.message : 'Unknown error')
    return jsonResponse({ error: 'Unable to delete staff user' }, 503)
  }
}
