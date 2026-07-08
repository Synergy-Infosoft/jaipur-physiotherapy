"use client";

import { useEffect, useMemo, useState } from 'react'
import { useForm, SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, Clock } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import * as dataService from '@/lib/dataService'
import { fallbackClinicSettings, formatTimeRange, getConsultationSlotError, getWorkingSlotsForDate, type PublicClinicSettings } from '@/lib/registration'
import type { Doctor } from '@/types'

const schema = z.object({
  full_name: z.string().min(2, 'Name required'),
  age: z.coerce.number().min(1).max(120),
  gender: z.enum(['male', 'female', 'other']),
  phone: z.string().regex(/^\d{10}$/, 'Enter 10-digit phone number'),
  father_name: z.string().max(120).optional(),
  chief_complaint: z.string().min(5, 'Please describe the complaint (min 5 chars)'),
  doctor_id: z.string().optional(),
  referral_source: z.string().optional(),
  visit_type: z.enum(['first_visit', 'follow_up']),
  payment_method: z.enum(['cash', 'online'], {
    error: 'Please select cash or online payment',
  }),
  consultation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  consultation_time: z.string().regex(/^\d{2}:\d{2}$/),
  address: z.string().optional(),
})

type FormData = z.infer<typeof schema>

function toDateInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function toTimeInputValue(date = new Date()) {
  return date.toTimeString().slice(0, 5)
}

const referralOptions = [
  { value: 'google', label: 'Google Search' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'friend_family', label: 'Friend or Family' },
  { value: 'doctor_referral', label: 'Doctor Referral' },
  { value: 'walk_in', label: 'Walk-in / Signboard' },
  { value: 'other', label: 'Other' },
]

interface AddVisitDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (visitId: string, tokenNumber: number, patientName: string) => void
  doctors: Doctor[]
}

export function AddVisitDialog({ isOpen, onClose, onSuccess, doctors }: AddVisitDialogProps) {
  const toast = useToast()
  const [settings, setSettings] = useState<PublicClinicSettings>(fallbackClinicSettings)
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      visit_type: 'first_visit',
      consultation_date: toDateInputValue(),
      consultation_time: toTimeInputValue(),
    },
  })

  const selectedDate = watch('consultation_date')
  const selectedTime = watch('consultation_time')
  const selectedDateSlots = useMemo(
    () => getWorkingSlotsForDate(settings, selectedDate),
    [settings, selectedDate]
  )
  const selectedScheduleText = selectedDateSlots.map(formatTimeRange).join(', ')
  const scheduleWarning = useMemo(
    () => getConsultationSlotError(settings, selectedDate, selectedTime, { enforceFuture: false }),
    [settings, selectedDate, selectedTime]
  )

  useEffect(() => {
    if (!isOpen) return

    let mounted = true
    dataService.getClinicSettings()
      .then((clinicSettings) => {
        if (mounted) setSettings(clinicSettings)
      })
      .catch(() => {
        if (mounted) setSettings(fallbackClinicSettings)
      })

    return () => {
      mounted = false
    }
  }, [isOpen])

  const handleFormSubmit: SubmitHandler<FormData> = async (data) => {
    const selectedSlotWarning = getConsultationSlotError(
      settings,
      data.consultation_date,
      data.consultation_time,
      { enforceFuture: false }
    )

    if (selectedSlotWarning) {
      const shouldContinue = window.confirm(`${selectedSlotWarning}\n\nContinue as staff override?`)
      if (!shouldContinue) return
    }

    try {
      const result = await dataService.selfRegister({
        full_name: data.full_name,
        age: data.age,
        gender: data.gender,
        phone: data.phone,
        chief_complaint: data.chief_complaint,
        doctor_id: data.doctor_id || undefined,
        address: data.address,
        father_name: data.father_name,
        referral_source: data.referral_source,
        visit_type: data.visit_type,
        payment_method: data.payment_method,
        consultation_date: data.consultation_date,
        consultation_time: data.consultation_time,
      })
      toast.success(`Patient registered - Token #${result.token_number}`)
      reset()
      onSuccess(result.visit_id, result.token_number, result.patient_name)
      onClose()
    } catch (err: any) {
      toast.error(err.message || 'Failed to register patient')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Patient Manually" size="lg">
      <form onSubmit={handleSubmit(handleFormSubmit)} className="p-6 space-y-4">
        <Input
          label="Full Name"
          required
          placeholder="Patient's full name"
          error={errors.full_name?.message}
          {...register('full_name')}
        />
        <Input
          label="Father's Name"
          placeholder="Optional"
          error={errors.father_name?.message}
          {...register('father_name')}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Age"
            type="number"
            required
            placeholder="e.g. 35"
            error={errors.age?.message}
            {...register('age')}
          />
          <Select
            label="Gender"
            required
            error={errors.gender?.message}
            options={[
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
              { value: 'other', label: 'Other' },
            ]}
            placeholder="Select"
            {...register('gender')}
          />
        </div>
        <Input
          label="Phone Number"
          type="tel"
          required
          placeholder="10-digit number"
          maxLength={10}
          error={errors.phone?.message}
          {...register('phone')}
        />
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Consultation Date"
              type="date"
              required
              error={errors.consultation_date?.message}
              {...register('consultation_date')}
            />
            <Input
              label="Consultation Time"
              type="time"
              required
              error={errors.consultation_time?.message}
              {...register('consultation_time')}
            />
          </div>
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              scheduleWarning
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-emerald-100 bg-emerald-50 text-emerald-800'
            }`}
          >
            <div className="flex items-start gap-2">
              {scheduleWarning ? (
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              ) : (
                <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" />
              )}
              <div>
                {selectedDateSlots.length > 0 ? (
                  <p>Configured schedule for this date: {selectedScheduleText}</p>
                ) : (
                  <p>The clinic is closed on this date in Settings.</p>
                )}
                {scheduleWarning && (
                  <p className="mt-1 font-medium">
                    {scheduleWarning} Staff can continue only as an intentional override.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
        <Select
          label="Visit Type"
          required
          options={[
            { value: 'first_visit', label: 'First-time visit' },
            { value: 'follow_up', label: 'Follow-up / repeat visit' },
          ]}
          error={errors.visit_type?.message}
          {...register('visit_type')}
        />
        <Select
          label="Payment Method"
          required
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'online', label: 'Online (UPI / Card)' },
          ]}
          placeholder="Select payment method"
          error={errors.payment_method?.message}
          {...register('payment_method')}
        />
        <Textarea
          label="Disease / Symptoms"
          required
          placeholder="Describe the reason for visit..."
          rows={2}
          error={errors.chief_complaint?.message}
          {...register('chief_complaint')}
        />
        <Select
          label="Assign Doctor"
          options={doctors
            .filter((d) => d.is_active)
            .map((d) => ({ value: d.id, label: `${d.name} - ${d.specialization || 'General'}` }))}
          placeholder="Any available doctor"
          error={errors.doctor_id?.message}
          {...register('doctor_id')}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="How did you hear about us?"
            options={referralOptions}
            placeholder="Select an option"
            error={errors.referral_source?.message}
            {...register('referral_source')}
          />
          <Input
            label="Address"
            placeholder="Optional"
            {...register('address')}
          />
        </div>
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} className="flex-1">
            Register & Assign Token
          </Button>
        </div>
      </form>
    </Modal>
  )
}
