'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Send } from 'lucide-react'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { CustomSelect } from '@/components/common/CustomSelect'
import { useToast } from '@/components/common/Toast'
import { addAppointmentAndReturn } from '@/features/appointments/services/appointment-storage'
import { loadDrivers, type DeliveryDriver } from '@/features/appointments/services/driver-registry'
import { dispatchToDriver, type DispatchOutcome } from '@/features/appointments/services/dispatch-service'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { loadSystemSettings } from '@/features/settings/services/settings-storage'
import { CustomDatePicker, getLocalDateString, parseLocalDate } from '@/components/common/CustomDatePicker'
import { TimeField } from '@/features/appointments/components/AppointmentFormFields'
import type { FullBill } from '@/lib/types/rental-return'
import type { Appointment, AppointmentType } from '@/lib/types/rental-pos'

type WorkType = 'DELIVERY' | 'RETURN'

interface AppointmentDispatchModalProps {
  appointment?: Appointment
  sourceBill?: FullBill
  onClose: () => void
  onDispatched?: (appointments: Appointment[], outcome: DispatchOutcome, driver: DeliveryDriver) => void
  onAppointmentsChanged?: (appointments: Appointment[]) => void
}

const shopDateTime = (instant: Date) => {
  const timeZone = loadSystemSettings().timezone || 'Asia/Bangkok'
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant).map((part) => [part.type, part.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  }
}

