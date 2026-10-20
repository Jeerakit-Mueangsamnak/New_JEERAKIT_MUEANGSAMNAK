'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import React, { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Plus, MapPin, Phone, User, Calendar, FileText, CheckSquare, Pencil, RefreshCw, Send } from 'lucide-react'
import { Appointment, Customer, AppointmentStatus } from '@/lib/types/rental-pos'
import { getLocalDateString, parseLocalDate } from '@/components/common/CustomDatePicker'
import { AppModalHeader, AppModalBody, AppModalFooter } from '@/components/common/AppModal'
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
import { AppointmentForm } from '@/features/appointments/components/AddAppointmentModal'
import { deleteJob, fetchDriverTaskState, unassignDriver, type DriverTaskState, type DispatchOutcome } from '@/features/appointments/services/dispatch-service'
import { AppointmentDispatchModal } from '@/features/appointments/components/AppointmentDispatchModal'
import { currentRunEvents, stagesForType } from '@/lib/work-order-stages'

const stagesFor = (apt: Appointment) => stagesForType(apt.type)
/** Steps of the current dispatch only (a re-dispatch starts again at รับงาน; older events stay as history). */
const runEvents = (apt: Appointment) => currentRunEvents(apt.events)
const isStageDone = (apt: Appointment, key: string) => runEvents(apt).some((e) => e.stage.toUpperCase() === key && e.status === 'DONE')
const currentStage = (apt: Appointment) => [...stagesFor(apt)].reverse().find((st) => isStageDone(apt, st.key))
const stageProgress = (apt: Appointment) => {
  const stages = stagesFor(apt)
  return Math.round((stages.filter((st) => isStageDone(apt, st.key)).length / stages.length) * 100)
}

/** Status column of a step that happened (สั่งงาน = the job is now in progress). */
const STAGE_DONE_LABEL: Record<string, string> = {
  DISPATCH: 'กำลังดำเนินการ',
  ACCEPT: 'รับงานแล้ว',
  PREPARE: 'เตรียมแล้ว',
  PREPARED: 'เตรียมเสร็จแล้ว',
  TRANSIT: 'ออกเดินทางแล้ว',
  ARRIVED: 'ถึงหน้างานแล้ว',
  INSPECT: 'ตรวจรายการแล้ว',
  COMPLETED: 'ส่งเสร็จแล้ว',
  COLLECTED: 'เก็บสินค้าแล้ว',
  RETURN: 'กลับร้านแล้ว',
  RECEIVED: 'รับคืนแล้ว',
  CLOSED: 'ปิดงานแล้ว',
}

/** HH:MM of a step (full date and time on hover); older records kept a display string, shown as-is. */
const showClock = (value?: string) => {
  if (!value) return ''
  const t = Date.parse(value)
  return Number.isNaN(t) ? value : new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Columns of the step table (header and rows share them so they line up). */
const STAGE_GRID = 'grid grid-cols-[minmax(0,1fr)_3.5rem_7.5rem] items-center gap-2'

/** YYYY-MM-DD -> DD/MM/BBBB (Buddhist year), e.g. 15/10/2569. */
const thaiDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : iso
}

