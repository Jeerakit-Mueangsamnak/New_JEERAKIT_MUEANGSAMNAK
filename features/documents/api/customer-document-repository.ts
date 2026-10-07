import { createClient } from '@/lib/supabase/client'
import { rpc, selectRows, DbError } from '@/lib/db/rpc'

/**
 * Customer documents (Master v4.3.1 §6): documents belong to the customer, not to a bill.
 * - Contracts / other forms: template code + version + a frozen data snapshot (re-printable).
 * - ID card / house registration: a compressed image in the private Storage bucket
 *   "customer-documents"; the database keeps only its path.
 * Saved through customer_document_save; removed only by setting INACTIVE (with reason).
 */

export type CustomerDocType = 'RENTAL_CONTRACT' | 'ID_CARD' | 'HOUSE_REGISTRATION' | 'OTHER'

export interface CustomerDocumentRow {
  id: string
  customer_id: string
  doc_type: CustomerDocType
  template_code: string | null
  template_version: string | null
  data_snapshot: Record<string, unknown> | null
  signature_svg: string | null
  storage_path: string | null
  note: string | null
  status: 'ACTIVE' | 'INACTIVE'
  status_reason: string | null
  created_at: string
}

const BUCKET = 'customer-documents'

export async function fetchCustomerDocuments(customerId?: string): Promise<CustomerDocumentRow[]> {
  const supabase = createClient()
  let q = supabase.from('customer_documents').select('*').order('created_at', { ascending: false })
  if (customerId) q = q.eq('customer_id', customerId)
  return selectRows<CustomerDocumentRow>(q)
}

export async function saveCustomerDocument(
  customerId: string,
  data: {
    docType: CustomerDocType
    templateCode?: string
    templateVersion?: string
    dataSnapshot?: Record<string, unknown>
    signatureSvg?: string
    storagePath?: string
    note?: string
  },
  documentId?: string | null
): Promise<CustomerDocumentRow> {
  return rpc<CustomerDocumentRow>('customer_document_save', {
    p_document_id: documentId ?? null,
    p_customer_id: customerId,
    p_data: {
      doc_type: data.docType,
      template_code: data.templateCode ?? null,
      template_version: data.templateVersion ?? null,
      data_snapshot: data.dataSnapshot ?? null,
      signature_svg: data.signatureSvg ?? null,
      storage_path: data.storagePath ?? null,
      note: data.note ?? null,
    },
  })
}

export async function deactivateCustomerDocument(documentId: string, reason: string): Promise<void> {
  await rpc('customer_document_set_status', { p_document_id: documentId, p_status: 'INACTIVE', p_reason: reason })
}

/** Shrinks a photo before upload (max 1600 px, JPEG ~0.8) — ID images stay small in Storage. */
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.8): Promise<Blob> {
  if (typeof window === 'undefined' || !file.type.startsWith('image/')) return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality))
}

/** Uploads an ID / house-registration image and records it as a customer document. */
export async function uploadCustomerImage(
  customerId: string,
  file: Blob,
  docType: 'ID_CARD' | 'HOUSE_REGISTRATION' | 'OTHER',
  note?: string
): Promise<CustomerDocumentRow> {
  const supabase = createClient()
  const body = await compressImage(file)
  const path = `${customerId}/${docType.toLowerCase()}-${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new DbError(error.message)
  return saveCustomerDocument(customerId, { docType, storagePath: path, note })
}

/** Short-lived link to view a stored image (the bucket is private). */
export async function getDocumentFileUrl(storagePath: string, seconds = 300): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, seconds)
  if (error || !data) throw new DbError(error?.message ?? 'cannot open file')
  return data.signedUrl
}
