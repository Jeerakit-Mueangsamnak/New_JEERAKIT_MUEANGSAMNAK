import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/db/rpc'
import { setCachedPolicies, type Policies } from '@/lib/db/policies'
import type { DocNumberFormat, SystemConfig } from '@/features/settings/services/settings-storage'

/**
 * Shop settings (Master v4.3.1 §37) live in the single public.store_settings row:
 * - columns: company info, timezone, ONE VAT switch + rate + price mode (POS and Settings read
 *   the same values; VAT can only be switched on once rate and mode are filled in);
 * - doc_number_formats: BL-2026-000001 style numbering (prefix / digits / reset), configurable;
 * - policies: adjustable values (notifications, discount limit, category defaults …) and the
 *   rest of the app's settings screen under policies.app_config.
 * Written only through settings_update (settings menu, reason, audit).
 */

interface StoreSettingsRow {
  company_name: string | null
  tax_id: string | null
  address: string | null
  phone: string | null
  logo_url: string | null
  timezone: string
  vat_enabled: boolean
  vat_rate: number | null
  vat_mode: string | null
  doc_number_formats: Record<string, { prefix?: string; digits?: number; reset?: string }>
  policies: Policies
}

const DOC_TYPES: Array<[keyof SystemConfig['documentNumbering'], string, string]> = [
  ['rentalBill', 'BILL', 'BL'],
  ['quotation', 'QUOTATION', 'QT'],
  ['receipt', 'RECEIPT', 'RCP'],
  ['returnSlip', 'RETURN', 'RT'],
]

function toAppFormat(server: { prefix?: string; digits?: number; reset?: string } | undefined, fallbackPrefix: string): DocNumberFormat {
  const reset = server?.reset || 'YEARLY'
  return {
    prefix: server?.prefix || fallbackPrefix,
    runningDigits: server?.digits || 6,
    resetCycle: reset,
    yearMode: 'CE',
    includeDate: reset !== 'NEVER',
    datePattern: reset === 'MONTHLY' ? 'YYYYMM' : 'YYYY',
  }
}

function toServerFormat(f: DocNumberFormat): { prefix: string; digits: number; reset: string } {
  const reset = ['MONTHLY', 'YEARLY', 'NEVER'].includes(f.resetCycle) ? f.resetCycle : 'YEARLY'
  return { prefix: (f.prefix || '').trim(), digits: Math.min(10, Math.max(3, Number(f.runningDigits) || 6)), reset }
}

/** Reads the shop settings row; null when signed out / not yet allowed. */
export async function fetchSharedSystemConfig(): Promise<Partial<SystemConfig> | null> {
  const supabase = createClient()
  const { data, error } = await supabase.from('store_settings').select('*').maybeSingle()
  if (error || !data) return null
  const row = data as StoreSettingsRow
  setCachedPolicies(row.policies)
  const app = (row.policies?.app_config ?? {}) as Partial<SystemConfig>
  const discountOn = row.policies?.discount_limit_enabled === true
  const numbering = Object.fromEntries(
    DOC_TYPES.map(([appKey, serverKey, prefix]) => [appKey, toAppFormat(row.doc_number_formats?.[serverKey], prefix)])
  ) as unknown as SystemConfig['documentNumbering']

  return {
    ...app,
    business: {
      ...(app.business ?? ({} as SystemConfig['business'])),
      businessName: row.company_name ?? app.business?.businessName ?? '',
      taxId: row.tax_id ?? app.business?.taxId ?? '',
      address: row.address ?? app.business?.address ?? '',
      phone: row.phone ?? app.business?.phone ?? '',
    },
    financePayment: {
      ...(app.financePayment ?? ({} as SystemConfig['financePayment'])),
      vatEnabled: row.vat_enabled,
      defaultVatPercent: row.vat_rate ?? 0,
      vatCalculationMode: row.vat_mode === 'INCLUSIVE' ? 'INCLUSIVE' : 'EXCLUSIVE',
      maximumDiscountPercent: discountOn ? Number(row.policies?.discount_limit_percent ?? 100) : 100,
    },
    notifications: (row.policies?.notifications ?? app.notifications) as SystemConfig['notifications'],
    documentNumbering: numbering,
  }
}

/** Saves the whole settings screen in one audited settings_update call. */
export async function saveSharedSystemConfig(settings: SystemConfig, reason?: string): Promise<void> {
  const { business, financePayment, notifications, documentNumbering, ...rest } = settings
  const discountLimited = Number(financePayment.maximumDiscountPercent) < 100
  const patch = {
    company_name: business.businessName || null,
    tax_id: business.taxId || null,
    address: business.address || null,
    phone: business.phone || null,
    vat_enabled: Boolean(financePayment.vatEnabled),
    vat_rate: financePayment.vatEnabled || Number(financePayment.defaultVatPercent) > 0 ? Number(financePayment.defaultVatPercent) : null,
    vat_mode: financePayment.vatEnabled || Number(financePayment.defaultVatPercent) > 0 ? financePayment.vatCalculationMode : null,
    doc_number_formats: Object.fromEntries(
      DOC_TYPES.map(([appKey, serverKey]) => [serverKey, toServerFormat(documentNumbering[appKey])])
    ),
    policies: {
      notifications,
      discount_limit_enabled: discountLimited,
      discount_limit_percent: discountLimited ? Number(financePayment.maximumDiscountPercent) : null,
      app_config: { ...rest, business, financePayment },
    },
  }
  const row = await rpc<StoreSettingsRow>('settings_update', { p_patch: patch, p_reason: reason?.trim() || 'อัปเดตการตั้งค่าระบบ' })
  setCachedPolicies(row.policies)
}
