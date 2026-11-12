// Every shop form prints with no background colour, black ink, and the VAT label clear of its line (owner 2026-11-12).
import { describe, expect, it } from 'vitest'
import { applyDocumentInk, inkOnlyStyles, liftVatLabel } from '@/features/documents/utils/document-ink'

describe('inkOnlyStyles', () => {
  it('removes background colours and turns text, borders and frames black', () => {
    const html =
      '<div style="background-color:rgb(238, 243, 248); color:rgb(24, 34, 57); border-bottom-color:rgb(135, 149, 170); border-top:1px solid #8795aa; font-size:12px">x</div>'
    expect(inkOnlyStyles(html)).toBe(
      '<div style="background-color:transparent; color:#000; border-bottom-color:#000; border-top:1px solid #000; font-size:12px">x</div>'
    )
  })

  it('keeps pictures inside a background shorthand and lines meant to be invisible', () => {
    const html = `<div style="background:#fff url(data:image/png;base64,AAA=) no-repeat; border:1px solid transparent; border-left-color:rgba(0, 0, 0, 0)">y</div>`
    const out = inkOnlyStyles(html)
    expect(out).toContain('url(data:image/png;base64,AAA=)')
    expect(out).toContain('background:transparent url(')
    expect(out).toContain('border:1px solid transparent')
    expect(out).toContain('border-left-color:rgba(0, 0, 0, 0)')
  })

  it('a plain background colour shorthand becomes transparent; other properties are untouched', () => {
    expect(inkOnlyStyles(`<p style='background:#eef3f8;width:10px'>z</p>`)).toBe(`<p style='background:transparent;width:10px'>z</p>`)
  })
})

describe('liftVatLabel', () => {
  it('moves the VAT label and the rate after it 2px up, nothing else', () => {
    const html =
      '<div><span style="font-size:12px; position:relative; top:0px; height:14px">ภาษีมูลค่าเพิ่ม</span> <span style="position:relative; top:0px">7</span><span style="position:relative; top:0px">%(VAT)</span></div>' +
      '<div><span style="position:relative; top:0px">ยอดรวม</span></div>'
    const out = liftVatLabel(html)
    expect(out.match(/top:-2px/g)).toHaveLength(3)
    expect(out).toContain('<span style="position:relative; top:0px">ยอดรวม</span>')
  })

  it('a label without its own top gets one', () => {
    expect(liftVatLabel('<div><span style="position:relative">ภาษีมูลค่าเพิ่ม</span></div>')).toContain('position:relative; top:-2px')
  })
})

describe('applyDocumentInk', () => {
  it('does both', () => {
    const out = applyDocumentInk('<div style="background-color:#eee"><span style="color:#333; top:0px">ภาษีมูลค่าเพิ่ม</span></div>')
    expect(out).toBe('<div style="background-color:transparent"><span style="color:#000; top:-2px">ภาษีมูลค่าเพิ่ม</span></div>')
  })
})

describe('dottedSignatureDate', () => {
  it('the receiver date "___/___/___" becomes 33 dots with normal letter spacing, no slashes', async () => {
    const { dottedSignatureDate, SIGNATURE_DATE_DOTS } = await import('@/features/documents/utils/document-ink')
    const out = dottedSignatureDate('วันที่ <span style="letter-spacing:-3px; box-sizing:border-box; white-space:nowrap">_________/___________/_________</span>')
    expect(out).toBe(`วันที่ <span style="box-sizing:border-box; white-space:nowrap">${SIGNATURE_DATE_DOTS}</span>`)
    expect(SIGNATURE_DATE_DOTS).toHaveLength(33)
    expect(out.replace(/<[^>]*>/g, '')).not.toContain('/')
  })
})
