import { expect, type Locator, type Page, test } from '@playwright/test';

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

const assertAlbumTotals = async (page: Page, owned: string, percentage: string): Promise<void> => {
  await expect(page.locator('#current-total')).toHaveText(owned);
  await expect(page.locator('#current-percentage')).toHaveText(percentage);
};

test.beforeEach(async ({ page }) => {
  await page.goto('#album');
  await resetState(page);
});

test('basic counters and sort order changes preserve spec order when restored', async ({
  page,
}) => {
  await assertAlbumTotals(page, '0', '0%');
  await expect(page.locator('#current-remaining')).toHaveText('994');

  const initialOrder = await page.locator('#album-groups > .group .group-id').allTextContents();

  await openTab(page, 'config');
  await page.selectOption('#cfg-sort', 'alpha');
  await openTab(page, 'album');

  const alphaOrder = await page.locator('#album-groups > .group .group-id').allTextContents();
  const sorted = [...alphaOrder].sort((a, b) => a.localeCompare(b));
  expect(alphaOrder).toEqual(sorted);

  await openTab(page, 'config');
  await page.selectOption('#cfg-sort', 'spec');
  await page.selectOption('#cfg-sort', 'alpha');
  await page.selectOption('#cfg-sort', 'spec');
  await openTab(page, 'album');

  const restoredOrder = await page.locator('#album-groups > .group .group-id').allTextContents();
  expect(restoredOrder).toEqual(initialOrder);
});

