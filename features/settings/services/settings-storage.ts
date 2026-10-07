/**
 * System settings for the UI (Master v4.3.1 §37). The single source of truth is the
 * public.store_settings row (features/settings/api/settings-repository.ts), written through
 * settings_update (audited on the server). This module only keeps the in-memory copy the
 * screens read and the defaults shown before the row is loaded — no browser storage.
 */

export interface BusinessSettings {
  businessName: string
  address: string
  phone: string
  email: string
  taxId: string
  branchNo: string
  lineId: string
  authorizedPerson: string
  bankName: string
  bankAccountName: string
  bankAccountNumber: string
  promptPayValue: string
  promptPayType?: string
  logoDataUrl?: string
  bankQrDataUrl?: string
}

export interface ProductStockSettings {
  defaultMinimumStock: number
  allowZeroStock: boolean
  allowBackdatedStockAdjustment: boolean
  lowStockNotificationEnabled: boolean
}

export type ReservationExpiryPolicy = 'UNTIL_START_DATE' | 'MANUAL' | 'DAYS_LIMIT'

export interface RentalBillingSettings {
  defaultRentalType: string
  defaultRentalDays: number
  rentalDayCalculation: string
  gracePeriodDays: number
  lateFeeMode: string
  lateFeeValue: number
  dailyOverdueChargeEnabled: boolean
  returnCutoffTime: string
  allowPartialReturn: boolean
  allowPartialPayment: boolean
  allowContinueAfterPaid: boolean
  reservationExpiryPolicy: ReservationExpiryPolicy
  reservationExpiryDays: number
}

export interface DocNumberFormat {
  prefix: string
  runningDigits: number
  resetCycle: string
  yearMode: string
  includeDate: boolean
  datePattern: string
  separator?: string
  digits?: number
}

export interface DocumentNumberingSettings {
  rentalBill: DocNumberFormat
  quotation: DocNumberFormat
  receipt: DocNumberFormat
  returnSlip: DocNumberFormat
}

export interface DocumentPrintingSettings {
  defaultTemplates: {
    rentalBill: string
    quotation: string
    receipt: string
    returnSlip: string
  }
  paperSize: string
  margins: {
    top: number
    right: number
    bottom: number
    left: number
  }
  footerText: string
  showLogo?: boolean
  showQRCode?: boolean
  showAuthorizedPerson?: boolean
  showSignature?: boolean
  defaultCopies?: number
}

export type VatCalculationMode = 'EXCLUSIVE' | 'INCLUSIVE'
export type RoundingMode = 'ROUND_HALF_UP' | 'ROUND_UP' | 'ROUND_DOWN'

export interface FinancePaymentSettings {
  paymentMethods: {
    cash: boolean
    bankTransfer: boolean
    promptPay: boolean
    credit: boolean
  }
  defaultVatPercent: number
  vatEnabled: boolean
  vatCalculationMode: VatCalculationMode
  defaultWithholdingPercent: number
  maximumDiscountPercent: number
  defaultDepositPercent: number
  autoCreateFinanceTransaction: boolean
  moneyPrecision: number
  roundingMode: RoundingMode
}

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
  appointmentReminder: NotificationItemSettings
}

export interface BrandingSettings {
  systemName: string
  authBackgroundType?: 'gradient' | 'image' | 'default'
  authBackgroundImageUrl?: string | null
  appLogoUrl?: string | null
}

export interface SystemConfig {
  business: BusinessSettings
  productStock: ProductStockSettings
  rentalBilling: RentalBillingSettings
  documentNumbering: DocumentNumberingSettings
  documentPrinting: DocumentPrintingSettings
  financePayment: FinancePaymentSettings
  notifications: NotificationSettings
  branding: BrandingSettings
}

// Shop details are filled in by the OWNER in Settings — nothing is pre-filled.
export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  businessName: '',
  address: '',
  phone: '',
  email: '',
  taxId: '',
  branchNo: '',
  lineId: '',
  authorizedPerson: '',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  promptPayValue: '',
  promptPayType: 'TAX_ID',
  logoDataUrl: '',
  bankQrDataUrl: '',
}

export const DEFAULT_PRODUCT_STOCK_SETTINGS: ProductStockSettings = {
  defaultMinimumStock: 2,
  allowZeroStock: false,
  allowBackdatedStockAdjustment: false,
  lowStockNotificationEnabled: true,
}

export const DEFAULT_RENTAL_BILLING_SETTINGS: RentalBillingSettings = {
  defaultRentalType: 'DAILY',
  defaultRentalDays: 1,
  rentalDayCalculation: 'INCLUSIVE',
  gracePeriodDays: 0,
  lateFeeMode: 'NONE',
  lateFeeValue: 0,
  dailyOverdueChargeEnabled: false,
  returnCutoffTime: '18:00',
  allowPartialReturn: true,
  allowPartialPayment: true,
  allowContinueAfterPaid: false,
  reservationExpiryPolicy: 'UNTIL_START_DATE',
  reservationExpiryDays: 7,
}

