// Мусхаф: панели «Перейти» (сура/джуз/аят, закладки страниц) и «Вид» (издание, таджвид, размер, офлайн).
import type { MushafEdition } from '../lib/mushaf-layout';
import { loadMeta } from './mushaf-data';
import {
  countCached,
  downloadMushaf,
  formatMb,
  getOfflineState,
  removeMushaf,
  supported as offlineSupported,
} from './mushaf-offline';
import type { MushafReader } from './mushaf-reader';
import { getPageBookmarks, getTajweed, removePageBookmark, setTajweed } from './mushaf-store';
import { toast } from './shared';

const EDITION_NOTE: Record<MushafEdition, string> = {
  v4: 'Издание 1441 г. Комплекса короля Фахда — с цветным таджвидом.',
  v1: 'Классическое издание 1405 г., по которому заучивали многие хафизы. Таджвид цветом не выделен.',
};

export function initMushafPanels(reader: MushafReader) {
  const html = document.documentElement;
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-mushaf-panel]'));
  let lastFocus: HTMLElement | null = null;

  const openPanel = (name: string) => {
    panels.forEach((p) => (p.hidden = p.dataset.mushafPanel !== name));
    const panel = panels.find((p) => p.dataset.mushafPanel === name);
    if (!panel) return;
    lastFocus = document.activeElement as HTMLElement | null;
    document.body.classList.add('mushaf-panel-open');
    if (name === 'nav') renderBookmarks();
    if (name === 'view') syncView();
    panel.querySelector<HTMLElement>('[data-mushaf-close].icon-btn')?.focus({ preventScroll: true });
  };
  const closePanels = () => {
    if (panels.every((p) => p.hidden)) return;
    panels.forEach((p) => (p.hidden = true));
    document.body.classList.remove('mushaf-panel-open');
    lastFocus?.focus?.({ preventScroll: true });
  };

  document.addEventListener('click', (e) => {
    const t = e.target as Element;
    const open = t.closest<HTMLElement>('[data-mushaf-open]');
    if (open) {
      const name = open.dataset.mushafOpen!;
      const panel = panels.find((p) => p.dataset.mushafPanel === name);
      if (panel && !panel.hidden) closePanels();
      else openPanel(name);
      return;
    }
    if (t.closest('[data-mushaf-close]')) closePanels();
    const edBtn = t.closest<HTMLElement>('[data-mushaf-edition]');
    if (edBtn) {
      reader.setEdition(edBtn.dataset.mushafEdition === 'v1' ? 'v1' : 'v4');
      syncView();
      return;
    }
    if (t.closest('[data-mushaf-tajweed]')) {
      if (reader.edition === 'v1') return;
      const on = !getTajweed();
      setTajweed(on);
      html.toggleAttribute('data-mushaf-tajweed', false);
      if (!on) html.setAttribute('data-mushaf-tajweed', 'off');
      syncView();
      return;
    }
    const bmRemove = t.closest<HTMLElement>('[data-mushaf-bm-remove]');
    if (bmRemove) {
      removePageBookmark(Number(bmRemove.dataset.mushafBmRemove));
      renderBookmarks();
      window.dispatchEvent(new CustomEvent('mushaf:bookmarks-changed'));
      return;
    }
    const bmGo = t.closest<HTMLElement>('[data-mushaf-bm-go]');
    if (bmGo) {
      e.preventDefault();
      reader.goTo(Number(bmGo.dataset.mushafBmGo), { push: true });
      closePanels();
      return;
    }
    const off = t.closest<HTMLElement>('[data-mushaf-offline]');
    if (off) offlineAction(off.dataset.mushafOffline!);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanels();
  });
  window.addEventListener('mushaf:navigated', closePanels);
  window.addEventListener('mushaf:bookmarks', renderBookmarks);

  // ---------------------------------------------------------------- закладки страниц
  const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
  async function renderBookmarks() {
    const list = document.querySelector<HTMLElement>('[data-mushaf-bm-list]');
    const empty = document.querySelector<HTMLElement>('[data-mushaf-bm-empty]');
    if (!list) return;
    const items = getPageBookmarks();
    if (empty) empty.hidden = items.length > 0;
    let names: { n: number; nr: string; p: number }[] = [];
    try {
      names = (await loadMeta()).suraPages;
    } catch {}
    const surahAt = (p: number) => names.filter((s) => s.p <= p).pop();
    list.replaceChildren(
      ...items.map((b) => {
        const li = document.createElement('li');
        const s = surahAt(b.p);
        li.innerHTML =
          `<a href="/mushaf/${b.p}" data-mushaf-bm-go="${b.p}"><b>Страница ${b.p}</b>` +
          `<span>${s ? `${s.n}. ${s.nr}` : ''} · ${dateFmt.format(b.t)}</span></a>` +
          `<button type="button" class="icon-btn" data-mushaf-bm-remove="${b.p}" aria-label="Убрать закладку со страницы ${b.p}" title="Убрать">` +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
        return li;
      })
    );
  }

  // ---------------------------------------------------------------- вид
  function syncView() {
    const ed = reader.edition;
    document.querySelectorAll<HTMLElement>('[data-mushaf-edition]').forEach((b) => {
      const on = b.dataset.mushafEdition === ed;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    const note = document.querySelector('[data-mushaf-edition-note]');
    if (note) note.textContent = EDITION_NOTE[ed];
    const tj = document.querySelector<HTMLElement>('[data-mushaf-tajweed]');
    if (tj) {
      const on = ed === 'v4' && getTajweed();
      tj.setAttribute('aria-checked', String(on));
      tj.setAttribute('aria-disabled', String(ed === 'v1'));
      tj.querySelector('.switch')?.classList.toggle('on', on);
      const small = tj.querySelector('[data-mushaf-tajweed-note]');
      if (small) small.textContent = ed === 'v1' ? 'Есть только в издании 1441 г.' : 'Цвет подсказывает правило чтения';
    }
    const legend = document.querySelector<HTMLElement>('[data-mushaf-legend]');
    if (legend) legend.hidden = ed === 'v1';
    syncOffline();
  }

  // ---------------------------------------------------------------- офлайн
  let job: AbortController | null = null;
  const offEl = (sel: string) => document.querySelector<HTMLElement>(sel);

  async function syncOffline(progress?: { done: number; total: number; bytes: number }) {
    const status = offEl('[data-mushaf-offline-status]');
    const bar = offEl('[data-mushaf-offline-bar]');
    const dl = offEl('[data-mushaf-offline="download"]');
    const cancel = offEl('[data-mushaf-offline="cancel"]');
    const remove = offEl('[data-mushaf-offline="remove"]');
    const label = offEl('[data-mushaf-offline-label]');
    if (!status || !bar || !dl || !cancel || !remove || !label) return;
    const edName = reader.edition === 'v1' ? '1405' : '1441';
    if (!offlineSupported()) {
      status.textContent = 'Этот браузер не умеет хранить страницы для офлайна.';
      dl.hidden = true;
      return;
    }
    if (progress) {
      bar.hidden = false;
      bar.style.setProperty('--p', String(progress.done / Math.max(1, progress.total)));
      status.textContent = `Скачиваю издание ${edName}: ${progress.done} из ${progress.total} · ${formatMb(progress.bytes)}`;
      dl.hidden = true;
      cancel.hidden = false;
      remove.hidden = true;
      return;
    }
    bar.hidden = true;
    cancel.hidden = true;
    dl.hidden = false;
    const saved = getOfflineState(reader.edition);
    const have = saved ? await countCached(reader.edition) : 0;
    const full = have >= 1208;
    remove.hidden = !saved;
    label.textContent = saved && !full ? 'Докачать' : full ? 'Проверить обновления' : 'Скачать мусхаф';
    status.textContent = saved
      ? full
        ? `Издание ${edName} сохранено на устройстве · ${formatMb(saved.bytes)}. Мусхаф открывается без интернета.`
        : `Издание ${edName} скачано не полностью (${Math.round((have / 1208) * 100)}%).`
      : reader.edition === 'v1'
        ? 'Сохранит 604 страницы издания 1405 г. и переводы — около 55 МБ.'
        : 'Сохранит 604 страницы с таджвидом и переводы — около 58 МБ.';
  }

  async function offlineAction(action: string) {
    if (action === 'cancel') {
      job?.abort();
      return;
    }
    if (action === 'remove') {
      await removeMushaf(reader.edition);
      toast('Офлайн-копия удалена');
      syncOffline();
      return;
    }
    if (job) return;
    job = new AbortController();
    const edition = reader.edition;
    try {
      await downloadMushaf(edition, (s) => syncOffline(s), job.signal);
      toast('Мусхаф доступен без интернета');
    } catch (e) {
      if ((e as Error).name === 'AbortError') toast('Загрузка остановлена');
      else toast('Скачалось не всё — нажмите «Докачать», когда появится сеть');
    } finally {
      job = null;
      syncOffline();
    }
  }
}
