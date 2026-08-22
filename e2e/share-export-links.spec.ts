import { expect, type Page, test } from '@playwright/test';
import { decodeSerials, encodeSerials } from '../src/services/codec';

declare global {
  interface Window {
    __copiedText?: string;
    __openedUrl?: string;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedText = '';
    window.__openedUrl = '';
    const clipboard = navigator.clipboard as Clipboard & {
      writeText?: (data: string) => Promise<void>;
    };
    clipboard.writeText = async (data: string) => {
      window.__copiedText = data;
    };
    window.open = (url?: string | URL) => {
      window.__openedUrl = String(url ?? '');
      return null;
    };
  });

  await page.goto('#search');
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'prompt') await dialog.accept('+55 (11) 99999-0000');
    else await dialog.accept();
  });

  await page.fill('#quick-input', 'MEX-1');
  await page.click('#quick-toggle');
  await page.click('#quick-dup-editor button[data-op="inc"]');
});

async function assertWhatsappLinkFromPopup(
  page: Page,
  trigger: string,
  routeFragment: string,
): Promise<void> {
  await page.evaluate(() => {
    window.__openedUrl = '';
    window.open = (url?: string | URL) => {
      window.__openedUrl = String(url ?? '');
      return null;
    };
  });
  await page.click(trigger);
  await page.waitForFunction(() => {
    const opened = window.__openedUrl ?? '';
    return opened.length > 0;
  });
  const opened = await page.evaluate(() => window.__openedUrl ?? '');
  const waUrl = new URL(opened);
  expect(['wa.me', 'api.whatsapp.com']).toContain(waUrl.hostname);
  const phone = waUrl.searchParams.get('phone') ?? waUrl.pathname.replace(/^\//, '');
  expect(phone).toBe('5511999990000');
  const text = waUrl.searchParams.get('text') ?? '';
  expect(decodeURIComponent(text)).toContain(routeFragment);
}

async function assertClipboardLink(
  page: Page,
  trigger: string,
  routeFragment: string,
): Promise<void> {
  await page.click(trigger);
  await page.waitForFunction((fragment) => {
    const copied = window.__copiedText ?? '';
    return copied.length > 0 && copied.includes(fragment as string);
  }, routeFragment);
  const copied = await page.evaluate(() => window.__copiedText ?? '');
  expect(copied).toContain(routeFragment);
}

async function decodePayload(
  link: string,
  key: 'duplicates' | 'missing',
  maxSerial = 999,
): Promise<number[]> {
  const hash = new URL(link).hash.replace(/^#/, '');
  const [, query = ''] = hash.split('?');
  const params = new URLSearchParams(query);
  const encoded = params.get(key);
  if (!encoded) return [];
  return decodeSerials(encoded, maxSerial);
}

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

async function shareParams(
  page: Page,
  payload: {
    duplicates?: string[];
    missing?: string[];
    taken?: string[];
    given?: string[];
  },
): Promise<URLSearchParams> {
  const params = new URLSearchParams();
  params.set('spec', 'fifa-wc2026');
  params.set('name', 'friend');
  for (const [key, codes] of Object.entries(payload)) {
    if (!codes) continue;
    params.set(key, await encodeSerials(await serialsByCode(page, codes), 999));
  }
  return params;
}

async function assertOnlyShareAccordionVisible(page: Page): Promise<void> {
  for (const screenId of [
    'share-exchange-list-screen',
    'share-export-list-screen',
    'share-receive-screen',
    'share-exchange-sendback-screen',
    'share-exchanged-receive-screen',
    'share-qrcode-screen',
  ]) {
    await expect(page.locator(`#${screenId}`)).toHaveClass(/hidden/);
  }

  await expect(page.locator('#tab-share > .share-accordion')).toBeVisible();
  const visibleDirectChildren = await page.locator('#tab-share > :visible').evaluateAll((els) =>
    els.map((el) => ({
      id: el.id,
      className: el.className,
    })),
  );
  expect(visibleDirectChildren).toEqual([{ id: '', className: 'share-accordion' }]);
}

async function assertQrRouteAndCanvas(
  page: Page,
  trigger: string,
  routeFragment: string,
): Promise<void> {
  await page.click(trigger);
  await expect(page).toHaveURL(/#share\/qrcode\?/);
  await page.waitForSelector('#share-qrcode-content canvas');
  const encodedUrl = await page.evaluate(() => {
    const hash = window.location.hash.replace(/^#/, '');
    const [, query = ''] = hash.split('?');
    const params = new URLSearchParams(query);
    return params.get('url') ?? '';
  });
  expect(decodeURIComponent(encodedUrl)).toContain(routeFragment);
}

test('exchange export generates correct whatsapp and copy links', async ({ page }) => {
  await page.click('button[data-tab="share"]');
  await page.click('[data-share-accordion="exchange-list"]');

  await assertWhatsappLinkFromPopup(page, '#share-exchange-send-whatsapp', '#share/receive?');
  await assertClipboardLink(page, '#share-exchange-send-copy', '#share/receive?');
  const copied = await page.evaluate(() => window.__copiedText ?? '');
  const missing = await decodePayload(copied, 'missing');
  const duplicates = await decodePayload(copied, 'duplicates');
  const [ownedSerial] = await serialsByCode(page, ['MEX-1']);
  expect(missing).not.toContain(ownedSerial);
  expect(duplicates).toEqual([ownedSerial]);
});

test('exchange export qr opens qrcode route and renders canvas', async ({ page }) => {
  await page.click('button[data-tab="share"]');
  await page.click('[data-share-accordion="exchange-list"]');
  await assertQrRouteAndCanvas(page, '#share-exchange-send-qr', 'share/receive?');
});

test('closing share menus hides routed screens and leaves only the accordion visible', async ({
  page,
}) => {
  await page.click('button[data-tab="share"]');

  for (const route of ['exchange-list', 'export-list']) {
    await page.click(`[data-share-accordion="${route}"]`);
    await expect(page).toHaveURL(new RegExp(`#share/${route}$`));
    await expect(page.locator(`#share-${route}-screen`)).not.toHaveClass(/hidden/);

    await page.click(`[data-share-accordion="${route}"]`);
    await expect(page).toHaveURL(/#share$/);
    await expect(page.locator(`#share-${route}-screen`)).toHaveClass(/hidden/);
    await expect(page.locator('[data-share-chevron="exchange-list"]')).toHaveText('expand_more');
    await expect(page.locator('[data-share-chevron="export-list"]')).toHaveText('expand_more');
    await assertOnlyShareAccordionVisible(page);
  }
});

test('closing fullscreen share routes hides screens and leaves only the accordion visible', async ({
  page,
}) => {
  const receiveParams = await shareParams(page, {
    missing: ['MEX-1'],
    duplicates: ['CAN-1'],
  });
  await page.goto(`#share/receive?${receiveParams.toString()}`);
  await expect(page.locator('#share-receive-screen')).toBeVisible();
  await page.click('#share-exchange-cancel');
  await expect(page).toHaveURL(/#share$/);
  await assertOnlyShareAccordionVisible(page);

  const exchangedParams = await shareParams(page, {
    taken: ['MEX-1'],
    given: ['CAN-1'],
  });
  await page.goto(`#share/exchanged?${exchangedParams.toString()}`);
  await expect(page.locator('#share-exchanged-receive-screen')).toBeVisible();
  await page.click('#share-exchanged-cancel');
  await expect(page).toHaveURL(/#share$/);
  await assertOnlyShareAccordionVisible(page);

  const sendbackParams = await shareParams(page, {
    taken: ['CAN-1'],
    given: ['MEX-1'],
  });
  await page.goto(`#share/exchange-sendback?${sendbackParams.toString()}`);
  await expect(page.locator('#share-exchange-sendback-screen')).toBeVisible();
  await page.click('#share-exchanged-sendback-close');
  await expect(page).toHaveURL(/#album$/);
  await page.click('button[data-tab="share"]');
  await expect(page).toHaveURL(/#share$/);
  await assertOnlyShareAccordionVisible(page);
});
