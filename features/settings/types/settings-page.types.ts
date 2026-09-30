export type AutoLockDuration = '3' | '5' | '10' | '15'

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
  reservationExpiryPolicy: 'UNTIL_START_DATE' | 'MANUAL' | 'DAYS_LIMIT'
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

export interface FinancePaymentSettings {
  paymentMethods: {
    cash: boolean
    bankTransfer: boolean
    promptPay: boolean
    credit: boolean
  }
  defaultVatPercent: number
  vatEnabled: boolean
  vatCalculationMode: 'EXCLUSIVE' | 'INCLUSIVE'
  defaultWithholdingPercent: number
  maximumDiscountPercent: number
  defaultDepositPercent: number
  autoCreateFinanceTransaction: boolean
  moneyPrecision: number
  roundingMode: 'ROUND_HALF_UP' | 'ROUND_UP' | 'ROUND_DOWN'
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

export type SettingsTab =
  | 'BUSINESS'
  | 'PRODUCTS_STOCK'
  | 'RENTAL_BILLS'
  | 'DOCUMENTS'
  | 'FINANCE'
  | 'NOTIFICATIONS'
  | 'SYSTEM_ACCOUNT'

export type BusinessSubTab = 'INFO' | 'BRANDING'
export type DocumentsSubTab = 'NUMBERS' | 'PRINTING'
export type SystemAccountSubTab = 'SECURITY' | 'BACKUP'
