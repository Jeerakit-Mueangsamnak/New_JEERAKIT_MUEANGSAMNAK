/**
 * Notice sound (owner 2026-11-15, like iOS): each device chooses sound on/off for itself in ตั้งค่าส่วนตัว ›
 * การแจ้งเตือนส่วนตัว; which notices exist is the shop's (ตั้งค่าระบบ › การแจ้งเตือนของร้าน). Saved in this browser only.
 * The tone is made with Web Audio (no sound file). iPad/iPhone only let a page play sound after a tap, so the first tap
 * anywhere unlocks it.
 */
const KEY = 'notice_sound_on'
const CHANGED = 'notice-sound-changed'

export function isNoticeSoundOn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function setNoticeSoundOn(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // private mode: the choice lasts for this page only
  }
  window.dispatchEvent(new Event(CHANGED))
}

/** Calls back when this device's choice changes (this tab or another). Returns the unsubscribe function. */
export function onNoticeSoundChange(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb() }
  window.addEventListener(CHANGED, cb)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGED, cb)
    window.removeEventListener('storage', onStorage)
  }
}

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  return ctx
}

/** Unlocks sound on the first tap or key press (needed on iPad/iPhone). Returns the clean-up function. */
export function unlockNoticeSoundOnGesture(): () => void {
  const unlock = () => {
    const a = audio()
    if (a && a.state === 'suspended') void a.resume().catch(() => undefined)
    remove()
  }
  const remove = () => {
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
  return remove
}

/** A short two-note chime. Plays only when this device has sound on. */
export function playNoticeSound(): void {
  if (!isNoticeSoundOn()) return
  const a = audio()
  if (!a) return
  if (a.state === 'suspended') void a.resume().catch(() => undefined)
  const start = a.currentTime + 0.01
  ;[880, 1320].forEach((freq, i) => {
    const t = start + i * 0.16
    const osc = a.createOscillator()
    const gain = a.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    osc.connect(gain).connect(a.destination)
    osc.start(t)
    osc.stop(t + 0.32)
  })
}
