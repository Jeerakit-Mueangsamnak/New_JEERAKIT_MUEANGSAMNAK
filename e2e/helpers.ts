import { expect, type Page } from '@playwright/test';

// Account created by supabase/tests/reset_local_app_db.sh (local stack only).
export const OWNER = { username: 'owner', password: 'Owner1234!' };
// Not a run or a repeated digit: the app refuses easy PINs such as 123456.
export const PIN = '258036';
export const OWNER_STATE = 'e2e/.auth/owner.json';

export async function login(page: Page, username = OWNER.username, password = OWNER.password) {
  await page.goto('/login');
  await page.getByPlaceholder('Username').fill(username);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
}

/** Types a PIN on the on-screen PinPad inside `scope` (a dialog or the lock screen). */
export async function typePin(scope: Page | ReturnType<Page['locator']>, pin = PIN) {
  for (const d of pin) await scope.getByRole('button', { name: `ตัวเลข ${d}`, exact: true }).click();
}

/** Answers the "risky action" PIN prompt (PinConfirmProvider) titled `title`. */
export async function confirmPin(page: Page, title: string | RegExp, opts: { reason?: string } = {}, pin = PIN) {
  // Exact title: the PIN prompt opens on top of the form that asked for it (similar titles).
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  if (opts.reason) await dialog.getByRole('textbox', { name: 'เหตุผล' }).fill(opts.reason);
  await dialog.getByRole('textbox', { name: 'PIN' }).fill(pin);
  await dialog.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15000 });
}

/** Collects uncaught page errors so a test can assert the page stayed healthy. */
export function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return {
    errors,
    expectNone: () => expect(errors, 'uncaught errors on the page').toEqual([]),
  };
}

/** The amount box that sits under the text `label` (checkout and payment forms). */
export const amountBox = (page: Page, label: string) =>
  page.locator('div').filter({ has: page.getByText(label, { exact: true }) }).last().getByRole('textbox').first();

/** Reads the bill number from the "saved" dialog after ออกบิล and closes it. */
export async function issuedBillNo(page: Page) {
  const done = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^บันทึก(บิลเช่า|การขาย)สำเร็จ$/ }) });
  await expect(done).toBeVisible({ timeout: 20000 });
  const no = (await done.innerText()).match(/[A-Z]{2,4}-\d{8}-\d{3}/)?.[0] ?? '';
  await done.getByRole('button', { name: 'ออก' }).click();
  return no;
}
