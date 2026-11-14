import { createClient } from '@/lib/supabase/client'
import { FORM_NOTE_LINES } from '@/features/documents/utils/form-notes'
import { parseLineCardDesigns } from '@/lib/line/bill-card-design'
import { parseLineMessageTemplates } from '@/lib/line/message-templates'
import { rpc } from '@/lib/db/rpc'
import { setCachedPolicies, type Policies } from '@/lib/db/policies'
import {
  activePaymentAccount,
  activeShopProfile,
  withActivePaymentAccount,
  withActiveShopProfile,
  type PaymentAccount,
  type ShopProfile,
  DEFAULT_SYSTEM_CONFIG,
  DOCUMENT_TYPES,
  DOC_DIGITS_DEFAULT,
  DOC_DIGITS_MAX,
  DOC_DIGITS_MIN,
  type BusinessSettings,
  type DocumentNumberingSettings,
  type DocumentType,
  type NotificationSettings,
  type SettingsSection,
  type SystemConfig,
} from '@/features/settings/services/settings-storage'

/**
 * Shop (SYSTEM) settings live in the single public.store_settings row:
 * - columns: company info, logo, timezone, VAT rate + price mode (VAT ON/OFF is per bill);
 * - doc_number_formats: { TYPE: { prefix, digits } } for PREFIX-DDMMBBBB-RUNNING;
 * - policies: one top-level key per setting group (business_profile, payment_receiving, …).
 * Each Settings section is written on its own through settings_update (OWNER only on the
 * server, audited) and only its keys are sent.
 *
 * Old data: values the previous screen kept in policies.app_config are read as a fallback
 * (new source first) until each section is saved once; app_config itself is never written
 * or deleted here.
 */

export interface StoreSettingsRow {
  company_name: string | null
  tax_id: string | null
  address: string | null
  phone: string | null
  logo_url: string | null
  timezone: string
  vat_enabled: boolean
  vat_rate: number | string | null
  vat_mode: string | null
  doc_number_formats: Record<string, { prefix?: string; digits?: number } | undefined> | null
  policies: Policies | null
}

type LegacyAppConfig = {
  business?: Partial<BusinessSettings> & Record<string, unknown>
  productStock?: { defaultMinimumStock?: number }
}

