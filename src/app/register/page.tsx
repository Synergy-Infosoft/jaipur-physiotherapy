"use client";

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Stethoscope, Shield, Clock, AlertCircle, ExternalLink, ChevronRight, ChevronLeft, Check, X } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { BrandLogo } from '@/components/shared/BrandLogo'
import * as dataService from '@/lib/dataService'
import { fallbackClinicSettings, formatTimeLabel, formatTimeRange, getAvailableConsultationTimes, getClinicDateTimeParts, getConsultationSlotError, getWorkingSlotsForDate, type PublicClinicSettings } from '@/lib/registration'
import type { Doctor } from '@/types'

const schema = z.object({
  full_name: z.string().min(2, 'Please enter your full name'),
  age: z.coerce.number().min(1, 'Age must be at least 1').max(120, 'Please enter a valid age'),
  gender: z.enum(['male', 'female', 'other']),
  phone: z.string().regex(/^\d{10}$/, 'Please enter a valid 10-digit phone number'),
  father_name: z.string().max(120).optional(),
  chief_complaint: z.string().min(5, 'Please describe your symptoms in at least 5 characters'),
  doctor_id: z.string().optional(),
  address: z.string().optional(),
  referral_source: z.string().optional(),
  visit_type: z.enum(['first_visit', 'follow_up']),
  payment_method: z.enum(['cash', 'online'], {
    error: 'Please select cash or online payment',
  }),
  consultation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please select a consultation date'),
  consultation_time: z.string().regex(/^\d{2}:\d{2}$/, 'Please select a consultation time'),
})

type FormStepType = 1 | 2 | 3
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

const STEPS = [
  { id: 1 as const, title: 'Basic details', hint: 'Patient info' },
  { id: 2 as const, title: 'Visit details', hint: 'Symptoms & doctor' },
  { id: 3 as const, title: 'Appointment', hint: 'Date & time' },
]


