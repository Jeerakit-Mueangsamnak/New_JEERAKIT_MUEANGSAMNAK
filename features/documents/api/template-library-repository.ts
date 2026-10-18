import { createClient } from '@/lib/supabase/client'
import { rpc, selectRows } from '@/lib/db/rpc'
import type { DocumentTemplate } from '@/lib/types/document'

interface DocumentTemplateRow {
  id: string
  name: string
  category: string
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

export async function fetchDocumentTemplates(): Promise<DocumentTemplate[]> {
  const supabase = createClient()
  const rows = await selectRows<DocumentTemplateRow>(
    supabase.from('document_templates').select('*').eq('status', 'ACTIVE').order('created_at', { ascending: false })
  )
  return rows.map(toDocumentTemplate)
}

export async function createDocumentTemplate(id: string, template: NewDocumentTemplate): Promise<DocumentTemplate> {
  const row = await rpc<DocumentTemplateRow>('document_template_create', {
    p_template_id: id,
    p_data: toRowData(template),
  })
  return toDocumentTemplate(row)
}

export async function deactivateDocumentTemplates(ids: string[], reason: string): Promise<void> {
  await rpc('document_template_set_status', { p_template_ids: ids, p_reason: reason })
}
