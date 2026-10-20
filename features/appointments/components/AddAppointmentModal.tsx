'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Calendar, RefreshCw, Trash2 } from 'lucide-react'
import { Appointment, Customer } from '@/lib/types/rental-pos'
import { CustomDatePicker, getLocalDateString, parseLocalDate } from '@/components/common/CustomDatePicker'
import { CustomSelect } from '@/components/common/CustomSelect'
import { CustomerAutocomplete } from '@/components/common/CustomerAutocomplete'
import { NumericInput } from '@/components/common/NumericInput'
import { DataTableFrame } from '@/components/common/DataTableFrame'
import { AppModal, AppModalHeader, AppModalBody, AppModalFooter } from '@/components/common/AppModal'
import { useToast } from '@/components/common/Toast'
import { logger } from '@/lib/utils/logger'
import { loadProducts } from '@/features/products/services/product-storage'
import { loadCategories } from '@/lib/category-rules-storage'
import { TimeField } from '@/features/appointments/components/AppointmentFormFields'

export const getInitialAppointmentFormData = (dateStr?: string): Partial<Appointment> => ({
  type: 'DELIVERY',
  title: '',
  customerId: undefined,
  customerName: '',
  billNo: '',
  quotationNo: '',
  date: dateStr || getLocalDateString(),
  startTime: '09:00',
  endTime: '10:00',
  location: '',
  phone: '',
  details: '',
  status: 'SCHEDULED',
  items: [],
})

export interface AppointmentFormProps {
  /** Edit mode when given: status and type stay as saved (status is worked out by the system). */
  initial?: Appointment | null
  initialDate?: string
  customers?: Customer[]
  /** Resolves when saved; a rejection keeps the form open with the error shown as a toast. */
  onSubmit: (appointment: Appointment, rescheduleReason?: string) => Promise<void> | void
  onCancel: () => void
}

const INPUT = 'w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900'
const LABEL = 'block font-semibold text-slate-700 dark:text-slate-300 mb-1'

const formFromAppointment = (apt: Appointment): Partial<Appointment> => ({
  type: apt.type,
  title: apt.title || '',
  appointmentTypeId: apt.appointmentTypeId,
  appointmentTypeLabel: apt.appointmentTypeLabel,
  customerId: apt.customerId,
  customerName: apt.customerName,
  billNo: apt.billNo || '',
  quotationNo: apt.quotationNo || '',
  date: apt.date,
  startTime: apt.startTime,
  endTime: apt.endTime,
  location: apt.location || '',
  phone: apt.phone || '',
  details: apt.details || '',
  status: apt.status,
  items: (apt.items ?? []).map((i) => ({ ...i })),
})

