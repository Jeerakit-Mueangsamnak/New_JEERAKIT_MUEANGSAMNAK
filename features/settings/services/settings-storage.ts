/**
 * Shop (SYSTEM) settings for the UI. The single source of truth is the public.store_settings
 * row (features/settings/api/settings-repository.ts), written section by section through
 * settings_update (OWNER only, audited on the server). This module keeps the in-memory copy
 * the screens read — no browser storage. Only values with a real consumer live here.
 *
 * PROFILE values (name, avatar, PIN, auto-lock choice) live on the user's own profile rows;
 * DEVICE values (theme) live in this browser only (lib/contexts/ThemeContext).
 */
import type { LineBillCardDesign } from '@/lib/line/bill-card-design'
import type { LineMessageTemplate } from '@/lib/line/message-templates'

export type VatCalculationMode = 'EXCLUSIVE' | 'INCLUSIVE'

/** Shop identity + the payment details printed on documents (read by the document renderer). */
export interface BusinessSettings {
  businessName: string
  address: string
  phone: string
  email: string
  taxId: string
  lineId: string
  authorizedPerson: string
  logoDataUrl?: string
  // ── รับชำระเงิน (shown on bills / receipts) ──
  bankName: string
  bankAccountName: string
  bankAccountNumber: string
  promptPayType?: string
  promptPayValue: string
  bankQrDataUrl?: string
  /**
   * Every account the shop can take money into (owner 2026-11-13). The OWNER picks the one in use in Settings; the
   * single fields above always hold that account, so payment windows and printed forms read them as before.
   */
  paymentAccounts?: PaymentAccount[]
  activePaymentAccountId?: string
  /**
   * Several sets of shop details, managed like the accounts (owner 2026-11-14): the set showing when ข้อมูลร้าน is
   * saved is the one in use, and the single fields above always hold it (forms, headers and LINE read them as before).
   */
  shopProfiles?: ShopProfile[]
  activeShopProfileId?: string
}

export interface ShopProfile {
  id: string
  businessName: string
  taxId: string
  address: string
  phone: string
  email: string
  lineId: string
  authorizedPerson: string
  logoDataUrl: string
}

const PROFILE_FIELDS = ['businessName', 'taxId', 'address', 'phone', 'email', 'lineId', 'authorizedPerson', 'logoDataUrl'] as const

export function newShopProfile(): ShopProfile {
  return { id: `shop-${Date.now().toString(36)}`, businessName: '', taxId: '', address: '', phone: '', email: '', lineId: '', authorizedPerson: '', logoDataUrl: '' }
}

/** The shop details in use (falls back to the first; with no list, the single fields). */
export function activeShopProfile(b: BusinessSettings): ShopProfile {
  const list = b.shopProfiles ?? []
  const found = list.find((p) => p.id === b.activeShopProfileId) ?? list[0]
  if (found) return found
  return {
    id: b.activeShopProfileId || 'shop-1',
    ...(Object.fromEntries(PROFILE_FIELDS.map((k) => [k, b[k] || ''])) as Omit<ShopProfile, 'id'>),
  }
}

/** Copies the shop details in use into the single fields. */
export function withActiveShopProfile(b: BusinessSettings): BusinessSettings {
  const p = activeShopProfile(b)
  return { ...b, activeShopProfileId: p.id, ...Object.fromEntries(PROFILE_FIELDS.map((k) => [k, p[k]])) }
}

export interface PaymentAccount {
  id: string
  bankName: string
  bankAccountName: string
  bankAccountNumber: string
  promptPayType: string
  promptPayValue: string
  bankQrDataUrl: string
}

const ACCOUNT_FIELDS = ['bankName', 'bankAccountName', 'bankAccountNumber', 'promptPayType', 'promptPayValue', 'bankQrDataUrl'] as const

export function newPaymentAccount(): PaymentAccount {
  return { id: `acc-${Date.now().toString(36)}`, bankName: '', bankAccountName: '', bankAccountNumber: '', promptPayType: 'TAX_ID', promptPayValue: '', bankQrDataUrl: '' }
}

/** The account in use (falls back to the first; with no list, the single fields). */
export function activePaymentAccount(b: BusinessSettings): PaymentAccount {
  const list = b.paymentAccounts ?? []
  const found = list.find((a) => a.id === b.activePaymentAccountId) ?? list[0]
  if (found) return found
  return {
    id: b.activePaymentAccountId || 'acc-1',
    bankName: b.bankName || '',
    bankAccountName: b.bankAccountName || '',
    bankAccountNumber: b.bankAccountNumber || '',
    promptPayType: b.promptPayType || 'TAX_ID',
    promptPayValue: b.promptPayValue || '',
    bankQrDataUrl: b.bankQrDataUrl || '',
  }
}

/** Copies the account in use into the single fields. */
export function withActivePaymentAccount(b: BusinessSettings): BusinessSettings {
  const acc = activePaymentAccount(b)
  return { ...b, activePaymentAccountId: acc.id, ...Object.fromEntries(ACCOUNT_FIELDS.map((k) => [k, acc[k]])) }
}

