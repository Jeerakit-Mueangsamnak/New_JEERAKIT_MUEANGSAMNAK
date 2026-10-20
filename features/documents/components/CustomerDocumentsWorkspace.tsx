'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileText, FolderOpen, Printer, Trash2, Upload } from 'lucide-react'

import { CustomSelect } from '@/components/common/CustomSelect'
import { CustomDatePicker, getLocalDateString, parseLocalDate } from '@/components/common/CustomDatePicker'
import { NumericInput } from '@/components/common/NumericInput'
import { useToast } from '@/components/common/Toast'
import type { BusinessSettings, Customer } from '@/lib/types/rental-pos'
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
  type CustomerDocumentRow,
} from '@/features/documents/api/customer-document-repository'
import { printDocuments } from '@/lib/print/print-service'
import { getTemplateTarget, loadTemplateLibrary } from '@/features/documents/services/template-library-storage'

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

/** A document added from the form dropdown that is not saved yet. */
interface DraftDoc {
  id: string
  customerId: string
  formCode: string
  contract: ContractFields
  items: CustomerDocumentItem[]
  terms: string
  note: string
  file: File | null
  fileUrl: string | null
}

type ListItem = { key: string; draft: DraftDoc; row?: undefined } | { key: string; row: CustomerDocumentRow; draft?: undefined }

const today = () => new Date().toISOString().slice(0, 10)
const DRAFT_DOC_NO = '(ยังไม่บันทึก)'
const docNoOf = (row: CustomerDocumentRow) =>
  ((row.data_snapshot as SavedSnapshot | null)?.docNo as string | undefined) || `CD-${row.id.slice(0, 8).toUpperCase()}`
const wrapPage = (html: string) => `<div class="p-8 text-slate-900 font-sans text-xs bg-white">${html}</div>`

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

