/**
 * ตั้งค่าระบบ › สำรองข้อมูล (owner 2026-11-15): the OWNER ticks which data to save and a date range,
 * and gets one JSON file. Each choice = the database tables that belong together.
 * Left out on purpose: PIN hashes, PIN checks, sign-in throttle, one-time keys and LINE link codes
 * (security data that must never sit in a file), and the fixed menu list.
 */
export interface BackupTable {
  name: string
  /** Rows are kept only when created_at is inside the chosen dates (tables without created_at go whole). */
  dated: boolean
  /** Primary key, so each page of rows is read in the same order. */
  order: string[]
}

const t = (name: string, order: string[] = ['id'], dated = true): BackupTable => ({ name, dated, order })

export const BACKUP_GROUPS = [
  { id: 'customers', label: 'ลูกค้าและเอกสารลูกค้า', tables: [t('customers'), t('customer_documents')] },
  {
    id: 'products',
    label: 'สินค้าและสต็อก',
    tables: [
      t('product_categories'),
      t('units'),
      t('products'),
      t('product_units'),
      t('product_costs', ['product_id'], false),
      t('stock_balances', ['product_id', 'stock_state'], false),
      t('stock_movements'),
      t('stock_counts'),
      t('stock_count_lines'),
    ],
  },
  {
    id: 'bills',
    label: 'บิล การส่งของ และการรับคืน',
    tables: [
      t('bills'),
      t('bill_lines'),
      t('bill_adjustments'),
      t('charges'),
      t('deliveries'),
      t('delivery_lines'),
      t('returns'),
      t('return_lines'),
      t('incident_cases'),
      t('write_offs'),
      t('rental_carry_forwards'),
      t('rental_carry_forward_units', ['carry_forward_id', 'product_unit_id']),
      t('rental_carry_forward_reversals'),
      t('reservations'),
    ],
  },
  {
    id: 'payments',
    label: 'การรับเงิน การคืนเงิน และการเงิน',
    tables: [
      t('payments'),
      t('payment_receipts'),
      t('bill_payment_allocations'),
      t('refunds'),
      t('finance_ledger_entries'),
      t('expense_entries'),
      t('other_income_entries'),
    ],
  },
  { id: 'quotations', label: 'ใบเสนอราคา', tables: [t('quotations'), t('quotation_items')] },
  { id: 'appointments', label: 'นัดหมาย', tables: [t('appointments'), t('appointment_history')] },
  {
    id: 'documents',
    label: 'แบบฟอร์มและเลขที่เอกสาร',
    tables: [t('document_templates'), t('document_names'), t('document_references'), t('document_sequences', ['doc_type', 'period_key'], false)],
  },
  { id: 'line', label: 'LINE', tables: [t('line_contacts'), t('line_messages'), t('line_tasks'), t('line_deliveries')] },
  {
    id: 'members',
    label: 'ผู้ใช้และสิทธิ์',
    tables: [t('profiles'), t('user_menu_access', ['user_id', 'menu_code'], false), t('member_action_grants', ['user_id', 'action_code'], false)],
  },
  { id: 'shop', label: 'ตั้งค่าร้าน', tables: [t('store_settings', ['id'], false)] },
  { id: 'history', label: 'ประวัติการทำงานและการแจ้งเตือน', tables: [t('audit_logs'), t('notifications')] },
] as const satisfies ReadonlyArray<{ id: string; label: string; tables: BackupTable[] }>

export type BackupGroupId = (typeof BACKUP_GROUPS)[number]['id']

export const BACKUP_GROUP_IDS: BackupGroupId[] = BACKUP_GROUPS.map((g) => g.id)

export function isBackupGroupId(value: string): value is BackupGroupId {
  return (BACKUP_GROUP_IDS as string[]).includes(value)
}
