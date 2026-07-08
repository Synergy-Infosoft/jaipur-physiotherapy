import { z } from 'zod'
import { defaultBrandTheme, normalizeBrandTheme } from './brandTheme'

export const referralSources = [
  'google',
  'youtube',
  'social_media',
  'friend_family',
  'doctor_referral',
  'walk_in',
  'other',
] as const

export const visitTypes = ['first_visit', 'follow_up'] as const

export const registrationPaymentMethods = ['cash', 'online'] as const

export const registrationSchema = z.object({
  full_name: z.string().trim().min(2, 'Please enter your full name').max(120),
  father_name: z.string().trim().max(120).optional(),
  age: z.coerce.number().int().min(1, 'Age must be at least 1').max(120, 'Please enter a valid age'),
  gender: z.enum(['male', 'female', 'other']),
  phone: z.string().transform((value) => value.replace(/\D/g, '')).pipe(
    z.string().regex(/^\d{10}$/, 'Please enter a valid 10-digit phone number')
  ),
  chief_complaint: z.string().trim().min(5, 'Please describe the reason for your visit').max(1000),
  doctor_id: z.union([z.string().uuid(), z.literal('')]).optional(),
  address: z.string().trim().max(500).optional(),
  referral_source: z.union([z.enum(referralSources), z.literal('')]).optional(),
  visit_type: z.enum(visitTypes),
  payment_method: z.enum(registrationPaymentMethods, {
    error: 'Please select cash or online payment',
  }),
  consultation_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Please select a consultation date')
    .refine(isDateInput, 'Please select a valid consultation date'),
  consultation_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Please select a consultation time')
    .refine(isTime, 'Please select a valid consultation time'),
})

export type RegistrationInput = z.input<typeof registrationSchema>

export interface WorkingHoursSlot {
  start: string
  end: string
}

export interface ClinicDaySchedule {
  day: number
  enabled: boolean
  slots: WorkingHoursSlot[]
}

export const defaultWorkingSchedule: ClinicDaySchedule[] = [
  { day: 1, enabled: true, slots: [{ start: '09:00', end: '18:00' }] },
  { day: 2, enabled: true, slots: [{ start: '09:00', end: '18:00' }] },
  { day: 3, enabled: true, slots: [{ start: '09:00', end: '18:00' }] },
  { day: 4, enabled: true, slots: [{ start: '09:00', end: '18:00' }] },
  { day: 5, enabled: true, slots: [{ start: '09:00', end: '18:00' }] },
  { day: 6, enabled: true, slots: [{ start: '09:00', end: '18:00' }] },
  { day: 0, enabled: false, slots: [] },
]

export const splitClinicScheduleExample: ClinicDaySchedule[] = [
  { day: 1, enabled: true, slots: [{ start: '08:00', end: '14:00' }, { start: '17:00', end: '21:00' }] },
  { day: 2, enabled: true, slots: [{ start: '08:00', end: '14:00' }, { start: '17:00', end: '21:00' }] },
  { day: 3, enabled: true, slots: [{ start: '08:00', end: '14:00' }, { start: '17:00', end: '21:00' }] },
  { day: 4, enabled: true, slots: [{ start: '08:00', end: '14:00' }, { start: '17:00', end: '21:00' }] },
  { day: 5, enabled: true, slots: [{ start: '08:00', end: '14:00' }, { start: '17:00', end: '21:00' }] },
  { day: 6, enabled: true, slots: [{ start: '08:00', end: '14:00' }, { start: '17:00', end: '21:00' }] },
  { day: 0, enabled: true, slots: [{ start: '09:00', end: '13:00' }] },
]

export function isTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false
  const [hour, minute] = value.split(':').map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

export function isDateInput(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function normalizeSlot(slot: unknown): WorkingHoursSlot | null {
  if (!slot || typeof slot !== 'object') return null
  const candidate = slot as Record<string, unknown>
  if (!isTime(candidate.start) || !isTime(candidate.end) || candidate.start >= candidate.end) return null
  return { start: candidate.start, end: candidate.end }
}

export function normalizeWorkingSchedule(
  value: unknown,
  fallbackDays: number[] = [1, 2, 3, 4, 5, 6],
  fallbackStart = '09:00',
  fallbackEnd = '18:00'
): ClinicDaySchedule[] {
  const byDay = new Map<number, ClinicDaySchedule>()

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const candidate = item as Record<string, unknown>
      const day = Number(candidate.day)
      if (!Number.isInteger(day) || day < 0 || day > 6) continue
      const slots = Array.isArray(candidate.slots)
        ? candidate.slots.map(normalizeSlot).filter((slot): slot is WorkingHoursSlot => Boolean(slot))
        : []
      byDay.set(day, {
        day,
        enabled: Boolean(candidate.enabled) && slots.length > 0,
        slots: slots.slice(0, 3).sort((a, b) => a.start.localeCompare(b.start)),
      })
    }
  }

  return [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const existing = byDay.get(day)
    if (existing) return existing
    const enabled = fallbackDays.includes(day) && isTime(fallbackStart) && isTime(fallbackEnd) && fallbackStart < fallbackEnd
    return {
      day,
      enabled,
      slots: enabled ? [{ start: fallbackStart, end: fallbackEnd }] : [],
    }
  })
}

export function formatTimeRange(slot: WorkingHoursSlot) {
  return `${formatTimeLabel(slot.start)} - ${formatTimeLabel(slot.end)}`
}

export function formatWorkingScheduleSummary(settings: PublicClinicSettings) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return settings.working_schedule
    .filter((day) => day.enabled && day.slots.length > 0)
    .map((day) => `${days[day.day]} ${day.slots.map(formatTimeRange).join(', ')}`)
    .join(' | ')
}

