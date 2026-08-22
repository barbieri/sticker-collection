import { expect, type Page, test } from '@playwright/test';
import { decodeSerials, encodeSerials } from '../src/services/codec';

const spec = 'fifa-wc2026';
const maxSerial = 999;

async function serialsByCode(page: Page, codes: string[]): Promise<number[]> {
  return page.evaluate((input) => {
    const appConfig = window.__APP_CONFIG__ as
      | { specData: { lookup: { idToNumber: Record<string, number> } } }
      | undefined;
    const lookup = appConfig?.specData.lookup.idToNumber ?? {};
    return input.map((code) => {
      const serial = lookup[code.replace('-', '')];
      if (typeof serial !== 'number') throw new Error(`Unknown sticker code ${code}`);
      return serial;
    });
  }, codes);
}

async function setCollection(
  page: Page,
  ownedCodes: string[],
  duplicateCodes: string[],
): Promise<void> {
  const owned = await serialsByCode(page, ownedCodes);
  const duplicates = await serialsByCode(page, duplicateCodes);
  await page.evaluate(
    ({ owned, duplicates }) => {
      localStorage.setItem(
        'sticker-collection:v1:collection:fifa-wc2026:default',
        JSON.stringify({ spec: 'fifa-wc2026', name: 'default', owned, duplicates }),
      );
      localStorage.setItem(
        'sticker-collection:v1:registry',
        JSON.stringify([{ spec: 'fifa-wc2026', name: 'default' }]),
      );
    },
    { owned, duplicates },
  );
  await page.reload();
}

async function receiveExchangeUrl(
  page: Page,
  peerMissingCodes: string[],
  peerDuplicateCodes: string[],
): Promise<string> {
  const missing = await serialsByCode(page, peerMissingCodes);
  const duplicates = await serialsByCode(page, peerDuplicateCodes);
  const params = new URLSearchParams();
  params.set('spec', spec);
  params.set('name', 'friend');
  params.set('missing', await encodeSerials(missing, maxSerial));
  params.set('duplicates', await encodeSerials(duplicates, maxSerial));
  return `#share/receive?${params.toString()}`;
}

async function exchangedUrl(
  page: Page,
  takenCodes: string[],
  givenCodes: string[],
): Promise<string> {
  const taken = await serialsByCode(page, takenCodes);
  const given = await serialsByCode(page, givenCodes);
  const params = new URLSearchParams();
  params.set('spec', spec);
  params.set('name', 'friend');
  params.set('taken', await encodeSerials(taken, maxSerial));
  params.set('given', await encodeSerials(given, maxSerial));
  return `#share/exchanged?${params.toString()}`;
}

async function decodedHashList(page: Page, key: 'taken' | 'given'): Promise<number[]> {
  const encoded = await page.evaluate((payloadKey) => {
    const [, query = ''] = window.location.hash.split('?');
    return new URLSearchParams(query).get(payloadKey) ?? '';
  }, key);
  return encoded ? decodeSerials(encoded, maxSerial) : [];
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept('default'));
  await page.goto('#album');
});

