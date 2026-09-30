export interface ReportDateFilter {
  startDate: Date
  endDate: Date
  granularity: 'daily' | 'monthly'
}

export const THAI_MONTH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
]

export const THAI_MONTH_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
]

export function toLocalDateString(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatThaiDate(dateStr?: string | null): string {
  if (!dateStr) return '-'
  const clean = dateStr.split('T')[0]
  const parts = clean.split('-')
  if (parts.length === 3) {
    const day = parseInt(parts[2], 10)
    const monthIdx = parseInt(parts[1], 10) - 1
    const yearBE = parseInt(parts[0], 10) + 543
    return `${day} ${THAI_MONTH_SHORT[monthIdx] || ''} ${yearBE}`
  }
  return dateStr
}

export function formatCurrency(amount: number): string {
  return (amount || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatNumber(val: number): string {
  return (val || 0).toLocaleString('th-TH')
}

export function isDateInRange(dateStr: string | undefined | null, start: Date, end: Date): boolean {
  if (!dateStr) return false
  const clean = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr.slice(0, 10)
  const startStr = toLocalDateString(start)
  const endStr = toLocalDateString(end)
  return clean >= startStr && clean <= endStr
}

export function getPreviousPeriod(start: Date, end: Date): { prevStart: Date; prevEnd: Date } {
  const durationMs = end.getTime() - start.getTime()
  const durationDays = Math.max(1, Math.round(durationMs / (24 * 60 * 60 * 1000))) + 1
  const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000)
  const prevStart = new Date(prevEnd.getTime() - (durationDays - 1) * 24 * 60 * 60 * 1000)
  return { prevStart, prevEnd }
}

export function calculateGrowth(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0
  }
  return Math.round(((current - previous) / Math.abs(previous)) * 100)
}

// Generate time buckets for daily / monthly grouping
export function generateTimeBuckets(
  start: Date,
  end: Date,
  granularity: 'daily' | 'monthly'
): Array<{ key: string; label: string }> {
  const buckets: Array<{ key: string; label: string }> = []

  if (granularity === 'daily') {
    const cur = new Date(start)
    while (cur <= end) {
      const key = toLocalDateString(cur)
      const day = cur.getDate()
      const mIdx = cur.getMonth()
      const label = `${day} ${THAI_MONTH_SHORT[mIdx]}`
      buckets.push({ key, label })
      cur.setDate(cur.getDate() + 1)
    }
  } else {
    // monthly
    const cur = new Date(start.getFullYear(), start.getMonth(), 1)
    const last = new Date(end.getFullYear(), end.getMonth(), 1)
    while (cur <= last) {
      const year = cur.getFullYear()
      const mIdx = cur.getMonth()
      const key = `${year}-${String(mIdx + 1).padStart(2, '0')}`
      const label = `${THAI_MONTH_SHORT[mIdx]} ${year + 543}`
      buckets.push({ key, label })
      cur.setMonth(cur.getMonth() + 1)
    }
  }

  return buckets
}

// ─────────────────────────────────────────────────────────────────────────────
