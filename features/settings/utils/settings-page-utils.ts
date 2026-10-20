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
