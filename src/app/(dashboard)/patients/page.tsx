"use client";

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Plus, Download, User, Phone } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PageHeader } from '@/components/shared/PageHeader'
import { PatientForm } from '@/components/patients/PatientForm'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/utils'
import * as dataService from '@/lib/dataService'
import type { Patient } from '@/types'

export default function PatientsPage() {
  const router = useRouter()
  const toast = useToast()
  const [patients, setPatients] = useState<Patient[]>([])
  const [search, setSearch] = useState('')
  const [showAddPatient, setShowAddPatient] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const data = await dataService.getPatients()
      setPatients(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filtered = patients.filter(
    (p) =>
      p.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (p.father_name || '').toLowerCase().includes(search.toLowerCase()) ||
      p.phone.includes(search)
  )

  const handleAddPatient = async (data: any) => {
    try {
      const existing = await dataService.getPatientByPhone(data.phone)
      if (existing) {
        toast.warning('A patient with this phone number already exists')
        return
      }
      await dataService.createPatient({
        full_name: data.full_name,
        age: data.age,
        gender: data.gender,
        phone: data.phone,
        father_name: data.father_name || null,
        referral_source: data.referral_source || null,
        address: data.address || null,
        blood_group: null,
      })
      await loadData()
      setShowAddPatient(false)
      toast.success('Patient added successfully')
    } catch {
      toast.error('Failed to add patient')
    }
  }

  const handleExport = async () => {
    const headers = ['Name', 'Father Name', 'Age', 'Gender', 'Phone', 'Heard About Us', 'Address', 'Registered On']
    const rows = patients.map((p) => [
      p.full_name,
      p.father_name || '',
      p.age,
      p.gender,
      p.phone,
      p.referral_source || '',
      p.address || '',
      formatDate(p.created_at),
    ])
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `patients-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Patients exported to CSV')
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6">
        <PageHeader
          title="Patients"
          description={`${patients.length} patients in the system`}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="w-4 h-4" />
                Export
              </Button>
              <Button size="sm" onClick={() => setShowAddPatient(true)}>
                <Plus className="w-4 h-4" />
                Add Patient
              </Button>
            </div>
          }
        />

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, father's name, or phone number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 text-sm border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Patient Cards (Mobile) */}
            <div className="md:hidden space-y-3">
              {filtered.map((p) => (
                <div
                  key={p.id}
                  onClick={() => router.push(`/patients/${p.id}`)}
                  className="card p-4 cursor-pointer hover-card"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-[var(--primary-light)] rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-[var(--primary)]" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-slate-900">{p.full_name}</h3>
                      <p className="text-xs text-slate-500">{p.age}y - {p.gender}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-600 flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {p.phone}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">{formatDate(p.created_at)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Table (Desktop) */}
            <div className="hidden md:block card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      {['Patient', 'Father Name', 'Age / Gender', 'Phone', 'Registered', 'Action'].map((h) => (
                        <th key={h} className={`text-xs font-semibold text-slate-500 px-4 py-3 ${h === 'Action' ? 'text-right' : 'text-left'}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-sm text-slate-400">
                          No patients found
                        </td>
                      </tr>
                    ) : (
                      filtered.map((p) => (
                        <tr
                          key={p.id}
                          className="hover:bg-slate-50 transition-colors cursor-pointer"
                          onClick={() => router.push(`/patients/${p.id}`)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-[var(--primary-light)] rounded-full flex items-center justify-center">
                                <span className="text-xs font-bold text-[var(--primary)]">{p.full_name.charAt(0)}</span>
                              </div>
                              <span className="text-sm font-semibold text-slate-900">{p.full_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-slate-700">{p.father_name || '-'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-slate-700">{p.age}y - {p.gender}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-slate-700">{p.phone}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-slate-500">{formatDate(p.created_at)}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={(e) => { e.stopPropagation(); router.push(`/patients/${p.id}`) }}
                              className="text-xs text-[var(--primary)] hover:underline font-medium"
                            >
                              View -&gt;
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <Modal isOpen={showAddPatient} onClose={() => setShowAddPatient(false)} title="Add New Patient" size="lg">
        <div className="p-6">
          <PatientForm
            onSubmit={handleAddPatient}
            onCancel={() => setShowAddPatient(false)}
            submitLabel="Add Patient"
          />
        </div>
      </Modal>
    </DashboardLayout>
  )
}
