/**
 * Notice sound (owner 2026-11-17): the shop's notices (ตั้งค่าระบบ › การแจ้งเตือนของร้าน) ring on every device —
 * there is no personal sound switch any more. The tone is made with Web Audio (no sound file). iPad/iPhone only let a
 * page play sound after a tap, so the first tap anywhere unlocks it.
 */
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

/** A short two-note chime. */
export function playNoticeSound(): void {
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
