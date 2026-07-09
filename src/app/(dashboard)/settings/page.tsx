"use client";

import { useEffect, useMemo, useState } from 'react'
import {
  Building2,
  Check,
  Clock,
  Image as ImageIcon,
  Palette,
  Plus,
  Power,
  Save,
  ShieldAlert,
  Stethoscope,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { BrandLogo } from '@/components/shared/BrandLogo'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { useBranding } from '@/context/BrandingContext'
import { defaultWorkingSchedule, splitClinicScheduleExample } from '@/lib/registration'
import {
  defaultBrandTheme,
  deriveHoverColor,
  deriveLightColor,
  normalizeBrandTheme,
  normalizeHexColor,
} from '@/lib/brandTheme'
import * as dataService from '@/lib/dataService'
import type { ClinicDaySchedule, ClinicSettings, Doctor, UserRole } from '@/types'

const dayOptions = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 0, label: 'Sunday', short: 'Sun' },
]

const timezoneOptions = [
  { value: 'Asia/Kolkata', label: 'India - Asia/Kolkata' },
  { value: 'Asia/Dubai', label: 'UAE - Asia/Dubai' },
  { value: 'Asia/Singapore', label: 'Singapore - Asia/Singapore' },
  { value: 'UTC', label: 'UTC' },
]

const themePresets = [
  { name: 'Clinic Green', color: '#1D9E75' },
  { name: 'Royal Blue', color: '#2563EB' },
  { name: 'Indigo Care', color: '#4F46E5' },
  { name: 'Teal Wellness', color: '#0D9488' },
  { name: 'Rose Clinic', color: '#E11D48' },
  { name: 'Amber Dental', color: '#D97706' },
]

const settingsSections = [
  { id: 'branding', label: 'Branding', description: 'Logo and colors', icon: Palette },
  { id: 'clinic', label: 'Clinic Profile', description: 'Name, phone, address', icon: Building2 },
  { id: 'staff', label: 'Staff Users', description: 'Secure login accounts', icon: UserPlus },
  { id: 'doctors', label: 'Doctor List', description: 'Shown on registration', icon: Users },
  { id: 'hours', label: 'Registration Hours', description: 'Open days and slots', icon: Clock },
] as const

type SettingsSectionId = (typeof settingsSections)[number]['id']
type StaffCreatableRole = Extract<UserRole, 'receptionist' | 'doctor' | 'therapist'>

const staffRoleOptions: { value: StaffCreatableRole; label: string }[] = [
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'doctor', label: 'Doctor' },
  { value: 'therapist', label: 'Therapist' },
]

const emptySettings: ClinicSettings = {
  clinic_name: '',
  address: '',
  phone: '',
  doctor_name: '',
  registration_number: '',
  website_url: '',
  ...defaultBrandTheme,
  working_hours_start: '09:00',
  working_hours_end: '18:00',
  working_days: [1, 2, 3, 4, 5, 6],
  working_schedule: defaultWorkingSchedule,
  timezone: 'Asia/Kolkata',
}

function cloneSchedule(schedule: ClinicDaySchedule[]) {
  return schedule.map((day) => ({
    ...day,
    slots: day.slots.map((slot) => ({ ...slot })),
  }))
}

function getDoctorSubtitle(doctor: Doctor) {
  return doctor.specialization?.trim() || 'General'
}

function getDoctorDeleteErrorMessage(error: unknown) {
  const errorRecord = error as { code?: unknown; message?: unknown; details?: unknown }
  const code = typeof errorRecord?.code === 'string' ? errorRecord.code : ''
  const message = [
    typeof errorRecord?.message === 'string' ? errorRecord.message : '',
    typeof errorRecord?.details === 'string' ? errorRecord.details : '',
  ].join(' ')

  if (code === '23503' || /foreign key|still referenced|violates foreign key/i.test(message)) {
    return 'This doctor has visit history. Use Hide instead to remove them from registration while preserving records.'
  }

  return 'Unable to delete doctor'
}

function isValidClinicWebsiteUrl(value: string) {
  if (!value.trim()) return true
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && Boolean(url.hostname.includes('.'))
  } catch {
    return false
  }
}

function formatStaffCreatedAt(value: string | null | undefined) {
  if (!value) return 'Recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function getRoleLabel(role: UserRole) {
  if (role === 'admin') return 'Admin'
  if (role === 'doctor') return 'Doctor'
  if (role === 'therapist') return 'Therapist'
  if (role === 'follow_up_agent') return 'Follow-up agent'
  return 'Receptionist'
}

