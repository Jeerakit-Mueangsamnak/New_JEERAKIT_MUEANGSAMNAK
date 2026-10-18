'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileCode, Printer, Receipt, RefreshCw, Trash2, Upload, User } from 'lucide-react'

import { CustomSelect } from '@/components/common/CustomSelect'
import { useToast } from '@/components/common/Toast'
import type { BusinessSettings } from '@/lib/types/rental-pos'
import type { DocumentTemplate, TemplateTargetGroup } from '@/lib/types/document'
import { renderDocumentTemplate } from '@/features/documents/utils/documentRenderer'
import { convertFileToInternalTemplate } from '@/features/documents/utils/documentConverter'
import { A4DocumentWorkspace } from '@/features/documents/components/A4DocumentWorkspace'
import { BatchDeleteModal } from '@/features/documents/components/BatchDeleteModal'
import {
  INITIAL_DOC_CATEGORIES,
  CUSTOMER_DOC_CATEGORIES,
  BILL_DOC_CATEGORIES,
} from '@/features/documents/constants/initialDocumentTemplates'
import {
  addLibraryTemplate,
  getTemplateTarget,
  isCoreTemplate,
  loadTemplateLibrary,
  removeLibraryTemplates,
} from '@/features/documents/services/template-library-storage'
import { printDocuments } from '@/lib/print/print-service'

export type TemplateLibraryMode = 'LIBRARY' | 'ADD'

export const TEMPLATE_PREVIEW_DOC_NO = 'TPL-PREVIEW-001'

const today = () => new Date().toISOString().slice(0, 10)