export function AppointmentDispatchModal({
  appointment,
  sourceBill,
  onClose,
  onDispatched,
  onAppointmentsChanged,
}: AppointmentDispatchModalProps) {
  const { showToast } = useToast()
  const { user } = useAuth()
  const [drivers, setDrivers] = useState<DeliveryDriver[]>([])
  const [driverId, setDriverId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workType, setWorkType] = useState<WorkType | null>(null)
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([])
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledStart, setScheduledStart] = useState('')
  const [scheduledEnd, setScheduledEnd] = useState('')
  const [createdAppointment, setCreatedAppointment] = useState<Appointment | null>(null)

  useEffect(() => {
    setDrivers(loadDrivers())
    setDriverId(appointment?.driverId || '')
  }, [appointment])

  const activeDrivers = useMemo(
    () => drivers.filter((driver) => driver.active || driver.id === appointment?.driverId),
    [appointment?.driverId, drivers]
  )
  const selectedDriver = drivers.find((driver) => driver.id === driverId)
  const dispatchButtonLabel = appointment
    ? isSubmitting
      ? 'กำลังสั่งงาน...'
      : !selectedDriver
        ? activeDrivers.length === 0 ? 'สั่งงาน (ยังไม่มีข้อมูลพนักงาน)' : 'สั่งงาน (เลือกคนขับ)'
        : 'สั่งงาน'
    : isSubmitting
      ? 'กำลังสั่งงาน...'
      : !selectedDriver
        ? activeDrivers.length === 0 ? 'สั่งงานทันที (ยังไม่มีข้อมูลพนักงาน)' : 'สั่งงานทันที (เลือกคนขับ)'
        : 'สั่งงานทันที'

  const eligibleItems = useMemo(() => {
    if (!sourceBill || !workType) return []
    return sourceBill.items.filter((item) =>
      workType === 'DELIVERY'
        ? (item.remainingQty ?? 0) > 0
        : item.requiresReturn && item.outstandingQty > 0
    )
  }, [sourceBill, workType])

  const toggleLine = (lineId: string) => {
    setSelectedLineIds((current) =>
      current.includes(lineId) ? current.filter((id) => id !== lineId) : [...current, lineId]
    )
  }

  const createBillAppointment = async (
    schedule: { date: string; startTime: string; endTime: string }
  ): Promise<{ appointment: Appointment; appointments: Appointment[] }> => {
    if (!sourceBill || !workType) throw new Error('กรุณาเลือกประเภทงาน')
    const selected = eligibleItems.filter((item) => selectedLineIds.includes(item.rentalBillItemId))
    if (selected.length === 0) throw new Error('กรุณาเลือกรายการสินค้าอย่างน้อย 1 รายการ')

    const { date, startTime, endTime } = schedule
    if (!date || !startTime || !endTime) throw new Error('กรุณากำหนดวันและเวลาให้ครบ')
    if (endTime <= startTime) throw new Error('เวลาสิ้นสุดต้องหลังเวลาเริ่ม')

    const title = `${workType === 'RETURN' ? 'รับคืนสินค้า' : 'ส่งสินค้า'} ${sourceBill.billNo}`
    const items = selected.map((item) => ({
      id: item.productId,
      name: item.productName,
      quantity: workType === 'RETURN' ? item.outstandingQty : Number(item.remainingQty),
      unit: item.unit || undefined,
    }))
    const type: AppointmentType = workType
    return addAppointmentAndReturn({
      id: `bill-job-${Date.now()}`,
      title,
      type,
      customerId: sourceBill.customerId,
      customerName: sourceBill.customerName,
      phone: sourceBill.customerPhone,
      billId: sourceBill.id,
      billNo: sourceBill.billNo,
      location: sourceBill.siteName || sourceBill.customerAddress || '',
      date,
      startTime,
      endTime,
      status: 'SCHEDULED',
      items,
    })
  }

  const handleCreateAppointment = async () => {
    if (!sourceBill || isSubmitting || createdAppointment) return
    setIsSubmitting(true)
    try {
      const created = await createBillAppointment({
        date: scheduledDate,
        startTime: scheduledStart,
        endTime: scheduledEnd,
      })
      setCreatedAppointment(created.appointment)
      onAppointmentsChanged?.(created.appointments)
      showToast('บันทึกนัดหมายสำเร็จ', `${created.appointment.title} · ${created.appointment.date} ${created.appointment.startTime}`, 'SUCCESS')
      onClose()
    } catch (error) {
      showToast(
        'บันทึกนัดหมายไม่สำเร็จ',
        error instanceof Error ? error.message : undefined,
        'ERROR'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDispatch = async () => {
    if (!selectedDriver || isSubmitting) return
    setIsSubmitting(true)
    let createdDuringAttempt = false
    try {
      let target = createdAppointment || appointment
      if (!target && sourceBill) {
        const now = new Date()
        const quickStart = shopDateTime(now)
        const quickEnd = shopDateTime(new Date(now.getTime() + 60 * 60 * 1000))
        const created = await createBillAppointment({
          date: quickStart.date,
          startTime: quickStart.time,
          endTime: quickEnd.date === quickStart.date ? quickEnd.time : '23:59',
        })
        target = created.appointment
        setCreatedAppointment(created.appointment)
        createdDuringAttempt = true
        onAppointmentsChanged?.(created.appointments)
      }
      if (!target) throw new Error('ไม่พบงานสำหรับสั่งงาน')

      const outcome = await dispatchToDriver(target, selectedDriver, user?.displayName || user?.username || undefined)
      onDispatched?.(outcome.appointments, outcome, selectedDriver)
    } catch (error) {
      showToast(
        createdDuringAttempt || createdAppointment ? 'สร้างงานแล้ว แต่สั่งงานไม่สำเร็จ' : 'สั่งงานไม่สำเร็จ',
        error instanceof Error ? error.message : undefined,
        'ERROR'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AppModal isOpen onClose={onClose} size="md">
      <AppModalHeader onClose={onClose} icon={<Send className="w-5 h-5 text-emerald-600" />} title="สั่งงาน" />
      <AppModalBody className="space-y-4">
        <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
          <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
            {appointment?.title || (sourceBill ? `งานจากบิล ${sourceBill.billNo}` : '')}
          </h4>
          <p><span className="font-semibold text-slate-800 dark:text-slate-200">ลูกค้า:</span> {appointment?.customerName || sourceBill?.customerName || '-'}</p>
          {(appointment?.phone || sourceBill?.customerPhone) && <p><span className="font-semibold text-slate-800 dark:text-slate-200">โทร:</span> {appointment?.phone || sourceBill?.customerPhone}</p>}
          <p><span className="font-semibold text-slate-800 dark:text-slate-200">สถานที่:</span> {appointment?.location || sourceBill?.siteName || sourceBill?.customerAddress || 'ไม่ได้ระบุสถานที่'}</p>
          {appointment && <p><span className="font-semibold text-slate-800 dark:text-slate-200">วัน/เวลา:</span> {appointment.date} {appointment.startTime} - {appointment.endTime} น.</p>}
          {createdAppointment && <p className="text-emerald-700 dark:text-emerald-300 font-semibold">สร้างนัดหมายแล้ว · {createdAppointment.date} {createdAppointment.startTime}</p>}
        </div>

        {sourceBill && !createdAppointment && (
          <>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">วันและเวลานัดหมาย</label>
              <div className="grid grid-cols-3 gap-2">
                <label className="min-w-0 text-[11px] text-slate-600 dark:text-slate-300">วันที่
                  <CustomDatePicker
                    value={parseLocalDate(scheduledDate)}
                    onChange={(date) => setScheduledDate(date ? getLocalDateString(date) : '')}
                    placeholder="วว/ดด/ปปปป"
                    align="left"
                  />
                </label>
                <label className="min-w-0 text-[11px] text-slate-600 dark:text-slate-300">เริ่ม
                  <TimeField label="เวลาเริ่มงาน" value={scheduledStart} onChange={setScheduledStart} />
                </label>
                <label className="min-w-0 text-[11px] text-slate-600 dark:text-slate-300">สิ้นสุด
                  <TimeField label="เวลาสิ้นสุดงาน" value={scheduledEnd} onChange={setScheduledEnd} />
                </label>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">ประเภทงาน</label>
              <div className="grid grid-cols-2 gap-2">
                {(['DELIVERY', 'RETURN'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setWorkType(type)
                      setSelectedLineIds([])
                    }}
                    className={`h-8 rounded-lg border text-xs font-bold ${workType === type ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-700'}`}
                  >
                    {type === 'DELIVERY' ? 'ส่งของ' : 'รับคืน'}
                  </button>
                ))}
              </div>
              {workType && (
                <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {eligibleItems.length === 0 ? (
                    <p className="p-2 text-[11px] text-slate-500">ไม่มีรายการบิลที่เข้าเงื่อนไขประเภทงานนี้</p>
                  ) : eligibleItems.map((item) => {
                    const quantity = workType === 'RETURN' ? item.outstandingQty : Number(item.remainingQty)
                    return (
                      <label key={item.rentalBillItemId} className="flex items-center gap-2 p-2 text-xs cursor-pointer">
                        <input type="checkbox" checked={selectedLineIds.includes(item.rentalBillItemId)} onChange={() => toggleLine(item.rentalBillItemId)} />
                        <span className="min-w-0 flex-1 truncate">{item.productName}</span>
                        <span className="font-mono text-slate-500">เหลือ {quantity} {item.unit}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">คนขับ / พนักงานขนส่ง</label>
          {activeDrivers.length > 0 ? (
            <CustomSelect
              value={driverId}
              onChange={(value) => setDriverId(String(value))}
              options={activeDrivers.map((driver) => ({ value: driver.id, label: `${driver.id} ${driver.name}`, sublabel: driver.phone }))}
              placeholder="เลือกคนขับ"
              searchable
            />
          ) : (
            <div className="px-3.5 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-900 text-xs text-slate-400 dark:text-slate-500 font-medium">
              ยังไม่มีข้อมูลพนักงาน
              <span className="block text-[11px] mt-0.5">เพิ่มคนขับได้ที่ ตั้งค่าระบบ › LINE › ทะเบียนคนขับ</span>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">ช่องทางส่งงาน</label>
          <div className="flex items-center justify-between gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300">LINE OA ของร้าน</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium text-right">
              ส่งเข้า LINE ของคนขับที่ผูกไว้ · ถ้ายังส่งไม่ได้ ระบบยังบันทึกการสั่งงาน ให้แจ้งคนขับทางโทรศัพท์
              {selectedDriver?.phone ? ` ${selectedDriver.phone}` : ''}
            </span>
          </div>
        </div>
      </AppModalBody>
      <AppModalFooter>
        {sourceBill && !createdAppointment && (
          <button
            type="button"
            disabled={isSubmitting || !scheduledDate || !scheduledStart || !scheduledEnd || !workType || selectedLineIds.length === 0}
            onClick={() => void handleCreateAppointment()}
            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'กำลังบันทึก...' : 'นัดหมาย'}
          </button>
        )}
        {(appointment || createdAppointment) && (
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            ปิด
          </button>
        )}
        <button
          type="button"
          disabled={!selectedDriver || isSubmitting || (!!sourceBill && !createdAppointment && (!workType || selectedLineIds.length === 0))}
          onClick={() => void handleDispatch()}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs cursor-pointer disabled:bg-slate-200 disabled:dark:bg-slate-800 disabled:text-slate-400 disabled:dark:text-slate-500 disabled:cursor-not-allowed border border-transparent disabled:border-slate-300 disabled:dark:border-slate-700 flex items-center gap-2"
        >
          <Send className="w-3.5 h-3.5" />
          {dispatchButtonLabel}
        </button>
      </AppModalFooter>
    </AppModal>
  )
}
