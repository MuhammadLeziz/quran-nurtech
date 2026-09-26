// Мусхаф: настройки и место чтения в localStorage (без регистрации, как остальной сайт).
import type { MushafEdition } from '../lib/mushaf-layout';
import { LS } from './shared';

export const MK = {
  edition: 'q_mushaf_edition',
  tajweed: 'q_mushaf_tajweed',
  zoom: 'q_mushaf_zoom',
  last: 'q_mushaf_last',
  bookmarks: 'q_mushaf_bm',
  tr: 'q_mushaf_tr',
  immersive: 'q_mushaf_reader', // sessionStorage
};

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2.5;

export const getEdition = (): MushafEdition => (LS.get<string>(MK.edition, 'v4') === 'v1' ? 'v1' : 'v4');
export const setEdition = (e: MushafEdition) => LS.set(MK.edition, e);

export const getTajweed = () => LS.get<boolean>(MK.tajweed, true) !== false;
export const setTajweed = (on: boolean) => LS.set(MK.tajweed, on);

export function getZoom(): number {
  const z = Number(LS.get<number>(MK.zoom, 1));
  return z >= ZOOM_MIN && z <= ZOOM_MAX ? z : 1;
}
export const setZoom = (z: number) => LS.set(MK.zoom, Math.round(z * 100) / 100);

export interface LastPage {
  p: number;
  t: number;
}
export const getLastPage = () => LS.get<LastPage | null>(MK.last, null);
export const rememberPage = (p: number) => LS.set(MK.last, { p, t: Date.now() });

export interface PageBookmark {
  p: number;
  t: number;
}
export const getPageBookmarks = () => LS.get<PageBookmark[]>(MK.bookmarks, []);
export const isPageBookmarked = (p: number) => getPageBookmarks().some((b) => b.p === p);

export function togglePageBookmark(p: number): boolean {
  const list = getPageBookmarks();
  const i = list.findIndex((b) => b.p === p);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ p, t: Date.now() });
  LS.set(MK.bookmarks, list);
  return i < 0;
}

export const removePageBookmark = (p: number) =>
  LS.set(
    MK.bookmarks,
    getPageBookmarks().filter((b) => b.p !== p)
  );

/** Ссылки «Мусхаф» в меню и таб-баре открывают страницу, на которой читатель остановился. */
export function initMushafLinks() {
  const last = getLastPage();
  if (!last || last.p <= 1) return;
  document
    .querySelectorAll<HTMLAnchorElement>(
      '.mobile-tabbar a[href="/mushaf/1"], .drawer a[href="/mushaf/1"], .topbar a[href="/mushaf/1"], .footer a[href="/mushaf/1"]'
    )
    .forEach((a) => {
      a.href = `/mushaf/${last.p}`;
    });
}
