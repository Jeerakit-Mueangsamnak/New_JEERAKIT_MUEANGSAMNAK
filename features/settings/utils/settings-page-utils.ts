
export const validatePassword = (pwd: string, _context?: any) => {
  if (!pwd || pwd.length < 8) {
    return { isValid: false, error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร' }
  }
  return { isValid: true, error: null }
}
