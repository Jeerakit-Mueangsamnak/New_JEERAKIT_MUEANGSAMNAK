import { test as base, expect } from '@playwright/test';
import { typePin } from './helpers';

// Once the owner has a PIN, every new browser session opens on the PIN lock screen (server
// checked). Unlock it the way a person does, whenever it shows up.
export const test = base.extend({
  page: async ({ page }, provide) => {
    // The lock screen has no instruction text any more; its "ลืม PIN?" link sits under the keypad.
    const lockScreen = page.getByText('ลืม PIN?', { exact: true });
    await page.addLocatorHandler(lockScreen, async () => {
      await typePin(page);
      await expect(lockScreen).toBeHidden({ timeout: 15000 });
    });
    await provide(page);
  },
});

export { expect };