test('exchange can finish with a non-zero difference', async ({ page }) => {
  await setCollection(page, [], []);
  await page.goto(await receiveExchangeUrl(page, [], ['CAN-1', 'CAN-2']));

  await expect(page.locator('#share-need-count')).toHaveText('2');
  await expect(page.locator('#share-peer-count')).toHaveText('0');
  await expect(page.locator('#share-count-diff')).toHaveText('2');

  await page.click('#share-exchange-apply');
  await page.waitForURL(/#share\/exchange-sendback\?/);
  expect(await decodedHashList(page, 'taken')).toHaveLength(2);
  expect(await decodedHashList(page, 'given')).toHaveLength(0);
  await expect(page.locator('#current-total')).toHaveText('2');
});

test('dismissing exchange sendback hides the overlay before returning to share', async ({
  page,
}) => {
  await setCollection(page, [], []);
  await page.goto(await receiveExchangeUrl(page, [], ['CAN-1']));

  await page.click('#share-exchange-apply');
  await page.waitForURL(/#share\/exchange-sendback\?/);
  await expect(page.locator('#share-exchange-sendback-screen')).not.toHaveClass(/hidden/);

  await page.click('#share-exchanged-sendback-close');
  await expect(page.locator('#share-exchange-sendback-screen')).toHaveClass(/hidden/);
  await expect(page).toHaveURL(/#album$/);

  await page.click('button[data-tab="share"]');
  await expect(page.locator('#share-exchange-sendback-screen')).toHaveClass(/hidden/);
  await expect(page.locator('[data-share-accordion="exchange-list"]')).toBeVisible();
  await page.click('[data-share-accordion="exchange-list"]');
  await expect(page.locator('#share-exchange-list-screen')).toBeVisible();
});

test('exchange sendback payload sorts taken and given serials', async ({ page }) => {
  await setCollection(page, ['MEX-1', 'CAN-1'], ['CAN-1', 'MEX-1']);
  await page.goto(await receiveExchangeUrl(page, ['CAN-1', 'MEX-1'], ['CAN-1', 'MEX-1']));

  await page.locator('input[data-need-duplicate]').first().check();
  await page.locator('input[data-need-duplicate]').last().check();
  await page.click('#share-exchange-apply');
  await page.waitForURL(/#share\/exchange-sendback\?/);

  const taken = await decodedHashList(page, 'taken');
  const given = await decodedHashList(page, 'given');
  expect(taken).toEqual([...taken].sort((a, b) => a - b));
  expect(given).toEqual([...given].sort((a, b) => a - b));
});

test('I can unselect stickers I would take to zero the difference', async ({ page }) => {
  await setCollection(page, ['RSA-1'], ['RSA-1']);
  await page.goto(await receiveExchangeUrl(page, ['RSA-1'], ['CAN-1', 'CAN-2']));

  await page.locator('input[data-need]').last().uncheck();
  await expect(page.locator('#share-need-count')).toHaveText('1');
  await expect(page.locator('#share-peer-count')).toHaveText('1');
  await expect(page.locator('#share-count-diff')).toHaveText('0');

  await page.click('#share-exchange-apply');
  await page.waitForURL(/#share\/exchange-sendback\?/);
  expect(await decodedHashList(page, 'taken')).toHaveLength(1);
  expect(await decodedHashList(page, 'given')).toHaveLength(1);
  await expect(page.locator('#current-total')).toHaveText('2');
  await expect(page.locator('#duplicates-total')).toHaveText('0');
});

test('I can select duplicates my friend already owns to offset my extra taken stickers', async ({
  page,
}) => {
  await setCollection(page, ['MEX-1', 'MEX-2'], ['MEX-1', 'MEX-2']);
  await page.goto(await receiveExchangeUrl(page, [], ['CAN-1', 'CAN-2']));

  await expect(page.locator('input[data-peer-duplicate]')).toHaveCount(2);
  await page.locator('input[data-peer-duplicate]').first().check();
  await page.locator('input[data-peer-duplicate]').last().check();
  await expect(page.locator('#share-need-count')).toHaveText('2');
  await expect(page.locator('#share-peer-count')).toHaveText('0');
  await expect(page.locator('#share-peer-duplicate-count')).toHaveText('2');
  await expect(page.locator('#share-count-diff')).toHaveText('0');

  await page.click('#share-exchange-apply');
  await page.waitForURL(/#share\/exchange-sendback\?/);
  expect(await decodedHashList(page, 'taken')).toHaveLength(2);
  expect(await decodedHashList(page, 'given')).toHaveLength(2);
  await expect(page.locator('#current-total')).toHaveText('4');
  await expect(page.locator('#duplicates-total')).toHaveText('0');
});

test('only one copy of repeated peer duplicates is selected as a needed sticker', async ({
  page,
}) => {
  await setCollection(page, [], []);
  await page.goto(await receiveExchangeUrl(page, [], ['CAN-1', 'CAN-1', 'CAN-1']));

  await expect(page.locator('input[data-need]')).toHaveCount(1);
  await expect(page.locator('input[data-need-duplicate]')).toHaveCount(2);
  await expect(page.locator('input[data-need-duplicate]:checked')).toHaveCount(0);
  await expect(page.locator('.share-change-name').first()).toHaveCSS('color', 'rgb(102, 102, 102)');
  await expect(page.locator('#share-need-count')).toHaveText('1');
  await expect(page.locator('#share-need-duplicate-count')).toHaveText('0');
  await expect(page.locator('#share-count-diff')).toHaveText('1');

  await expect(page.locator('[data-exchange-section-chevron="share-need-list"]')).toHaveText(
    'expand_less',
  );
  await page.locator('[data-exchange-section-toggle="share-need-list"]').click();
  await expect(page.locator('#share-need-list')).toHaveClass(/hidden/);
  await expect(page.locator('[data-exchange-section-chevron="share-need-list"]')).toHaveText(
    'expand_more',
  );
  await expect(page.locator('#share-need-duplicate-list')).not.toHaveClass(/hidden/);
  await page.locator('[data-exchange-section-toggle="share-need-list"]').click();
  await expect(page.locator('#share-need-list')).not.toHaveClass(/hidden/);

  await expect(page.locator('#share-need-count')).toHaveCSS('text-align', 'right');
  await expect(page.locator('#share-need-duplicate-count')).toHaveCSS('text-align', 'right');

  await page.locator('input[data-need-duplicate]').first().check();
  await expect(page.locator('#share-need-count')).toHaveText('1');
  await expect(page.locator('#share-need-duplicate-count')).toHaveText('1');
  await expect(page.locator('#share-count-diff')).toHaveText('2');

  await page.click('#share-exchange-apply');
  await page.waitForURL(/#share\/exchange-sendback\?/);
  expect(await decodedHashList(page, 'taken')).toHaveLength(2);
  await expect(page.locator('#current-total')).toHaveText('1');
  await expect(page.locator('#duplicates-total')).toHaveText('1');
});

test('only one copy of my repeated duplicates is selected as a peer-needed sticker', async ({
  page,
}) => {
  await setCollection(page, ['MEX-1'], ['MEX-1', 'MEX-1', 'MEX-1']);
  await page.goto(await receiveExchangeUrl(page, ['MEX-1'], []));

  await expect(page.locator('input[data-peer]')).toHaveCount(1);
  await expect(page.locator('input[data-peer-duplicate]')).toHaveCount(2);
  await expect(page.locator('input[data-peer-duplicate]:checked')).toHaveCount(0);
  await expect(page.locator('#share-peer-count')).toHaveText('1');
  await expect(page.locator('#share-peer-duplicate-count')).toHaveText('0');
  await expect(page.locator('#share-count-diff')).toHaveText('-1');

  await page.locator('input[data-peer-duplicate]').first().check();
  await expect(page.locator('#share-peer-count')).toHaveText('1');
  await expect(page.locator('#share-peer-duplicate-count')).toHaveText('1');
  await expect(page.locator('#share-count-diff')).toHaveText('-2');

  await page.click('#share-exchange-apply');
  await page.waitForURL(/#share\/exchange-sendback\?/);
  expect(await decodedHashList(page, 'given')).toHaveLength(2);
  await expect(page.locator('#current-total')).toHaveText('1');
  await expect(page.locator('#duplicates-total')).toHaveText('1');
});

test('I can unselect stickers the peer would take to zero the difference', async ({ page }) => {
  await setCollection(page, ['MEX-1', 'MEX-2'], ['MEX-1', 'MEX-2']);
  await page.goto(await receiveExchangeUrl(page, ['MEX-1', 'MEX-2'], ['CAN-1']));

  await page.locator('input[data-peer]').last().uncheck();
  await expect(page.locator('#share-need-count')).toHaveText('1');
  await expect(page.locator('#share-peer-count')).toHaveText('1');
  await expect(page.locator('#share-count-diff')).toHaveText('0');

  await page.click('#share-exchange-apply');
  await page.waitForURL(/#share\/exchange-sendback\?/);
  expect(await decodedHashList(page, 'taken')).toHaveLength(1);
  expect(await decodedHashList(page, 'given')).toHaveLength(1);
  await expect(page.locator('#duplicates-total')).toHaveText('1');
});

test('I can select already-owned peer duplicates to offset extra given stickers', async ({
  page,
}) => {
  await setCollection(page, ['CAN-1', 'CAN-2', 'MEX-1', 'MEX-2'], ['MEX-1', 'MEX-2']);
  await page.goto(await receiveExchangeUrl(page, ['MEX-1', 'MEX-2'], ['CAN-1', 'CAN-2']));

  await expect(page.locator('input[data-need-duplicate]')).toHaveCount(2);
  await page.locator('input[data-need-duplicate]').first().check();
  await page.locator('input[data-need-duplicate]').last().check();
  await expect(page.locator('#share-need-count')).toHaveText('0');
  await expect(page.locator('#share-need-duplicate-count')).toHaveText('2');
  await expect(page.locator('#share-peer-count')).toHaveText('2');
  await expect(page.locator('#share-count-diff')).toHaveText('0');

  await page.click('#share-exchange-apply');
  await page.waitForURL(/#share\/exchange-sendback\?/);
  expect(await decodedHashList(page, 'taken')).toHaveLength(2);
  expect(await decodedHashList(page, 'given')).toHaveLength(2);
  await expect(page.locator('#current-total')).toHaveText('4');
  await expect(page.locator('#duplicates-total')).toHaveText('2');
});

test('accepting a sendback adds received already-owned stickers as duplicates', async ({
  page,
}) => {
  await setCollection(page, ['CAN-1', 'CAN-2', 'MEX-1', 'MEX-2'], ['CAN-1', 'CAN-2']);
  await page.goto(await exchangedUrl(page, ['CAN-1', 'MEX-1', 'CAN-2'], ['MEX-2', 'MEX-1']));

  await expect(page.locator('#share-exchanged-receive-screen p').nth(1)).toContainText(
    'Given to your friend: 3',
  );
  await expect(page.locator('#share-exchanged-receive-screen p').nth(2)).toContainText(
    'Taken from your friend: 2',
  );
  await expect(page.locator('#share-exchanged-taken-list .share-change')).toContainText([
    'MEX-1',
    'CAN-1',
    'CAN-2',
  ]);
  await expect(page.locator('#share-exchanged-given-list .share-change')).toContainText([
    'MEX-1',
    'MEX-2',
  ]);
  await page.click('#share-exchanged-apply');
  await expect(page.locator('#current-total')).toHaveText('4');
  await expect(page.locator('#duplicates-total')).toHaveText('2');
});