export interface PublicClinicSettings {
  clinic_name: string
  address: string
  phone: string
  doctor_name: string
  registration_number: string
  website_url: string
  logo_url: string
  theme_color: string
  theme_color_hover: string
  theme_color_light: string
  working_hours_start: string
  working_hours_end: string
  working_days: number[]
  working_schedule: ClinicDaySchedule[]
  timezone: string
}

export const fallbackClinicSettings: PublicClinicSettings = {
  clinic_name: 'ClinicFlow Medical Center',
  address: '',
  phone: '',
  doctor_name: 'Clinic Doctor',
  registration_number: '',
  website_url: '',
  ...defaultBrandTheme,
  working_hours_start: '09:00',
  working_hours_end: '18:00',
  working_days: [1, 2, 3, 4, 5, 6],
  working_schedule: defaultWorkingSchedule,
  timezone: 'Asia/Kolkata',
}

export function normalizeClinicBranding(settings: Partial<PublicClinicSettings> | null | undefined) {
  return normalizeBrandTheme(settings)
}

function getNormalizedSchedule(settings: PublicClinicSettings) {
  return normalizeWorkingSchedule(
    settings.working_schedule,
    settings.working_days,
    settings.working_hours_start.slice(0, 5),
    settings.working_hours_end.slice(0, 5)
  )
}

function toMinutes(time: string) {
  if (!isTime(time)) return null
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function fromMinutes(totalMinutes: number) {
  const hour = Math.floor(totalMinutes / 60)
  const minute = totalMinutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function getDayIndexFromDateInput(dateInput: string) {
  if (!isDateInput(dateInput)) return null
  const [year, month, day] = dateInput.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function getClinicDateTimeParts(settings: Pick<PublicClinicSettings, 'timezone'>, now = new Date()) {
  const timeZone = settings.timezone || fallbackClinicSettings.timezone
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour') || '00'}:${value('minute') || '00'}`,
  }
}

export function formatTimeLabel(time: string) {
  const minutes = toMinutes(time)
  if (minutes === null) return time
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
}

export function getWorkingSlotsForDate(settings: PublicClinicSettings, consultationDate: string) {
  const day = getDayIndexFromDateInput(consultationDate)
  if (day === null) return []

  const entry = getNormalizedSchedule(settings).find((item) => item.day === day)
  return entry?.enabled ? entry.slots : []
}

export function isConsultationSlotAvailable(
  settings: PublicClinicSettings,
  consultationDate: string,
  consultationTime: string
) {
  const selectedMinutes = toMinutes(consultationTime)
  if (!isDateInput(consultationDate) || selectedMinutes === null) return false

  return getWorkingSlotsForDate(settings, consultationDate).some((slot) => {
    const start = toMinutes(slot.start)
    const end = toMinutes(slot.end)
    return start !== null && end !== null && selectedMinutes >= start && selectedMinutes < end
  })
}

export function getAvailableConsultationTimes(
  settings: PublicClinicSettings,
  consultationDate: string,
  intervalMinutes = 15,
  options: { includePast?: boolean; now?: Date } = {}
) {
  if (!isDateInput(consultationDate) || intervalMinutes <= 0) return []

  const clinicNow = getClinicDateTimeParts(settings, options.now)
  const currentMinutes = toMinutes(clinicNow.time) ?? 0
  const times = new Set<string>()

  for (const slot of getWorkingSlotsForDate(settings, consultationDate)) {
    const start = toMinutes(slot.start)
    const end = toMinutes(slot.end)
    if (start === null || end === null) continue

    for (let minute = start; minute < end; minute += intervalMinutes) {
      if (!options.includePast && consultationDate === clinicNow.date && minute < currentMinutes) continue
      times.add(fromMinutes(minute))
    }
  }

  return [...times].sort()
}

export function getConsultationSlotError(
  settings: PublicClinicSettings,
  consultationDate: string,
  consultationTime: string,
  options: { enforceFuture?: boolean; now?: Date } = {}
) {
  if (!isDateInput(consultationDate)) return 'Please select a valid consultation date.'
  if (!isTime(consultationTime)) return 'Please select a valid consultation time.'

  if (options.enforceFuture !== false) {
    const clinicNow = getClinicDateTimeParts(settings, options.now)
    const selectedMinutes = toMinutes(consultationTime) ?? 0
    const currentMinutes = toMinutes(clinicNow.time) ?? 0

    if (consultationDate < clinicNow.date) {
      return 'Please select today or a future consultation date.'
    }

    if (consultationDate === clinicNow.date && selectedMinutes < currentMinutes) {
      return 'Please select a future consultation time.'
    }
  }

  const slots = getWorkingSlotsForDate(settings, consultationDate)
  if (slots.length === 0) {
    return 'The clinic is closed on the selected date. Please choose another date.'
  }

  if (!isConsultationSlotAvailable(settings, consultationDate, consultationTime)) {
    return `Please select a time within the clinic schedule for this date: ${slots.map(formatTimeRange).join(', ')}.`
  }

  return null
}

export function isClinicOpenNow(settings: PublicClinicSettings, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const weekday = parts.find((part) => part.type === 'weekday')?.value
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00'
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00'
  const weekdayIndex: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  const currentTime = `${hour}:${minute}`
  const day = weekday ? weekdayIndex[weekday] : undefined
  if (day === undefined) return false

  const today = getNormalizedSchedule(settings).find((entry) => entry.day === day)
  return Boolean(
    today?.enabled &&
      today.slots.some((slot) => currentTime >= slot.start && currentTime <= slot.end)
  )
}
