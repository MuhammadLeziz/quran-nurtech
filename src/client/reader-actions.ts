import { isBookmarked, toggleBookmark } from './bookmarks';
import { openAyahEditor } from './imgeditor';
import { loadIbnKathir, loadIndex, loadSaadi, surahIndex } from './quran-data';
import { $, $$, K, LS, toast } from './shared';
import { updateMobileScrollLock } from './ui-menus';

interface ReaderActionsPlayer {
  playKey(s: number, a: number): void;
  toggle(): void;
}

interface ReaderActionsDeps {
  player: ReaderActionsPlayer;
}

function ayahText(el: Element): { ar: string; ru: string; s: number; a: number } {
  const arEl = $('.ar', el) as HTMLElement | null;
  const arTmp = document.createElement('div');
  arTmp.innerHTML = arEl ? arEl.dataset.orig || arEl.innerHTML : '';
  const ar = (arTmp.textContent || '').replace(/\s+/g, ' ').trim();
  const trEl = $('.tr-kuliev', el) || $('.translation', el) || $('.tafsir', el);
  const ru = (trEl?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(Перевод\s·\s)?(Эльмир\sКулиев|Абу\sАдель|Кулиев|Транслитерация)\s*/, '');
  const [s, a] = (el.getAttribute('data-ayah-key') || '0:0').split(':').map(Number);
  return { ar, ru, s, a };
}

function extractAyah(el: Element, s: number, a: number) {
  const clean = (t?: string | null) => (t || '').replace(/\s+/g, ' ').trim();
  const strip = (t?: string | null) =>
    clean(t).replace(/^(Перевод\s·\s)?(Эльмир\sКулиев|Абу\sАдель|Кулиев|Транслитерация)\s*/, '');
  const arEl = $('.ar', el) as HTMLElement | null;
  const arHtml = arEl ? arEl.dataset.orig || arEl.innerHTML : '';
  const arTmp = document.createElement('div');
  arTmp.innerHTML = arHtml;
  const ar = clean(arTmp.textContent);
  const tl = $('.translit', el) ? strip($('.translit', el)!.textContent) : '';
  let ru = '',
    aa = '';
  const k = $('.tr-kuliev', el),
    ab = $('.tr-abuadel', el);
  if (k || ab) {
    ru = k ? strip(k.textContent) : '';
    aa = ab ? strip(ab.textContent) : '';
  } else {
    $$('.translation', el).forEach((t) => {
      const txt = t.textContent || '';
      if (/Абу\sАдель/.test(txt)) aa = strip(txt);
      else if (/Кулиев/.test(txt)) ru = strip(txt);
      else if (!ru) ru = strip(txt);
    });
  }
  const surahName = surahIndex.find((x) => x.n === s)?.nr || 'Сура ' + s;
  return { s, a, ar, tl, ru, aa, surahName };
}