/** The exact blank HTML used for both the preview and printout of one library form. */
export function renderLibraryTemplate(tpl: DocumentTemplate, business?: Partial<BusinessSettings> | null): string {
  return renderDocumentTemplate(
    tpl.templateSchema,
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

  useEffect(() => {
    const list = loadTemplateLibrary()
    setTemplates(list)
    setPreviewId(list[0]?.id ?? null)
  }, [])

  const filteredTemplates = useMemo(() => {
    if (libraryFilter === 'ALL') return templates
    return templates.filter((t) => getTemplateTarget(t) === libraryFilter)
  }, [templates, libraryFilter])

  const customerCount = useMemo(() => templates.filter((t) => getTemplateTarget(t) === 'CUSTOMER').length, [templates])
  const billCount = useMemo(() => templates.filter((t) => getTemplateTarget(t) === 'BILL').length, [templates])

  const previewTpl = templates.find((t) => t.id === previewId) ?? null
  const previewHtml = useMemo(() => (previewTpl ? renderLibraryTemplate(previewTpl, business) : ''), [previewTpl, business])
  const checked = templates.filter((t) => checkedIds.includes(t.id))
  const deletableChecked = checked.filter((t) => !isCoreTemplate(t.id))

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

  const handleDelete = (reason: string) => {
    if (!reason.trim()) return showToast('กรุณาระบุเหตุผล', 'จำเป็นต้องระบุเหตุผลในการลบแบบฟอร์ม', 'ERROR')
    const ids = deletableChecked.map((template) => template.id)
    if (ids.length === 0) return showToast('ไม่มีแบบฟอร์มที่ลบได้', 'แบบฟอร์มหลักของระบบไม่สามารถลบออกจากคลังได้', 'INFO')
    const next = removeLibraryTemplates(ids)
    setTemplates(next)
    setCheckedIds([])
    if (previewId && ids.includes(previewId)) setPreviewId(next[0]?.id ?? null)
    showToast('ลบแบบฟอร์มสำเร็จ', `ลบแบบฟอร์มจำนวน ${ids.length} รายการแล้ว แบบฟอร์มหลักของระบบยังอยู่ในคลัง`, 'SUCCESS')
  }

  // ── เพิ่มแบบฟอร์ม ───────────────────────────────────────────────────────
  const [newFormName, setNewFormName] = useState('')
  const [newFormTarget, setNewFormTarget] = useState<TemplateTargetGroup>('CUSTOMER')
  const [newFormCategory, setNewFormCategory] = useState<string>('สัญญาเช่าสินค้า')
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [conversionProgress, setConversionProgress] = useState<string | null>(null)
  const [convertedSchema, setConvertedSchema] = useState<string | null>(null)
  const [newFormOrientation, setNewFormOrientation] = useState<'PORTRAIT' | 'LANDSCAPE'>('PORTRAIT')

  const handleTargetChange = (target: TemplateTargetGroup) => {
    setNewFormTarget(target)
    if (target === 'CUSTOMER') {
      if (!CUSTOMER_DOC_CATEGORIES.includes(newFormCategory)) {
        setNewFormCategory('สัญญาเช่าสินค้า')
      }
    } else {
      if (!BILL_DOC_CATEGORIES.includes(newFormCategory)) {
        setNewFormCategory('ใบเสนอราคา')
      }
    }
  }

  const handleFileUploadAndConvert = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadedFile(file)
    setConvertedSchema(null)
    setNewFormOrientation('PORTRAIT')
    if (!newFormName) setNewFormName(file.name.replace(/\.[^/.]+$/, ''))
    setConversionProgress('กำลังแปลงเป็น Internal Template Schema...')
    const result = await convertFileToInternalTemplate(file, newFormName || file.name, newFormCategory)
    setConversionProgress(null)
    e.target.value = ''
    if (!result.success) {
      setUploadedFile(null)
      return showToast('ไม่สามารถแปลงไฟล์ได้', result.error || 'ไม่สามารถแปลงไฟล์ประเภทนี้เป็น Template ได้', 'ERROR')
    }
    setConvertedSchema(result.templateSchema || '')
    if (result.orientation) setNewFormOrientation(result.orientation)
    showToast('แปลงไฟล์เป็น Template สำเร็จ', 'ระบบแปลงโครงสร้างเอกสารเรียบร้อยแล้ว', 'SUCCESS')
  }

  const handleSaveTemplate = (e: React.FormEvent) => {
    e.preventDefault()
    const name = newFormName.trim()
    if (!name) return showToast('กรุณาระบุชื่อแบบฟอร์ม', 'กรอกชื่อแบบฟอร์มก่อนบันทึก', 'INFO')
    const now = today()
    const saved: DocumentTemplate = {
      id: `tpl-${Date.now()}`,
      name,
      category: newFormCategory,
      targetGroup: newFormTarget,
      source: uploadedFile ? 'CONVERTED_IMPORT' : 'BUILTIN',
      fileType: uploadedFile ? uploadedFile.name.split('.').pop()?.toUpperCase() || 'DOC' : 'HTML',
      fileName: uploadedFile?.name,
      templateSchema: convertedSchema || fallbackSchema(name, newFormCategory),
      paperSize: 'A4',
      orientation: newFormOrientation,
      pageCount: 1,
      version: 1,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      createdBy: 'ผู้ใช้',
      description: `เทมเพลต${newFormTarget === 'CUSTOMER' ? 'แบบฟอร์มลูกค้า' : 'แบบฟอร์มบิล'}ที่สร้างใหม่ในระบบ`,
      defaultTerms: DEFAULT_TERMS,
    }
    setTemplates(addLibraryTemplate(saved))
    setPreviewId(saved.id)
    onModeChange('LIBRARY')
    setNewFormName('')
    setNewFormTarget('CUSTOMER')
    setNewFormCategory('สัญญาเช่าสินค้า')
    setUploadedFile(null)
    setConvertedSchema(null)
    setNewFormOrientation('PORTRAIT')
    showToast('บันทึก Template สำเร็จ', `บันทึกแบบฟอร์ม "${saved.name}" เข้าคลังแล้ว`, 'SUCCESS')
  }

  const addPreviewHtml = convertedSchema
    ? renderDocumentTemplate(convertedSchema, {}, '', '', DEFAULT_TERMS, business, { items: [] })
    : ''

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
                    <FileCode className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                    <span>รายการแบบฟอร์มเอกสาร ({templates.length})</span>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-100 dark:bg-slate-900/60 rounded-lg text-[10px] font-bold shrink-0 border border-slate-200/60 dark:border-slate-700/60">
                  <button
                    type="button"
                    onClick={() => setLibraryFilter('ALL')}
                    className={`py-1 rounded-md transition-all ${
                      libraryFilter === 'ALL'
                        ? 'bg-white dark:bg-slate-800 text-purple-600 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    ทั้งหมด ({templates.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryFilter('CUSTOMER')}
                    className={`py-1 rounded-md transition-all ${
                      libraryFilter === 'CUSTOMER'
                        ? 'bg-white dark:bg-slate-800 text-purple-600 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    ฟอร์มลูกค้า ({customerCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryFilter('BILL')}
                    className={`py-1 rounded-md transition-all ${
                      libraryFilter === 'BILL'
                        ? 'bg-white dark:bg-slate-800 text-purple-600 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
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
                      className="w-3.5 h-3.5 text-purple-600 rounded"
                    />
                    <span>เลือกทั้งหมด</span>
                  </label>
                  <span className="text-[10px] text-slate-500 font-mono">
                    เลือกแล้ว {checked.length} / {templates.length}
                  </span>
                </div>

                <div className="flex-1 min-h-0 divide-y divide-slate-100 dark:divide-slate-700/60 overflow-y-auto pr-1">
                  {filteredTemplates.map((tpl) => {
                    const isPreview = previewId === tpl.id
                    const isCustomerForm = getTemplateTarget(tpl) === 'CUSTOMER'
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
                            title={isCoreTemplate(tpl.id) ? 'แบบฟอร์มหลักของระบบ ลบออกจากคลังไม่ได้' : undefined}
                            className="w-3.5 h-3.5 text-purple-600 rounded shrink-0 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-900 dark:text-slate-100 text-[11px]">{tpl.name}</span>
                              <span
                                className={`px-1.5 rounded font-bold text-[10px] ${
                                  isCustomerForm
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                }`}
                              >
                                {isCustomerForm ? 'ลูกค้า' : 'บิล'}
                              </span>
                              {tpl.isDefault && (
                                <span className="px-1.5 rounded bg-purple-600 text-white font-extrabold text-[10px]">Default</span>
                              )}
                              {isCoreTemplate(tpl.id) && (
                                <span className="px-1.5 rounded bg-slate-200 text-slate-700 font-bold text-[10px] dark:bg-slate-700 dark:text-slate-200">แบบฟอร์มหลัก</span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono block">
                              หมวด: {tpl.category} | v{tpl.version}
                            </span>
                          </div>
                        </div>
                        {isPreview && (
                          <span className="px-1.5 py-0.5 rounded bg-purple-600 text-white font-extrabold text-[10px] shrink-0">พรีวิว</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {mode === 'ADD' && (
              <form onSubmit={handleSaveTemplate} className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2.5 text-xs flex flex-col justify-between">
                <div className="space-y-2.5">
                  <div>
                    <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1 text-[11px]">ชื่อแบบฟอร์ม / ชื่อเอกสาร</label>
                    <input
                      type="text"
                      placeholder="ชื่อแบบฟอร์ม / ชื่อเอกสาร"
                      value={newFormName}
                      onChange={(e) => setNewFormName(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1 text-[11px]">เพิ่มไปที่</label>
                    <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={() => handleTargetChange('CUSTOMER')}
                        className={`py-1.5 px-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                          newFormTarget === 'CUSTOMER'
                            ? 'bg-purple-600 text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        <User className="w-3.5 h-3.5 shrink-0" />
                        <span>แบบฟอร์มลูกค้า</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTargetChange('BILL')}
                        className={`py-1.5 px-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                          newFormTarget === 'BILL'
                            ? 'bg-purple-600 text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        <Receipt className="w-3.5 h-3.5 shrink-0" />
                        <span>แบบฟอร์มบิล</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1 text-[11px]">หมวดหมู่เอกสาร</label>
                    <CustomSelect
                      value={newFormCategory}
                      placeholder="ประเภทเอกสาร"
                      onChange={(v) => setNewFormCategory(String(v))}
                      options={(newFormTarget === 'CUSTOMER' ? CUSTOMER_DOC_CATEGORIES : BILL_DOC_CATEGORIES).map((c) => ({ value: c, label: c }))}
                    />
                  </div>

                  <div>
                    <div className="p-3 border-2 border-dashed border-purple-300 dark:border-purple-800/80 rounded-xl bg-purple-50/40 dark:bg-purple-950/20 text-center space-y-1.5">
                      <Upload className="w-5 h-5 text-purple-600 mx-auto" />
                      <p className="font-bold text-slate-700 dark:text-slate-200 text-[10px]">
                        {uploadedFile ? <span className="text-purple-600 font-mono">📎 {uploadedFile.name}</span> : 'รองรับ PDF, DOCX, XLSX, HTML, TXT, CSV'}
                      </p>
                      <input
                        type="file"
                        aria-label="ไฟล์ต้นฉบับแบบฟอร์ม"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.html,.txt,.rtf,.csv"
                        onChange={(e) => void handleFileUploadAndConvert(e)}
                        className="block w-full text-[10px] text-slate-500 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-extrabold file:bg-purple-600 file:text-white hover:file:bg-purple-700 cursor-pointer"
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

                <button
                  type="submit"
                  className="w-full mt-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5 text-xs transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>บันทึก Template เข้าคลังระบบ</span>
                </button>
              </form>
            )}
          </div>

          {mode === 'LIBRARY' && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handlePrint}
                disabled={checked.length === 0}
                className="py-1.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>พิมพ์ ({checked.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                disabled={deletableChecked.length === 0}
                className={`py-1.5 px-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                  deletableChecked.length > 0
                    ? 'bg-red-600 text-white shadow-sm hover:bg-red-700'
                    : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>ลบ ({deletableChecked.length})</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="md:col-span-7 xl:col-span-8 h-full min-h-[50vh] md:min-h-0 overflow-hidden flex flex-col">
        <A4DocumentWorkspace htmlContent={mode === 'LIBRARY' ? previewHtml : addPreviewHtml} />
      </div>

      <BatchDeleteModal isOpen={deleteOpen} count={deletableChecked.length} itemTypeLabel="แบบฟอร์ม" onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} />
    </div>
  )
}