function getRoleBadgeClass(role: UserRole) {
  if (role === 'admin') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (role === 'doctor') return 'bg-violet-50 text-violet-700 border-violet-200'
  if (role === 'therapist') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (role === 'follow_up_agent') return 'bg-cyan-50 text-cyan-700 border-cyan-200'
  return 'bg-blue-50 text-blue-700 border-blue-200'
}

export default function SettingsPage() {
  const toast = useToast()
  const { profile, loading: authLoading } = useAuth()
  const { refreshBranding, setThemeOverride } = useBranding()
  const [settings, setSettings] = useState<ClinicSettings>(emptySettings)
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [staffUsers, setStaffUsers] = useState<dataService.StaffUser[]>([])
  const [newDoctor, setNewDoctor] = useState({ name: '', specialization: '' })
  const [newStaffUser, setNewStaffUser] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'receptionist' as StaffCreatableRole,
  })
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('branding')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addingDoctor, setAddingDoctor] = useState(false)
  const [creatingStaffUser, setCreatingStaffUser] = useState(false)
  const [deletingStaffUserId, setDeletingStaffUserId] = useState<string | null>(null)
  const [savingDoctorId, setSavingDoctorId] = useState<string | null>(null)

  const brandPreview = useMemo(() => normalizeBrandTheme(settings), [settings])
  const activeDoctors = doctors.filter((doctor) => doctor.is_active)

  useEffect(() => {
    if (loading || authLoading) return
    setThemeOverride?.(brandPreview)
    return () => {
      setThemeOverride?.(null)
    }
  }, [authLoading, brandPreview, loading, setThemeOverride])

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [clinicSettings, doctorList, staffList] = await Promise.all([
          dataService.getClinicSettings(),
          dataService.getAllDoctors(),
          dataService.getStaffUsers(),
        ])
        setSettings(clinicSettings)
        setDoctors(doctorList)
        setStaffUsers(staffList)
      } catch (error) {
        console.error('Failed to load settings:', error)
        toast.error('Unable to load settings')
      } finally {
        setLoading(false)
      }
    }

    if (!authLoading && profile?.role === 'admin') {
      loadSettings()
    } else if (!authLoading && profile?.role && profile.role !== 'admin') {
      setLoading(false)
    }
  }, [authLoading, profile?.role, toast])

  const updateField = <K extends keyof ClinicSettings>(key: K, value: ClinicSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const updatePrimaryTheme = (color: string) => {
    const primary = normalizeHexColor(color, defaultBrandTheme.theme_color)
    setSettings((current) => ({
      ...current,
      theme_color: primary,
      theme_color_hover: deriveHoverColor(primary),
      theme_color_light: deriveLightColor(primary),
    }))
  }

  const applyThemePreset = (color: string) => {
    updatePrimaryTheme(color)
    toast.info('Theme preset applied. Save settings to publish it.')
  }

  const resetBranding = () => {
    setSettings((current) => ({ ...current, ...defaultBrandTheme }))
    toast.info('Default branding restored. Save settings to publish it.')
  }

  const updateSchedule = (updater: (schedule: ClinicDaySchedule[]) => ClinicDaySchedule[]) => {
    setSettings((current) => {
      const working_schedule = updater(cloneSchedule(current.working_schedule))
      return {
        ...current,
        working_schedule,
        working_days: working_schedule.filter((day) => day.enabled).map((day) => day.day),
        working_hours_start: working_schedule.find((day) => day.enabled)?.slots[0]?.start ?? current.working_hours_start,
        working_hours_end: working_schedule.find((day) => day.enabled)?.slots[0]?.end ?? current.working_hours_end,
      }
    })
  }

  const toggleDay = (day: number) => {
    updateSchedule((schedule) => schedule.map((entry) => {
      if (entry.day !== day) return entry
      const enabled = !entry.enabled
      return {
        ...entry,
        enabled,
        slots: enabled && entry.slots.length === 0 ? [{ start: '09:00', end: '18:00' }] : entry.slots,
      }
    }))
  }

  const updateSlot = (day: number, index: number, key: 'start' | 'end', value: string) => {
    updateSchedule((schedule) => schedule.map((entry) => {
      if (entry.day !== day) return entry
      return {
        ...entry,
        slots: entry.slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, [key]: value } : slot),
      }
    }))
  }

  const addSlot = (day: number) => {
    updateSchedule((schedule) => schedule.map((entry) => {
      if (entry.day !== day || entry.slots.length >= 3) return entry
      return {
        ...entry,
        enabled: true,
        slots: [...entry.slots, { start: '17:00', end: '21:00' }],
      }
    }))
  }

  const removeSlot = (day: number, index: number) => {
    updateSchedule((schedule) => schedule.map((entry) => {
      if (entry.day !== day) return entry
      const slots = entry.slots.filter((_, slotIndex) => slotIndex !== index)
      return { ...entry, enabled: slots.length > 0 && entry.enabled, slots }
    }))
  }

  const applySplitSchedule = () => {
    updateSchedule(() => cloneSchedule(splitClinicScheduleExample))
    toast.info('Applied split morning/evening schedule')
  }

  const handleSave = async () => {
    if (!settings.clinic_name.trim()) {
      toast.error('Clinic name is required')
      setActiveSection('clinic')
      return
    }

    if (settings.logo_url.trim() && !/^(https?:\/\/|\/)/i.test(settings.logo_url.trim())) {
      toast.error('Logo URL must start with https://, http://, or /')
      setActiveSection('branding')
      return
    }

    if (!isValidClinicWebsiteUrl(settings.website_url)) {
      toast.error('Website URL must be a valid https:// address')
      setActiveSection('clinic')
      return
    }

    const normalizedTheme = normalizeBrandTheme(settings)
    const enabledDays = settings.working_schedule.filter((day) => day.enabled)
    if (enabledDays.length === 0) {
      toast.error('Select at least one working day')
      setActiveSection('hours')
      return
    }

    for (const day of enabledDays) {
      if (day.slots.length === 0) {
        toast.error('Every enabled day needs at least one time slot')
        setActiveSection('hours')
        return
      }
      for (const slot of day.slots) {
        if (!slot.start || !slot.end || slot.start >= slot.end) {
          toast.error('Each time slot must have a valid start and end time')
          setActiveSection('hours')
          return
        }
      }
    }

    setSaving(true)
    try {
      const updated = await dataService.updateClinicSettings({ ...settings, ...normalizedTheme })
      setSettings(updated)
      await refreshBranding()
      toast.success('Clinic settings saved')
    } catch (error) {
      console.error('Failed to save clinic settings:', error)
      toast.error('Unable to save settings. Please check admin permissions.')
    } finally {
      setSaving(false)
    }
  }

  const refreshDoctors = async () => {
    const doctorList = await dataService.getAllDoctors()
    setDoctors(doctorList)
  }

  const refreshStaffUsers = async () => {
    const staffList = await dataService.getStaffUsers()
    setStaffUsers(staffList)
  }

  const createStaffUser = async () => {
    const fullName = newStaffUser.full_name.trim()
    const email = newStaffUser.email.trim().toLowerCase()

    if (fullName.length < 2) {
      toast.error('Staff name is required')
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid staff email')
      return
    }

    if (newStaffUser.password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }

    setCreatingStaffUser(true)
    try {
      await dataService.createStaffUser({
        full_name: fullName,
        email,
        password: newStaffUser.password,
        role: newStaffUser.role,
      })
      setNewStaffUser({
        full_name: '',
        email: '',
        password: '',
        role: 'receptionist',
      })
      await refreshStaffUsers()
      toast.success('Staff login created')
    } catch (error) {
      console.error('Failed to create staff user:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to create staff user')
    } finally {
      setCreatingStaffUser(false)
    }
  }

  const deleteStaffUser = async (staff: dataService.StaffUser) => {
    if (staff.id === profile?.id) {
      toast.error('You cannot delete the account you are currently using')
      return
    }

    const confirmed = window.confirm(
      `Delete ${staff.full_name}'s login account?\n\nThis removes their Supabase Auth user and profile. They will no longer be able to sign in. This cannot be undone.`
    )
    if (!confirmed) return

    setDeletingStaffUserId(staff.id)
    try {
      await dataService.deleteStaffUser(staff.id)
      await refreshStaffUsers()
      toast.success('Staff user deleted')
    } catch (error) {
      console.error('Failed to delete staff user:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to delete staff user')
    } finally {
      setDeletingStaffUserId(null)
    }
  }

  const addDoctor = async () => {
    const name = newDoctor.name.trim()
    if (name.length < 2) {
      toast.error('Doctor name is required')
      return
    }

    setAddingDoctor(true)
    try {
      await dataService.createDoctor({
        name,
        specialization: newDoctor.specialization.trim() || null,
        is_active: true,
      })
      setNewDoctor({ name: '', specialization: '' })
      await refreshDoctors()
      toast.success('Doctor added')
    } catch (error) {
      console.error('Failed to add doctor:', error)
      toast.error('Unable to add doctor')
    } finally {
      setAddingDoctor(false)
    }
  }

  const updateDoctorField = <K extends keyof Doctor>(id: string, key: K, value: Doctor[K]) => {
    setDoctors((current) => current.map((doctor) => (
      doctor.id === id ? { ...doctor, [key]: value } : doctor
    )))
  }

  const saveDoctor = async (doctor: Doctor) => {
    const name = doctor.name.trim()
    if (name.length < 2) {
      toast.error('Doctor name is required')
      return
    }

    setSavingDoctorId(doctor.id)
    try {
      await dataService.updateDoctor(doctor.id, {
        name,
        specialization: doctor.specialization?.trim() || null,
        is_active: doctor.is_active,
      })
      await refreshDoctors()
      toast.success('Doctor updated')
    } catch (error) {
      console.error('Failed to update doctor:', error)
      toast.error('Unable to update doctor')
    } finally {
      setSavingDoctorId(null)
    }
  }

  const toggleDoctorActive = async (doctor: Doctor) => {
    setSavingDoctorId(doctor.id)
    try {
      await dataService.updateDoctor(doctor.id, { is_active: !doctor.is_active })
      await refreshDoctors()
      toast.success(!doctor.is_active ? 'Doctor activated' : 'Doctor hidden from registration')
    } catch (error) {
      console.error('Failed to update doctor status:', error)
      toast.error('Unable to update doctor status')
    } finally {
      setSavingDoctorId(null)
    }
  }

  const deleteDoctor = async (doctor: Doctor) => {
    const confirmed = window.confirm(
      `Delete ${doctor.name} permanently?\n\nThis cannot be undone. If this doctor has visit history, deletion will be blocked and you can use Hide instead.`
    )
    if (!confirmed) return

    setSavingDoctorId(doctor.id)
    try {
      await dataService.deleteDoctor(doctor.id)
      await refreshDoctors()
      toast.success('Doctor deleted')
    } catch (error) {
      console.error('Failed to delete doctor:', error)
      toast.error(getDoctorDeleteErrorMessage(error))
    } finally {
      setSavingDoctorId(null)
    }
  }

  if (!authLoading && profile?.role !== 'admin') {
    return (
      <DashboardLayout>
        <div className="p-4 md:p-6">
          <div className="card p-8 text-center max-w-xl mx-auto mt-10">
            <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-slate-900 mb-2">Admin access required</h1>
            <p className="text-sm text-slate-500">
              Clinic settings can only be changed by an administrator.
            </p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <PageHeader
          title="Settings"
          description="Configure tenant branding, clinic profile, doctors, and public registration hours."
          actions={
            <Button onClick={handleSave} loading={saving} disabled={loading || authLoading} size="sm">
              <Save className="w-4 h-4" />
              Save Settings
            </Button>
          }
        />

        {loading || authLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
            <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
              <div className="card p-3">
                <div className="space-y-1">
                  {settingsSections.map(({ id, label, description, icon: Icon }) => {
                    const active = activeSection === id
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setActiveSection(id)}
                        className={`w-full min-h-14 rounded-xl px-3 py-2 text-left transition-colors flex items-center gap-3 ${
                          active
                            ? 'bg-[var(--primary-light)] text-slate-950 ring-1 ring-[var(--primary)]'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <span className={`h-9 w-9 rounded-lg flex items-center justify-center ${active ? 'bg-white text-[var(--primary)]' : 'bg-slate-100 text-slate-500'}`}>
                          <Icon className="w-4 h-4" />
                        </span>
                        <span>
                          <span className="block text-sm font-semibold">{label}</span>
                          <span className="block text-xs text-slate-500">{description}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Brand preview</p>
                <div
                  className="rounded-2xl p-4 text-white"
                  style={{ background: `linear-gradient(135deg, ${brandPreview.theme_color}, ${brandPreview.theme_color_hover})` }}
                >
                  <div className="flex items-center gap-3">
                    <BrandLogo
                      logoUrl={brandPreview.logo_url}
                      label={`${settings.clinic_name} logo preview`}
                      className="h-12 w-12 rounded-xl bg-white/20 overflow-hidden"
                      fallback={<Stethoscope className="h-6 w-6" />}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{settings.clinic_name || 'Clinic name'}</p>
                      <p className="text-xs text-white/80 truncate">{settings.doctor_name || 'Doctor / clinic subtitle'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            <div className="space-y-6">
              {activeSection === 'branding' && (
                <section className="card p-5 space-y-5">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
                    <Palette className="w-5 h-5 text-[var(--primary)]" />
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">Branding</h2>
                      <p className="text-xs text-slate-500">Customize how this clinic appears on public registration and staff screens.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-5">
                    <div className="space-y-5">
                      <Input
                        label="Logo image URL"
                        placeholder="https://example.com/clinic-logo.png"
                        helperText="Use a public image URL or a relative path such as /logo.png. Square logos look best."
                        value={settings.logo_url}
                        onChange={(event) => updateField('logo_url', event.target.value)}
                      />

                      <div className="rounded-xl border border-slate-200 p-4">
                        <div className="mb-3">
                          <p className="text-sm font-semibold text-slate-900">Theme presets</p>
                          <p className="text-xs text-slate-500">Preview changes apply instantly. Save settings to publish them.</p>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {themePresets.map((preset) => {
                            const presetColor = normalizeHexColor(preset.color, preset.color)
                            const isSelectedPreset = brandPreview.theme_color === presetColor

                            return (
                              <button
                                key={preset.color}
                                type="button"
                                onClick={() => applyThemePreset(preset.color)}
                                aria-pressed={isSelectedPreset}
                                className={`min-h-12 rounded-xl border px-3 text-left transition-colors ${
                                  isSelectedPreset
                                    ? 'border-[var(--primary)] bg-[var(--primary-light)]'
                                    : 'border-slate-200 bg-white hover:border-[var(--primary)]'
                                }`}
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span className="flex items-center gap-2">
                                    <span className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: presetColor }} />
                                    <span className="text-sm font-medium text-slate-700">{preset.name}</span>
                                  </span>
                                  {isSelectedPreset && <Check className="h-4 w-4 shrink-0 text-[var(--primary)]" />}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <Input
                          label="Primary color"
                          type="color"
                          value={settings.theme_color}
                          onChange={(event) => updatePrimaryTheme(event.target.value)}
                        />
                        <Input
                          label="Hover color"
                          type="color"
                          value={settings.theme_color_hover}
                          onChange={(event) => updateField('theme_color_hover', event.target.value)}
                        />
                        <Input
                          label="Light tint"
                          type="color"
                          value={settings.theme_color_light}
                          onChange={(event) => updateField('theme_color_light', event.target.value)}
                        />
                      </div>

                      <Button type="button" variant="outline" onClick={resetBranding}>
                        Restore default branding
                      </Button>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-slate-900 mb-3">Logo preview</p>
                      <div className="aspect-square rounded-2xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden">
                        {brandPreview.logo_url ? (
                          <BrandLogo
                            logoUrl={brandPreview.logo_url}
                            label="Clinic logo preview"
                            className="h-full w-full"
                            fallback={<ImageIcon className="h-10 w-10 text-slate-300" />}
                          />
                        ) : (
                          <div className="text-center px-4">
                            <ImageIcon className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                            <p className="text-xs text-slate-500">No logo selected</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'clinic' && (
                <section className="card p-5 space-y-5">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
                    <Building2 className="w-5 h-5 text-[var(--primary)]" />
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">Clinic Profile</h2>
                      <p className="text-xs text-slate-500">Shown on QR registration, confirmation, and staff navigation.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Clinic Name"
                      required
                      value={settings.clinic_name}
                      onChange={(event) => updateField('clinic_name', event.target.value)}
                    />
                    <Input
                      label="Primary Doctor / Subtitle"
                      value={settings.doctor_name}
                      onChange={(event) => updateField('doctor_name', event.target.value)}
                    />
                    <Input
                      label="Phone Number"
                      type="tel"
                      value={settings.phone}
                      onChange={(event) => updateField('phone', event.target.value)}
                    />
                    <Input
                      label="Registration Number"
                      value={settings.registration_number}
                      onChange={(event) => updateField('registration_number', event.target.value)}
                    />
                    <div className="md:col-span-2">
                      <Input
                        label="Hospital Website URL"
                        type="url"
                        placeholder="https://yourhospital.com"
                        helperText="Optional. Shown as a Visit website link on public registration and staff sidebar."
                        value={settings.website_url}
                        onChange={(event) => updateField('website_url', event.target.value)}
                      />
                    </div>
                  </div>

                  <Textarea
                    label="Clinic Address"
                    rows={3}
                    value={settings.address}
                    onChange={(event) => updateField('address', event.target.value)}
                  />
                </section>
              )}

              {activeSection === 'staff' && (
                <section className="card p-5 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2">
                      <UserPlus className="w-5 h-5 text-[var(--primary)]" />
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">Staff Users</h2>
                        <p className="text-xs text-slate-500">Create receptionist, doctor, and therapist login accounts. Public signup remains closed.</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {staffUsers.length} accounts
                    </span>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-4">
                      <p className="text-sm font-semibold text-slate-900">Create a staff login</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Share the temporary password privately with the staff member. They can use the normal login page after creation.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1fr_1fr_180px_1fr_auto] gap-3 items-end">
                      <Input
                        label="Full name"
                        placeholder="Amit Kumar"
                        value={newStaffUser.full_name}
                        onChange={(event) => setNewStaffUser((current) => ({ ...current, full_name: event.target.value }))}
                      />
                      <Input
                        label="Email"
                        type="email"
                        placeholder="staff@clinic.com"
                        autoComplete="off"
                        value={newStaffUser.email}
                        onChange={(event) => setNewStaffUser((current) => ({ ...current, email: event.target.value }))}
                      />
                      <Select
                        label="Role"
                        options={staffRoleOptions}
                        value={newStaffUser.role}
                        onChange={(event) => setNewStaffUser((current) => ({ ...current, role: event.target.value as StaffCreatableRole }))}
                      />
                      <Input
                        label="Temporary password"
                        type="password"
                        placeholder="Minimum 8 characters"
                        autoComplete="new-password"
                        value={newStaffUser.password}
                        onChange={(event) => setNewStaffUser((current) => ({ ...current, password: event.target.value }))}
                      />
                      <Button type="button" onClick={createStaffUser} loading={creatingStaffUser} className="min-w-32">
                        <UserPlus className="w-4 h-4" />
                        Create login
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {staffUsers.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
                        <UserPlus className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                        <p className="text-sm font-semibold text-slate-800">No staff users found</p>
                        <p className="text-xs text-slate-500 mt-1">Create receptionist, doctor, and therapist logins above.</p>
                      </div>
                    ) : staffUsers.map((staff) => {
                      const isCurrentUser = staff.id === profile?.id

                      return (
                      <div key={staff.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-slate-900 truncate">{staff.full_name}</p>
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getRoleBadgeClass(staff.role)}`}>
                                {getRoleLabel(staff.role)}
                              </span>
                              {isCurrentUser && (
                                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                                  Current user
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-slate-500 truncate">{staff.email || 'No email found in Auth'}</p>
                          </div>
                          <div className="flex flex-col sm:flex-row sm:items-center gap-3 lg:justify-end">
                            <div className="text-left sm:text-right">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Created</p>
                              <p className="text-sm text-slate-600">{formatStaffCreatedAt(staff.created_at)}</p>
                            </div>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              onClick={() => deleteStaffUser(staff)}
                              loading={deletingStaffUserId === staff.id}
                              disabled={isCurrentUser}
                              title={isCurrentUser ? 'You cannot delete the account you are currently using' : `Delete ${staff.full_name}`}
                              aria-label={isCurrentUser ? 'Cannot delete current user' : `Delete ${staff.full_name}`}
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {activeSection === 'doctors' && (
                <section className="card p-5 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2">
                      <Users className="w-5 h-5 text-[var(--primary)]" />
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">Doctor List</h2>
                        <p className="text-xs text-slate-500">Active doctors appear in the public registration doctor preference dropdown.</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {activeDoctors.length} active
                    </span>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900 mb-3">Add a doctor</p>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                      <Input
                        label="Doctor name"
                        placeholder="Dr. Asha Sharma"
                        value={newDoctor.name}
                        onChange={(event) => setNewDoctor((current) => ({ ...current, name: event.target.value }))}
                      />
                      <Input
                        label="Specialization"
                        placeholder="Orthopedic, General Physician..."
                        value={newDoctor.specialization}
                        onChange={(event) => setNewDoctor((current) => ({ ...current, specialization: event.target.value }))}
                      />
                      <Button type="button" onClick={addDoctor} loading={addingDoctor} className="min-w-28">
                        <Plus className="w-4 h-4" />
                        Add
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {doctors.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
                        <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                        <p className="text-sm font-semibold text-slate-800">No doctors added yet</p>
                        <p className="text-xs text-slate-500 mt-1">Add doctors above to show them on the registration form.</p>
                      </div>
                    ) : doctors.map((doctor) => (
                      <div key={doctor.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                          <Input
                            label="Doctor name"
                            value={doctor.name}
                            onChange={(event) => updateDoctorField(doctor.id, 'name', event.target.value)}
                          />
                          <Input
                            label="Specialization"
                            value={doctor.specialization ?? ''}
                            onChange={(event) => updateDoctorField(doctor.id, 'specialization', event.target.value)}
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" onClick={() => saveDoctor(doctor)} loading={savingDoctorId === doctor.id}>
                              <Save className="w-4 h-4" />
                              Save
                            </Button>
                            <Button
                              type="button"
                              variant={doctor.is_active ? 'outline' : 'success'}
                              onClick={() => toggleDoctorActive(doctor)}
                              loading={savingDoctorId === doctor.id}
                              title={doctor.is_active ? 'Hide from registration' : 'Show on registration'}
                            >
                              {doctor.is_active ? <Power className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                              {doctor.is_active ? 'Hide' : 'Activate'}
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              onClick={() => deleteDoctor(doctor)}
                              loading={savingDoctorId === doctor.id}
                              title="Delete doctor permanently"
                              aria-label={`Delete ${doctor.name} permanently`}
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </Button>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          Registration form status:{' '}
                          <span className={doctor.is_active ? 'text-emerald-700 font-semibold' : 'text-slate-500 font-semibold'}>
                            {doctor.is_active ? `Visible as ${doctor.name} - ${getDoctorSubtitle(doctor)}` : 'Hidden from patients'}
                          </span>
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeSection === 'hours' && (
                <section className="card p-5 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2">
                      <Clock className="w-5 h-5 text-[var(--primary)]" />
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">Registration Hours</h2>
                        <p className="text-xs text-slate-500">Add morning/evening sessions per day. Public QR registration opens only inside these slots.</p>
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={applySplitSchedule}>
                      Apply split schedule
                    </Button>
                  </div>

                  <Select
                    label="Timezone"
                    required
                    options={timezoneOptions}
                    value={settings.timezone}
                    onChange={(event) => updateField('timezone', event.target.value)}
                  />

                  <div className="space-y-3">
                    {dayOptions.map((day) => {
                      const schedule = settings.working_schedule.find((entry) => entry.day === day.value)
                      const enabled = Boolean(schedule?.enabled)
                      return (
                        <div key={day.value} className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => toggleDay(day.value)}
                              aria-pressed={enabled}
                              className={`min-w-24 h-10 rounded-lg text-sm font-semibold border transition-colors ${
                                enabled
                                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-[var(--primary)]'
                              }`}
                            >
                              {day.short}
                            </button>
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-slate-800">{day.label}</p>
                              <p className="text-xs text-slate-500">{enabled ? 'Open for registration' : 'Closed'}</p>
                            </div>
                            <Button type="button" variant="ghost" size="sm" onClick={() => addSlot(day.value)} disabled={!enabled || (schedule?.slots.length ?? 0) >= 3}>
                              <Plus className="w-4 h-4" />
                              Slot
                            </Button>
                          </div>

                          {enabled && (
                            <div className="mt-3 space-y-2 pl-0 sm:pl-28">
                              {schedule?.slots.map((slot, index) => (
                                <div key={`${day.value}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                                  <Input
                                    label={index === 0 ? 'Start' : undefined}
                                    type="time"
                                    value={slot.start}
                                    onChange={(event) => updateSlot(day.value, index, 'start', event.target.value)}
                                  />
                                  <Input
                                    label={index === 0 ? 'End' : undefined}
                                    type="time"
                                    value={slot.end}
                                    onChange={(event) => updateSlot(day.value, index, 'end', event.target.value)}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeSlot(day.value, index)}
                                    aria-label={`Remove ${day.label} slot ${index + 1}`}
                                    className="h-11 w-11 rounded-lg border border-red-100 text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
