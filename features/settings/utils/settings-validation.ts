import type { SettingsSection, SystemConfig } from '@/features/settings/services/settings-storage'
import { sectionPatch } from '@/features/settings/api/settings-repository'
import { validateLinePolicy } from '@/lib/line/policy'

export function autoLockLabel(seconds: number): string {
  if (seconds === 0) return 'ไม่ล็อกอัตโนมัติ'
  if (seconds < 60) return `${seconds} วินาที`
  return `${seconds / 60} นาที`
}

/** Client checks before a section is sent (the server checks the same and more). */
export function validateSection(section: SettingsSection, cfg: SystemConfig): string | null {
  if (section === 'business') {
    const b = cfg.business
    if (!b.businessName.trim()) return 'กรุณาระบุชื่อกิจการ'
    if (b.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())) return 'รูปแบบอีเมลไม่ถูกต้อง'
    if (b.taxId.trim() && !/^\d{1,13}$/.test(b.taxId.trim())) return 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลขไม่เกิน 13 หลัก'
  }
  if (section === 'taxDiscount') {
    const t = cfg.taxDiscount
    if ((t.vatRate === null) !== (t.vatMode === null)) return 'กรอกอัตรา VAT และวิธีคิดราคาให้ครบทั้งสองค่า (หรือเว้นว่างทั้งคู่)'
    if (t.vatRate !== null && !(t.vatRate > 0 && t.vatRate <= 100)) return 'อัตรา VAT ต้องมากกว่า 0 และไม่เกิน 100'
    if (t.discountLimitEnabled && (t.discountLimitPercent === null || t.discountLimitPercent < 0 || t.discountLimitPercent > 100))
      return 'เมื่อเปิดเพดานส่วนลด ต้องระบุเปอร์เซ็นต์ 0–100'
  }
  if (section === 'documentNumbering') {
    for (const [type, f] of Object.entries(cfg.documentNumbering)) {
      if (!/^[A-Z0-9]{1,10}$/.test(f.prefix)) return `Prefix ของ ${type} ต้องเป็นตัวอักษร A-Z หรือตัวเลข 1–10 ตัว`
    }
  }
  if (section === 'line') {
    const line = (sectionPatch('line', cfg).policies as { line: unknown }).line
    const check = validateLinePolicy(line)
    if (!check.ok) {
      if (check.path.startsWith('line.templates.')) {
        return 'ข้อความ LINE ใช้ตัวแปรที่ไม่มีในหัวข้อนี้ หรือยาวเกิน 5,000 ตัวอักษร (ใช้ได้เฉพาะตัวแปรที่แสดงใต้ช่อง)'
      }
      return 'ค่าการตั้งค่า LINE ไม่ถูกต้อง กรุณาโหลดค่าล่าสุดแล้วลองใหม่'
    }
  }
  if (section === 'shopSecurity') {
    const s = cfg.shopSecurity
    if (s.autoLockOptionsSeconds.length === 0) return 'เลือกเวลาล็อกอัตโนมัติที่อนุญาตอย่างน้อย 1 ค่า'
    if (!s.autoLockOptionsSeconds.includes(s.autoLockDefaultSeconds)) return 'ค่าเริ่มต้นต้องเป็นหนึ่งในตัวเลือกที่อนุญาต'
  }
  return null
}
