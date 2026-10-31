// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QUOTATION_STARTER_TEMPLATE } from '@/features/documents/constants/initialDocumentTemplates'
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
}))

vi.mock('@/features/documents/api/template-library-repository', () => ({
  fetchDocumentTemplates: vi.fn(async () => Array.from(mocks.server.values())),
  createDocumentTemplate: mocks.createTemplate,
  deleteDocumentTemplates: mocks.deleteTemplates,
}))

// A plain <select> stands in for the custom dropdown (label = its placeholder).
vi.mock('@/components/common/CustomSelect', () => ({
  CustomSelect: ({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) => (
    <select aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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
const QUOTE: DocumentTemplate = QUOTATION_STARTER_TEMPLATE
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
    // The table has no target column: the group comes back from the category, as on the server.
    const { targetGroup: _targetGroup, ...row } = template
    mocks.server.set(id, { ...row, id })
    return { ...row, id }
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

  it('previews only the blank quotation form from the supplied layout', () => {
    const html = renderLibraryTemplate(QUOTE, business)
    const rendered = document.createElement('div')
    rendered.innerHTML = html

    expect(rendered.textContent).toContain('ใบเสนอราคา / QUOTATION')
    expect(rendered.textContent).toContain('เลขผู้เสียภาษี')
    expect(rendered.textContent).toContain('หมายเหตุ / Terms & Conditions:')
    expect(rendered.textContent).toContain('จำนวนเงินตัวอักษร:')
    expect(rendered.textContent).toContain('ผู้ตรวจสอบ / ฝ่ายบริหาร')
    // Shop name and logo come from the shop settings, not text written into the form.
    expect(rendered.textContent).toContain('ร้านทดสอบ')
    expect(rendered.textContent).toContain('แกะระยะแบบ(ฟรี)')
    expect(rendered.querySelector('div[style*="height:297mm"]')?.getAttribute('style')).toContain('width:calc(100% + 64px)')
    expect(rendered.querySelector('div[style*="height:297mm"]')?.getAttribute('style')).toContain('padding:5mm')
    expect(rendered.querySelectorAll('table')[0].querySelectorAll('tbody tr')).toHaveLength(16)
    expect(rendered.querySelectorAll('input, button, script')).toHaveLength(0)
    expect(rendered.textContent).not.toContain('คุณสมชาย')
    expect(rendered.textContent).not.toContain('นั่งร้านเหล็กมาตรฐาน')
    expect(rendered.textContent).not.toContain('TPL-PREVIEW-001')
    expect(rendered.querySelector('img[alt="โลโก้ร้าน"]')?.getAttribute('src')).toBe('/logo.png')
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
    expect(within(screen.getByTestId(`tpl-row-${target.id}`)).getByText('พรีวิว')).toBeTruthy()
    expect(within(screen.getByTestId(`tpl-row-${FORMS[0].id}`)).queryByText('พรีวิว')).toBeNull()
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

  it('ลบ deletes the ticked forms on the server for good, only after a reason is given', async () => {
    render(<Harness />)
    await ready()
    const a = FORMS[2]
    const b = FORMS[5]
    expect((screen.getByRole('button', { name: /ลบ \(0\)/ }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText(`เลือก ${a.name}`))
    fireEvent.click(screen.getByLabelText(`เลือก ${b.name}`))
    fireEvent.click(screen.getByRole('button', { name: /ลบ \(2\)/ }))
    const confirm = screen.getByRole('button', { name: /ยืนยันการลบ/ }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(/ระบุเหตุผล/), { target: { value: 'เลิกใช้' } })
    fireEvent.click(confirm)

    await waitFor(() => expect(screen.queryByTestId(`tpl-row-${a.id}`)).toBeNull())
    expect(screen.queryByTestId(`tpl-row-${b.id}`)).toBeNull()
    expect(mocks.deleteTemplates).toHaveBeenCalledWith([a.id, b.id], 'เลิกใช้')
    expect(mocks.server.has(a.id)).toBe(false)
    expect(screen.getByText(`รายการแบบฟอร์มเอกสาร (${FORMS.length - 2})`)).toBeTruthy()
    expect(screen.getByTestId(`tpl-row-${FORMS[0].id}`)).toBeTruthy()
  })

  it('the quotation form can be deleted like any other form', async () => {
    render(<Harness />)
    await ready()
    fireEvent.click(screen.getByLabelText(`เลือก ${QUOTE.name}`))
    fireEvent.click(screen.getByRole('button', { name: /ลบ \(1\)/ }))
    fireEvent.change(screen.getByPlaceholderText(/ระบุเหตุผล/), { target: { value: 'ทำแบบใหม่' } })
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันการลบ/ }))
    await waitFor(() => expect(screen.queryByTestId(`tpl-row-${QUOTE.id}`)).toBeNull())
    expect(mocks.deleteTemplates).toHaveBeenCalledWith([QUOTE.id], 'ทำแบบใหม่')
  })

  it('เพิ่มแบบฟอร์ม saves the form on the server (not this browser), previews it, and every device sees it', async () => {
    const { unmount } = render(<Harness />)
    await ready()
    fireEvent.click(screen.getByText('go-add'))
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'แบบฟอร์มทดสอบใหม่' } })
    fireEvent.click(screen.getByRole('button', { name: /บันทึก Template เข้าคลังระบบ/ }))

    expect(await screen.findByText(`รายการแบบฟอร์มเอกสาร (${FORMS.length + 1})`)).toBeTruthy()
    expect(preview()).toContain('แบบฟอร์มทดสอบใหม่')
    expect(mocks.createTemplate).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem('rental-pos:document-template-library:v1') || '').not.toContain('แบบฟอร์มทดสอบใหม่')
    unmount()

    // Another device: nothing in its browser, the form still comes from the server
    window.localStorage.clear()
    render(<Harness />)
    expect(await screen.findByText('แบบฟอร์มทดสอบใหม่')).toBeTruthy()
  })

  it('a new quotation form starts from the quotation layout', async () => {
    render(<Harness />)
    await ready()
    fireEvent.click(screen.getByText('go-add'))
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'ใบเสนอราคาแบบใหม่' } })
    fireEvent.click(screen.getByRole('button', { name: /แบบฟอร์มบิล/ }))
    fireEvent.change(screen.getByLabelText('ประเภทเอกสาร'), { target: { value: 'ใบเสนอราคา' } })
    fireEvent.click(screen.getByRole('button', { name: /บันทึก Template เข้าคลังระบบ/ }))
    await waitFor(() => expect(mocks.createTemplate).toHaveBeenCalledTimes(1))
    const saved = mocks.createTemplate.mock.calls[0][1] as { templateSchema: string }
    expect(saved.templateSchema).toBe(QUOTE.templateSchema)
  })

  it('a failed save keeps the form screen open and never says it was saved', async () => {
    mocks.createTemplate.mockRejectedValueOnce(new Error('ไม่มีสิทธิ์เมนูเอกสาร'))
    render(<Harness />)
    fireEvent.click(screen.getByText('go-add'))
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'ฟอร์มที่บันทึกไม่ได้' } })
    fireEvent.click(screen.getByRole('button', { name: /บันทึก Template เข้าคลังระบบ/ }))

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
    fireEvent.click(screen.getByRole('button', { name: /บันทึก Template เข้าคลังระบบ/ }))

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
    const input = screen.getByLabelText('ไฟล์ต้นฉบับแบบฟอร์ม')

    fireEvent.change(input, { target: { files: [new File(['old'], 'good.txt', { type: 'text/plain' })] } })
    await waitFor(() => expect(preview()).toContain('Previous converted template'))
    expect(preview()).not.toContain('คุณสมชาย')
    expect(preview()).not.toContain('TPL-PREVIEW-001')
    fireEvent.change(input, { target: { files: [new File(['bad'], 'bad.txt', { type: 'text/plain' })] } })
    await waitFor(() => expect(mocks.toast.showToast).toHaveBeenCalledWith('ไม่สามารถแปลงไฟล์ได้', 'ไฟล์ไม่รองรับ', 'ERROR'))

    fireEvent.click(screen.getByRole('button', { name: /บันทึก Template เข้าคลังระบบ/ }))
    await waitFor(() => expect(preview()).toContain('เอกสารใหม่'))
    expect(preview()).not.toContain('Previous converted template')
  })

  it('allows choosing to add template to customer forms or bill forms and filters by group', async () => {
    render(<Harness />)
    await ready()
    fireEvent.click(screen.getByText('go-add'))

    expect(screen.getByText('เพิ่มไปที่')).toBeTruthy()
    expect(screen.getByRole('button', { name: /แบบฟอร์มลูกค้า/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /แบบฟอร์มบิล/ })).toBeTruthy()

    // Add a bill form
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'ใบเสร็จรูปแบบพิเศษ' } })
    fireEvent.click(screen.getByRole('button', { name: /แบบฟอร์มบิล/ }))
    fireEvent.click(screen.getByRole('button', { name: /บันทึก Template เข้าคลังระบบ/ }))

    expect(await screen.findByText('ใบเสร็จรูปแบบพิเศษ')).toBeTruthy()

    // Test filter in library
    fireEvent.click(screen.getByRole('button', { name: /^ฟอร์มบิล/ }))
    expect(screen.getByText('ใบเสร็จรูปแบบพิเศษ')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^ฟอร์มลูกค้า/ }))
    expect(screen.queryByText('ใบเสร็จรูปแบบพิเศษ')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^ทั้งหมด/ }))
    expect(screen.getByText('ใบเสร็จรูปแบบพิเศษ')).toBeTruthy()
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
    expect(within(draftRow).getByText('พรีวิว')).toBeTruthy()
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

  it('ลบ: unsaved rows are dropped, saved rows are cancelled with the reason', async () => {
    renderCreatePage()
    await pickCustomer()
    await waitFor(() => expect(counter()).toBe('เลือกแล้ว 0 / 1'))
    await addForm('tpl-form-c')
    fireEvent.click(view().getByRole('checkbox', { name: 'เลือกทั้งหมด' }))
    expect(counter()).toBe('เลือกแล้ว 2 / 2')

    fireEvent.click(screen.getByRole('button', { name: /ลบ \(2\)/ }))
    fireEvent.change(screen.getByPlaceholderText(/ระบุเหตุผล/), { target: { value: 'ลูกค้ายกเลิก' } })
    fireEvent.click(screen.getByRole('button', { name: /ยืนยันการลบ/ }))
    await waitFor(() => expect(mocks.deactivate).toHaveBeenCalledWith('d-active', 'ลูกค้ายกเลิก'))
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
