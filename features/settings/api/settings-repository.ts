import { createClient } from '@/lib/supabase/client'
import { SystemSettings } from '@/lib/types/settings'
import type { SystemConfig } from '@/features/settings/services/settings-storage'

const supabase = createClient()

export async function fetchSharedSystemConfig(): Promise<Partial<SystemConfig> | null> {
  const { data, error } = await supabase
    .from('system_settings')
    .select([
      'business:config_json->business',
      'productStock:config_json->productStock',
      'rentalBilling:config_json->rentalBilling',
      'documentNumbering:config_json->documentNumbering',
      'documentPrinting:config_json->documentPrinting',
      'financePayment:config_json->financePayment',
      'notifications:config_json->notifications',
      'branding:config_json->branding',
    ].join(','))
    .eq('id', 'default')
    .maybeSingle()

  if (error) throw new Error(`ไม่สามารถโหลดการตั้งค่าร่วมจาก Supabase ได้: ${error.message}`)
  if (!data) return null
  return data as Partial<SystemConfig>
}

export async function saveSharedSystemConfig(settings: SystemConfig): Promise<void> {
  const { data, error } = await supabase
    .from('system_settings')
    .update({ config_json: settings, updated_at: new Date().toISOString() })
    .eq('id', 'default')
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`ไม่สามารถบันทึกการตั้งค่าร่วมลง Supabase ได้: ${error.message}`)
  if (!data) throw new Error('ไม่พบแถวการตั้งค่าร่วมใน Supabase หรือไม่มีสิทธิ์แก้ไข')
}

export async function fetchSystemSettings(): Promise<SystemSettings | null> {
  const { data, error } = await supabase.from('system_settings').select('*').limit(1).single()
  if (error && error.code !== 'PGRST116') throw error
  if (!data) return null
  
  return {
    id: data.id,
    companyName: data.company_name,
    companyAddress: data.company_address || '',
    companyTaxId: data.company_tax_id || '',
    companyPhone: data.company_phone || '',
    companyEmail: data.company_email || '',
    logoUrl: data.logo_url,
    receiptFooterText: data.receipt_footer_text,
    quotationNote: data.quotation_note,
    defaultRentalDays: data.default_rental_days || 1,
    updatedAt: data.updated_at
  }
}

export async function saveSystemSettings(settings: SystemSettings): Promise<void> {
  const { error } = await supabase.from('system_settings').upsert({
    id: settings.id,
    company_name: settings.companyName,
    company_address: settings.companyAddress,
    company_tax_id: settings.companyTaxId,
    company_phone: settings.companyPhone,
    company_email: settings.companyEmail,
    logo_url: settings.logoUrl,
    receipt_footer_text: settings.receiptFooterText,
    quotation_note: settings.quotationNote,
    default_rental_days: settings.defaultRentalDays,
    updated_at: new Date().toISOString()
  })
  if (error) throw error
}