/**
 * VAT rate + price mode and the discount limit. vatEnabled is the Settings switch (owner 2026-11-12): off = no rate
 * is kept, so the POS cannot put VAT on a bill. รวม / ไม่รวม VAT is still chosen per bill at the POS.
 */
export interface TaxDiscountSettings {
  vatEnabled: boolean
  /** null = not set by the OWNER yet (VAT cannot be switched on for a bill). */
  vatRate: number | null
  vatMode: VatCalculationMode | null
  discountLimitEnabled: boolean
  /** The OWNER's own percent; null while the limit is off. */
  discountLimitPercent: number | null
}

export interface PaymentSettings {
  /** policies.allow_overpayment — payment_receive refuses more than the balance when off. */
  allowOverpayment: boolean
}

export interface SalesRentalSettings {
  /** policies.allow_backorder — bill_confirm refuses lines above available stock when off. */
  allowBackorder: boolean
}

export interface ProductSettings {
  /** Starting reorder point (products.reorder_point) for a NEW product. Low stock itself is per product. */
  defaultReorderPoint: number
}

/** PREFIX-DDMMBBBB-RUNNING; the running number restarts every local day (server _next_document_no). */
export interface DocNumberFormat {
  prefix: string
  digits: number
}

export type DocumentType =
  | 'QUOTATION'
  | 'RESERVATION'
  | 'BILL'
  | 'RECEIPT'
  | 'REFUND'
  | 'CREDIT_NOTE'
  | 'APPOINTMENT'
  | 'STOCK_ADJUSTMENT'
  | 'INVENTORY_COUNT'
  | 'DELIVERY'
  | 'RETURN'
  | 'EXPENSE'
  | 'OTHER_INCOME'

export type DocumentNumberingSettings = Record<DocumentType, DocNumberFormat>

export interface NotificationItemSettings {
  enabled: boolean
  daysBefore?: number
}

export interface NotificationSettings {
  deliveryReminder: NotificationItemSettings
  returnReminder: NotificationItemSettings
  paymentReminder: NotificationItemSettings
  lowStockReminder: { enabled: boolean }
  overdueReturnReminder: { enabled: boolean }
  /** Upcoming appointments: notice + the "ใกล้ถึงกำหนด" window of the calendar (days). */
  appointmentReminder: NotificationItemSettings
}

/**
 * LINE (store_settings.policies.line, checked again on the server by trg_store_settings_line_policy).
 * The OA credentials are NOT here: they live in Vault (app/actions/system-secrets.ts).
 */
export interface LineSettings {
  /** In-app notice type (notifications.event_type) → also send it to staff LINE. Off unless true. */
  notify: Record<string, boolean>
  /** Template key → the OWNER's own text; a missing key uses the built-in text. */
  templates: Record<string, string>
  /** Other policies.line keys (link limits) — not edited here, kept as they are on save. */
  other: Record<string, unknown>
}

export interface SystemConfig {
  /** store_settings.timezone — read only in the UI. */
  timezone: string
  business: BusinessSettings
  taxDiscount: TaxDiscountSettings
  payment: PaymentSettings
  salesRental: SalesRentalSettings
  product: ProductSettings
  documentNumbering: DocumentNumberingSettings
  notifications: NotificationSettings
  line: LineSettings
  /** หมายเหตุ lines per shop form (key = form id), printed instead of the form's own (owner 2026-11-12). */
  documentNotes: Record<string, string[]>
  /** ข้อมูลการบริการ per shop form (key = form id): [บริการให้เช่า, การบริการ], printed instead of the form's own (owner 2026-11-17). */
  documentServices: Record<string, string[]>
  /** การ์ดบิล LINE the shop designed (Settings › LINE, owner 2026-11-12). */
  lineBillCards: LineBillCardDesign[]
  /** แม่แบบข้อความ LINE (Settings › LINE, owner 2026-11-13). */
  lineMessageTemplates: LineMessageTemplate[]
}

/** Settings page sections; each one is saved on its own (only its keys are sent). */
export type SettingsSection =
  | 'business'
  | 'taxDiscount'
  | 'payment'
  | 'salesRental'
  | 'product'
  | 'documentNumbering'
  | 'notifications'
  | 'line'
  | 'documentNotes'
  | 'lineBillCards'
  | 'lineMessageTemplates'

