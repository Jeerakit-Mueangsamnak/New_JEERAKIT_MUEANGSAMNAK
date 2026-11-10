'use client'

import { useState } from 'react'
import { toSatang } from '@/lib/money'
import { computeSplit, type SplitMethod, type SplitPart } from '@/features/pos/services/split-payment'
import {
  CASH_NOT_CONFIRMED_NOTICE,
  QR_NOT_RECEIVED_NOTICE,
  SPLIT_CASH_FIRST_NOTICE,
  useCashConfirmation,
  type PaymentNotice,
} from '@/features/pos/hooks/useCashConfirmation'
import type { PaymentMethodType } from '@/features/pos/components/payment/PaymentMethodSelector'

/** เงินสด + QR Code: the order pressed and how far the payment has got. */
export interface SplitState {
  order: [SplitMethod, SplitMethod]
  /** The first method's amount, once it is confirmed (cash ยืนยัน → ถูกต้อง / QR ได้รับเงินแล้ว). */
  part: SplitPart | null
  /** QR Code as the second method: ได้รับเงินแล้ว was pressed. */
  qrReceived: boolean
}

const isSplitMethod = (m: PaymentMethodType | null): m is SplitMethod => m === 'CASH' || m === 'QR'
const otherOf = (m: SplitMethod): SplitMethod => (m === 'CASH' ? 'QR' : 'CASH')

/**
 * How the money is taken (owner 2026-11-06). The buttons work like this:
 *  - one of เงินสด / QR Code pressed = that method alone (QR Code shows the QR in the middle of the screen)
 *  - เงินสด, then QR Code (e.g. 1,500 = cash 700 + transfer 800): back to the cash box → type 700 →
 *    ยืนยัน → ถูกต้อง → the QR for 800 opens → ได้รับเงินแล้ว → the bill can be saved
 *  - QR Code, then เงินสด: the QR opens first (the customer's transfer is typed there) → ได้รับเงินแล้ว →
 *    the cash box for the rest → ยืนยัน → ถูกต้อง → the bill can be saved
 *  - pressing one of the two again takes it out (the other one stays alone); ยกเลิก on the bar does the same
 *  - every button works on its own (owner 2026-11-09): the 1st press chooses it, the 2nd press un-chooses it;
 *    nothing is chosen until a button is pressed
 * Nothing is recorded here; the page sends `totals.tenders` when the bill is saved.
 */
