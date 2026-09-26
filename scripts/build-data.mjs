#!/usr/bin/env node
// Готовит public/data/ из vendored-датасета в data/:
//   - index.json       — метаданные 114 сур (+ slug для быстрого перехода)
//   - search-index.json — {s,a,r} по всем 6236 аятам (русский текст Кулиева) для клиентского поиска
//   - reciters.json    — список чтецов (EveryAyah folders)
// Источник текста/тафсира: data/quran/*.json, data/tafsir/*.json (см. /about — источники).
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');
const OUT = join(ROOT, 'public', 'data');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const copyCleanDir = (from, to, filter = () => true) => {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  let copied = 0;
  for (const file of readdirSync(from)) {
    if (!filter(file)) continue;
    copyFileSync(join(from, file), join(to, file));
    copied++;
  }
  return copied;
};

// slug из транслит-названия: "Al-Faatiha" -> "al-faatiha"
const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/['`ʼʾ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// ---- 1. индекс сур ----
const index = readJson(join(DATA, 'quran', 'index.json'));
const surahs = index.map((s) => ({
  n: s.n,
  na: s.na, // арабское название
  ne: s.ne, // транслит
  nr: s.nr, // русское название
  nm: s.nm, // перевод названия
  t: s.t, // мекканская/мединская
  c: s.c, // число аятов
  slug: slugify(s.ne),
}));
writeFileSync(join(OUT, 'index.json'), JSON.stringify(surahs));

// ---- 2. поисковый индекс (русский текст) ----
// Полный поиск: по Кулиеву(r), Абу Аделю(aa), транслиту(tl), арабскому(ar).
const searchIndex = [];
let totalAyahs = 0;
const juzIndex = []; // первый аят каждого джуза (для навигации по мусхафу)
const seenJuz = new Set();
for (const s of surahs) {
  const surah = readJson(join(DATA, 'quran', `${s.n}.json`));
  for (const ayah of surah.a) {
    totalAyahs++;
    searchIndex.push({
      s: s.n,
      a: ayah.n,
      r: ayah.ru,
      aa: ayah.aa || '',
      tl: ayah.tl || '',
      ar: ayah.ar || '',
    });
    if (ayah.j && !seenJuz.has(ayah.j)) {
      seenJuz.add(ayah.j);
      juzIndex.push({ j: ayah.j, s: s.n, a: ayah.n, sr: s.nr, p: ayah.p });
    }
  }
}
writeFileSync(join(OUT, 'search-index.json'), JSON.stringify(searchIndex));
// Текст аятов по сурам — для шторки аята в мусхафе (не тянуть весь 6-МБ поисковый индекс ради одного аята).
const ayahTextOut = join(OUT, 'ayah-text');
rmSync(ayahTextOut, { recursive: true, force: true });
mkdirSync(ayahTextOut, { recursive: true });
for (const s of surahs) {
  const rows = searchIndex.filter((x) => x.s === s.n).map(({ a, r, aa, tl, ar }) => ({ a, r, aa, tl, ar }));
  writeFileSync(join(ayahTextOut, `${s.n}.json`), JSON.stringify(rows));
}
juzIndex.sort((x, y) => x.j - y.j);
writeFileSync(join(OUT, 'juz.json'), JSON.stringify(juzIndex));

// ---- 3. чтецы ----
// Аудио: основной источник — Cloudflare CDN islamic.network (надёжен глобально, вкл. РФ):
//   https://cdn.islamic.network/quran/audio/<br>/<ed>/<globalAyah 1..6236>.mp3
// Фолбэк при ошибке — EveryAyah: https://everyayah.com/data/<ea>/<SSS><AAA>.mp3
// Битрейт (br) у каждой редакции свой — проверено, что файлы существуют.
const reciters = [
  { id: 'alafasy', name: 'Мишари Рашид аль-Афаси', ed: 'ar.alafasy', br: 128, ea: 'Alafasy_128kbps' },
  { id: 'husary', name: 'Махмуд Халиль аль-Хусари', ed: 'ar.husary', br: 128, ea: 'Husary_128kbps' },
  { id: 'minshawi', name: 'Мухаммад Сиддик аль-Миншави', ed: 'ar.minshawi', br: 128, ea: 'Minshawy_Murattal_128kbps' },
  { id: 'sudais', name: 'Абдуррахман ас-Судайс', ed: 'ar.abdurrahmaansudais', br: 192, ea: 'Abdurrahmaan_As-Sudais_192kbps' },
  { id: 'abdulbasit', name: 'Абдуль-Басит Абдус-Самад', ed: 'ar.abdulbasitmurattal', br: 192, ea: 'Abdul_Basit_Murattal_192kbps' },
  { id: 'shuraim', name: 'Сауд аш-Шурейм', ed: 'ar.saoodshuraym', br: 64, ea: 'Saood_ash-Shuraym_128kbps' },
  { id: 'shatri', name: 'Абубакр аш-Шатри', ed: 'ar.shaatree', br: 128, ea: 'Abu_Bakr_Ash-Shaatree_128kbps' },
  { id: 'maher', name: 'Махер аль-Муайкли', ed: 'ar.mahermuaiqly', br: 128, ea: 'MaherAlMuaiqly128kbps' },
  { id: 'hudhaify', name: 'Али аль-Хузейфи', ed: 'ar.hudhaify', br: 128, ea: 'Hudhaify_128kbps' },
  { id: 'ayyoub', name: 'Мухаммад Айюб', ed: 'ar.muhammadayyoub', br: 128, ea: 'Muhammad_Ayyoub_128kbps' },
  // Расширенный список чтецов EveryAyah (папки проверены — аудио отдаётся 200).
  { id: 'juhaynee', name: 'Абдуллах Авад аль-Джухани', ea: 'Abdullaah_3awwaad_Al-Juhaynee_128kbps' },
  { id: 'basfar', name: 'Абдуллах Басфар', ea: 'Abdullah_Basfar_192kbps' },
  { id: 'matroud', name: 'Абдуллах Матруд', ea: 'Abdullah_Matroud_128kbps' },
  { id: 'ajamy', name: 'Ахмад ибн Али аль-Аджами', ea: 'ahmed_ibn_ali_al_ajamy_128kbps' },
  { id: 'neana', name: 'Ахмад Неана', ea: 'Ahmed_Neana_128kbps' },
  { id: 'alaqimy', name: 'Акрам аль-Алаими', ea: 'Akram_AlAlaqimy_128kbps' },
  { id: 'suesy', name: 'Али Хаджадж ас-Суэйси', ea: 'Ali_Hajjaj_AlSuesy_128kbps' },
  { id: 'alijaber', name: 'Али Джабер', ea: 'Ali_Jaber_64kbps' },
  { id: 'sowaid', name: 'Айман Сувейд', ea: 'Ayman_Sowaid_64kbps' },
  { id: 'abbad', name: 'Фарес Аббад', ea: 'Fares_Abbad_64kbps' },
  { id: 'ghamadi', name: 'Саад аль-Гамиди', ea: 'Ghamadi_40kbps' },
  { id: 'hanirifai', name: 'Хани ар-Рифаи', ea: 'Hani_Rifai_192kbps' },
  { id: 'akhdar', name: 'Ибрахим аль-Ахдар', ea: 'Ibrahim_Akhdar_32kbps' },
  { id: 'qahtani', name: 'Халид аль-Кахтани', ea: 'Khaalid_Abdullaah_al-Qahtaanee_192kbps' },
  { id: 'tablaway', name: 'Мухаммад ат-Таблави', ea: 'Mohammad_al_Tablaway_128kbps' },
  { id: 'abdulkareem', name: 'Мухаммад Абдуль-Карим', ea: 'Muhammad_AbdulKareem_128kbps' },
  { id: 'jibreel', name: 'Мухаммад Джибриль', ea: 'Muhammad_Jibreel_128kbps' },
  { id: 'muhsin', name: 'Мухсин аль-Касим', ea: 'Muhsin_Al_Qasim_192kbps' },
  { id: 'mustafa', name: 'Мустафа Исмаил', ea: 'Mustafa_Ismail_48kbps' },
  { id: 'nabil', name: 'Набиль ар-Рифаи', ea: 'Nabil_Rifa3i_48kbps' },
  { id: 'qatami', name: 'Насер аль-Катами', ea: 'Nasser_Alqatami_128kbps' },
  { id: 'sahl', name: 'Сахль Ясин', ea: 'Sahl_Yassin_128kbps' },
  { id: 'bukhatir', name: 'Салах аль-Бухатир', ea: 'Salaah_AbdulRahman_Bukhatir_128kbps' },
  { id: 'budair', name: 'Салах аль-Будейр', ea: 'Salah_Al_Budair_128kbps' },
  { id: 'yasersalamah', name: 'Ясер Саляма', ea: 'Yaser_Salamah_128kbps' },
  { id: 'dussary', name: 'Яссер ад-Дуссари', ea: 'Yasser_Ad-Dussary_128kbps' },
  { id: 'alili', name: 'Азиз Алили', ea: 'aziz_alili_128kbps' },
  { id: 'tunaiji', name: 'Халифа ат-Тунайджи', ea: 'khalefa_al_tunaiji_64kbps' },
  { id: 'banna', name: 'Махмуд Али аль-Банна', ea: 'mahmoud_ali_al_banna_32kbps' },
  { id: 'husary_muj', name: 'Махмуд Халиль аль-Хусари · муджаввад', ea: 'Husary_128kbps_Mujawwad' },
  { id: 'minshawi_muj', name: 'Мухаммад аль-Миншави · муджаввад', ea: 'Minshawy_Mujawwad_192kbps' },
  { id: 'abdulbasit_muj', name: 'Абдуль-Басит Абдус-Самад · муджаввад', ea: 'Abdul_Basit_Mujawwad_128kbps' },
  // По-суровые чтецы (mp3quran.net): целая сура одним файлом <srv>/<NNN>.mp3.
  // skip — суры, которых у чтеца нет (не читал/не записаны) → фолбэк на чтеца по умолчанию.
  {
    id: 'binhumaid',
    name: 'Ахмад Талиб бин Хумайд',
    type: 'surah',
    srv: 'https://server16.mp3quran.net/a_binhameed/Rewayat-Hafs-A-n-Assem/',
    skip: [9, 14, 16, 17, 23, 24, 33],
  },
  {
    id: 'souilass',
    name: 'Юнус ас-Сувейлис · Марокко (Варш)',
    type: 'surah',
    srv: 'https://server16.mp3quran.net/souilass/Rewayat-Warsh-A-n-Nafi/',
    skip: [
      3, 4, 5, 6, 7, 8, 9, 44, 49, 55, 58, 59, 60, 61, 62, 63, 64, 65, 66, 68, 69, 70, 72, 74, 75,
      83, 84, 85, 87, 88, 92, 94, 96, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
      111, 113, 114,
    ],
  },
];
writeFileSync(join(OUT, 'reciters.json'), JSON.stringify(reciters));

// ---- 4. тафсиры для ленивой подгрузки на клиенте (по одной суре за запрос) ----
// Тексты объёмные (ас-Саади ~14МБ, Ибн Касир ~15МБ), поэтому НЕ инлайним в HTML,
// а отдаём по /data/tafsir/<n>.json и /data/tafsir-ibnkathir/<n>.json (nginx их гзипит).
const tafsirOut = join(OUT, 'tafsir-saadi');
const ikOut = join(OUT, 'tafsir-ibnkathir');
const tajOut = join(OUT, 'tajweed'); // таджвид по-аятно [{a,h}] для ленивой подгрузки
if (!existsSync(tafsirOut)) mkdirSync(tafsirOut, { recursive: true });
if (!existsSync(ikOut)) mkdirSync(ikOut, { recursive: true });
if (!existsSync(tajOut)) mkdirSync(tajOut, { recursive: true });
let tafsirFiles = 0;
for (const s of surahs) {
  const sd = join(DATA, 'tafsir-saadi', `${s.n}.json`); // ас-Саади по-аятно [{a,x}]
  if (existsSync(sd)) {
    copyFileSync(sd, join(tafsirOut, `${s.n}.json`));
    tafsirFiles++;
  }
  const ikp = join(DATA, 'tafsir-ibnkathir', `${s.n}.json`);
  if (existsSync(ikp)) {
    copyFileSync(ikp, join(ikOut, `${s.n}.json`));
    tafsirFiles++;
  }
  const tjp = join(DATA, 'tajweed', `${s.n}.json`);
  if (existsSync(tjp)) {
    copyFileSync(tjp, join(tajOut, `${s.n}.json`));
    tafsirFiles++;
  }
}

// ---- 5. QCF4-мусхаф (оригинальные глифы, 604 страницы, пословная разметка) ----
// quran-qcf4 хранит 604 page JSON + 47 сгруппированных QCF4 Hafs-шрифтов и BSML.
// Шрифты не коммитим в репозиторий: они подтягиваются из npm и копируются в public перед сборкой.
const qcfRoot = join(ROOT, 'node_modules', 'quran-qcf4');
if (!existsSync(qcfRoot)) {
  throw new Error('[build-data] quran-qcf4 не найден. Выполните npm install перед сборкой.');
}
const qcfOut = join(OUT, 'qcf4');
mkdirSync(qcfOut, { recursive: true });
const qcfPages = copyCleanDir(join(qcfRoot, 'pages'), join(qcfOut, 'pages'), (f) => /\.json$/.test(f));
copyFileSync(join(qcfRoot, 'index.json'), join(qcfOut, 'index.json'));
copyFileSync(join(qcfRoot, 'verses.json'), join(qcfOut, 'verses.json'));
const qcfFonts = copyCleanDir(
  join(qcfRoot, 'fonts-woff2'),
  join(ROOT, 'public', 'fonts', 'qcf4'),
  (f) => /\.woff2$/.test(f)
);
if (qcfPages !== 604 || qcfFonts !== 48) {
  throw new Error(`[build-data] QCF4 неполный набор: pages=${qcfPages}, fonts=${qcfFonts}`);
}

// ---- 6. QCF V2/V4 page layout для цветного таджвид-мусхафа ----
// Эти page JSON содержат code_v2-глифы, совместимые с пофайловыми QCF V2/V4 шрифтами Quran Foundation.
const mushafPagesSrc = join(DATA, 'mushaf-pages');
if (!existsSync(mushafPagesSrc)) {
  throw new Error('[build-data] data/mushaf-pages не найден. Нужны 604 страницы + meta.json для таджвид-мусхафа.');
}
const mushafPages = copyCleanDir(mushafPagesSrc, join(OUT, 'mushaf-pages'), (f) => /\.json$/.test(f));
if (mushafPages !== 605) {
  throw new Error(`[build-data] QCF V2/V4 неполный набор страниц: ${mushafPages}`);
}

// ---- 7. Мединский мусхаф 1405 г. (QCF V1) — второй стиль вёрстки ----
// data/mushaf-pages-v1 генерится scripts/import-mushaf-pages.mjs v1, формат как у mushaf-pages.
const mushafV1Pages = copyCleanDir(join(DATA, 'mushaf-pages-v1'), join(OUT, 'mushaf-pages-v1'), (f) => /\.json$/.test(f));
if (mushafV1Pages !== 604) {
  throw new Error(`[build-data] QCF V1 неполный набор страниц: ${mushafV1Pages}`);
}

// ---- 8. Аят → страница для перехода «2:255» в мусхафе: ayahPage[издание][сура-1][аят-1] ----
const ayahPage = {};
for (const [edition, dir] of [['v4', 'mushaf-pages'], ['v1', 'mushaf-pages-v1']]) {
  const bySurah = Array.from({ length: 114 }, () => []);
  for (let p = 1; p <= 604; p++) {
    const page = JSON.parse(readFileSync(join(DATA, dir, `${p}.json`), 'utf8'));
    for (const line of page.lines)
      for (const w of line.w) {
        const [s, a] = w.k.split(':').map(Number);
        bySurah[s - 1][a - 1] ??= p;
      }
  }
  if (bySurah.reduce((n, s) => n + s.filter(Boolean).length, 0) !== totalAyahs) {
    throw new Error(`[build-data] ${edition}: не у всех аятов найдена страница`);
  }
  ayahPage[edition] = bySurah;
}
writeFileSync(join(OUT, 'mushaf-ayahs.json'), JSON.stringify(ayahPage));

console.log(
  `[build-data] сур: ${surahs.length}, аятов: ${totalAyahs}, чтецов: ${reciters.length}, файлов тафсира: ${tafsirFiles}, QCF4: ${qcfPages} стр./${qcfFonts} шр., Tajweed QCF: ${mushafPages} JSON, V1: ${mushafV1Pages} JSON -> public/data/`
);
