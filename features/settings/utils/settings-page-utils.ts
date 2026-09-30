export function previewDocumentNumber(cfg?: { prefix?: string; separator?: string; format?: string; digits?: number }): string {
  if (!cfg) return ''
  const prefix = cfg.prefix || 'DOC'
  const sep = cfg.separator ?? '-'
  const digits = cfg.digits || 4
  const num = String(1).padStart(digits, '0')
  return `${prefix}${sep}202609${sep}${num}`
}

export const validatePin = (pin: string) => {
  if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    return { isValid: false, error: 'PIN ต้องเป็นตัวเลข 6 หลัก' }
  }
  return { isValid: true, error: null }
}

export const validatePassword = (pwd: string, _context?: any) => {
  if (!pwd || pwd.length < 8) {
    return { isValid: false, error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร' }
  }
  return { isValid: true, error: null }
}
