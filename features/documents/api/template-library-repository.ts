import { createClient } from '@/lib/supabase/client'
import { readByIds, rpc, selectRows } from '@/lib/db/rpc'
import { readDeviceCache, writeDeviceCache } from '@/lib/db/device-cache'
import { moveInlineImagesToStorage } from '@/lib/storage/shop-images'
import type { DocumentTemplate, TemplateTargetGroup } from '@/lib/types/document'

interface DocumentTemplateRow {
  id: string
  name: string
  category: string
  target_group: TemplateTargetGroup
  source: DocumentTemplate['source']
  file_type: string
  file_name: string | null
  template_schema: string
  paper_size: DocumentTemplate['paperSize']
  orientation: DocumentTemplate['orientation']
  page_count: number
  version: number
  is_default: boolean
  description: string | null
  default_terms: string | null
  status: 'ACTIVE' | 'INACTIVE'
  status_reason: string | null
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string | null
}

export type NewDocumentTemplate = Omit<DocumentTemplate, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>

function toDocumentTemplate(row: DocumentTemplateRow): DocumentTemplate {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    targetGroup: row.target_group,
    source: row.source,
    fileType: row.file_type,
    ...(row.file_name ? { fileName: row.file_name } : {}),
    templateSchema: row.template_schema,
    paperSize: row.paper_size,
    orientation: row.orientation,
    pageCount: row.page_count,
    version: row.version,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    ...(row.description ? { description: row.description } : {}),
    ...(row.default_terms ? { defaultTerms: row.default_terms } : {}),
  }
}

function toRowData(template: NewDocumentTemplate) {
  return {
    name: template.name,
    category: template.category,
    target_group: template.targetGroup ?? null,
    source: template.source,
    file_type: template.fileType,
    file_name: template.fileName ?? null,
    template_schema: template.templateSchema,
    paper_size: template.paperSize,
    orientation: template.orientation,
    page_count: template.pageCount,
    version: template.version,
    is_default: template.isDefault,
    description: template.description ?? null,
    default_terms: template.defaultTerms ?? null,
  }
}

/** Every column except template_schema (the form text; older forms still carry their page pictures inside). */
const TEMPLATE_LIST_COLUMNS =
  'id, name, category, target_group, source, file_type, file_name, paper_size, orientation, page_count, version, is_default, description, default_terms, status, status_reason, created_at, created_by, updated_at, updated_by'

/** The page images already on this device, by form id; `stamp` says which saved form they belong to. */
type SavedSchemas = Record<string, { stamp: string; schema: string }>
const SAVED_SCHEMAS_KEY = 'document-template-schemas:v1'

// Forms are only created or deleted (no edit RPC); version + updated_at still mark any change.
const schemaStamp = (row: Omit<DocumentTemplateRow, 'template_schema'>) => `${row.version}|${row.updated_at}|${row.page_count}`

/**
 * The shop's active forms. The list is read without the page images; only forms whose images are
 * not on this device yet are downloaded (2026-11-19 speed: was ~6 MB on every app start / print).
 */
export async function fetchDocumentTemplates(): Promise<DocumentTemplate[]> {
  const supabase = createClient()
  const rows = await selectRows<Omit<DocumentTemplateRow, 'template_schema'>>(
    supabase.from('document_templates').select(TEMPLATE_LIST_COLUMNS).eq('status', 'ACTIVE').order('created_at', { ascending: false })
  )
  const saved = (await readDeviceCache<SavedSchemas>(SAVED_SCHEMAS_KEY)) ?? {}
  const missing = rows.filter((row) => saved[row.id]?.stamp !== schemaStamp(row)).map((row) => row.id)
  const downloaded = new Map<string, string>()
  if (missing.length > 0) {
    const schemaRows = await readByIds(missing, (ids) =>
      selectRows<{ id: string; template_schema: string }>(supabase.from('document_templates').select('id, template_schema').in('id', ids))
    )
    for (const row of schemaRows) downloaded.set(row.id, row.template_schema)
  }

  const templates: DocumentTemplate[] = []
  const nextSaved: SavedSchemas = {}
  for (const row of rows) {
    const schema = downloaded.get(row.id) ?? (saved[row.id]?.stamp === schemaStamp(row) ? saved[row.id].schema : undefined)
    // A form deleted between the two reads is left out, as the next full read would.
    if (schema === undefined) continue
    nextSaved[row.id] = { stamp: schemaStamp(row), schema }
    templates.push(toDocumentTemplate({ ...row, template_schema: schema }))
  }
  // Deleted forms drop out of the saved images too.
  if (missing.length > 0 || Object.keys(saved).length !== Object.keys(nextSaved).length) {
    await writeDeviceCache(SAVED_SCHEMAS_KEY, nextSaved)
  }
  return templates
}

/**
 * Saves a new form. Its page pictures (data:image/… inside the form text) go to Storage first and the form keeps
 * only their addresses (owner 2026-11-20: 7 forms were 5.9 MB of pictures inside the database).
 */
export async function createDocumentTemplate(id: string, template: NewDocumentTemplate): Promise<DocumentTemplate> {
  const templateSchema = await moveInlineImagesToStorage(template.templateSchema)
  const row = await rpc<DocumentTemplateRow>('document_template_create', {
    p_template_id: id,
    p_data: toRowData({ ...template, templateSchema }),
  })
  return toDocumentTemplate(row)
}

/** Deletes shop forms for good (the server keeps an audit entry with the reason). */
export async function deleteDocumentTemplates(ids: string[], reason: string): Promise<void> {
  await rpc('document_template_delete', { p_template_ids: ids, p_reason: reason })
}

/** One entry of the "หมวดหมู่เอกสาร" list in เพิ่มแบบฟอร์ม (table document_names), one list per tab. */
export interface DocumentName {
  id: string
  targetGroup: TemplateTargetGroup
  name: string
}

interface DocumentNameRow {
  id: string
  target_group: TemplateTargetGroup
  name: string
}

const toDocumentName = (row: DocumentNameRow): DocumentName => ({ id: row.id, targetGroup: row.target_group, name: row.name })

export async function fetchDocumentNames(): Promise<DocumentName[]> {
  const supabase = createClient()
  const rows = await selectRows<DocumentNameRow>(
    supabase.from('document_names').select('*').order('created_at', { ascending: true })
  )
  return rows.map(toDocumentName)
}

/** Adds a name to one tab's list (a name already in that list comes back as it is). */
export async function addDocumentName(targetGroup: TemplateTargetGroup, name: string): Promise<DocumentName> {
  return toDocumentName(await rpc<DocumentNameRow>('document_name_add', { p_target_group: targetGroup, p_name: name }))
}

/** Removes a name from the list; forms already saved under it keep their name. */
export async function deleteDocumentName(id: string): Promise<void> {
  await rpc('document_name_delete', { p_id: id })
}
