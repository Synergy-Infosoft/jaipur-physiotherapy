import { describe, expect, it } from 'vitest'
import {
  fallbackClinicSettings,
  getAvailableConsultationTimes,
  getConsultationSlotError,
  isClinicOpenNow,
  isConsultationSlotAvailable,
  registrationSchema,
} from './registration'
import { calculateVariance, getVarianceTone } from './cashReconciliation'

describe('registrationSchema', () => {
  const validInput = {
    full_name: 'Asha Patel',
    age: 34,
    gender: 'female' as const,
    phone: '98765 43210',
    chief_complaint: 'Fever for two days',
    visit_type: 'first_visit' as const,
    payment_method: 'cash' as const,
    consultation_date: '2026-06-23',
    consultation_time: '10:30',
  }

  it('normalizes a valid Indian phone number', () => {
    const result = registrationSchema.parse(validInput)
    expect(result.phone).toBe('9876543210')
  })

  it('rejects invalid clinical registration input', () => {
    const result = registrationSchema.safeParse({
      ...validInput,
      age: 0,
      phone: '123',
      chief_complaint: '',
    })
    expect(result.success).toBe(false)
  })

  it('requires a payment method selection', () => {
    const result = registrationSchema.safeParse({
      ...validInput,
      payment_method: undefined,
    })

    expect(result.success).toBe(false)
  })

  it('rejects invalid calendar dates and times', () => {
    const result = registrationSchema.safeParse({
      ...validInput,
      consultation_date: '2026-02-31',
      consultation_time: '25:00',
    })
    expect(result.success).toBe(false)
  })
})

describe('cash reconciliation helpers', () => {
  it('calculates variance from counted and expected cash totals', () => {
    expect(calculateVariance(1500, 1450)).toBe(50)
    expect(calculateVariance(1400, 1450)).toBe(-50)
  })

  it('classifies variance tone for balanced and mismatched shifts', () => {
    expect(getVarianceTone(0)).toBe('balanced')
    expect(getVarianceTone(25)).toBe('positive')
    expect(getVarianceTone(-10)).toBe('negative')
  })
})

describe('isClinicOpenNow', () => {
  const settings = {
    ...fallbackClinicSettings,
    working_hours_start: '09:00',
    working_hours_end: '18:00',
    working_days: [1, 2, 3, 4, 5, 6],
  }

  it('uses the configured clinic timezone', () => {
    expect(isClinicOpenNow(settings, new Date('2026-06-23T06:30:00.000Z'))).toBe(true)
    expect(isClinicOpenNow(settings, new Date('2026-06-23T14:00:00.000Z'))).toBe(false)
  })

  it('closes between split clinic sessions', () => {
    const splitSettings = {
      ...settings,
      working_schedule: [
        { day: 2, enabled: true, slots: [{ start: '08:00', end: '14:00' }, { start: '17:00', end: '21:00' }] },
      ],
      working_days: [2],
    }

    expect(isClinicOpenNow(splitSettings, new Date('2026-06-23T05:00:00.000Z'))).toBe(true)
    expect(isClinicOpenNow(splitSettings, new Date('2026-06-23T09:30:00.000Z'))).toBe(false)
    expect(isClinicOpenNow(splitSettings, new Date('2026-06-23T13:30:00.000Z'))).toBe(true)
  })

  it('closes on excluded weekdays', () => {
    expect(isClinicOpenNow(settings, new Date('2026-06-21T06:30:00.000Z'))).toBe(false)
  })
})

describe('consultation slot validation', () => {
  const splitSettings = {
    ...fallbackClinicSettings,
    working_days: [2],
    working_schedule: [
      { day: 2, enabled: true, slots: [{ start: '08:00', end: '14:00' }, { start: '17:00', end: '21:00' }] },
    ],
  }

  it('accepts times inside split sessions and rejects gaps or closing time', () => {
    expect(isConsultationSlotAvailable(splitSettings, '2026-06-23', '10:30')).toBe(true)
    expect(isConsultationSlotAvailable(splitSettings, '2026-06-23', '15:00')).toBe(false)
    expect(isConsultationSlotAvailable(splitSettings, '2026-06-23', '18:30')).toBe(true)
    expect(isConsultationSlotAvailable(splitSettings, '2026-06-23', '21:00')).toBe(false)
  })

  it('generates selectable appointment times from dynamic settings', () => {
    const times = getAvailableConsultationTimes(splitSettings, '2026-06-23', 60, { includePast: true })
    expect(times).toEqual(['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '17:00', '18:00', '19:00', '20:00'])
  })

  it('returns helpful errors for closed days and outside working hours', () => {
    expect(getConsultationSlotError(splitSettings, '2026-06-24', '10:00', { enforceFuture: false })).toContain('closed')
    expect(getConsultationSlotError(splitSettings, '2026-06-23', '15:00', { enforceFuture: false })).toContain('clinic schedule')
  })

  it('rejects past public appointment slots in the clinic timezone', () => {
    const error = getConsultationSlotError(
      splitSettings,
      '2026-06-23',
      '08:00',
      { now: new Date('2026-06-23T04:00:00.000Z') }
    )
    expect(error).toContain('future consultation time')
  })
})
