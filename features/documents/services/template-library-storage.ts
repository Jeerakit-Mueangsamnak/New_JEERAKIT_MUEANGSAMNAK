import type { DocumentTemplate, TemplateTargetGroup } from '@/lib/types/document'
import {
  addDocumentName,
  createDocumentTemplate,
  deleteDocumentName,
  deleteDocumentTemplates,
  fetchDocumentNames,
  fetchDocumentTemplates,
  type DocumentName,
} from '@/features/documents/api/template-library-repository'

const STORAGE_KEY = 'rental-pos:document-template-library:v1'

interface LibraryState {
  custom: DocumentTemplate[]
}

function readState(): LibraryState {
  if (typeof window === 'undefined') return { custom: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<LibraryState>) : {}
    return {
      custom: Array.isArray(parsed.custom)
        ? parsed.custom.filter((item): item is DocumentTemplate =>
            Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.templateSchema === 'string'))
        : [],
    }
  } catch {
    return { custom: [] }
  }
}

function writeState(state: LibraryState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

/** Local-only state is retained only to move forms older versions saved in this browser. */
export function loadLegacyCustomTemplates(): DocumentTemplate[] {
  return readState().custom
}

export function removeLegacyCustomTemplates(ids: string[]) {
  const state = readState()
  const remove = new Set(ids)
  writeState({ ...state, custom: state.custom.filter((template) => !remove.has(template.id)) })
}

/** The shop's own forms from Supabase (document_templates): the same list on every device. */
let sharedTemplates: DocumentTemplate[] = []

/** Same limit as the database column document_templates.template_schema. */
export const TEMPLATE_MAX_BYTES = 1048576
export const templateBytes = (template: Pick<DocumentTemplate, 'templateSchema'>) =>
  new TextEncoder().encode(template.templateSchema).length

/**
 * Reads the shop's forms from Supabase. Forms that older versions saved only in this browser are
 * moved up once (each stays local until its upload succeeds, e.g. one above the size limit).
 */
export async function refreshSharedTemplates(): Promise<DocumentTemplate[]> {
  // The names fill the หมวดหมู่เอกสาร dropdowns; a failed read keeps the last list and never blocks the forms.
  const [fetched] = await Promise.all([
    fetchDocumentTemplates(),
    refreshDocumentNames().catch((err: unknown) => console.error('Reading the document names failed:', err)),
  ])
  let shared = fetched
  const sharedIds = new Set(shared.map((template) => template.id))
  const moved: string[] = []
  for (const template of loadLegacyCustomTemplates()) {
    if (sharedIds.has(template.id)) {
      moved.push(template.id)
      continue
    }
    if (templateBytes(template) > TEMPLATE_MAX_BYTES) continue
    try {
      await createDocumentTemplate(template.id, { ...template, targetGroup: getTemplateTarget(template) })
      moved.push(template.id)
    } catch (err) {
      console.error('Moving a browser-only form to the shop library failed:', template.id, err)
    }
  }
  if (moved.length > 0) {
    removeLegacyCustomTemplates(moved)
    shared = await fetchDocumentTemplates()
  }
  sharedTemplates = shared
  sharedLoadedAt = Date.now()
  return loadTemplateLibrary()
}

/** The forms are a few MB (page images); a print or a bill window reuses the last read for this long. */
export const SHARED_TEMPLATES_MAX_AGE_MS = 5 * 60_000
let sharedLoadedAt = 0
let sharedLoading: Promise<DocumentTemplate[]> | null = null

/**
 * The shop's forms for printing and form pickers: the list read in the last 5 minutes, otherwise one
 * read from the server (calls made together share it). Changes on this device refresh at once
 * (save / delete); a form added on another device shows within 5 minutes or on opening แบบฟอร์ม.
 */
export function getSharedTemplates(): Promise<DocumentTemplate[]> {
  if (sharedLoadedAt > 0 && Date.now() - sharedLoadedAt < SHARED_TEMPLATES_MAX_AGE_MS) {
    return Promise.resolve(loadTemplateLibrary())
  }
  if (!sharedLoading) {
    sharedLoading = refreshSharedTemplates().finally(() => {
      sharedLoading = null
    })
  }
  return sharedLoading
}

/** Saves a new form for the whole shop; the list is read back from the server. */
export async function saveSharedTemplate(template: DocumentTemplate): Promise<DocumentTemplate[]> {
  await createDocumentTemplate(template.id, template)
  return refreshSharedTemplates()
}

/** Deletes forms from the library for good: shop forms are deleted on the server (audited with the reason). */
export async function removeTemplates(ids: string[], reason: string): Promise<DocumentTemplate[]> {
  const sharedIds = ids.filter((id) => sharedTemplates.some((template) => template.id === id))
  if (sharedIds.length > 0) await deleteDocumentTemplates(sharedIds, reason)
  removeLegacyCustomTemplates(ids)
  return refreshSharedTemplates()
}

/** The library is only the shop's own forms (no forms built into the code). */
export function loadTemplateLibrary(
  sharedCustom: DocumentTemplate[] = sharedTemplates,
  legacyCustom?: DocumentTemplate[]
): DocumentTemplate[] {
  const uniqueCustom = new Map<string, DocumentTemplate>()
  for (const template of [...sharedCustom, ...(legacyCustom ?? readState().custom)]) {
    uniqueCustom.set(template.id, template)
  }
  return [...uniqueCustom.values()]
}

/** The shop's own document names (document_names), one list per tab of เพิ่มแบบฟอร์ม. */
let documentNames: DocumentName[] = []

export const loadDocumentNames = (): DocumentName[] => documentNames

export async function refreshDocumentNames(): Promise<DocumentName[]> {
  documentNames = await fetchDocumentNames()
  return documentNames
}

export async function saveDocumentName(targetGroup: TemplateTargetGroup, name: string): Promise<DocumentName> {
  const added = await addDocumentName(targetGroup, name)
  documentNames = [...documentNames.filter((n) => n.id !== added.id), added]
  return added
}

export async function removeDocumentName(id: string): Promise<DocumentName[]> {
  await deleteDocumentName(id)
  documentNames = documentNames.filter((n) => n.id !== id)
  return documentNames
}

/** The tab a form was saved under; only forms an older version kept in this browser go by their name. */
export function getTemplateTarget(template: DocumentTemplate): 'CUSTOMER' | 'BILL' {
  if (template.targetGroup) return template.targetGroup
  const customerCategories = [
    'สัญญาเช่าสินค้า',
    'แบบฟอร์มลูกค้า',
    'หนังสือมอบอำนาจ',
    'แบบฟอร์มยืนยันลายเซ็น',
    'เอกสารยินยอม/ข้อตกลง',
    'แบบฟอร์มลูกค้าอื่น ๆ',
  ]
  if (customerCategories.includes(template.category)) return 'CUSTOMER'
  return 'BILL'
}
