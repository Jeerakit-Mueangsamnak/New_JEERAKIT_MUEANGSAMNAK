const ALLOWED_TAGS = new Set([
  'div', 'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em',
  'i', 'u', 'br', 'hr', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'th', 'td', 'img', 'svg', 'path', 'g', 'line', 'polyline', 'rect', 'circle',
])
const GLOBAL_ATTRIBUTES = new Set([
  'class', 'title', 'style', 'id', 'colspan', 'rowspan', 'align', 'valign',
  'width', 'height', 'border', 'cellpadding', 'cellspacing', 'viewbox', 'fill',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'x', 'y',
  'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points'
])

export function escapeDocumentHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isSafeImageSource(value: string) {
  return /^(https:\/\/|data:image\/(png|jpeg|jpg|webp|gif);base64,)/i.test(value)
    || /^\/(?!\/)[A-Za-z0-9/_-]+\.(?:png|jpe?g|svg|webp|gif)$/i.test(value)
}

/** Splits an inline style on ";" that are not inside (...) or quotes (data:image/png;base64 stays whole). */
function splitDeclarations(style: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (const ch of style) {
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '(') {
      depth += 1
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1)
    } else if (ch === ';' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

// CSS that can run code or load something: script URLs, IE expressions/behaviors, Firefox bindings, imports.
const UNSAFE_CSS = /(?:java|vb)script\s*:|expression\s*\(|behavior\s*:|-moz-binding|@import|\\/i

/** One inline style value, keeping only the declarations that are safe to show.
 *  url(...) stays only for a safe image (https / data:image / a local image path), like <img src>. */
export function sanitizeStyleValue(style: string): string {
  return splitDeclarations(style)
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      if (!declaration || UNSAFE_CSS.test(declaration)) return false
      if (!/url\(/i.test(declaration)) return true
      // Every url(...) must be a safe image; anything that does not parse as a plain url(...) is dropped.
      const urls = [...declaration.matchAll(/url\(\s*['"]?([^'"()\s]*)['"]?\s*\)/gi)].map((m) => m[1])
      const urlCount = declaration.match(/url\(/gi)?.length ?? 0
      if (urls.length !== urlCount || !urls.every(isSafeImageSource)) return false
      return true
    })
    .join('; ')
}

/** User-managed templates may only contain presentational markup. */
export function sanitizeDocumentHtml(html: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html
      .replace(/<\/?(script|style|iframe|object|embed|link|meta|base)[^>]*>/gi, '')
      .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s(?:href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]+)/gi, '')
      .replace(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (_m, dq?: string, sq?: string) => {
        const safe = sanitizeStyleValue(dq ?? sq ?? '')
        return safe ? ` style="${safe.replace(/"/g, '&quot;')}"` : ''
      })
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html')
  for (const element of Array.from(parsed.body.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) {
      element.replaceWith(parsed.createTextNode(element.textContent || ''))
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      const allowedImageSource = tag === 'img' && name === 'src' && isSafeImageSource(value)
      const allowedImageAlt = tag === 'img' && name === 'alt'
      if (!GLOBAL_ATTRIBUTES.has(name) && !allowedImageSource && !allowedImageAlt) {
        element.removeAttribute(attribute.name)
        continue
      }
      if (name === 'style') {
        const safe = sanitizeStyleValue(attribute.value)
        if (safe) element.setAttribute(attribute.name, safe)
        else element.removeAttribute(attribute.name)
      }
    }
  }
  return parsed.body.innerHTML
}