/** Unsaved photos are shown as data URLs (the document preview only allows https / data images). */
function readAsDataUrl(file: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

function imageHtml(label: string, customerName: string, url: string | null | undefined) {
  return url
    ? `<div class="p-6"><p class="mb-2 text-sm font-bold">${escapeDocumentHtml(label)} · ${escapeDocumentHtml(customerName)}</p><img src="${escapeDocumentHtml(url)}" style="max-width:100%;max-height:250mm;object-fit:contain" /></div>`
    : ''
}

const INPUT = 'w-full h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
const LABEL = 'block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1'

interface CustomerDocumentsWorkspaceProps {
  business?: Partial<BusinessSettings> | null
  /** Mode switchers at the top of the left card. */
  header?: React.ReactNode
}

/**
 * สร้างเอกสาร — customer documents only (Master §6): contracts, signature confirmation,
 * ID card / house registration copies and other customer forms. Flow: customer → pick a form
 * (adds it to รายการเอกสาร, upload forms ask for the photo) → fill extra fields → บันทึก.
 * The list also shows the customer's saved documents for preview, print and cancel (with reason).
 */
export function CustomerDocumentsWorkspace({ business, header }: CustomerDocumentsWorkspaceProps) {
  const { showToast } = useToast()

  // ── customers & saved documents ──────────────────────────────────────────
  const [customers, setCustomers] = useState<Customer[]>([])
  const [docs, setDocs] = useState<CustomerDocumentRow[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [customerId, setCustomerId] = useState('')
  const docsRequestId = useRef(0)

  useEffect(() => {
    setCustomers(loadCustomers())
    void syncCustomersFromSupabase().then(setCustomers).catch(() => undefined)
  }, [])

  const reloadDocs = useCallback(async () => {
    const requestId = ++docsRequestId.current
    if (!customerId) {
      setDocs([])
      setDocsError(null)
      setDocsLoading(false)
      return
    }
    setDocsLoading(true)
    setDocsError(null)
    try {
      const loadedDocs = await fetchCustomerDocuments(customerId)
      if (requestId === docsRequestId.current) setDocs(loadedDocs)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ไม่สามารถอ่านข้อมูลเอกสารได้'
      if (requestId === docsRequestId.current) {
        setDocs([])
        setDocsError(message)
        showToast('โหลดเอกสารไม่สำเร็จ', message, 'ERROR')
      }
    } finally {
      if (requestId === docsRequestId.current) setDocsLoading(false)
    }
  }, [customerId, showToast])

  useEffect(() => {
    void reloadDocs()
  }, [reloadDocs])

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const customerOptions = customers
    .filter((c) => !c.isSuspended)
    .map((c) => ({
      value: c.id,
      label: `${c.customerName}${c.customerCode ? ` (${c.customerCode})` : ''}`,
      sublabel: c.phone ? `📞 ${c.phone}` : undefined,
    }))

  const availableCustomerForms: CustomerFormDefinition[] = useMemo(() => {
    try {
      const customForms = loadTemplateLibrary()
        .filter((t) => getTemplateTarget(t) === 'CUSTOMER' && !CUSTOMER_FORMS.some((cf) => cf.code === t.id))
        .map((t) => ({
          code: t.id,
          label: t.name,
          docType: 'OTHER' as const,
          kind: 'TEMPLATE' as const,
          template: t,
        }))
      return [...CUSTOMER_FORMS, ...customForms]
    } catch {
      return CUSTOMER_FORMS
    }
  }, [])

  // ── list of the selected customer: unsaved drafts first, then saved documents ──
  const [drafts, setDrafts] = useState<DraftDoc[]>([])
  const [showCancelled, setShowCancelled] = useState(false)
  const [checkedKeys, setCheckedKeys] = useState<string[]>([])
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const pendingUploadForm = useRef<string | null>(null)
  const draftFileInputRef = useRef<HTMLInputElement>(null)

  const customer = customerById.get(customerId)

  const listItems: ListItem[] = useMemo(() => {
    if (!customerId) return []
    const draftItems = drafts.filter((d) => d.customerId === customerId).map((d) => ({ key: `draft:${d.id}`, draft: d }))
    const savedItems = docs
      .filter((d) => d.customer_id === customerId && (showCancelled || d.status === 'ACTIVE'))
      .map((row) => ({ key: `doc:${row.id}`, row }))
    return [...draftItems, ...savedItems]
  }, [customerId, drafts, docs, showCancelled])

  // Ticks and preview only ever point at rows that are in the current list.
  const visibleKeys = useMemo(() => new Set(listItems.map((i) => i.key)), [listItems])
  const checked = listItems.filter((i) => checkedKeys.includes(i.key))
  const previewItem = listItems.find((i) => i.key === previewKey) ?? null
  const deletable = checked.filter((i) => i.draft || i.row?.status === 'ACTIVE')
  const customerDrafts = drafts.filter((d) => d.customerId === customerId)

  useEffect(() => {
    setCheckedKeys((prev) => prev.filter((k) => visibleKeys.has(k)))
  }, [visibleKeys])

  const pickCustomer = (id: string) => {
    setCustomerId(id)
    setCheckedKeys([])
    setPreviewKey(null)
  }

  // ── preview / print rendering (one renderer for both) ────────────────────
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

  const draftSnapshot = useCallback(
    (d: DraftDoc): SavedSnapshot | null => {
      const c = customerById.get(d.customerId)
      const f = availableCustomerForms.find((x) => x.code === d.formCode)
      if (!c) return null
      return {
        templateName: f?.label,
        customerName: c.customerName,
        customerSnapshot: snapshotOf(c),
        contract: f?.docType === 'RENTAL_CONTRACT' ? d.contract : undefined,
        items: f?.docType === 'RENTAL_CONTRACT' ? d.items.filter((i) => i.productName.trim()) : undefined,
        terms: d.terms,
      }
    },
    [customerById, availableCustomerForms]
  )

  const htmlOf = useCallback(
    (item: ListItem, savedImage?: string | null): string => {
      if (item.draft) {
        const f = availableCustomerForms.find((x) => x.code === item.draft.formCode)
        if (f?.kind === 'UPLOAD') return imageHtml(f.label, customerById.get(item.draft.customerId)?.customerName || '', item.draft.fileUrl)
        const snap = draftSnapshot(item.draft)
        return snap ? renderForm(f, snap, DRAFT_DOC_NO, today()) : ''
      }
      const row = item.row
      if (row.storage_path) return imageHtml(DOC_TYPE_LABEL[row.doc_type], customerById.get(row.customer_id)?.customerName || '', savedImage)
      return renderForm(findCustomerForm(row.template_code, row.doc_type), (row.data_snapshot || {}) as SavedSnapshot, docNoOf(row), row.created_at.slice(0, 10))
    },
    [customerById, draftSnapshot, renderForm, availableCustomerForms]
  )

  const previewStoragePath = previewItem?.row?.storage_path
  useEffect(() => {
    setImageUrl(null)
    if (!previewStoragePath) return
    let alive = true
    void getDocumentFileUrl(previewStoragePath)
      .then((url) => alive && setImageUrl(url))
      .catch(() => alive && setImageUrl(null))
    return () => {
      alive = false
    }
  }, [previewStoragePath])

  const previewHtml = previewItem ? htmlOf(previewItem, imageUrl) : ''

  // ── add a form to the list ───────────────────────────────────────────────
  const addDraft = (formCode: string, file: File | null = null, fileUrl: string | null = null) => {
    const f = availableCustomerForms.find((x) => x.code === formCode)
    if (!f || !customerId) return
    const draft: DraftDoc = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      customerId,
      formCode,
      contract: { rentalStartDate: today(), rentalEndDate: today(), siteName: '', depositAmount: '' },
      items: [],
      terms: f.template?.defaultTerms || '',
      note: '',
      file,
      fileUrl,
    }
    setDrafts((prev) => [draft, ...prev])
    setPreviewKey(`draft:${draft.id}`)
    showToast('เพิ่มเอกสารแล้ว', `${f.label} · ยังไม่บันทึก`, 'SUCCESS')
  }

  const handlePickForm = (code: string) => {
    if (!code) return
    if (!customer) return showToast('กรุณาเลือกลูกค้า', 'ต้องเลือกลูกค้าก่อนเพิ่มเอกสาร', 'ERROR')
    const f = availableCustomerForms.find((x) => x.code === code)
    if (f?.kind === 'UPLOAD') {
      // Photo forms: the file picker opens right away; the document is added once a photo is chosen.
      pendingUploadForm.current = code
      uploadInputRef.current?.click()
      return
    }
    addDraft(code)
  }

  const handleUploadPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    const code = pendingUploadForm.current
    pendingUploadForm.current = null
    e.target.value = ''
    if (file && code) addDraft(code, file, await readAsDataUrl(file))
  }

  const updateDraft = (id: string, patch: Partial<DraftDoc>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  const replaceDraftFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const d = previewItem?.draft
    if (!file || !d) return
    updateDraft(d.id, { file, fileUrl: await readAsDataUrl(file) })
  }

  const dropDrafts = (ids: string[]) => setDrafts((prev) => prev.filter((d) => !ids.includes(d.id)))

  // ── selection ────────────────────────────────────────────────────────────
  const toggleChecked = (key: string) => setCheckedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  const toggleAll = () => setCheckedKeys(checked.length === listItems.length ? [] : listItems.map((i) => i.key))

  // ── print: ticked rows, or the whole list when nothing is ticked ─────────
  const handlePrint = async () => {
    const targets = checked.length > 0 ? checked : listItems
    if (targets.length === 0) return showToast('ไม่มีข้อมูลสำหรับพิมพ์', 'เพิ่มหรือเลือกเอกสารก่อน', 'INFO')
    try {
      const pages: string[] = []
      for (const item of targets) {
        // Rendered at click time from the current list; stored photos get a fresh link.
        const image = item.row?.storage_path ? await getDocumentFileUrl(item.row.storage_path) : null
        const html = htmlOf(item, image)
        if (html) pages.push(wrapPage(html))
      }
      if (pages.length === 0 || !printDocuments(pages, customer?.customerName)) {
        showToast('ไม่มีข้อมูลสำหรับพิมพ์', '', 'INFO')
      }
    } catch (err) {
      showToast('พิมพ์เอกสารไม่สำเร็จ', err instanceof Error ? err.message : 'ไม่สามารถเตรียมเอกสารสำหรับพิมพ์ได้', 'ERROR')
    }
  }

  // ── delete: unsaved rows are dropped, saved rows are cancelled with the reason ──
  const handleDelete = async (reason: string) => {
    if (!reason.trim()) return showToast('กรุณาระบุเหตุผล', 'จำเป็นต้องระบุเหตุผลในการลบ', 'ERROR')
    const draftIds = deletable.filter((i) => i.draft).map((i) => i.draft!.id)
    const rows = deletable.filter((i) => i.row).map((i) => i.row!)
    try {
      for (const row of rows) await deactivateCustomerDocument(row.id, reason.trim())
      dropDrafts(draftIds)
      setCheckedKeys([])
      if (previewKey && deletable.some((i) => i.key === previewKey)) setPreviewKey(null)
      showToast('ลบเอกสารแล้ว', `${deletable.length} รายการ`, 'INFO')
    } catch (err) {
      showToast('ลบเอกสารไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    } finally {
      if (rows.length > 0) await reloadDocs()
    }
  }

  // ── save every unsaved document of this customer ─────────────────────────
  const handleSave = async () => {
    if (!customer) return showToast('กรุณาเลือกลูกค้า', '', 'ERROR')
    if (customerDrafts.length === 0) return showToast('ไม่มีเอกสารที่ต้องบันทึก', 'เลือกแบบฟอร์มเพื่อเพิ่มเอกสารก่อน', 'INFO')
    const missingFile = customerDrafts.find((d) => availableCustomerForms.find((f) => f.code === d.formCode)?.kind === 'UPLOAD' && !d.file)
    if (missingFile) {
      setPreviewKey(`draft:${missingFile.id}`)
      return showToast('กรุณาเลือกไฟล์รูปเอกสาร', availableCustomerForms.find((f) => f.code === missingFile.formCode)?.label || '', 'ERROR')
    }
    setSaving(true)
    const savedDraftIds: string[] = []
    let lastSaved: CustomerDocumentRow | null = null
    try {
      // Oldest first, so saved documents keep the order they were added in.
      for (const d of [...customerDrafts].reverse()) {
        const f = availableCustomerForms.find((x) => x.code === d.formCode)
        if (!f) continue
        if (f.kind === 'UPLOAD') {
          lastSaved = await uploadCustomerImage(customer.id, d.file as File, f.docType as 'ID_CARD' | 'HOUSE_REGISTRATION' | 'OTHER', d.note.trim() || undefined)
        } else {
          const docNo = `CD-${Date.now().toString(36).toUpperCase()}`
          lastSaved = await saveCustomerDocument(customer.id, {
            docType: f.docType,
            templateCode: f.code,
            templateVersion: String(f.template?.version ?? 1),
            // Frozen snapshot: the document re-prints exactly as signed even if the customer changes later.
            dataSnapshot: { ...draftSnapshot(d), docNo } as Record<string, unknown>,
            note: d.note.trim() || undefined,
          })
        }
        savedDraftIds.push(d.id)
      }
      showToast('บันทึกเอกสารแล้ว', `${savedDraftIds.length} รายการ · ${customer.customerName}`, 'SUCCESS')
    } catch (err) {
      showToast('บันทึกเอกสารไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    } finally {
      dropDrafts(savedDraftIds)
      setCheckedKeys([])
      await reloadDocs()
      if (lastSaved) setPreviewKey(`doc:${lastSaved.id}`)
      setSaving(false)
    }
  }

  const previewDraft = previewItem?.draft
  const previewDraftForm = previewDraft ? availableCustomerForms.find((f) => f.code === previewDraft.formCode) : undefined

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 gap-2 overflow-hidden">
      <div className="md:col-span-5 xl:col-span-4 h-full min-h-0 overflow-hidden flex flex-col">
        <div className="bg-white dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex-1 min-h-0 flex flex-col justify-between overflow-hidden gap-2">
          <div className="flex-1 min-h-0 flex flex-col space-y-2 overflow-hidden">
            {header}

            <div className="shrink-0">
              <label className={LABEL}>ชื่อลูกค้า</label>
              <CustomSelect value={customerId} placeholder="ค้นหา / เลือกลูกค้า" onChange={(v) => pickCustomer(String(v))} options={customerOptions} searchable />
            </div>

            <div className="shrink-0">
              <label className={LABEL}>เลือกเอกสาร/แบบฟอร์ม</label>
              <CustomSelect
                value=""
                placeholder="-- เลือกแบบฟอร์มเพื่อเพิ่มเอกสาร --"
                onChange={(v) => handlePickForm(String(v))}
                options={availableCustomerForms.map((f) => ({ value: f.code, label: f.label, sublabel: f.kind === 'UPLOAD' ? 'อัปโหลดรูปเอกสาร' : 'กรอกและพิมพ์' }))}
              />
              <input ref={uploadInputRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="เลือกรูปเอกสาร" onChange={(e) => void handleUploadPicked(e)} />
            </div>

            <div className="flex items-center justify-between gap-1.5 pt-0.5 text-slate-800 dark:text-slate-200 font-bold text-xs shrink-0">
              <span className="flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>รายการเอกสาร</span>
              </span>
              {customer && (
                <label className="flex items-center gap-1 text-[10px] font-medium text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="w-3 h-3 rounded" />
                  <span>แสดงที่ยกเลิกแล้ว</span>
                </label>
              )}
            </div>

            <div className="flex items-center justify-between py-1 px-1 text-xs border-b border-slate-200 dark:border-slate-700 shrink-0">
              <label className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={listItems.length > 0 && checked.length === listItems.length}
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 text-blue-600 rounded"
                />
                <span>เลือกทั้งหมด</span>
              </label>
              <span className="text-[10px] text-slate-500 font-mono font-bold">
                เลือกแล้ว {checked.length} / {listItems.length}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60 pr-1">
              {listItems.length > 0 ? (
                listItems.map((item, idx) => {
                  const isPreview = previewKey === item.key
                  const label = item.draft
                    ? availableCustomerForms.find((f) => f.code === item.draft.formCode)?.label
                    : findCustomerForm(item.row.template_code, item.row.doc_type)?.label || DOC_TYPE_LABEL[item.row.doc_type]
                  return (
                    <div
                      key={item.key}
                      data-testid={`doc-row-${item.key}`}
                      onClick={() => setPreviewKey(item.key)}
                      className={`py-2 px-1.5 flex items-center justify-between gap-2 transition-colors cursor-pointer rounded-lg ${
                        isPreview
                          ? 'bg-blue-50/80 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-700/40 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          aria-label={`เลือก ${label}`}
                          checked={checkedKeys.includes(item.key)}
                          onChange={() => toggleChecked(item.key)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-3.5 h-3.5 text-blue-600 rounded shrink-0 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-slate-900 dark:text-slate-100 text-[11px]">
                            {idx + 1}. {label}
                          </p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            {item.draft ? (
                              <span className="text-amber-600 font-bold">ยังไม่บันทึก</span>
                            ) : (
                              <>
                                {docNoOf(item.row)} • {item.row.created_at.slice(0, 10)}
                                {item.row.status !== 'ACTIVE' && <span className="ml-1 text-red-600 font-bold" title={item.row.status_reason || ''}>• ยกเลิกแล้ว</span>}
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      {isPreview && <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white font-extrabold text-[10px] shrink-0">พรีวิว</span>}
                    </div>
                  )
                })
              ) : (
                <div className="text-center py-8 text-slate-400 space-y-1">
                  <FileText className="w-7 h-7 mx-auto text-slate-300 stroke-[1.5]" />
                  {docsLoading ? (
                    <p className="font-bold text-xs text-slate-500">กำลังโหลดเอกสาร...</p>
                  ) : docsError ? (
                    <>
                      <p className="font-bold text-xs text-red-600">โหลดเอกสารไม่สำเร็จ</p>
                      <p className="text-[10px] text-slate-400">{docsError}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-bold text-xs text-slate-500">ยังไม่มีเอกสารในรายการ</p>
                      <p className="text-[10px] text-slate-400">{customer ? 'เลือกแบบฟอร์มจากเมนูด้านบนเพื่อเพิ่มเอกสาร' : 'เลือกลูกค้าก่อน แล้วเลือกแบบฟอร์มเพื่อเพิ่มเอกสาร'}</p>
                    </>
                  )}
                </div>
              )}
            </div>

            {previewDraft && previewDraftForm && (
              <div className="shrink-0 max-h-[38%] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-2 space-y-2">
                <p className="text-[11px] font-bold text-slate-500">ข้อมูลเพิ่มเติม · {previewDraftForm.label}</p>

                {previewDraftForm.docType === 'RENTAL_CONTRACT' && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={LABEL}>วันเริ่มสัญญา</label>
                        <CustomDatePicker align="left" value={parseLocalDate(previewDraft.contract.rentalStartDate)} onChange={(d) => updateDraft(previewDraft.id, { contract: { ...previewDraft.contract, rentalStartDate: d ? getLocalDateString(d) : '' } })} />
                      </div>
                      <div>
                        <label className={LABEL}>วันสิ้นสุดสัญญา</label>
                        <CustomDatePicker align="left" value={parseLocalDate(previewDraft.contract.rentalEndDate)} onChange={(d) => updateDraft(previewDraft.id, { contract: { ...previewDraft.contract, rentalEndDate: d ? getLocalDateString(d) : '' } })} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={LABEL}>สถานที่ใช้งาน</label>
                        <input value={previewDraft.contract.siteName} onChange={(e) => updateDraft(previewDraft.id, { contract: { ...previewDraft.contract, siteName: e.target.value } })} placeholder="ตามที่อยู่ลูกค้า" className={INPUT} />
                      </div>
                      <div>
                        <label className={LABEL}>เงินประกันสัญญา (บาท)</label>
                        <NumericInput value={previewDraft.contract.depositAmount} onChange={(v) => updateDraft(previewDraft.id, { contract: { ...previewDraft.contract, depositAmount: v } })} min={0} className={INPUT} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className={LABEL}>รายการทรัพย์สินตามสัญญา</label>
                        <button
                          type="button"
                          onClick={() => updateDraft(previewDraft.id, { items: [...previewDraft.items, { productId: '', productName: '', quantity: 1, unit: '', normalPrice: 0, damageFee: 0 }] })}
                          className="text-[11px] font-bold text-blue-600 hover:underline"
                        >
                          + เพิ่มรายการ
                        </button>
                      </div>
                      {previewDraft.items.map((it, idx) => (
                        <div key={idx} className="grid grid-cols-[1fr_56px_56px_24px] gap-1">
                          <input value={it.productName} onChange={(e) => updateDraft(previewDraft.id, { items: previewDraft.items.map((x, i) => (i === idx ? { ...x, productName: e.target.value } : x)) })} placeholder="ชื่อทรัพย์สิน" className={INPUT} />
                          <NumericInput value={it.quantity} onChange={(v) => updateDraft(previewDraft.id, { items: previewDraft.items.map((x, i) => (i === idx ? { ...x, quantity: Number(v || 0) } : x)) })} min={0} className={INPUT} />
                          <input value={it.unit} onChange={(e) => updateDraft(previewDraft.id, { items: previewDraft.items.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)) })} placeholder="หน่วย" className={INPUT} />
                          <button type="button" onClick={() => updateDraft(previewDraft.id, { items: previewDraft.items.filter((_, i) => i !== idx) })} className="text-slate-400 hover:text-red-600" aria-label="ลบรายการ">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {previewDraftForm.kind === 'TEMPLATE' && (
                  <div>
                    <label className={LABEL}>ข้อความ / ข้อตกลง</label>
                    <textarea value={previewDraft.terms} onChange={(e) => updateDraft(previewDraft.id, { terms: e.target.value })} rows={3} className={`${INPUT} h-auto py-2`} />
                  </div>
                )}

                {previewDraftForm.kind === 'UPLOAD' && (
                  <div>
                    <input ref={draftFileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void replaceDraftFile(e)} />
                    <button
                      type="button"
                      onClick={() => draftFileInputRef.current?.click()}
                      className="w-full h-9 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center gap-2 hover:bg-white dark:hover:bg-slate-700"
                    >
                      <Upload className="w-4 h-4" />
                      <span className="truncate">{previewDraft.file ? `เปลี่ยนรูป · ${previewDraft.file.name}` : 'เลือกรูป / ถ่ายรูปเอกสาร'}</span>
                    </button>
                  </div>
                )}

                <div>
                  <label className={LABEL}>หมายเหตุ (ไม่บังคับ)</label>
                  <input value={previewDraft.note} onChange={(e) => updateDraft(previewDraft.id, { note: e.target.value })} className={INPUT} />
                </div>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-700 space-y-1.5 shrink-0">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => void handlePrint()}
                disabled={listItems.length === 0}
                className="py-1.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>พิมพ์ ({checked.length > 0 ? checked.length : 'ทั้งหมด'})</span>
              </button>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                disabled={deletable.length === 0}
                className={`py-1.5 px-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                  deletable.length > 0
                    ? 'bg-red-600 text-white shadow-sm hover:bg-red-700'
                    : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>ลบ ({deletable.length})</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{saving ? 'กำลังบันทึก...' : customerDrafts.length > 0 ? `บันทึก (${customerDrafts.length})` : 'บันทึก'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="md:col-span-7 xl:col-span-8 h-full min-h-[50vh] md:min-h-0 overflow-hidden flex flex-col">
        <A4DocumentWorkspace htmlContent={previewHtml} />
      </div>

      <BatchDeleteModal
        isOpen={deleteOpen}
        count={deletable.length}
        itemTypeLabel="เอกสารลูกค้า"
        onClose={() => setDeleteOpen(false)}
        onConfirm={(reason) => void handleDelete(reason)}
      />
    </div>
  )
}
