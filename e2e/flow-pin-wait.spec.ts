import { test, expect } from '@playwright/test';
import { OWNER_STATE } from './helpers';
import { sql } from './db';

// PIN waits (owner 2026-10-26, Master §4.3) on the real lock screen: misses 1-5 no wait,
// miss 6 waits 1 minute and the keypad stops taking digits. Uses plain Playwright (not ./fixtures)
// so the lock screen is not unlocked automatically. The owner's miss count is put back afterwards.
const ownerPin = `user_id = (select id from public.profiles where username = 'owner')`;

test.use({ storageState: OWNER_STATE });

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'chromium', 'changes the owner PIN state: Chromium only');
});

test.afterEach(() => {
  sql(`update public.user_pins set failed_attempts = 0, locked_until = null where ${ownerPin}`);
});

test('PIN ผิด 1–5 ครั้งยังลองได้ทันที ครั้งที่ 6 ต้องรอ 1 นาที', async ({ page }) => {
  sql(`update public.user_pins set failed_attempts = 0, locked_until = null where ${ownerPin}`);
  await page.goto('/dashboard');
  const lockScreen = page.getByText('ลืม PIN?', { exact: true });
  const lockButton = page.getByRole('button', { name: 'ล็อกระบบ' });
  await expect(lockScreen.or(lockButton)).toBeVisible({ timeout: 30000 });
  if (!(await lockScreen.isVisible())) await lockButton.click();
  await expect(lockScreen).toBeVisible({ timeout: 15000 });

  const typeWrong = async () => {
    for (const d of '111111') await page.getByRole('button', { name: `ตัวเลข ${d}`, exact: true }).click();
  };
  for (let miss = 1; miss <= 5; miss++) {
    await typeWrong();
    await expect(page.getByText(`PIN ไม่ถูกต้อง (ผิด ${miss} ครั้ง)`)).toBeVisible({ timeout: 15000 });
  }
  expect(sql(`select failed_attempts, locked_until is null from public.user_pins where ${ownerPin}`)[0]).toEqual(['5', 't']);

  await typeWrong();
  await expect(page.getByText('รออีก 1 นาที แล้วลองใหม่')).toBeVisible({ timeout: 15000 });
  expect(sql(`select failed_attempts, round(extract(epoch from locked_until - now())) between 50 and 60
                from public.user_pins where ${ownerPin}`)[0]).toEqual(['6', 't']);
});
