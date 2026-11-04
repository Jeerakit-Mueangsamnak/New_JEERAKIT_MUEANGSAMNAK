// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeDocumentHtml, sanitizeStyleValue } from '@/features/documents/utils/document-html'

// Inline styles of shop templates / imported files: show the look, never run or load anything unsafe.
describe('inline style filter', () => {
  it('keeps plain presentational CSS', () => {
    expect(sanitizeStyleValue('color:red; font-weight:700; break-after:page')).toBe('color:red; font-weight:700; break-after:page')
  })

  it.each([
    'background-image:url(javascript:alert(1))',
    'background:url("vbscript:msgbox(1)")',
    'width:expression(alert(1))',
    'behavior:url(x.htc)',
    '-moz-binding:url(http://x/xbl)',
    'background:url(http://insecure.example/a.png)',
    'background:url(//evil.example/a.png)',
    'background:url(java\script:alert(1))',
  ])('drops %s but keeps the rest', (bad) => {
    expect(sanitizeStyleValue(`${bad}; color:blue`)).toBe('color:blue')
  })

  it('keeps url(...) of a safe image (https, data:image, local image path)', () => {
    for (const ok of [
      'background:url(https://cdn.example/logo.png)',
      "background:url('data:image/png;base64,AAAA')",
      'background:url("/images/logo.png")',
    ]) expect(sanitizeStyleValue(ok)).toBe(ok)
  })

  it('removes the style attribute when nothing safe is left', () => {
    const out = sanitizeDocumentHtml('<div style="background:url(javascript:alert(1))">Hi</div>')
    expect(out).toBe('<div>Hi</div>')
  })
})
