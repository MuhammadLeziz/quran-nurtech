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
  /** число аятов */
  c?: number;
}

export const BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';

// Басмала над сурой — глифы аята 1:1 из шрифта страницы 1 того же издания (каллиграфия мусхафа, в 1441 г. с таджвидом).
export const BASMALA_GLYPHS: Record<MushafEdition, string> = { v4: 'ﱁﱂﱃﱄ', v1: 'ﭑﭒﭓﭔ' };
export const BASMALA_PAGE = 1;

// Название суры в заголовке — каллиграфический глиф шрифта QCF4_QBSML (quran-qcf4, public/fonts/qcf4): U+F100 + сура − 1.
export const SURAH_NAME_FONT_URL = '/fonts/qcf4/QCF4_QBSML.woff2';
export const surahNameGlyph = (s: number) => String.fromCodePoint(0xf100 + s - 1);

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

/** @font-face + палитры для одной страницы. Тема — :root[data-theme], таджвид — :root[data-mushaf-tajweed].
 *  Шрифт страницы 1 заодно рисует басмалу над сурами на любой странице (.qcf-basmala). */
export function pageFontCss(edition: MushafEdition, page: number): string {
  const n = clampPage(page);
  const family = fontFamily(edition, n);
  const targets = [`.qcf-page[data-mushaf-page="${n}"][data-edition="${edition}"]`];
  if (n === BASMALA_PAGE) targets.push(`.qcf-basmala[data-edition="${edition}"]`);
  const at = (prefix: string) => targets.map((t) => `${prefix}${t}`).join(',');
  const face = `@font-face{font-family:'${family}';src:url('${fontUrl(edition, n)}') format('woff2');font-display:block;}`;
  if (edition === 'v1') return `${face}\n${at('')}{--mushaf-page-font:'${family}';}`;

  const pal = (i: number) => `--mushaf-${n}-${i}`;
  const rules = [face];
  for (let i = 0; i < 6; i++) rules.push(`@font-palette-values ${pal(i)}{font-family:'${family}';base-palette:${i};}`);
  rules.push(`${at('')}{--mushaf-page-font:'${family}';font-palette:${pal(PALETTES.light)};}`);
  rules.push(`${at(':root[data-mushaf-tajweed="off"] ')}{font-palette:${pal(PALETTES.light + PLAIN)};}`);
  for (const theme of ['dark', 'sepia'] as const) {
    const i = PALETTES[theme];
    rules.push(`${at(`:root[data-theme="${theme}"] `)}{font-palette:${pal(i)};}`);
    rules.push(`${at(`:root[data-theme="${theme}"][data-mushaf-tajweed="off"] `)}{font-palette:${pal(i + PLAIN)};}`);
  }
  rules.push(
    `@media (prefers-color-scheme: dark){${at(':root:not([data-theme]) ')}{font-palette:${pal(PALETTES.dark)};}` +
      `${at(':root:not([data-theme])[data-mushaf-tajweed="off"] ')}{font-palette:${pal(PALETTES.dark + PLAIN)};}}`
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

const BOOKMARK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>';

/** Страница рисует басмалу над сурой — ей нужен ещё шрифт страницы 1. */
export const pageHasBasmala = (page: MushafPage) => (page.deco || []).some((d) => d.t === 'basmala');

/** HTML листа страницы: колонтитул (джуз · сура · закладка, как в Sajda), 15 строк, номер страницы. */
export function renderSheetHtml(page: MushafPage, opts: SheetOptions): string {
  const n = page.p;
  const info = (s: number) => opts.surahs.find((x) => x.n === s);
  const first = pageSurahs(page)[0] ?? page.deco?.[0]?.s ?? 1;
  const lines = pageLines(page)
    .map((line) => {
      if (line.kind === 'surah') {
        // заголовок суры как в печатном мусхафе: каллиграфия названия в рамке, медальоны «порядок» и «число аятов»
        const s = info(line.surah);
        const label = `${s?.na || `سورة ${line.surah}`} — сура ${line.surah}${s ? `, ${s.nr}` : ''}`;
        const medal = (title: string, value?: number) =>
          `<span class="qcf-surah-medal" aria-hidden="true"><i>${title}</i><b>${value ? toArabicDigits(value) : ''}</b></span>`;
        return (
          `<div class="qcf-line qcf-line-deco qcf-surah-line" data-line="${line.n}">` +
          `<span class="qcf-surah-frame" role="heading" aria-level="2" aria-label="${esc(label)}">` +
          medal('ترتيبها', line.surah) +
          `<span class="qcf-surah-name" aria-hidden="true">${surahNameGlyph(line.surah)}</span>` +
          medal('آياتها', s?.c) +
          `</span></div>`
        );
      }
      if (line.kind === 'basmala')
        return (
          `<div class="qcf-line qcf-line-deco qcf-basmala-line" data-line="${line.n}">` +
          `<span class="qcf-basmala" data-edition="${opts.edition}" aria-label="${BASMALA}">${BASMALA_GLYPHS[opts.edition]}</span></div>`
        );
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
    `<header class="mushaf-meta"><span class="mushaf-meta-juz">Джуз ${page.j}</span>` +
    `<span class="mushaf-meta-surah">${esc(info(first)?.nr || `Сура ${first}`)}</span>` +
    `<button type="button" class="mushaf-meta-bm" data-mushaf-bookmark aria-pressed="false" aria-label="Закладка на странице" title="Закладка на странице">${BOOKMARK_SVG}</button></header>` +
    `<div class="qcf-page${n <= 2 ? ' is-opening' : ''}" dir="rtl" data-mushaf-page="${n}" data-edition="${opts.edition}">${lines}</div>` +
    `<footer class="mushaf-folio">${n}</footer>` +
    `<div class="mushaf-sheet-status" role="status" hidden><span>Не удалось загрузить шрифт страницы.</span>` +
    `<button type="button" class="btn" data-mushaf-retry>Повторить</button></div>` +
    `</section>`
  );
}
