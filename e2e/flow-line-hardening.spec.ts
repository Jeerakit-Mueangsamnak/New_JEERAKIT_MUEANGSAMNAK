import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { sql } from './db'
import { login } from './helpers'

const id = randomUUID()
const uid = 'U' + randomUUID().replaceAll('-', '')
const name = 'LINE Hardening ' + id.slice(0, 8)

test.beforeAll(() => {
  if (process.env.LINE_E2E_DB_CONTAINER !== 'supabase_db_line-hardening-20261121') throw new Error('Isolated Local database required')
  sql(`insert into public.line_contacts(id,line_user_id,display_name,status,followed,register_status,typed_name,typed_phone)
    values('${id}','${uid}','${name}','UNLINKED',true,'PENDING','Local fixture','0817109999')`)
})

// The browser must never talk to anything but this Local server. Requests the app prefetches for menus the member is
// NOT allowed to open (the middleware answers 401/403) or that fail when the page is left are cancelled by the browser;
// WebKit reports those as a page error ("Load failed"), which is a harness artefact, not a defect of the page under test.
// The request is still aborted, so nothing outside 127.0.0.1 is ever contacted.
const IGNORED_PAGE_ERRORS = [/^TypeError: Load failed$/, /(?:_rsc.*due to access control checks|due to access control checks.*_rsc)/i]
test.beforeEach(async ({ context }) => {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
  })
})

async function openPerson(page: import('@playwright/test').Page) {
  await page.goto('/line')
  await page.getByRole('tab', { name: 'รอร้านตรวจสอบ' }).click()
  await page.getByLabel('ค้นหาคนใน LINE').fill(name)
  await page.getByTestId('line-people-PENDING').getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'ดูรายละเอียด' }).click()
}

test('owner suspends and restores a scope; reason and actor persist; layout stays in viewport', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', e => { if (!IGNORED_PAGE_ERRORS.some((re) => re.test(e.message))) errors.push(e.message) })
  await login(page)
  await page.waitForURL(u => !u.pathname.startsWith('/login'))
  await openPerson(page)
  await expect(page.getByRole('button', { name: 'อนุมัติ', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'ระงับสิทธิ์', exact: true }).click()
  await expect(page.getByRole('button', { name: 'ยืนยันระงับสิทธิ์' })).toBeDisabled()
  await page.getByLabel('ประเภทการใช้งาน').selectOption('INQUIRY')
  await page.getByLabel('ระยะเวลา (นาที)').fill('15')
  await page.getByLabel('เหตุผล', { exact: true }).fill('Local E2E repeated inquiry')
  await page.getByRole('button', { name: 'ยืนยันระงับสิทธิ์' }).click()
  await expect(page.getByText('ระงับสิทธิ์แล้ว', { exact: true })).toBeVisible()
  expect(sql(`select scope,source,reason,created_by is not null,until_at>now() from public.line_contact_restrictions where contact_id='${id}'`)[0])
    .toEqual(['INQUIRY','OWNER','Local E2E repeated inquiry','t','t'])
  await openPerson(page)
  await expect(page.getByText('Local E2E repeated inquiry', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('owner-restriction.png'), fullPage: true })
  await page.getByRole('button', { name: 'ยกเลิกการระงับ', exact: true }).click()
  await page.getByLabel('เหตุผล', { exact: true }).fill('Local E2E owner restored')
  await page.getByRole('button', { name: 'ยืนยันยกเลิกการระงับ' }).click()
  await expect(page.getByText('ยกเลิกการระงับแล้ว', { exact: true })).toBeVisible()
  expect(sql(`select revoked_at is not null,revoked_by is not null from public.line_contact_restrictions where contact_id='${id}'`)[0]).toEqual(['t','t'])
  expect(errors).toEqual([])
})

test('staff with POS, bills, customers and LINE menus cannot approve, reject, link or suspend', async ({ page }, info) => {
  await login(page, 'line-hardening-staff', 'Staff1234!')
  await page.waitForURL(u => !u.pathname.startsWith('/login'))
  await openPerson(page)
  for (const label of ['อนุมัติ', 'ปฏิเสธ', 'ร้านกรอกให้', 'ยืนยันว่าถูกต้อง', 'ยกเลิกการผูกบัญชี', 'ระงับสิทธิ์', 'ขอข้อมูลเพิ่ม']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: 'ติดต่อผ่าน LINE' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('staff-no-management.png'), fullPage: true })
})

test('a public visitor cannot enter the LINE management page', async ({ page }) => {
  await page.goto('/line')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('tablist', { name: 'เมนู LINE' })).toHaveCount(0)
})