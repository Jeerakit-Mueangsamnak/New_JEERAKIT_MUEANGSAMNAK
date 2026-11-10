// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DocumentTemplate } from '@/lib/types/document'

const mocks = vi.hoisted(() => ({
  print: vi.fn((_pages: string[], _title?: string) => true),
  convert: vi.fn(async (file: { name: string }) => file.name === 'good.txt'
    ? { success: true, templateSchema: '<div>Previous converted template</div>', orientation: 'LANDSCAPE' as const }
    : { success: false, error: 'ไฟล์ไม่รองรับ' }),
  fetchDocs: vi.fn(async () => [] as unknown[]),
  toast: { showToast: vi.fn() },
  settings: { settings: { business: { businessName: 'ร้านทดสอบ' } } },
  customers: [] as unknown[],
  deactivate: vi.fn(async (_id: string, _reason: string) => undefined),
  save: vi.fn(async (_customerId: string, _data: Record<string, unknown>) => ({ id: 'saved-new' })),
  upload: vi.fn(async (_customerId: string, _file: Blob, _type: string, _note?: string) => ({ id: 'saved-photo' })),
  // Stand-in for Supabase document_templates (shared by every device).
  server: new Map<string, Record<string, unknown>>(),
  createTemplate: vi.fn(),
  deleteTemplates: vi.fn(),
  // Stand-in for Supabase document_names (the "หมวดหมู่เอกสาร" list, one per tab).
  names: [] as { id: string; targetGroup: 'CUSTOMER' | 'BILL'; name: string }[],
  addName: vi.fn(),
  deleteName: vi.fn(),
}))

vi.mock('@/features/documents/api/template-library-repository', () => ({
  fetchDocumentTemplates: vi.fn(async () => Array.from(mocks.server.values())),
  createDocumentTemplate: mocks.createTemplate,
  deleteDocumentTemplates: mocks.deleteTemplates,
  fetchDocumentNames: vi.fn(async () => [...mocks.names]),
  addDocumentName: mocks.addName,
  deleteDocumentName: mocks.deleteName,
}))

// A plain <select> stands in for the custom dropdown (label = its placeholder); remove icons sit beside it.
vi.mock('@/components/common/CustomSelect', () => ({
  CustomSelect: ({ value, onChange, options, placeholder, onRemoveOption }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; onRemoveOption?: (v: string) => void }) => (
    <>
      <select aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {onRemoveOption && options.map((o) => (
        <button key={o.value} type="button" aria-label={`ลบ ${o.label}`} onClick={() => onRemoveOption(o.value)} />
      ))}
    </>
  ),
}))

vi.mock('@/components/common/Toast', () => ({ useToast: () => mocks.toast }))
vi.mock('@/lib/print/print-service', () => ({ printDocuments: mocks.print }))
vi.mock('@/features/documents/utils/documentConverter', () => ({ convertFileToInternalTemplate: mocks.convert, TEMPLATE_UPLOAD_ACCEPT: '.pdf,.docx' }))
// The preview pane = exactly the html it receives
vi.mock('@/features/documents/components/A4DocumentWorkspace', () => ({
  A4DocumentWorkspace: ({ htmlContent }: { htmlContent: string }) => <output data-testid="preview">{htmlContent}</output>,
}))
vi.mock('@/lib/contexts/SystemSettingsContext', () => ({ useSystemSettings: () => mocks.settings }))
vi.mock('@/features/customers/services/customer-storage', () => ({
  loadCustomers: () => mocks.customers,
  syncCustomersFromSupabase: vi.fn(async () => mocks.customers),
}))
vi.mock('@/features/documents/api/customer-document-repository', () => ({
  fetchCustomerDocuments: mocks.fetchDocs,
  deactivateCustomerDocument: mocks.deactivate,
  getDocumentFileUrl: vi.fn(async () => null),
  saveCustomerDocument: mocks.save,
  uploadCustomerImage: mocks.upload,
}))

import DocumentsPage from '@/app/documents/page'
import { TemplateLibraryPanel, renderLibraryTemplate } from '@/features/documents/components/TemplateLibraryPanel'