/** Server default prefixes per document type (_next_document_no) and the Thai label. */
export const DOCUMENT_TYPES: ReadonlyArray<{ type: DocumentType; label: string; prefix: string }> = [
  { type: 'BILL', label: 'บิลขาย/เช่า', prefix: 'BL' },
  { type: 'QUOTATION', label: 'ใบเสนอราคา', prefix: 'QT' },
  { type: 'RECEIPT', label: 'ใบเสร็จรับเงิน', prefix: 'RCP' },
  { type: 'REFUND', label: 'ใบคืนเงิน', prefix: 'RF' },
  { type: 'CREDIT_NOTE', label: 'ใบลดหนี้', prefix: 'CN' },
  { type: 'RESERVATION', label: 'การจองสินค้า', prefix: 'RS' },
  { type: 'DELIVERY', label: 'ใบส่งของ', prefix: 'DL' },
  { type: 'RETURN', label: 'ใบรับคืน', prefix: 'RT' },
  { type: 'APPOINTMENT', label: 'นัดหมาย', prefix: 'AP' },
  { type: 'STOCK_ADJUSTMENT', label: 'ปรับสต็อก', prefix: 'SA' },
  { type: 'INVENTORY_COUNT', label: 'ตรวจนับสต็อก', prefix: 'IC' },
  { type: 'EXPENSE', label: 'รายจ่าย', prefix: 'EX' },
  { type: 'OTHER_INCOME', label: 'รายรับอื่น', prefix: 'OI' },
]

/** Running-number digits the server accepts (settings_update / _next_document_no). */
export const DOC_DIGITS_MIN = 3
export const DOC_DIGITS_MAX = 10
export const DOC_DIGITS_DEFAULT = 3

// Shop details are filled in by the OWNER in Settings — nothing is pre-filled.
export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  businessName: '',
  address: '',
  phone: '',
  email: '',
  taxId: '',
  lineId: '',
  authorizedPerson: '',
  logoDataUrl: '',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  promptPayType: 'TAX_ID',
  promptPayValue: '',
  bankQrDataUrl: '',
}

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  timezone: 'Asia/Bangkok',
  business: DEFAULT_BUSINESS_SETTINGS,
  // No VAT rate/mode and no discount limit until the OWNER sets them (never invented).
  taxDiscount: { vatEnabled: false, vatRate: null, vatMode: null, discountLimitEnabled: false, discountLimitPercent: null },
  payment: { allowOverpayment: false },
  salesRental: { allowBackorder: false },
  // Same starting value new products had before (the old minimum-stock default).
  product: { defaultReorderPoint: 2 },
  documentNumbering: Object.fromEntries(
    DOCUMENT_TYPES.map((d) => [d.type, { prefix: d.prefix, digits: DOC_DIGITS_DEFAULT }])
  ) as DocumentNumberingSettings,
  notifications: {
    deliveryReminder: { enabled: true, daysBefore: 1 },
    returnReminder: { enabled: true, daysBefore: 1 },
    paymentReminder: { enabled: true, daysBefore: 1 },
    lowStockReminder: { enabled: true },
    overdueReturnReminder: { enabled: true },
    appointmentReminder: { enabled: true, daysBefore: 3 },
  },
  // LINE notices are off until the OWNER switches a type on (spec F4).
  line: { notify: {}, templates: {}, other: {} },
  documentNotes: {},
  documentServices: {},
  lineBillCards: [],
  lineMessageTemplates: [],
}

/** Every auto-lock time the app offers (30 s … 10 min, 0 = never); each member picks one in ตั้งค่าส่วนตัว (owner 2026-11-17). */
export const AUTO_LOCK_CHOICES_SECONDS = [30, 60, 120, 180, 240, 300, 600, 0] as const

let cachedSystemSettings: SystemConfig | null = null

function notifySettingsChanged(config: SystemConfig): void {
  if (typeof window === 'undefined') return
  if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('app_settings_changed', { detail: config }))
  }
}

/** Current settings (server copy once loaded, defaults before). */
export function loadSystemSettings(): SystemConfig {
  return cachedSystemSettings || DEFAULT_SYSTEM_CONFIG
}

/** Replace the in-memory copy with what the server returned (from the single load path). */
export function setCachedSystemSettings(config: SystemConfig): SystemConfig {
  cachedSystemSettings = config
  notifySettingsChanged(config)
  return config
}

/** Back to defaults in memory (sign-out); the server row is unchanged. */
export function resetSystemSettings(): SystemConfig {
  cachedSystemSettings = null
  notifySettingsChanged(DEFAULT_SYSTEM_CONFIG)
  return DEFAULT_SYSTEM_CONFIG
}

/** Default reorder point for a new product (per-product products.reorder_point decides low stock). */
export function getDefaultReorderPoint(): number {
  return loadSystemSettings().product.defaultReorderPoint
}

/** VAT can be used on a bill / quotation once the OWNER has set the rate. รวม / ไม่รวม VAT is chosen on each
 *  document (owner 2026-11-04); taxDiscount.vatMode is only the old shop mode kept for documents saved before. */
export function isVatRateConfigured(cfg: SystemConfig = loadSystemSettings()): boolean {
  return cfg.taxDiscount.vatRate !== null && cfg.taxDiscount.vatRate > 0
}

/** Same as isVatRateConfigured (kept for older callers). */
export const isVatConfigured = isVatRateConfigured