export const DEFAULT_DOCUMENT_NUMBERING_SETTINGS: DocumentNumberingSettings = {
  // Owner default (2026-10-04): BL-2026-000001, new sequence each year; adjustable in Settings.
  rentalBill: { prefix: 'BL', runningDigits: 6, resetCycle: 'YEARLY', yearMode: 'CE', includeDate: true, datePattern: 'YYYY' },
  quotation: { prefix: 'QT', runningDigits: 6, resetCycle: 'YEARLY', yearMode: 'CE', includeDate: true, datePattern: 'YYYY' },
  receipt: { prefix: 'RCP', runningDigits: 6, resetCycle: 'YEARLY', yearMode: 'CE', includeDate: true, datePattern: 'YYYY' },
  returnSlip: { prefix: 'RT', runningDigits: 6, resetCycle: 'YEARLY', yearMode: 'CE', includeDate: true, datePattern: 'YYYY' },
}

export const DEFAULT_DOCUMENT_PRINTING_SETTINGS: DocumentPrintingSettings = {
  defaultTemplates: {
    rentalBill: '',
    quotation: '',
    receipt: '',
    returnSlip: '',
  },
  paperSize: 'A4',
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
  footerText: '',
  showLogo: true,
  showQRCode: true,
  showAuthorizedPerson: true,
  showSignature: true,
  defaultCopies: 1,
}

export const DEFAULT_FINANCE_PAYMENT_SETTINGS: FinancePaymentSettings = {
  paymentMethods: {
    cash: true,
    bankTransfer: true,
    promptPay: true,
    credit: false,
  },
  // VAT stays off with no preset rate until the OWNER fills in the shop's tax setup.
  defaultVatPercent: 0,
  vatEnabled: false,
  vatCalculationMode: 'EXCLUSIVE',
  defaultWithholdingPercent: 0,
  // 100 = no discount limit (the limit switch is off unless the OWNER sets a percent)
  maximumDiscountPercent: 100,
  defaultDepositPercent: 0,
  autoCreateFinanceTransaction: true,
  moneyPrecision: 2,
  roundingMode: 'ROUND_HALF_UP',
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  deliveryReminder: { enabled: true, daysBefore: 1 },
  returnReminder: { enabled: true, daysBefore: 1 },
  paymentReminder: { enabled: true, daysBefore: 1 },
  lowStockReminder: { enabled: true },
  overdueReturnReminder: { enabled: true },
  appointmentReminder: { enabled: true, daysBefore: 3 },
}

export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = {
  systemName: 'JJK_JeeRaKiT',
  authBackgroundType: 'gradient',
  authBackgroundImageUrl: null,
  appLogoUrl: null,
}

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  business: DEFAULT_BUSINESS_SETTINGS,
  productStock: DEFAULT_PRODUCT_STOCK_SETTINGS,
  rentalBilling: DEFAULT_RENTAL_BILLING_SETTINGS,
  documentNumbering: DEFAULT_DOCUMENT_NUMBERING_SETTINGS,
  documentPrinting: DEFAULT_DOCUMENT_PRINTING_SETTINGS,
  financePayment: DEFAULT_FINANCE_PAYMENT_SETTINGS,
  notifications: DEFAULT_NOTIFICATION_SETTINGS,
  branding: DEFAULT_BRANDING_SETTINGS,
}

let cachedSystemSettings: SystemConfig | null = null

/**
 * Merge loaded partial settings with complete defaults to guarantee field completeness.
 */