const business = { businessName: 'ร้านทดสอบ' }
// A shop quotation form as it is kept in Supabase (document_templates).
const QUOTE: DocumentTemplate = {
  id: 'tpl-quotation',
  name: 'ใบเสนอราคาค่าเช่าและบริการ (Quotation)',
  category: 'ใบเสนอราคา',
  source: 'BUILTIN',
  fileType: 'HTML',
  version: 1,
  paperSize: 'A4',
  orientation: 'PORTRAIT',
  pageCount: 1,
  isDefault: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  createdBy: 'ระบบ',
  defaultTerms: '1. ส่งมอบภายใน 3 วัน',
  templateSchema: '<div><h1>{{business.name}}</h1><p>ใบเสนอราคา {{document.number}}</p><p>{{customer.name}}</p><p>{{document.custom_terms}}</p></div>',
}
const shopForm = (id: string, name: string, category: string): DocumentTemplate => ({
  ...QUOTE, id, name, category, isDefault: false, defaultTerms: '',
  templateSchema: `<div><h1>${name}</h1><p>เลขที่ {{document.number}}</p><p>ลูกค้า {{customer.name}}</p></div>`,
})
const FORMS: DocumentTemplate[] = [
  QUOTE,
  shopForm('tpl-form-a', 'ฟอร์ม ก', 'ใบเสร็จรับเงิน'),
  shopForm('tpl-form-b', 'ฟอร์ม ข', 'ใบส่งสินค้า/ติดตั้ง'),
  shopForm('tpl-form-c', 'ฟอร์มยืนยันลายเซ็น', 'แบบฟอร์มยืนยันลายเซ็น'),
  shopForm('tpl-form-d', 'ฟอร์ม ง', 'ใบรับคืนสินค้า'),
  shopForm('tpl-form-e', 'ฟอร์ม จ', 'สัญญาเช่าสินค้า'),
]
const ready = () => screen.findByText(`รายการแบบฟอร์มเอกสาร (${FORMS.length})`)
const preview = () => screen.getByTestId('preview').textContent || ''
const textOf = (html: string) => {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || ''
}

function Harness() {
  const [mode, setMode] = React.useState<'LIBRARY' | 'ADD'>('LIBRARY')
  return (
    <>
      <button onClick={() => setMode('ADD')}>go-add</button>
      <TemplateLibraryPanel mode={mode} onModeChange={setMode} business={business} />
    </>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  mocks.server.clear()
  // The shop's forms on the server: the quotation plus a few test forms (none is built into the code).
  for (const form of FORMS) mocks.server.set(form.id, { ...form })
  mocks.createTemplate.mockReset().mockImplementation(async (id: string, template: Record<string, unknown>) => {
    // The server keeps the tab the form was saved under (document_templates.target_group).
    mocks.server.set(id, { ...template, id })
    return { ...template, id }
  })
  mocks.names = [
    { id: 'n1', targetGroup: 'CUSTOMER', name: 'สัญญาเช่าสินค้า' },
    { id: 'n2', targetGroup: 'CUSTOMER', name: 'หนังสือมอบอำนาจ' },
    { id: 'n3', targetGroup: 'BILL', name: 'ใบเสนอราคา' },
    { id: 'n4', targetGroup: 'BILL', name: 'ใบเสร็จรับเงิน' },
  ]
  mocks.addName.mockReset().mockImplementation(async (targetGroup: 'CUSTOMER' | 'BILL', name: string) => {
    const row = { id: `n-${mocks.names.length + 1}`, targetGroup, name }
    mocks.names.push(row)
    return row
  })
  mocks.deleteName.mockReset().mockImplementation(async (id: string) => {
    mocks.names = mocks.names.filter((n) => n.id !== id)
  })
  mocks.deleteTemplates.mockReset().mockImplementation(async (ids: string[]) => {
    ids.forEach((id) => mocks.server.delete(id))
  })
  mocks.toast.showToast.mockClear()
  mocks.print.mockClear()
  mocks.fetchDocs.mockResolvedValue([])
})
afterEach(cleanup)

