/**
 * Shop (SYSTEM) settings for the UI. The single source of truth is the public.store_settings
 * row (features/settings/api/settings-repository.ts), written section by section through
 * settings_update (OWNER only, audited on the server). This module keeps the in-memory copy
 * the screens read — no browser storage. Only values with a real consumer live here
 * (features/settings/settings-registry.ts lists each key, its scope and consumer).
 *
 * PROFILE values (name, avatar, PIN, auto-lock choice) live on the user's own profile rows;
 * DEVICE values (theme) live in this browser only (lib/contexts/ThemeContext).
 */

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
}

/**
 * VAT rate + price mode and the discount limit. VAT ON/OFF is NOT a shop setting: it is chosen
 * per bill at the POS and snapshotted on the bill by the server.
 */
export interface TaxDiscountSettings {
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
  /** policies.reservation_auto_release — the hourly job releases expired holds when on. */
  reservationAutoRelease: boolean
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

/** Which auto-lock times users may pick, and the default for users who did not pick one. */
export interface ShopSecuritySettings {
  autoLockOptionsSeconds: number[]
  autoLockDefaultSeconds: number
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
  shopSecurity: ShopSecuritySettings
  line: LineSettings
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
  | 'shopSecurity'
  | 'line'

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
  taxDiscount: { vatRate: null, vatMode: null, discountLimitEnabled: false, discountLimitPercent: null },
  payment: { allowOverpayment: false },
  salesRental: { allowBackorder: false, reservationAutoRelease: false },
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
  shopSecurity: { autoLockOptionsSeconds: [30, 60, 120, 180, 240, 300, 600, 0], autoLockDefaultSeconds: 300 },
  // LINE notices are off until the OWNER switches a type on (spec F4).
  line: { notify: {}, templates: {}, other: {} },
}

/** Every auto-lock time the app offers (Master §4: 30 s … 10 min, 0 = never). */
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

/** VAT can be switched on for a bill only once the OWNER has set the rate and mode. */
export function isVatConfigured(cfg: SystemConfig = loadSystemSettings()): boolean {
  return cfg.taxDiscount.vatRate !== null && cfg.taxDiscount.vatRate > 0 && cfg.taxDiscount.vatMode !== null
}