function mergeWithDefaults(loaded: Partial<SystemConfig>): SystemConfig {
  return {
    business: { ...DEFAULT_BUSINESS_SETTINGS, ...(loaded.business || {}) },
    productStock: { ...DEFAULT_PRODUCT_STOCK_SETTINGS, ...(loaded.productStock || {}) },
    rentalBilling: {
      ...DEFAULT_RENTAL_BILLING_SETTINGS,
      ...(loaded.rentalBilling || {}),
      reservationExpiryPolicy: loaded.rentalBilling?.reservationExpiryPolicy || DEFAULT_RENTAL_BILLING_SETTINGS.reservationExpiryPolicy,
      reservationExpiryDays: Number(loaded.rentalBilling?.reservationExpiryDays) || DEFAULT_RENTAL_BILLING_SETTINGS.reservationExpiryDays,
    },
    documentNumbering: {
      rentalBill: { ...DEFAULT_DOCUMENT_NUMBERING_SETTINGS.rentalBill, ...(loaded.documentNumbering?.rentalBill || {}) },
      quotation: { ...DEFAULT_DOCUMENT_NUMBERING_SETTINGS.quotation, ...(loaded.documentNumbering?.quotation || {}) },
      receipt: { ...DEFAULT_DOCUMENT_NUMBERING_SETTINGS.receipt, ...(loaded.documentNumbering?.receipt || {}) },
      returnSlip: { ...DEFAULT_DOCUMENT_NUMBERING_SETTINGS.returnSlip, ...(loaded.documentNumbering?.returnSlip || {}) },
    },
    documentPrinting: {
      ...DEFAULT_DOCUMENT_PRINTING_SETTINGS,
      ...(loaded.documentPrinting || {}),
      defaultTemplates: { ...DEFAULT_DOCUMENT_PRINTING_SETTINGS.defaultTemplates, ...(loaded.documentPrinting?.defaultTemplates || {}) },
      margins: { ...DEFAULT_DOCUMENT_PRINTING_SETTINGS.margins, ...(loaded.documentPrinting?.margins || {}) },
    },
    financePayment: {
      ...DEFAULT_FINANCE_PAYMENT_SETTINGS,
      ...(loaded.financePayment || {}),
      paymentMethods: { ...DEFAULT_FINANCE_PAYMENT_SETTINGS.paymentMethods, ...(loaded.financePayment?.paymentMethods || {}) },
      defaultVatPercent: Number(loaded.financePayment?.defaultVatPercent ?? DEFAULT_FINANCE_PAYMENT_SETTINGS.defaultVatPercent),
      vatEnabled: loaded.financePayment?.vatEnabled ?? DEFAULT_FINANCE_PAYMENT_SETTINGS.vatEnabled,
      vatCalculationMode: loaded.financePayment?.vatCalculationMode || DEFAULT_FINANCE_PAYMENT_SETTINGS.vatCalculationMode,
      maximumDiscountPercent: Number(loaded.financePayment?.maximumDiscountPercent ?? DEFAULT_FINANCE_PAYMENT_SETTINGS.maximumDiscountPercent),
      defaultDepositPercent: Number(loaded.financePayment?.defaultDepositPercent ?? DEFAULT_FINANCE_PAYMENT_SETTINGS.defaultDepositPercent),
      moneyPrecision: Number(loaded.financePayment?.moneyPrecision ?? DEFAULT_FINANCE_PAYMENT_SETTINGS.moneyPrecision),
      roundingMode: loaded.financePayment?.roundingMode || DEFAULT_FINANCE_PAYMENT_SETTINGS.roundingMode,
    },
    notifications: {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...(loaded.notifications || {}),
      deliveryReminder: { ...DEFAULT_NOTIFICATION_SETTINGS.deliveryReminder, ...(loaded.notifications?.deliveryReminder || {}) },
      returnReminder: { ...DEFAULT_NOTIFICATION_SETTINGS.returnReminder, ...(loaded.notifications?.returnReminder || {}) },
      paymentReminder: { ...DEFAULT_NOTIFICATION_SETTINGS.paymentReminder, ...(loaded.notifications?.paymentReminder || {}) },
      lowStockReminder: { ...DEFAULT_NOTIFICATION_SETTINGS.lowStockReminder, ...(loaded.notifications?.lowStockReminder || {}) },
      overdueReturnReminder: { ...DEFAULT_NOTIFICATION_SETTINGS.overdueReturnReminder, ...(loaded.notifications?.overdueReturnReminder || {}) },
    },
    branding: { ...DEFAULT_BRANDING_SETTINGS, ...(loaded.branding || {}) },
  }
}

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

/** Replace the in-memory copy with what the server returned. */
export function setCachedSystemSettings(config: Partial<SystemConfig>): SystemConfig {
  cachedSystemSettings = mergeWithDefaults(config)
  notifySettingsChanged(cachedSystemSettings)
  return cachedSystemSettings
}

/** Helper to get current centralized default minimum stock threshold for runtime warnings. */
export function getDefaultMinimumStock(): number {
  return loadSystemSettings().productStock.defaultMinimumStock ?? DEFAULT_PRODUCT_STOCK_SETTINGS.defaultMinimumStock
}

export interface ActorInfo {
  userId: string
  displayName: string
}

/** In-memory update after a successful server save (the server writes the audit). */
export function saveSystemSettings(config: Partial<SystemConfig> | SystemConfig): SystemConfig {
  cachedSystemSettings = mergeWithDefaults(config)
  notifySettingsChanged(cachedSystemSettings)
  return cachedSystemSettings
}

/** Back to defaults in memory (the server row is unchanged). */
export function resetSystemSettings(): SystemConfig {
  cachedSystemSettings = DEFAULT_SYSTEM_CONFIG
  notifySettingsChanged(DEFAULT_SYSTEM_CONFIG)
  return DEFAULT_SYSTEM_CONFIG
}
