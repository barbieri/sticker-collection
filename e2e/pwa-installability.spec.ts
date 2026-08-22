import { expect, test } from '@playwright/test';

test('spec locale page redirects to trailing slash before app loading', async ({ page }) => {
  await page.goto('/fifa-wc2026/en-US#album');
  await expect(page).toHaveURL(/\/fifa-wc2026\/en-US\/#album$/);
});

test('spec locale page exposes installable web app metadata', async ({ page, request }) => {
  await page.goto('/fifa-wc2026/en-US/#album');

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    './manifest.webmanifest',
  );
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '../icons/favicon.svg',
  );
  await expect(page.locator('link[rel="icon"][type="image/png"]')).toHaveAttribute(
    'href',
    '../icons/favicon-32.png',
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '../icons/icon-180.png',
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000');

  const manifestResponse = await request.get('/fifa-wc2026/en-US/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as {
    name?: string;
    start_url?: string;
    scope?: string;
    display?: string;
    icons?: Array<{ src?: string; sizes?: string; purpose?: string }>;
  };
  expect(manifest.name).toBe('FIFA World Cup 2026');
  expect(manifest.start_url).toBe('./');
  expect(manifest.scope).toBe('./');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: '../icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      }),
      expect.objectContaining({
        src: '../icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      }),
    ]),
  );
  expect(manifest.icons?.every((icon) => icon.purpose === 'any maskable')).toBe(true);

  const iconResponse = await request.get('/fifa-wc2026/icons/icon-512.png');
  expect(iconResponse.ok()).toBe(true);
  expect(iconResponse.headers()['content-type']).toContain('image/png');

  const serviceWorkerResponse = await request.get('/fifa-wc2026/en-US/service-worker.js');
  expect(serviceWorkerResponse.ok()).toBe(true);
  const serviceWorker = await serviceWorkerResponse.text();
  expect(serviceWorker).toContain('addEventListener("fetch"');
  expect(serviceWorker).toContain('../icons/icon-512.png');

  const serviceWorkerPath = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL ? new URL(registration.active.scriptURL).pathname : '';
  });
  expect(serviceWorkerPath).toBe('/fifa-wc2026/en-US/service-worker.js');
});
