type WorkerInstallEvent = Event & {
  waitUntil(promise: Promise<unknown>): void;
};

type WorkerFetchEvent = Event & {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
};

type WorkerGlobal = typeof globalThis & {
  clients: {
    claim(): Promise<void>;
  };
  location: Location;
  skipWaiting(): Promise<void>;
};

const worker = self as unknown as WorkerGlobal;
const cacheVersion = 'v2';
const cacheScope = new URL('.', worker.location.href).pathname
  .replace(/^\/+|\/+$/g, '')
  .replace(/[^a-z0-9-]+/gi, '-')
  .toLowerCase();
const cacheName = `sticker-collection-${cacheScope}-${cacheVersion}`;
const cachePrefix = `sticker-collection-${cacheScope}-`;
const appShellPrecacheUrls = [
  './',
  './index.html',
  './manifest.webmanifest',
  './service-worker.js',
  '../icons/favicon.svg',
  '../icons/favicon-32.png',
  '../icons/icon-180.png',
  '../icons/icon-192.png',
  '../icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined',
  ...BRANDING_URLS, // set with esbuild define
];
const toAbsoluteUrl = (url: string): string => new URL(url, worker.location.href).toString();

worker.addEventListener('install', (event) => {
  const installEvent = event as WorkerInstallEvent;
  installEvent.waitUntil(
    caches.open(cacheName).then((cache) => cache.addAll(appShellPrecacheUrls.map(toAbsoluteUrl))),
  );
  worker.skipWaiting();
});

worker.addEventListener('activate', (event) => {
  const activateEvent = event as WorkerInstallEvent;
  activateEvent.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(cachePrefix) && key !== cacheName)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener('fetch', (event) => {
  const fetchEvent = event as WorkerFetchEvent;
  if (fetchEvent.request.method !== 'GET') return;
  fetchEvent.respondWith(
    caches.match(fetchEvent.request).then((cached) => {
      if (cached) return cached;
      return fetch(fetchEvent.request)
        .then((response) => {
          if (response?.status !== 200 || response.type === 'opaque') return response;
          const copy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(fetchEvent.request, copy));
          return response;
        })
        .catch(() => {
          if (fetchEvent.request.mode === 'navigate') {
            return caches
              .match(new URL('./index.html', worker.location.href).toString())
              .then((fallback) => fallback ?? Response.error());
          }
          return Response.error();
        });
    }),
  );
});