const BUSINESS_PROFILE_KEYS = ['email', 'lineId', 'authorizedPerson'] as const
const PAYMENT_RECEIVING_KEYS = ['bankName', 'bankAccountName', 'bankAccountNumber', 'promptPayType', 'promptPayValue', 'bankQrDataUrl'] as const

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function str(...values: unknown[]): string {
  for (const v of values) if (typeof v === 'string') return v
  return ''
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** store_settings row → app settings (pure; new source first, old app_config as fallback). */
export function rowToConfig(row: StoreSettingsRow): SystemConfig {
  const pol = obj(row.policies)
  const legacy = obj(pol.app_config) as LegacyAppConfig
  const oldBiz = obj(legacy.business)
  const profile = obj(pol.business_profile)
  const receiving = obj(pol.payment_receiving)
  const d = DEFAULT_SYSTEM_CONFIG

  const singleAccount: BusinessSettings = {
    businessName: str(row.company_name, oldBiz.businessName),
    taxId: str(row.tax_id, oldBiz.taxId),
    address: str(row.address, oldBiz.address),
    phone: str(row.phone, oldBiz.phone),
    logoDataUrl: str(row.logo_url, oldBiz.logoDataUrl),
    email: str(profile.email, oldBiz.email),
    lineId: str(profile.lineId, oldBiz.lineId),
    authorizedPerson: str(profile.authorizedPerson, oldBiz.authorizedPerson),
    bankName: str(receiving.bankName, oldBiz.bankName),
    bankAccountName: str(receiving.bankAccountName, oldBiz.bankAccountName),
    bankAccountNumber: str(receiving.bankAccountNumber, oldBiz.bankAccountNumber),
    promptPayType: str(receiving.promptPayType, oldBiz.promptPayType) || 'TAX_ID',
    promptPayValue: str(receiving.promptPayValue, oldBiz.promptPayValue),
    bankQrDataUrl: str(receiving.bankQrDataUrl, oldBiz.bankQrDataUrl),
  }
  // Several accounts (owner 2026-11-13); a shop saved before that has its one account in the single fields.
  const savedAccounts: PaymentAccount[] = (Array.isArray(receiving.accounts) ? receiving.accounts : [])
    .map((a) => obj(a))
    .filter((a) => typeof a.id === 'string' && a.id)
    .map((a) => ({
      id: String(a.id),
      bankName: str(a.bankName),
      bankAccountName: str(a.bankAccountName),
      bankAccountNumber: str(a.bankAccountNumber),
      promptPayType: str(a.promptPayType) || 'TAX_ID',
      promptPayValue: str(a.promptPayValue),
      bankQrDataUrl: str(a.bankQrDataUrl),
    }))
  // Several sets of shop details (owner 2026-11-14); a shop saved before that has its one set in the single fields.
  const savedProfiles: ShopProfile[] = (Array.isArray(profile.profiles) ? profile.profiles : [])
    .map((p) => obj(p))
    .filter((p) => typeof p.id === 'string' && p.id)
    .map((p) => ({
      id: String(p.id),
      businessName: str(p.businessName),
      taxId: str(p.taxId),
      address: str(p.address),
      phone: str(p.phone),
      email: str(p.email),
      lineId: str(p.lineId),
      authorizedPerson: str(p.authorizedPerson),
      logoDataUrl: str(p.logoDataUrl),
    }))
  const business: BusinessSettings = withActiveShopProfile(withActivePaymentAccount({
    ...singleAccount,
    paymentAccounts: savedAccounts.length ? savedAccounts : [{ ...activePaymentAccount(singleAccount), id: 'acc-1' }],
    activePaymentAccountId: str(receiving.activeAccountId),
    shopProfiles: savedProfiles.length ? savedProfiles : [{ ...activeShopProfile(singleAccount), id: 'shop-1' }],
    activeShopProfileId: str(profile.activeProfileId),
  }))

  const formats = obj(row.doc_number_formats)
  const documentNumbering = Object.fromEntries(
    DOCUMENT_TYPES.map(({ type, prefix }) => {
      const f = obj(formats[type])
      const digits = num(f.digits)
      return [type, { prefix: str(f.prefix) || prefix, digits: digits ?? DOC_DIGITS_DEFAULT }]
    })
  ) as DocumentNumberingSettings

  const savedNotices = obj(pol.notifications) as Partial<NotificationSettings>
  const notifications = Object.fromEntries(
    (Object.keys(d.notifications) as Array<keyof NotificationSettings>).map((k) => [k, { ...d.notifications[k], ...obj(savedNotices[k]) }])
  ) as unknown as NotificationSettings

  const options = Array.isArray(pol.auto_lock_options_seconds)
    ? (pol.auto_lock_options_seconds as unknown[]).map(Number).filter((n) => Number.isFinite(n))
    : d.shopSecurity.autoLockOptionsSeconds
  const reorder = num(pol.default_reorder_point) ?? num(legacy.productStock?.defaultMinimumStock)
  const { notify: lineNotify, templates: lineTemplates, ...lineOther } = obj(pol.line)

  return {
    timezone: row.timezone || d.timezone,
    business,
    taxDiscount: {
      vatEnabled: (num(row.vat_rate) ?? 0) > 0,
      vatRate: num(row.vat_rate),
      vatMode: row.vat_mode === 'INCLUSIVE' || row.vat_mode === 'EXCLUSIVE' ? row.vat_mode : null,
      discountLimitEnabled: pol.discount_limit_enabled === true,
      discountLimitPercent: pol.discount_limit_enabled === true ? num(pol.discount_limit_percent) : null,
    },
    payment: { allowOverpayment: bool(pol.allow_overpayment, d.payment.allowOverpayment) },
    salesRental: {
      allowBackorder: bool(pol.allow_backorder, d.salesRental.allowBackorder),
      reservationAutoRelease: bool(pol.reservation_auto_release, d.salesRental.reservationAutoRelease),
    },
    product: { defaultReorderPoint: reorder ?? d.product.defaultReorderPoint },
    documentNumbering,
    notifications,
    shopSecurity: {
      autoLockOptionsSeconds: options,
      autoLockDefaultSeconds: num(pol.auto_lock_default_seconds) ?? d.shopSecurity.autoLockDefaultSeconds,
    },
    lineBillCards: parseLineCardDesigns(pol.line_bill_cards),
    lineMessageTemplates: parseLineMessageTemplates(pol.line_message_templates),
    documentNotes: Object.fromEntries(
      Object.entries(obj(pol.document_notes))
        .filter(([, lines]) => Array.isArray(lines))
        .map(([id, lines]) => [id, (lines as unknown[]).slice(0, FORM_NOTE_LINES).map((t) => (typeof t === 'string' ? t : ''))])
    ),
    line: {
      notify: Object.fromEntries(Object.entries(obj(lineNotify)).filter(([, on]) => on === true)) as Record<string, boolean>,
      templates: Object.fromEntries(Object.entries(obj(lineTemplates)).filter(([, t]) => typeof t === 'string')) as Record<string, string>,
      other: lineOther,
    },
  }
}

const sortedEntries = <T,>(o: Record<string, T>) => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

const clampDays = (v: unknown) => Math.max(0, Math.min(365, Math.floor(Number(v) || 0)))

/** The settings_update patch for ONE section: only that section's columns / policy keys. */
export function sectionPatch(section: SettingsSection, cfg: SystemConfig): Record<string, unknown> {
  switch (section) {
    case 'business': {
      // the columns + single fields = the set in use (older readers), plus the whole list
      const b = withActiveShopProfile(cfg.business)
      const trimmed = (p: ShopProfile) =>
        Object.fromEntries(Object.entries(p).map(([k, v]) => [k, k === 'logoDataUrl' ? v || '' : (v || '').trim()]))
      return {
        company_name: b.businessName.trim() || null,
        tax_id: b.taxId.trim() || null,
        address: b.address.trim() || null,
        phone: b.phone.trim() || null,
        logo_url: b.logoDataUrl || null,
        policies: {
          business_profile: {
            ...Object.fromEntries(BUSINESS_PROFILE_KEYS.map((k) => [k, (b[k] || '').trim()])),
            profiles: (b.shopProfiles ?? []).map(trimmed),
            activeProfileId: b.activeShopProfileId || '',
          },
        },
      }
    }
    case 'payment': {
      const b = withActivePaymentAccount(cfg.business)
      const trimmed = (a: PaymentAccount) =>
        Object.fromEntries(['id', ...PAYMENT_RECEIVING_KEYS].map((k) => [k, (a[k as keyof PaymentAccount] || '').trim()]))
      return {
        policies: {
          // the single fields = the account in use (older readers), plus the whole list
          payment_receiving: {
            ...Object.fromEntries(PAYMENT_RECEIVING_KEYS.map((k) => [k, (b[k] || '').trim()])),
            accounts: (b.paymentAccounts ?? []).map(trimmed),
            activeAccountId: b.activePaymentAccountId || '',
          },
          allow_overpayment: cfg.payment.allowOverpayment,
        },
      }
    }
    case 'taxDiscount': {
      const t = cfg.taxDiscount
      const limitOn = t.discountLimitEnabled
      return {
        // Only the rate: รวม / ไม่รวม VAT is chosen on each bill / quotation (owner 2026-11-04).
        // Switch off = no rate saved (the POS then cannot add VAT to a bill).
        vat_rate: t.vatEnabled && t.vatRate !== null ? Number(t.vatRate) : null,
        policies: { discount_limit_enabled: limitOn, discount_limit_percent: limitOn ? Number(t.discountLimitPercent) : null },
      }
    }
    case 'salesRental':
      return {
        policies: {
          allow_backorder: cfg.salesRental.allowBackorder,
          reservation_auto_release: cfg.salesRental.reservationAutoRelease,
        },
      }
    case 'product':
      return { policies: { default_reorder_point: Math.max(0, Math.floor(Number(cfg.product.defaultReorderPoint) || 0)) } }
    case 'documentNumbering':
      return {
        doc_number_formats: Object.fromEntries(
          DOCUMENT_TYPES.map(({ type }) => {
            const f = cfg.documentNumbering[type]
            const digits = Math.min(DOC_DIGITS_MAX, Math.max(DOC_DIGITS_MIN, Math.floor(Number(f.digits) || DOC_DIGITS_DEFAULT)))
            return [type, { prefix: f.prefix.trim().toUpperCase(), digits }]
          })
        ),
      }
    case 'notifications': {
      const n = cfg.notifications
      return {
        policies: {
          notifications: {
            deliveryReminder: { enabled: !!n.deliveryReminder.enabled, daysBefore: clampDays(n.deliveryReminder.daysBefore) },
            returnReminder: { enabled: !!n.returnReminder.enabled, daysBefore: clampDays(n.returnReminder.daysBefore) },
            paymentReminder: { enabled: !!n.paymentReminder.enabled, daysBefore: clampDays(n.paymentReminder.daysBefore) },
            lowStockReminder: { enabled: !!n.lowStockReminder.enabled },
            overdueReturnReminder: { enabled: !!n.overdueReturnReminder.enabled },
            appointmentReminder: { enabled: !!n.appointmentReminder.enabled, daysBefore: clampDays(n.appointmentReminder.daysBefore) },
          },
        },
      }
    }
    case 'shopSecurity':
      return {
        policies: {
          auto_lock_options_seconds: [...cfg.shopSecurity.autoLockOptionsSeconds],
          auto_lock_default_seconds: cfg.shopSecurity.autoLockDefaultSeconds,
        },
      }
    case 'documentNotes':
      return {
        policies: {
          document_notes: Object.fromEntries(sortedEntries(cfg.documentNotes).map(([id, lines]) => [id, lines.map((t) => t.trim())])),
        },
      }
    case 'lineMessageTemplates':
      return {
        policies: {
          line_message_templates: cfg.lineMessageTemplates.map((t) => ({ ...t, name: t.name.trim(), subject: t.subject.trim() })),
        },
      }
    case 'lineBillCards':
      return {
        policies: {
          line_bill_cards: cfg.lineBillCards.map((d) => ({ ...d, name: d.name.trim(), title: d.title.trim(), badge: d.badge.trim(), footer: d.footer.trim() })),
        },
      }
    case 'line': {
      // policies.line is replaced as a whole by settings_update, so the keys this screen does
      // not edit (link limits) go back unchanged. Only "on" types and non-empty texts are kept.
      const l = cfg.line
      return {
        policies: {
          line: {
            ...l.other,
            notify: Object.fromEntries(sortedEntries(l.notify).filter(([, on]) => on === true)),
            templates: Object.fromEntries(
              sortedEntries(l.templates)
                .map(([k, t]) => [k, (t ?? '').trim()] as const)
                .filter(([, t]) => t !== '')
            ),
          },
        },
      }
    }
  }
}

/** Reads the shop settings row; null when signed out / not yet allowed. */
export async function fetchSharedSystemConfig(): Promise<SystemConfig | null> {
  const supabase = createClient()
  const { data, error } = await supabase.from('store_settings').select('*').maybeSingle()
  if (error || !data) return null
  const row = data as StoreSettingsRow
  setCachedPolicies(row.policies)
  return rowToConfig(row)
}

export const SECTION_REASON: Record<SettingsSection, string> = {
  business: 'แก้ข้อมูลกิจการ',
  taxDiscount: 'แก้ภาษีและส่วนลด',
  payment: 'แก้การรับชำระเงิน',
  salesRental: 'แก้การขาย/เช่า/จอง',
  product: 'แก้ค่าเริ่มต้นสินค้า',
  documentNumbering: 'แก้รูปแบบเลขเอกสาร',
  notifications: 'แก้การแจ้งเตือน',
  shopSecurity: 'แก้ความปลอดภัยร้าน',
  line: 'แก้การตั้งค่า LINE',
  documentNotes: 'แก้หมายเหตุเอกสาร',
  lineBillCards: 'แก้การ์ดบิล LINE',
  lineMessageTemplates: 'แก้แม่แบบข้อความ LINE',
}

/** Saves ONE section (only its keys) and returns the whole config the server now holds. */
export async function saveSettingsSection(section: SettingsSection, draft: SystemConfig): Promise<SystemConfig> {
  const row = await rpc<StoreSettingsRow>('settings_update', { p_patch: sectionPatch(section, draft), p_reason: SECTION_REASON[section] })
  setCachedPolicies(row.policies)
  return rowToConfig(row)
}

/**
 * The next number the server would give this document type with this prefix/digits — made by
 * the same SQL formatter as _next_document_no (nothing is consumed). Needs the local migration
 * 20261007094216_settings_architecture_v1.sql.
 */
export async function previewDocumentNumber(type: DocumentType, prefix: string, digits: number): Promise<string> {
  return rpc<string>('document_number_preview', { p_doc_type: type, p_prefix: prefix, p_digits: digits })
}
