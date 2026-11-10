/**
 * One payment taken in two methods: เงินสด + QR Code (owner 2026-11-05).
 * The method pressed first is taken first; when it covers only part of the amount, the rest
 * moves to the other method. `split` is that first, partial part; `method` takes the rest.
 *   e.g. due 1,000: cash 500 confirmed → split {CASH 500}, the screen moves to QR for 500.
 */
export type SplitMethod = 'CASH' | 'QR'

export interface SplitPart {
  method: SplitMethod
  amount: number
}

export interface Tender {
  method: string
  amount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export interface SplitTotals {
  /** What goes on record, in the order taken (amounts never include change). */
  tenders: Tender[]
  /** Sum of tenders. */
  collected: number
  /** Still not taken (> 0 = the rest stays owed / must still be taken). */
  remaining: number
  /** What the current method still has to take after the split part. */
  restDue: number
  /** Cash change to hand back. */
  change: number
}

/**
 * @param cashInput the เงินสดที่รับมา box; '' = exactly what is due.
 */
export function computeSplit(opts: {
  due: number
  split: SplitPart | null
  method: string | null
  cashInput: string
  /** Bill page: ค้างชำระ after a partial part keeps that part; the rest stays owed. */
  unpaidKeepsPart?: boolean
}): SplitTotals {
  const due = Math.max(0, round2(opts.due))
  const first = opts.split && opts.split.amount > 0 ? { ...opts.split, amount: Math.min(round2(opts.split.amount), due) } : null
  const restDue = round2(due - (first?.amount ?? 0))
  if (!opts.method || opts.method === 'UNPAID') {
    if (opts.method === 'UNPAID' && opts.unpaidKeepsPart && first) {
      return { tenders: [{ ...first }], collected: first.amount, remaining: restDue, restDue, change: 0 }
    }
    return { tenders: [], collected: 0, remaining: due, restDue: due, change: 0 }
  }

  let applied = restDue
  let change = 0
  if (opts.method === 'CASH') {
    const received = opts.cashInput === '' ? restDue : Math.max(0, parseFloat(opts.cashInput) || 0)
    applied = Math.min(received, restDue)
    change = round2(Math.max(0, received - restDue))
  }

  const tenders: Tender[] = []
  const add = (method: string, amount: number) => {
    const a = round2(amount)
    if (a <= 0) return
    const same = tenders.find((t) => t.method === method)
    if (same) same.amount = round2(same.amount + a)
    else tenders.push({ method, amount: a })
  }
  if (first) add(first.method, first.amount)
  add(opts.method, applied)
  const collected = round2(tenders.reduce((s, t) => s + t.amount, 0))
  return { tenders, collected, remaining: round2(Math.max(0, due - collected)), restDue, change }
}

/**
 * Splits tenders into what goes to the first bucket (up to `firstAmount`) and the rest, in order.
 * Used for: the old bill first, then a new เช่าต่อ bill; the bill total first, then the deposit.
 */
export function allocateTenders(tenders: Tender[], firstAmount: number): [Tender[], Tender[]] {
  let left = Math.max(0, round2(firstAmount))
  const first: Tender[] = []
  const rest: Tender[] = []
  for (const t of tenders) {
    const take = round2(Math.min(left, t.amount))
    if (take > 0) first.push({ ...t, amount: take })
    if (t.amount - take > 0.004) rest.push({ ...t, amount: round2(t.amount - take) })
    left = round2(left - take)
  }
  return [first, rest]
}