/** The one appointment form: add (quick-add modal, side panel) and edit / reschedule (side panel). */
export function AppointmentForm({ initial, initialDate, customers = [], onSubmit, onCancel }: AppointmentFormProps) {
  const { showToast } = useToast()
  const isEdit = Boolean(initial)

  // Products for the job: real categories / products (no bill, payment or stock change)
  const categories = useMemo(() => loadCategories().filter((c) => c.isActive !== false), [])
  const products = useMemo(() => loadProducts().filter((p) => p.status !== 'INACTIVE'), [])
  const [categoryId, setCategoryId] = useState('')

  const [formData, setFormData] = useState<Partial<Appointment>>(() =>
    initial ? formFromAppointment(initial) : getInitialAppointmentFormData(initialDate)
  )
  const [rescheduleReason, setRescheduleReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const initialId = initial?.id
  useEffect(() => {
    setFormData(initial ? formFromAppointment(initial) : getInitialAppointmentFormData(initialDate))
    setRescheduleReason('')
    setIsSubmitting(false)
    setCategoryId('')
    // re-seed only when another appointment / day is opened, not on every parent render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId, initialDate])

  const isRescheduling = Boolean(
    initial && (formData.date !== initial.date || formData.startTime !== initial.startTime || formData.endTime !== initial.endTime)
  )

  const items = formData.items ?? []
  const selectedCategory = categories.find((c) => c.id === categoryId)
  const productOptions = products
    .filter((p) => !selectedCategory || p.categoryId === selectedCategory.id || p.category === selectedCategory.name)
    .map((p) => ({ value: p.id, label: p.name, sublabel: p.unit || undefined }))
  const addItem = (productId: string) => {
    const p = products.find((x) => x.id === productId)
    if (!p) return
    if (items.some((i) => i.id === p.id)) {
      showToast('มีสินค้านี้ในรายการแล้ว', 'แก้จำนวนในตารางได้เลย', 'INFO')
      return
    }
    setFormData((prev) => ({ ...prev, items: [...(prev.items ?? []), { id: p.id, name: p.name, quantity: 1, ...(p.unit ? { unit: p.unit } : {}) }] }))
  }
  const setItemQty = (id: string, quantity: number) =>
    setFormData((prev) => ({ ...prev, items: (prev.items ?? []).map((i) => (i.id === id ? { ...i, quantity } : i)) }))
  const removeItem = (id: string) => setFormData((prev) => ({ ...prev, items: (prev.items ?? []).filter((i) => i.id !== id) }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = (formData.title ?? '').trim()
    if (!title) {
      showToast('กรุณาระบุชื่องาน', undefined, 'ERROR')
      return
    }
    if (!formData.date || !formData.startTime || !formData.endTime) {
      showToast('กรุณาระบุวันและเวลาให้ครบ', undefined, 'ERROR')
      return
    }
    if (formData.endTime < formData.startTime) {
      showToast('เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม', undefined, 'ERROR')
      return
    }
    if (isRescheduling && !rescheduleReason.trim()) {
      showToast('กรุณาระบุเหตุผลการเลื่อนนัด', undefined, 'ERROR')
      return
    }
    if (items.some((i) => !(Number(i.quantity) > 0))) {
      showToast('จำนวนสินค้าต้องมากกว่า 0', undefined, 'ERROR')
      return
    }

    setIsSubmitting(true)
    try {
      const appointment: Appointment = initial
        ? { ...initial, ...(formData as Appointment), title, status: initial.status }
        : { ...(formData as Appointment), title, status: 'SCHEDULED', id: `apt-${Date.now()}`, createdAt: new Date().toISOString() }
      await onSubmit(appointment, isRescheduling ? rescheduleReason.trim() : undefined)
    } catch (err: any) {
      logger.error('Save appointment error:', err)
      showToast(isEdit ? 'แก้ไขไม่สำเร็จ' : 'บันทึกนัดหมายไม่สำเร็จ', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
      <AppModalBody className="space-y-3">
        <div>
          <label className={LABEL} htmlFor="apt-title">
            ชื่องาน <span className="text-red-500">*</span>
          </label>
          <input
            id="apt-title"
            type="text"
            autoComplete="off"
            maxLength={200}
            placeholder="เช่น ส่งสินค้า, เก็บแบบ"
            value={formData.title ?? ''}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className={INPUT}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>
              ชื่อลูกค้า / บริษัท <span className="text-red-500">*</span>
            </label>
            <CustomerAutocomplete
              value={formData.customerId}
              customerName={formData.customerName}
              customers={customers}
              onChange={(cust, customName) => {
                // The site is typed by the user only: changing the customer never touches it.
                if (cust) {
                  setFormData((prev) => ({ ...prev, customerId: cust.id, customerName: cust.customerName, phone: cust.phone || prev.phone }))
                } else {
                  setFormData((prev) => ({ ...prev, customerId: undefined, customerName: customName || '' }))
                }
              }}
              required
            />
          </div>
          <div>
            <label className={LABEL}>เบอร์โทรติดต่อ</label>
            <input
              type="text"
              placeholder="081-xxx-xxxx"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className={`${INPUT} font-mono`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL} htmlFor="apt-location">สถานที่จัดส่ง</label>
            <input
              id="apt-location"
              type="text"
              autoComplete="off"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>วันที่นัดหมาย</label>
            <CustomDatePicker
              value={formData.date ? parseLocalDate(formData.date) : null}
              onChange={(d) => setFormData({ ...formData, date: d ? getLocalDateString(d) : '' })}
              align="left"
              placeholder="เลือกวันที่..."
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>เวลาเริ่ม</label>
            <TimeField label="เวลาเริ่ม" value={formData.startTime || ''} onChange={(t) => setFormData((prev) => ({ ...prev, startTime: t }))} />
          </div>
          <div>
            <label className={LABEL}>เวลาสิ้นสุด</label>
            <TimeField label="เวลาสิ้นสุด" value={formData.endTime || ''} onChange={(t) => setFormData((prev) => ({ ...prev, endTime: t }))} />
          </div>
        </div>

        {isRescheduling && (
          <div>
            <label className={LABEL}>
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

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>หมวดหมู่สินค้า</label>
              <CustomSelect
                value={categoryId}
                onChange={(val) => setCategoryId(String(val))}
                options={[{ value: '', label: 'ทุกหมวดหมู่' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
                placeholder="ทุกหมวดหมู่"
              />
            </div>
            <div>
              <label className={LABEL}>สินค้า</label>
              <CustomSelect
                value=""
                onChange={(val) => addItem(String(val))}
                options={productOptions}
                placeholder="เลือกสินค้า..."
                emptyText="ไม่มีสินค้าในหมวดนี้"
                searchable
              />
            </div>
          </div>
          <DataTableFrame
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            bodyClassName="!min-h-0 !max-h-56"
            empty={items.length === 0}
            emptyState={<p className="py-3 text-center text-[11px] text-slate-400">ยังไม่ได้เลือกสินค้า</p>}
          >
            <table className="w-full text-left border-collapse table-auto text-xs">
              <thead>
                <tr className="text-slate-700 dark:text-slate-300">
                  <th className="px-2 w-12 text-center">ลำดับ</th>
                  <th className="px-2">รายการ</th>
                  <th className="px-2 w-28 text-center">จำนวน</th>
                  <th className="w-8" aria-label="ลบ" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="px-2 text-center text-slate-500">{idx + 1}</td>
                    <td className="px-2 font-semibold text-slate-800 dark:text-slate-200">{item.name}</td>
                    <td className="px-2">
                      <div className="flex items-center gap-1">
                        <NumericInput
                          min={0}
                          inputMode="decimal"
                          aria-label={`จำนวน ${item.name}`}
                          value={Number.isFinite(item.quantity) ? item.quantity : ''}
                          onChange={(v) => setItemQty(item.id, v === '' ? NaN : v)}
                          className={`w-16 h-7 px-1.5 rounded-lg border text-right font-mono bg-white dark:bg-slate-900 ${
                            item.quantity > 0 ? 'border-slate-300 dark:border-slate-700' : 'border-red-400'
                          }`}
                        />
                        {item.unit && <span className="text-[11px] text-slate-500 truncate">{item.unit}</span>}
                      </div>
                    </td>
                    <td className="pr-1 text-center">
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={`ลบ ${item.name}`}
                        className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableFrame>
        </div>

        <div>
          <label className={LABEL}>รายละเอียดงานเพิ่มเติม / สิ่งที่ต้องทำ</label>
          <textarea
            rows={3}
            placeholder="ระบุรายละเอียดงาน สิ่งที่ต้องเตรียม หรือหมายเหตุ..."
            value={formData.details}
            onChange={(e) => setFormData({ ...formData, details: e.target.value })}
            className={INPUT}
          />
        </div>
      </AppModalBody>

      <AppModalFooter>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={onCancel}
          className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>กำลังบันทึก...</span>
            </>
          ) : (
            <span>{isEdit ? 'บันทึกการแก้ไข' : 'บันทึกการนัดหมาย'}</span>
          )}
        </button>
      </AppModalFooter>
    </form>
  )
}

export interface AddAppointmentModalProps {
  isOpen: boolean
  onClose: () => void
  onSave?: (newAppointment: Appointment) => void
  customers?: Customer[]
  initialDate?: string
}

/** Quick add from anywhere in the app (QuickActionLauncher): the same form in a dialog. */
export function AddAppointmentModal({ isOpen, onClose, onSave, initialDate, ...rest }: AddAppointmentModalProps) {
  const { showToast } = useToast()
  return (
    <AppModal isOpen={isOpen} onClose={onClose} size="lg">
      <AppModalHeader onClose={onClose} icon={<Calendar className="w-5 h-5 text-emerald-600" />} title="เพิ่มนัดหมายใหม่" />
      {isOpen && (
        <AppointmentForm
          {...rest}
          initialDate={initialDate}
          onCancel={onClose}
          onSubmit={(created) => {
            onSave?.(created)
            onClose()
            showToast('บันทึกการนัดหมายสำเร็จ', `สร้างนัดหมาย "${created.title}" เรียบร้อยแล้ว`, 'SUCCESS')
          }}
        />
      )}
    </AppModal>
  )
}
