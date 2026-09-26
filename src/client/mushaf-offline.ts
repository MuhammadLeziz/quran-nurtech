// Мусхаф без интернета: страницы, шрифты и переводы выбранного издания — в Cache API.
// public/sw.js отдаёт их из этого кэша (и ищет там же страницу-оболочку /mushaf/N для офлайн-перехода).
import { fontUrl, MUSHAF_TOTAL_PAGES, type MushafEdition } from '../lib/mushaf-layout';
import { AYAH_PAGES_URL, META_URL, pageUrl } from './mushaf-data';
import { DV } from './quran-data';
import { LS } from './shared';

export const OFFLINE_CACHE = 'mushaf-offline-v1';
const STATE_KEY = 'q_mushaf_offline';
const PARALLEL = 6;

export interface OfflineState {
  done: number;
  total: number;
  bytes: number;
  at?: number;
}

const pages = Array.from({ length: MUSHAF_TOTAL_PAGES }, (_, i) => i + 1);

function editionUrls(edition: MushafEdition): string[] {
  return [...pages.map((p) => pageUrl(edition, p)), ...pages.map((p) => fontUrl(edition, p))];
}

/** Оболочка страницы: HTML, стили, скрипты, шрифты интерфейса, данные для шторки аята. */
function shellUrls(): string[] {
  const own = (u: string | null) => (u && u.startsWith(location.origin) ? u.slice(location.origin.length) : u);
  const assets = [
    ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"], link[rel="modulepreload"], link[rel="preload"]')).map(
      (l) => own(l.href)
    ),
    ...Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).map((s) => own(s.src)),
    // чанки, которые подтянули модули страницы (в разметке их нет), шрифты интерфейса
    ...performance
      .getEntriesByType('resource')
      .map((e) => own(e.name))
      .filter((u) => !!u && /^\/(assets|fonts)\//.test(u)),
  ].filter((u): u is string => !!u && u.startsWith('/'));
  return [
    '/mushaf/1',
    '/mushaf',
    META_URL,
    AYAH_PAGES_URL,
    `/data/index.json?v=${DV}`,
    ...Array.from({ length: 114 }, (_, i) => `/data/ayah-text/${i + 1}.json`),
    ...assets,
  ];
}

export const supported = () => 'caches' in window && 'serviceWorker' in navigator;

export const getOfflineState = (edition: MushafEdition) =>
  LS.get<Partial<Record<MushafEdition, OfflineState>>>(STATE_KEY, {})[edition] || null;

function saveState(edition: MushafEdition, state: OfflineState | null) {
  const all = LS.get<Partial<Record<MushafEdition, OfflineState>>>(STATE_KEY, {});
  if (state) all[edition] = state;
  else delete all[edition];
  LS.set(STATE_KEY, all);
}

/** Сколько файлов издания уже в кэше (для «Скачано 604 из 604»). */
export async function countCached(edition: MushafEdition): Promise<number> {
  if (!supported()) return 0;
  const cache = await caches.open(OFFLINE_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  return editionUrls(edition).filter((u) => have.has(new URL(u, location.origin).href)).length;
}

export async function downloadMushaf(
  edition: MushafEdition,
  onProgress: (s: OfflineState) => void,
  signal: AbortSignal
): Promise<OfflineState> {
  const cache = await caches.open(OFFLINE_CACHE);
  try {
    await (navigator.storage as any)?.persist?.();
  } catch {}
  const urls = [...new Set([...shellUrls(), ...editionUrls(edition)])];
  const state: OfflineState = { done: 0, total: urls.length, bytes: getOfflineState(edition)?.bytes || 0 };
  let failed = 0;
  let next = 0;
  const report = () => onProgress({ ...state });

  async function worker() {
    while (next < urls.length && !signal.aborted) {
      const url = urls[next++];
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { signal, mode: url.startsWith('http') ? 'cors' : 'same-origin' });
          if (!res.ok) throw new Error(String(res.status));
          const size = Number(res.headers.get('content-length')) || (await res.clone().blob()).size;
          await cache.put(url, res);
          state.bytes += size;
        }
      } catch (e) {
        if (signal.aborted) return;
        failed++;
      }
      state.done++;
      if (state.done % 8 === 0 || state.done === state.total) report();
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  state.at = Date.now();
  saveState(edition, state);
  report();
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  if (failed) throw new Error(`Не скачалось файлов: ${failed}`);
  return state;
}

export async function removeMushaf(edition: MushafEdition) {
  if (!supported()) return;
  const cache = await caches.open(OFFLINE_CACHE);
  const drop = new Set(editionUrls(edition).map((u) => new URL(u, location.origin).href));
  await Promise.all((await cache.keys()).filter((r) => drop.has(r.url)).map((r) => cache.delete(r)));
  saveState(edition, null);
  const other: MushafEdition = edition === 'v4' ? 'v1' : 'v4';
  if (!getOfflineState(other)) await caches.delete(OFFLINE_CACHE);
}

export const formatMb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1)} МБ`;
