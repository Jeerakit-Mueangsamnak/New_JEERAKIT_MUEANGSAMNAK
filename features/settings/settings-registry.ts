import type { SettingsSection } from '@/features/settings/services/settings-storage'

/**
 * Every setting the app keeps, where it lives and who reads it. Rule: no real consumer = no
 * Settings UI. PROFILE = the signed-in user's own value, DEVICE = this browser only,
 * SYSTEM = the shop's value (OWNER only, checked by settings_update on the server).
 */
export type SettingScope = 'PROFILE' | 'DEVICE' | 'SYSTEM'

export interface SettingDefinition {
  key: string
  scope: SettingScope
  /** /settings section (SYSTEM) or /account tab (PROFILE / DEVICE). */
  section: SettingsSection | 'account.profile' | 'account.security' | 'account.notifications' | 'account.device'
  type: 'string' | 'number' | 'boolean' | 'enum' | 'image' | 'object'
  default?: unknown
  /** Who may change it. */
  permission: 'OWNER' | 'SELF'
  /** Where the value is stored. */
  storage: string
  /** true = the server checks the value (constraint / RPC), not only the form. */
  serverValidated: boolean
  /** Where the value is used at runtime. */
  consumer: string
}

export const SETTINGS_REGISTRY: readonly SettingDefinition[] = [
  // ── PROFILE (/account) ──
  { key: 'profile.name', scope: 'PROFILE', section: 'account.profile', type: 'string', permission: 'SELF', storage: 'profiles.first_name/last_name/display_name', serverValidated: true, consumer: 'header, audit names' },
  { key: 'profile.avatar', scope: 'PROFILE', section: 'account.profile', type: 'image', permission: 'SELF', storage: 'profiles.avatar_url', serverValidated: true, consumer: 'header avatar' },
  { key: 'profile.password', scope: 'PROFILE', section: 'account.security', type: 'string', permission: 'SELF', storage: 'Supabase Auth', serverValidated: true, consumer: 'sign-in' },
  { key: 'profile.pin', scope: 'PROFILE', section: 'account.security', type: 'string', permission: 'SELF', storage: 'user_pins (bcrypt)', serverValidated: true, consumer: 'app lock, risky actions' },
  { key: 'profile.autoLockSeconds', scope: 'PROFILE', section: 'account.security', type: 'enum', permission: 'SELF', storage: 'user_pins.auto_lock_seconds (set_auto_lock)', serverValidated: true, consumer: 'AppLockContext' },
  // ── DEVICE (/account) ──
  { key: 'device.theme', scope: 'DEVICE', section: 'account.device', type: 'enum', default: 'light', permission: 'SELF', storage: 'localStorage rental_pos_theme', serverValidated: false, consumer: 'ThemeContext' },
  // ── SYSTEM (/settings, OWNER only) ──
  { key: 'business.identity', scope: 'SYSTEM', section: 'business', type: 'object', permission: 'OWNER', storage: 'store_settings.company_name/tax_id/address/phone/logo_url + policies.business_profile', serverValidated: true, consumer: 'document renderer, bill / receipt print' },
  { key: 'timezone', scope: 'SYSTEM', section: 'business', type: 'string', default: 'Asia/Bangkok', permission: 'OWNER', storage: 'store_settings.timezone (read only in UI)', serverValidated: true, consumer: '_local_date, _next_document_no' },
  { key: 'tax.vatRate', scope: 'SYSTEM', section: 'taxDiscount', type: 'number', default: null, permission: 'OWNER', storage: 'store_settings.vat_rate', serverValidated: true, consumer: '_bill_compute_totals, POS preview' },
  { key: 'tax.vatMode', scope: 'SYSTEM', section: 'taxDiscount', type: 'enum', default: null, permission: 'OWNER', storage: 'store_settings.vat_mode', serverValidated: true, consumer: '_bill_compute_totals, POS preview' },
  { key: 'discount.limit', scope: 'SYSTEM', section: 'taxDiscount', type: 'object', default: { enabled: false, percent: null }, permission: 'OWNER', storage: 'policies.discount_limit_enabled/percent', serverValidated: true, consumer: '_discount_over_limit (PIN + reason), POS preview' },
  { key: 'payment.receiving', scope: 'SYSTEM', section: 'payment', type: 'object', permission: 'OWNER', storage: 'policies.payment_receiving', serverValidated: true, consumer: 'document renderer, bill QR' },
  { key: 'payment.allowOverpayment', scope: 'SYSTEM', section: 'payment', type: 'boolean', default: false, permission: 'OWNER', storage: 'policies.allow_overpayment', serverValidated: true, consumer: '_payment_receive_core' },
  { key: 'sales.allowBackorder', scope: 'SYSTEM', section: 'salesRental', type: 'boolean', default: false, permission: 'OWNER', storage: 'policies.allow_backorder', serverValidated: true, consumer: 'bill_confirm' },
  { key: 'reservation.autoRelease', scope: 'SYSTEM', section: 'salesRental', type: 'boolean', default: false, permission: 'OWNER', storage: 'policies.reservation_auto_release', serverValidated: true, consumer: 'reservations_expire job' },
  { key: 'product.defaultReorderPoint', scope: 'SYSTEM', section: 'product', type: 'number', default: 2, permission: 'OWNER', storage: 'policies.default_reorder_point', serverValidated: true, consumer: 'new product forms (products.reorder_point)' },
  { key: 'documentNumbering', scope: 'SYSTEM', section: 'documentNumbering', type: 'object', permission: 'OWNER', storage: 'store_settings.doc_number_formats {TYPE: {prefix, digits}}', serverValidated: true, consumer: '_next_document_no' },
  { key: 'profile.notifications', scope: 'PROFILE', section: 'account.notifications', type: 'object', permission: 'SELF', storage: 'profiles.notification_prefs (my_notification_prefs_set)', serverValidated: true, consumer: 'rental_overdue_scan (per member, own menus), appointment calendar' },
  { key: 'delivery.drivers', scope: 'SYSTEM', section: 'line', type: 'object', default: [], permission: 'OWNER', storage: 'policies.delivery_drivers [{id: D001, name, phone, active}]', serverValidated: false, consumer: 'appointments dispatch (สั่งงานคนขับ), work order timeline' },
  { key: 'line.notify', scope: 'SYSTEM', section: 'line', type: 'object', default: {}, permission: 'OWNER', storage: 'policies.line.notify {EVENT_TYPE: true}', serverValidated: true, consumer: 'line_notification_recipients (staff LINE fan-out)' },
  { key: 'line.templates', scope: 'SYSTEM', section: 'line', type: 'object', default: {}, permission: 'OWNER', storage: 'policies.line.templates {KEY: text}', serverValidated: true, consumer: 'lib/line/templates renderTemplate (webhook replies, staff notices, tasks)' },
  { key: 'line.credentials', scope: 'SYSTEM', section: 'line', type: 'object', permission: 'OWNER', storage: 'Supabase Vault (line_channel_set / line_channel_clear), never in store_settings', serverValidated: true, consumer: 'webhook signature check, outbox sender (server only)' },
  { key: 'security.autoLockOptions', scope: 'SYSTEM', section: 'shopSecurity', type: 'object', default: { options: [30, 60, 120, 180, 240, 300, 600, 0], default: 300 }, permission: 'OWNER', storage: 'policies.auto_lock_options_seconds / auto_lock_default_seconds', serverValidated: true, consumer: 'set_auto_lock, my_pin_status' },
]

/** Settings removed in the v1 rebuild (no consumer, or not a shop setting any more). */
export const REMOVED_SETTING_FIELDS = [
  'allowZeroStock',
  'allowBackdatedStockAdjustment',
  'defaultRentalType',
  'defaultRentalDays',
  'rentalDayCalculation',
  'returnCutoffTime',
  'gracePeriodDays',
  'lateFeeMode',
  'lateFeeValue',
  'dailyOverdueChargeEnabled',
  'allowPartialReturn',
  'allowPartialPayment',
  'allowContinueAfterPaid',
  'defaultWithholdingPercent',
  'defaultDepositPercent',
  'autoCreateFinanceTransaction',
  'moneyPrecision',
  'roundingMode',
  'paymentMethods',
  'vatEnabled',
  'defaultVatPercent',
  'maximumDiscountPercent',
  'defaultMinimumStock',
  'lowStockNotificationEnabled',
  'reservationExpiryPolicy',
  'reservationExpiryDays',
  'systemName',
  'authBackgroundType',
  'authBackgroundImageUrl',
  'appLogoUrl',
  'documentPrinting',
  'paperSize',
  'showQRCode',
  'showAuthorizedPerson',
  'defaultCopies',
  'footerText',
  'branchNo',
] as const
