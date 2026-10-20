import type { DocumentTemplate } from '@/lib/types/document'
import { INITIAL_TEMPLATES } from '@/features/documents/constants/initialDocumentTemplates'

const STORAGE_KEY = 'rental-pos:document-template-library:v1'
export const CORE_TEMPLATE_IDS = [
  'tpl_quotation',
  'tpl_delivery_note',
  'tpl_receipt',
  'tpl_equipment_check',
] as const

const CORE_TEMPLATE_ID_SET = new Set<string>(CORE_TEMPLATE_IDS)
const INITIAL_TEMPLATE_IDS = new Set(INITIAL_TEMPLATES.map((template) => template.id))

export const isCoreTemplate = (id: string) => CORE_TEMPLATE_ID_SET.has(id)

interface LibraryState {
  custom: DocumentTemplate[]
  hiddenIds: string[]
}

function readState(): LibraryState {
  if (typeof window === 'undefined') return { custom: [], hiddenIds: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<LibraryState>) : {}
    return {
      custom: Array.isArray(parsed.custom)
        ? parsed.custom.filter((item): item is DocumentTemplate =>
            Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.templateSchema === 'string'))
        : [],
      hiddenIds: Array.isArray(parsed.hiddenIds) ? parsed.hiddenIds.filter((id): id is string => typeof id === 'string' && !isCoreTemplate(id)) : [],
    }
  } catch {
    return { custom: [], hiddenIds: [] }
  }
}

function writeState(state: LibraryState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

/** Local-only state is retained only for hiding non-core built-in templates and legacy migration. */
export function loadLegacyCustomTemplates(): DocumentTemplate[] {
  return readState().custom
}

export function removeLegacyCustomTemplates(ids: string[]) {
  const state = readState()
  const remove = new Set(ids)
  writeState({ ...state, custom: state.custom.filter((template) => !remove.has(template.id)) })
}

export function loadTemplateLibrary(
  sharedCustom: DocumentTemplate[] = [],
  legacyCustom?: DocumentTemplate[]
): DocumentTemplate[] {
  const { hiddenIds, custom: storedCustom } = readState()
  const effectiveLegacy = legacyCustom ?? storedCustom
  const hidden = new Set(hiddenIds)
  const templatesById = new Map(INITIAL_TEMPLATES.map((template) => [template.id, template]))
  const coreTemplates = CORE_TEMPLATE_IDS
    .map((id) => templatesById.get(id))
    .filter((template): template is DocumentTemplate => Boolean(template))
  const uniqueCustom = new Map<string, DocumentTemplate>()
  for (const template of [...sharedCustom, ...effectiveLegacy]) {
    if (!INITIAL_TEMPLATE_IDS.has(template.id)) uniqueCustom.set(template.id, template)
  }
  const otherTemplates = [...uniqueCustom.values(), ...INITIAL_TEMPLATES]
    .filter((template) => !isCoreTemplate(template.id) && !hidden.has(template.id))
  return [...coreTemplates, ...otherTemplates]
}

/** Hiding a non-core built-in remains a local display preference; custom forms use Supabase. */
export function hideBuiltInTemplates(ids: string[]) {
  const state = readState()
  const hiddenIds = Array.from(new Set([
    ...state.hiddenIds,
    ...ids.filter((id) => !isCoreTemplate(id) && INITIAL_TEMPLATE_IDS.has(id)),
  ]))
  writeState({ ...state, hiddenIds })
}

export function addLibraryTemplate(template: DocumentTemplate): DocumentTemplate[] {
  const state = readState()
  const custom = [template, ...state.custom.filter((t) => t.id !== template.id)]
  const hiddenIds = state.hiddenIds.filter((id) => id !== template.id)
  writeState({ custom, hiddenIds })
  return loadTemplateLibrary([], custom)
}

export function removeLibraryTemplates(ids: string[]): DocumentTemplate[] {
  const state = readState()
  const toRemove = new Set(ids.filter((id) => !isCoreTemplate(id)))
  const custom = state.custom.filter((t) => !toRemove.has(t.id))
  const hiddenIds = Array.from(
    new Set([
      ...state.hiddenIds,
      ...ids.filter((id) => !isCoreTemplate(id) && INITIAL_TEMPLATE_IDS.has(id)),
    ])
  )
  writeState({ custom, hiddenIds })
  return loadTemplateLibrary([], custom)
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
  if (
    template.id === 'tpl_rental_contract' ||
    template.id === 'tpl_power_of_attorney' ||
    template.id === 'tpl_signature_confirmation'
  ) {
    return 'CUSTOMER'
  }
  return 'BILL'
}
