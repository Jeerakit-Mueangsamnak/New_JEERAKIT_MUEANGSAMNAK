import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20261122125635_line_delivery_scope_v1.sql'), 'utf8')

describe('migration 20261122125635 (delivery scope)', () => {
  const allowed = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION public._line_delivery_allowed'), SQL.indexOf('-- 2. A word from the shop'))

  it('is the single definition of what a contact may receive', () => {
    expect(SQL.match(/CREATE OR REPLACE FUNCTION public\._line_delivery_allowed/g)).toHaveLength(1)
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\._line_delivery_allowed\(public\.line_contacts, text, text\) FROM PUBLIC, anon, authenticated, service_role;/)
  })

  it('plain wording reaches an unconfirmed friend, but only when they follow and are not suspended from messages', () => {
    expect(allowed).toContain("WHEN p_source = 'SHOP_MESSAGE' THEN p_template = 'SHOP_MESSAGE'")
    expect(allowed).toContain("WHEN p_source = 'REGISTER' THEN p_template IN ('REGISTER_WELCOME', 'REGISTER_NEED_INFO', 'REGISTER_APPROVED', 'REGISTER_REJECTED')")
    expect(allowed).toContain("COALESCE(c.followed AND NOT public._line_scope_blocked(c.id, 'MESSAGES') AND CASE")
  })

  it('every other source (bill, appointment, task, card) needs a linked, reviewed, still-active account', () => {
    expect(allowed).toContain("ELSE c.status = 'LINKED' AND NOT c.needs_review AND (")
    expect(allowed).toContain("x.id = c.profile_id AND x.status = 'ACTIVE'")
    expect(allowed).toContain('public._line_driver_active(c.driver_code)')
  })

  it('the shop’s own message is validated as one plain text message', () => {
    expect(SQL).toMatch(/IF NOT public\._line_messages_valid\(jsonb_build_array\(jsonb_build_object\('type', 'text', 'text', v_text\)\)\) THEN/)
  })

  it('a friend who is suspended from messages is refused before a row is queued', () => {
    expect(SQL).toContain('IF public._line_scope_blocked(v_c.id, \'MESSAGES\') THEN RAISE EXCEPTION \'LINE_CONTACT_SUSPENDED\'')
  })

  it('adding the OA again never slips past a suspension or the owner-notice cooldown', () => {
    expect(SQL).toContain('AND NOT public._line_scope_blocked(v_c.id, \'MESSAGES\'));')
    expect(SQL).toContain('IF v_notify AND NOT p_is_unblock AND public._line_owner_notice_allowed(v_c.id) THEN')
    expect(SQL).toContain('PERFORM public._line_require_server();')
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.line_contact_follow\(text, text, text, boolean\) TO service_role;/)
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.line_contact_follow\(text, text, text, boolean\) FROM PUBLIC, anon, authenticated;/)
  })
})
