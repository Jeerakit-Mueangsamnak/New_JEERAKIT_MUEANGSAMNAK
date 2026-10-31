import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { convertFileToInternalTemplate } from '@/features/documents/utils/documentConverter'

const fileOf = (name: string, data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer }
}

// Minimal real .docx: one paragraph per page, Word page breaks between them.
function docxWithPages(pages: string[]): Uint8Array {
  const body = pages
    .map((text, i) => `<w:p><w:r><w:t>${text}</w:t></w:r>${i < pages.length - 1 ? '<w:r><w:br w:type="page"/></w:r>' : ''}</w:p>`)
    .join('')
  const zip = XLSX.CFB.utils.cfb_new()
  const utf8 = (xml: string) => Buffer.from(xml, 'utf8')
  XLSX.CFB.utils.cfb_add(zip, '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  XLSX.CFB.utils.cfb_add(zip, '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  XLSX.CFB.utils.cfb_add(zip, 'word/document.xml',
    utf8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`))
  return new Uint8Array(XLSX.CFB.write(zip, { fileType: 'zip', type: 'array' }) as number[])
}

describe('document converter (real file reading)', () => {
  it('keeps every page of a 10-page Word file, with Thai text intact', async () => {
    const pages = Array.from({ length: 10 }, (_, i) => `สัญญาเช่า หน้าที่ ${i + 1}`)
    const result = await convertFileToInternalTemplate(fileOf('contract.docx', docxWithPages(pages)))

    expect(result.success).toBe(true)
    expect(result.pageCount).toBe(10)
    for (const text of pages) expect(result.templateSchema).toContain(text)
    expect(result.templateSchema!.match(/doc-page-break/g)).toHaveLength(9)
  })

  it('turns each PDF page into its own printed page', async () => {
    const renderPdfPages = vi.fn(async () => Array.from({ length: 10 }, (_, i) => `data:image/jpeg;base64,PAGE${i + 1}`))
    const result = await convertFileToInternalTemplate(fileOf('form.pdf', '%PDF-1.7'), { renderPdfPages })

    expect(result.success).toBe(true)
    expect(result.pageCount).toBe(10)
    expect(result.templateSchema!.match(/<img /g)).toHaveLength(10)
    expect(result.templateSchema).toContain('PAGE10')
    // The pages are made to fit the shop library's 1 MB form limit (stored in the form, not as files)
    expect(renderPdfPages).toHaveBeenCalledWith(expect.any(ArrayBuffer), 30, 1_000_000)
  })

  it('reports a PDF that cannot be read instead of saving an empty form', async () => {
    const renderPdfPages = vi.fn(async () => { throw new Error('Invalid PDF structure') })
    const result = await convertFileToInternalTemplate(fileOf('bad.pdf', 'nope'), { renderPdfPages })
    expect(result).toMatchObject({ success: false })
    expect(result.error).toContain('Invalid PDF structure')
  })

  it('reads every Excel sheet and escapes cell text', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['สินค้า', 'ราคา'], ['<img src=x onerror=alert(1)>', 10]]), 'หน้า1')
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['หมายเหตุ'], ['{{customer.name}}']]), 'หน้า2')
    const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)

    const result = await convertFileToInternalTemplate(fileOf('price.xlsx', bytes))
    expect(result.pageCount).toBe(2)
    expect(result.templateSchema).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(result.templateSchema).not.toContain('<img src=x')
    expect(result.detectedFields).toEqual(['{{customer.name}}'])
  })

  it('keeps every line of a long text file and escapes markup', async () => {
    const lines = Array.from({ length: 120 }, (_, i) => `ข้อ ${i + 1}`)
    lines.push('<script>alert(1)</script>')
    const result = await convertFileToInternalTemplate(fileOf('terms.txt', lines.join('\n')))
    expect(result.templateSchema).toContain('ข้อ 120')
    expect(result.templateSchema).toContain('&lt;script&gt;')
  })

  it('asks for .docx when given an old .doc file', async () => {
    const result = await convertFileToInternalTemplate(fileOf('old.doc', 'binary'))
    expect(result.success).toBe(false)
    expect(result.error).toContain('.docx')
  })
})
