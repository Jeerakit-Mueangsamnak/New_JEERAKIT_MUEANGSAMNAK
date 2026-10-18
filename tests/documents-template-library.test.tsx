// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { INITIAL_TEMPLATES } from '@/features/documents/constants/initialDocumentTemplates'

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
vi.mock('@/features/documents/utils/documentConverter', () => ({ convertFileToInternalTemplate: mocks.convert }))
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
  mocks.print.mockClear()
  mocks.fetchDocs.mockResolvedValue([])
})
afterEach(cleanup)

describe('คลังแบบฟอร์ม', () => {
  it('lists all built-in forms and previews the first one', () => {
    render(<Harness />)
    expect(screen.getByText(`รายการแบบฟอร์มเอกสาร (${INITIAL_TEMPLATES.length})`)).toBeTruthy()
    expect(screen.getByText(`เลือกแล้ว 0 / ${INITIAL_TEMPLATES.length}`)).toBeTruthy()
    expect(preview()).toBe(renderLibraryTemplate(INITIAL_TEMPLATES[0], business))
  })

  it('provides quotation, delivery, receipt and equipment-check templates in the library', () => {
    render(<Harness />)
    for (const id of ['tpl_quotation', 'tpl_delivery_note', 'tpl_receipt', 'tpl_equipment_check']) {
      expect(INITIAL_TEMPLATES.some((template) => template.id === id)).toBe(true)
      expect(screen.getByTestId(`tpl-row-${id}`)).toBeTruthy()
    }
  })

  it('previews only the blank quotation form from the supplied layout', () => {
    const quotation = INITIAL_TEMPLATES.find((template) => template.id === 'tpl_quotation')!
    const html = renderLibraryTemplate(quotation, business)
    const rendered = document.createElement('div')
    rendered.innerHTML = html

    expect(rendered.textContent).toContain('ใบเสนอราคา / QUOTATION')
    expect(rendered.textContent).toContain('เลขผู้เสียภาษี')
    expect(rendered.textContent).toContain('หมายเหตุ / Terms & Conditions:')
    expect(rendered.textContent).toContain('จำนวนเงินตัวอักษร:')
    expect(rendered.textContent).toContain('ผู้ตรวจสอบ / ฝ่ายบริหาร')
    expect(rendered.textContent).toContain('จีรกิตติ์ ไม้แบบพลาสติก อุตรดิตถ์')
    expect(rendered.textContent).toContain('แกะระยะแบบ(ฟรี)')
    expect(rendered.querySelector('div[style*="height:297mm"]')?.getAttribute('style')).toContain('width:calc(100% + 64px)')
    expect(rendered.querySelector('div[style*="height:297mm"]')?.getAttribute('style')).toContain('padding:5mm')
    expect(rendered.querySelectorAll('table')[0].querySelectorAll('tbody tr')).toHaveLength(16)
    expect(rendered.querySelectorAll('input, button, script')).toHaveLength(0)
    expect(rendered.textContent).not.toContain('คุณสมชาย')
    expect(rendered.textContent).not.toContain('นั่งร้านเหล็กมาตรฐาน')
    expect(rendered.textContent).not.toContain('TPL-PREVIEW-001')
    expect(rendered.querySelector('img[alt="JJK Jeerakit Plastic Formwork"]')?.getAttribute('src')).toBe('/logo.png')
  })

  it('previews all four requested core templates without demo customer or bill data', () => {
    const coreIds = ['tpl_quotation', 'tpl_delivery_note', 'tpl_receipt', 'tpl_equipment_check']
    for (const id of coreIds) {
      const template = INITIAL_TEMPLATES.find((item) => item.id === id)!
      const content = textOf(renderLibraryTemplate(template, business))
      expect(content).not.toContain('คุณสมชาย')
      expect(content).not.toContain('CUST-2026-001')
      expect(content).not.toContain('INV-2026-00088')
      expect(content).not.toContain('EQ-001')
      expect(content).not.toContain('TPL-PREVIEW-001')
    }
  })

  it('keeps the four core templates visible if an older library state hid them', () => {
    window.localStorage.setItem('rental-pos:document-template-library:v1', JSON.stringify({
      custom: [],
      hiddenIds: ['tpl_quotation', 'tpl_delivery_note', 'tpl_receipt', 'tpl_equipment_check'],
    }))

    render(<Harness />)
    const coreIds = ['tpl_quotation', 'tpl_delivery_note', 'tpl_receipt', 'tpl_equipment_check']
    for (const id of coreIds) {
      const row = screen.getByTestId(`tpl-row-${id}`)
      expect(row).toBeTruthy()
      expect((within(row).getByRole('checkbox') as HTMLInputElement).disabled).toBe(false)
    }
    const rows = Array.from(document.querySelectorAll('[data-testid^="tpl-row-"]'))
    expect(coreIds.map((id) => rows.indexOf(screen.getByTestId(`tpl-row-${id}`)))).toEqual([0, 1, 2, 3])
  })

  it('allows selecting and printing one core template without allowing it to be deleted', () => {
    render(<Harness />)
    const receipt = INITIAL_TEMPLATES.find((template) => template.id === 'tpl_receipt')!
    const checkbox = screen.getByLabelText(`เลือก ${receipt.name}`) as HTMLInputElement

    expect(checkbox.disabled).toBe(false)
    fireEvent.click(checkbox)
    expect(screen.getByRole('button', { name: 'พิมพ์ (1)' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'ลบ (0)' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'พิมพ์ (1)' }))
    expect(mocks.print).toHaveBeenCalledTimes(1)
    expect(mocks.print.mock.calls[0][0]).toHaveLength(1)
    expect(textOf(mocks.print.mock.calls[0][0][0])).toBe(textOf(renderLibraryTemplate(receipt, business)))
  })

  it('clicking a row moves the preview and the selected badge to that form', () => {
    render(<Harness />)
    const target = INITIAL_TEMPLATES[3]
    fireEvent.click(screen.getByTestId(`tpl-row-${target.id}`))
    expect(preview()).toBe(renderLibraryTemplate(target, business))
    expect(within(screen.getByTestId(`tpl-row-${target.id}`)).getByText('พรีวิว')).toBeTruthy()
    expect(within(screen.getByTestId(`tpl-row-${INITIAL_TEMPLATES[0].id}`)).queryByText('พรีวิว')).toBeNull()
  })

  it('print is disabled with nothing ticked and prints exactly the ticked forms', () => {
    render(<Harness />)
    const printBtn = screen.getByRole('button', { name: /พิมพ์ \(0\)/ }) as HTMLButtonElement
    expect(printBtn.disabled).toBe(true)

    const a = INITIAL_TEMPLATES.find((template) => template.id === 'tpl_delivery_note')!
    const b = INITIAL_TEMPLATES.find((template) => template.id === 'tpl_receipt')!
    // Previewing another form must not change what gets printed
    fireEvent.click(screen.getByTestId(`tpl-row-${INITIAL_TEMPLATES[5].id}`))
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

  it('checkbox and preview are independent; select-all and the X / Y counter follow the ticks', () => {
    render(<Harness />)
    const total = INITIAL_TEMPLATES.length
    const a = INITIAL_TEMPLATES[4]
    const box = () => screen.getByLabelText(`เลือก ${a.name}`) as HTMLInputElement

    // Ticking does not move the preview
    fireEvent.click(box())
    expect(box().checked).toBe(true)
    expect(preview()).toBe(renderLibraryTemplate(INITIAL_TEMPLATES[0], business))
    expect(screen.getByText(`เลือกแล้ว 1 / ${total}`)).toBeTruthy()

    // Clicking the row previews it without touching its checkbox
    fireEvent.click(screen.getByTestId(`tpl-row-${a.id}`))
    expect(preview()).toBe(renderLibraryTemplate(a, business))
    expect(box().checked).toBe(true)
    fireEvent.click(screen.getByTestId(`tpl-row-${INITIAL_TEMPLATES[1].id}`))
    expect((screen.getByLabelText(`เลือก ${INITIAL_TEMPLATES[1].name}`) as HTMLInputElement).checked).toBe(false)

    const all = screen.getByRole('checkbox', { name: 'เลือกทั้งหมด' }) as HTMLInputElement
    fireEvent.click(all)
    expect(screen.getByText(`เลือกแล้ว ${total} / ${total}`)).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(`พิมพ์ \\(${total}\\)`) })).toBeTruthy()
    fireEvent.click(all)
    expect(screen.getByText(`เลือกแล้ว 0 / ${total}`)).toBeTruthy()
  })

  it('deletes only the ticked forms and only after a reason is given', () => {
    render(<Harness />)
    const a = INITIAL_TEMPLATES[2]
    const b = INITIAL_TEMPLATES[9]
    expect((screen.getByRole('button', { name: /ลบ \(0\)/ }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText(`เลือก ${a.name}`))
    fireEvent.click(screen.getByLabelText(`เลือก ${b.name}`))
    fireEvent.click(screen.getByRole('button', { name: /ลบ \(2\)/ }))
    const confirm = screen.getByRole('button', { name: /ยืนยันการลบ/ }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(/ระบุเหตุผล/), { target: { value: 'เลิกใช้' } })
    fireEvent.click(confirm)

    expect(screen.queryByTestId(`tpl-row-${a.id}`)).toBeNull()
    expect(screen.queryByTestId(`tpl-row-${b.id}`)).toBeNull()
    expect(screen.getByText(`รายการแบบฟอร์มเอกสาร (${INITIAL_TEMPLATES.length - 2})`)).toBeTruthy()
    expect(screen.getByTestId(`tpl-row-${INITIAL_TEMPLATES[0].id}`)).toBeTruthy()
  })

  it('เพิ่มแบบฟอร์ม saves the form into the library, selects and previews it, and keeps it after reload', () => {
    const { unmount } = render(<Harness />)
    fireEvent.click(screen.getByText('go-add'))
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'แบบฟอร์มทดสอบใหม่' } })
    fireEvent.click(screen.getByRole('button', { name: /บันทึก Template เข้าคลังระบบ/ }))

    expect(screen.getByText(`รายการแบบฟอร์มเอกสาร (${INITIAL_TEMPLATES.length + 1})`)).toBeTruthy()
    expect(preview()).toContain('แบบฟอร์มทดสอบใหม่')
    unmount()

    render(<Harness />)
    expect(screen.getByText('แบบฟอร์มทดสอบใหม่')).toBeTruthy()
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
    expect(preview()).toContain('เอกสารใหม่')
    expect(preview()).not.toContain('Previous converted template')
  })

  it('allows choosing to add template to customer forms or bill forms and filters by group', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('go-add'))

    expect(screen.getByText('เพิ่มไปที่')).toBeTruthy()
    expect(screen.getByRole('button', { name: /แบบฟอร์มลูกค้า/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /แบบฟอร์มบิล/ })).toBeTruthy()

    // Add a bill form
    fireEvent.change(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร'), { target: { value: 'ใบเสร็จรูปแบบพิเศษ' } })
    fireEvent.click(screen.getByRole('button', { name: /แบบฟอร์มบิล/ }))
    fireEvent.click(screen.getByRole('button', { name: /บันทึก Template เข้าคลังระบบ/ }))

    expect(screen.getByText('ใบเสร็จรูปแบบพิเศษ')).toBeTruthy()

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
    id: 'd-active', customer_id: 'c1', doc_type: 'OTHER', template_code: 'tpl_signature_confirmation', template_version: '1',
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
  const addForm = (code: string) => fireEvent.change(screen.getByLabelText('-- เลือกแบบฟอร์มเพื่อเพิ่มเอกสาร --'), { target: { value: code } })
  const counter = () => view().getByText(/^เลือกแล้ว/).textContent
  const renderCreatePage = () => {
    render(<DocumentsPage />)
    fireEvent.click(screen.getByRole('button', { name: /สร้างเอกสาร/ }))
  }

  it('opens directly to the template library with all four requested forms visible', () => {
    render(<DocumentsPage />)
    expect(screen.getByText(`รายการแบบฟอร์มเอกสาร (${INITIAL_TEMPLATES.length})`)).toBeTruthy()
    for (const id of ['tpl_quotation', 'tpl_delivery_note', 'tpl_receipt', 'tpl_equipment_check']) {
      expect(screen.getByTestId(`tpl-row-${id}`)).toBeTruthy()
    }
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
    addForm('tpl_signature_confirmation')
    expect(counter()).toBe('เลือกแล้ว 0 / 2')
    const draftRow = screen.getAllByTestId(/doc-row-draft:/)[0]
    expect(draftRow.textContent).toContain('ยังไม่บันทึก')
    expect(within(draftRow).getByText('พรีวิว')).toBeTruthy()
    expect(screen.getAllByTestId('preview')[0].textContent).toContain('ช่างทองสุข')

    fireEvent.click(screen.getByRole('button', { name: /บันทึก \(1\)/ }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    const [customerId, data] = mocks.save.mock.calls[0]
    expect(customerId).toBe('c1')
    expect(data).toMatchObject({ docType: 'OTHER', templateCode: 'tpl_signature_confirmation' })
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
    addForm('tpl_signature_confirmation')

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
    addForm('tpl_signature_confirmation')
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
    addForm('tpl_signature_confirmation')

    fireEvent.click(screen.getByRole('button', { name: /จัดการเอกสาร/ }))
    expect(screen.getByText(`รายการแบบฟอร์มเอกสาร (${INITIAL_TEMPLATES.length})`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^เอกสารลูกค้า$/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มแบบฟอร์ม/ }))
    expect(screen.getByPlaceholderText('ชื่อแบบฟอร์ม / ชื่อเอกสาร')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /สร้างเอกสาร/ }))
    expect(screen.getAllByTestId(/doc-row-draft:/)).toHaveLength(1)
  })
})
