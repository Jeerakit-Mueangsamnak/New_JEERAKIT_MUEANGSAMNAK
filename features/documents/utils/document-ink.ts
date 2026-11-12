/**
 * How every shop form prints (owner 2026-11-12), applied when a form is filled — the uploaded file is not
 * changed, so forms added later follow it too:
 * - no background colour anywhere (pictures stay); a box at most 4px thin is a line the form drew with a fill,
 *   so it prints as a black line instead;
 * - text, lines, frames and table borders in black (#000); a line drawn invisible stays invisible;
 * - the "ภาษีมูลค่าเพิ่ม" label (and the rate after it) sits 2px higher: its ู was cut by the cell's bottom line.
 * Inline styles are rewritten (the forms are styled inline and <style> tags are removed by the sanitizer).
 */

const INK = '#000'

const NAMED_COLOURS =
  'white|black|red|green|blue|gray|grey|silver|maroon|navy|olive|purple|teal|aqua|fuchsia|lime|yellow|orange|' +
  'brown|pink|gold|beige|ivory|khaki|lavender|indigo|violet|darkgray|darkgrey|lightgray|lightgrey|whitesmoke|gainsboro'
const COLOUR_TOKEN = new RegExp(`rgba?\\([^)]*\\)|hsla?\\([^)]*\\)|#[0-9a-fA-F]{3,8}\\b|\\b(?:${NAMED_COLOURS})\\b`, 'gi')

/** transparent, or an rgba()/hsla() whose alpha is 0: a line or text meant not to show. */
function isInvisible(colour: string): boolean {
  const c = colour.trim().toLowerCase()
  if (c === 'transparent') return true
  const m = /^(?:rgba|hsla)\(([^)]*)\)$/.exec(c)
  if (!m) return false
  const parts = m[1].split(/[\s,/]+/).filter(Boolean)
  return parts.length === 4 && Number(parts[3]) === 0
}

const inkColours = (value: string) => value.replace(COLOUR_TOKEN, (token) => (isInvisible(token) ? token : INK))

/** Splits a style attribute on ';' outside brackets (a data: URL inside url(...) has ';' in it). */
function declarations(style: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < style.length; i++) {
    const ch = style[i]
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0) {
      out.push(style.slice(start, i))
      start = i + 1
    }
  }
  out.push(style.slice(start))
  return out
}

/** A width or height of at most 4px in the style: the box is a line or a bar drawn with a fill. */
function isThinBox(style: string): boolean {
  return [...style.matchAll(/(?:^|;)\s*(?:height|width)\s*:\s*(\d+(?:\.\d+)?)px/gi)].some((m) => Number(m[1]) <= 4)
}

function inkDeclaration(declaration: string, thin: boolean): string {
  const at = declaration.indexOf(':')
  if (at < 0) return declaration
  const rawProp = declaration.slice(0, at)
  const prop = rawProp.trim().toLowerCase()
  const value = declaration.slice(at + 1)
  const set = (v: string) => `${rawProp}:${v}`
  const fill = (colour: string) => (isInvisible(colour) ? colour : thin ? INK : 'transparent')
  if (prop === 'background-color') return set(fill(value.trim()))
  if (prop === 'background') {
    // A picture stays (only its colour is changed); a colour-only shorthand becomes that colour's fill
    if (/url\(/i.test(value)) return set(value.replace(COLOUR_TOKEN, (c) => fill(c)))
    const colour = value.match(COLOUR_TOKEN)?.[0]
    return colour ? set(fill(colour)) : declaration
  }
  if (prop === 'color' || /^(?:border(?:-(?:top|right|bottom|left))?|outline|text-decoration|column-rule)-color$/.test(prop)) {
    return isInvisible(value) ? declaration : set(INK)
  }
  if (/^(?:border(?:-(?:top|right|bottom|left))?|outline)$/.test(prop)) return set(inkColours(value))
  return declaration
}

/** Every style attribute: no background colour, black text / lines / frames. */
export function inkOnlyStyles(html: string): string {
  return html.replace(/(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (_m, lead: string, dq?: string, sq?: string) => {
    const raw = dq ?? sq ?? ''
    const thin = isThinBox(raw)
    const style = declarations(raw).map((d) => inkDeclaration(d, thin)).join(';')
    return dq !== undefined ? `${lead}"${style}"` : `${lead}'${style}'`
  })
}

/** Moves "ภาษีมูลค่าเพิ่ม" and the spans after it in the same cell 2px up (their own `top`). */
export function liftVatLabel(html: string): string {
  return html.replace(/<span\b[^>]*>\s*ภาษีมูลค่าเพิ่ม\s*<\/span>[\s\S]*?<\/div>/g, (cell) =>
    cell.replace(/(<span\b[^>]*\sstyle\s*=\s*")([^"]*)(")/gi, (_m, open: string, style: string, close: string) => {
      const lifted = /(^|;)\s*top\s*:[^;]*/i.test(style)
        ? style.replace(/((?:^|;)\s*top\s*:)[^;]*/i, '$1-2px')
        : `${style}; top:-2px`
      return `${open}${lifted}${close}`
    })
  )
}

/**
 * The receiver's date under the signature (owner 2026-11-12): the drawn "___/___/___" (squeezed with a
 * negative letter-spacing) becomes a dotted line with no slashes, long enough to end under the closing
 * bracket of the signature line — 33 dots, measured on the shop's form (Tahoma 13.33px: 603.6px → 736.7px,
 * the ")" ends at 736.1px).
 */
export const SIGNATURE_DATE_DOTS = '.'.repeat(33)
export function dottedSignatureDate(html: string): string {
  return html.replace(/<span\b([^>]*)>\s*_{3,}\/_{3,}\/_{3,}\s*<\/span>/g, (_m, attrs: string) => {
    const cleaned = attrs.replace(/(\sstyle\s*=\s*")([^"]*)(")/i, (_s, open: string, style: string, close: string) =>
      `${open}${style.replace(/(?:^|;)\s*letter-spacing\s*:[^;]*;?/i, (d) => (d.startsWith(';') ? ';' : '')).trim()}${close}`
    )
    return `<span${cleaned}>${SIGNATURE_DATE_DOTS}</span>`
  })
}

/** The print look of every shop form. */
export function applyDocumentInk(html: string): string {
  return dottedSignatureDate(liftVatLabel(inkOnlyStyles(html)))
}