async function shareAyah(s: number, a: number, ar: string, ru: string) {
  const url = `${location.origin}/${s}:${a}`;
  const text = `Коран ${s}:${a}\n${ar}\n${ru}\n${url}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: `Коран ${s}:${a}`, text, url });
      return;
    } catch {}
  }
  copy(text);
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast('Скопировано'),
    () => toast('Не удалось скопировать')
  );
}

const CTX_IC = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l11-7z"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 1 2 2z"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M4 17l5-5 4 4 3-3 4 4"/></svg>',
  share:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  bookmark:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v18"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
};

function tafsirSectionEl(title: string, sub: string, text: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tafsir-src';
  const h = document.createElement('div');
  h.className = 'tafsir-src-h';
  const t = document.createElement('b');
  t.textContent = title;
  const su = document.createElement('span');
  su.className = 'tafsir-src-sub';
  su.textContent = ' · ' + sub;
  h.append(t, su);
  const b = document.createElement('div');
  b.className = 'tafsir-src-b';
  b.textContent = text;
  wrap.append(h, b);
  return wrap;
}

async function toggleTafsir(
  el: Element,
  s: number,
  a: number,
  btn?: HTMLElement | null,
  src?: 'saadi' | 'ik'
) {
  const sources: ('saadi' | 'ik')[] = src ? [src] : ['saadi', 'ik'];
  let panel = $('.ayah-tafsir', el) as HTMLElement | null;
  for (const sr of sources) {
    const block = panel?.querySelector(`.taf-src[data-src="${sr}"]`) as HTMLElement | null;
    if (block) {
      block.remove();
      btn?.classList.remove('on');
      btn?.setAttribute('aria-expanded', 'false');
      continue;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'ayah-tafsir open';
      el.appendChild(panel);
    }
    const b = document.createElement('div');
    b.className = 'taf-src';
    b.setAttribute('data-src', sr);
    b.innerHTML = '<div class="tafsir-loading">Загружаю тафсир...</div>';
    panel.appendChild(b);
    btn?.classList.add('on');
    btn?.setAttribute('aria-expanded', 'true');
    try {
      const data = sr === 'saadi' ? await loadSaadi(s) : await loadIbnKathir(s);
      const blk = data.find((x: any) => x.a === a);
      b.replaceChildren();
      const title = sr === 'saadi' ? 'Тафсир ас-Саади' : 'Тафсир Ибн Касира';
      if (blk) b.appendChild(tafsirSectionEl(title, `аят ${s}:${a}`, blk.x));
      else b.textContent = 'Для этого аята тафсир не найден.';
    } catch {
      b.remove();
      btn?.classList.remove('on');
      btn?.setAttribute('aria-expanded', 'false');
      toast('Не удалось загрузить тафсир');
    }
  }
  if (panel && !panel.querySelector('.taf-src')) panel.remove();
}

export function initAyahActions({ player }: ReaderActionsDeps) {
  $$('[data-ayah-key]').forEach((el) => {
    const [s, a] = el.getAttribute('data-ayah-key')!.split(':').map(Number);
    $('[data-act="copy"]', el)?.addEventListener('click', async () => {
      await loadIndex();
      const t = ayahText(el);
      const name = surahIndex.find((x) => x.n === s)?.nr || 'Сура ' + s;
      const url = `${location.origin}/${s}:${a}`;
      copy(`${name} · аят ${s}:${a}\n\n${t.ar}${t.ru ? '\n\n' + t.ru : ''}\n\n${url}`);
    });
    $('[data-act="copy-link"]', el)?.addEventListener('click', () =>
      copy(`${location.origin}/${s}:${a}`)
    );
    $('[data-act="share"]', el)?.addEventListener('click', async () => {
      await loadIndex();
      openAyahEditor(extractAyah(el, s, a));
    });
    $('[data-act="share-text"]', el)?.addEventListener('click', () => {
      const t = ayahText(el);
      shareAyah(s, a, t.ar, t.ru);
    });
    $('[data-bm]', el)?.addEventListener('click', () => {
      const on = toggleBookmark(s, a);
      toast(on ? 'В закладках' : 'Убрано');
    });
    $('[data-act="play"]', el)?.addEventListener('click', () => player.playKey(s, a));
    $$('[data-act="tafsir"]', el).forEach((btn) =>
      btn.addEventListener('click', (e) =>
        toggleTafsir(
          el,
          s,
          a,
          e.currentTarget as HTMLElement,
          (btn.getAttribute('data-src') as 'saadi' | 'ik') || undefined
        )
      )
    );
  });
}

export function initAyahContextMenu({ player }: ReaderActionsDeps) {
  const ayahs = $$('.ayah[data-ayah-key], [data-ayah-key].mushaf-ayah');
  if (!ayahs.length) return;
  let menu = document.querySelector('.ctx-menu') as HTMLElement | null;
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
  }
  const m = menu;
  const close = () => m.classList.remove('open');
  document.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('.ctx-menu')) close();
  });
  document.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  interface Row {
    label: string;
    icon?: string;
    run?: () => void;
    sep?: boolean;
  }
  const openAt = (x: number, y: number, el: Element) => {
    const [s, a] = el.getAttribute('data-ayah-key')!.split(':').map(Number);
    const rows: Row[] = [
      { label: 'Воспроизвести', icon: CTX_IC.play, run: () => player.playKey(s, a) },
      {
        label: 'Тафсир · ас-Саади и Ибн Касир',
        icon: CTX_IC.book,
        run: () => toggleTafsir(el, s, a, $('[data-act="tafsir"]', el) as HTMLElement | null),
      },
      { sep: true },
      {
        label: 'Продолжить отсюда',
        icon: CTX_IC.flag,
        run: () => {
          LS.set(K.readpos, { s, a });
          toast('Отмечено место чтения — кнопка «Продолжить» вернёт сюда');
        },
      },
      {
        label: 'Открыть страницу аята',
        icon: CTX_IC.link,
        run: () => {
          location.href = `/${s}:${a}`;
        },
      },
      {
        label: 'Копировать аят',
        icon: CTX_IC.copy,
        run: async () => {
          await loadIndex();
          const t = ayahText(el);
          const name = surahIndex.find((x) => x.n === s)?.nr || 'Сура ' + s;
          copy(
            `${name} · аят ${s}:${a}\n\n${t.ar}${t.ru ? '\n\n' + t.ru : ''}\n\n${location.origin}/${s}:${a}`
          );
        },
      },
      {
        label: 'Поделиться картинкой',
        icon: CTX_IC.image,
        run: async () => {
          await loadIndex();
          openAyahEditor(extractAyah(el, s, a));
        },
      },
      {
        label: 'Поделиться текстом',
        icon: CTX_IC.share,
        run: () => {
          const t = ayahText(el);
          shareAyah(s, a, t.ar, t.ru);
        },
      },
      { sep: true },
      {
        label: isBookmarked(s, a) ? 'Убрать из закладок' : 'В закладки',
        icon: CTX_IC.bookmark,
        run: () => {
          const on = toggleBookmark(s, a);
          toast(on ? 'В закладках' : 'Убрано из закладок');
        },
      },
    ];
    m.innerHTML = '';
    rows.forEach((r) => {
      if (r.sep) {
        const d = document.createElement('div');
        d.className = 'ctx-sep';
        m.appendChild(d);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ctx-item';
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<span class="ctx-ic">${r.icon || ''}</span>${r.label}`;
      b.addEventListener('click', () => {
        close();
        r.run?.();
      });
      m.appendChild(b);
    });
    m.classList.add('open');
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    const px = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
    const py = Math.max(8, Math.min(y, window.innerHeight - mh - 8));
    m.style.left = px + 'px';
    m.style.top = py + 'px';
  };

  ayahs.forEach((el) => {
    el.addEventListener('contextmenu', (e) => {
      const ev = e as MouseEvent;
      ev.preventDefault();
      openAt(ev.clientX, ev.clientY, el);
    });
  });
}

