// Разметка страницы мусхафа — общая для SSR (src/pages/mushaf/[page].astro) и клиента
// (src/client/mushaf-*.ts), чтобы страница, дорисованная при листании, совпадала с серверной.
// Без node-зависимостей: модуль попадает в клиентский бандл.

export const MUSHAF_TOTAL_PAGES = 604;
export const MUSHAF_LINES = 15;

/** v4 — мединский 1441 г. (QCF V2-глифы, шрифты V4 с цветным таджвидом), v1 — мединский 1405 г. */
export type MushafEdition = 'v4' | 'v1';
export const MUSHAF_EDITIONS: MushafEdition[] = ['v4', 'v1'];

export interface MushafPageWord {
  c: string;
  k: string;
  e?: 1;
}

export interface MushafPageLine {
  n: number;
  w: MushafPageWord[];
}

export interface MushafPageStart {
  s: number;
  line: number;
}

export interface MushafPageDeco {
  line: number;
  t: 'surah' | 'basmala';
  s: number;
}

export interface MushafPage {
  p: number;
  j: number;
  lines: MushafPageLine[];
  starts?: MushafPageStart[];
  deco?: MushafPageDeco[];
}

export interface MushafSurahInfo {
  n: number;
  nr: string;
  na: string;
  p: number;
}

export const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';

const FONT_ROOT = 'https://verses.quran.foundation/fonts/quran/hafs';

export const clampPage = (n: number) => Math.max(1, Math.min(MUSHAF_TOTAL_PAGES, Math.trunc(n) || 1));

/** Каталог JSON-страниц издания в public/data. */
export const pageDataDir = (edition: MushafEdition) => (edition === 'v1' ? 'mushaf-pages-v1' : 'mushaf-pages');

export const fontFamily = (edition: MushafEdition, page: number) =>
  `${edition === 'v1' ? 'MushafV1P' : 'MushafTajweed'}${clampPage(page)}`;

export const fontUrl = (edition: MushafEdition, page: number) =>
  edition === 'v1'
    ? `${FONT_ROOT}/v1/woff2/p${clampPage(page)}.woff2`
    : `${FONT_ROOT}/v4/colrv1/woff2/p${clampPage(page)}.woff2`;

// Палитры CPAL в шрифтах V4: 0–2 — цветной таджвид (светлая/тёмная/сепия), 3–5 — те же темы без таджвида.
const PALETTES = { light: 0, dark: 1, sepia: 2 } as const;
const PLAIN = 3;

/** @font-face + палитры для одной страницы. Тема — :root[data-theme], таджвид — :root[data-mushaf-tajweed]. */
export function pageFontCss(edition: MushafEdition, page: number): string {
  const n = clampPage(page);
  const family = fontFamily(edition, n);
  const sel = `.qcf-page[data-mushaf-page="${n}"][data-edition="${edition}"]`;
  const face = `@font-face{font-family:'${family}';src:url('${fontUrl(edition, n)}') format('woff2');font-display:block;}`;
  if (edition === 'v1') return `${face}\n${sel}{--mushaf-page-font:'${family}';}`;

  const pal = (i: number) => `--mushaf-${n}-${i}`;
  const rules = [face];
  for (let i = 0; i < 6; i++) rules.push(`@font-palette-values ${pal(i)}{font-family:'${family}';base-palette:${i};}`);
  rules.push(`${sel}{--mushaf-page-font:'${family}';font-palette:${pal(PALETTES.light)};}`);
  rules.push(`:root[data-mushaf-tajweed="off"] ${sel}{font-palette:${pal(PALETTES.light + PLAIN)};}`);
  for (const theme of ['dark', 'sepia'] as const) {
    const i = PALETTES[theme];
    rules.push(`:root[data-theme="${theme}"] ${sel}{font-palette:${pal(i)};}`);
    rules.push(`:root[data-theme="${theme}"][data-mushaf-tajweed="off"] ${sel}{font-palette:${pal(i + PLAIN)};}`);
  }
  rules.push(
    `@media (prefers-color-scheme: dark){:root:not([data-theme]) ${sel}{font-palette:${pal(PALETTES.dark)};}` +
      `:root:not([data-theme])[data-mushaf-tajweed="off"] ${sel}{font-palette:${pal(PALETTES.dark + PLAIN)};}}`
  );
  return rules.join('\n');
}

