export type TemplateSource = 'BUILTIN' | 'CONVERTED_IMPORT'
export type PaperSize = 'A4'
export type Orientation = 'PORTRAIT' | 'LANDSCAPE'
export type TemplateTargetGroup = 'CUSTOMER' | 'BILL'

export interface DocumentTemplate {
  id: string
  name: string
  category: string
  targetGroup?: TemplateTargetGroup
  source: TemplateSource
  fileType: string
  fileName?: string
  templateSchema: string
  paperSize: PaperSize
  orientation: Orientation
  pageCount: number
  version: number
  isDefault: boolean
  createdAt: string
  updatedAt: string
  createdBy: string
  description?: string
  defaultTerms?: string
}

export interface CustomerSnapshot {
  id: string
  customerCode: string
  customerName: string
  companyName?: string
  phone: string
  email?: string
  houseNo?: string
  subDistrict?: string
  district?: string
  province?: string
  postalCode?: string
  address: string
  taxId?: string
  idCardNumber?: string
  idCardExpiry?: string
}

export interface CustomerDocumentItem {
  productId: string
  productName: string
  quantity: number
  unit: string
  normalPrice: number
  damageFee: number
}
