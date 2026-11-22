import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Server actions of คนใน LINE (owner 2026-11-21): the database decides who may do what and checks the rules; these only
 * shape input, translate refusals and tell the person the answer (text from the owner's templates, to that chat only).
 */

const CONTACT = '9d0f2a52-7d1c-4d6e-8f0e-111111111111'
const CUSTOMER = '9d0f2a52-7d1c-4d6e-8f0e-222222222222'

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  enqueue: vi.fn(),
}))

async function actions() {
  return import('@/app/actions/line')
}

describe('คนใน LINE actions', () => {
  beforeEach(() => {
    vi.resetModules()
    m.rpc.mockReset()
    m.enqueue.mockReset()
    m.enqueue.mockResolvedValue({ duplicate: false })
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        rpc: m.rpc,
        from: () => {
          const q = {
            select: () => q,
            eq: () => q,
            maybeSingle: async () => ({ data: { company_name: 'ร้านเอ', phone: '081-111-2222', line_id: '@shop', templates: {} } }),
          }
          return q
        },
      }),
    }))
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
    vi.doMock('@/lib/line/supabase-store', () => ({
      createSupabaseLineStore: () => ({ enqueueRegister: m.enqueue, credentials: async () => ({ channelSecret: null, accessToken: null }) }),
    }))
  })
  afterEach(() => {
    vi.doUnmock('@/lib/supabase/server')
    vi.doUnmock('@/lib/supabase/admin')
    vi.doUnmock('@/lib/line/supabase-store')
  })

  describe('listLinePeople / getLinePeopleCounts', () => {
    it('asks the database for one page of a known list; an unknown list or a bad offset is cleaned before the call', async () => {
      m.rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null })
      const { listLinePeople } = await actions()
      expect((await listLinePeople('EVERYTHING' as never, '', 0)).success).toBe(false)
      expect(m.rpc).not.toHaveBeenCalled()
      await listLinePeople('PENDING', `  ${'ก'.repeat(150)}  `, -7)
      expect(m.rpc).toHaveBeenCalledWith('line_people_list', { p_view: 'PENDING', p_search: 'ก'.repeat(100), p_limit: 25, p_offset: 0 })
      await listLinePeople('ALL', '   ', 50)
      expect(m.rpc).toHaveBeenLastCalledWith('line_people_list', { p_view: 'ALL', p_search: null, p_limit: 25, p_offset: 50 })
    })

    it('counts are one call', async () => {
      m.rpc.mockResolvedValue({ data: { all: 3 }, error: null })
      const { getLinePeopleCounts } = await actions()
      expect(await getLinePeopleCounts()).toEqual({ success: true, data: { all: 3 } })
      expect(m.rpc).toHaveBeenCalledTimes(1)
    })
  })

  describe('needInfoLineRegister', () => {
    it('asks the database, then tells the person in their own chat with the shop\'s words', async () => {
      m.rpc.mockResolvedValue({ data: { contact_id: CONTACT, notify: true }, error: null })
      const { needInfoLineRegister } = await actions()
      const r = await needInfoLineRegister(CONTACT, '  ขอที่อยู่ด้วยค่ะ  ')
      expect(r.success).toBe(true)
      expect(m.rpc).toHaveBeenCalledWith('line_contact_register_need_info', { p_contact_id: CONTACT, p_note: 'ขอที่อยู่ด้วยค่ะ' })
      expect(m.enqueue).toHaveBeenCalledTimes(1)
      const sent = m.enqueue.mock.calls[0][0] as { contactId: string; templateKey: string; messages: Array<{ text: string }> }
      expect(sent.contactId).toBe(CONTACT)
      expect(sent.templateKey).toBe('REGISTER_NEED_INFO')
      expect(sent.messages[0].text).toContain('ขอที่อยู่ด้วยค่ะ')
      expect(sent.messages[0].text).toContain('ร้านเอ')
    })

    it('empty words are refused before the database; a person who cannot be reached (notify false) is not queued', async () => {
      const { needInfoLineRegister } = await actions()
      expect((await needInfoLineRegister(CONTACT, '   ')).success).toBe(false)
      expect((await needInfoLineRegister('not-a-uuid', 'x')).success).toBe(false)
      expect(m.rpc).not.toHaveBeenCalled()
      m.rpc.mockResolvedValue({ data: { contact_id: CONTACT, notify: false }, error: null })
      expect((await needInfoLineRegister(CONTACT, 'ขอที่อยู่')).success).toBe(true)
      expect(m.enqueue).not.toHaveBeenCalled()
    })

    it('a refusal of the database comes back in Thai', async () => {
      m.rpc.mockResolvedValue({ data: null, error: { message: 'LINE_CONTACT_NOT_PENDING' } })
      const { needInfoLineRegister } = await actions()
      expect(await needInfoLineRegister(CONTACT, 'ขอที่อยู่')).toEqual({ success: false, error: 'รายชื่อนี้ไม่ได้รอร้านตรวจแล้ว กรุณารีเฟรช' })
    })
  })

  describe('approveLineRegister', () => {
    it('a new customer: name, phone (digits only) and only the five address parts go to the database; the person is told with their name', async () => {
      m.rpc.mockResolvedValue({ data: { result: 'LINKED_CUSTOMER', contact_id: CONTACT, customer_id: CUSTOMER, created: true, name: 'สมหญิง ใจดี', notify: true }, error: null })
      const { approveLineRegister } = await actions()
      const r = await approveLineRegister({
        contactId: CONTACT,
        name: ' สมหญิง ใจดี ',
        phone: '081-111-2222',
        address: { province: ' อุตรดิตถ์ ', evil: 'x', postcode: '53000' },
      })
      expect(r.success).toBe(true)
      expect(m.rpc).toHaveBeenCalledWith('line_contact_register_approve', {
        p_contact_id: CONTACT,
        p_customer_id: null,
        p_name: 'สมหญิง ใจดี',
        p_phone: '0811112222',
        p_address: { province: 'อุตรดิตถ์', postcode: '53000' },
      })
      expect((m.enqueue.mock.calls[0][0] as { templateKey: string; messages: Array<{ text: string }> }).templateKey).toBe('REGISTER_APPROVED')
      expect((m.enqueue.mock.calls[0][0] as { messages: Array<{ text: string }> }).messages[0].text).toContain('สมหญิง ใจดี')
    })

    it('an existing customer: only the customer goes along (what was typed in the form is not used)', async () => {
      m.rpc.mockResolvedValue({ data: { result: 'LINKED_CUSTOMER', contact_id: CONTACT, customer_id: CUSTOMER, created: false, name: 'สมหญิง ใจดี', notify: false }, error: null })
      const { approveLineRegister } = await actions()
      await approveLineRegister({ contactId: CONTACT, customerId: CUSTOMER, name: 'ชื่ออื่น', phone: '0899999999' })
      expect(m.rpc).toHaveBeenCalledWith('line_contact_register_approve', { p_contact_id: CONTACT, p_customer_id: CUSTOMER, p_name: null, p_phone: null, p_address: null })
      expect(m.enqueue).not.toHaveBeenCalled() // the owner switched "tell the person" off
    })

    it('a wrong phone is refused before the database; a failed push never undoes the decision', async () => {
      const { approveLineRegister } = await actions()
      expect((await approveLineRegister({ contactId: CONTACT, name: 'x', phone: '12345' })).success).toBe(false)
      expect((await approveLineRegister({ contactId: CONTACT, customerId: 'nope' })).success).toBe(false)
      expect(m.rpc).not.toHaveBeenCalled()
      m.rpc.mockResolvedValue({ data: { result: 'LINKED_CUSTOMER', contact_id: CONTACT, customer_id: CUSTOMER, created: true, name: 'ก', notify: true }, error: null })
      m.enqueue.mockRejectedValue(new Error('LINE down'))
      expect((await approveLineRegister({ contactId: CONTACT, name: 'ก', phone: '0811112222' })).success).toBe(true)
    })

    it('taking over a customer who already has a LINE, or a phone the shop already has, is told in Thai', async () => {
      const { approveLineRegister } = await actions()
      m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'LINE_CUSTOMER_ALREADY_LINKED' } })
      expect((await approveLineRegister({ contactId: CONTACT, customerId: CUSTOMER })).error).toBe('ลูกค้ารายนี้ผูก LINE แล้ว')
      m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'LINE_CUSTOMER_PHONE_EXISTS' } })
      expect((await approveLineRegister({ contactId: CONTACT, name: 'ก', phone: '0811112222' })).error).toContain('เชื่อมกับลูกค้าเดิม')
    })
  })

  describe('rejectLineContact', () => {
    it('the person is told the shop could not confirm, with the shop phone; the reason stays with the shop', async () => {
      m.rpc.mockResolvedValue({ data: { contact_id: CONTACT, register_status: 'REJECTED', notify: true }, error: null })
      const { rejectLineContact } = await actions()
      await rejectLineContact(CONTACT, ' ไม่ใช่ลูกค้าของร้าน ')
      expect(m.rpc).toHaveBeenCalledWith('line_contact_reject', { p_contact_id: CONTACT, p_reason: 'ไม่ใช่ลูกค้าของร้าน' })
      const text = (m.enqueue.mock.calls[0][0] as { templateKey: string; messages: Array<{ text: string }> }).messages[0].text
      expect(text).toContain('081-111-2222')
      expect(text).not.toContain('ไม่ใช่ลูกค้าของร้าน')
    })

    it('switched off by the owner: nothing is queued', async () => {
      m.rpc.mockResolvedValue({ data: { contact_id: CONTACT, notify: false }, error: null })
      const { rejectLineContact } = await actions()
      await rejectLineContact(CONTACT)
      expect(m.enqueue).not.toHaveBeenCalled()
    })
  })

  describe('sendLineContactMessage', () => {
    it('checks the key and the text before the database, and runs no sender for a repeated press', async () => {
      const { sendLineContactMessage } = await actions()
      expect((await sendLineContactMessage(CONTACT, ' ', 'key-12345678')).success).toBe(false)
      expect((await sendLineContactMessage(CONTACT, 'สวัสดี', 'x')).success).toBe(false)
      expect((await sendLineContactMessage(CONTACT, 'ก'.repeat(1001), 'key-12345678')).success).toBe(false)
      expect(m.rpc).not.toHaveBeenCalled()
      m.rpc.mockResolvedValue({ data: { delivery_id: null, duplicate: true }, error: null })
      const r = await sendLineContactMessage(CONTACT, 'สวัสดีค่ะ', 'key-12345678')
      expect(m.rpc).toHaveBeenCalledWith('line_contact_message_send', { p_contact_id: CONTACT, p_text: 'สวัสดีค่ะ', p_idempotency_key: 'key-12345678' })
      expect(r).toMatchObject({ success: true, data: { duplicate: true, status: null } })
    })
  })

  describe('link codes and audit (owner)', () => {
    it('revoking and listing go straight to the database; a bad id is refused first', async () => {
      m.rpc.mockResolvedValue({ data: [], error: null })
      const { listLineCodes, revokeLineCode, listLineAudit } = await actions()
      await listLineCodes()
      expect(m.rpc).toHaveBeenCalledWith('line_codes_list', { p_limit: 50 })
      expect((await revokeLineCode('nope')).success).toBe(false)
      await revokeLineCode(CONTACT)
      expect(m.rpc).toHaveBeenLastCalledWith('line_link_code_revoke', { p_code_id: CONTACT })
      await listLineAudit(-5, CONTACT)
      expect(m.rpc).toHaveBeenLastCalledWith('line_audit_list', { p_limit: 50, p_offset: 0, p_entity: CONTACT })
      expect((await listLineAudit(0, 'nope')).success).toBe(false)
    })
  })
})
