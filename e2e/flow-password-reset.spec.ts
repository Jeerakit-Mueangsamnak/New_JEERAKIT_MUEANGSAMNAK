import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { login } from './helpers';
import { sql } from './db';

// Forgot password (Supabase e-mail link): ask for the link → the e-mail arrives → open it →
// set a new password → sign in with the new one; the old one no longer works.
// Mail goes to the local Mailpit of the Supabase stack, never to a real address.
test.describe.configure({ mode: 'serial' });

const local = JSON.parse(readFileSync(path.join(__dirname, 'local-env.json'), 'utf8')) as Record<string, string>;
const MAILPIT = 'http://127.0.0.1:54324';
const stamp = Date.now();
const STAFF = {
  username: `reset_e2e_${stamp}`,
  password: 'ResetE2E-Old!2026',
  newPassword: 'ResetE2E-New!2026',
  email: `reset_e2e_${stamp}@example.com`,
};

async function staffPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return context.newPage();
}

/** The recovery link in the newest e-mail sent to `to`. */
async function recoveryLink(to: string): Promise<string> {
  let link = '';
  await expect
    .poll(
      async () => {
        const search = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
        const id = search.messages?.[0]?.ID;
        if (!id) return '';
        const message = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
        const found = String(message.HTML || message.Text || '').match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]+/);
        link = found ? found[0].replace(/&amp;/g, '&') : '';
        return link;
      },
      { timeout: 30000 },
    )
    .not.toBe('');
  return link;
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'chromium', 'creates users: Chromium only');
});

test.beforeAll(async () => {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Set SUPABASE_SECRET_KEY to the local Supabase secret key before running this test.');
  }
  const res = await fetch(`${local.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: STAFF.email,
      password: STAFF.password,
      email_confirm: true,
      user_metadata: { username: STAFF.username, display_name: 'ทดสอบลืมรหัส' },
    }),
  });
  expect(res.ok).toBe(true);
  sql(`update public.profiles set status = 'ACTIVE' where username = '${STAFF.username}'`);
});

test('ลืมรหัสผ่าน: ขอลิงก์ทางอีเมล ตั้งรหัสใหม่ แล้วเข้าสู่ระบบด้วยรหัสใหม่ได้', async ({ browser, baseURL }) => {
  const page = await staffPage(browser);
  await page.goto('/login');
  await page.getByRole('link', { name: 'ลืมรหัสผ่าน?' }).click();
  await page.waitForURL('**/forgot-password');
  await page.getByPlaceholder('somchai@example.com').fill(STAFF.email);
  await page.getByRole('button', { name: 'ส่งลิงก์รีเซ็ตรหัสผ่าน' }).click();
  await expect(page.getByText(STAFF.email)).toBeVisible({ timeout: 15000 });

  // Supabase checks the link and sends the browser back to the shop. The local stack only lists
  // localhost:3000 as an allowed return address, so the return address is pointed at this test
  // server — the same as a correctly configured "Redirect URLs" entry.
  const verify = await fetch(await recoveryLink(STAFF.email), { redirect: 'manual' });
  const back = new URL(verify.headers.get('location') || '');
  expect(back.searchParams.get('code') || back.hash).toBeTruthy();
  const target = new URL(back.pathname + back.search + back.hash, baseURL);
  if (!target.pathname.startsWith('/auth/callback')) {
    target.pathname = '/auth/callback';
    target.searchParams.set('next', '/reset-password');
  }
  await page.goto(target.toString());
  await page.waitForURL('**/reset-password**', { timeout: 20000 });

  await page.getByPlaceholder('อย่างน้อย 8 ตัวอักษร').fill(STAFF.newPassword);
  await page.getByPlaceholder('กรอกรหัสผ่านใหม่ซ้ำอีกครั้ง').fill(STAFF.newPassword);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText('เปลี่ยนรหัสผ่านสำเร็จ')).toBeVisible({ timeout: 15000 });
  await page.context().close();

  const oldTry = await staffPage(browser);
  await login(oldTry, STAFF.username, STAFF.password);
  await expect(oldTry.getByText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')).toBeVisible({ timeout: 15000 });
  await oldTry.context().close();

  const newTry = await staffPage(browser);
  await login(newTry, STAFF.username, STAFF.newPassword);
  await newTry.waitForURL((url) => url.pathname !== '/login', { timeout: 30000 });
  await newTry.context().close();
});
