import { expect, type Page, test } from '@playwright/test';

const openTab = async (
  page: Page,
  tab: 'album' | 'duplicates' | 'search' | 'config',
): Promise<void> => {
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

const expandDupGroup = async (page: Page, id: string): Promise<void> => {
  const g = page.locator(`#dup-groups .group[data-group-id="${id}"]`).first();
  const grid = g.locator('.grid').first();
  if (await grid.evaluate((el) => el.classList.contains('hidden'))) {
    await g.locator('.group-head').click();
  }
  await expect(grid).not.toHaveClass(/hidden/);
};

const seedDuplicates = async (page: Page): Promise<void> => {
  page.on('dialog', (dialog) => dialog.accept());

  await openTab(page, 'search');
  await page.fill('#quick-input', 'MEX-1');
  await page.click('#quick-toggle');
  await page.click('#quick-dup-editor button[data-op="inc"]');
  await page.click('#quick-dup-editor button[data-op="inc"]');

  await page.fill('#quick-input', 'CAN-1');
  await page.click('#quick-toggle');
  await page.click('#quick-dup-editor button[data-op="inc"]');

  await page.fill('#quick-input', 'MAR-1');
  await page.click('#quick-toggle');
};

test.beforeEach(async ({ page }) => {
  await page.goto('#album');
  await resetState(page);
  await seedDuplicates(page);
});

test('duplicates sort order changes to alpha', async ({ page }) => {
  await openTab(page, 'duplicates');
  const initialOrder = await page
    .locator('#dup-groups .group:not(.hidden) .group-id')
    .allTextContents();
  expect(initialOrder).not.toEqual([]);

  await openTab(page, 'config');
  await page.selectOption('#cfg-sort', 'alpha');
  await openTab(page, 'duplicates');

  const alphaOrder = await page
    .locator('#dup-groups .group:not(.hidden) .group-id')
    .allTextContents();
  const sorted = [...alphaOrder].sort((a, b) => a.localeCompare(b));
  expect(alphaOrder).toEqual(sorted);
  expect(alphaOrder).not.toEqual(initialOrder);
});

test('duplicates filter shows only matching groups', async ({ page }) => {
  await openTab(page, 'duplicates');
  await page.fill('#search-dups', 'MA');

  await expect(page.locator('#dup-groups .group[data-group-id="MAR"]')).not.toHaveClass(/hidden/);
  await expect(page.locator('#dup-groups .group[data-group-id="MEX"]')).toHaveClass(/hidden/);
  await expect(page.locator('#dup-groups .group[data-group-id="CAN"]')).toHaveClass(/hidden/);
});

test('duplicates hide owned hides not-owned items', async ({ page }) => {
  await openTab(page, 'config');
  await page.check('#cfg-hide-owned');
  await openTab(page, 'duplicates');

  await expect(
    page.locator('#dup-groups .group[data-group-id="MEX"] .item[data-item-id="1"]'),
  ).not.toHaveClass(/hidden/);
  await expect(
    page.locator('#dup-groups .group[data-group-id="MEX"] .item[data-item-id="2"]'),
  ).toHaveClass(/hidden/);
});

test('duplicates hide complete hides empty groups', async ({ page }) => {
  await openTab(page, 'search');
  await page.fill('#quick-input', 'MAR-1');
  await page.click('#quick-toggle');

  await openTab(page, 'config');
  await page.check('#cfg-hide-owned');
  await page.check('#cfg-hide-complete');
  await openTab(page, 'duplicates');

  await expect(page.locator('#dup-groups .group[data-group-id="MAR"]')).toHaveClass(/hidden/);
  await expect(page.locator('#dup-groups .group[data-group-id="MEX"]')).not.toHaveClass(/hidden/);
});

test('duplicates counter cannot decrease below zero and toggles zero class', async ({ page }) => {
  await openTab(page, 'config');
  await page.check('#cfg-hide-owned');
  await page.check('#cfg-hide-complete');
  await openTab(page, 'duplicates');
  await expandDupGroup(page, 'MEX');

  const mexCounter = page
    .locator('#dup-groups .group[data-group-id="MEX"] .item[data-item-id="1"] [data-dup-count="1"]')
    .first();
  const mexDec = page
    .locator(
      '#dup-groups .group[data-group-id="MEX"] .item[data-item-id="1"] button[data-op="dec"]',
    )
    .first();
  const mexInc = page
    .locator(
      '#dup-groups .group[data-group-id="MEX"] .item[data-item-id="1"] button[data-op="inc"]',
    )
    .first();

  await expect(mexCounter).toHaveText('2');
  await expect(mexCounter).not.toHaveClass(/dup-count-zero/);
  await mexDec.click();
  await mexDec.click();
  await expect(mexCounter).toHaveText('0');
  await expect(mexCounter).toHaveClass(/dup-count-zero/);
  await expect(mexDec).toBeDisabled();
  await mexInc.click();
  await expect(mexCounter).toHaveText('1');
  await expect(mexCounter).not.toHaveClass(/dup-count-zero/);
});

test('duplicates top total updates with duplicate count changes', async ({ page }) => {
  await expect(page.locator('#duplicates-total')).toHaveText('3');

  await openTab(page, 'config');
  await page.check('#cfg-hide-owned');
  await page.check('#cfg-hide-complete');
  await openTab(page, 'duplicates');
  await expandDupGroup(page, 'MEX');

  const mexDec = page
    .locator(
      '#dup-groups .group[data-group-id="MEX"] .item[data-item-id="1"] button[data-op="dec"]',
    )
    .first();

  await mexDec.click();
  await mexDec.click();
  await expect(page.locator('#duplicates-total')).toHaveText('1');
});
