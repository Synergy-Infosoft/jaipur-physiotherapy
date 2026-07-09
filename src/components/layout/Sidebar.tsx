"use client";

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard,
  ListOrdered,
  Users,
  Receipt,
  QrCode,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Stethoscope,
  ExternalLink,
  Activity,
  ClipboardCheck,
  BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { useBranding } from '@/context/BrandingContext'
import { useToast } from '@/components/ui/Toast'
import { BrandLogo } from '@/components/shared/BrandLogo'
import { useState } from 'react'

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: "Today's Queue", icon: ListOrdered, path: '/visits' },
  { label: 'Patients', icon: Users, path: '/patients' },
  { label: 'Invoices', icon: Receipt, path: '/invoices' },
  { label: 'QR Code', icon: QrCode, path: '/qr-code' },
]

const therapistNavItems = [
  { label: 'Therapist', icon: Activity, path: '/therapist' },
]

export function Sidebar() {
  const { profile, logout } = useAuth()
  const { settings } = useBranding()
  const router = useRouter()
  const pathname = usePathname()
  const toast = useToast()
  const [collapsed, setCollapsed] = useState(false)
  const websiteUrl = settings.website_url.trim()
  const primaryNavItems = profile?.role === 'therapist' ? therapistNavItems : navItems

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out successfully')
    router.push('/login')
  }

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col bg-[#0F172A] text-white transition-all duration-200 flex-shrink-0 relative print:hidden',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className={cn('flex items-center gap-3 px-4 py-5 border-b border-white/10', collapsed && 'justify-center px-0')}>
        <BrandLogo
          logoUrl={settings.logo_url}
          label={`${settings.clinic_name} logo`}
          className="w-8 h-8 bg-[var(--primary)] rounded-lg flex-shrink-0 overflow-hidden"
          fallback={<Stethoscope className="w-5 h-5 text-white" />}
        />
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="text-sm font-bold text-white truncate leading-tight">{settings.clinic_name}</p>
            <p className="text-xs text-slate-400 truncate">{settings.doctor_name || 'Medical Center'}</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <div className="space-y-0.5 px-2">
          {primaryNavItems.map(({ label, icon: Icon, path }) => {
            const isActive = pathname === path || (pathname?.startsWith(path + '/') ?? false)
            return (
              <Link
                key={path}
                href={path}
                title={collapsed ? label : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative',
                  isActive
                    ? 'bg-white/10 text-white border-l-2 border-[var(--primary)]'
                    : 'text-slate-400 hover:text-white hover:bg-white/5',
                  collapsed && 'justify-center px-0 border-l-0'
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span className="text-sm font-medium">{label}</span>}
                {collapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded hidden group-hover:block whitespace-nowrap z-50 shadow-lg">
                    {label}
                  </div>
                )}
              </Link>
            )
          })}

          {(profile?.role === 'follow_up_agent' || profile?.role === 'admin') && (
            <Link
              href="/follow-up"
              title={collapsed ? 'Follow-up' : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative',
                pathname === '/follow-up'
                  ? 'bg-white/10 text-white border-l-2 border-[var(--primary)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/5',
                collapsed && 'justify-center px-0 border-l-0'
              )}
            >
              <ClipboardCheck className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="text-sm font-medium">Follow-up</span>}
              {collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded hidden group-hover:block whitespace-nowrap z-50 shadow-lg">
                  Follow-up
                </div>
              )}
            </Link>
          )}

          {profile?.role === 'admin' && (
            <>
              <Link
                href="/reports"
                title={collapsed ? 'Reports' : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative',
                  pathname === '/reports'
                    ? 'bg-white/10 text-white border-l-2 border-[var(--primary)]'
                    : 'text-slate-400 hover:text-white hover:bg-white/5',
                  collapsed && 'justify-center px-0 border-l-0'
                )}
              >
                <BarChart3 className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span className="text-sm font-medium">Reports</span>}
                {collapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded hidden group-hover:block whitespace-nowrap z-50 shadow-lg">
                    Reports
                  </div>
                )}
              </Link>

              <Link
                href="/settings"
                title={collapsed ? 'Settings' : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative',
                  pathname === '/settings'
                    ? 'bg-white/10 text-white border-l-2 border-[var(--primary)]'
                    : 'text-slate-400 hover:text-white hover:bg-white/5',
                  collapsed && 'justify-center px-0 border-l-0'
                )}
              >
                <Settings className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span className="text-sm font-medium">Settings</span>}
                {collapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded hidden group-hover:block whitespace-nowrap z-50 shadow-lg">
                    Settings
                  </div>
                )}
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* User info + logout */}
      <div className={cn('border-t border-white/10 p-3', collapsed && 'p-2')}>
        {!collapsed && (
          <div className="flex items-center gap-3 mb-2 px-1">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-[var(--primary)]">
                {(profile?.full_name ?? 'U').charAt(0)}
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium text-white truncate">{profile?.full_name ?? 'Staff'}</p>
              <p className="text-xs text-slate-400 capitalize">{profile?.role}</p>
            </div>
          </div>
        )}
        {websiteUrl && (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'mb-1 flex items-center gap-2 w-full px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors',
              collapsed && 'justify-center'
            )}
            title="Visit website"
          >
            <ExternalLink className="w-4 h-4" />
            {!collapsed && <span className="text-sm">Visit website</span>}
          </a>
        )}
        <button
          onClick={handleLogout}
          className={cn(
            'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors',
            collapsed && 'justify-center'
          )}
          title="Logout"
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && <span className="text-sm">Logout</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute -right-3 top-8 w-6 h-6 bg-[#0F172A] border border-white/20 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors z-10"
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3 text-slate-400" />
        ) : (
          <ChevronLeft className="w-3 h-3 text-slate-400" />
        )}
      </button>
    </aside>
  )
}
