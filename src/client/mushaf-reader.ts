// Мусхаф: листание как в печатном мусхафе (справа налево), раскладка под экран, масштаб с переносом по словам,
// полноэкранный режим. Три слота-страницы: текущая, следующая слева и предыдущая справа — палец тянет всю ленту.
import { BASMALA_PAGE, clampPage, MUSHAF_TOTAL_PAGES, renderSheetHtml, type MushafEdition } from '../lib/mushaf-layout';
import { fontReady, loadAyahPages, loadFont, loadMeta, loadPage, prefetchPage } from './mushaf-data';
import {
  getEdition,
  getZoom,
  isPageBookmarked,
  MK,
  rememberPage,
  setEdition as saveEdition,
  setZoom as saveZoom,
  togglePageBookmark,
  ZOOM_MAX,
  ZOOM_MIN,
} from './mushaf-store';
import { toast } from './shared';

/** Позиция 605 — экран хатма после последней страницы. */
const KHATM = MUSHAF_TOTAL_PAGES + 1;
type Slot = 'prev' | 'cur' | 'next';

interface Slide {
  el: HTMLElement;
  pos: number | null;
  token: number;
}

// Ширина строки QCF в долях кегля (типичная по замерам: 1441 г. — 16,2, 1405 г. — 14,2) и шаг строк.
// Точная ширина — у каждой страницы своя (до 17,5 в 1441 г.), её меряет fitSheet после загрузки шрифта.
const LINE_WIDTH_EM: Record<MushafEdition, number> = { v4: 16.3, v1: 14.3 };
const LINE_PITCH_EM = 1.62;
// Строка заметно короче самой длинной на странице — концовка или короткая строка: по центру, как в печати.
const SHORT_LINE = 0.72;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface MushafReader {
  readonly page: number;
  readonly edition: MushafEdition;
  goTo(p: number, opts?: { push?: boolean; ayah?: string }): void;
  step(dir: 1 | -1): void;
  setEdition(e: MushafEdition): void;
  readonly zoom: number;
  setZoom(z: number): void;
  toggleImmersive(force?: boolean): void;
  toggleBookmark(): void;
  gotoQuery(q: string): Promise<boolean>;
}