type AyahText = { a: number; r: string; aa: string; ar: string; tl: string };
const ayahTextCache = new Map<number, Promise<AyahText[]>>();

// Текст аятов одной суры (public/data/ayah-text/<s>.json) — вместо 6-МБ поискового индекса.
function loadAyahText(s: number): Promise<AyahText[]> {
  let hit = ayahTextCache.get(s);
  if (!hit) {
    hit = fetch(`/data/ayah-text/${s}.json`).then((r) => {
      if (!r.ok) throw new Error('ayah-text ' + r.status);
      return r.json();
    });
    hit.catch(() => ayahTextCache.delete(s));
    ayahTextCache.set(s, hit);
  }
  return hit;
}

const MUSHAF_TR_KEY = 'q_mushaf_tr';
const SHEET_IC = {
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

export function initMushafAyahSheet({ player }: ReaderActionsDeps) {
  const reader = document.querySelector('[data-mushaf-reader]');
  if (!reader) return;
  const sheet = document.createElement('div');
  sheet.className = 'mas';
  const backdrop = document.createElement('div');
  backdrop.className = 'mas-backdrop';
  backdrop.setAttribute('data-mas-close', '');
  const card = document.createElement('div');
  card.className = 'mas-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'mas-ref');
  // В RTL-мусхафе следующий аят — слева: кнопки «‹ ›» стоят в том же порядке, что и листание.
  card.innerHTML =
    '<div class="mas-head">' +
    `<button type="button" class="mas-nav" data-mas-step="1" aria-label="Следующий аят" title="Следующий аят">${SHEET_IC.next}</button>` +
    '<b id="mas-ref" data-mas-ref></b>' +
    `<button type="button" class="mas-nav" data-mas-step="-1" aria-label="Предыдущий аят" title="Предыдущий аят">${SHEET_IC.prev}</button>` +
    `<button type="button" class="mas-x" data-mas-close aria-label="Закрыть">${SHEET_IC.close}</button></div>` +
    '<div class="seg seg-grid2 mas-tr-switch" role="radiogroup" aria-label="Перевод">' +
    '<button type="button" role="radio" data-mas-tr="r">Кулиев</button>' +
    '<button type="button" role="radio" data-mas-tr="aa">Абу Адель</button></div>' +
    '<div class="mas-tr" data-mas-tr-text aria-live="polite"></div>' +
    '<div class="mas-tafsir" data-mas-tafsir hidden></div>' +
    '<div class="mas-acts" data-mas-acts></div>';
  sheet.append(backdrop, card);
  document.body.appendChild(sheet);

  const refEl = card.querySelector('[data-mas-ref]') as HTMLElement;
  const trEl = card.querySelector('[data-mas-tr-text]') as HTMLElement;
  const tafEl = card.querySelector('[data-mas-tafsir]') as HTMLElement;
  const actsEl = card.querySelector('[data-mas-acts]') as HTMLElement;
  let cur: { s: number; a: number; row?: AyahText; name: string } | null = null;
  let followNav = false;
  let tr: 'r' | 'aa' = LS.get<string>(MUSHAF_TR_KEY, 'r') === 'aa' ? 'aa' : 'r';

  const clearHi = () =>
    $$('.qcf-word.qcf-ayah-active').forEach((w) => w.classList.remove('qcf-ayah-active'));
  const isOpen = () => sheet.classList.contains('open');
  const close = () => {
    if (!isOpen()) return;
    sheet.classList.remove('open');
    document.body.classList.remove('mushaf-sheet-open');
    updateMobileScrollLock();
    clearHi();
    cur = null;
  };
  sheet.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-mas-close]')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  const actBtn = (label: string, icon: string, run: () => void, labelAttr = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mas-act';
    b.innerHTML = `<span class="mas-ic">${icon}</span><span ${labelAttr}>${label}</span>`;
    b.addEventListener('click', run);
    return b;
  };

  const trText = (row: AyahText) => (tr === 'aa' ? row.aa : row.r) || row.r;
  const renderTr = () => {
    $$('[data-mas-tr]', card).forEach((b) => {
      const on = b.getAttribute('data-mas-tr') === tr;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    if (cur?.row) trEl.textContent = trText(cur.row) || 'Перевод не найден.';
  };
  $$('[data-mas-tr]', card).forEach((b) =>
    b.addEventListener('click', () => {
      tr = b.getAttribute('data-mas-tr') === 'aa' ? 'aa' : 'r';
      LS.set(MUSHAF_TR_KEY, tr);
      renderTr();
    })
  );

  const open = async (s: number, a: number) => {
    clearHi();
    $$(`.mushaf-slide.is-current .qcf-word[data-ayah-key="${s}:${a}"]`).forEach((w) =>
      w.classList.add('qcf-ayah-active')
    );
    await loadIndex();
    const meta = surahIndex.find((x) => x.n === s);
    const name = meta?.nr || 'Сура ' + s;
    cur = { s, a, name };
    refEl.textContent = `${name} · ${s}:${a}`;
    trEl.textContent = 'Загружаю перевод…';
    tafEl.hidden = true;
    tafEl.textContent = '';
    renderTr();
    sheet.classList.add('open');
    document.body.classList.add('mushaf-sheet-open');
    updateMobileScrollLock();
    (card.querySelector('[data-mas-step="-1"]') as HTMLButtonElement).disabled = s === 1 && a === 1;
    (card.querySelector('[data-mas-step="1"]') as HTMLButtonElement).disabled = s === 114 && a === (meta?.c || 6);

    actsEl.replaceChildren(
      actBtn('Слушать', CTX_IC.play, () => player.playKey(s, a)),
      actBtn('Тафсир', CTX_IC.book, () => showTafsir(s, a)),
      actBtn(
        isBookmarked(s, a) ? 'В закладках' : 'Закладка',
        CTX_IC.bookmark,
        () => {
          const on = toggleBookmark(s, a);
          toast(on ? 'В закладках' : 'Убрано');
          const label = actsEl.querySelector('[data-mas-bm]');
          if (label) label.textContent = on ? 'В закладках' : 'Закладка';
        },
        'data-mas-bm'
      ),
      actBtn('Копировать', CTX_IC.copy, () => {
        if (cur?.row) copy(`${name} · аят ${s}:${a}\n\n${cur.row.ar}\n\n${trText(cur.row)}\n\n${location.origin}/${s}:${a}`);
      }),
      actBtn('Ссылка', CTX_IC.link, () => copy(`${location.origin}/${s}:${a}`)),
      actBtn('Поделиться', CTX_IC.share, () => {
        if (cur?.row) shareAyah(s, a, cur.row.ar, trText(cur.row));
      }),
      actBtn('Картинка', CTX_IC.image, () => {
        if (cur?.row) openAyahEditor({ s, a, ar: cur.row.ar, ru: cur.row.r, aa: cur.row.aa, tl: cur.row.tl, surahName: name });
      }),
      actBtn('Открыть', CTX_IC.flag, () => (location.href = `/${s}:${a}`))
    );

    try {
      const rows = await loadAyahText(s);
      if (!cur || cur.s !== s || cur.a !== a) return;
      cur.row = rows.find((x) => x.a === a);
      if (cur.row) renderTr();
      else trEl.textContent = 'Перевод не найден.';
    } catch {
      if (cur && cur.s === s && cur.a === a) trEl.textContent = 'Не удалось загрузить перевод — нет соединения?';
    }
  };

  const showTafsir = async (s: number, a: number) => {
    tafEl.hidden = false;
    tafEl.textContent = 'Загружаю тафсир…';
    try {
      const [saadi, ik] = await Promise.all([loadSaadi(s), loadIbnKathir(s)]);
      const sBlk = saadi.find((b: any) => b.a === a);
      const iBlk = ik.find((b: any) => b.a === a);
      tafEl.replaceChildren();
      if (sBlk) tafEl.appendChild(tafsirSectionEl('Тафсир ас-Саади', `аят ${s}:${a}`, sBlk.x));
      if (iBlk) tafEl.appendChild(tafsirSectionEl('Тафсир Ибн Касира', `аят ${s}:${a}`, iBlk.x));
      if (!sBlk && !iBlk) tafEl.textContent = 'Для этого аята тафсир не найден.';
    } catch {
      tafEl.textContent = 'Не удалось загрузить тафсир.';
    }
  };

  // соседний аят: на этой же странице — сразу, на соседней — мусхаф перелистнёт и откроет шторку там
  card.addEventListener('click', async (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-mas-step]');
    if (!btn || !cur) return;
    await loadIndex();
    const count = (n: number) => surahIndex.find((x) => x.n === n)?.c || 0;
    let { s, a } = cur;
    a += Number(btn.getAttribute('data-mas-step'));
    if (a < 1) {
      s -= 1;
      a = count(s);
    } else if (a > count(s)) {
      s += 1;
      a = 1;
    }
    if (s < 1 || s > 114) return;
    if (document.querySelector(`.mushaf-slide.is-current .qcf-word[data-ayah-key="${s}:${a}"]`)) open(s, a);
    else {
      followNav = true;
      window.setTimeout(() => (followNav = false), 4000);
      window.dispatchEvent(new CustomEvent('mushaf:goto-ayah', { detail: { s, a, open: true } }));
    }
  });

  // кнопка «Слушать» в тулбаре мусхафа: detail — аят, с которого начать, null — пауза/продолжить
  window.addEventListener('mushaf:play', (e) => {
    const from = (e as CustomEvent<{ s: number; a: number } | null>).detail;
    if (from) player.playKey(from.s, from.a);
    else player.toggle();
  });

  window.addEventListener('mushaf:open-ayah', (e) => {
    followNav = false;
    const { s, a } = (e as CustomEvent<{ s: number; a: number }>).detail;
    open(s, a);
  });
  // перелистнули страницу — шторка прежнего аята больше не к месту
  window.addEventListener('mushaf:page', () => {
    if (!followNav) close();
  });

  // тап по слову (и на страницах, дорисованных при листании)
  reader.addEventListener('click', (e) => {
    const w = (e.target as Element).closest('.qcf-word[data-ayah-key]');
    if (!w || !w.closest('.mushaf-slide.is-current')) return;
    const [s, a] = w.getAttribute('data-ayah-key')!.split(':').map(Number);
    if (cur && cur.s === s && cur.a === a && isOpen()) close();
    else open(s, a);
  });
}
