#!/usr/bin/env node
// Импорт постраничной раскладки мусхафа из api.quran.com v4 → data/<dir>/{1..604}.json.
//
//   node scripts/import-mushaf-pages.mjs v2   # мединский 1441 г. (QCF V2/V4, цветной таджвид) → data/mushaf-pages
//   node scripts/import-mushaf-pages.mjs v1   # мединский 1405 г. (QCF V1)                     → data/mushaf-pages-v1
//
// Формат страницы: {p, j, lines:[{n, w:[{c, k, e?}]}], starts:[{s, line}], deco:[{line, t:'surah'|'basmala', s}]}
//   c — глиф для пофайлового шрифта этой страницы, k — ключ аята, e — знак конца аята;
//   deco — строки с заголовком суры и басмалой (иногда стоят внизу предыдущей страницы).
//
// Страница и строка берутся у каждого СЛОВА, а не у аята: /verses/by_page отдаёт аяты по нумерации
// 1405 г., а в издании 1441 г. часть слов уже на соседней странице (например, 83:5–6 — на стр. 588).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EDITIONS = {
  v2: { mushaf: 1, field: 'code_v2', dir: 'mushaf-pages' },
  v1: { mushaf: 2, field: 'code_v1', dir: 'mushaf-pages-v1' },
};
const edition = EDITIONS[process.argv[2]];
if (!edition) {
  console.error('Использование: node scripts/import-mushaf-pages.mjs v2|v1');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', edition.dir);
const API = 'https://api.quran.com/api/v4/verses/by_page';
const PAGES = 604;
const LINES = 15;
mkdirSync(OUT, { recursive: true });

async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
}

async function fetchVerses(p) {
  const verses = [];
  for (let page = 1; ; page++) {
    const url =
      `${API}/${p}?words=true&word_fields=${edition.field},line_number,page_number` +
      `&per_page=50&page=${page}&mushaf=${edition.mushaf}`;
    const data = await getJson(url);
    verses.push(...data.verses);
    if (!data.pagination?.next_page) break;
  }
  return verses;
}

// 1. Все аяты всех страниц.
const verses = new Map();
const queue = Array.from({ length: PAGES }, (_, i) => i + 1);
let fetched = 0;
async function worker() {
  while (queue.length) {
    const p = queue.shift();
    for (const v of await fetchVerses(p)) verses.set(v.verse_key, v);
    if (++fetched % 100 === 0) console.log(`  ${fetched}/${PAGES}`);
  }
}
console.log(`→ ${process.argv[2]}: api.quran.com, mushaf=${edition.mushaf}…`);
await Promise.all(Array.from({ length: 4 }, worker));
if (verses.size !== 6236) throw new Error(`аятов ${verses.size}, ожидалось 6236`);

// 2. Слова → страница/строка по данным самого слова, в порядке чтения.
const ordered = [...verses.values()].sort((x, y) => {
  const [s1, a1] = x.verse_key.split(':').map(Number);
  const [s2, a2] = y.verse_key.split(':').map(Number);
  return s1 - s2 || a1 - a2;
});
const pages = Array.from({ length: PAGES + 1 }, (_, p) => ({ p, j: 0, lines: new Map(), starts: [] }));
let glyphs = 0;
let lastPage = 1;
let lastLine = 1;
const fixedMarkers = [];
for (const v of ordered) {
  const [s, a] = v.verse_key.split(':').map(Number);
  for (const w of [...v.words].sort((x, y) => x.position - y.position)) {
    const code = w[edition.field];
    let p = w.page_number;
    let n = w.line_number;
    if (!code || !p || !n) throw new Error(`${v.verse_key}#${w.position}: нет глифа/страницы/строки`);
    // Знак конца аята не может стоять выше последнего слова аята; в API так сбит 84:21 (строка 13 вместо 14).
    // Перенос знака в начало следующей строки — норма печатного мусхафа, его не трогаем.
    if (w.char_type_name === 'end' && w.position > 1 && (p < lastPage || (p === lastPage && n < lastLine))) {
      fixedMarkers.push(`${v.verse_key}: ${p}:${n} → ${lastPage}:${lastLine}`);
      p = lastPage;
      n = lastLine;
    }
    if (p < lastPage || (p === lastPage && n < lastLine) || n > LINES) {
      throw new Error(`${v.verse_key}#${w.position}: порядок строк нарушен (${lastPage}:${lastLine} → ${p}:${n})`);
    }
    lastPage = p;
    lastLine = n;
    const page = pages[p];
    if (a === 1 && w.position === 1) page.starts.push({ s, line: n });
    if (!page.lines.has(n)) page.lines.set(n, []);
    const word = { c: code, k: v.verse_key };
    if (w.char_type_name === 'end') word.e = 1;
    page.lines.get(n).push(word);
    glyphs++;
  }
}

// 3. Заголовок суры и басмала — строки перед первым аятом; если не влезают, уходят на конец прошлой страницы.
for (const page of pages.slice(1)) page.deco = [];
for (const page of pages.slice(1)) {
  for (const { s, line } of page.starts) {
    const rows = s === 1 || s === 9 ? ['surah'] : ['surah', 'basmala'];
    rows.forEach((t, i) => {
      let p = page.p;
      let n = line - rows.length + i;
      if (n < 1) {
        p -= 1;
        n += LINES;
      }
      const target = pages[p];
      if (!target || target.lines.has(n) || target.deco.some((d) => d.line === n)) {
        throw new Error(`стр. ${page.p}, сура ${s}: строка ${p}:${n} под ${t} занята`);
      }
      target.deco.push({ line: n, t, s });
    });
  }
}

// 4. Джузы: начало джуза — страница первого слова его первого аята; джуз страницы — последний начавшийся.
const juzStart = {};
for (const v of ordered) juzStart[v.juz_number] ??= v.words[0].page_number;
const pageJuz = {};
for (let p = 1, j = 1; p <= PAGES; p++) {
  while (juzStart[j + 1] && juzStart[j + 1] <= p) j++;
  pageJuz[p] = j;
  pages[p].j = j;
}

// 5. meta.json (общий для обоих изданий; SSR и клиент): начало суры — страница её первого аята.
if (process.argv[2] === 'v2') {
  const metaPath = join(OUT, 'meta.json');
  const old = JSON.parse(readFileSync(metaPath, 'utf8'));
  const suraStart = {};
  for (const v of ordered) {
    const [s, a] = v.verse_key.split(':').map(Number);
    if (a === 1) suraStart[s] = v.words[0].page_number;
  }
  const meta = {
    pages: PAGES,
    suraStart,
    juzStart,
    pageJuz,
    suraPages: old.suraPages.map((s) => ({ ...s, p: suraStart[s.n] })),
  };
  writeFileSync(metaPath, JSON.stringify(meta));
}

for (const page of pages.slice(1)) {
  const out = {
    p: page.p,
    j: page.j,
    lines: [...page.lines.entries()].sort((x, y) => x[0] - y[0]).map(([n, w]) => ({ n, w })),
    starts: page.starts,
    deco: page.deco.sort((x, y) => x.line - y.line),
  };
  writeFileSync(join(OUT, `${page.p}.json`), JSON.stringify(out));
}
if (fixedMarkers.length) console.log(`Знаки конца аята перенесены к последнему слову: ${fixedMarkers.join('; ')}`);
console.log(`Готово: ${PAGES} страниц, ${glyphs} глифов → data/${edition.dir}/`);