/** Step times are stored as ISO; older records kept a Thai display string, shown as-is. */
const showTime = (value?: string) => {
  if (!value) return ''
  const t = Date.parse(value)
  return Number.isNaN(t) ? value : new Date(t).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

import {
  loadAppointments,
  fetchAppointmentsFromSupabase,
  addAppointment,
  updateAppointment,
  setAppointmentStatus,
  fetchAppointmentHistory,
  type AppointmentHistoryEntry,
} from '@/features/appointments/services/appointment-storage'
import { APPOINTMENT_STATUS_META, JOB_STATUS_META, isAppointmentClosed, jobStatusOf } from '@/features/appointments/appointment-status'
import { loadCustomers } from '@/features/customers/services/customer-storage'

const CalendarView = dynamic(
  () => import('@/features/appointments/components/CalendarView').then((mod) => mod.CalendarView),
  { ssr: false }
)

/** One side panel at a time: the form (add / edit) or the job details with its tabs. */
type Panel = { kind: 'form'; aptId?: string } | { kind: 'detail'; aptId: string } | null

export default function AppointmentsPage() {
  const { showToast } = useToast()
  const router = useRouter()
  const { user } = useAuth()

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [viewDate, setViewDate] = useState(() => getLocalDateString())
  const onCalendarDate = useCallback((d: Date) => setViewDate(getLocalDateString(d)), [])

  const [panel, setPanel] = useState<Panel>(null)
  const [detailTab, setDetailTab] = useState<'DETAIL' | 'STATUS'>('DETAIL')
  const panelApt = panel?.aptId ? appointments.find((a) => a.id === panel.aptId) ?? null : null

  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)
  // Cancel (reason) / close job: confirmed inside the panel (no second dialog)
  // DELETE = ยกเลิกงาน on the details (job deleted) · UNASSIGN = ยกเลิกงาน on the status tab (driver taken off) · COMPLETED = ปิดงาน
  const [reasonStatus, setReasonStatus] = useState<'DELETE' | 'UNASSIGN' | 'COMPLETED' | null>(null)
  const [reasonText, setReasonText] = useState('')
  const [aptHistory, setAptHistory] = useState<AppointmentHistoryEntry[]>([])

  // The one dispatch dialog (สั่งงาน)
  const [orderApt, setOrderApt] = useState<Appointment | null>(null)

  const [driverTask, setDriverTask] = useState<DriverTaskState | null>(null)

  const openDetail = (id: string, tab: 'DETAIL' | 'STATUS' = 'DETAIL') => {
    setPanel({ kind: 'detail', aptId: id })
    setDetailTab(tab)
    setReasonStatus(null)
  }
  const closePanel = () => {
    setPanel(null)
    setReasonStatus(null)
  }

  const handleDispatchComplete = (updated: Appointment[], outcome: DispatchOutcome, driver: { name: string; phone?: string }) => {
    setAppointments(updated)
    showToast(
      outcome.lineSent ? 'สั่งงานและส่งเข้า LINE คนขับแล้ว' : 'บันทึกการสั่งงานแล้ว',
      outcome.lineSent ? driver.name : `${driver.name} · ยังไม่ได้ส่งทาง LINE (${outcome.lineNote})${driver.phone ? ` แจ้งทางโทร ${driver.phone}` : ''}`,
      'SUCCESS'
    )
    if (outcome.withdrawNote) showToast('ถอนงานพนักงานคนเดิม', outcome.withdrawNote, 'INFO')
    setOrderApt(null)
  }

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

  // History of the open job (reloaded after each saved change)
  const historyAptId = panel?.kind === 'detail' ? panel.aptId : undefined
  const historyKey = panelApt ? `${panelApt.status}|${panelApt.date} ${panelApt.startTime}|${panelApt.events?.length ?? 0}` : ''
  useEffect(() => {
    setAptHistory([])
    setDriverTask(null)
    if (!historyAptId || process.env.NODE_ENV === 'test') return
    let cancelled = false
    fetchAppointmentHistory(historyAptId)
      .then((rows) => {
        if (!cancelled) setAptHistory(rows)
      })
      .catch((err) => logger.error('Failed to load appointment history:', err))
    // LINE side of the job (read only): sent / driver accepted / driver reported done
    fetchDriverTaskState(historyAptId).then((t) => {
      if (!cancelled) setDriverTask(t)
    })
    return () => {
      cancelled = true
    }
  }, [historyAptId, historyKey])

  const handleSaveForm = async (apt: Appointment, rescheduleReason?: string) => {
    if (panel?.kind === 'form' && panel.aptId) {
      setAppointments(await updateAppointment(apt, rescheduleReason))
      showToast('แก้ไขนัดหมายสำเร็จ', `อัปเดตนัดหมาย "${apt.title}" เรียบร้อยแล้ว`, 'SUCCESS')
      openDetail(apt.id)
    } else {
      setAppointments(await addAppointment(apt))
      showToast('บันทึกการนัดหมายสำเร็จ', `สร้างนัดหมาย "${apt.title}" เรียบร้อยแล้ว`, 'SUCCESS')
      closePanel()
    }
  }

  // STATUS CHANGE (lifecycle step; cancel / no-show ask a reason in the panel)
  const handleStatusChange = async (id: string, newStatus: AppointmentStatus, reason?: string) => {
    setUpdatingStatusId(id)
    try {
      setAppointments(await setAppointmentStatus(id, newStatus, reason))
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

  const handleConfirmReason = async () => {
    if (!panelApt || !reasonStatus) return
    if (reasonStatus === 'COMPLETED') {
      if (await handleStatusChange(panelApt.id, 'COMPLETED', reasonText)) {
        setReasonStatus(null)
        setReasonText('')
      }
      return
    }
    const job = panelApt
    const deleting = reasonStatus === 'DELETE'
    setUpdatingStatusId(job.id)
    try {
      const r = deleting ? await deleteJob(job) : await unassignDriver(job)
      setAppointments(r.appointments)
      showToast(deleting ? 'ลบงานแล้ว' : 'ถอนงานจากพนักงานแล้ว', deleting ? job.title : 'สั่งงานให้พนักงานคนใหม่ได้', 'SUCCESS')
      if (r.note) showToast('แจ้งพนักงานทาง LINE', r.note, r.lineOk ? 'INFO' : 'ERROR')
      setReasonStatus(null)
      if (deleting) closePanel()
    } catch (err) {
      showToast(deleting ? 'ลบงานไม่สำเร็จ' : 'ถอนงานไม่สำเร็จ', err instanceof Error ? err.message : undefined, 'ERROR')
    } finally {
      setUpdatingStatusId(null)
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

  // KPI Calculations ("ใกล้ถึงกำหนด" window comes from Settings › นัดหมาย / แจ้งเตือน)
  // "ใกล้ถึงกำหนด" window = the member's own appointment notice days (ตั้งค่าส่วนตัว › การแจ้งเตือน).
  const nearDays = Math.max(0, Number(user?.notificationPrefs?.appointmentReminder?.daysBefore ?? 3))
  const todayTasksCount = appointments.filter(a => a.date === todayStr && !isAppointmentClosed(a.status)).length
  // เลยกำหนด = open jobs past their end time and not dispatched (same rule as the job status)
  const overdueTasksCount = appointments.filter((a) => jobStatusOf(a) === 'OVERDUE').length
  const completedTasksCount = appointments.filter(a => a.status === 'COMPLETED').length
  const nearTasksCount = appointments.filter(a => {
    if (isAppointmentClosed(a.status)) return false;
    const taskDate = parseLocalDate(a.date);
    if (!taskDate) return false;
    const diffTime = taskDate.getTime() - new Date().getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= nearDays
  }).length

  /** Day view: the work list of one day (open a row for details and status). */
  const renderDay = (date: Date) => {
    const key = getLocalDateString(date)
    const rows = appointments
      .filter((a) => a.date === key)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
    return (
      <DataTableFrame
        className="flex-1 min-h-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
        fill
        rowCount={rows.length}
        empty={rows.length === 0}
        emptyState={
          <div className="h-full min-h-[160px] flex items-center justify-center text-center text-slate-400 font-bold text-xs">
            ไม่มีนัดหมายในวันนี้
          </div>
        }
      >
        <table className="w-full text-left border-collapse table-auto text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
              <th className="px-2 text-center w-10">ลำดับ</th>
              <th className="px-2 w-[28%]">ชื่องาน</th>
              <th className="px-2">ผู้ดำเนินการ</th>
              <th className="px-2 text-center">สถานะ</th>
              <th className="px-2">ขั้นงาน</th>
              <th className="px-2 whitespace-nowrap">เวลา</th>
              <th className="px-2 w-[14%]">ความคืบหน้า</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((apt, idx) => {
              const statusMeta = JOB_STATUS_META[jobStatusOf(apt)]
              const progress = stageProgress(apt)
              return (
                <tr
                  key={apt.id}
                  onClick={() => openDetail(apt.id)}
                  className={`cursor-pointer transition-colors ${
                    panel?.aptId === apt.id ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <td className="px-2 text-center text-slate-500">{idx + 1}</td>
                  <td className="px-2 max-w-0">
                    <p className="font-bold text-slate-900 dark:text-slate-100 truncate" title={apt.title}>{apt.title}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{apt.customerName || '-'}</p>
                  </td>
                  <td className="px-2 whitespace-nowrap">{apt.driverName || '-'}</td>
                  <td className="px-2 text-center whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] inline-block ${statusMeta.badge}`}>{statusMeta.label}</span>
                  </td>
                  <td className="px-2 whitespace-nowrap text-blue-700 dark:text-blue-300 font-semibold">
                    {currentStage(apt)?.label ?? <span className="text-slate-400 font-normal">ยังไม่สั่งงาน</span>}
                  </td>
                  <td className="px-2 whitespace-nowrap font-mono">{apt.startTime} - {apt.endTime}</td>
                  <td className="px-2 min-w-[110px]">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="w-8 text-right text-[10px] text-slate-500">{progress}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </DataTableFrame>
    )
  }

  /** Time the job was closed: the saved status change to COMPLETED (Appointment History). */
  const closedAt = () => [...aptHistory].reverse().find((h) => h.changeType === 'STATUS' && h.toStatus === 'COMPLETED')?.createdAt

  const formApt = panel?.kind === 'form' && panel.aptId ? panelApt : null

  return (
    <div className="h-full min-h-0 min-w-0 p-2 bg-slate-100 dark:bg-slate-900 flex flex-col overflow-hidden">
      {/* Mini Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2 shrink-0">
        {[
          // Products page card tones (light background, border, label and number in the card's colour)
          { label: 'งานวันนี้', value: todayTasksCount, box: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200/60 dark:border-blue-900/40', title: 'text-blue-700 dark:text-blue-300', num: 'text-blue-600 dark:text-blue-400' },
          { label: `ใกล้ถึงกำหนด (${nearDays} วัน)`, value: nearTasksCount, box: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200/60 dark:border-purple-900/40', title: 'text-purple-700 dark:text-purple-300', num: 'text-purple-600 dark:text-purple-400' },
          { label: 'เลยกำหนด', value: overdueTasksCount, box: 'bg-orange-50 dark:bg-orange-950/30 border-orange-200/60 dark:border-orange-900/40', title: 'text-orange-700 dark:text-orange-300', num: 'text-orange-600 dark:text-orange-400' },
          { label: 'งานเสร็จสิ้น', value: completedTasksCount, box: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-900/40', title: 'text-emerald-700 dark:text-emerald-300', num: 'text-emerald-600 dark:text-emerald-400' },
        ].map((c) => (
          <div
            key={c.label}
            data-testid="kpi-card"
            className={`p-3 rounded-2xl border shadow-xs flex flex-col items-center justify-center ${c.box}`}
          >
            <span className={`text-[11px] font-semibold ${c.title}`}>{c.label}</span>
            <span className={`text-xl font-black ${c.num}`}>{c.value}</span>
          </div>
        ))}
      </div>

      {/* Calendar (main area) + one side panel */}
      <div className="relative flex-1 min-h-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 p-1 flex flex-col">
          {isLoading ? (
            <div className="flex-1 min-h-0 p-6 flex flex-col items-center justify-center text-slate-400 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
              <span className="font-bold text-xs">กำลังโหลดข้อมูลนัดหมายจากฐานข้อมูล...</span>
            </div>
          ) : (
            <CalendarView
              events={calendarEvents}
              onEventClick={(id) => openDetail(id)}
              onDateChange={onCalendarDate}
              renderDay={renderDay}
              actions={
                <>
                  <ActionButton
                    onClick={loadData}
                    variant="neutral"
                    className="w-8 h-7 px-0"
                    title="รีเฟรชข้อมูล"
                    icon={<RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />}
                  />
                  <ActionButton
                    onClick={() => {
                      setPanel({ kind: 'form' })
                      setReasonStatus(null)
                    }}
                    variant="primary"
                    className="h-7"
                    title="เพิ่มนัดหมายใหม่"
                    icon={<Plus className="w-4 h-4" />}
                  >
                    เพิ่มนัดหมาย
                  </ActionButton>
                </>
              }
            />
          )}
        </div>

        {panel && (
          <aside
            aria-label={panel.kind === 'form' ? (formApt ? 'แก้ไขนัดหมาย' : 'เพิ่มนัดหมายใหม่') : 'รายละเอียดงาน'}
            className="absolute inset-y-0 right-0 z-30 w-full sm:w-[420px] lg:static lg:z-auto shrink-0 flex flex-col border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl lg:shadow-none"
          >
            {panel.kind === 'form' ? (
              <>
                <AppModalHeader
                  onClose={closePanel}
                  icon={formApt ? <Pencil className="w-5 h-5 text-blue-600" /> : <Calendar className="w-5 h-5 text-emerald-600" />}
                  title={formApt ? 'แก้ไขงาน' : 'เพิ่มนัดหมายใหม่'}
                />
                <AppointmentForm
                  initial={formApt}
                  initialDate={viewDate}
                  customers={customers}
                  onSubmit={handleSaveForm}
                  onCancel={() => (formApt ? openDetail(formApt.id) : closePanel())}
                />
              </>
            ) : panelApt ? (
              <>
                <AppModalHeader onClose={closePanel}>
                  <div className={TAB_CONTAINER_CLASSES}>
                    {[
                      { key: 'DETAIL' as const, label: 'รายละเอียด' },
                      { key: 'STATUS' as const, label: 'สถานะ' },
                    ].map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setDetailTab(t.key)}
                        className={`${TAB_BUTTON_BASE_CLASSES} ${detailTab === t.key ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </AppModalHeader>

                {(() => {
                  const job = JOB_STATUS_META[jobStatusOf(panelApt)]
                  const open = !isAppointmentClosed(panelApt.status)
                  const header = (
                    <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                      <div className="flex justify-between items-start gap-2">
                        <h2 className="text-sm font-black text-slate-900 dark:text-slate-100 min-w-0 break-words">{panelApt.title}</h2>
                        <span data-testid="job-status" className={`px-2 py-0.5 rounded-full font-bold text-[11px] shrink-0 ${job.badge}`}>
                          {job.label}
                        </span>
                      </div>
                      <p data-testid="job-schedule" className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                        <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
                        <span>
                          กำหนดการ {panelApt.startTime} - {panelApt.endTime} น. {thaiDate(panelApt.date)}
                        </span>
                      </p>
                    </div>
                  )
                  const box = 'p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1'
                  const boxTitle = 'flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300'
                  const confirmText = {
                    DELETE: 'ยกเลิกงาน: ลบงานนี้ออกจากระบบถาวร (หายจากปฏิทินและรายการงาน) · ถ้าสั่งงานไว้ ระบบแจ้งพนักงานทาง LINE',
                    UNASSIGN: 'ยกเลิกงาน: ถอนงานจากพนักงานคนนี้ (แจ้งทาง LINE และตัดสิทธิ์กดอัปเดต) · งานยังอยู่ สั่งคนใหม่ได้',
                    COMPLETED: 'ปิดงาน (ปิดแล้วแก้ไขหรือสั่งงานต่อไม่ได้)',
                  }
                  const reasonBox = reasonStatus && (
                    <div className="p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/30 space-y-2">
                      <p className="font-bold text-red-700 dark:text-red-300">{confirmText[reasonStatus]}</p>
                      {reasonStatus === 'COMPLETED' && (
                        <input
                          type="text"
                          aria-label="หมายเหตุ"
                          value={reasonText}
                          onChange={(e) => setReasonText(e.target.value)}
                          placeholder="หมายเหตุ (ถ้ามี)"
                          className="w-full h-8 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        />
                      )}
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setReasonStatus(null)}
                          className="h-8 px-3 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
                        >
                          ไม่ใช่ตอนนี้
                        </button>
                        <button
                          type="button"
                          disabled={updatingStatusId === panelApt.id}
                          onClick={() => void handleConfirmReason()}
                          className={`h-8 px-3 rounded-xl text-white font-bold text-xs cursor-pointer disabled:opacity-50 ${
                            reasonStatus === 'COMPLETED' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                          }`}
                        >
                          {reasonStatus === 'DELETE' ? 'ยืนยันลบงาน' : reasonStatus === 'UNASSIGN' ? 'ยืนยันถอนงาน' : 'ยืนยันปิดงาน'}
                        </button>
                      </div>
                    </div>
                  )
                  const btn = 'h-8 px-3 rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer border disabled:opacity-50 disabled:cursor-not-allowed'
                  // ยกเลิกงาน: details = delete the job · status tab = take the driver off (only while dispatched)
                  const cancelBtn = (kind: 'DELETE' | 'UNASSIGN') => (
                    <button
                      type="button"
                      disabled={kind === 'UNASSIGN' && !panelApt.driverId}
                      title={kind === 'UNASSIGN' && !panelApt.driverId ? 'ยังไม่ได้สั่งงานให้พนักงาน' : undefined}
                      onClick={() => {
                        setReasonText('')
                        setReasonStatus(kind)
                      }}
                      className={`${btn} bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-100 border-red-200 dark:border-red-900`}
                    >
                      ยกเลิกงาน
                    </button>
                  )

                  if (detailTab === 'DETAIL') {
                    const items = panelApt.items ?? []
                    return (
                      <>
                        <AppModalBody className="space-y-3">
                          {header}

                          <div className={`${box} !space-y-0 grid grid-cols-[2fr_3fr] gap-3`}>
                            <div className="min-w-0 space-y-1">
                              <div className={boxTitle}>
                                <User className="w-4 h-4 text-emerald-600" />
                                <span>ข้อมูลลูกค้า</span>
                              </div>
                              <p className="font-bold text-slate-900 dark:text-slate-100 break-words">{panelApt.customerName || '-'}</p>
                              {panelApt.phone && (
                                <p className="text-blue-600 dark:text-blue-400 font-mono font-bold flex items-center gap-1">
                                  <Phone className="w-3 h-3" />
                                  <span>{panelApt.phone}</span>
                                </p>
                              )}
                            </div>
                            <div className="min-w-0 space-y-1 border-l border-slate-200 dark:border-slate-700 pl-3">
                              <div className={boxTitle}>
                                <MapPin className="w-4 h-4 text-red-500" />
                                <span>สถานที่จัดส่ง</span>
                              </div>
                              <p className={panelApt.location ? 'text-slate-800 dark:text-slate-200 whitespace-pre-line break-words' : 'text-slate-400 italic'}>
                                {panelApt.location || 'ไม่ได้ระบุสถานที่'}
                              </p>
                            </div>
                          </div>

                          {items.length > 0 ? (
                            <DataTableFrame
                              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              bodyClassName="!min-h-0"
                              rowCount={items.length}
                            >
                              <table className="w-full text-left border-collapse table-auto text-xs">
                                <thead>
                                  <tr className="text-slate-700 dark:text-slate-300">
                                    <th className="px-2 w-12 text-center">ลำดับ</th>
                                    <th className="px-2">รายการสินค้า</th>
                                    <th className="px-2 w-24 text-right">จำนวน</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {items.map((item, idx) => (
                                    <tr key={`${item.id}-${idx}`}>
                                      <td className="px-2 text-center text-slate-500">{idx + 1}</td>
                                      <td className="px-2 font-semibold text-slate-800 dark:text-slate-200">{item.name}</td>
                                      <td className="px-2 text-right font-mono">
                                        {item.quantity}
                                        {item.unit ? ` ${item.unit}` : ''}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </DataTableFrame>
                          ) : (
                            <div className={box}>
                              <div className={boxTitle}>
                                <CheckSquare className="w-4 h-4 text-blue-600" />
                                <span>รายละเอียดงานเพิ่มเติม / สิ่งที่ต้องทำ</span>
                              </div>
                              <p className={`whitespace-pre-line ${panelApt.details ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 italic'}`}>
                                {panelApt.details || 'ไม่มีรายละเอียดเพิ่มเติม'}
                              </p>
                            </div>
                          )}

                          {(panelApt.billNo || panelApt.quotationNo) && (
                            <div className={box}>
                              <div className={boxTitle}>
                                <FileText className="w-4 h-4 text-amber-500" />
                                <span>เอกสารที่เกี่ยวข้อง</span>
                              </div>
                              {panelApt.billNo && (
                                <div className="flex items-center justify-between gap-1">
                                  <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400 truncate">{panelApt.billNo}</p>
                                  {panelApt.billId && (
                                    <ActionButton
                                      variant="outline"
                                      onClick={() => handleBillClick(panelApt)}
                                      className="h-6 px-2 text-[11px] rounded-lg"
                                      title={`เปิดบิล ${panelApt.billNo}`}
                                    >
                                      ดูบิล
                                    </ActionButton>
                                  )}
                                </div>
                              )}
                              {panelApt.quotationNo && <p className="font-mono font-bold text-blue-600 dark:text-blue-400">{panelApt.quotationNo}</p>}
                            </div>
                          )}

                          {reasonBox}
                        </AppModalBody>
                        {open && (
                          <AppModalFooter className="justify-between">
                            {!panelApt.billId && (
                              <button
                                type="button"
                                onClick={() => router.push(`/pos?appointmentId=${encodeURIComponent(panelApt.id)}`)}
                                className={`${btn} bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 border-emerald-200 dark:border-emerald-900`}
                              >
                                <FileText className="w-3.5 h-3.5" />
                                <span>สร้างบิล</span>
                              </button>
                            )}
                            <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setPanel({ kind: 'form', aptId: panelApt.id })}
                              className={`${btn} bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 hover:bg-blue-100 border-blue-200 dark:border-blue-900`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>แก้ไข</span>
                            </button>
                            {cancelBtn('DELETE')}
                            <button
                              type="button"
                              onClick={() => setOrderApt(panelApt)}
                              className={`${btn} bg-blue-600 hover:bg-blue-700 text-white border-blue-600`}
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>สั่งงาน</span>
                            </button>
                            </div>
                          </AppModalFooter>
                        )}
                      </>
                    )
                  }

                  const closedTime = closedAt()
                  const canClose = jobStatusOf(panelApt) === 'IN_PROGRESS'
                  return (
                    <>
                      <AppModalBody className="space-y-3">
                        {panelApt.driverName && (
                          <div className="px-1 text-slate-500 dark:text-slate-400 space-y-0.5">
                            <p className="truncate">
                              ผู้รับผิดชอบ: {panelApt.driverName} ({panelApt.driverId})
                            </p>
                            {driverTask && driverTask.driverCode === panelApt.driverId && (
                              <p className="truncate" data-testid="driver-line-state">
                                LINE: {driverTask.label}
                              </p>
                            )}
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <div role="row" className={`${STAGE_GRID} px-2 text-[11px] font-bold text-slate-500 dark:text-slate-400`}>
                            <span role="columnheader">ขั้นตอนงาน</span>
                            <span role="columnheader" className="text-center">เวลา</span>
                            <span role="columnheader" className="text-right">สถานะ</span>
                          </div>
                          {stagesFor(panelApt).map((stage, idx) => {
                            // A step can be saved again (re-dispatch): the row shows the latest record of it
                            const ev = [...runEvents(panelApt)].reverse().find((e) => e.stage.toUpperCase() === stage.key)
                            const closedRow = stage.key === 'CLOSED' && !ev && !!closedTime
                            const done = ev?.status === 'DONE' || closedRow
                            const at = closedRow ? closedTime : ev?.timestamp
                            const state =
                              !ev && !closedRow
                                ? 'ยังไม่มีข้อมูล'
                                : done
                                ? STAGE_DONE_LABEL[stage.key] ?? 'เสร็จแล้ว'
                                : ev?.status === 'SKIPPED'
                                ? 'ข้าม'
                                : 'กำลังดำเนินการ'
                            return (
                              <div
                                key={stage.key}
                                data-stage-key={stage.key}
                                className={`p-2 rounded-xl border ${
                                  done
                                    ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                                    : 'bg-slate-50/70 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800'
                                }`}
                              >
                                <div className={STAGE_GRID}>
                                  <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                                    {idx + 1}. {stage.label}
                                  </span>
                                  <span className="font-mono text-center text-slate-700 dark:text-slate-300" title={at ? showTime(at) : undefined}>
                                    {at ? showClock(at) : '—'}
                                  </span>
                                  <span
                                    className={`text-right text-[11px] font-semibold ${
                                      done ? 'text-emerald-700 dark:text-emerald-300' : ev ? 'text-amber-700 dark:text-amber-300' : 'text-slate-400 italic'
                                    }`}
                                  >
                                    {state}
                                  </span>
                                </div>
                                {ev && (ev.by || ev.note || ev.issues || ev.actualQuantity !== undefined || (ev.images && ev.images.length > 0)) && (
                                  <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
                                    {ev.by && <p>โดย {ev.by}</p>}
                                    {ev.actualQuantity !== undefined && <p>จำนวนจริง: {ev.actualQuantity}</p>}
                                    {ev.note && <p>หมายเหตุ: {ev.note}</p>}
                                    {ev.issues && <p className="text-red-600 dark:text-red-400">ปัญหา: {ev.issues}</p>}
                                    {ev.images && ev.images.length > 0 && (
                                      <div className="flex gap-1.5 flex-wrap pt-0.5">
                                        {ev.images.map((imgUrl, imgIdx) => (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            key={imgIdx}
                                            src={imgUrl}
                                            alt={`event-img-${imgIdx}`}
                                            className="w-10 h-10 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>

                        {reasonBox}
                      </AppModalBody>
                      {open && (
                        <AppModalFooter className="justify-end">
                          {cancelBtn('UNASSIGN')}
                          <button
                            type="button"
                            disabled={!canClose}
                            title={canClose ? undefined : 'ปิดงานได้หลังสั่งงานแล้ว'}
                            onClick={() => {
                              setReasonText('')
                              setReasonStatus('COMPLETED')
                            }}
                            className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600`}
                          >
                            ปิดงาน
                          </button>
                        </AppModalFooter>
                      )}
                    </>
                  )
                })()}
              </>
            ) : null}
          </aside>
        )}
      </div>

      {orderApt && (
        <AppointmentDispatchModal
          appointment={orderApt}
          onClose={() => setOrderApt(null)}
          onDispatched={handleDispatchComplete}
          onAppointmentsChanged={setAppointments}
        />
      )}
    </div>
  )
}