describe('คลังแบบฟอร์ม', () => {
  it('lists the shop forms from the server and previews the first one', async () => {
    render(<Harness />)
    await ready()
    expect(screen.getByText(`เลือกแล้ว 0 / ${FORMS.length}`)).toBeTruthy()
    await waitFor(() => expect(preview()).toBe(renderLibraryTemplate(FORMS[0], business)))
  })

  it('a shop with only the quotation form shows that one form and previews it', async () => {
    mocks.server.clear()
    mocks.server.set(QUOTE.id, { ...QUOTE })
    render(<Harness />)
    expect(await screen.findByText('รายการแบบฟอร์มเอกสาร (1)')).toBeTruthy()
    expect(screen.getByTestId(`tpl-row-${QUOTE.id}`).textContent).toContain('ใบเสนอราคาค่าเช่าและบริการ (Quotation)')
    await waitFor(() => expect(preview()).toBe(renderLibraryTemplate(QUOTE, business)))
  })

  it('no form is built into the code: a shop with no forms has an empty library', async () => {
    mocks.server.clear()
    render(<Harness />)
    expect(await screen.findByText('รายการแบบฟอร์มเอกสาร (0)')).toBeTruthy()
  })

  it('every form, the quotation too, can be ticked, printed and deleted', async () => {
    render(<Harness />)
    await ready()
    const checkbox = screen.getByLabelText(`เลือก ${QUOTE.name}`) as HTMLInputElement
    expect(checkbox.disabled).toBe(false)
    fireEvent.click(checkbox)
    expect(screen.getByRole('button', { name: 'พิมพ์ (1)' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'ลบ (1)' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ (1)' }))
    expect(mocks.print).toHaveBeenCalledTimes(1)
    expect(textOf(mocks.print.mock.calls[0][0][0])).toBe(textOf(renderLibraryTemplate(QUOTE, business)))
  })

  it('clicking a row moves the preview and the selected badge to that form', async () => {
    render(<Harness />)
    await ready()
    const target = FORMS[3]
    fireEvent.click(screen.getByTestId(`tpl-row-${target.id}`))
    expect(preview()).toBe(renderLibraryTemplate(target, business))
    // No "พรีวิว" badge (owner 2026-11-07): the previewed row is shown by its highlight only
    expect(screen.queryByText('พรีวิว')).toBeNull()
    expect(screen.getByTestId(`tpl-row-${target.id}`).className).toContain('bg-purple-50')
    expect(screen.getByTestId(`tpl-row-${FORMS[0].id}`).className).not.toContain('bg-purple-50')
  })

  it('print is disabled with nothing ticked and prints exactly the ticked forms', async () => {
    render(<Harness />)
    await ready()
    const printBtn = screen.getByRole('button', { name: /พิมพ์ \(0\)/ }) as HTMLButtonElement
    expect(printBtn.disabled).toBe(true)

    const a = FORMS[1]
    const b = FORMS[2]
    // Previewing another form must not change what gets printed
    fireEvent.click(screen.getByTestId(`tpl-row-${FORMS[4].id}`))
    fireEvent.click(screen.getByLabelText(`เลือก ${a.name}`))
    fireEvent.click(screen.getByLabelText(`เลือก ${b.name}`))
    fireEvent.click(screen.getByRole('button', { name: /พิมพ์ \(2\)/ }))

    expect(mocks.print).toHaveBeenCalledTimes(1)
    const pages = mocks.print.mock.calls[0][0]
    expect(pages).toHaveLength(2)
    // Same order as the list; each page carries that form's own rendered content
    expect(textOf(pages[0])).toBe(textOf(renderLibraryTemplate(a, business)))
    expect(textOf(pages[1])).toBe(textOf(renderLibraryTemplate(b, business)))
  })

  it('checkbox and preview are independent; select-all and the X / Y counter follow the ticks', async () => {
    render(<Harness />)
    await ready()
    await waitFor(() => expect(preview()).toBe(renderLibraryTemplate(FORMS[0], business)))
    const total = FORMS.length
    const a = FORMS[4]
    const box = () => screen.getByLabelText(`เลือก ${a.name}`) as HTMLInputElement

    // Ticking does not move the preview
    fireEvent.click(box())
    expect(box().checked).toBe(true)
    expect(preview()).toBe(renderLibraryTemplate(FORMS[0], business))
    expect(screen.getByText(`เลือกแล้ว 1 / ${total}`)).toBeTruthy()

    // Clicking the row previews it without touching its checkbox
    fireEvent.click(screen.getByTestId(`tpl-row-${a.id}`))
    expect(preview()).toBe(renderLibraryTemplate(a, business))
    expect(box().checked).toBe(true)
    fireEvent.click(screen.getByTestId(`tpl-row-${FORMS[1].id}`))
    expect((screen.getByLabelText(`เลือก ${FORMS[1].name}`) as HTMLInputElement).checked).toBe(false)

    const all = screen.getByRole('checkbox', { name: 'เลือกทั้งหมด' }) as HTMLInputElement
    fireEvent.click(all)
    expect(screen.getByText(`เลือกแล้ว ${total} / ${total}`)).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(`พิมพ์ \\(${total}\\)`) })).toBeTruthy()
    fireEvent.click(all)
    expect(screen.getByText(`เลือกแล้ว 0 / ${total}`)).toBeTruthy()
  })

  it('ลบ deletes the ticked forms on the server for good, with no typed reason', async () => {
    render(<Harness />)
    await ready()
    const a = FORMS[2]
    const b = FORMS[5]
    expect((screen.getByRole('button', { name: /ลบ \(0\)/ }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText(`เลือก ${a.name}`))
    fireEvent.click(screen.getByLabelText(`เลือก ${b.name}`))
    fireEvent.click(screen.getByRole('button', { name: /ลบ \(2\)/ }))
    expect(screen.queryByPlaceholderText(/ระบุเหตุผล/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันการลบ/ }))

    await waitFor(() => expect(screen.queryByTestId(`tpl-row-${a.id}`)).toBeNull())
    expect(screen.queryByTestId(`tpl-row-${b.id}`)).toBeNull()
    expect(mocks.deleteTemplates).toHaveBeenCalledWith([a.id, b.id], '')
    expect(mocks.server.has(a.id)).toBe(false)
    expect(screen.getByText(`รายการแบบฟอร์มเอกสาร (${FORMS.length - 2})`)).toBeTruthy()
    expect(screen.getByTestId(`tpl-row-${FORMS[0].id}`)).toBeTruthy()
  })

  it('the quotation form can be deleted like any other form', async () => {
    render(<Harness />)
    await ready()
    fireEvent.click(screen.getByLabelText(`เลือก ${QUOTE.name}`))
    fireEvent.click(screen.getByRole('button', { name: /ลบ \(1\)/ }))
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันการลบ/ }))
    await waitFor(() => expect(screen.queryByTestId(`tpl-row-${QUOTE.id}`)).toBeNull())
    expect(mocks.deleteTemplates).toHaveBeenCalledWith([QUOTE.id], '')
  })

  it('เพิ่มแบบฟอร์ม saves the form on the server (not this browser), previews it, and every device sees it', async () => {
    const { unmount } = render(<Harness />)
    await ready()
    fireEvent.click(screen.getByText('go-add'))
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'แบบฟอร์มทดสอบใหม่' } })
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มชื่อเอกสารในหมวดหมู่เอกสาร' }))
    await waitFor(() => expect((screen.getByLabelText('ประเภทเอกสาร') as HTMLSelectElement).value).toBe('แบบฟอร์มทดสอบใหม่'))
    fireEvent.click(screen.getByRole('button', { name: /บันทึกเข้าคลังระบบ/ }))

    expect(await screen.findByText(`รายการแบบฟอร์มเอกสาร (${FORMS.length + 1})`)).toBeTruthy()
    expect(preview()).toContain('แบบฟอร์มทดสอบใหม่')
    expect(mocks.createTemplate).toHaveBeenCalledTimes(1)
    // One name only: the form is named by the name picked for its tab
    expect(mocks.createTemplate.mock.calls[0][1]).toMatchObject({ name: 'แบบฟอร์มทดสอบใหม่', category: 'แบบฟอร์มทดสอบใหม่' })
    expect(window.localStorage.getItem('rental-pos:document-template-library:v1') || '').not.toContain('แบบฟอร์มทดสอบใหม่')
    unmount()

    // Another device: nothing in its browser, the form still comes from the server
    window.localStorage.clear()
    render(<Harness />)
    expect(await screen.findByText('แบบฟอร์มทดสอบใหม่')).toBeTruthy()
  })

  it('a new quotation form without a file starts as a plain page, like any other name', async () => {
    render(<Harness />)
    await ready()
    fireEvent.click(screen.getByText('go-add'))
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'ใบเสนอราคาแบบใหม่' } })
    fireEvent.click(screen.getByRole('button', { name: /แบบฟอร์มบิล/ }))
    fireEvent.change(screen.getByLabelText('ประเภทเอกสาร'), { target: { value: 'ใบเสนอราคา' } })
    fireEvent.click(screen.getByRole('button', { name: /บันทึกเข้าคลังระบบ/ }))
    await waitFor(() => expect(mocks.createTemplate).toHaveBeenCalledTimes(1))
    const saved = mocks.createTemplate.mock.calls[0][1] as { templateSchema: string }
    expect(saved.templateSchema).toContain('<h1 class="text-xl font-black">ใบเสนอราคา</h1>')
    expect(saved.templateSchema).not.toContain('{{items.rows_')
  })

  it('a failed save keeps the form screen open and never says it was saved', async () => {
    mocks.createTemplate.mockRejectedValueOnce(new Error('ไม่มีสิทธิ์เมนูเอกสาร'))
    render(<Harness />)
    fireEvent.click(screen.getByText('go-add'))
    await waitFor(() => expect((screen.getByLabelText('ประเภทเอกสาร') as HTMLSelectElement).value).not.toBe(''))
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'ฟอร์มที่บันทึกไม่ได้' } })
    fireEvent.click(screen.getByRole('button', { name: /บันทึกเข้าคลังระบบ/ }))

    await waitFor(() => expect(mocks.toast.showToast).toHaveBeenCalledWith('บันทึกไม่สำเร็จ', 'ไม่มีสิทธิ์เมนูเอกสาร', 'ERROR'))
    expect(mocks.toast.showToast).not.toHaveBeenCalledWith('บันทึก Template สำเร็จ', expect.anything(), 'SUCCESS')
    expect(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร')).toBeTruthy()
  })

  it('a form over the 1 MB limit is refused before it is sent', async () => {
    mocks.convert.mockResolvedValueOnce({ success: true, templateSchema: `<div>${'ก'.repeat(400_000)}</div>`, orientation: 'LANDSCAPE' })
    render(<Harness />)
    fireEvent.click(screen.getByText('go-add'))
    fireEvent.change(screen.getByLabelText('ไฟล์ต้นฉบับแบบฟอร์ม'), { target: { files: [new File(['x'], 'big.pdf')] } })
    await waitFor(() => expect(preview()).toContain('ก'))
    fireEvent.click(screen.getByRole('button', { name: /บันทึกเข้าคลังระบบ/ }))

    expect(mocks.toast.showToast).toHaveBeenCalledWith('ไฟล์ใหญ่เกินไป', expect.stringContaining('1 MB'), 'ERROR')
    expect(mocks.createTemplate).not.toHaveBeenCalled()
  })

  it('forms that an older version kept only in this browser move up to the server once', async () => {
    const legacy = { ...QUOTE, id: 'tpl-legacy-1', name: 'ฟอร์มเก่าในเครื่อง', category: 'สัญญาเช่าสินค้า' }
    window.localStorage.setItem('rental-pos:document-template-library:v1', JSON.stringify({ custom: [legacy], hiddenIds: [] }))
    render(<Harness />)

    expect(await screen.findByText('ฟอร์มเก่าในเครื่อง')).toBeTruthy()
    await waitFor(() => expect(mocks.server.has('tpl-legacy-1')).toBe(true))
    expect(window.localStorage.getItem('rental-pos:document-template-library:v1') || '').not.toContain('tpl-legacy-1')
  })

  it('does not save stale converted content after a later file conversion fails', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('go-add'))
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'เอกสารใหม่' } })
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มชื่อเอกสารในหมวดหมู่เอกสาร' }))
    await waitFor(() => expect((screen.getByLabelText('ประเภทเอกสาร') as HTMLSelectElement).value).toBe('เอกสารใหม่'))
    const input = screen.getByLabelText('ไฟล์ต้นฉบับแบบฟอร์ม')

    fireEvent.change(input, { target: { files: [new File(['old'], 'good.txt', { type: 'text/plain' })] } })
    await waitFor(() => expect(preview()).toContain('Previous converted template'))
    expect(preview()).not.toContain('คุณสมชาย')
    expect(preview()).not.toContain('TPL-PREVIEW-001')
    fireEvent.change(input, { target: { files: [new File(['bad'], 'bad.txt', { type: 'text/plain' })] } })
    await waitFor(() => expect(mocks.toast.showToast).toHaveBeenCalledWith('ไม่สามารถแปลงไฟล์ได้', 'ไฟล์ไม่รองรับ', 'ERROR'))

    fireEvent.click(screen.getByRole('button', { name: /บันทึกเข้าคลังระบบ/ }))
    await waitFor(() => expect(preview()).toContain('เอกสารใหม่'))
    expect(preview()).not.toContain('Previous converted template')
  })

  it('allows choosing to add template to customer forms or bill forms and filters by group', async () => {
    render(<Harness />)
    await ready()
    fireEvent.click(screen.getByText('go-add'))

    expect(screen.queryByText('เพิ่มไปที่')).toBeNull()
    expect(screen.queryByText('หมวดหมู่เอกสาร')).toBeNull()
    expect(screen.getByRole('button', { name: /แบบฟอร์มลูกค้า/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /แบบฟอร์มบิล/ })).toBeTruthy()

    // Add a bill form
    fireEvent.click(screen.getByRole('button', { name: /แบบฟอร์มบิล/ }))
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'ใบเสร็จรูปแบบพิเศษ' } })
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มชื่อเอกสารในหมวดหมู่เอกสาร' }))
    await waitFor(() => expect((screen.getByLabelText('ประเภทเอกสาร') as HTMLSelectElement).value).toBe('ใบเสร็จรูปแบบพิเศษ'))
    fireEvent.click(screen.getByRole('button', { name: /บันทึกเข้าคลังระบบ/ }))

    expect(await screen.findByText('ใบเสร็จรูปแบบพิเศษ')).toBeTruthy()

    // Test filter in library
    fireEvent.click(screen.getByRole('button', { name: /^ฟอร์มบิล/ }))
    expect(screen.getByText('ใบเสร็จรูปแบบพิเศษ')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^ฟอร์มลูกค้า/ }))
    expect(screen.queryByText('ใบเสร็จรูปแบบพิเศษ')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^ทั้งหมด/ }))
    expect(screen.getByText('ใบเสร็จรูปแบบพิเศษ')).toBeTruthy()
  })

  it('a form keeps the tab it was saved under, even with a name the shop added itself', async () => {
    render(<Harness />)
    await ready()
    fireEvent.click(screen.getByText('go-add'))
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'ใบส่งของ/ใบเสร็จรับเงิน' } })
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มชื่อเอกสารในหมวดหมู่เอกสาร' }))
    await waitFor(() => expect((screen.getByLabelText('ประเภทเอกสาร') as HTMLSelectElement).value).toBe('ใบส่งของ/ใบเสร็จรับเงิน'))
    fireEvent.click(screen.getByRole('button', { name: /บันทึกเข้าคลังระบบ/ }))
    await waitFor(() => expect(mocks.createTemplate).toHaveBeenCalledTimes(1))
    expect(mocks.server.get(mocks.createTemplate.mock.calls[0][0])).toMatchObject({ category: 'ใบส่งของ/ใบเสร็จรับเงิน' })
    fireEvent.click(await screen.findByRole('button', { name: /^ฟอร์มลูกค้า/ }))
    expect(screen.getByText('ใบส่งของ/ใบเสร็จรับเงิน')).toBeTruthy()
  })
})

