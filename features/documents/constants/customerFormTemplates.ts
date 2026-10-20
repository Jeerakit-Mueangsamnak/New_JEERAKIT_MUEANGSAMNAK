import type { DocumentTemplate } from '@/lib/types/document'
import type { CustomerDocType } from '@/features/documents/api/customer-document-repository'
import { INITIAL_TEMPLATES } from '@/features/documents/constants/initialDocumentTemplates'
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

const SIGNATURE_CONFIRMATION: DocumentTemplate = {
  id: 'tpl_signature_confirmation',
  name: 'แบบฟอร์มยืนยันลายเซ็น',
  category: 'แบบฟอร์มลูกค้า',
  source: 'BUILTIN',
  fileType: 'HTML',
  version: 1,
  paperSize: 'A4',
  orientation: 'PORTRAIT',
  pageCount: 1,
  isDefault: true,
  createdAt: '2026-10-04',
  updatedAt: '2026-10-04',
  createdBy: 'ระบบ',
  description: 'ลูกค้าลงลายมือชื่อตัวอย่าง 3 ครั้ง เพื่อใช้เทียบลายเซ็นในเอกสารภายหลัง',
  defaultTerms: 'ข้าพเจ้าขอรับรองว่าลายมือชื่อด้านล่างเป็นลายมือชื่อของข้าพเจ้าจริง และใช้ลายมือชื่อนี้ในการทำธุรกรรมกับร้าน',
  templateSchema: `
<div class="box-border flex h-full w-full flex-col bg-white px-[14mm] py-[12mm] font-sans text-[11px] leading-[1.5] text-slate-900">
  <div class="mb-4 border-b-2 border-slate-800 pb-2">
    <h1 class="text-[16px] font-black">{{business.name}}</h1>
    <p class="text-[10px] text-slate-600">{{business.address}} โทร {{business.phone}}</p>
  </div>
  <h2 class="mb-1 text-center text-[15px] font-black">แบบฟอร์มยืนยันลายมือชื่อ</h2>
  <p class="mb-4 text-center text-[10px] text-slate-600">เลขที่ {{document.number}} · วันที่ {{document.date}}</p>
  <div class="mb-4 grid grid-cols-2 gap-2 rounded border border-slate-300 p-3">
    <p>ชื่อ-นามสกุล: <strong>{{customer.name}}</strong></p>
    <p>รหัสลูกค้า: {{customer.code}}</p>
    <p>เลขบัตรประชาชน: {{customer.id_card}}</p>
    <p>โทรศัพท์: {{customer.phone}}</p>
    <p class="col-span-2">ที่อยู่: {{customer.address}}</p>
  </div>
  <p class="mb-6 whitespace-pre-line">{{document.custom_terms}}</p>
  <div class="grid grid-cols-3 gap-6 text-center">
    <div><div class="mb-1 h-16 border-b border-dashed border-slate-500"></div><p>ลายมือชื่อครั้งที่ 1</p></div>
    <div><div class="mb-1 h-16 border-b border-dashed border-slate-500"></div><p>ลายมือชื่อครั้งที่ 2</p></div>
    <div><div class="mb-1 h-16 border-b border-dashed border-slate-500"></div><p>ลายมือชื่อครั้งที่ 3</p></div>
  </div>
  <div class="mt-auto grid grid-cols-2 gap-10 pt-10 text-center">
    <div><div class="mx-auto mb-1 h-8 w-48 border-b border-dashed border-slate-500"></div><p>( {{customer.name}} )</p><p class="text-[10px] text-slate-500">ลูกค้า</p></div>
    <div><div class="mx-auto mb-1 h-8 w-48 border-b border-dashed border-slate-500"></div><p>( {{business.authorized_person}} )</p><p class="text-[10px] text-slate-500">เจ้าหน้าที่ผู้รับรอง</p></div>
  </div>
</div>
  `.trim(),
}

const RENTAL_CONTRACT = INITIAL_TEMPLATES.find((t) => t.id === 'tpl_rental_contract')

export const CUSTOMER_FORMS: CustomerFormDefinition[] = [
  { code: 'tpl_rental_contract', label: 'สัญญาเช่า', docType: 'RENTAL_CONTRACT', kind: 'TEMPLATE', template: RENTAL_CONTRACT },
  { code: 'tpl_signature_confirmation', label: 'แบบฟอร์มยืนยันลายเซ็น', docType: 'OTHER', kind: 'TEMPLATE', template: SIGNATURE_CONFIRMATION },
  { code: 'ID_CARD', label: 'บัตรประชาชน (สำเนา/รูปถ่าย)', docType: 'ID_CARD', kind: 'UPLOAD' },
  { code: 'HOUSE_REGISTRATION', label: 'ทะเบียนบ้าน (สำเนา/รูปถ่าย)', docType: 'HOUSE_REGISTRATION', kind: 'UPLOAD' },
  { code: 'OTHER_UPLOAD', label: 'เอกสารลูกค้าอื่น (อัปโหลดไฟล์)', docType: 'OTHER', kind: 'UPLOAD' },
]

export function findCustomerForm(templateCode: string | null | undefined, docType: CustomerDocType): CustomerFormDefinition | undefined {
  const match =
    CUSTOMER_FORMS.find((f) => f.kind === 'TEMPLATE' && f.code === templateCode) ??
    CUSTOMER_FORMS.find((f) => f.kind === 'UPLOAD' && f.docType === docType)
  if (match) return match
  if (templateCode) {
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
  }
  return undefined
}

export const DOC_TYPE_LABEL: Record<CustomerDocType, string> = {
  RENTAL_CONTRACT: 'สัญญาเช่า',
  ID_CARD: 'บัตรประชาชน',
  HOUSE_REGISTRATION: 'ทะเบียนบ้าน',
  OTHER: 'เอกสารอื่น',
}