export function createMushafReader(root: HTMLElement): MushafReader | null {
  const viewport = root.querySelector<HTMLElement>('[data-mushaf-viewport]');
  const track = root.querySelector<HTMLElement>('[data-mushaf-track]');
  if (!viewport || !track) return null;
  const html = document.documentElement;
  const body = document.body;
  const khatmTpl = document.querySelector<HTMLTemplateElement>('[data-mushaf-khatm-template]');
  const slides: Record<Slot, Slide> = {
    prev: { el: track.querySelector('[data-slot="prev"]')!, pos: null, token: 0 },
    cur: { el: track.querySelector('[data-slot="cur"]')!, pos: null, token: 0 },
    next: { el: track.querySelector('[data-slot="next"]')!, pos: null, token: 0 },
  };

  const ssrPage = clampPage(Number(root.dataset.page) || 1);
  const urlPage = () => clampPage(Number((location.pathname.match(/\/mushaf\/(\d+)/) || [])[1]) || ssrPage);
  let edition: MushafEdition = getEdition();
  let pos = urlPage();
  let zoom = getZoom();
  let busy = false;
  let suppressClickUntil = 0;
  const page = () => Math.min(pos, MUSHAF_TOTAL_PAGES);

  // ---------------------------------------------------------------- слоты
  const neighbor = (p: number, dir: 1 | -1) => {
    const n = p + dir;
    return n >= 1 && n <= KHATM ? n : null;
  };

  function place() {
    const x: Record<Slot, string> = { prev: '100%', cur: '0', next: '-100%' };
    (Object.keys(slides) as Slot[]).forEach((slot) => {
      const s = slides[slot];
      s.el.dataset.slot = slot;
      s.el.style.transform = `translateX(${x[slot]})`;
      s.el.classList.toggle('is-current', slot === 'cur');
      s.el.setAttribute('aria-hidden', slot === 'cur' ? 'false' : 'true');
      if (slot === 'cur') s.el.removeAttribute('inert');
      else s.el.setAttribute('inert', '');
    });
  }

  function skeletonHtml(p: number) {
    const lines = Array.from({ length: 15 }, (_, i) => `<div class="qcf-line" data-line="${i + 1}"></div>`).join('');
    return (
      `<section class="mushaf-sheet" data-state="loading" data-page="${p}" aria-label="Страница ${p} мусхафа">` +
      `<header class="mushaf-meta"><span class="mushaf-meta-juz"></span><span class="mushaf-meta-surah"></span></header>` +
      `<div class="qcf-page" dir="rtl" data-mushaf-page="${p}" data-edition="${edition}">${lines}</div>` +
      `<footer class="mushaf-folio">${p}</footer></section>`
    );
  }

  /** Замер строк после загрузки шрифта: кегль по самой длинной строке страницы, короткие — по центру. */
  function fitSheet(sheet: HTMLElement) {
    const page = sheet.querySelector<HTMLElement>('.qcf-page');
    if (!page) return;
    const size = parseFloat(getComputedStyle(page).fontSize) || 1;
    const lines = Array.from(page.querySelectorAll<HTMLElement>('.qcf-line')).filter((l) => l.querySelector('.qcf-word'));
    const widths = lines.map(
      (l) => Array.from(l.children).reduce((sum, w) => sum + w.getBoundingClientRect().width, 0) / size
    );
    const max = Math.max(...widths, 1);
    sheet.style.setProperty('--line-em', max.toFixed(3));
    lines.forEach((l, i) => l.classList.toggle('is-short', widths[i] < max * SHORT_LINE));
  }

  function markReady(sheet: HTMLElement) {
    fitSheet(sheet);
    sheet.dataset.state = 'ready';
    sheet.classList.remove('is-slow');
  }

  function watchFont(slide: Slide, p: number, token: number, retry = false) {
    const sheet = slide.el.querySelector<HTMLElement>('.mushaf-sheet');
    if (!sheet) return;
    // басмала над сурой — шрифтом страницы 1: ждём и его, чтобы не мелькнули «случайные буквы»
    const pages = sheet.querySelector('.qcf-basmala') && p !== BASMALA_PAGE ? [p, BASMALA_PAGE] : [p];
    if (!retry && pages.every((n) => fontReady(edition, n))) {
      markReady(sheet);
      return;
    }
    sheet.dataset.state = 'loading';
    const status = sheet.querySelector<HTMLElement>('.mushaf-sheet-status');
    if (status) status.hidden = true;
    const slow = window.setTimeout(() => {
      if (token === slide.token) sheet.classList.add('is-slow');
    }, 5000);
    Promise.all(pages.map((n) => loadFont(edition, n, retry))).then(
      () => {
        if (token !== slide.token) return;
        markReady(sheet);
      },
      () => {
        if (token !== slide.token) return;
        sheet.dataset.state = 'error';
        if (status) status.hidden = false;
      }
    ).finally(() => window.clearTimeout(slow));
  }

  async function fill(slide: Slide, p: number | null) {
    const token = ++slide.token;
    slide.pos = p;
    slide.el.scrollTop = 0;
    slide.el.classList.toggle('is-khatm', p === KHATM);
    if (p === null) {
      slide.el.replaceChildren();
      return;
    }
    if (p === KHATM) {
      slide.el.replaceChildren(khatmTpl ? khatmTpl.content.cloneNode(true) : document.createTextNode(''));
      return;
    }
    slide.el.innerHTML = skeletonHtml(p);
    try {
      const [data, meta] = await Promise.all([loadPage(edition, p), loadMeta()]);
      if (token !== slide.token) return;
      slide.el.innerHTML = renderSheetHtml(data, { edition, surahs: meta.suraPages, state: 'loading' });
      syncBookmark();
      if (slide === slides.cur) applyPlaying();
      watchFont(slide, p, token);
    } catch {
      if (token !== slide.token) return;
      const sheet = slide.el.querySelector<HTMLElement>('.mushaf-sheet');
      if (sheet) {
        sheet.dataset.state = 'error';
        sheet.insertAdjacentHTML(
          'beforeend',
          '<div class="mushaf-sheet-status" role="status"><span>Страница не загрузилась — нет соединения?</span>' +
            '<button type="button" class="btn" data-mushaf-retry>Повторить</button></div>'
        );
      }
    }
  }

  function fillNeighbors() {
    const prev = neighbor(pos, -1);
    const next = neighbor(pos, 1);
    if (slides.prev.pos !== prev) fill(slides.prev, prev);
    if (slides.next.pos !== next) fill(slides.next, next);
  }

  // ---------------------------------------------------------------- состояние страницы
  const liveEl = Object.assign(document.createElement('span'), { className: 'sr-only' });
  liveEl.setAttribute('aria-live', 'polite');
  root.appendChild(liveEl);

  async function syncChrome() {
    const p = page();
    const onKhatm = pos === KHATM;
    root.dataset.page = String(p);
    root.classList.toggle('is-khatm', onKhatm);
    document.title = onKhatm ? 'Хатм Корана — Коран онлайн' : `Мусхаф, страница ${p} — Коран онлайн`;
    root.querySelectorAll<HTMLAnchorElement>('[data-mushaf-step]').forEach((a) => {
      const dir = Number(a.dataset.mushafStep) as 1 | -1;
      const to = neighbor(pos, dir);
      const disabled = to === null;
      a.classList.toggle('disabled', disabled);
      a.setAttribute('aria-disabled', String(disabled));
      if (a.tagName === 'A') {
        if (to && to <= MUSHAF_TOTAL_PAGES) a.href = `/mushaf/${to}`;
        else a.removeAttribute('href');
      }
    });
    document.querySelectorAll<HTMLInputElement>('[data-mushaf-page-input]').forEach((input) => {
      if (document.activeElement !== input) input.value = String(p);
    });
    const ctx = document.querySelector('[data-context] .tc-s');
    if (ctx) ctx.textContent = onKhatm ? 'Хатм Корана' : `Страница ${p} из ${MUSHAF_TOTAL_PAGES}`;
    syncBookmark();
    liveEl.textContent = onKhatm ? 'Хатм Корана' : `Страница ${p}`;
    try {
      const meta = await loadMeta();
      const data = await loadPage(edition, p);
      const s = data.starts?.[0]?.s ?? Number(data.lines[0]?.w[0]?.k.split(':')[0]);
      const surahP = meta.suraPages.find((x) => x.n === s)?.p;
      const juzP = meta.juzStart[String(meta.pageJuz[String(p)])];
      document.querySelectorAll<HTMLSelectElement>('[data-mushaf-goto="surah"]').forEach((sel) => {
        if (surahP) sel.value = String(surahP);
      });
      document.querySelectorAll<HTMLSelectElement>('[data-mushaf-goto="juz"]').forEach((sel) => {
        if (juzP) sel.value = String(juzP);
      });
    } catch {}
  }

  function syncBookmark() {
    const current = pos <= MUSHAF_TOTAL_PAGES && isPageBookmarked(page());
    document.querySelectorAll<HTMLElement>('[data-mushaf-bookmark]').forEach((b) => {
      // кнопка в колонтитуле листа — про свою страницу, в тулбаре и панели — про текущую
      const own = Number(b.closest('.mushaf-sheet')?.getAttribute('data-page'));
      const on = own ? isPageBookmarked(own) : current;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
      const label = b.querySelector('[data-mushaf-bookmark-label]');
      if (label) label.textContent = on ? 'Убрать закладку со страницы' : 'Добавить эту страницу';
    });
  }

  function settled(push = false) {
    const p = page();
    const url = `/mushaf/${p}`;
    if (location.pathname !== url) {
      if (push) history.pushState({ mushaf: p }, '', url);
      else history.replaceState({ mushaf: p }, '', url);
    }
    if (pos <= MUSHAF_TOTAL_PAGES) rememberPage(p);
    syncChrome();
    fillNeighbors();
    applyPlaying();
    window.dispatchEvent(new CustomEvent('mushaf:page', { detail: { page: p, khatm: pos === KHATM } }));
    // вперёд по ходу чтения — ещё две страницы заранее (idle с таймаутом: при анимациях idle может не наступить)
    const prefetch = () => {
      prefetchPage(edition, p + 2);
      prefetchPage(edition, p + 3);
      prefetchPage(edition, p - 2);
    };
    const ric = (window as any).requestIdleCallback as ((fn: () => void, o: { timeout: number }) => void) | undefined;
    if (ric) ric(prefetch, { timeout: 1200 });
    else window.setTimeout(prefetch, 400);
  }

  // ---------------------------------------------------------------- раскладка
  function layout() {
    const vv = window.visualViewport;
    html.style.setProperty('--mushaf-vvh', `${Math.max(320, Math.floor((vv && vv.height) || window.innerHeight))}px`);
    const vw = viewport!.clientWidth;
    const vh = viewport!.clientHeight;
    if (!vw || !vh) return;
    const immersive = isImmersive();
    const mobile = vw <= 650;
    const framed = !mobile && !immersive;
    // лист: на десктопе — «бумажная» страница, на телефоне и во весь экран — на всю площадь,
    // но не шире, чем текст заполнит при кегле по высоте (иначе на широком экране строки расползаются)
    const h = framed ? vh - 24 : vh;
    const padTop = immersive ? 10 : framed ? 34 : 26;
    const padBottom = immersive ? 10 : framed ? 34 : 26;
    const byHeight = (h - padTop - padBottom) / (15 * LINE_PITCH_EM);
    const padX0 = framed ? 0 : immersive ? 12 : 10;
    const w = framed
      ? Math.min(vw - 40, Math.round((vh - 24) * 0.7))
      : Math.min(vw, Math.round(byHeight * LINE_WIDTH_EM[edition] * 1.04 + padX0 * 2));
    const padX = framed ? Math.round(w * 0.055) : padX0;
    const size = Math.min((w - padX * 2) / LINE_WIDTH_EM[edition], byHeight);
    const s = root.style;
    s.setProperty('--mushaf-page-w', `${Math.floor(w)}px`);
    s.setProperty('--mushaf-page-h', `${Math.floor(h)}px`);
    s.setProperty('--mushaf-pad-x', `${padX}px`);
    s.setProperty('--mushaf-pad-top', `${padTop}px`);
    s.setProperty('--mushaf-pad-bottom', `${padBottom}px`);
    s.setProperty('--mushaf-qcf-size', `${clamp(size, 12, 48).toFixed(2)}px`);
    root.classList.toggle('is-framed', framed);
  }

  // ---------------------------------------------------------------- масштаб (перенос по словам)
  function applyZoom() {
    root.style.setProperty('--mushaf-zoom', String(zoom));
    root.classList.toggle('is-flow', zoom > 1.001);
    const label = `${Math.round(zoom * 100)}%`;
    document.querySelectorAll('[data-mushaf-zoom-reset]').forEach((b) => (b.textContent = label));
  }

  function setZoomValue(z: number, save = true) {
    const next = clamp(Math.round(z * 100) / 100, ZOOM_MIN, ZOOM_MAX);
    const el = slides.cur.el;
    const ratio = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0;
    zoom = next;
    applyZoom();
    requestAnimationFrame(() => {
      el.scrollTop = ratio * Math.max(0, el.scrollHeight - el.clientHeight);
    });
    if (save) saveZoom(zoom);
  }

  // ---------------------------------------------------------------- листание
  function animateTrack(x: number, ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (reducedMotion() || ms <= 0) {
        track!.style.transition = 'none';
        track!.style.transform = `translateX(${x}px)`;
        resolve();
        return;
      }
      let done = false;
      // transitionend всплывает и от слов (подсветка при наведении) — ждём только свою анимацию ленты
      const finish = (e?: TransitionEvent) => {
        if (done || (e && (e.target !== track || e.propertyName !== 'transform'))) return;
        done = true;
        track!.removeEventListener('transitionend', finish);
        resolve();
      };
      track!.addEventListener('transitionend', finish);
      window.setTimeout(finish, ms + 80);
      track!.style.transition = `transform ${ms}ms cubic-bezier(0.22, 0.8, 0.26, 1)`;
      track!.style.transform = `translateX(${x}px)`;
    });
  }

  function resetTrack() {
    track!.style.transition = 'none';
    track!.style.transform = '';
  }

  /** dir 1 — следующая страница: она лежит слева, лента уезжает вправо. */
  async function step(dir: 1 | -1, from = 0) {
    if (busy) return;
    const target = neighbor(pos, dir);
    const W = viewport!.clientWidth;
    if (target === null) {
      busy = true;
      await animateTrack(dir * 28, 120);
      await animateTrack(0, 160);
      resetTrack();
      busy = false;
      return;
    }
    busy = true;
    const remaining = Math.abs(dir * W - from) / Math.max(1, W);
    await animateTrack(dir * W, Math.round(170 + 170 * remaining));
    const { prev, cur, next } = slides;
    if (dir === 1) Object.assign(slides, { prev: cur, cur: next, next: prev });
    else Object.assign(slides, { next: cur, cur: prev, prev: next });
    resetTrack();
    place();
    pos = target;
    slides.cur.el.scrollTop = 0;
    busy = false;
    settled();
  }

  function goTo(p: number, opts: { push?: boolean; ayah?: string } = {}) {
    const target = p === KHATM ? KHATM : clampPage(p);
    const done = () => {
      if (opts.ayah) flashAyah(opts.ayah);
    };
    if (target === pos && slides.cur.pos === target) {
      done();
      return;
    }
    if (Math.abs(target - pos) === 1 && !opts.push) {
      step(target > pos ? 1 : -1).then(done);
      return;
    }
    pos = target;
    slides.cur.el.classList.remove('is-entering');
    void slides.cur.el.offsetWidth;
    slides.cur.el.classList.add('is-entering');
    fill(slides.cur, target).then(done);
    settled(!!opts.push);
  }

  function flashAyah(key: string, tries = 0) {
    // подсветка — когда страница уже видна, а не под скелетоном
    if (slides.cur.el.querySelector('.mushaf-sheet')?.getAttribute('data-state') === 'loading' && tries < 50) {
      window.setTimeout(() => flashAyah(key, tries + 1), 100);
      return;
    }
    const words = Array.from(slides.cur.el.querySelectorAll<HTMLElement>(`.qcf-word[data-ayah-key="${key}"]`));
    if (!words.length) return;
    words.forEach((w) => w.classList.add('qcf-ayah-flash'));
    // при переносе по словам страница прокручивается — подводим аят к середине (крутим только сам слайд)
    if (root.classList.contains('is-flow')) {
      const el = slides.cur.el;
      const top = words[0].getBoundingClientRect().top - el.getBoundingClientRect().top;
      el.scrollTo({ top: el.scrollTop + top - el.clientHeight / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    window.setTimeout(() => words.forEach((w) => w.classList.remove('qcf-ayah-flash')), 2400);
  }

  async function gotoQuery(q: string): Promise<boolean> {
    const text = q.trim();
    const ayah = text.match(/^(\d{1,3})\s*[:.,\s]\s*(\d{1,3})$/);
    if (ayah) {
      const s = Number(ayah[1]);
      const a = Number(ayah[2]);
      try {
        const map = await loadAyahPages();
        const p = map[edition][s - 1]?.[a - 1];
        if (!p) {
          toast(`Нет аята ${s}:${a}`);
          return false;
        }
        goTo(p, { push: true, ayah: `${s}:${a}` });
        return true;
      } catch {
        toast('Не удалось найти аят — нет соединения?');
        return false;
      }
    }
    if (/^\d{1,3}$/.test(text)) {
      const n = Number(text);
      if (n < 1 || n > MUSHAF_TOTAL_PAGES) {
        toast(`Страницы от 1 до ${MUSHAF_TOTAL_PAGES}`);
        return false;
      }
      goTo(n, { push: true });
      return true;
    }
    toast('Введите номер страницы или аят, например 2:255');
    return false;
  }

  // ---------------------------------------------------------------- жесты
  interface Drag {
    id: number;
    x0: number;
    y0: number;
    dx: number;
    mode: 'pending' | 'drag' | 'scroll';
    lastX: number;
    lastT: number;
    v: number;
  }
  let drag: Drag | null = null;
  let pinch: { d0: number; z0: number } | null = null;

  viewport.addEventListener('pointerdown', (e) => {
    if (busy || pinch || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as Element).closest('button, a, input, select, textarea')) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, mode: 'pending', lastX: e.clientX, lastT: e.timeStamp, v: 0 };
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || pinch) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (drag.mode === 'pending') {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        drag.mode = 'drag';
        try {
          viewport.setPointerCapture(e.pointerId);
        } catch {}
        track.style.transition = 'none';
        root.classList.add('is-dragging');
      } else if (Math.abs(dy) > 8) {
        drag.mode = 'scroll';
        return;
      } else return;
    }
    if (drag.mode !== 'drag') return;
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.v = (e.clientX - drag.lastX) / dt;
    drag.lastX = e.clientX;
    drag.lastT = e.timeStamp;
    drag.dx = dx;
    const blocked = neighbor(pos, dx > 0 ? 1 : -1) === null;
    track.style.transform = `translateX(${blocked ? dx * 0.22 : dx}px)`;
  });

  function endDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.mode !== 'drag') return;
    root.classList.remove('is-dragging');
    suppressClickUntil = performance.now() + 350;
    const W = viewport!.clientWidth;
    const flick = Math.abs(d.v) > 0.35 && Math.abs(d.dx) > 24 && Math.sign(d.v) === Math.sign(d.dx);
    const dir = (d.dx > 0 ? 1 : -1) as 1 | -1;
    if (e.type !== 'pointercancel' && (Math.abs(d.dx) > W * 0.2 || flick) && neighbor(pos, dir) !== null) {
      step(dir, d.dx);
    } else {
      busy = true;
      animateTrack(0, 200).then(() => {
        resetTrack();
        busy = false;
      });
    }
  }
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  // клик по слову после свайпа не должен открывать шторку аята
  viewport.addEventListener(
    'click',
    (e) => {
      if (performance.now() < suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if ((e.target as Element).closest('[data-mushaf-retry]')) {
        const sheet = (e.target as Element).closest<HTMLElement>('.mushaf-sheet');
        const p = Number(sheet?.dataset.page);
        const slide = (Object.values(slides) as Slide[]).find((s) => s.el.contains(sheet));
        if (slide && p) {
          if (sheet?.querySelector('.qcf-word')) watchFont(slide, p, slide.token, true);
          else fill(slide, p);
        }
        return;
      }
      if (isImmersive() && !(e.target as Element).closest('.qcf-word, .mushaf-khatm')) revealChrome();
    },
    true
  );

  // щипок двумя пальцами — размер текста
  const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  viewport.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 2) return;
      pinch = { d0: Math.max(1, dist(e.touches)), z0: zoom };
      if (drag?.mode === 'drag') {
        root.classList.remove('is-dragging');
        resetTrack();
      }
      drag = null;
    },
    { passive: true }
  );
  let pinchFrame = 0;
  viewport.addEventListener(
    'touchmove',
    (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const z = pinch.z0 * (dist(e.touches) / pinch.d0);
      cancelAnimationFrame(pinchFrame);
      pinchFrame = requestAnimationFrame(() => setZoomValue(z, false));
    },
    { passive: false }
  );
  const endPinch = (e: TouchEvent) => {
    if (!pinch || e.touches.length >= 2) return;
    pinch = null;
    saveZoom(zoom);
    suppressClickUntil = performance.now() + 350;
  };
  viewport.addEventListener('touchend', endPinch, { passive: true });
  viewport.addEventListener('touchcancel', endPinch, { passive: true });

  // Ctrl/⌘ + колесо и щипок на тачпаде — масштаб; горизонтальный свайп тачпадом — листание
  let wheelX = 0;
  let wheelT = 0;
  let wheelLock = 0;
  viewport.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoomValue(zoom - e.deltaY * 0.01);
        return;
      }
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) return;
      e.preventDefault();
      const now = performance.now();
      if (now < wheelLock) return;
      if (now - wheelT > 250) wheelX = 0;
      wheelT = now;
      wheelX += e.deltaX;
      if (Math.abs(wheelX) > 90) {
        // пальцы вправо (deltaX < 0) — тянем страницу вправо, как свайп: следующая
        step(wheelX < 0 ? 1 : -1);
        wheelX = 0;
        wheelLock = now + 600;
      }
    },
    { passive: false }
  );

  // ---------------------------------------------------------------- во весь экран
  const isImmersive = () => html.hasAttribute('data-mushaf-immersive');
  let chromeT = 0;
  function revealChrome() {
    root.classList.add('show-chrome');
    window.clearTimeout(chromeT);
    chromeT = window.setTimeout(() => root.classList.remove('show-chrome'), 2600);
  }

  function toggleImmersive(force?: boolean) {
    const on = force ?? !isImmersive();
    html.toggleAttribute('data-mushaf-immersive', on);
    body.classList.toggle('mushaf-immersive', on);
    try {
      if (on) sessionStorage.setItem(MK.immersive, '1');
      else sessionStorage.removeItem(MK.immersive);
    } catch {}
    const fs = document.fullscreenElement;
    if (on && !fs && document.fullscreenEnabled) {
      html.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    } else if (!on && fs) {
      document.exitFullscreen?.().catch(() => {});
    }
    layout();
    if (on) revealChrome();
  }

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && isImmersive()) toggleImmersive(false);
    else layout();
  });
  document.addEventListener(
    'mousemove',
    (e) => {
      if (isImmersive() && e.clientY < 90) revealChrome();
    },
    { passive: true }
  );

  // ---------------------------------------------------------------- кнопки, формы, клавиатура
  function toggleBookmark() {
    if (pos > MUSHAF_TOTAL_PAGES) return;
    const on = togglePageBookmark(page());
    toast(on ? `Страница ${page()} в закладках` : 'Закладка убрана');
    syncBookmark();
    window.dispatchEvent(new CustomEvent('mushaf:bookmarks'));
  }

  document.addEventListener('click', (e) => {
    const t = e.target as Element;
    const stepEl = t.closest<HTMLElement>('[data-mushaf-step]');
    if (stepEl) {
      e.preventDefault();
      if (!stepEl.classList.contains('disabled')) step(Number(stepEl.dataset.mushafStep) as 1 | -1);
      return;
    }
    if (t.closest('[data-mushaf-khatm-restart]')) {
      e.preventDefault();
      goTo(1, { push: true });
      return;
    }
    const zoomStep = t.closest<HTMLElement>('[data-mushaf-zoom-step]');
    if (zoomStep) {
      setZoomValue(zoom + Number(zoomStep.dataset.mushafZoomStep) / 100);
      return;
    }
    if (t.closest('[data-mushaf-zoom-reset]')) {
      setZoomValue(1);
      return;
    }
    if (t.closest('[data-mushaf-immersive]')) {
      toggleImmersive();
      return;
    }
    if (t.closest('[data-mushaf-bookmark]')) toggleBookmark();
  });

  document.addEventListener('submit', (e) => {
    const form = (e.target as Element).closest<HTMLFormElement>('[data-mushaf-jump]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>('input[name="q"]');
    gotoQuery(input?.value || '').then((ok) => {
      if (!ok) return;
      input?.blur();
      window.dispatchEvent(new CustomEvent('mushaf:navigated'));
      if (input && !input.hasAttribute('data-mushaf-page-input')) input.value = '';
    });
  });

  document.addEventListener('change', (e) => {
    const sel = (e.target as Element).closest<HTMLSelectElement>('[data-mushaf-goto]');
    if (!sel || !sel.value) return;
    goTo(Number(sel.value), { push: true });
    sel.blur();
    window.dispatchEvent(new CustomEvent('mushaf:navigated'));
  });

  window.addEventListener(
    'keydown',
    (e) => {
      const tag = (e.target as Element)?.tagName || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('.mushaf-panel:not([hidden]), .mas.open, .image-editor-open')) return;
      const k = e.key;
      let handled = true;
      if (k === 'ArrowLeft') step(1);
      else if (k === 'ArrowRight') step(-1);
      else if (k === '+' || k === '=') setZoomValue(zoom + 0.1);
      else if (k === '-' || k === '_') setZoomValue(zoom - 0.1);
      else if (k === '0') setZoomValue(1);
      else if (k === 'f' || k === 'F' || k === 'а' || k === 'А') toggleImmersive();
      else if (k === 'b' || k === 'B' || k === 'и' || k === 'И') toggleBookmark();
      else if (k === 'Escape' && isImmersive()) toggleImmersive(false);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  window.addEventListener('mushaf:bookmarks-changed', syncBookmark);

  window.addEventListener('popstate', () => {
    const p = urlPage();
    if (p !== page() || pos === KHATM) goTo(p);
  });

  // шторка аята просит показать аят (соседний аят на другой странице, переход из поиска)
  window.addEventListener('mushaf:goto-ayah', async (e) => {
    const { s, a, open } = (e as CustomEvent<{ s: number; a: number; open?: boolean }>).detail;
    try {
      const map = await loadAyahPages();
      const p = map[edition][s - 1]?.[a - 1];
      if (!p) return;
      if (p !== page() || pos === KHATM) goTo(p);
      if (!open) return;
      // ждём, пока докрутится листание и дорисуется страница с этим аятом
      let tries = 0;
      const wait = () => {
        if (slides.cur.pos === p && slides.cur.el.querySelector(`.qcf-word[data-ayah-key="${s}:${a}"]`)) {
          window.dispatchEvent(new CustomEvent('mushaf:open-ayah', { detail: { s, a } }));
        } else if (++tries < 60) window.setTimeout(wait, 60);
      };
      wait();
    } catch {}
  });

  // ---------------------------------------------------------------- аудио: звучащий аят подсвечен, мусхаф листается следом
  let playing: { s: number; a: number } | null = null;

  function applyPlaying() {
    root.querySelectorAll('.qcf-word.qcf-ayah-playing').forEach((w) => w.classList.remove('qcf-ayah-playing'));
    if (!playing) return;
    slides.cur.el
      .querySelectorAll(`.qcf-word[data-ayah-key="${playing.s}:${playing.a}"]`)
      .forEach((w) => w.classList.add('qcf-ayah-playing'));
  }

  window.addEventListener('mushaf:audio-ayah', async (e) => {
    playing = (e as CustomEvent<{ s: number; a: number } | null>).detail;
    applyPlaying();
    if (!playing) return;
    try {
      const p = (await loadAyahPages())[edition][playing.s - 1]?.[playing.a - 1];
      if (p && (p !== page() || pos === KHATM)) goTo(p);
    } catch {}
  });

  // кнопка «Слушать» в тулбаре: пауза/продолжить или чтение с первого аята страницы
  const audioEl = document.querySelector<HTMLAudioElement>('[data-player-audio]');
  const syncPlayButton = () => {
    const on = !!audioEl && !audioEl.paused;
    document.querySelectorAll<HTMLElement>('[data-mushaf-play]').forEach((b) => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Пауза' : 'Слушать страницу');
      b.title = on ? 'Пауза' : 'Слушать с этой страницы';
    });
  };
  audioEl?.addEventListener('play', syncPlayButton);
  audioEl?.addEventListener('pause', syncPlayButton);
  document.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('[data-mushaf-play]')) return;
    const first = slides.cur.el.querySelector<HTMLElement>('.qcf-word[data-ayah-key]')?.dataset.ayahKey;
    const onPage = playing && slides.cur.el.querySelector(`.qcf-word[data-ayah-key="${playing.s}:${playing.a}"]`);
    const [s, a] = (first || '1:1').split(':').map(Number);
    window.dispatchEvent(new CustomEvent('mushaf:play', { detail: onPage ? null : { s, a } }));
  });

  function setEdition(e: MushafEdition) {
    if (e === edition) return;
    edition = e;
    saveEdition(e);
    html.toggleAttribute('data-mushaf-edition', false);
    if (e === 'v1') html.setAttribute('data-mushaf-edition', 'v1');
    layout();
    (Object.values(slides) as Slide[]).forEach((s) => fill(s, s.pos));
  }

  // ---------------------------------------------------------------- старт
  place();
  const ssrSheet = slides.cur.el.querySelector<HTMLElement>('.mushaf-sheet');
  if (pos === ssrPage && edition === 'v4' && ssrSheet) {
    slides.cur.pos = pos;
    watchFont(slides.cur, pos, slides.cur.token);
  } else {
    // издание 1405 или офлайн-подмена страницы (SW отдал сохранённую страницу вместо запрошенной)
    fill(slides.cur, pos);
  }
  if (isImmersive()) body.classList.add('mushaf-immersive');
  applyZoom();
  layout();
  settled();
  // старое состояние масштаба (pan/scale на страницу) больше не используется
  try {
    localStorage.removeItem('q_mushaf_zoom_state');
  } catch {}

  let resizeFrame = 0;
  const onResize = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(layout);
  };
  window.addEventListener('resize', onResize, { passive: true });
  window.visualViewport?.addEventListener('resize', onResize, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(viewport);

  return {
    get page() {
      return page();
    },
    get edition() {
      return edition;
    },
    goTo,
    step: (dir) => void step(dir),
    setEdition,
    get zoom() {
      return zoom;
    },
    setZoom: (z) => setZoomValue(z),
    toggleImmersive,
    toggleBookmark,
    gotoQuery,
  };
}