describe('เพิ่มแบบฟอร์ม › ชื่อเอกสาร', () => {
  const optionsOf = () => Array.from((screen.getByLabelText('ประเภทเอกสาร') as HTMLSelectElement).options).map((o) => o.value).filter(Boolean)
  const openAdd = async () => {
    render(<Harness />)
    await ready()
    fireEvent.click(screen.getByText('go-add'))
    await waitFor(() => expect(optionsOf()).toEqual(['สัญญาเช่าสินค้า', 'หนังสือมอบอำนาจ']))
  }
  const nameInput = () => screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร')
  const plus = () => screen.getByRole('button', { name: 'เพิ่มชื่อเอกสารในหมวดหมู่เอกสาร' })

  it('the list comes from the server, one list per tab', async () => {
    await openAdd()
    expect(optionsOf()).toEqual(['สัญญาเช่าสินค้า', 'หนังสือมอบอำนาจ'])
    fireEvent.click(screen.getByRole('button', { name: /แบบฟอร์มบิล/ }))
    expect(optionsOf()).toEqual(['ใบเสนอราคา', 'ใบเสร็จรับเงิน'])
    expect((screen.getByLabelText('ประเภทเอกสาร') as HTMLSelectElement).value).toBe('ใบเสนอราคา')
  })

  it('[+] adds the typed name to the open tab only, and picks it', async () => {
    await openAdd()
    fireEvent.click(screen.getByRole('button', { name: /แบบฟอร์มบิล/ }))
    fireEvent.change(nameInput(), { target: { value: '  ใบส่งของ  ' } })
    fireEvent.click(plus())
    await waitFor(() => expect(mocks.addName).toHaveBeenCalledWith('BILL', 'ใบส่งของ'))
    await waitFor(() => expect(optionsOf()).toEqual(['ใบเสนอราคา', 'ใบเสร็จรับเงิน', 'ใบส่งของ']))
    expect((screen.getByLabelText('ประเภทเอกสาร') as HTMLSelectElement).value).toBe('ใบส่งของ')
    fireEvent.click(screen.getByRole('button', { name: /แบบฟอร์มลูกค้า/ }))
    expect(optionsOf()).not.toContain('ใบส่งของ')
  })

  it('[+] with an empty box or a name already listed does not add anything', async () => {
    await openAdd()
    fireEvent.click(plus())
    fireEvent.change(nameInput(), { target: { value: 'หนังสือมอบอำนาจ' } })
    fireEvent.click(plus())
    expect(mocks.addName).not.toHaveBeenCalled()
    expect((screen.getByLabelText('ประเภทเอกสาร') as HTMLSelectElement).value).toBe('หนังสือมอบอำนาจ')
  })

  it('the bin icon removes that name from the list (both tabs)', async () => {
    await openAdd()
    fireEvent.click(screen.getByRole('button', { name: 'ลบ สัญญาเช่าสินค้า' }))
    await waitFor(() => expect(mocks.deleteName).toHaveBeenCalledWith('n1'))
    await waitFor(() => expect(optionsOf()).toEqual(['หนังสือมอบอำนาจ']))
    expect((screen.getByLabelText('ประเภทเอกสาร') as HTMLSelectElement).value).toBe('หนังสือมอบอำนาจ')

    fireEvent.click(screen.getByRole('button', { name: /แบบฟอร์มบิล/ }))
    fireEvent.click(screen.getByRole('button', { name: 'ลบ ใบเสร็จรับเงิน' }))
    await waitFor(() => expect(mocks.deleteName).toHaveBeenCalledWith('n4'))
    await waitFor(() => expect(optionsOf()).toEqual(['ใบเสนอราคา']))
  })

  it('picking a name previews the form already saved under that tab + name, until a file is uploaded', async () => {
    mocks.server.set('tpl-contract', { ...shopForm('tpl-contract', 'สัญญาเช่าสินค้า', 'สัญญาเช่าสินค้า'), targetGroup: 'CUSTOMER' })
    render(<Harness />)
    await screen.findByText(`รายการแบบฟอร์มเอกสาร (${FORMS.length + 1})`)
    fireEvent.click(screen.getByText('go-add'))
    await waitFor(() => expect(optionsOf()).toEqual(['สัญญาเช่าสินค้า', 'หนังสือมอบอำนาจ']))
    // A name with no saved form shows nothing.
    fireEvent.change(screen.getByLabelText('ประเภทเอกสาร'), { target: { value: 'หนังสือมอบอำนาจ' } })
    expect(preview()).toBe('')
    fireEvent.change(screen.getByLabelText('ประเภทเอกสาร'), { target: { value: 'สัญญาเช่าสินค้า' } })
    expect(preview()).toContain('สัญญาเช่าสินค้า')
    // An uploaded file takes over the preview.
    fireEvent.change(screen.getByLabelText('ไฟล์ต้นฉบับแบบฟอร์ม'), { target: { files: [new File(['x'], 'good.txt', { type: 'text/plain' })] } })
    await waitFor(() => expect(preview()).toContain('Previous converted template'))
  })

  it('ล้างเทมเพลต drops the uploaded file and its preview, keeping the name', async () => {
    await openAdd()
    const clear = screen.getByRole('button', { name: /ล้างเทมเพลต/ }) as HTMLButtonElement
    expect(clear.disabled).toBe(true)
    // The file name is not put in the name box (one name: the one picked from the list).
    fireEvent.change(nameInput(), { target: { value: 'ฟอร์ม ก' } })
    fireEvent.change(screen.getByLabelText('ไฟล์ต้นฉบับแบบฟอร์ม'), { target: { files: [new File(['x'], 'good.txt', { type: 'text/plain' })] } })
    await waitFor(() => expect(preview()).toContain('Previous converted template'))
    expect(screen.getByText(/good\.txt/)).toBeTruthy()
    fireEvent.click(clear)
    expect(preview()).toBe('')
    expect(screen.queryByText(/good\.txt/)).toBeNull()
    expect((nameInput() as HTMLInputElement).value).toBe('ฟอร์ม ก')
    expect(clear.disabled).toBe(true)
  })
})

