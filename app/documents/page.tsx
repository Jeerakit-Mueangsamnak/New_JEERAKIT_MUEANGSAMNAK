'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilePlus, FolderOpen, Image as ImageIcon, Printer, RefreshCw, Save, Search, Trash2, Upload } from 'lucide-react'

import { CustomSelect } from '@/components/common/CustomSelect'
import { NumericInput } from '@/components/common/NumericInput'
import {
  TAB_CONTAINER_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'
import { DATA_TABLE_CLASSES, DataTableFrame } from '@/components/common/DataTableFrame'
import { useToast } from '@/components/common/Toast'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import type { Customer } from '@/lib/types/rental-pos'
import type { CustomerDocumentItem, CustomerSnapshot } from '@/lib/types/document'
import { renderDocumentTemplate } from '@/features/documents/utils/documentRenderer'
import { escapeDocumentHtml } from '@/features/documents/utils/document-html'
import { A4DocumentWorkspace } from '@/features/documents/components/A4DocumentWorkspace'
import { BatchDeleteModal } from '@/features/documents/components/BatchDeleteModal'
import { loadCustomers, syncCustomersFromSupabase } from '@/features/customers/services/customer-storage'
import {
  CUSTOMER_FORMS,
  DOC_TYPE_LABEL,
  findCustomerForm,
  type CustomerFormDefinition,
} from '@/features/documents/constants/customerFormTemplates'
import {
  deactivateCustomerDocument,
  fetchCustomerDocuments,
  getDocumentFileUrl,
  saveCustomerDocument,
  uploadCustomerImage,
  type CustomerDocType,
  type CustomerDocumentRow,
} from '@/features/documents/api/customer-document-repository'
import { printDocuments } from '@/lib/print/print-service'

type MainTab = 'CREATE' | 'MANAGE'

interface ContractFields {
  rentalStartDate: string
  rentalEndDate: string
  siteName: string
  depositAmount: number | ''
}

interface SavedSnapshot {
  docNo?: string
  templateName?: string
  customerName?: string
  customerSnapshot?: CustomerSnapshot
  contract?: ContractFields
  items?: CustomerDocumentItem[]
  terms?: string
}

const today = () => new Date().toISOString().slice(0, 10)
const docNoOf = (row: CustomerDocumentRow) =>
  ((row.data_snapshot as SavedSnapshot | null)?.docNo as string | undefined) || `CD-${row.id.slice(0, 8).toUpperCase()}`

function snapshotOf(c: Customer): CustomerSnapshot {
  return {
    id: c.id,
    customerCode: c.customerCode || '',
    customerName: c.customerName,
    companyName: c.companyName || '',
    phone: c.phone || '',
    email: c.email || '',
    houseNo: c.houseNo || '',
    subDistrict: c.subDistrict || '',
    district: c.district || '',
    province: c.province || '',
    postalCode: c.postalCode || '',
    address: c.address || '',
    taxId: c.taxId || '',
    idCardNumber: c.idCardNumber || '',
    idCardExpiry: c.idCardExpiry || '',
  }
}

const INPUT = 'w-full h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
const LABEL = 'block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1'

/**
 * จัดการเอกสาร — customer documents only (Master §6): contracts, signature confirmation,
 * ID card / house registration copies and other customer forms. Flow: customer → form →
 * customer data filled in → extra fields → save → preview / print. Transaction documents
 * (quotation, reservation, bill, receipt, tax invoice, delivery) stay in their own menus.
 */
export default function DocumentsPage() {
  const { showToast } = useToast()
  const { settings } = useSystemSettings()
  const business = settings.business
  const [tab, setTab] = useState<MainTab>('CREATE')

  // ── customers & documents ────────────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([])
  const [docs, setDocs] = useState<CustomerDocumentRow[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)

  useEffect(() => {
    setCustomers(loadCustomers())
    void syncCustomersFromSupabase().then(setCustomers).catch(() => undefined)
  }, [])

  const reloadDocs = useCallback(async () => {
    setLoadingDocs(true)
    try {
      setDocs(await fetchCustomerDocuments())
    } catch (err) {
      showToast('โหลดเอกสารไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    } finally {
      setLoadingDocs(false)
    }
  }, [showToast])

  useEffect(() => {
    void reloadDocs()
  }, [reloadDocs])

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const activeCustomers = useMemo(() => customers.filter((c) => !c.isSuspended), [customers])

  // ── create form ──────────────────────────────────────────────────────────
  const [customerId, setCustomerId] = useState('')
  const [formCode, setFormCode] = useState('')
  const [contract, setContract] = useState<ContractFields>({ rentalStartDate: today(), rentalEndDate: today(), siteName: '', depositAmount: '' })
  const [items, setItems] = useState<CustomerDocumentItem[]>([])
  const [terms, setTerms] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const customer = customerById.get(customerId)
  const form: CustomerFormDefinition | undefined = CUSTOMER_FORMS.find((f) => f.code === formCode)

  const resetForm = useCallback((nextForm?: CustomerFormDefinition) => {
    setContract({ rentalStartDate: today(), rentalEndDate: today(), siteName: '', depositAmount: '' })
    setItems([])
    setTerms(nextForm?.template?.defaultTerms || '')
    setNote('')
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const pickForm = (code: string) => {
    setFormCode(code)
    resetForm(CUSTOMER_FORMS.find((f) => f.code === code))
  }

  const renderForm = useCallback(
    (f: CustomerFormDefinition | undefined, snap: SavedSnapshot, docNo: string, date: string) => {
      if (!f?.template) return ''
      return renderDocumentTemplate(
        f.template.templateSchema,
        snap.customerSnapshot,
        docNo,
        date,
        snap.terms || '',
        business,
        snap.contract
          ? {
              rentalStartDate: snap.contract.rentalStartDate,
              rentalEndDate: snap.contract.rentalEndDate,
              siteName: snap.contract.siteName,
              depositAmount: Number(snap.contract.depositAmount || 0),
            }
          : null,
        snap.items || []
      )
    },
    [business]
  )

  const draftSnapshot: SavedSnapshot | null = customer
    ? {
        templateName: form?.label,
        customerName: customer.customerName,
        customerSnapshot: snapshotOf(customer),
        contract: form?.docType === 'RENTAL_CONTRACT' ? contract : undefined,
        items: form?.docType === 'RENTAL_CONTRACT' ? items.filter((i) => i.productName.trim()) : undefined,
        terms,
      }
    : null

  const draftHtml = draftSnapshot && form?.kind === 'TEMPLATE' ? renderForm(form, draftSnapshot, '(ยังไม่บันทึก)', today()) : ''

  const handleSave = async () => {
    if (!customer) return showToast('กรุณาเลือกลูกค้า', '', 'ERROR')
    if (!form) return showToast('กรุณาเลือกแบบฟอร์ม', '', 'ERROR')
    setSaving(true)
    try {
      let saved: CustomerDocumentRow
      if (form.kind === 'UPLOAD') {
        if (!file) throw new Error('กรุณาเลือกไฟล์รูปเอกสาร')
        saved = await uploadCustomerImage(customer.id, file, form.docType as 'ID_CARD' | 'HOUSE_REGISTRATION' | 'OTHER', note.trim() || undefined)
      } else {
        const docNo = `CD-${Date.now().toString(36).toUpperCase()}`
        saved = await saveCustomerDocument(customer.id, {
          docType: form.docType,
          templateCode: form.code,
          templateVersion: String(form.template?.version ?? 1),
          // Frozen snapshot: the document re-prints exactly as signed even if the customer changes later.
          dataSnapshot: { ...draftSnapshot, docNo } as Record<string, unknown>,
          note: note.trim() || undefined,
        })
      }
      showToast('บันทึกเอกสารแล้ว', `${form.label} · ${customer.customerName}`, 'SUCCESS')
      resetForm(form)
      await reloadDocs()
      setSelectedId(saved.id)
      setTab('MANAGE')
    } catch (err) {
      showToast('บันทึกเอกสารไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    } finally {
      setSaving(false)
    }
  }

  // ── manage list ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | CustomerDocType>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'INACTIVE' | 'ALL'>('ACTIVE')
  const [customerFilter, setCustomerFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [deactivateOpen, setDeactivateOpen] = useState(false)

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase()
    return docs.filter((d) => {
      if (typeFilter !== 'ALL' && d.doc_type !== typeFilter) return false
      if (statusFilter !== 'ALL' && d.status !== statusFilter) return false
      if (customerFilter && d.customer_id !== customerFilter) return false
      if (!q) return true
      const c = customerById.get(d.customer_id)
      const hay = [docNoOf(d), c?.customerName, c?.customerCode, c?.phone, DOC_TYPE_LABEL[d.doc_type], d.note]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [docs, search, typeFilter, statusFilter, customerFilter, customerById])

  const selected = docs.find((d) => d.id === selectedId) ?? null

  useEffect(() => {
    setImageUrl(null)
    if (!selected?.storage_path) return
    let alive = true
    void getDocumentFileUrl(selected.storage_path)
      .then((url) => alive && setImageUrl(url))
      .catch(() => alive && setImageUrl(null))
    return () => {
      alive = false
    }
  }, [selected?.storage_path])

  const htmlOf = useCallback(
    (row: CustomerDocumentRow, image?: string | null): string => {
      if (row.storage_path) {
        const c = customerById.get(row.customer_id)
        return image
          ? `<div class="p-6"><p class="mb-2 text-sm font-bold">${escapeDocumentHtml(DOC_TYPE_LABEL[row.doc_type])} · ${escapeDocumentHtml(c?.customerName || '')}</p><img src="${escapeDocumentHtml(image)}" style="max-width:100%;max-height:250mm;object-fit:contain" /></div>`
          : ''
      }
      const snap = (row.data_snapshot || {}) as SavedSnapshot
      return renderForm(findCustomerForm(row.template_code, row.doc_type), snap, docNoOf(row), row.created_at.slice(0, 10))
    },
    [customerById, renderForm]
  )

  const selectedHtml = selected ? htmlOf(selected, imageUrl) : ''

  const handlePrintSelected = async () => {
    if (!selected) return showToast('ไม่มีข้อมูลสำหรับพิมพ์', 'เลือกเอกสารจากรายการก่อน', 'INFO')
    let html = selectedHtml
    if (selected.storage_path && !imageUrl) {
      html = htmlOf(selected, await getDocumentFileUrl(selected.storage_path).catch(() => null))
    }
    if (!html || !printDocuments([`<div class="p-8 text-slate-900 font-sans text-xs bg-white">${html}</div>`], docNoOf(selected))) {
      showToast('ไม่มีข้อมูลสำหรับพิมพ์', '', 'INFO')
    }
  }

  const handlePrintDraft = () => {
    if (!draftHtml) return showToast('ไม่มีข้อมูลสำหรับพิมพ์', 'เลือกลูกค้าและแบบฟอร์มก่อน', 'INFO')
    printDocuments([`<div class="p-8 text-slate-900 font-sans text-xs bg-white">${draftHtml}</div>`], form?.label)
  }

  const handleDeactivate = async (reason: string) => {
    if (!selected) return
    try {
      await deactivateCustomerDocument(selected.id, reason)
      showToast('ยกเลิกเอกสารแล้ว', docNoOf(selected), 'INFO')
      await reloadDocs()
    } catch (err) {
      showToast('ยกเลิกเอกสารไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    }
  }

  const customerOptions = activeCustomers.map((c) => ({
    value: c.id,
    label: `${c.customerName}${c.customerCode ? ` (${c.customerCode})` : ''}`,
    sublabel: c.phone ? `📞 ${c.phone}` : undefined,
  }))

  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden p-2 bg-slate-100 dark:bg-slate-900 gap-2 text-xs">
      <div className="shrink-0 flex items-center justify-between gap-2">
        <div className={TAB_CONTAINER_CLASSES}>
          <button
            type="button"
            onClick={() => setTab('CREATE')}
            className={`${TAB_BUTTON_BASE_CLASSES} ${tab === 'CREATE' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
          >
            <FilePlus className="w-3.5 h-3.5 shrink-0" />
            <span>สร้างเอกสารลูกค้า</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('MANAGE')}
            className={`${TAB_BUTTON_BASE_CLASSES} ${tab === 'MANAGE' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
          >
            <FolderOpen className="w-3.5 h-3.5 shrink-0" />
            <span>จัดการเอกสาร</span>
          </button>
        </div>
      </div>

      {tab === 'CREATE' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 gap-2 overflow-hidden">
          <div className="md:col-span-5 xl:col-span-4 min-h-0 overflow-y-auto bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
            <div>
              <label className={LABEL}>1. ลูกค้า</label>
              <CustomSelect value={customerId} placeholder="ค้นหา / เลือกลูกค้า" onChange={(v) => setCustomerId(String(v))} options={customerOptions} searchable />
            </div>
            <div>
              <label className={LABEL}>2. แบบฟอร์ม</label>
              <CustomSelect
                value={formCode}
                placeholder="-- เลือกแบบฟอร์ม --"
                onChange={(v) => pickForm(String(v))}
                options={CUSTOMER_FORMS.map((f) => ({ value: f.code, label: f.label, sublabel: f.kind === 'UPLOAD' ? 'อัปโหลดรูปเอกสาร' : 'กรอกและพิมพ์' }))}
              />
            </div>

            {customer && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-2.5 space-y-0.5">
                <p className="text-[11px] font-bold text-slate-500">3. ข้อมูลลูกค้า (ดึงจากระบบ)</p>
                <p className="font-bold text-slate-900 dark:text-slate-100">{customer.customerName}</p>
                <p className="text-slate-600 dark:text-slate-400">📞 {customer.phone || '-'} · บัตร {customer.idCardNumber || '-'}</p>
                <p className="text-slate-600 dark:text-slate-400 line-clamp-2">{customer.address || '-'}</p>
              </div>
            )}

            {customer && form && (
              <div className="space-y-2.5">
                <p className="text-[11px] font-bold text-slate-500">4. ข้อมูลเพิ่มเติม</p>

                {form.docType === 'RENTAL_CONTRACT' && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={LABEL}>วันเริ่มสัญญา</label>
                        <input type="date" value={contract.rentalStartDate} onChange={(e) => setContract({ ...contract, rentalStartDate: e.target.value })} className={INPUT} />
                      </div>
                      <div>
                        <label className={LABEL}>วันสิ้นสุดสัญญา</label>
                        <input type="date" value={contract.rentalEndDate} onChange={(e) => setContract({ ...contract, rentalEndDate: e.target.value })} className={INPUT} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={LABEL}>สถานที่ใช้งาน</label>
                        <input value={contract.siteName} onChange={(e) => setContract({ ...contract, siteName: e.target.value })} placeholder="ตามที่อยู่ลูกค้า" className={INPUT} />
                      </div>
                      <div>
                        <label className={LABEL}>เงินประกันสัญญา (บาท)</label>
                        <NumericInput value={contract.depositAmount} onChange={(v) => setContract({ ...contract, depositAmount: v })} min={0} className={INPUT} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className={LABEL}>รายการทรัพย์สินตามสัญญา</label>
                        <button
                          type="button"
                          onClick={() => setItems([...items, { productId: '', productName: '', quantity: 1, unit: '', normalPrice: 0, damageFee: 0 }])}
                          className="text-[11px] font-bold text-blue-600 hover:underline"
                        >
                          + เพิ่มรายการ
                        </button>
                      </div>
                      {items.map((it, idx) => (
                        <div key={idx} className="grid grid-cols-[1fr_56px_56px_24px] gap-1">
                          <input value={it.productName} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, productName: e.target.value } : x)))} placeholder="ชื่อทรัพย์สิน" className={INPUT} />
                          <NumericInput value={it.quantity} onChange={(v) => setItems(items.map((x, i) => (i === idx ? { ...x, quantity: Number(v || 0) } : x)))} min={0} className={INPUT} />
                          <input value={it.unit} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))} placeholder="หน่วย" className={INPUT} />
                          <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-600" aria-label="ลบรายการ">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {form.kind === 'TEMPLATE' && (
                  <div>
                    <label className={LABEL}>ข้อความ / ข้อตกลง</label>
                    <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={4} className={`${INPUT} h-auto py-2`} />
                  </div>
                )}

                {form.kind === 'UPLOAD' && (
                  <div>
                    <label className={LABEL}>ไฟล์รูปเอกสาร</label>
                    <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-16 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <Upload className="w-4 h-4" />
                      <span>{file ? file.name : 'เลือกรูป / ถ่ายรูปเอกสาร'}</span>
                    </button>
                  </div>
                )}

                <div>
                  <label className={LABEL}>หมายเหตุ (ไม่บังคับ)</label>
                  <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
                </div>

                <div className="flex gap-2 pt-1">
                  {form.kind === 'TEMPLATE' && (
                    <button type="button" onClick={handlePrintDraft} className="h-9 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                      <Printer className="w-4 h-4" />
                      <span>พิมพ์</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    <span>{saving ? 'กำลังบันทึก...' : '5. บันทึกเอกสาร'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="md:col-span-7 xl:col-span-8 min-h-[50vh] md:min-h-0 overflow-hidden flex flex-col">
            {form?.kind === 'UPLOAD' ? (
              <div className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col items-center justify-center text-slate-400 gap-2">
                <ImageIcon className="w-10 h-10" />
                <p className="font-bold">{file ? file.name : 'ยังไม่ได้เลือกรูปเอกสาร'}</p>
              </div>
            ) : (
              <A4DocumentWorkspace htmlContent={draftHtml} />
            )}
          </div>
        </div>
      )}

      {tab === 'MANAGE' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-2 overflow-hidden">
          <DataTableFrame
            fill
            rowCount={filteredDocs.length}
            className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2"
            header={
              <div className="flex flex-wrap items-center gap-1.5 pb-2">
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาลูกค้า / เลขเอกสาร / ประเภท" className={`${INPUT} pl-8`} />
                </div>
                <div className="w-44">
                  <CustomSelect value={customerFilter} onChange={(v) => setCustomerFilter(String(v))} options={[{ value: '', label: 'ลูกค้า: ทั้งหมด' }, ...customerOptions]} searchable buttonClassName="h-9" />
                </div>
                <div className="w-36">
                  <CustomSelect
                    value={typeFilter}
                    onChange={(v) => setTypeFilter(v)}
                    options={[{ value: 'ALL', label: 'ประเภท: ทั้งหมด' }, ...(Object.keys(DOC_TYPE_LABEL) as CustomerDocType[]).map((k) => ({ value: k, label: DOC_TYPE_LABEL[k] }))]}
                    buttonClassName="h-9"
                  />
                </div>
                <div className="w-32">
                  <CustomSelect
                    value={statusFilter}
                    onChange={(v) => setStatusFilter(v)}
                    options={[
                      { value: 'ACTIVE', label: 'ใช้งานอยู่' },
                      { value: 'INACTIVE', label: 'ยกเลิกแล้ว' },
                      { value: 'ALL', label: 'ทุกสถานะ' },
                    ]}
                    buttonClassName="h-9"
                  />
                </div>
                <button type="button" onClick={() => void reloadDocs()} className="h-9 w-9 rounded-xl border border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-500" aria-label="โหลดใหม่" title="โหลดใหม่">
                  <RefreshCw className={`w-4 h-4 ${loadingDocs ? 'animate-spin' : ''}`} />
                </button>
                <button type="button" onClick={() => { pickForm('ID_CARD'); setTab('CREATE') }} className="h-9 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-1.5">
                  <Upload className="w-4 h-4" />
                  <span>อัปโหลด</span>
                </button>
              </div>
            }
            empty={filteredDocs.length === 0}
            emptyState={<div className="p-10 text-center text-slate-400 font-bold">{loadingDocs ? 'กำลังโหลด...' : 'ไม่พบเอกสาร'}</div>}
          >
            <table className={DATA_TABLE_CLASSES}>
              <thead>
                <tr>
                  <th className="px-2">วันที่</th>
                  <th className="px-2">เลขที่</th>
                  <th className="px-2">ลูกค้า</th>
                  <th className="px-2">ประเภท</th>
                  <th className="px-2">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredDocs.map((d) => {
                  const c = customerById.get(d.customer_id)
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedId(d.id)}
                      className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 ${selectedId === d.id ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
                    >
                      <td className="px-2 whitespace-nowrap">{fmtDateTime(d.created_at)}</td>
                      <td className="px-2 font-mono whitespace-nowrap">{docNoOf(d)}</td>
                      <td className="px-2">{c?.customerName || '-'}</td>
                      <td className="px-2 whitespace-nowrap">{findCustomerForm(d.template_code, d.doc_type)?.label || DOC_TYPE_LABEL[d.doc_type]}</td>
                      <td className="px-2 whitespace-nowrap">
                        {d.status === 'ACTIVE' ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 font-bold text-[10px]">ใช้งาน</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300 font-bold text-[10px]" title={d.status_reason || ''}>ยกเลิก</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DataTableFrame>

          <div className="lg:col-span-5 min-h-[50vh] lg:min-h-0 flex flex-col gap-2 overflow-hidden">
            <div className="shrink-0 flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2">
              <div className="min-w-0">
                <p className="font-bold truncate text-slate-900 dark:text-slate-100">{selected ? docNoOf(selected) : 'เลือกเอกสารเพื่อเปิดดู'}</p>
                {selected && (
                  <p className="text-[11px] text-slate-500 truncate">
                    {customerById.get(selected.customer_id)?.customerName} · สร้าง {fmtDateTime(selected.created_at)}
                    {selected.status !== 'ACTIVE' && selected.status_reason ? ` · ยกเลิก: ${selected.status_reason}` : ''}
                    {selected.note ? ` · ${selected.note}` : ''}
                  </p>
                )}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button type="button" onClick={() => void handlePrintSelected()} disabled={!selected} className="h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 font-bold flex items-center gap-1.5 disabled:opacity-40">
                  <Printer className="w-4 h-4" />
                  <span>พิมพ์</span>
                </button>
                {selected?.status === 'ACTIVE' && (
                  <button type="button" onClick={() => setDeactivateOpen(true)} className="h-9 px-3 rounded-xl border border-red-200 text-red-600 font-bold flex items-center gap-1.5 hover:bg-red-50 dark:hover:bg-red-950/30">
                    <Trash2 className="w-4 h-4" />
                    <span>ยกเลิก</span>
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <A4DocumentWorkspace htmlContent={selectedHtml} />
            </div>
          </div>
        </div>
      )}

      <BatchDeleteModal
        isOpen={deactivateOpen}
        count={1}
        itemTypeLabel="เอกสารลูกค้า"
        onClose={() => setDeactivateOpen(false)}
        onConfirm={(reason) => void handleDeactivate(reason)}
      />
    </div>
  )
}
