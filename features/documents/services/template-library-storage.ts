import type { DocumentTemplate } from '@/lib/types/document'
import {
  createDocumentTemplate,
  deleteDocumentTemplates,
  fetchDocumentTemplates,
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
  let shared = await fetchDocumentTemplates()
  const sharedIds = new Set(shared.map((template) => template.id))
  const moved: string[] = []
  for (const template of loadLegacyCustomTemplates()) {
    if (sharedIds.has(template.id)) {
      moved.push(template.id)
      continue
    }
    if (templateBytes(template) > TEMPLATE_MAX_BYTES) continue
    try {
      await createDocumentTemplate(template.id, template)
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
  return loadTemplateLibrary()
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