describe('หน้าเอกสาร', () => {
  const CUSTOMER = { id: 'c1', customerName: 'ช่างทองสุข', customerCode: 'CUST-1', phone: '080', address: 'กทม', isSuspended: false }
  const ACTIVE_DOC = {
    id: 'd-active', customer_id: 'c1', doc_type: 'OTHER', template_code: 'tpl-form-c', template_version: '1',
    data_snapshot: { docNo: 'CD-OLD1', customerSnapshot: { customerName: 'ช่างทองสุข' }, terms: 'ข้อความเดิม' },
    signature_svg: null, storage_path: null, note: null, status: 'ACTIVE', status_reason: null, created_at: '2026-10-01T03:00:00Z',
  }
  const CANCELLED_DOC = { ...ACTIVE_DOC, id: 'd-cancel', data_snapshot: { docNo: 'CD-OLD2' }, status: 'INACTIVE', status_reason: 'ซ้ำ' }
  const OTHER_CUSTOMER_DOC = { ...ACTIVE_DOC, id: 'd-other', customer_id: 'c2' }
  // Only the visible (create) tab
  const view = () => within(screen.getAllByText('รายการเอกสาร')[0].closest('.grid') as HTMLElement)

  beforeEach(() => {
    mocks.customers = [CUSTOMER]
    mocks.fetchDocs.mockClear()
    mocks.fetchDocs.mockResolvedValue([ACTIVE_DOC, CANCELLED_DOC, OTHER_CUSTOMER_DOC])
    mocks.save.mockClear()
    mocks.upload.mockClear()
    mocks.deactivate.mockClear()
  })

  const pickCustomer = async () => {
    await screen.findByRole('option', { name: /ช่างทองสุข/ })
    fireEvent.change(screen.getByLabelText('ค้นหา / เลือกลูกค้า'), { target: { value: 'c1' } })
    await waitFor(() => expect(mocks.fetchDocs).toHaveBeenCalledWith('c1'))
  }
  const addForm = async (code: string) => {
    // Customer forms are the shop forms from the server: wait until they are listed.
    const shop = FORMS.find((f) => f.id === code)
    if (shop) await screen.findByRole('option', { name: shop.name })
    fireEvent.change(screen.getByLabelText('-- เลือกแบบฟอร์มเพื่อเพิ่มเอกสาร --'), { target: { value: code } })
  }
  const counter = () => view().getByText(/^เลือกแล้ว/).textContent
  const renderCreatePage = () => {
    render(<DocumentsPage />)
    fireEvent.click(screen.getByRole('button', { name: /สร้างเอกสาร/ }))
  }

  it('opens directly to the template library with the shop forms', async () => {
    render(<DocumentsPage />)
    expect(await screen.findByText(`รายการแบบฟอร์มเอกสาร (${FORMS.length})`)).toBeTruthy()
    for (const form of FORMS) expect(screen.getByTestId(`tpl-row-${form.id}`)).toBeTruthy()
  })

  it('สร้างเอกสาร follows picture 2: empty list, print all disabled until there is something to print', () => {
    mocks.customers = []
    renderCreatePage()
    expect(screen.getByLabelText('ค้นหา / เลือกลูกค้า')).toBeTruthy()
    expect(screen.getByText('ยังไม่มีเอกสารในรายการ')).toBeTruthy()
    expect(counter()).toBe('เลือกแล้ว 0 / 0')
    expect((screen.getByRole('button', { name: /พิมพ์ \(ทั้งหมด\)/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /ลบ \(0\)/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /^บันทึก$/ })).toBeTruthy()
  })

  it("lists only the chosen customer's saved documents; cancelled ones on request", async () => {
    renderCreatePage()
    await pickCustomer()
    await waitFor(() => expect(screen.getByTestId('doc-row-doc:d-active')).toBeTruthy())
    expect(mocks.fetchDocs).toHaveBeenCalledWith('c1')
    expect(screen.queryByTestId('doc-row-doc:d-other')).toBeNull()
    expect(screen.queryByTestId('doc-row-doc:d-cancel')).toBeNull()
    fireEvent.click(screen.getByLabelText('แสดงที่ยกเลิกแล้ว'))
    expect(screen.getByTestId('doc-row-doc:d-cancel').textContent).toContain('ยกเลิกแล้ว')
  })

  it('picking a form adds an unsaved document, previews it, and บันทึก saves it for the customer', async () => {
    renderCreatePage()
    await pickCustomer()
    await waitFor(() => expect(counter()).toBe('เลือกแล้ว 0 / 1'))
    await addForm('tpl-form-c')
    expect(counter()).toBe('เลือกแล้ว 0 / 2')
    const draftRow = screen.getAllByTestId(/doc-row-draft:/)[0]
    expect(draftRow.textContent).toContain('ยังไม่บันทึก')
    expect(within(draftRow).queryByText('พรีวิว')).toBeNull()
    expect(draftRow.className).toContain('bg-blue-50')
    expect(screen.getAllByTestId('preview')[0].textContent).toContain('ช่างทองสุข')

    fireEvent.click(screen.getByRole('button', { name: /บันทึก \(1\)/ }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    const [customerId, data] = mocks.save.mock.calls[0]
    expect(customerId).toBe('c1')
    expect(data).toMatchObject({ docType: 'OTHER', templateCode: 'tpl-form-c' })
    await waitFor(() => expect(screen.queryAllByTestId(/doc-row-draft:/)).toHaveLength(0))
  })

  it('photo forms open the file picker and the photo is uploaded on บันทึก', async () => {
    renderCreatePage()
    await pickCustomer()
    addForm('ID_CARD')
    expect(screen.queryAllByTestId(/doc-row-draft:/)).toHaveLength(0) // added only after a photo is chosen
    const file = new File(['img'], 'id.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('เลือกรูปเอกสาร'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getAllByTestId(/doc-row-draft:/)).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /บันทึก \(1\)/ }))
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1))
    expect(mocks.upload.mock.calls[0][0]).toBe('c1')
    expect(mocks.upload.mock.calls[0][1]).toBe(file)
    expect(mocks.upload.mock.calls[0][2]).toBe('ID_CARD')
  })

  it('print: nothing ticked = whole list, ticked = only those; same renderer as the preview', async () => {
    renderCreatePage()
    await pickCustomer()
    await waitFor(() => expect(counter()).toBe('เลือกแล้ว 0 / 1'))
    await addForm('tpl-form-c')

    fireEvent.click(screen.getByRole('button', { name: /พิมพ์ \(ทั้งหมด\)/ }))
    await waitFor(() => expect(mocks.print).toHaveBeenCalledTimes(1))
    expect(mocks.print.mock.calls[0][0]).toHaveLength(2)

    // Preview the saved document, then tick only it: the printout is exactly that preview
    fireEvent.click(screen.getByTestId('doc-row-doc:d-active'))
    const shown = screen.getAllByTestId('preview')[0].textContent
    expect(shown).toContain('CD-OLD1')
    fireEvent.click(within(screen.getByTestId('doc-row-doc:d-active')).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /พิมพ์ \(1\)/ }))
    await waitFor(() => expect(mocks.print).toHaveBeenCalledTimes(2))
    const pages = mocks.print.mock.calls[1][0]
    expect(pages).toHaveLength(1)
    expect(pages[0]).toContain(shown as string)
  })

  it('ลบ: unsaved rows are dropped, saved rows are cancelled (no typed reason)', async () => {
    renderCreatePage()
    await pickCustomer()
    await waitFor(() => expect(counter()).toBe('เลือกแล้ว 0 / 1'))
    await addForm('tpl-form-c')
    fireEvent.click(view().getByRole('checkbox', { name: 'เลือกทั้งหมด' }))
    expect(counter()).toBe('เลือกแล้ว 2 / 2')

    fireEvent.click(screen.getByRole('button', { name: /ลบ \(2\)/ }))
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันการลบ/ }))
    await waitFor(() => expect(mocks.deactivate).toHaveBeenCalledWith('d-active', ''))
    expect(mocks.deactivate).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryAllByTestId(/doc-row-draft:/)).toHaveLength(0))
  })

  it('จัดการเอกสาร has only คลังแบบฟอร์ม | เพิ่มแบบฟอร์ม, and unsaved documents survive switching tabs', async () => {
    renderCreatePage()
    await pickCustomer()
    await addForm('tpl-form-c')

    fireEvent.click(screen.getByRole('button', { name: /จัดการเอกสาร/ }))
    expect(screen.getByText(`รายการแบบฟอร์มเอกสาร (${FORMS.length})`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^เอกสารลูกค้า$/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มแบบฟอร์ม/ }))
    expect(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /สร้างเอกสาร/ }))
    expect(screen.getAllByTestId(/doc-row-draft:/)).toHaveLength(1)
  })
})

describe('ตัวอย่างแบบฟอร์มในคลัง', () => {
  it('ช่องที่เติมตอนพิมพ์จริง (ช่องในตาราง ยอดรับคืน ยอดค่าปรับ) เป็นช่องว่าง ไม่โชว์ {{...}} แต่เลขลำดับยังอยู่', () => {
    const tpl = {
      ...QUOTE,
      templateSchema: '<table><tbody><tr><td>{{items.1.no}}</td><td>{{items.1.returned}}</td><td>{{items.1.damage_fee}}</td><td>{{items.1.fine_rate}}</td></tr></tbody></table><b>{{return.rent}}</b><b>{{fine.total}}</b>',
    }
    const html = renderLibraryTemplate(tpl, business)
    expect(html).not.toMatch(/\{\{/)
    expect(html).toContain('<td>1</td><td></td><td></td><td></td>')
  })
})