export function useSplitPayment(opts: {
  due: number
  method: PaymentMethodType | null
  setMethod: (m: PaymentMethodType | null) => void
  cashInput: string
  setCashInput: (v: string) => void
  /** Bill page: cash below the amount due leaves the rest owed. POS payment page (false): the whole
   *  amount, or ค้างชำระ. On both, ค้างชำระ after a part was taken = that part is paid (owner 2026-11-11). */
  unpaidKeepsPart?: boolean
}) {
  const [stored, setStored] = useState<(SplitState & { dueKey: number }) | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [focusCash, setFocusCash] = useState(0)
  // The method the user pressed last. A method that is only pre-selected (the bill page opens on
  // เงินสด) is not "pressed first": pressing QR Code then means QR Code alone.
  const [pressed, setPressed] = useState<PaymentMethodType | null>(null)
  // Cash confirmed for less than the amount, then ค้างชำระ (owner 2026-11-11): that cash is taken and
  // the rest stays owed.
  const [kept, setKept] = useState<(SplitPart & { dueKey: number }) | null>(null)
  const dueKey = toSatang(opts.due)
  // A changed total (discount, items, deposit) starts the two-method payment again
  const split: SplitState | null = stored && stored.dueKey === dueKey ? stored : null
  const keptPart: SplitPart | null =
    !split && kept && kept.dueKey === dueKey && opts.method === 'UNPAID' ? { method: kept.method, amount: kept.amount } : null
  const part = split?.part ?? keptPart
  const totals = computeSplit({
    due: opts.due,
    split: part,
    method: opts.method,
    cashInput: opts.cashInput,
    unpaidKeepsPart: opts.unpaidKeepsPart || !!keptPart,
  })
  const cashFirstStep = !!split && !part && split.order[0] === 'CASH'
  const cashSecondStep = !!split && !!part && split.order[1] === 'CASH'

  let partialHint: string | undefined
  if (!split) {
    partialHint = opts.unpaidKeepsPart
      ? 'ส่วนที่ขาดจะค้างชำระไว้ในบิล (ถ้าลูกค้าโอนส่วนที่เหลือ กดปุ่ม "QR Code" เพิ่ม)'
      : 'ถ้าลูกค้าโอนส่วนที่เหลือ กดปุ่ม "QR Code" เพิ่ม'
  }
  const cash = useCashConfirmation({
    method: opts.method,
    cashInput: opts.cashInput,
    amountDue: totals.restDue,
    partialHint,
    required: cashFirstStep || cashSecondStep,
    step: cashSecondStep ? 'second' : 'first',
    restBy: cashFirstStep ? 'QR Code' : undefined,
  })

  const save = (s: SplitState | null) => setStored(s ? { ...s, dueKey } : null)
  const toCash = () => {
    opts.setCashInput('')
    opts.setMethod('CASH')
    setFocusCash((n) => n + 1)
  }

  const selectMethod = (m: PaymentMethodType) => {
    if (opts.method === m && !(split && isSplitMethod(m))) {
      // The chosen button pressed again: nothing is chosen any more
      setPressed(null)
      save(null)
      setKept(null)
      setQrOpen(false)
      cash.reset()
      opts.setCashInput('')
      opts.setMethod(null)
      return
    }
    setPressed(m)
    setKept(null)
    if (!isSplitMethod(m)) {
      // ค้างชำระ: nothing more is taken. What was already taken stays paid and the rest stays owed
      // (owner 2026-11-11): the first of two methods, or cash confirmed for part of the amount.
      if (!(opts.unpaidKeepsPart && part)) {
        let taken: SplitPart | null = split?.part ?? null
        if (!split && opts.method === 'CASH' && cash.isConfirmed) {
          const received = opts.cashInput === '' ? 0 : Number.parseFloat(opts.cashInput) || 0
          if (received > 0 && received + 0.004 < totals.restDue) taken = { method: 'CASH', amount: received }
        }
        if (taken) setKept({ ...taken, dueKey })
        save(null)
      }
      setQrOpen(false)
      opts.setMethod(m)
      return
    }
    if (split) {
      // One of the two pressed again: it comes out, the other one stays alone
      const keep = otherOf(m)
      setPressed(keep)
      save(null)
      setQrOpen(false)
      if (keep === 'CASH') toCash()
      else {
        opts.setMethod('QR')
        if (opts.due > 0) setQrOpen(true)
      }
      return
    }
    const current = opts.method
    if (isSplitMethod(current) && current === pressed && current !== m && opts.due > 0) {
      // The second button: both methods, in the order pressed — back to the first one's amount
      save({ order: [current, m], part: null, qrReceived: false })
      cash.reset()
      if (current === 'CASH') {
        opts.setMethod('CASH')
        setFocusCash((n) => n + 1)
      } else {
        opts.setMethod('QR')
        setQrOpen(true)
      }
      return
    }
    opts.setMethod(m)
    if (m === 'QR' && opts.due > 0) setQrOpen(true)
    if (m === 'CASH') setFocusCash((n) => n + 1)
  }

  const confirmCash = async (): Promise<boolean> => {
    const ok = await cash.confirmCash()
    if (!ok || !cashFirstStep || !split) return ok
    const received = opts.cashInput === '' ? totals.restDue : Number.parseFloat(opts.cashInput) || 0
    if (received + 0.004 < totals.restDue) {
      // Cash first: keep it, the QR for the rest opens
      save({ ...split, part: { method: 'CASH', amount: received } })
      opts.setCashInput('')
      opts.setMethod('QR')
      setQrOpen(true)
    } else {
      // The cash covers it all: no transfer needed
      save(null)
    }
    return true
  }

  const qrFirstStep = !!split && !part && split.order[0] === 'QR'
  const confirmQr = (amount: number) => {
    setQrOpen(false)
    if (!split) return
    if (qrFirstStep) {
      if (amount > 0 && amount + 0.004 < totals.restDue) {
        // QR first: the transfer is kept, the cash box takes the rest
        save({ ...split, part: { method: 'QR', amount } })
        toCash()
      } else {
        save(null)
      }
      return
    }
    if (part && split.order[1] === 'QR') save({ ...split, qrReceived: true })
  }

  /** What still has to be done before the bill can be saved (null = ready). */
  let blocker: PaymentNotice | null = null
  if (opts.method !== 'UNPAID') {
    if (cashFirstStep) blocker = cash.isConfirmed ? null : SPLIT_CASH_FIRST_NOTICE
    else if (qrFirstStep) blocker = QR_NOT_RECEIVED_NOTICE
    else if (split && part && split.order[1] === 'QR' && !split.qrReceived) blocker = QR_NOT_RECEIVED_NOTICE
    else if (!cash.isConfirmed) blocker = CASH_NOT_CONFIRMED_NOTICE
  }

  return {
    split,
    part,
    totals,
    blocker,
    /** Buttons lit on the method bar. */
    selectedMethods: (split ? [...split.order] : opts.method ? [opts.method] : []) as PaymentMethodType[],
    cashConfirmed: cash.isConfirmed,
    confirmCash,
    /** The cash box may be confirmed empty (= exactly the rest) on the second step. */
    cashConfirmEmptyAllowed: cashSecondStep,
    /** Changes each time the cash box should take the focus. */
    focusCash,
    selectMethod,
    clearSplit: () => {
      if (!split) return
      const first = split.order[0]
      setPressed(first)
      save(null)
      setQrOpen(false)
      if (first === 'CASH') toCash()
      else opts.setMethod('QR')
    },
    qr: {
      isOpen: qrOpen,
      open: () => setQrOpen(true),
      close: () => setQrOpen(false),
      amount: totals.restDue,
      // Only the first of the two may be part of the amount; the second takes the rest
      editable: qrFirstStep,
      confirm: confirmQr,
    },
  }
}
