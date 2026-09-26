// Мусхаф: данные страниц и пофайловые QCF-шрифты (загрузка, повтор, предзагрузка соседних страниц).
import {
  fontFamily,
  fontUrl,
  pageDataDir,
  pageFontCss,
  type MushafEdition,
  type MushafPage,
  type MushafSurahInfo,
} from '../lib/mushaf-layout';

export interface MushafMeta {
  suraStart: Record<string, number>;
  juzStart: Record<string, number>;
  pageJuz: Record<string, number>;
  suraPages: MushafSurahInfo[];
}

export type AyahPages = Record<MushafEdition, number[][]>;

const pages = new Map<string, Promise<MushafPage>>();
let metaP: Promise<MushafMeta> | null = null;
let ayahPagesP: Promise<AyahPages> | null = null;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return (await r.json()) as T;
}

export const pageUrl = (edition: MushafEdition, p: number) => `/data/${pageDataDir(edition)}/${p}.json`;
export const META_URL = '/data/mushaf-pages/meta.json';
export const AYAH_PAGES_URL = '/data/mushaf-ayahs.json';

export function loadPage(edition: MushafEdition, p: number): Promise<MushafPage> {
  const key = `${edition}:${p}`;
  let hit = pages.get(key);
  if (!hit) {
    hit = getJson<MushafPage>(pageUrl(edition, p));
    hit.catch(() => pages.delete(key));
    pages.set(key, hit);
  }
  return hit;
}

export function loadMeta(): Promise<MushafMeta> {
  metaP ||= getJson<MushafMeta>(META_URL);
  metaP.catch(() => (metaP = null));
  return metaP;
}

export function loadAyahPages(): Promise<AyahPages> {
  ayahPagesP ||= getJson<AyahPages>(AYAH_PAGES_URL);
  ayahPagesP.catch(() => (ayahPagesP = null));
  return ayahPagesP;
}


// ---- Шрифты ----
// Файл шрифта грузим через FontFace API: он надёжно стартует сразу (без ожидания разбора @font-face)
// и перекрывает CSS-face с тем же именем. @font-face в <style> остаётся ради палитр (@font-palette-values)
// и у SSR-страницы — инлайн, чтобы шрифт начал качаться ещё до скриптов (тот же URL — из HTTP-кэша).
const cssDone = new Set<string>();
const fontLoads = new Map<string, Promise<void>>();
let styleEl: HTMLStyleElement | null = null;

function ensureFontCss(edition: MushafEdition, p: number) {
  const key = `${edition}:${p}`;
  if (cssDone.has(key)) return;
  cssDone.add(key);
  styleEl ||= Object.assign(document.createElement('style'), { id: 'mushaf-font-css' });
  if (!styleEl.isConnected) document.head.appendChild(styleEl);
  styleEl.appendChild(document.createTextNode(pageFontCss(edition, p) + '\n'));
}

/** Шрифт страницы уже загружен (свой FontFace или CSS-face SSR-страницы). */
export function fontReady(edition: MushafEdition, p: number): boolean {
  const family = fontFamily(edition, p);
  for (const face of document.fonts) {
    if (face.status === 'loaded' && face.family.replace(/["']/g, '') === family) return true;
  }
  return false;
}

/** Грузит шрифт страницы. Ошибку не кэширует: следующий вызов (retry) — новая попытка мимо кэша. */
export function loadFont(edition: MushafEdition, p: number, retry = false): Promise<void> {
  const key = `${edition}:${p}`;
  ensureFontCss(edition, p);
  let hit = fontLoads.get(key);
  if (hit && !retry) return hit;
  const url = fontUrl(edition, p) + (retry ? `?r=${Date.now()}` : '');
  const face = new FontFace(fontFamily(edition, p), `url(${url}) format('woff2')`, { display: 'block' });
  document.fonts.add(face);
  hit = face.load().then(() => undefined);
  hit.catch(() => {
    fontLoads.delete(key);
    document.fonts.delete(face);
  });
  fontLoads.set(key, hit);
  return hit;
}

/** Данные + шрифт страницы в фоне (для следующих страниц по ходу чтения). */
export function prefetchPage(edition: MushafEdition, p: number) {
  if (p < 1 || p > 604) return;
  loadPage(edition, p).catch(() => {});
  loadFont(edition, p).catch(() => {});
}
