import { expect, type Page, test } from '@playwright/test';

const openTab = async (page: Page, tab: 'album' | 'search' | 'config'): Promise<void> => {
  await page.click(`button[data-tab="${tab}"]`);
  await page.waitForFunction(
    (tabId) => !document.getElementById(`tab-${tabId}`)?.classList.contains('hidden'),
    tab,
  );
};

const resetState = async (page: Page): Promise<void> => {
  page.once('dialog', (dialog) => dialog.accept());
  await openTab(page, 'config');
  await page.click('#cfg-reset-persisted');
  await openTab(page, 'search');
};

test.beforeEach(async ({ page }) => {
  await page.goto('#search');
  await resetState(page);
});

test('shows message if no filter', async ({ page }) => {
  await expect(page.locator('#quick-help')).not.toHaveClass(/hidden/);
  await expect(page.locator('#quick-entry')).toHaveClass(/hidden/);
});

test("type 'ME' auto-completes to 'MEX-'", async ({ page }) => {
  const input = page.locator('#quick-input');
  await input.fill('ME');
  await expect(input).toHaveValue('MEX-');
});

test("delete from 'MEX-' goes back to 'M' because 'MAR' also matches", async ({ page }) => {
  const input = page.locator('#quick-input');
  await input.fill('ME');
  await expect(input).toHaveValue('MEX-');

  await input.press('Backspace');
  await expect(input).toHaveValue('M');
});

test("type 'R' auto-completes to 'RSA-'", async ({ page }) => {
  const input = page.locator('#quick-input');
  await input.fill('R');
  await expect(input).toHaveValue('RSA-');
});

test("delete from 'RSA-' goes back to '' when no other prefix exists", async ({ page }) => {
  const input = page.locator('#quick-input');
  await input.fill('R');
  await expect(input).toHaveValue('RSA-');

  await input.press('Backspace');
  await expect(input).toHaveValue('');
});

test("type 'RSA-1' shows the first card", async ({ page }) => {
  const input = page.locator('#quick-input');
  await input.fill('RSA-1');

  await expect(input).toHaveValue('RSA-1');
  await expect(page.locator('#quick-help')).toHaveClass(/hidden/);
  await expect(page.locator('#quick-entry')).not.toHaveClass(/hidden/);
  await expect(page.locator('#quick-group-id')).toHaveText('RSA-1');
});