test('config links to about page with GitHub source', async ({ page }) => {
  await openTab(page, 'config');
  await page.click('a[href="#about"]');

  await expect(page).toHaveURL(/#about$/);
  await expect(page.locator('#tab-about')).not.toHaveClass(/hidden/);
  await expect(page.locator('#tab-about h2')).toHaveText('About');

  const source = page.locator(
    '#tab-about a[href="https://github.com/barbieri/sticker-collection"]',
  );
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(source).toHaveAttribute('rel', /noopener/);
  await expect(source.locator('img[src="../../images/github.svg"]')).toBeVisible();
});

test('toggle owned updates album and group totals, classes, and hide owned behavior', async ({
  page,
}) => {
  await expandGroup(page, 'MEX');

  await toggle(page, 'MEX', '1').click();
  await assertAlbumTotals(page, '1', '0%');
  await expect(group(page, 'MEX').locator('.group-progress .current-owned')).toHaveText('1');
  await expect(toggle(page, 'MEX', '1')).toHaveClass(/owned/);

  await toggle(page, 'MEX', '1').click();
  await assertAlbumTotals(page, '0', '0%');
  await expect(group(page, 'MEX').locator('.group-progress .current-owned')).toHaveText('0');
  await expect(toggle(page, 'MEX', '1')).not.toHaveClass(/owned/);

  await toggle(page, 'MEX', '1').click();
  await openTab(page, 'config');
  await page.check('#cfg-hide-owned');
  await openTab(page, 'album');
  await expect(item(page, 'MEX', '1')).toHaveClass(/hidden/);

  await openTab(page, 'config');
  await page.uncheck('#cfg-hide-owned');
  await openTab(page, 'album');
  await expect(item(page, 'MEX', '1')).not.toHaveClass(/hidden/);
});

test('multiple selection and deselection updates album and MEX/CAN group counters', async ({
  page,
}) => {
  await expandGroup(page, 'MEX');
  await expandGroup(page, 'CAN');

  const sequence: Array<[string, string, string, string, string]> = [
    ['MEX', '1', '1', '1', '0'],
    ['MEX', '2', '2', '2', '0'],
    ['MEX', '3', '3', '3', '0'],
    ['CAN', '1', '4', '3', '1'],
    ['CAN', '2', '5', '3', '2'],
    ['CAN', '2', '4', '3', '1'],
    ['CAN', '1', '3', '3', '0'],
    ['MEX', '3', '2', '2', '0'],
    ['MEX', '2', '1', '1', '0'],
    ['MEX', '1', '0', '0', '0'],
  ];

  for (const [g, i, albumTotal, mexTotal, canTotal] of sequence) {
    await toggle(page, g, i).click();
    await expect(page.locator('#current-total')).toHaveText(albumTotal);
    await expect(group(page, 'MEX').locator('.group-progress .current-owned')).toHaveText(mexTotal);
    await expect(group(page, 'CAN').locator('.group-progress .current-owned')).toHaveText(canTotal);
  }
});

test('group completion and hide complete behavior', async ({ page }) => {
  await expandGroup(page, 'MEX');
  for (let i = 1; i <= 20; i += 1) {
    await toggle(page, 'MEX', String(i)).click();
  }

  await expect(group(page, 'MEX')).toHaveClass(/completed/);

  await openTab(page, 'config');
  await page.check('#cfg-hide-complete');
  await openTab(page, 'album');
  await expect(group(page, 'MEX')).toHaveClass(/hidden/);

  await openTab(page, 'config');
  await page.uncheck('#cfg-hide-complete');
  await openTab(page, 'album');
  await expect(group(page, 'MEX')).not.toHaveClass(/hidden/);
});

test('duplicates visibility and duplicate-protected un-own behavior', async ({ page }) => {
  let alertMessage = '';
  page.on('dialog', async (dialog) => {
    alertMessage = dialog.message();
    await dialog.accept();
  });

  await openTab(page, 'search');
  await page.fill('#quick-input', 'MEX-1');
  await page.click('#quick-toggle');
  await page.click('#quick-dup-editor button[data-op="inc"]');
  await page.click('#quick-dup-editor button[data-op="inc"]');

  await page.fill('#quick-input', 'MEX-3');
  await page.click('#quick-toggle');
  await page.click('#quick-dup-editor button[data-op="inc"]');
  await page.click('#quick-dup-editor button[data-op="inc"]');
  await page.click('#quick-dup-editor button[data-op="inc"]');

  await openTab(page, 'config');
  await page.check('#cfg-show-dup');
  await openTab(page, 'album');
  await expandGroup(page, 'MEX');

  await expect(item(page, 'MEX', '1').locator('[data-dup-badge="1"]')).toHaveText('2');
  await expect(item(page, 'MEX', '3').locator('[data-dup-badge="1"]')).toHaveText('3');
  await expect(item(page, 'MEX', '2').locator('[data-dup-badge="1"]')).toHaveClass(/hidden/);

  await openTab(page, 'config');
  await page.uncheck('#cfg-show-dup');
  await openTab(page, 'album');
  await expect(item(page, 'MEX', '1').locator('[data-dup-badge="1"]')).toHaveClass(/hidden/);
  await expect(item(page, 'MEX', '3').locator('[data-dup-badge="1"]')).toHaveClass(/hidden/);

  await toggle(page, 'MEX', '1').click();
  await expect(toggle(page, 'MEX', '1')).toHaveClass(/owned/);
  expect(alertMessage.length).toBeGreaterThan(0);
});

test('album filter shows only matching groups for prefix M', async ({ page }) => {
  await page.fill('#search-input', 'M');

  await expect(group(page, 'MEX')).not.toHaveClass(/hidden/);
  await expect(group(page, 'MAR')).not.toHaveClass(/hidden/);

  const visible = await page
    .locator('#album-groups .group:not(.hidden) .group-id')
    .allTextContents();
  expect(visible.sort()).toEqual(['MAR', 'MEX']);
});

test('collapse/expand all buttons reflect state and user manual changes', async ({ page }) => {
  const collapse = page.locator('#collapse-all');
  const expand = page.locator('#expand-all');

  await expect(collapse).toBeDisabled();
  await expect(expand).toBeEnabled();

  await expand.click();
  await expect(collapse).toBeEnabled();
  await expect(expand).toBeDisabled();
  await expect(page.locator('#album-groups .group .grid.hidden')).toHaveCount(0);

  await collapse.click();
  const groupCount = await page.locator('#album-groups .group:not(.hidden)').count();
  await expect(page.locator('#album-groups .group:not(.hidden) .grid.hidden')).toHaveCount(
    groupCount,
  );
  await expect(collapse).toBeDisabled();
  await expect(expand).toBeEnabled();

  await group(page, 'MEX').locator('.group-head').click();
  await expect(collapse).toBeEnabled();
  await expect(expand).toBeEnabled();

  await group(page, 'MEX').locator('.group-head').click();
  await expect(collapse).toBeDisabled();
  await expect(expand).toBeEnabled();
});
