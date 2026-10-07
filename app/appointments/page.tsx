'use client'

import { useRouter } from 'next/navigation'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import React, { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import {
  Plus,
  Clock,
  MapPin,
  Phone,
  User,
  Calendar,
  FileText,
  CheckSquare,
  Pencil,
  AlertTriangle,
  RefreshCw,
  Send,
  ListChecks,
} from 'lucide-react'
import { Appointment, Customer, AppointmentStatus, AppointmentType } from '@/lib/types/rental-pos'
import { CustomDatePicker, getLocalDateString, parseLocalDate } from '@/components/common/CustomDatePicker'
import { CustomSelect } from '@/components/common/CustomSelect'
import { CustomerAutocomplete } from '@/components/common/CustomerAutocomplete'
import { AppModal, AppModalHeader, AppModalBody, AppModalFooter } from '@/components/common/AppModal'
import { DataTableFrame } from '@/components/common/DataTableFrame'
import {
  ActionButton,
  TAB_CONTAINER_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'
import { useToast } from '@/components/common/Toast'
import { logger } from '@/lib/utils/logger'
import { AddAppointmentModal, DEFAULT_APPOINTMENT_TYPES } from '@/features/appointments/components/AddAppointmentModal'

const WORK_ORDER_STAGES_DELIVERY = [
  { key: 'DISPATCH', label: 'สั่งงาน' },
  { key: 'ACCEPT', label: 'รับงาน' },
  { key: 'PREPARE', label: 'เตรียม' },
  { key: 'PREPARED', label: 'เตรียมเสร็จ' },
  { key: 'TRANSIT', label: 'ออกส่ง' },
  { key: 'ARRIVED', label: 'ถึงหน้างาน' },
  { key: 'INSPECT', label: 'ตรวจรายการ' },
  { key: 'COMPLETED', label: 'ส่งเสร็จ' },
  { key: 'CLOSED', label: 'ปิดงาน' },
]

const WORK_ORDER_STAGES_RETURN = [
  { key: 'DISPATCH', label: 'สั่งงานเก็บ' },
  { key: 'ACCEPT', label: 'รับงาน' },
  { key: 'TRANSIT', label: 'ออกเก็บ' },
  { key: 'ARRIVED', label: 'ถึงหน้างาน' },
  { key: 'INSPECT', label: 'ตรวจรายการ' },
  { key: 'COLLECTED', label: 'เก็บบางส่วน/ครบ' },
  { key: 'RETURN', label: 'กลับร้าน' },
  { key: 'RECEIVED', label: 'รับคืนสินค้า' },
  { key: 'CLOSED', label: 'ปิดงาน' },
]
import {
  loadAppointments,
  fetchAppointmentsFromSupabase,
  addAppointment,
  updateAppointment,
  setAppointmentStatus,
  fetchAppointmentHistory,
  type AppointmentHistoryEntry,
} from '@/features/appointments/services/appointment-storage'
import { APPOINTMENT_STATUS_META, isAppointmentClosed, nextAppointmentSteps } from '@/features/appointments/appointment-status'
import { loadCustomers } from '@/features/customers/services/customer-storage'

const CalendarView = dynamic(
  () => import('@/features/appointments/components/CalendarView').then((mod) => mod.CalendarView),
  { ssr: false }
)

const getInitialFormData = (): Partial<Appointment> => ({
  title: '',
  type: 'DELIVERY',
  customerId: undefined,
  customerName: '',
  billNo: '',
  quotationNo: '',
  date: getLocalDateString(),
  startTime: '09:00',
  endTime: '10:00',
  location: '',
  contactPerson: '',
  phone: '',
  details: '',
  status: 'SCHEDULED',
})

export default function AppointmentsPage() {
  const { showToast } = useToast()
  const router = useRouter()
  const { settings: systemSettings } = useSystemSettings()
  const [appointmentTypes, setAppointmentTypes] = useState<Array<{ id: string; label: string }>>(DEFAULT_APPOINTMENT_TYPES)
  const addAppointmentType = (label: string) => setAppointmentTypes((prev) => [...prev, { id: 'apt-' + Date.now(), label }])
  const updateAppointmentType = (id: string, label: string) => setAppointmentTypes((prev) => prev.map((t) => (t.id === id ? { ...t, label } : t)))
  const removeAppointmentType = (id: string) => setAppointmentTypes((prev) => prev.filter((t) => t.id !== id))

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const [activeTab, setActiveTab] = useState<'APPOINTMENTS' | 'TODAY' | 'TOMORROW' | 'ALL'>('APPOINTMENTS')

  // Selected Appointment for Detail Modal
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null)

  // Status update in progress ID
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)

  // Add Modal State
  const [showAddModal, setShowAddModal] = useState(false)

  // Edit Modal State
  const [editingApt, setEditingApt] = useState<Appointment | null>(null)
  const [editFormData, setEditFormData] = useState<Partial<Appointment>>(getInitialFormData())
  const [isEditSubmitting, setIsEditSubmitting] = useState(false)

  // Reschedule reason (edit modal, required when the date/time changes)
  const [rescheduleReason, setRescheduleReason] = useState('')

  // Cancel / No-show confirmation (appointments are never deleted)
  const [reasonAction, setReasonAction] = useState<{ apt: Appointment; status: 'CANCELLED' | 'NO_SHOW' } | null>(null)
  const [reasonText, setReasonText] = useState('')

  // Appointment History of the appointment open in the detail modal
  const [aptHistory, setAptHistory] = useState<AppointmentHistoryEntry[]>([])

  // Work Order Dispatch Modal State (สั่งงาน)
  const [orderApt, setOrderApt] = useState<Appointment | null>(null)

  // Work Order Timeline Modal State (สถานะงาน)
  const [timelineApt, setTimelineApt] = useState<Appointment | null>(null)

  // Appointments never create bills or payments: a linked bill only opens in the bills menu.
  const handleBillClick = (apt: Appointment) => {
    if (apt.billId) router.push(`/bills?id=${encodeURIComponent(apt.billId)}`)
  }

  // Load Data
  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      if (process.env.NODE_ENV !== 'test') {
        try {
          const remoteApts = await fetchAppointmentsFromSupabase()
          setAppointments(remoteApts)
        } catch (err) {
          setAppointments(loadAppointments())
          showToast('โหลดนัดหมายจาก Cloud ไม่สำเร็จ', err instanceof Error ? err.message : 'แสดงข้อมูลล่าสุดที่มีในเครื่อง', 'ERROR')
        }
      } else {
        const apts = loadAppointments()
        setAppointments(apts)
      }
      const custs = loadCustomers()
      setCustomers(custs)
    } finally {
      setIsLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const selectedAptId = selectedApt?.id
  const selectedAptStatus = selectedApt?.status
  const selectedAptStart = selectedApt ? `${selectedApt.date} ${selectedApt.startTime}` : ''
  useEffect(() => {
    setAptHistory([])
    if (!selectedAptId || process.env.NODE_ENV === 'test') return
    let cancelled = false
    fetchAppointmentHistory(selectedAptId)
      .then((rows) => {
        if (!cancelled) setAptHistory(rows)
      })
      .catch((err) => logger.error('Failed to load appointment history:', err))
    return () => {
      cancelled = true
    }
  }, [selectedAptId, selectedAptStatus, selectedAptStart])

  // 2. OPEN EDIT MODAL
  const handleOpenEdit = (apt: Appointment) => {
    setEditingApt(apt)
    setRescheduleReason('')
    setEditFormData({
      title: apt.title,
      type: apt.type,
      appointmentTypeId: apt.appointmentTypeId,
      customerId: apt.customerId,
      customerName: apt.customerName,
      billNo: apt.billNo || '',
      quotationNo: apt.quotationNo || '',
      date: apt.date,
      startTime: apt.startTime,
      endTime: apt.endTime,
      location: apt.location || '',
      contactPerson: apt.contactPerson || '',
      phone: apt.phone || '',
      details: apt.details || '',
      status: apt.status,
    })
  }

  // 3. SUBMIT EDIT APPOINTMENT
  const handleUpdateAppointment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingApt) return
    if (!editFormData.title || !editFormData.title.trim()) {
      showToast('กรุณาระบุหัวข้องานนัดหมาย', undefined, 'ERROR')
      return
    }

    if (!editFormData.date || !editFormData.startTime || !editFormData.endTime) {
      showToast('กรุณาระบุวันและเวลาให้ครบ', undefined, 'ERROR')
      return
    }
    if (editFormData.endTime < editFormData.startTime) {
      showToast('เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม', undefined, 'ERROR')
      return
    }
    if (isEditRescheduling && !rescheduleReason.trim()) {
      showToast('กรุณาระบุเหตุผลการเลื่อนนัด', undefined, 'ERROR')
      return
    }

    setIsEditSubmitting(true)
    try {
      const updated: Appointment = {
        ...editingApt,
        ...(editFormData as Appointment),
        status: editingApt.status,
      }
      const fresh = await updateAppointment(updated, rescheduleReason.trim())
      setAppointments(fresh)
      if (selectedApt && selectedApt.id === updated.id) {
        setSelectedApt(fresh.find((a) => a.id === updated.id) ?? updated)
      }
      setEditingApt(null)
      showToast('แก้ไขนัดหมายสำเร็จ', `อัปเดตนัดหมาย "${updated.title}" เรียบร้อยแล้ว`, 'SUCCESS')
    } catch (err: any) {
      logger.error('Update appointment error:', err)
      showToast('แก้ไขไม่สำเร็จ', err.message || 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setIsEditSubmitting(false)
    }
  }

  // 4. STATUS CHANGE (lifecycle step; cancel / no-show come through the reason modal)
  const handleStatusChange = async (id: string, newStatus: AppointmentStatus, reason?: string) => {
    setUpdatingStatusId(id)
    try {
      const fresh = await setAppointmentStatus(id, newStatus, reason)
      setAppointments(fresh)
      if (selectedApt && selectedApt.id === id) {
        setSelectedApt(fresh.find((a) => a.id === id) ?? { ...selectedApt, status: newStatus })
      }
      showToast('อัปเดตสถานะสำเร็จ', `เปลี่ยนสถานะเป็น "${APPOINTMENT_STATUS_META[newStatus].label}" แล้ว`, 'SUCCESS')
      return true
    } catch (err: any) {
      logger.error('Failed to change appointment status:', err)
      showToast('เปลี่ยนสถานะไม่สำเร็จ', err.message || 'ไม่สามารถบันทึกสถานะได้', 'ERROR')
      return false
    } finally {
      setUpdatingStatusId(null)
    }
  }

  // 5. CANCEL / NO-SHOW (kept with reason in history — never deleted)
  const handleConfirmReasonAction = async () => {
    if (!reasonAction) return
    if (reasonAction.status === 'CANCELLED' && !reasonText.trim()) {
      showToast('กรุณาระบุเหตุผลการยกเลิก', undefined, 'ERROR')
      return
    }
    const ok = await handleStatusChange(reasonAction.apt.id, reasonAction.status, reasonText)
    if (ok) {
      setReasonAction(null)
      setReasonText('')
    }
  }

  const isEditRescheduling = Boolean(
    editingApt &&
      (editFormData.date !== editingApt.date ||
        editFormData.startTime !== editingApt.startTime ||
        editFormData.endTime !== editingApt.endTime)
  )

  // Type Badge Config
  const getTypeBadge = (type: Appointment['type']) => {
    switch (type) {
      case 'DELIVERY':
        return { label: '🚚 นัดส่งสินค้า', bg: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-300' }
      case 'RETURN':
        return { label: '🔄 นัดรับคืนสินค้า', bg: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300' }
      case 'PAYMENT':
        return { label: '💰 นัดชำระเงิน', bg: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300' }
      case 'CONTRACT':
        return { label: '📝 นัดทำสัญญา', bg: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-300' }
      case 'QUOTATION':
        return { label: '📊 นัดติดตามใบเสนอราคา', bg: 'bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border-cyan-300' }
      case 'INSPECTION':
        return { label: '🔍 นัดตรวจสินค้า', bg: 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300' }
      default:
        return { label: '📌 นัดหมายทั่วไป', bg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300' }
    }
  }

  // Format Calendar Events
  const calendarEvents = appointments.map((apt) => {
    let color = '#2563eb' // Delivery: blue
    if (apt.type === 'RETURN') color = '#059669' // Return: green
    if (apt.type === 'PAYMENT') color = '#d97706' // Payment: amber
    if (apt.type === 'CONTRACT') color = '#9333ea' // Contract: purple
    if (apt.type === 'QUOTATION') color = '#0891b2' // Quotation: cyan
    if (apt.type === 'INSPECTION') color = '#dc2626' // Inspection: red
    if (isAppointmentClosed(apt.status)) color = APPOINTMENT_STATUS_META[apt.status].color

    return {
      id: apt.id,
      title: apt.title,
      start: `${apt.date}T${apt.startTime}:00`,
      end: `${apt.date}T${apt.endTime}:00`,
      backgroundColor: color,
      borderColor: color,
    }
  })

  const todayStr = getLocalDateString()
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = getLocalDateString(tomorrow)

  const filteredTasks = appointments.filter((apt) => {
    if (activeTab === 'APPOINTMENTS') return !isAppointmentClosed(apt.status)
    if (activeTab === 'TODAY') return apt.date === todayStr
    if (activeTab === 'TOMORROW') return apt.date === tomorrowStr
    return true
  })

  // KPI Calculations ("ใกล้ถึงกำหนด" window comes from Settings › นัดหมาย / แจ้งเตือน)
  const nearDays = Math.max(0, Number(systemSettings.notifications?.appointmentReminder?.daysBefore ?? 3))
  const todayTasksCount = appointments.filter(a => a.date === todayStr && !isAppointmentClosed(a.status)).length
  const pendingTasksCount = appointments.filter(a => !isAppointmentClosed(a.status)).length
  const completedTasksCount = appointments.filter(a => a.status === 'COMPLETED').length
  const nearTasksCount = appointments.filter(a => {
    if (isAppointmentClosed(a.status)) return false;
    const taskDate = parseLocalDate(a.date);
    if (!taskDate) return false;
    const diffTime = taskDate.getTime() - new Date().getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= nearDays
  }).length

  return (
    <div className="h-full min-h-0 min-w-0 p-2 bg-slate-100 dark:bg-slate-900 flex flex-col overflow-hidden">
      {/* Mini Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2 shrink-0">
        <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center">
          <span className="text-slate-500 text-[11px] font-bold">งานวันนี้</span>
          <span className="text-xl font-black text-blue-600">{todayTasksCount}</span>
        </div>
        <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center">
          <span className="text-slate-500 text-[11px] font-bold">งานค้าง</span>
          <span className="text-xl font-black text-amber-600">{pendingTasksCount}</span>
        </div>
        <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center">
          <span className="text-slate-500 text-[11px] font-bold">ใกล้ถึงกำหนด ({nearDays} วัน)</span>
          <span className="text-xl font-black text-purple-600">{nearTasksCount}</span>
        </div>
        <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center">
          <span className="text-slate-500 text-[11px] font-bold">งานเสร็จสิ้น</span>
          <span className="text-xl font-black text-emerald-600">{completedTasksCount}</span>
        </div>
      </div>

      {/* Unified Appointment Container */}
      <div className="flex-1 min-h-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden">
        {/* 1. Appointment Toolbar */}
        <div className="p-2 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 shrink-0">
          <div className={TAB_CONTAINER_CLASSES}>
            {[
              { value: 'APPOINTMENTS', label: 'ปฏิทิน' },
              { value: 'TODAY', label: 'งานวันนี้' },
              { value: 'TOMORROW', label: 'งานพรุ่งนี้' },
              { value: 'ALL', label: 'งานทั้งหมด' },
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value as typeof activeTab)}
                className={`${TAB_BUTTON_BASE_CLASSES} ${
                  activeTab === tab.value
                    ? TAB_BUTTON_ACTIVE_CLASSES
                    : TAB_BUTTON_INACTIVE_CLASSES
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <ActionButton
              onClick={loadData}
              variant="neutral"
              className="w-9 px-0"
              title="รีเฟรชข้อมูล"
              icon={<RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />}
            />

            <ActionButton
              onClick={() => setShowAddModal(true)}
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
            >
              + เพิ่มนัดหมายใหม่
            </ActionButton>
          </div>
        </div>

        {/* 2. Main Workspace View */}
        {isLoading ? (
          <div className="flex-1 min-h-0 p-6 flex flex-col items-center justify-center text-slate-400 gap-2">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
            <span className="font-bold text-xs">กำลังโหลดข้อมูลนัดหมายจากฐานข้อมูล...</span>
          </div>
        ) : activeTab === 'APPOINTMENTS' ? (
          <div className="flex-1 min-h-0 p-2 overflow-hidden">
            <CalendarView
              events={calendarEvents}
              onEventClick={(id) => {
                const found = appointments.find((a) => a.id === id)
                if (found) setSelectedApt(found)
              }}
            />
          </div>
        ) : (
          /* 3. Appointment List Workspace (Data Table) */
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-3 py-2 shrink-0">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  {activeTab === 'TODAY'
                    ? 'รายการงานวันนี้'
                    : activeTab === 'TOMORROW'
                    ? 'รายการงานพรุ่งนี้'
                    : 'รายการงานทั้งหมด'}{' '}
                  ({filteredTasks.length})
                </span>
              </div>
            </div>

            <DataTableFrame
              className="flex-1 min-h-0 rounded-none border-0 bg-transparent shadow-none p-0"
              fill
              rowCount={filteredTasks.length}
              empty={filteredTasks.length === 0}
              emptyState={
                <div className="h-full min-h-[160px] flex items-center justify-center text-center text-slate-400 font-bold text-xs">
                  ไม่มีรายการนัดหมายในช่วงนี้
                </div>
              }
            >
              <table className="w-full text-left border-collapse table-auto text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                    <th className="px-3">ประเภท / หัวข้อ</th>
                    <th className="px-3">ลูกค้า</th>
                    <th className="px-3">สถานที่</th>
                    <th className="px-3">วัน / เวลา</th>
                    <th className="px-3 text-center">สถานะ</th>
                    <th className="px-3 text-center">การทำงาน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredTasks.map((apt) => {
                    const typeInfo = getTypeBadge(apt.type)
                    const statusMeta = APPOINTMENT_STATUS_META[apt.status]
                    return (
                      <tr
                        key={apt.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="px-3 max-w-[260px]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-md font-bold border ${typeInfo.bg}`}>
                              {typeInfo.label}
                            </span>
                            <span className="font-bold text-slate-900 dark:text-slate-100 truncate" title={apt.title}>
                              {apt.title}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 max-w-[200px]">
                          <p className="font-bold text-slate-900 dark:text-slate-100 truncate" title={apt.customerName}>
                            {apt.customerName || '-'}
                          </p>
                          {apt.phone && <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{apt.phone}</p>}
                        </td>
                        <td className="px-3 max-w-[220px]">
                          <p className="text-slate-600 dark:text-slate-300 truncate" title={apt.location || ''}>
                            {apt.location || '-'}
                          </p>
                        </td>
                        <td className="px-3 whitespace-nowrap font-mono">
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{apt.date}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {apt.startTime} - {apt.endTime} น.
                          </p>
                        </td>
                        <td className="px-3 text-center whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] inline-block ${statusMeta.badge}`}>
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="px-3 text-center whitespace-nowrap">
                          <div className="inline-flex items-center justify-center gap-1">
                            <ActionButton
                              variant="neutral"
                              onClick={() => setSelectedApt(apt)}
                              className="h-7 px-2 text-[11px] rounded-lg"
                              title="ดูข้อมูล / เปลี่ยนสถานะ / แก้ไข"
                            >
                              ดูข้อมูล
                            </ActionButton>
                            {!isAppointmentClosed(apt.status) && (
                              <ActionButton
                                variant="primary"
                                onClick={() => setOrderApt(apt)}
                                className="h-7 px-2 text-[11px] rounded-lg"
                                title="สั่งงาน"
                              >
                                สั่งงาน
                              </ActionButton>
                            )}
                            <ActionButton
                              variant="utility"
                              onClick={() => setTimelineApt(apt)}
                              className="h-7 px-2 text-[11px] rounded-lg border border-slate-200 dark:border-slate-700"
                              title="สถานะงาน"
                            >
                              สถานะงาน
                            </ActionButton>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </DataTableFrame>
          </div>
        )}
      </div>

      {/* APPOINTMENT DETAIL MODAL */}
      <AppModal isOpen={!!selectedApt} onClose={() => setSelectedApt(null)} size="lg">
        {selectedApt && (
          <>
            {/* Modal Header */}
            <AppModalHeader
              onClose={() => setSelectedApt(null)}
              icon={<FileText className="w-5 h-5 text-blue-500" />}
              title="รายละเอียดงานนัดหมาย (Job Details)"
            />

            {/* Modal Body Content */}
            <AppModalBody className="space-y-5">
              {/* Job Title & Status Banner */}
              <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <h2 className="text-base font-black text-slate-900 dark:text-slate-100">{selectedApt.title}</h2>
                  <span className={`px-2.5 py-1 rounded-full font-extrabold text-xs shrink-0 ${APPOINTMENT_STATUS_META[selectedApt.status].badge}`}>
                    {APPOINTMENT_STATUS_META[selectedApt.status].label}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <span className={`px-2.5 py-0.5 rounded-lg font-bold border text-[11px] ${getTypeBadge(selectedApt.type).bg}`}>
                    {getTypeBadge(selectedApt.type).label}
                  </span>
                </div>
              </div>

              {/* SECTION: รายละเอียดสิ่งที่ต้องทำ */}
              <div className="bg-blue-50/70 dark:bg-blue-950/40 p-4 rounded-2xl border border-blue-200 dark:border-blue-800 space-y-2">
                <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300 font-bold text-xs">
                  <CheckSquare className="w-4 h-4 text-blue-600" />
                  <span>รายละเอียดสิ่งที่ต้องทำ (Task Instructions & Details)</span>
                </div>
                {selectedApt.details ? (
                  <div className="whitespace-pre-line text-slate-800 dark:text-slate-200 font-medium leading-relaxed bg-white dark:bg-slate-900 p-3 rounded-xl border border-blue-100 dark:border-blue-900/60 shadow-xs text-xs">
                    {selectedApt.details}
                  </div>
                ) : (
                  <p className="text-slate-400 italic bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
                    ไม่มีรายละเอียดเพิ่มเติม
                  </p>
                )}
              </div>

              {/* SECTION: รายการสินค้า (ถ้ามี) */}
              {selectedApt.items && selectedApt.items.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                  <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-bold text-xs">
                    <CheckSquare className="w-4 h-4 text-emerald-600" />
                    <span>รายการสินค้า ({selectedApt.items.length} รายการ)</span>
                  </div>
                  <div className="space-y-1">
                    {selectedApt.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs bg-white dark:bg-slate-900 p-2 rounded border border-slate-100 dark:border-slate-800">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{item.name}</span>
                        <span className="text-slate-500">จำนวน: {item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Information Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. ข้อมูลลูกค้า */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                    <User className="w-4 h-4 text-emerald-600" />
                    <span>ข้อมูลลูกค้า</span>
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                      {selectedApt.customerName}
                    </p>
                    {selectedApt.contactPerson && (
                      <p className="text-slate-500">ผู้ติดต่อ: {selectedApt.contactPerson}</p>
                    )}
                    {selectedApt.phone && (
                      <p className="text-blue-600 dark:text-blue-400 font-mono font-bold flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        <span>{selectedApt.phone}</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* 2. สถานที่ / หน้างาน */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                    <MapPin className="w-4 h-4 text-red-500" />
                    <span>สถานที่ / จุดนัดหมาย</span>
                  </div>
                  <p className="text-slate-800 dark:text-slate-200 font-medium">
                    {selectedApt.location || 'ไม่ได้ระบุสถานที่'}
                  </p>
                </div>
              </div>

              {/* วันที่และเวลานัดหมาย & บิลที่เกี่ยวข้อง */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                    <Calendar className="w-4 h-4 text-blue-500" />
                    <span>กำหนดการ</span>
                  </div>
                  <div className="space-y-0.5 text-slate-800 dark:text-slate-200 font-semibold font-mono">
                    <p>📅 {selectedApt.date}</p>
                    {selectedApt.startTime && (
                      <p>
                        ⏰ {selectedApt.startTime} - {selectedApt.endTime} น.
                      </p>
                    )}
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                    <FileText className="w-4 h-4 text-amber-500" />
                    <span>เอกสารที่เกี่ยวข้อง</span>
                  </div>
                  <div className="space-y-1 text-slate-800 dark:text-slate-200 font-mono text-xs">
                    {selectedApt.billNo && (
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-emerald-600 dark:text-emerald-400">
                          🧾 เลขที่บิล: {selectedApt.billNo}
                        </p>
                        {selectedApt.billId && (
                          <ActionButton
                            variant="outline"
                            onClick={() => handleBillClick(selectedApt)}
                            className="h-7 px-2 text-[11px] rounded-lg"
                            title={`เปิดบิล ${selectedApt.billNo}`}
                          >
                            ดูบิล
                          </ActionButton>
                        )}
                      </div>
                    )}
                    {selectedApt.quotationNo && (
                      <p className="font-bold text-blue-600 dark:text-blue-400">
                        📄 ใบเสนอราคา: {selectedApt.quotationNo}
                      </p>
                    )}
                    {!selectedApt.billNo && !selectedApt.quotationNo && (
                      <p className="text-slate-400 italic">ไม่มีเอกสารอ้างอิง</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Lifecycle steps */}
              {!isAppointmentClosed(selectedApt.status) && (
                <div className="pt-2">
                  <span className="font-extrabold text-slate-700 dark:text-slate-300 block mb-2">ขั้นตอนถัดไป:</span>
                  <div className="flex flex-wrap gap-2">
                    {nextAppointmentSteps(selectedApt.status).map((step) => (
                      <button
                        key={step.status}
                        type="button"
                        disabled={updatingStatusId === selectedApt.id}
                        onClick={() => {
                          if (step.status === 'NO_SHOW') {
                            setReasonText('')
                            setReasonAction({ apt: selectedApt, status: 'NO_SHOW' })
                          } else {
                            handleStatusChange(selectedApt.id, step.status)
                          }
                        }}
                        className={`h-9 px-4 rounded-xl font-bold text-xs border transition-colors cursor-pointer disabled:opacity-50 ${
                          step.status === 'NO_SHOW'
                            ? 'bg-white dark:bg-slate-800 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50'
                            : 'bg-blue-600 hover:bg-blue-700 border-blue-600 text-white'
                        }`}
                      >
                        {step.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Appointment History (reschedules / status changes) */}
              {aptHistory.some((h) => h.changeType === 'RESCHEDULE' || h.changeType === 'STATUS') && (
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                  <span className="font-bold text-slate-700 dark:text-slate-300 block">ประวัตินัดหมาย</span>
                  <ul className="space-y-1">
                    {aptHistory
                      .filter((h) => h.changeType === 'RESCHEDULE' || h.changeType === 'STATUS')
                      .map((h) => (
                        <li key={h.id} className="text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-2">
                          <span className="font-mono text-slate-400">{new Date(h.createdAt).toLocaleString('th-TH')}</span>
                          {h.changeType === 'RESCHEDULE' ? (
                            <span>
                              เลื่อนนัดจาก {h.originalStart ? new Date(h.originalStart).toLocaleString('th-TH') : '-'} เป็น{' '}
                              {h.newStart ? new Date(h.newStart).toLocaleString('th-TH') : '-'}
                            </span>
                          ) : (
                            <span>
                              สถานะ {APPOINTMENT_STATUS_META[h.fromStatus as AppointmentStatus]?.label ?? h.fromStatus} →{' '}
                              {APPOINTMENT_STATUS_META[h.toStatus as AppointmentStatus]?.label ?? h.toStatus}
                            </span>
                          )}
                          {h.reason && <span className="text-slate-500">เหตุผล: {h.reason}</span>}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </AppModalBody>

            {/* Modal Footer */}
            <AppModalFooter>
              <div className="flex-1 flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  {!isAppointmentClosed(selectedApt.status) && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(selectedApt)}
                        className="h-9 px-3.5 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 hover:bg-blue-100 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-blue-200 dark:border-blue-900"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>แก้ไข / เลื่อนนัด</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReasonText('')
                          setReasonAction({ apt: selectedApt, status: 'CANCELLED' })
                        }}
                        className="h-9 px-3.5 rounded-xl bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-100 font-bold text-xs transition-colors cursor-pointer border border-red-200 dark:border-red-900"
                      >
                        ยกเลิกนัดหมาย
                      </button>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedApt(null)}
                  className="px-6 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs shadow-md transition-colors cursor-pointer"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </AppModalFooter>
          </>
        )}
      </AppModal>

      {/* WORK ORDER DISPATCH MODAL (สั่งงาน) */}
      <AppModal isOpen={!!orderApt} onClose={() => setOrderApt(null)} size="md">
        {orderApt && (
          <>
            <AppModalHeader
              onClose={() => setOrderApt(null)}
              icon={<Send className="w-5 h-5 text-emerald-600" />}
              title="สั่งงาน (Work Order Dispatch)"
            />
            <AppModalBody className="space-y-4">
              {/* Job Info Summary */}
              <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">{orderApt.title}</h4>
                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold border shrink-0 ${getTypeBadge(orderApt.type).bg}`}>
                    {getTypeBadge(orderApt.type).label}
                  </span>
                </div>
                <div className="text-xs space-y-1 text-slate-600 dark:text-slate-300">
                  <p>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">ลูกค้า:</span>{' '}
                    {orderApt.customerName} {orderApt.phone && `(${orderApt.phone})`}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">สถานที่:</span>{' '}
                    {orderApt.location || 'ไม่ได้ระบุสถานที่'}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">วัน/เวลา:</span>{' '}
                    📅 {orderApt.date} ⏰ {orderApt.startTime} - {orderApt.endTime} น.
                  </p>
                  {orderApt.details && (
                    <p className="italic text-slate-500 dark:text-slate-400 mt-1">
                      💬 {orderApt.details}
                    </p>
                  )}
                  {orderApt.items && orderApt.items.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 block mb-1">รายการสินค้า:</span>
                      <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 ml-1 space-y-0.5">
                        {orderApt.items.map((item, idx) => (
                          <li key={idx}>{item.name} (x{item.quantity})</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Employee Field */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  พนักงานผู้รับผิดชอบ
                </label>
                {orderApt.assigneeName ? (
                  <div className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 font-medium">
                    {orderApt.assigneeName} {orderApt.assigneeId ? `(${orderApt.assigneeId})` : ''}
                  </div>
                ) : (
                  <div className="px-3.5 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-900 text-xs text-slate-400 dark:text-slate-500 font-medium">
                    ยังไม่มีข้อมูลพนักงาน
                  </div>
                )}
              </div>

              {/* Channel / LINE Field */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  ช่องทางส่งงาน
                </label>
                <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">LINE Notify / OA</span>
                  </div>
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800">
                    LINE ยังไม่เชื่อม
                  </span>
                </div>
              </div>
            </AppModalBody>
            <AppModalFooter>
              <button
                type="button"
                onClick={() => setOrderApt(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ปิด
              </button>
              <button
                type="button"
                disabled
                className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 font-bold text-xs cursor-not-allowed border border-slate-300 dark:border-slate-700 flex items-center gap-2"
                title={
                  !orderApt.assigneeId && !orderApt.assigneeName
                    ? 'ยังไม่มีข้อมูลพนักงาน'
                    : 'LINE ยังไม่เชื่อม'
                }
              >
                <Send className="w-3.5 h-3.5" />
                สั่งงาน ({!orderApt.assigneeId && !orderApt.assigneeName ? 'ยังไม่มีข้อมูลพนักงาน' : 'LINE ยังไม่เชื่อม'})
              </button>
            </AppModalFooter>
          </>
        )}
      </AppModal>

      {/* WORK ORDER TIMELINE MODAL (สถานะงาน) */}
      <AppModal isOpen={!!timelineApt} onClose={() => setTimelineApt(null)} size="md">
        {timelineApt && (
          <>
            <AppModalHeader
              onClose={() => setTimelineApt(null)}
              icon={<ListChecks className="w-5 h-5 text-blue-600" />}
              title="สถานะงาน (Work Order Timeline)"
            />
            <AppModalBody className="space-y-4">
              {/* Overview Status Banner */}
              <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">{timelineApt.title}</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      ลูกค้า: {timelineApt.customerName} {timelineApt.location && `| 📍 ${timelineApt.location}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`px-2.5 py-1 rounded-full font-bold text-xs inline-block ${APPOINTMENT_STATUS_META[timelineApt.status].badge}`}>
                      {APPOINTMENT_STATUS_META[timelineApt.status].label}
                    </span>
                    <p className="text-[10px] text-slate-400 mt-0.5">ภาพรวมนัดหมาย</p>
                  </div>
                </div>
              </div>

              {/* Work Order Stage Flow */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  ขั้นตอนงาน (Work Order Stages)
                </p>
                <div className="relative pl-7 space-y-2 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
                  {(timelineApt.type === 'RETURN' ? WORK_ORDER_STAGES_RETURN : WORK_ORDER_STAGES_DELIVERY).map((stage, idx) => {
                    const matchedEvent = timelineApt.events?.find(
                      (e) => e.stage.toUpperCase() === stage.key.toUpperCase()
                    )
                    const isDone = matchedEvent?.status === 'DONE'

                    if (!matchedEvent) {
                      return (
                        <div
                          key={stage.key}
                          data-stage-key={stage.key}
                          className="relative flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50/70 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800"
                        >
                          <span className="absolute -left-7 flex items-center justify-center w-5 h-5 rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-[10px] font-bold text-slate-500 dark:text-slate-400 shadow-xs">
                            {idx + 1}
                          </span>
                          <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                            {stage.label}
                          </span>
                          <span className="text-[11px] text-slate-400 italic">
                            ยังไม่มีข้อมูล
                          </span>
                        </div>
                      )
                    }

                    return (
                      <div
                        key={stage.key}
                        data-stage-key={stage.key}
                        className={`relative p-2.5 rounded-xl border ${
                          isDone
                            ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                            : 'bg-slate-50/70 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <span
                          className={`absolute -left-7 flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold shadow-xs ${
                            isDone
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {isDone ? '✓' : idx + 1}
                        </span>

                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                            {stage.label}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isDone
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                                : matchedEvent.status === 'SKIPPED'
                                ? 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
                            }`}
                          >
                            {isDone
                              ? 'เสร็จสิ้น'
                              : matchedEvent.status === 'SKIPPED'
                              ? 'ข้าม'
                              : 'กำลังดำเนินการ'}
                          </span>
                        </div>

                        {/* Event Details: ผู้ดำเนินการ / เวลา / หมายเหตุ / รูป / จำนวนจริง / ปัญหา */}
                        <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-[11px] space-y-1 text-slate-600 dark:text-slate-300">
                          {matchedEvent.by && (
                            <p>
                              <span className="font-semibold text-slate-700 dark:text-slate-300">ผู้ดำเนินการ:</span>{' '}
                              {matchedEvent.by}
                            </p>
                          )}
                          {matchedEvent.timestamp && (
                            <p>
                              <span className="font-semibold text-slate-700 dark:text-slate-300">เวลา:</span>{' '}
                              {matchedEvent.timestamp}
                            </p>
                          )}
                          {matchedEvent.actualQuantity !== undefined && (
                            <p>
                              <span className="font-semibold text-slate-700 dark:text-slate-300">จำนวนจริง:</span>{' '}
                              {matchedEvent.actualQuantity}
                            </p>
                          )}
                          {matchedEvent.note && (
                            <p>
                              <span className="font-semibold text-slate-700 dark:text-slate-300">หมายเหตุ:</span>{' '}
                              {matchedEvent.note}
                            </p>
                          )}
                          {matchedEvent.issues && (
                            <p className="text-red-600 dark:text-red-400 font-medium">
                              <span className="font-semibold">ปัญหา:</span> {matchedEvent.issues}
                            </p>
                          )}
                          {matchedEvent.images && matchedEvent.images.length > 0 && (
                            <div className="pt-1">
                              <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                                รูปภาพ ({matchedEvent.images.length} รูป):
                              </span>
                              <div className="flex gap-1.5 flex-wrap">
                                {matchedEvent.images.map((imgUrl, imgIdx) => {
                                  return (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      key={imgIdx}
                                      src={imgUrl}
                                      alt={`event-img-${imgIdx}`}
                                      className="w-12 h-12 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
                                    />
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Status Note */}
              {(!timelineApt.events || timelineApt.events.length === 0) && (
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-800 dark:text-amber-300">
                  ⚠️ นัดหมายนี้ยังไม่มีการบันทึก Work Order Event รายขั้นตอน
                </div>
              )}
            </AppModalBody>
            <AppModalFooter>
              <button
                type="button"
                onClick={() => setTimelineApt(null)}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs shadow-md transition-colors cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
            </AppModalFooter>
          </>
        )}
      </AppModal>

      {/* Add Appointment Modal */}
      <AddAppointmentModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={(created) => {
          addAppointment(created)
            .then(setAppointments)
            .catch((err: unknown) => showToast('บันทึกนัดหมายไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR'))
        }}
        customers={customers}
        appointmentTypes={appointmentTypes}
        onAddAppointmentType={addAppointmentType}
        onUpdateAppointmentType={updateAppointmentType}
        onRemoveAppointmentType={removeAppointmentType}
      />

      {/* Edit Appointment Modal */}
      <AppModal isOpen={!!editingApt} onClose={() => setEditingApt(null)} size="lg">
        {editingApt && (
          <>
            <AppModalHeader
              onClose={() => setEditingApt(null)}
              icon={<Pencil className="w-5 h-5 text-blue-600" />}
              title="แก้ไขนัดหมาย"
            />

            <form onSubmit={handleUpdateAppointment} className="flex-1 min-h-0 flex flex-col">
              <AppModalBody className="space-y-4">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    หัวข้องานนัดหมาย <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="รายละเอียดงาน"
                    value={editFormData.title}
                    onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-bold text-slate-900 dark:text-slate-100"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">ประเภทนัดหมาย</label>
                    <CustomSelect
                      value={editFormData.appointmentTypeId || editFormData.type || 'DELIVERY'}
                      onChange={(val) => {
                        const matched = appointmentTypes.find((t) => t.id === val)
                        const validCodes: AppointmentType[] = ['DELIVERY', 'RETURN', 'PAYMENT', 'CONTRACT', 'QUOTATION', 'INSPECTION', 'GENERAL']
                        const code = (validCodes.includes(val as AppointmentType) ? val : 'GENERAL') as AppointmentType
                        setEditFormData((prev) => ({
                          ...prev,
                          type: code,
                          appointmentTypeId: matched?.id || val,
                        }))
                      }}
                      options={appointmentTypes.map((t) => ({ value: t.id, label: t.label }))}
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      ชื่อลูกค้า / บริษัท <span className="text-red-500">*</span>
                    </label>
                    <CustomerAutocomplete
                      value={editFormData.customerId}
                      customerName={editFormData.customerName}
                      customers={customers}
                      onChange={(cust, customName) => {
                        if (cust) {
                          setEditFormData((prev) => ({
                            ...prev,
                            customerId: cust.id,
                            customerName: cust.customerName,
                            phone: cust.phone || prev.phone,
                            location: cust.address || prev.location,
                          }))
                        } else {
                          setEditFormData((prev) => ({
                            ...prev,
                            customerId: undefined,
                            customerName: customName || '',
                          }))
                        }
                      }}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">วันที่นัดหมาย</label>
                    <CustomDatePicker
                      value={editFormData.date ? parseLocalDate(editFormData.date) : null}
                      onChange={(d) => setEditFormData({ ...editFormData, date: d ? getLocalDateString(d) : '' })}
                      align="left"
                      placeholder="เลือกวันที่..."
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">เวลาเริ่ม</label>
                    <input
                      type="time"
                      value={editFormData.startTime}
                      onChange={(e) => setEditFormData({ ...editFormData, startTime: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">เวลาสิ้นสุด</label>
                    <input
                      type="time"
                      value={editFormData.endTime}
                      onChange={(e) => setEditFormData({ ...editFormData, endTime: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">สถานที่ / หน้างาน</label>
                    <input
                      type="text"
                      placeholder="สถานที่จัดส่ง"
                      value={editFormData.location}
                      onChange={(e) => setEditFormData({ ...editFormData, location: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">เบอร์โทรติดต่อ</label>
                    <input
                      type="text"
                      placeholder="081-xxx-xxxx"
                      value={editFormData.phone}
                      onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">ผู้ติดต่อ (ถ้ามี)</label>
                    <input
                      type="text"
                      placeholder="ชื่อผู้ติดต่อ"
                      value={editFormData.contactPerson}
                      onChange={(e) => setEditFormData({ ...editFormData, contactPerson: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </div>

                  {isEditRescheduling && (
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        เหตุผลการเลื่อนนัด <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="เช่น ลูกค้าขอเลื่อน"
                        value={rescheduleReason}
                        onChange={(e) => setRescheduleReason(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-purple-300 dark:border-purple-800 bg-slate-50 dark:bg-slate-900"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    รายละเอียดงานเพิ่มเติม / สิ่งที่ต้องทำ
                  </label>
                  <textarea
                    rows={3}
                    placeholder="ระบุข้อความสิ่งที่ต้องทำ..."
                    value={editFormData.details}
                    onChange={(e) => setEditFormData({ ...editFormData, details: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </AppModalBody>

              <AppModalFooter>
                <button
                  type="button"
                  disabled={isEditSubmitting}
                  onClick={() => setEditingApt(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isEditSubmitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isEditSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>กำลังบันทึก...</span>
                    </>
                  ) : (
                    <span>บันทึกการแก้ไข</span>
                  )}
                </button>
              </AppModalFooter>
            </form>
          </>
        )}
      </AppModal>

      {/* Cancel / No-show Confirmation Modal (appointments are kept, never deleted) */}
      <AppModal isOpen={!!reasonAction} onClose={() => setReasonAction(null)} size="sm">
        {reasonAction && (
          <>
            <AppModalHeader
              onClose={() => setReasonAction(null)}
              icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
              title={reasonAction.status === 'CANCELLED' ? 'ยกเลิกนัดหมาย' : 'บันทึกว่าไม่มาตามนัด'}
            />

            <AppModalBody className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                นัดหมาย &quot;<span className="font-bold text-slate-800 dark:text-slate-200">{reasonAction.apt.title}</span>&quot; จะถูกเก็บไว้ในประวัติ พร้อมเหตุผล
              </p>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  เหตุผล {reasonAction.status === 'CANCELLED' && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder={reasonAction.status === 'CANCELLED' ? 'เช่น ลูกค้ายกเลิกงาน' : 'เช่น ติดต่อลูกค้าไม่ได้'}
                  className="w-full h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                />
              </div>
            </AppModalBody>

            <AppModalFooter
              onCancel={() => setReasonAction(null)}
              cancelText="ปิด"
              onConfirm={handleConfirmReasonAction}
              confirmText={reasonAction.status === 'CANCELLED' ? 'ยืนยันยกเลิกนัด' : 'ยืนยัน'}
              confirmButtonColor="red"
              isConfirmDisabled={updatingStatusId === reasonAction.apt.id || (reasonAction.status === 'CANCELLED' && !reasonText.trim())}
              isConfirmLoading={updatingStatusId === reasonAction.apt.id}
            />
          </>
        )}
      </AppModal>

    </div>
  )
}