export type MushafLine =
  | { n: number; kind: 'surah'; surah: number }
  | { n: number; kind: 'basmala'; surah: number }
  | { n: number; kind: 'words'; words: MushafPageWord[]; center: boolean }
  | { n: number; kind: 'empty' };

/** 15 строк страницы: слова, заголовки сур, басмала и пустые строки. */
export function pageLines(page: MushafPage): MushafLine[] {
  const byNumber = new Map(page.lines.map((line) => [line.n, line]));
  const deco = new Map((page.deco || []).map((d) => [d.line, d]));
  // Строки мусхафа выключены по ширине; первые две страницы — короткие центрированные строки.
  // Прочие короткие строки клиент центрирует после замера (mushaf-reader.ts, fitSheet).
  const center = page.p <= 2;
  const lines: MushafLine[] = [];
  for (let n = 1; n <= MUSHAF_LINES; n++) {
    const d = deco.get(n);
    const line = byNumber.get(n);
    if (d) lines.push({ n, kind: d.t, surah: d.s });
    else if (line) lines.push({ n, kind: 'words', words: line.w, center });
    else lines.push({ n, kind: 'empty' });
  }
  return lines;
}

/** Суры на странице (по словам), в порядке появления. */
export function pageSurahs(page: MushafPage): number[] {
  const out: number[] = [];
  for (const line of page.lines)
    for (const w of line.w) {
      const s = Number(w.k.split(':')[0]);
      if (!out.includes(s)) out.push(s);
    }
  return out;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);

export interface SheetOptions {
  edition: MushafEdition;
  surahs: MushafSurahInfo[];
  /** Состояние загрузки шрифта: SSR рисует скелетон, клиент снимает его после загрузки. */
  state?: 'loading' | 'ready';
}

/** HTML листа страницы: колонтитул, 15 строк, номер страницы. */
export function renderSheetHtml(page: MushafPage, opts: SheetOptions): string {
  const n = page.p;
  const surahName = (s: number) => opts.surahs.find((x) => x.n === s)?.na || `سورة ${s}`;
  const names = pageSurahs(page).map(surahName);
  const lines = pageLines(page)
    .map((line) => {
      if (line.kind === 'surah')
        return `<div class="qcf-line qcf-line-deco qcf-surah-line" data-line="${line.n}"><span class="qcf-surah-title">${esc(surahName(line.surah))}</span></div>`;
      if (line.kind === 'basmala')
        return `<div class="qcf-line qcf-line-deco qcf-basmala-line" data-line="${line.n}"><span class="qcf-basmala">${BASMALA}</span></div>`;
      if (line.kind === 'empty') return `<div class="qcf-line is-empty" data-line="${line.n}"></div>`;
      const words = line.words
        .map(
          (w) =>
            `<span class="qcf-word${w.e ? ' qcf-word-end' : ''}" data-ayah-key="${esc(w.k)}">${esc(w.c)}</span>`
        )
        .join('');
      return `<div class="qcf-line${line.center ? ' center' : ''}" data-line="${line.n}">${words}</div>`;
    })
    .join('');
  return (
    `<section class="mushaf-sheet" data-state="${opts.state || 'loading'}" data-page="${n}" aria-label="Страница ${n} мусхафа">` +
    `<header class="mushaf-meta"><span class="mushaf-meta-surah" dir="rtl">${esc(names.join(' · '))}</span>` +
    `<span class="mushaf-meta-juz">Джуз ${page.j}</span></header>` +
    `<div class="qcf-page" dir="rtl" data-mushaf-page="${n}" data-edition="${opts.edition}">${lines}</div>` +
    `<footer class="mushaf-folio">${toArabicDigits(n)}</footer>` +
    `<div class="mushaf-sheet-status" role="status" hidden><span>Не удалось загрузить шрифт страницы.</span>` +
    `<button type="button" class="btn" data-mushaf-retry>Повторить</button></div>` +
    `</section>`
  );
}
