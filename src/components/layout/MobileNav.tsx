"use client";

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, LayoutDashboard, ListOrdered, Users, Receipt, QrCode } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Queue', icon: ListOrdered, path: '/visits' },
  { label: 'Patients', icon: Users, path: '/patients' },
  { label: 'Invoices', icon: Receipt, path: '/invoices' },
  { label: 'QR', icon: QrCode, path: '/qr-code' },
]

const therapistNavItems = [
  { label: 'Therapist', icon: Activity, path: '/therapist' },
]

export function MobileNav() {
  const pathname = usePathname()
  const { profile } = useAuth()
  const primaryNavItems = profile?.role === 'therapist' ? therapistNavItems : navItems

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 print:hidden">
      <div className="flex">
        {primaryNavItems.map(({ label, icon: Icon, path }) => {
          const isActive = pathname === path || (pathname?.startsWith(path + '/') ?? false)
          return (
            <Link
              key={path}
              href={path}
              className={cn(
                'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors',
                isActive ? 'text-[var(--primary)]' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
