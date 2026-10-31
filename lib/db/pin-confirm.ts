/**
 * Risky-action confirmation (Master v4.3.1 §4.4): the user finishes the form, presses
 * "ยืนยัน", enters their 6-digit PIN; the PIN is checked by the database and yields a
 * single-use token bound to that one action, which the action RPC spends right away.
 */
import { isDbError } from '@/lib/db/rpc'

export interface PinConfirmRequest {
  /** Server action code the token is bound to, e.g. REFUND, STOCK_ADJUST, PRICE_OVERRIDE. */
  action: string
  title: string
  detail?: string
  /** Ask for a reason in the same dialog (price override, discount over the limit …). */
  askReason?: boolean
  reasonLabel?: string
  defaultReason?: string
}

export interface PinConfirmResult {
  token: string
  reason?: string
}

export class PinCancelledError extends Error {
  constructor() {
    super('ยกเลิกการยืนยัน PIN')
    this.name = 'PinCancelledError'
  }
}

type Confirmer = (req: PinConfirmRequest) => Promise<PinConfirmResult | null>
let confirmer: Confirmer | null = null

/** Registered once by <PinConfirmProvider/>. */
export function registerPinConfirmer(fn: Confirmer | null): void {
  confirmer = fn
}

export async function confirmPin(req: PinConfirmRequest): Promise<PinConfirmResult> {
  if (!confirmer) throw new Error('หน้าจอยืนยัน PIN ยังไม่พร้อม')
  const result = await confirmer(req)
  if (!result) throw new PinCancelledError()
  return result
}

/**
 * Owner decision 2026-10-22: actions no longer ask for a PIN or a reason — the user's menu/action
 * rights are checked by the server and every change is written to the audit log by the database.
 * withPin/withPinIfRequired now run the action straight away with no token (the RPCs take NULL);
 * only PIN_CHANGE (the lock-screen PIN itself) still opens the PIN dialog.
 */
export async function withPin<T>(req: PinConfirmRequest, run: (token: string, reason?: string) => Promise<T>): Promise<T> {
  if (req.action !== 'PIN_CHANGE') return run(null as unknown as string)
  const first = await confirmPin(req)
  try {
    return await run(first.token, first.reason)
  } catch (err) {
    if (!isDbError(err, 'PIN_CONFIRMATION_INVALID')) throw err
    const again = await confirmPin(req)
    return run(again.token, again.reason ?? first.reason)
  }
}

export async function withPinIfRequired<T>(
  req: PinConfirmRequest,
  run: (token?: string, reason?: string) => Promise<T>
): Promise<T> {
  return withPin(req, run)
}

export function isPinCancelled(err: unknown): boolean {
  return err instanceof PinCancelledError
}
