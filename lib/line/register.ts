/**
 * Self-registration text typed in the 1:1 OA chat ("สมชาย ใจดี 0812345678"). A Thai mobile
 * number is 10 digits starting with 0; spaces and dashes inside it are allowed. What is left
 * after the number is the name. The database checks the same shape again.
 */

export interface RegisterInput {
  name: string | null
  phone: string | null
}

/** 0 + 9 digits, each optionally followed by a space or dash, not glued to other digits. */
const PHONE = /(?<![0-9])0(?:[\s-]?[0-9]){9}(?![0-9])/

export function parseRegisterText(text: string): RegisterInput {
  const raw = (text || '').slice(0, 300)
  const m = PHONE.exec(raw)
  const phone = m ? m[0].replace(/\D/g, '') : null
  const rest = m ? raw.slice(0, m.index) + ' ' + raw.slice(m.index + m[0].length) : raw
  const name = rest
    .replace(/[,:;|/]+/g, ' ')
    .replace(/(?:ชื่อ|เบอร์โทร|เบอร์|โทร|tel\.?)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
  return { name: /\p{L}/u.test(name) ? name : null, phone }
}
