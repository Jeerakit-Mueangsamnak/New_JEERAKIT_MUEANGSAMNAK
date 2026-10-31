/**
 * PIN (Master v4.3.1 §4.3): 1 user = 1 PIN, stored only as a bcrypt hash in the database
 * and checked by the database. The same PIN unlocks the app and confirms risky actions.
 * Nothing about the PIN is kept in the browser except the "this tab is locked" flag.
 */
import { rpc } from '@/lib/db/rpc'

export interface PinStatus {
  pinSet: boolean
  blocked: boolean
  failedAttempts: number
  lockedUntil: string | null
  /** Seconds of inactivity before the app locks; 0 = never. */
  autoLockSeconds: number
  autoLockOptions: number[]
}

export interface PinVerifyResult {
  ok: boolean
  /** Single-use confirmation for exactly one risky action (purpose ACTION). */
  token: string | null
  failedAttempts: number
  lockedUntil: string | null
  blocked: boolean
  /** OWNER_RESET for a USER, REAUTHENTICATE for the OWNER. */
  recovery: 'OWNER_RESET' | 'REAUTHENTICATE' | null
}

export function validatePinFormat(pin: string): { isValid: boolean; error: string | null } {
  if (!/^\d{6}$/.test(pin)) return { isValid: false, error: 'PIN ต้องเป็นตัวเลข 6 หลัก' }
  return { isValid: true, error: null }
}

export async function fetchPinStatus(): Promise<PinStatus> {
  const r = await rpc<Record<string, unknown>>('my_pin_status')
  return {
    pinSet: Boolean(r.pin_set),
    blocked: Boolean(r.blocked),
    failedAttempts: Number(r.failed_attempts ?? 0),
    lockedUntil: (r.locked_until as string | null) ?? null,
    autoLockSeconds: Number(r.auto_lock_seconds ?? 300),
    autoLockOptions: Array.isArray(r.auto_lock_options_seconds) ? (r.auto_lock_options_seconds as number[]) : [],
  }
}

export async function verifyPinOnServer(pin: string, purpose: 'UNLOCK' | 'ACTION', action?: string): Promise<PinVerifyResult> {
  const r = await rpc<Record<string, unknown>>('verify_pin', { p_pin: pin, p_purpose: purpose, p_action: action })
  return {
    ok: Boolean(r.ok),
    token: (r.pin_token as string | null) ?? null,
    failedAttempts: Number(r.failed_attempts ?? 0),
    lockedUntil: (r.locked_until as string | null) ?? null,
    blocked: Boolean(r.blocked),
    recovery: (r.recovery as PinVerifyResult['recovery']) ?? null,
  }
}

/** First PIN needs nothing; changing one needs a PIN_CHANGE confirmation of the current PIN. */
export async function setPinOnServer(newPin: string, pinToken?: string | null): Promise<void> {
  await rpc('set_pin', { p_new_pin: newPin, p_pin_token: pinToken ?? undefined })
}

/** OWNER "forgot PIN": only after a fresh e-mail link/code or password sign-in. Only the PIN changes. */
export async function recoverOwnerPin(newPin: string): Promise<void> {
  await rpc('owner_recover_pin', { p_new_pin: newPin })
}

export async function setAutoLockSeconds(seconds: number | null): Promise<PinStatus> {
  await rpc('set_auto_lock', { p_seconds: seconds })
  return fetchPinStatus()
}

/** Human text for a refused PIN entry. */
export function describePinRefusal(r: PinVerifyResult): string {
  if (r.blocked) {
    return r.recovery === 'REAUTHENTICATE'
      ? 'PIN ถูกล็อก — กด "ลืม PIN" เพื่อยืนยันตัวตนทางอีเมลแล้วตั้ง PIN ใหม่'
      : 'PIN ถูกล็อก — ให้เจ้าของร้านล้าง PIN ให้ แล้วตั้ง PIN ใหม่'
  }
  if (r.lockedUntil && new Date(r.lockedUntil).getTime() > Date.now()) {
    return `ใส่ PIN ผิด ${r.failedAttempts} ครั้ง — รออีก ${formatWait(r.lockedUntil)} แล้วลองใหม่`
  }
  return `PIN ไม่ถูกต้อง (ผิด ${r.failedAttempts} ครั้ง)`
}

export function formatWait(untilIso: string): string {
  const s = Math.max(0, Math.ceil((new Date(untilIso).getTime() - Date.now()) / 1000))
  if (s >= 3600) return `${Math.ceil(s / 3600)} ชั่วโมง`
  if (s >= 60) return `${Math.ceil(s / 60)} นาที`
  return `${s} วินาที`
}

// ─── "this app is locked" flag (per browser; survives reload so a reload cannot skip the lock) ───
const lockKey = (userId: string) => `app_locked_${userId}`

export function getAppLockedState(userId: string): boolean {
  try {
    return window.localStorage.getItem(lockKey(userId)) === '1'
  } catch {
    return false
  }
}

/**
 * Last user activity on THIS device (ms). Kept per user in this browser only — it is never sent
 * to the server, so an unlock on one device never unlocks another. Lets the lock survive
 * background, device sleep, a closed tab and a reopened session.
 */
const activityKey = (userId: string) => `pos_last_activity:${userId}`

export function getLastActivity(userId: string): number | null {
  try {
    const v = Number(window.localStorage.getItem(activityKey(userId)))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

export function setLastActivity(userId: string, at: number): void {
  try {
    window.localStorage.setItem(activityKey(userId), String(at))
  } catch {
    // storage unavailable: the in-memory timer still applies
  }
}

/**
 * The auto-lock time this device must use. The member's own choice counts only while it is one of
 * the times the OWNER allows (Settings › ความปลอดภัยร้าน); otherwise the shop default applies, so a
 * personal choice made earlier can never outlast the OWNER removing that option.
 */
export function effectiveAutoLockSeconds(chosen: number, options: readonly number[], shopDefault: number): number {
  if (options.length === 0 || options.includes(chosen)) return chosen
  return options.includes(shopDefault) ? shopDefault : options[0]
}

/** True when the idle time since the last activity reached the user's auto-lock time (0 = never). */
export function isIdleExpired(lastActivityMs: number | null, nowMs: number, autoLockSeconds: number): boolean {
  if (!autoLockSeconds || autoLockSeconds <= 0 || lastActivityMs === null) return false
  return nowMs - lastActivityMs >= autoLockSeconds * 1000
}

export function setAppLockedState(userId: string, locked: boolean): void {
  try {
    if (locked) window.localStorage.setItem(lockKey(userId), '1')
    else window.localStorage.removeItem(lockKey(userId))
  } catch {
    // storage unavailable (private mode): the in-memory lock still applies
  }
}
