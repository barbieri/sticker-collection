import { expect, type Locator, type Page, test } from '@playwright/test';

const openTab = async (page: Page, tab: 'album' | 'config'): Promise<void> => {
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
  await openTab(page, 'album');
};

const group = (page: Page, id: string): Locator =>
  page.locator(`#album-groups .group[data-group-id="${id}"]`).first();

const expandGroup = async (page: Page, id: string): Promise<void> => {
  const g = group(page, id);
  const grid = g.locator('.grid').first();
  if (await grid.evaluate((el) => el.classList.contains('hidden'))) {
    await g.locator('.group-head').click();
  }
  await expect(grid).not.toHaveClass(/hidden/);
};

const item = (page: Page, groupId: string, itemId: string): Locator =>
  group(page, groupId).locator(`.item[data-item-id="${itemId}"]`).first();

const toggle = (page: Page, groupId: string, itemId: string): Locator =>
  item(page, groupId, itemId).locator('.item-toggle[data-serial]').first();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
  await page.goto('#album');
  await resetState(page);
});

test('print route applies hide-owned and hide-completed classes', async ({ page }) => {
  await expandGroup(page, 'MEX');

  await toggle(page, 'MEX', '1').click();
  await toggle(page, 'MEX', '2').click();
  await toggle(page, 'MEX', '3').click();

  await openTab(page, 'config');
  await page.check('#cfg-hide-owned');
  await page.goto('#print');

  const mexRow = page
    .locator('#print-table tr', {
      has: page.locator('th.print-group-cell, th.print-group-cell-double', { hasText: 'MEX' }),
    })
    .first();
  const mex1Cell = mexRow.locator('td.print-cell').first();
  await expect(mex1Cell).toHaveClass(/print-cell-hidden/);
  await expect(mex1Cell).toHaveClass(/print-cell-owned/);

  await page.goto('#album');
  await openTab(page, 'config');
  for (let i = 4; i <= 20; i += 1) {
    await openTab(page, 'album');
    await expandGroup(page, 'MEX');
    await toggle(page, 'MEX', String(i)).click();
    await openTab(page, 'config');
  }
  await page.check('#cfg-hide-complete');
  await page.goto('#print');

  const completedMexRow = page
    .locator('#print-table tr', {
      has: page.locator('th.print-group-cell, th.print-group-cell-double', { hasText: 'MEX' }),
    })
    .first();
  await expect(completedMexRow).toHaveClass(/print-completed/);
});

test('native print action uses print route and restores previous route', async ({ page }) => {
  await page.goto('#album');

  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('#tab-print')).not.toHaveClass(/hidden/);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#print');

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#album');
  await expect(page.locator('#tab-print')).toHaveClass(/hidden/);
  await expect(page.locator('#tab-album')).not.toHaveClass(/hidden/);
});
