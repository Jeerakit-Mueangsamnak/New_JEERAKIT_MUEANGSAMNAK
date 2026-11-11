'use client'
import {
  COMMAND_BUTTON_SIZE_CLASSES,
  TAB_BAR_SURFACE_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'

import React, { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileCode, Plus, Printer, Receipt, RefreshCw, RotateCcw, Trash2, Upload, User } from 'lucide-react'

import { CustomSelect } from '@/components/common/CustomSelect'
import { useToast } from '@/components/common/Toast'
import type { BusinessSettings } from '@/lib/types/rental-pos'
import type { DocumentTemplate, TemplateTargetGroup } from '@/lib/types/document'
import { removeThaiAmountTextParentheses, renderDocumentTemplate } from '@/features/documents/utils/documentRenderer'
import { convertFileToInternalTemplate, TEMPLATE_UPLOAD_ACCEPT } from '@/features/documents/utils/documentConverter'
import { A4DocumentWorkspace } from '@/features/documents/components/A4DocumentWorkspace'
import { BatchDeleteModal } from '@/features/documents/components/BatchDeleteModal'
import type { DocumentName } from '@/features/documents/api/template-library-repository'
import {
  getTemplateTarget,
  loadDocumentNames,
  loadTemplateLibrary,
  refreshSharedTemplates,
  removeDocumentName,
  removeTemplates,
  saveDocumentName,
  saveSharedTemplate,
  templateBytes,
  TEMPLATE_MAX_BYTES,
} from '@/features/documents/services/template-library-storage'
import { printDocuments } from '@/lib/print/print-service'

export type TemplateLibraryMode = 'LIBRARY' | 'ADD'
const today = () => new Date().toISOString().slice(0, 10)

// Fields filled only when a real paper is printed (item cells, return / fine totals): blank in the preview.
// Row numbers ({{items.N.no}}) stay.
const PRINT_ONLY_FIELDS = /\{\{\s*(?:items\.\d+\.(?!no\b)\w+|return\.\w+|fine\.\w+)\s*\}\}/g

/** The exact blank HTML used for both the preview and printout of one library form. */
export function renderLibraryTemplate(tpl: DocumentTemplate, business?: Partial<BusinessSettings> | null): string {
  return renderDocumentTemplate(
    // The brackets around the amount in words go with it: a blank form shows no empty "()" (owner 2026-11-11)
    removeThaiAmountTextParentheses(tpl.templateSchema).replace(PRINT_ONLY_FIELDS, ''),
    {},
    '',
    '',
    tpl.defaultTerms || '',
    business,
    { items: [] }
  )
}

const DEFAULT_TERMS =
  '1. ผู้เช่าตกลงชำระค่าเช่าตามอัตราในสัญญานี้\n2. อุปกรณ์ที่เช่าต้องได้รับการดูแลให้อยู่ในสภาพใช้งานได้ปกติ\n3. ค่าปรับชำรุด/สูญหายเป็นไปตามที่ตกลงในแนบท้ายสัญญา'

function fallbackSchema(name: string, category: string) {
  return `
<div class="template-doc text-slate-900 font-sans text-xs space-y-4">
  <div class="border-b-2 border-slate-900 pb-3">
    <h1 class="text-xl font-black">${name}</h1>
    <p class="text-slate-500 font-bold text-[11px]">หมวดหมู่: ${category}</p>
  </div>
  <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] space-y-1">
    <p><span class="font-bold">คู่สัญญา/ลูกค้า:</span> {{customer.name}}</p>
    <p><span class="font-bold">โทรศัพท์:</span> {{customer.phone}}</p>
    <p><span class="font-bold">ที่อยู่:</span> {{customer.address}}</p>
    <p><span class="font-bold">เลขผู้เสียภาษี:</span> {{customer.tax_id}}</p>
  </div>
  <div class="p-3 bg-white rounded-lg border border-slate-300 text-[11px]">
    <p class="font-bold mb-1">เงื่อนไขเพิ่มเติม:</p>
    <p class="whitespace-pre-wrap">{{document.custom_terms}}</p>
  </div>
</div>`.trim()
}

const wrapPage = (html: string) => `<div class="p-8 text-slate-900 font-sans text-xs bg-white">${html}</div>`

interface TemplateLibraryPanelProps {
  mode: TemplateLibraryMode
  onModeChange: (mode: TemplateLibraryMode) => void
  business?: Partial<BusinessSettings> | null
  /** Mode switchers shown at the top of the left card (original page layout). */
  header?: React.ReactNode
}

/** "จัดการเอกสาร" → คลังแบบฟอร์ม / เพิ่มแบบฟอร์ม: template list on the left, A4 preview on the right. */
export function TemplateLibraryPanel({ mode, onModeChange, business, header }: TemplateLibraryPanelProps) {
  const { showToast } = useToast()
  const [templates, setTemplates] = useState<DocumentTemplate[]>([])
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [libraryFilter, setLibraryFilter] = useState<'ALL' | 'CUSTOMER' | 'BILL'>('ALL')
  // The shop's document names: the "หมวดหมู่เอกสาร" list, and what puts a form in its tab.
  const [documentNames, setDocumentNames] = useState<DocumentName[]>(loadDocumentNames)

  // Every form is a shop form from the server (same on every device): the last list read shows at
  // once, then the server's list; the preview falls back to the first form once it has loaded.
  useEffect(() => {
    let active = true
    const list = loadTemplateLibrary()
    setTemplates(list)
    setPreviewId(list[0]?.id ?? null)
    refreshSharedTemplates()
      .then((next) => {
        if (!active) return
        setTemplates(next)
        setDocumentNames(loadDocumentNames())
        setPreviewId((id) => (id && next.some((t) => t.id === id) ? id : next[0]?.id ?? null))
      })
      .catch((err: unknown) => {
        if (active) showToast('โหลดแบบฟอร์มของร้านไม่สำเร็จ', err instanceof Error ? err.message : 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
      })
    return () => {
      active = false
    }
  }, [showToast])

  const filteredTemplates = useMemo(() => {
    if (libraryFilter === 'ALL') return templates
    return templates.filter((t) => getTemplateTarget(t) === libraryFilter)
  }, [templates, libraryFilter])

  const customerCount = useMemo(() => templates.filter((t) => getTemplateTarget(t) === 'CUSTOMER').length, [templates])
  const billCount = useMemo(() => templates.filter((t) => getTemplateTarget(t) === 'BILL').length, [templates])

  const previewTpl = templates.find((t) => t.id === previewId) ?? null
  const previewHtml = useMemo(() => (previewTpl ? renderLibraryTemplate(previewTpl, business) : ''), [previewTpl, business])
  const checked = templates.filter((t) => checkedIds.includes(t.id))

  const toggleChecked = (id: string) => setCheckedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const toggleAll = () => {
    const allFilteredSelected = filteredTemplates.length > 0 && filteredTemplates.every((t) => checkedIds.includes(t.id))
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredTemplates.map((t) => t.id))
      setCheckedIds((prev) => prev.filter((id) => !filteredSet.has(id)))
    } else {
      setCheckedIds((prev) => Array.from(new Set([...prev, ...filteredTemplates.map((t) => t.id)])))
    }
  }

  const handlePrint = () => {
    if (checked.length === 0) return showToast('เลือกแบบฟอร์ม', 'ติ๊กเลือกแบบฟอร์มที่ต้องการพิมพ์ก่อน', 'INFO')
    // Rendered at click time from the current list, so the printout always matches the ticked forms.
    printDocuments(checked.map((t) => wrapPage(renderLibraryTemplate(t, business))), checked.length === 1 ? checked[0].name : `แบบฟอร์ม ${checked.length} รายการ`)
  }

  const handleDelete = async () => {
    const ids = checked.map((template) => template.id)
    if (ids.length === 0) return showToast('เลือกแบบฟอร์ม', 'ติ๊กเลือกแบบฟอร์มที่ต้องการลบก่อน', 'INFO')
    try {
      const next = await removeTemplates(ids, '')
      setTemplates(next)
      setCheckedIds([])
      if (previewId && ids.includes(previewId)) setPreviewId(next[0]?.id ?? null)
      showToast('ลบแบบฟอร์มสำเร็จ', `ลบแบบฟอร์มจำนวน ${ids.length} รายการแล้ว`, 'SUCCESS')
    } catch (err) {
      showToast('ลบแบบฟอร์มไม่สำเร็จ', err instanceof Error ? err.message : 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
    }
  }

  // ── เพิ่มแบบฟอร์ม ───────────────────────────────────────────────────────
  const [newFormName, setNewFormName] = useState('')
  const [newFormTarget, setNewFormTarget] = useState<TemplateTargetGroup>('CUSTOMER')
  const [newFormCategory, setNewFormCategory] = useState<string>('')
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [conversionProgress, setConversionProgress] = useState<string | null>(null)
  const [convertedSchema, setConvertedSchema] = useState<string | null>(null)
  const [convertedPageCount, setConvertedPageCount] = useState(1)
  const [newFormOrientation, setNewFormOrientation] = useState<'PORTRAIT' | 'LANDSCAPE'>('PORTRAIT')
  const [isSaving, setIsSaving] = useState(false)

  const targetNames = useMemo(
    () => documentNames.filter((n) => n.targetGroup === newFormTarget),
    [documentNames, newFormTarget]
  )

  // The chosen name always belongs to the open tab: switching tab or removing it picks that tab's first name.
  useEffect(() => {
    if (!targetNames.some((n) => n.name === newFormCategory)) setNewFormCategory(targetNames[0]?.name ?? '')
  }, [targetNames, newFormCategory])

  const handleAddDocumentName = async () => {
    const name = newFormName.trim()
    if (!name) return showToast('กรุณาระบุชื่อเอกสาร', 'พิมพ์ชื่อในช่องก่อนกด +', 'INFO')
    if (targetNames.some((n) => n.name === name)) {
      setNewFormCategory(name)
      return showToast('มีชื่อนี้อยู่แล้ว', `"${name}" อยู่ในรายการแล้ว`, 'INFO')
    }
    try {
      const added = await saveDocumentName(newFormTarget, name)
      setDocumentNames(loadDocumentNames())
      setNewFormCategory(added.name)
      showToast('เพิ่มชื่อเอกสารแล้ว', `เพิ่ม "${added.name}" ใน${newFormTarget === 'CUSTOMER' ? 'แบบฟอร์มลูกค้า' : 'แบบฟอร์มบิล'}`, 'SUCCESS')
    } catch (err) {
      showToast('เพิ่มชื่อเอกสารไม่สำเร็จ', err instanceof Error ? err.message : 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
    }
  }

  const handleRemoveDocumentName = async (name: string) => {
    const entry = targetNames.find((n) => n.name === name)
    if (!entry) return
    try {
      setDocumentNames(await removeDocumentName(entry.id))
      showToast('ลบชื่อเอกสารแล้ว', `ลบ "${entry.name}" ออกจากรายการ`, 'SUCCESS')
    } catch (err) {
      showToast('ลบชื่อเอกสารไม่สำเร็จ', err instanceof Error ? err.message : 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
    }
  }

  const handleClearUpload = () => {
    setUploadedFile(null)
    setConvertedSchema(null)
    setConvertedPageCount(1)
    setNewFormOrientation('PORTRAIT')
    setConversionProgress(null)
  }

  const handleFileUploadAndConvert = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadedFile(file)
    setConvertedSchema(null)
    setNewFormOrientation('PORTRAIT')
    setConversionProgress('กำลังอ่านไฟล์และแปลงทุกหน้า...')
    const result = await convertFileToInternalTemplate(file)
    setConversionProgress(null)
    e.target.value = ''
    if (!result.success) {
      setUploadedFile(null)
      return showToast('ไม่สามารถแปลงไฟล์ได้', result.error || 'ไม่สามารถแปลงไฟล์ประเภทนี้เป็น Template ได้', 'ERROR')
    }
    setConvertedSchema(result.templateSchema || '')
    setConvertedPageCount(result.pageCount || 1)
    if (result.orientation) setNewFormOrientation(result.orientation)
    showToast('แปลงไฟล์เป็น Template สำเร็จ', `แปลงครบ ${result.pageCount || 1} หน้า`, 'SUCCESS')
  }

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSaving) return
    // One name only (owner 2026-11-07): a form is found by its tab + the name picked in หมวดหมู่เอกสาร.
    const name = newFormCategory
    if (!name) return showToast('กรุณาเลือกหมวดหมู่เอกสาร', 'เลือกหรือเพิ่มชื่อเอกสารก่อนบันทึก', 'INFO')
    const now = today()
    const saved: DocumentTemplate = {
      id: `tpl-${Date.now()}`,
      name,
      category: name,
      targetGroup: newFormTarget,
      source: uploadedFile ? 'CONVERTED_IMPORT' : 'BUILTIN',
      fileType: uploadedFile ? uploadedFile.name.split('.').pop()?.toUpperCase() || 'DOC' : 'HTML',
      fileName: uploadedFile?.name,
      templateSchema: convertedSchema || fallbackSchema(name, name),
      paperSize: 'A4',
      orientation: newFormOrientation,
      pageCount: uploadedFile ? convertedPageCount : 1,
      version: 1,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      createdBy: 'ผู้ใช้',
      description: `เทมเพลต${newFormTarget === 'CUSTOMER' ? 'แบบฟอร์มลูกค้า' : 'แบบฟอร์มบิล'}ที่สร้างใหม่ในระบบ`,
      defaultTerms: DEFAULT_TERMS,
    }
    if (templateBytes(saved) > TEMPLATE_MAX_BYTES) {
      return showToast('ไฟล์ใหญ่เกินไป', 'แบบฟอร์มหนึ่งรายการเก็บได้ไม่เกิน 1 MB ลองลดจำนวนหน้าหรือใช้ไฟล์ Word แทน', 'ERROR')
    }
    setIsSaving(true)
    try {
      setTemplates(await saveSharedTemplate(saved))
    } catch (err) {
      return showToast('บันทึกไม่สำเร็จ', err instanceof Error ? err.message : 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
    } finally {
      setIsSaving(false)
    }
    setPreviewId(saved.id)
    onModeChange('LIBRARY')
    setNewFormName('')
    setNewFormTarget('CUSTOMER')
    setNewFormCategory('')
    setUploadedFile(null)
    setConvertedSchema(null)
    setNewFormOrientation('PORTRAIT')
    showToast('บันทึก Template สำเร็จ', `บันทึกแบบฟอร์ม "${saved.name}" เข้าคลังแล้ว`, 'SUCCESS')
  }

  // Before a file is uploaded, the preview shows the form already saved under the picked tab + name
  // (the same form POS/bills print with: the default one first, otherwise the newest).
  const savedFormForName = useMemo(() => {
    const name = newFormCategory.trim()
    if (!name) return null
    const forms = templates.filter((t) => getTemplateTarget(t) === newFormTarget && t.name.trim() === name)
    return forms.find((t) => t.isDefault) ?? forms[0] ?? null
  }, [templates, newFormTarget, newFormCategory])

  const addPreviewHtml = useMemo(() => {
    if (convertedSchema) return renderDocumentTemplate(convertedSchema, {}, '', '', DEFAULT_TERMS, business, { items: [] })
    return savedFormForName ? renderLibraryTemplate(savedFormForName, business) : ''
  }, [convertedSchema, savedFormForName, business])
  const addEmptyTitle = newFormCategory && !uploadedFile ? `ยังไม่มีแบบฟอร์ม "${newFormCategory}"` : undefined

  // Layout follows the original "จัดการเอกสาร" page: one card on the left (switchers → list/form → actions), A4 preview on the right.
  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 gap-2 overflow-hidden">
      <div className="md:col-span-5 xl:col-span-4 h-full min-h-0 overflow-hidden flex flex-col">
        <div className="bg-white dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex-1 min-h-0 flex flex-col justify-between overflow-hidden gap-2">
          <div className="flex-1 min-h-0 flex flex-col space-y-2 overflow-hidden">
            {header}

            {mode === 'LIBRARY' && (
              <div className="flex-1 min-h-0 flex flex-col space-y-2 overflow-hidden">
                <div className="flex items-center justify-between gap-1.5 pt-0.5 text-slate-800 dark:text-slate-200 font-bold text-xs shrink-0">
                  <span className="flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                    <span>รายการแบบฟอร์มเอกสาร ({templates.length})</span>
                  </span>
                </div>

                <div className={`${TAB_BAR_SURFACE_CLASSES} grid grid-cols-3 shrink-0`}>
                  <button
                    type="button"
                    onClick={() => setLibraryFilter('ALL')}
                    className={`${TAB_BUTTON_BASE_CLASSES} ${libraryFilter === 'ALL' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                  >
                    ทั้งหมด ({templates.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryFilter('CUSTOMER')}
                    className={`${TAB_BUTTON_BASE_CLASSES} ${libraryFilter === 'CUSTOMER' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                  >
                    ฟอร์มลูกค้า ({customerCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryFilter('BILL')}
                    className={`${TAB_BUTTON_BASE_CLASSES} ${libraryFilter === 'BILL' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                  >
                    ฟอร์มบิล ({billCount})
                  </button>
                </div>

                <div className="flex items-center justify-between py-1 px-1 text-xs border-b border-slate-200 dark:border-slate-700 shrink-0">
                  <label className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filteredTemplates.length > 0 && filteredTemplates.every((t) => checkedIds.includes(t.id))}
                      onChange={toggleAll}
                      className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 rounded"
                    />
                    <span>เลือกทั้งหมด</span>
                  </label>
                  <span className="text-[10px] text-slate-600 dark:text-slate-400 font-mono">
                    เลือกแล้ว {checked.length} / {templates.length}
                  </span>
                </div>

                <div className="flex-1 min-h-0 divide-y divide-slate-100 dark:divide-slate-700/60 overflow-y-auto pr-1">
                  {filteredTemplates.map((tpl) => {
                    const isPreview = previewId === tpl.id
                    return (
                      <div
                        key={tpl.id}
                        data-testid={`tpl-row-${tpl.id}`}
                        onClick={() => setPreviewId(tpl.id)}
                        className={`py-2 px-1.5 flex items-center justify-between gap-2 transition-colors cursor-pointer rounded-lg ${
                          isPreview
                            ? 'bg-purple-50/80 dark:bg-purple-950/50 text-purple-900 dark:text-purple-100'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-700/40 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            aria-label={`เลือก ${tpl.name}`}
                            checked={checkedIds.includes(tpl.id)}
                            onChange={() => toggleChecked(tpl.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 rounded shrink-0 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-900 dark:text-slate-100 text-[11px]">{tpl.name}</span>
                              {tpl.isDefault && (
                                <span className="px-1.5 rounded bg-purple-600 text-white font-extrabold text-[10px]">Default</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {mode === 'ADD' && (
              <form onSubmit={handleSaveTemplate} className="flex-1 min-h-0 overflow-y-auto p-0.5 pr-1 space-y-2.5 text-xs flex flex-col justify-between">
                <div className="space-y-2.5">
                  <div>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="ชื่อแบบฟอร์ม / ชื่อเอกสาร"
                        value={newFormName}
                        onChange={(e) => setNewFormName(e.target.value)}
                        className="w-full pl-3 pr-9 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddDocumentName()}
                        aria-label="เพิ่มชื่อเอกสารในหมวดหมู่เอกสาร"
                        title="เพิ่มชื่อเอกสาร"
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-lg text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-950/60 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className={`${TAB_BAR_SURFACE_CLASSES} grid grid-cols-2`}>
                      <button
                        type="button"
                        onClick={() => setNewFormTarget('CUSTOMER')}
                        className={`${TAB_BUTTON_BASE_CLASSES} ${newFormTarget === 'CUSTOMER' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                      >
                        <User className="w-3.5 h-3.5 shrink-0" />
                        <span>แบบฟอร์มลูกค้า</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewFormTarget('BILL')}
                        className={`${TAB_BUTTON_BASE_CLASSES} ${newFormTarget === 'BILL' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                      >
                        <Receipt className="w-3.5 h-3.5 shrink-0" />
                        <span>แบบฟอร์มบิล</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <CustomSelect
                      value={newFormCategory}
                      placeholder="ประเภทเอกสาร"
                      onChange={(v) => setNewFormCategory(String(v))}
                      options={targetNames.map((n) => ({ value: n.name, label: n.name }))}
                      onRemoveOption={(v) => void handleRemoveDocumentName(String(v))}
                    />
                  </div>

                  <div>
                    <div className="p-3 border-2 border-dashed border-purple-300 dark:border-purple-800/80 rounded-xl bg-purple-50/40 dark:bg-purple-950/20 text-center space-y-1.5">
                      <Upload className="w-5 h-5 text-purple-600 dark:text-purple-400 mx-auto" />
                      {uploadedFile && (
                        <p className="font-bold text-[10px] text-purple-600 dark:text-purple-400 font-mono">📎 {uploadedFile.name}</p>
                      )}
                      {/* The browser's own "no file chosen" text is hidden (owner 2026-11-07: no unneeded text). */}
                      <input
                        type="file"
                        aria-label="ไฟล์ต้นฉบับแบบฟอร์ม"
                        accept={TEMPLATE_UPLOAD_ACCEPT}
                        onChange={(e) => void handleFileUploadAndConvert(e)}
                        className="block w-full text-[10px] text-transparent file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-extrabold file:bg-purple-600 file:text-white hover:file:bg-purple-700 cursor-pointer"
                      />
                    </div>
                    {conversionProgress && (
                      <div className="mt-1.5 p-2 bg-purple-100 dark:bg-purple-950/80 rounded-xl border border-purple-300 flex items-center gap-2 text-purple-900 dark:text-purple-200 font-bold text-[11px] animate-pulse">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                        <span>{conversionProgress}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex gap-1.5">
                  <button
                    type="button"
                    onClick={handleClearUpload}
                    disabled={!uploadedFile || isSaving}
                    className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 flex-1 flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>ล้างเทมเพลต</span>
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className={`${COMMAND_BUTTON_SIZE_CLASSES} flex-1 bg-emerald-700 hover:bg-emerald-800 text-white shadow-md shadow-emerald-600/20 flex items-center justify-center transition-all disabled:opacity-60`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{isSaving ? 'กำลังบันทึก...' : 'บันทึกเข้าคลังระบบ'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {mode === 'LIBRARY' && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handlePrint}
                disabled={checked.length === 0}
                className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-emerald-700 hover:bg-emerald-800 text-white flex items-center justify-center shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <Printer className="w-3.5 h-3.5" />
                <span>พิมพ์ ({checked.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                disabled={checked.length === 0}
                className={`${COMMAND_BUTTON_SIZE_CLASSES} flex items-center justify-center transition-all ${
                  checked.length > 0
                    ? 'bg-red-600 text-white shadow-sm hover:bg-red-700'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400 cursor-not-allowed'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>ลบ ({checked.length})</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="md:col-span-7 xl:col-span-8 h-full min-h-[50vh] md:min-h-0 overflow-hidden flex flex-col">
        <A4DocumentWorkspace htmlContent={mode === 'LIBRARY' ? previewHtml : addPreviewHtml} />
      </div>

      <BatchDeleteModal isOpen={deleteOpen} count={checked.length} itemTypeLabel="แบบฟอร์ม" onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} />
    </div>
  )
}
