import type { DocumentTemplate } from '@/lib/types/document'
import type { CustomerDocType } from '@/features/documents/api/customer-document-repository'
import { loadTemplateLibrary } from '@/features/documents/services/template-library-storage'

/**
 * Customer forms of the "จัดการเอกสาร" menu (Master §6: documents belong to the customer).
 * Transaction documents (quotation, reservation, bill, receipt, tax invoice, delivery) are
 * created and printed from their own menus, never here.
 */
export interface CustomerFormDefinition {
  code: string
  label: string
  docType: CustomerDocType
  /** 'TEMPLATE' = filled from customer data and printed; 'UPLOAD' = a photo / scan of the paper. */
  kind: 'TEMPLATE' | 'UPLOAD'
  template?: DocumentTemplate
}

export const CUSTOMER_FORMS: CustomerFormDefinition[] = [
  { code: 'ID_CARD', label: 'บัตรประชาชน (สำเนา/รูปถ่าย)', docType: 'ID_CARD', kind: 'UPLOAD' },
  { code: 'HOUSE_REGISTRATION', label: 'ทะเบียนบ้าน (สำเนา/รูปถ่าย)', docType: 'HOUSE_REGISTRATION', kind: 'UPLOAD' },
  { code: 'OTHER_UPLOAD', label: 'เอกสารลูกค้าอื่น (อัปโหลดไฟล์)', docType: 'OTHER', kind: 'UPLOAD' },
]

export function findCustomerForm(templateCode: string | null | undefined, docType: CustomerDocType): CustomerFormDefinition | undefined {
  // A document filled from a form keeps its form code; only scans/photos have none.
  if (!templateCode) return CUSTOMER_FORMS.find((f) => f.kind === 'UPLOAD' && f.docType === docType)
  try {
    const custom = loadTemplateLibrary().find((t) => t.id === templateCode)
    if (custom) {
      return {
        code: custom.id,
        label: custom.name,
        docType: 'OTHER',
        kind: 'TEMPLATE',
        template: custom,
      }
    }
  } catch {
    // ignore in environments without storage
  }
  return undefined
}

export const DOC_TYPE_LABEL: Record<CustomerDocType, string> = {
  RENTAL_CONTRACT: 'สัญญาเช่า',
  ID_CARD: 'บัตรประชาชน',
  HOUSE_REGISTRATION: 'ทะเบียนบ้าน',
  OTHER: 'เอกสารอื่น',
}
