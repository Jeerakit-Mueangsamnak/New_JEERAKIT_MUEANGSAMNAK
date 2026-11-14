/** Expense categories = the server's fixed list (expense_entries_category_check, Master §22). */
export const EXPENSE_CATEGORIES: Array<{ code: string; label: string }> = [
  { code: 'PURCHASE', label: 'ซื้อสินค้า' },
  { code: 'REPAIR', label: 'ค่าซ่อม' },
  { code: 'SHIPPING', label: 'ค่าขนส่ง' },
  { code: 'LABOR', label: 'ค่าแรง' },
  { code: 'FUEL', label: 'ค่าน้ำมัน' },
  { code: 'EQUIPMENT', label: 'ค่าอุปกรณ์' },
  { code: 'GENERAL', label: 'ค่าใช้จ่ายทั่วไป' },
]
