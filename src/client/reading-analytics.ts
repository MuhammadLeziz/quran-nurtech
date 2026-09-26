import { $, $$, K, LS, type Dict } from './shared';

const READ_API_ENABLED =
  typeof location !== 'undefined' &&
  (location.hostname === 'quran.nurtech.dev' || location.hostname.endsWith('.nurtech.dev'));

const TOTAL_AYAHS = 6236;
const DWELL_READ_SECONDS = 3;
const READ_SYNC_INTERVAL_MS = 30_000;
const ayahKeyRe = /^\d{1,3}:\d{1,3}$/;

interface SurahMeta {
  n: number;
  c: number;
}

interface ReadingDayStats {
  sec: number;
  ayahs: number;
}

interface ReadingStreak {
  current: number;
  best: number;
  lastDay: string;
}

const isAyahKey = (k: string) => ayahKeyRe.test(k);

const localDayKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const dayNum = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Math.floor(new Date(y, m - 1, d).getTime() / 86_400_000);
};

function fmtDuration(sec: number) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.round(s / 60);
  if (m < 1) return s > 0 ? '<1 мин' : '0 мин';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h} ч${mm ? ` ${mm} мин` : ''}`;
}

function getUid() {
  let uid = LS.get<string>(K.uid, '');
  if (!uid) {
    uid =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    LS.set(K.uid, uid);
  }
  return uid;
}

export function getProgress() {
  return LS.get<Dict<boolean>>(K.progress, {});
}

function readAyahCount(prog = getProgress()) {
  let c = 0;
  for (const k in prog) if (prog[k] === true && isAyahKey(k)) c++;
  return c;
}

function cleanProgressWith(key: string) {
  const raw = getProgress();
  const clean: Dict<boolean> = {};
  for (const k in raw) if (raw[k] === true && isAyahKey(k)) clean[k] = true;
  clean[key] = true;
  return clean;
}

function getDays() {
  return LS.get<Dict<ReadingDayStats>>(K.days, {});
}

function setDays(days: Dict<ReadingDayStats>) {
  LS.set(K.days, days);
}

function updateStreak(days = getDays()) {
  const active = Object.keys(days)
    .filter((d) => (days[d]?.sec || 0) > 0 || (days[d]?.ayahs || 0) > 0)
    .sort((a, b) => dayNum(a) - dayNum(b));
  let best = 0;
  let run = 0;
  let prev = 0;
  for (const d of active) {
    const n = dayNum(d);
    run = prev && n === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = n;
  }
  const today = localDayKey();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = localDayKey(y);
  let anchor = days[today] ? today : days[yesterday] ? yesterday : '';
  let current = 0;
  if (anchor) {
    let n = dayNum(anchor);
    const activeNums = new Set(active.map(dayNum));
    while (activeNums.has(n)) {
      current++;
      n--;
    }
  }
  const streak = { current, best, lastDay: active[active.length - 1] || '' };
  LS.set(K.streak, streak);
  return streak;
}

function addReadingSecond() {
  const total = Math.max(0, LS.get<number>(K.time, 0) || 0) + 1;
  LS.set(K.time, total);
  const days = getDays();
  const d = localDayKey();
  days[d] = { sec: Math.max(0, days[d]?.sec || 0) + 1, ayahs: Math.max(0, days[d]?.ayahs || 0) };
  setDays(days);
  updateStreak(days);
}

function markAyahRead(key: string) {
  if (!isAyahKey(key)) return false;
  const current = getProgress();
  if (current[key] === true) return false;
  const next = cleanProgressWith(key);
  LS.set(K.progress, next);
  const days = getDays();
  const d = localDayKey();
  days[d] = { sec: Math.max(0, days[d]?.sec || 0), ayahs: Math.max(0, days[d]?.ayahs || 0) + 1 };
  setDays(days);
  updateStreak(days);
  renderReadingProgress();
  scheduleReadingSync(1200);
  return true;
}

export function surahReadCount(s: number, count: number, prog = getProgress()) {
  let read = 0;
  for (let a = 1; a <= count; a++) if (prog[`${s}:${a}`] === true) read++;
  return read;
}

let progressIndex: SurahMeta[] = [];

export function renderReadingProgress(idx?: SurahMeta[]) {
  if (idx) progressIndex = idx;
  const pbox = $('[data-drawer-progress]');
  if (!pbox || !progressIndex.length) return;
  const prog = getProgress();
  const readAyahs = readAyahCount(prog);
  const pct = Math.round((readAyahs / TOTAL_AYAHS) * 100);
  const time = LS.get<number>(K.time, 0) || 0;
  const streak = LS.get<ReadingStreak>(K.streak, { current: 0, best: 0, lastDay: '' });
  const summary = $('[data-read-summary]')?.textContent || '';
  pbox.innerHTML = `<div class="prog-row"><span>Прочитано <b>${pct}%</b> Корана</span><span>${readAyahs}/${TOTAL_AYAHS} аятов</span></div><div class="prog-bar"><span style="width:${Math.max(pct, readAyahs ? 1 : 0)}%"></span></div><div class="prog-stats"><span>${fmtDuration(time)}</span><span>стрик ${streak.current || 0} дн.</span></div><div class="prog-global" data-read-summary>${summary}</div>`;
}

const pageSessionId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let readSyncTimer: number | undefined;
let readLastSyncAt = 0;

function readingPayload() {
  const unitsRead = readAyahCount();
  return {
    uid: getUid(),
    sessionId: pageSessionId,
    unitsRead,
    totalSeconds: Math.max(0, Math.round(LS.get<number>(K.time, 0) || 0)),
    coverage: +(unitsRead / TOTAL_AYAHS).toFixed(4),
    lastActiveAt: new Date().toISOString(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    days: getDays(),
    streak: LS.get<ReadingStreak>(K.streak, { current: 0, best: 0, lastDay: '' }),
  };
}

function sendReadingSync(useBeacon = false) {
  if (!READ_API_ENABLED) return;
  clearTimeout(readSyncTimer);
  readSyncTimer = undefined;
  const payload = JSON.stringify(readingPayload());
  readLastSyncAt = Date.now();
  if (useBeacon && navigator.sendBeacon) {
    const blob = new Blob([payload], { type: 'application/json' });
    if (navigator.sendBeacon('/api/read', blob)) return;
  }
  fetch('/api/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

function scheduleReadingSync(delay = 5000) {
  if (!READ_API_ENABLED) return;
  clearTimeout(readSyncTimer);
  readSyncTimer = window.setTimeout(() => sendReadingSync(false), delay);
}

function maybePeriodicReadingSync() {
  if (Date.now() - readLastSyncAt >= READ_SYNC_INTERVAL_MS) scheduleReadingSync(100);
}

export async function loadPublicReadSummary() {
  if (!READ_API_ENABLED) return;
  const box = $('[data-read-summary]');
  if (!box) return;
  try {
    const r = await fetch('/api/read/summary', { headers: { Accept: 'application/json' } });
    if (!r.ok) return;
    const data = await r.json();
    const devices = Number(data.devices || 0);
    const active = Number(data.activeToday || 0);
    if (devices > 0) box.textContent = `Устройства: ${devices} · сегодня активны: ${active}`;
  } catch {}
}

const dwellState = {
  io: null as IntersectionObserver | null,
  visible: new Set<string>(),
  dwell: {} as Dict<number>,
  seen: new Set<string>(),
  timer: 0,
  focused: true,
};

function canTickReading() {
  return !document.hidden && dwellState.focused;
}

function updateLastFromVisible() {
  const keys = Array.from(dwellState.visible);
  if (!keys.length) return;
  const last = keys
    .map((k) => k.split(':').map(Number))
    .sort((a, b) => (a[0] === b[0] ? b[1] - a[1] : b[0] - a[0]))[0];
  if (last) LS.set(K.last, { s: last[0], a: last[1] });
}

function startDwellTimer() {
  if (dwellState.timer) return;
  dwellState.timer = window.setInterval(() => {
    if (!canTickReading() || dwellState.visible.size === 0) return;
    addReadingSecond();
    updateLastFromVisible();
    dwellState.visible.forEach((key) => {
      dwellState.dwell[key] = (dwellState.dwell[key] || 0) + 1;
      if (dwellState.dwell[key] >= DWELL_READ_SECONDS && !dwellState.seen.has(key)) {
        dwellState.seen.add(key);
        markAyahRead(key);
      }
    });
    maybePeriodicReadingSync();
  }, 1000);
}

// Мусхаф: аяты страницы видны все сразу, поэтому «увидел 3 секунды» ≠ «прочитал». Время чтения считаем,
// пока открыта страница, а аяты страницы отмечаем прочитанными, только если на ней пробыли столько,
// сколько нужно хотя бы на беглое чтение (пролистывание мусхафа не засчитывает хатм).
const MUSHAF_PAGE_READ_SECONDS = 20;

function startMushafTimer() {
  let dwell = 0;
  window.addEventListener('mushaf:page', () => {
    dwell = 0;
  });
  window.setInterval(() => {
    if (!canTickReading()) return;
    const words = $$<HTMLElement>('.mushaf-slide.is-current .mushaf-sheet[data-state="ready"] .qcf-word[data-ayah-key]');
    if (!words.length) return;
    addReadingSecond();
    if (++dwell !== MUSHAF_PAGE_READ_SECONDS) return;
    new Set(words.map((w) => w.dataset.ayahKey || '')).forEach((key) => {
      if (!isAyahKey(key) || dwellState.seen.has(key)) return;
      dwellState.seen.add(key);
      markAyahRead(key);
    });
    maybePeriodicReadingSync();
  }, 1000);
}

export function initReadingAnalytics() {
  const mushaf = document.body.getAttribute('data-page-mode') === 'mushaf';
  const els = mushaf ? [] : $$<HTMLElement>('[data-ayah-key]');
  if (!mushaf && (!els.length || !('IntersectionObserver' in window))) return;
  getUid();
  updateStreak();
  if (mushaf) startMushafTimer();
  else {
    dwellState.io?.disconnect();
    dwellState.visible.clear();
    dwellState.dwell = {};
    dwellState.io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const key = (entry.target as HTMLElement).dataset.ayahKey || '';
          if (!isAyahKey(key)) return;
          if (entry.isIntersecting) dwellState.visible.add(key);
          else dwellState.visible.delete(key);
        });
      },
      { root: null, rootMargin: '-70px 0px -45% 0px', threshold: 0 }
    );
    els.forEach((el) => dwellState.io?.observe(el));
    startDwellTimer();
  }
  window.addEventListener('blur', () => {
    dwellState.focused = false;
    sendReadingSync(true);
  });
  window.addEventListener('focus', () => {
    dwellState.focused = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sendReadingSync(true);
  });
  window.addEventListener('pagehide', () => sendReadingSync(true));
}