export default function RegisterPage() {
  const router = useRouter()
  const toast = useToast()
  const [currentStep, setCurrentStep] = useState<FormStepType>(1)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [clinicOpen, setClinicOpen] = useState(false)
  const [settings, setSettings] = useState<PublicClinicSettings>(fallbackClinicSettings)
  const [configLoading, setConfigLoading] = useState(true)
  const [showTimingsModal, setShowTimingsModal] = useState(false)
  const [appointmentReviewed, setAppointmentReviewed] = useState(false)
  const formCardRef = useRef<HTMLDivElement>(null)
  const scheduleRows = useMemo(() => {
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return settings.working_schedule
      .filter((day) => day.enabled && day.slots.length > 0)
      .map((day) => ({
        day: dayLabels[day.day] ?? 'Day',
        hours: day.slots.map(formatTimeRange),
      }))
  }, [settings.working_schedule])
  const websiteUrl = settings.website_url.trim()

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/public-config', { cache: 'no-store' })
        if (!response.ok) throw new Error('Unable to load clinic configuration')
        const config = await response.json()
        setDoctors(config.doctors ?? [])
        setSettings(config.settings ?? fallbackClinicSettings)
        setClinicOpen(Boolean(config.clinic_open))
      } catch {
        setDoctors([])
        setSettings(fallbackClinicSettings)
        setClinicOpen(false)
      } finally {
        setConfigLoading(false)
      }
    }
    load()
  }, [])

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    trigger,
  } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    mode: 'onChange',
    defaultValues: {
      visit_type: 'first_visit',
      consultation_date: toDateInputValue(),
      consultation_time: toTimeInputValue(),
    },
  })

  const selectedDate = watch('consultation_date')
  const selectedTime = watch('consultation_time')
  const clinicToday = useMemo(() => getClinicDateTimeParts(settings).date, [settings])
  const selectedDateSlots = useMemo(
    () => getWorkingSlotsForDate(settings, selectedDate),
    [settings, selectedDate]
  )
  const availableTimes = useMemo(
    () => getAvailableConsultationTimes(settings, selectedDate, 15),
    [settings, selectedDate]
  )
  const selectedDateScheduleText = selectedDateSlots.map(formatTimeRange).join(', ')
  const slotError = useMemo(() => {
    if (selectedTime) return getConsultationSlotError(settings, selectedDate, selectedTime)
    if (selectedDateSlots.length > 0 && availableTimes.length === 0) {
      return 'No future appointment slots are available for the selected date.'
    }
    return null
  }, [availableTimes.length, selectedDate, selectedDateSlots.length, selectedTime, settings])

  useEffect(() => {
    if (configLoading || !selectedDate) return

    if (selectedDate < clinicToday) {
      setValue('consultation_date', clinicToday, { shouldValidate: true })
      return
    }

    if (availableTimes.length === 0) {
      if (selectedTime) setValue('consultation_time', '', { shouldValidate: true })
      return
    }

    if (!availableTimes.includes(selectedTime)) {
      setValue('consultation_time', availableTimes[0], { shouldValidate: true })
    }
  }, [availableTimes, clinicToday, configLoading, selectedDate, selectedTime, setValue])

  const scrollToFormTop = () => {
    window.requestAnimationFrame(() => {
      const formCard = formCardRef.current
      if (!formCard) return

      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth'
      formCard.scrollIntoView({ behavior, block: 'start' })
    })
  }

  const goToStep = (step: FormStepType) => {
    if (step === 3) setAppointmentReviewed(false)
    setCurrentStep(step)
    scrollToFormTop()
  }

  const handleNextStep = async () => {
    let fieldsToValidate: (keyof FormData)[] = []

    if (currentStep === 1) {
      fieldsToValidate = ['full_name', 'age', 'gender', 'phone']
    } else if (currentStep === 2) {
      fieldsToValidate = ['visit_type', 'chief_complaint', 'payment_method']
    } else if (currentStep === 3) {
      fieldsToValidate = ['consultation_date', 'consultation_time']
    }

    const isValid = await trigger(fieldsToValidate)
    if (isValid && currentStep < STEPS.length) {
      goToStep((currentStep + 1) as FormStepType)
    }
  }

  const handlePrevStep = () => {
    if (currentStep > 1) {
      goToStep((currentStep - 1) as FormStepType)
    }
  }

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    if (currentStep !== 3 || !appointmentReviewed) {
      toast.error('Please review and select your appointment date or time before getting a token.')
      return
    }

    const selectedSlotError = getConsultationSlotError(settings, data.consultation_date, data.consultation_time)
    if (selectedSlotError) {
      toast.error(selectedSlotError)
      return
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
      if (result.duplicate_registration) {
        toast.info(`You are already registered today. Your token is #${result.token_number}.`)
      }
      router.replace(`/confirmation?ref=${encodeURIComponent(result.confirmation_ref)}`)
    } catch (err: any) {
      toast.error(err.message || 'Registration failed. Please try again.')
    }
  }

  const handleAppointmentReviewed = () => {
    setAppointmentReviewed(true)
  }

  const handleFinalSubmit = handleSubmit(onSubmit)


  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo
              logoUrl={settings.logo_url}
              label={`${settings.clinic_name} logo`}
              className="w-10 h-10 bg-[var(--primary)] rounded-xl overflow-hidden"
              fallback={<Stethoscope className="w-5 h-5 text-white" />}
            />
            <div>
              <h1 className="text-sm font-bold text-slate-900">{settings.clinic_name}</h1>
              <p className="text-xs text-slate-500">{settings.doctor_name}</p>
            </div>
          </div>
          <div
            className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 ${
              clinicOpen
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            <div
              className={`h-2.5 w-2.5 rounded-full ${
                clinicOpen
                  ? 'bg-emerald-500 pulse-dot'
                  : 'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.14)]'
              }`}
            />
            <span className="text-xs font-bold">{clinicOpen ? 'Reception live' : 'Closed now'}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 lg:py-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12 lg:items-start">
          {/* Left Side - Hero Content */}
          <div className="order-2 space-y-6 lg:sticky lg:top-24 lg:order-1">
            <div className="relative">
              <div className="absolute -top-4 -left-4 w-72 h-72 bg-[var(--primary-light)] rounded-3xl blur-3xl opacity-30"></div>
              <div className="relative overflow-hidden rounded-3xl bg-[var(--primary)] p-8 shadow-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-slate-950/65 via-slate-900/45 to-slate-950/25" />
                <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-white/15 blur-3xl" />
                <div className="relative space-y-4 text-white drop-shadow-sm">
                  <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/25 bg-white/15 px-4 py-2 backdrop-blur-md">
                    <Stethoscope className="w-4 h-4" />
                    <span className="text-sm font-medium">Professional Care</span>
                  </div>
                  <h3 className="max-w-xl text-3xl font-bold leading-tight text-white sm:text-4xl">Quality Healthcare at Your Convenience</h3>
                  <p className="max-w-lg text-base leading-7 text-white/95 sm:text-lg">
                    Quick online registration. Get your token and wait comfortably from home.
                  </p>
                  <div className="pt-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <Clock className="w-5 h-5 flex-shrink-0 mt-1" />
                      <div>
                        <p className="font-semibold text-sm">Fast Check-in</p>
                        <p className="text-sm text-white/90">Complete registration in under 2 minutes</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Shield className="w-5 h-5 flex-shrink-0 mt-1" />
                      <div>
                        <p className="font-semibold text-sm">Secure & Private</p>
                        <p className="text-sm text-white/90">Your data is encrypted and protected</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-1" />
                      <div>
                        <p className="font-semibold text-sm">No Waiting</p>
                        <p className="text-sm text-white/90">Get a token and visit when it{`'`}s ready</p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    {websiteUrl && (
                      <a
                        href={websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-white/35 bg-white/15 px-5 py-3 text-sm font-semibold text-white backdrop-blur-md transition-all hover:bg-white/25"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Visit Hospital Website
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowTimingsModal(true)}
                      className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-white/35 bg-white/15 px-5 py-3 text-sm font-semibold text-white backdrop-blur-md transition-all hover:bg-white/25"
                    >
                      <Clock className="h-4 w-4" />
                      View timings
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Right Side - Multi-Step Form */}
          <div className="order-1 lg:order-2">
            {/* Clinic closed banner */}
            {!clinicOpen && (
              <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                <div>
                  <p className="text-sm font-bold text-red-800">Reception is currently closed</p>
                  <p className="mt-0.5 text-xs leading-5 text-red-700">
                    You can still book any available future appointment slot.
                  </p>
                </div>
              </div>
            )}

            {/* Form Container */}
            <div ref={formCardRef} className="scroll-mt-24 rounded-3xl border border-slate-100 bg-white p-8 shadow-2xl">
              {/* Stepper */}
              <div className="mb-7 rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                <div className="grid grid-cols-3 gap-2">
                  {STEPS.map((step) => {
                    const isDone = currentStep > step.id
                    const isActive = currentStep === step.id
                    return (
                      <div
                        key={step.id}
                        className={`rounded-xl px-3 py-2.5 transition-all ${
                          isActive
                            ? 'bg-white shadow-sm ring-1 ring-[var(--primary)]/20'
                            : isDone
                              ? 'bg-emerald-50'
                              : 'bg-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-2 sm:justify-start">
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              isDone
                                ? 'bg-emerald-500 text-white'
                                : isActive
                                  ? 'bg-[var(--primary)] text-white'
                                  : 'bg-white text-slate-400 ring-1 ring-slate-200'
                            }`}
                          >
                            {isDone ? <Check className="h-3.5 w-3.5" /> : step.id}
                          </span>
                          <span className="hidden min-w-0 sm:block">
                            <span className={`block truncate text-xs font-bold ${isActive ? 'text-slate-900' : 'text-slate-500'}`}>
                              {step.title}
                            </span>
                            <span className="hidden truncate text-[11px] text-slate-400 sm:block">{step.hint}</span>
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-[var(--primary)] transition-all duration-300"
                    style={{ width: `${(currentStep / STEPS.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Form */}
              <form noValidate onSubmit={(event) => event.preventDefault()}>
                {/* STEP 1: Basic Details */}
                {currentStep === 1 && (
                  <div className="space-y-5 animate-fadeIn">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">Step 1 of 3</p>
                      <h3 className="mt-1 text-2xl font-bold text-slate-900">Basic details</h3>
                      <p className="text-slate-600 text-sm">Share the patient information reception needs to create your token.</p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Enter your full name"
                        autoComplete="name"
                        className={`w-full h-12 px-4 text-base border rounded-xl bg-slate-50 text-slate-900 placeholder:text-slate-400 transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] ${
                          errors.full_name ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-slate-300'
                        }`}
                        {...register('full_name')}
                      />
                      {errors.full_name && (
                        <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> {errors.full_name.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Father{`'`}s Name <span className="text-xs font-normal text-slate-500">(optional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Enter father's name"
                        autoComplete="additional-name"
                        className={`w-full h-12 px-4 text-base border rounded-xl bg-slate-50 text-slate-900 placeholder:text-slate-400 transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] ${
                          errors.father_name ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-slate-300'
                        }`}
                        {...register('father_name')}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                          Age <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          placeholder="e.g. 35"
                          inputMode="numeric"
                          className={`w-full h-12 px-4 text-base border rounded-xl bg-slate-50 text-slate-900 placeholder:text-slate-400 transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] ${
                            errors.age ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-slate-300'
                          }`}
                          {...register('age')}
                        />
                        {errors.age && <p className="mt-1.5 text-xs text-red-600">{errors.age.message}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                          Gender <span className="text-red-500">*</span>
                        </label>
                        <select
                          className={`w-full h-12 px-4 text-base border rounded-xl bg-slate-50 text-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] ${
                            errors.gender ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-slate-300'
                          }`}
                          {...register('gender')}
                        >
                          <option value="">Select</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Phone Number <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="tel"
                        placeholder="10-digit mobile number"
                        maxLength={10}
                        inputMode="numeric"
                        autoComplete="tel"
                        className={`w-full h-12 px-4 text-base border rounded-xl bg-slate-50 text-slate-900 placeholder:text-slate-400 transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] ${
                          errors.phone ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-slate-300'
                        }`}
                        {...register('phone')}
                      />
                      {errors.phone && (
                        <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> {errors.phone.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Address <span className="text-xs font-normal text-slate-500">(optional)</span>
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Your home address"
                        autoComplete="street-address"
                        className="w-full px-4 py-3 text-base border border-slate-200 rounded-xl bg-slate-50 text-slate-900 placeholder:text-slate-400 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] transition-all resize-none"
                        {...register('address')}
                      />
                    </div>
                  </div>
                )}

                {/* STEP 2: Visit Details */}
                {currentStep === 2 && (
                  <div className="space-y-5 animate-fadeIn">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">Step 2 of 3</p>
                      <h3 className="mt-1 text-2xl font-bold text-slate-900">Visit details</h3>
                      <p className="text-slate-600 text-sm">Tell us why you are visiting and choose a doctor if needed.</p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Visit Type <span className="text-red-500">*</span>
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                          { value: 'first_visit', label: 'First-time visit', description: 'New patient or new concern' },
                          { value: 'follow_up', label: 'Repeat / follow-up', description: 'Continuing treatment' },
                        ].map((option) => (
                          <label
                            key={option.value}
                            className="relative flex min-h-20 cursor-pointer flex-col justify-center rounded-xl border-2 border-slate-200 bg-slate-50 p-4 transition-all hover:border-[var(--primary)]/50 has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary-light)]"
                          >
                            <input
                              type="radio"
                              value={option.value}
                              className="sr-only"
                              {...register('visit_type')}
                            />
                            <span className="font-semibold text-slate-900">{option.label}</span>
                            <span className="mt-1 text-xs text-slate-500">{option.description}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Disease / symptoms <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        rows={4}
                        placeholder="Describe the disease or symptoms briefly..."
                        className={`w-full px-4 py-3 text-base border rounded-xl bg-slate-50 text-slate-900 placeholder:text-slate-400 transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] resize-none ${
                          errors.chief_complaint ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-slate-300'
                        }`}
                        {...register('chief_complaint')}
                      />
                      {errors.chief_complaint && (
                        <p className="mt-1.5 text-xs text-red-600">{errors.chief_complaint.message}</p>
                      )}
                    </div>

                    {doctors.length > 0 && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                          Doctor Preference <span className="text-xs font-normal text-slate-500">(optional)</span>
                        </label>
                        <select
                          className="w-full h-12 px-4 text-base border border-slate-200 rounded-xl bg-slate-50 text-slate-900 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] transition-all"
                          {...register('doctor_id')}
                        >
                          <option value="">Any available doctor</option>
                          {doctors.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} ? {d.specialization || 'General'}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-semibold text-slate-900 mb-2">
                        How did you hear about us? <span className="text-xs font-normal text-slate-500">(optional)</span>
                      </label>
                      <select
                        className="w-full h-12 px-4 text-base border border-slate-200 rounded-xl bg-slate-50 text-slate-900 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] transition-all"
                        {...register('referral_source')}
                      >
                        <option value="">Select an option</option>
                        {referralOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Payment Method <span className="text-red-500">*</span>
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                          { value: 'cash', label: 'Cash', description: 'Pay at reception' },
                          { value: 'online', label: 'Online', description: 'UPI / Card / Net Banking' },
                        ].map((option) => (
                          <label
                            key={option.value}
                            className="relative flex min-h-20 cursor-pointer flex-col justify-center rounded-xl border-2 border-slate-200 bg-slate-50 p-4 transition-all hover:border-[var(--primary)]/50 has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary-light)]"
                          >
                            <input
                              type="radio"
                              value={option.value}
                              className="sr-only"
                              {...register('payment_method')}
                            />
                            <span className="font-semibold text-slate-900">{option.label}</span>
                            <span className="mt-1 text-xs text-slate-500">{option.description}</span>
                          </label>
                        ))}
                      </div>
                      {errors.payment_method && (
                        <p className="mt-1.5 text-xs text-red-600">{errors.payment_method.message}</p>
                      )}
                    </div>
                  </div>
                )}
REPLACE

                {/* STEP 3: Appointment */}
                {currentStep === 3 && (
                  <div className="space-y-5 animate-fadeIn">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">Step 3 of 3</p>
                      <h3 className="mt-1 text-2xl font-bold text-slate-900">Appointment</h3>
                      <p className="text-slate-600 text-sm">Pick an available future date and time. Current reception status does not stop future booking.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                          Consultation Date <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          min={clinicToday}
                          className={`w-full h-12 px-4 text-base border rounded-xl bg-slate-50 text-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] ${
                            errors.consultation_date ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-slate-300'
                          }`}
                          {...register('consultation_date', { onChange: handleAppointmentReviewed })}
                        />
                        {errors.consultation_date && (
                          <p className="mt-1.5 text-xs text-red-600">{errors.consultation_date.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                          Consultation Time <span className="text-red-500">*</span>
                        </label>
                        <select
                          disabled={configLoading || availableTimes.length === 0}
                          className={`w-full h-12 px-4 text-base border rounded-xl bg-slate-50 text-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20 focus:border-[var(--primary)] disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed ${
                            errors.consultation_time || slotError ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-slate-300'
                          }`}
                          {...register('consultation_time', { onChange: handleAppointmentReviewed })}
                        >
                          <option value="">
                            {availableTimes.length === 0 ? 'No available time' : 'Select time'}
                          </option>
                          {availableTimes.map((time) => (
                            <option key={time} value={time}>
                              {formatTimeLabel(time)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div
                      className={`rounded-xl border px-4 py-3 text-sm transition-all ${
                        slotError
                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                          : selectedDateSlots.length > 0
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      {selectedDateSlots.length > 0 ? (
                        <p className="font-semibold">Available on selected date: {selectedDateScheduleText}</p>
                      ) : (
                        <p className="font-semibold">Clinic is closed on this date. Choose another day.</p>
                      )}
                      {slotError && <p className="mt-1 font-semibold">{slotError}</p>}
                    </div>

                    {!appointmentReviewed && (
                      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
                        Please review or change the appointment date/time once before getting your token.
                      </div>
                    )}

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
                      <Shield className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-emerald-900">Secure registration</p>
                        <p className="text-xs text-emerald-800 mt-0.5">
                          Your details go directly to reception. You will receive your token after submitting this form.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Navigation Buttons */}
                <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
                  <div className="min-w-0">
                    {currentStep > 1 ? (
                      <button
                        type="button"
                        onClick={handlePrevStep}
                        className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-95"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Back
                      </button>
                    ) : (
                      <p className="text-xs font-medium text-slate-500">Step {currentStep} of {STEPS.length}</p>
                    )}
                  </div>

                  {currentStep < STEPS.length ? (
                    <button
                      type="button"
                      onClick={handleNextStep}
                      className="inline-flex h-11 min-w-32 items-center justify-center gap-2 rounded-full bg-[var(--primary)] px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[var(--primary-hover)] active:scale-95"
                    >
                      Continue <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleFinalSubmit}
                      disabled={isSubmitting || configLoading || availableTimes.length === 0 || Boolean(slotError) || !appointmentReviewed}
                      className="inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-bold text-white shadow-sm transition-all hover:bg-emerald-700 disabled:opacity-60 disabled:hover:bg-emerald-600 active:scale-95"
                    >
                      {isSubmitting ? (
                        <>
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Registering...
                        </>
                      ) : (
                        <>
                          Get token <Check className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              </form>

              {/* Footer */}
              <p className="mt-5 text-center text-xs text-slate-500">
                Need help? Please contact reception during clinic hours.
              </p>
            </div>
            </div>
          </div>
        </div>


      {showTimingsModal && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clinic-timings-title"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 id="clinic-timings-title" className="text-sm font-bold text-slate-900">Clinic timings</h2>
                <p className="text-xs text-slate-500">Available registration slots</p>
              </div>
              <button
                type="button"
                onClick={() => setShowTimingsModal(false)}
                aria-label="Close timings"
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[70dvh] overflow-y-auto p-3">
              {scheduleRows.length > 0 ? (
                <div className="grid gap-2">
                  {scheduleRows.map((row) => (
                    <div key={row.day} className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                      <span className="w-10 shrink-0 text-sm font-bold text-slate-900">{row.day}</span>
                      <span className="text-sm font-semibold leading-6 text-slate-700">{row.hours.join(' / ')}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700">Contact reception for timings.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
    </div>
  )
}
