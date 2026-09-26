// Service worker: офлайн-доступ к прочитанным страницам + шелл/шрифты/данные.
// Стратегия: ассеты/шрифты — cache-first; данные — stale-while-revalidate;
// HTML/навигация — network-first (свежесть онлайн, кэш офлайн). Внешние (аудио CDN) не трогаем.
// Мусхаф: кэши mushaf-* (офлайн-загрузка из панели «Вид» и прочитанные страницы) переживают смену версии;
// шрифты страниц с verses.quran.foundation — из кэша; /mushaf/N без сети — сохранённая оболочка мусхафа,
// клиент сам дорисует нужную страницу по адресу.
const V = 'quran-v4-mushaf-reader';
const MUSHAF_RUNTIME = 'mushaf-runtime-v1';
const ASSET = /\/(assets|fonts)\//;
const DATA = /\/data\//;
const MUSHAF_DATA = /^\/data\/(mushaf-|ayah-text\/)/;
const MUSHAF_FONTS = 'https://verses.quran.foundation/fonts/quran/hafs/';
const MUSHAF_PAGE = /^\/mushaf\/\d+\/?$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== V && !k.startsWith('mushaf-')).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.href.startsWith(MUSHAF_FONTS)) {
    e.respondWith(mushafFirst(req));
    return;
  }
  if (url.origin !== self.location.origin) return; // аудио-CDN и прочие внешние — мимо
  if (/^\/(@|src\/|node_modules\/)/.test(url.pathname)) return; // модули dev-сервера Vite не кэшируем

  if (MUSHAF_DATA.test(url.pathname)) {
    e.respondWith(mushafFirst(req));
  } else if (ASSET.test(url.pathname)) {
    e.respondWith(cacheFirst(req));
  } else if (DATA.test(url.pathname)) {
    e.respondWith(staleWhileRevalidate(req));
  } else if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(networkFirst(req, url));
  } else {
    e.respondWith(cacheFirst(req));
  }
});

// страницы и шрифты мусхафа неизменны: из любого кэша, иначе из сети с записью в runtime-кэш
async function mushafFirst(req) {
  const hit = await caches.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(MUSHAF_RUNTIME)).put(req, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(V)).put(req, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}
async function networkFirst(req, url) {
  const c = await caches.open(V);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch {
    const hit = await caches.match(req, { ignoreVary: true });
    if (hit) return hit;
    if (MUSHAF_PAGE.test(url.pathname)) {
      const shell = (await caches.match('/mushaf/1', { ignoreVary: true })) || (await anyMushafPage());
      if (shell) return shell;
    }
    return (await c.match('/')) || Response.error();
  }
}
async function anyMushafPage() {
  for (const name of await caches.keys()) {
    const c = await caches.open(name);
    const key = (await c.keys()).find((r) => MUSHAF_PAGE.test(new URL(r.url).pathname));
    if (key) return c.match(key, { ignoreVary: true });
  }
  return undefined;
}
async function staleWhileRevalidate(req) {
  const c = await caches.open(V);
  const hit = await c.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || net;
}
