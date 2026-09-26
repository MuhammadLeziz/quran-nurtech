import {
  ayahSrc,
  eaUrl,
  loadIndex,
  loadReciters,
  pickReciterForSurah,
  shortName,
  surahIndex,
  surahUrl,
  type Reciter,
} from './quran-data';
import { $, $$, K, LS, toast } from './shared';
import { markMenu } from './ui-menus';

const DEFAULT_RECITER_ID = 'binhumaid';
// Мусхаф: аяты размечены по словам (много [data-ayah-key] на аят), страницы дорисовываются при листании.
const isMushaf = () => document.body.getAttribute('data-page-mode') === 'mushaf';

export interface Track {
  s: number;
  a: number;
}

export class AudioPlayerController {
  el = $('[data-player]');
  audio = $<HTMLAudioElement>('[data-player-audio]');
  playlist: Track[] = [];
  idx = -1;
  repeatOne = false;
  range: { from: number; to: number } | null = null;
  rangeArm: number | null = null;
  speed = LS.get<number>(K.speed, 1);
  reciterId = LS.get<string>(K.reciter, DEFAULT_RECITER_ID);
  triedFallback = false;
  currentReciter: Reciter | null = null;
  memorize = LS.get<boolean>(K.memorize, false);
  memRep = LS.get<number>(K.memrep, 3);
  memCount = 0;
  preloader: HTMLAudioElement | null = null;
  preloadedUrl = '';
  mushafAyahNotice = false;
  /** Плейлист собран из целых сур (мусхаф): чтение идёт дальше страницы, а не только по её аятам. */
  surahMode = false;

  setPlayerOpen(open: boolean) {
    this.el?.classList.toggle('show', open);
    document.body.classList.toggle('player-open', open);
  }

  async reciter(): Promise<Reciter> {
    const rs = await loadReciters();
    return rs.find((r) => r.id === this.reciterId) || rs[0];
  }

  async reciterName() {
    return (await this.reciter()).name;
  }

  init() {
    if (!this.audio) return;
    const keys = new Set($$('[data-ayah-key]').map((el) => el.getAttribute('data-ayah-key')!));
    this.playlist = Array.from(keys, (k) => {
      const [s, a] = k.split(':').map(Number);
      return { s, a };
    });
    this.audio.playbackRate = this.speed;
    this.updateSpeedLabel();

    $('[data-player-toggle]')?.addEventListener('click', () => this.toggle());
    $('[data-player-next]')?.addEventListener('click', () => this.next());
    $('[data-player-prev]')?.addEventListener('click', () => this.prev());
    $('[data-player-repeat]')?.addEventListener('click', (e) => {
      this.repeatOne = !this.repeatOne;
      (e.currentTarget as Element).classList.toggle('on', this.repeatOne);
      toast(this.repeatOne ? 'Повтор аята включён' : 'Повтор выключен');
    });
    $('[data-player-range]')?.addEventListener('click', (e) => this.armRange(e.currentTarget as Element));
    $('[data-player-speed]')?.addEventListener('click', () => this.cycleSpeed());
    $('[data-player-close]')?.addEventListener('click', () => this.stop());

    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('play', () => this.setIcon(true));
    this.audio.addEventListener('playing', () => {
      this.setLoading(false);
      this.setIcon(true);
    });
    this.audio.addEventListener('waiting', () => this.setLoading(true));
    this.audio.addEventListener('canplay', () => this.setLoading(false));
    this.audio.addEventListener('pause', () => this.setIcon(false));
    this.audio.addEventListener('error', () => this.onError());

    $$('[data-reciter]').forEach((b) =>
      b.addEventListener('click', async () => {
        this.reciterId = b.getAttribute('data-reciter')!;
        LS.set(K.reciter, this.reciterId);
        markMenu('reciter', 'reciter', this.reciterId);
        toast('Чтец: ' + (await this.reciterName()));
        if (this.idx >= 0) this.playIdx(this.idx);
      })
    );

    const rf = $<HTMLInputElement>('[data-reciter-filter]');
    rf?.addEventListener('input', () => {
      const q = rf.value.trim().toLowerCase();
      $$('[data-reciter-list] [data-reciter]').forEach((b) => {
        const hit = !q || (b.getAttribute('data-name') || '').includes(q);
        (b as HTMLElement).style.display = hit ? '' : 'none';
      });
    });

    const sel = $<HTMLSelectElement>('[data-reciter-sel]');
    if (sel) {
      sel.value = this.reciterId;
      sel.addEventListener('change', async () => {
        this.reciterId = sel.value;
        LS.set(K.reciter, this.reciterId);
        toast('Чтец: ' + (await this.reciterName()));
        if (this.idx >= 0) this.playIdx(this.idx);
      });
    }

    markMenu('reciter', 'reciter', this.reciterId);
  }

  keyIdx(s: number, a: number) {
    return this.playlist.findIndex((t) => t.s === s && t.a === a);
  }

  /** Все аяты суры — в мусхафе чтение идёт дальше страницы, а мусхаф листается следом. */
  async surahTracks(s: number): Promise<Track[]> {
    await loadIndex();
    const c = surahIndex.find((x) => x.n === s)?.c || 0;
    return Array.from({ length: c }, (_, i) => ({ s, a: i + 1 }));
  }

  async playKey(s: number, a: number): Promise<void> {
    const cur = this.idx >= 0 ? this.playlist[this.idx] : null;
    if (cur && cur.s === s && cur.a === a) return this.toggle();
    this.memCount = 0;
    // в мусхафе на странице только часть суры — читаем суру целиком с этого аята и дальше
    if (isMushaf() && (!this.surahMode || this.keyIdx(s, a) < 0)) {
      this.playlist = await this.surahTracks(s);
      this.surahMode = true;
    }
    let i = this.keyIdx(s, a);
    if (i < 0) {
      this.playlist = [{ s, a }];
      i = 0;
    }
    this.playIdx(i);
  }

  async playIdx(i: number) {
    if (i < 0 || i >= this.playlist.length || !this.audio) return;
    this.idx = i;
    const t = this.playlist[i];
    if (this.rangeArm != null) this.setRange(i);
    this.setPlayerOpen(true);
    this.highlight(t);
    this.setTitle(t);
    this.setLoading(true);
    this.triedFallback = false;

    const [r0] = await Promise.all([this.reciter(), loadIndex()]);
    if (this.idx !== i || !this.audio) return;

    let r = pickReciterForSurah(r0, t.s);
    if (r.id !== r0.id) toast(`${shortName(r0)} не читал суру — включён ${shortName(r)}`);
    if (isMushaf() && r.type === 'surah') {
      // мусхаф подсвечивает звучащий аят и листается следом — нужен чтец с записью по аятам
      const rs = await loadReciters();
      const byAyah = rs.find((x) => x.id === 'alafasy') || rs.find((x) => x.type !== 'surah');
      if (byAyah) {
        if (!this.mushafAyahNotice) toast(`В мусхафе чтение по аятам: ${shortName(byAyah)}`);
        this.mushafAyahNotice = true;
        r = byAyah;
      }
    }
    const src = r.type === 'surah' ? surahUrl(r, t.s) : ayahSrc(r, t.s, t.a);
    this.currentReciter = r;
    this.setTitle(t);
    this.audio.src = src;
    this.audio.playbackRate = this.speed;
    try {
      await this.audio.play();
    } catch {}
    this.preloadNext();
  }

  peekNextIdx(): number {
    if (this.repeatOne) return -1;
    if (this.memorize && (this.memRep === 0 || this.memCount + 1 < this.memRep)) return -1;
    if (this.range) return this.idx >= this.range.to ? this.range.from : this.idx + 1;
    return this.idx >= 0 && this.idx < this.playlist.length - 1 ? this.idx + 1 : -1;
  }

  async preloadNext() {
    if (this.currentReciter?.type === 'surah') return;
    const ni = this.peekNextIdx();
    if (ni < 0) return;
    const t = this.playlist[ni];
    // в мусхафе чтец мог быть заменён на чтеца по аятам — подгружаем следующий аят у него же
    const r = isMushaf() && this.currentReciter ? this.currentReciter : pickReciterForSurah(await this.reciter(), t.s);
    if (r.type === 'surah') return;
    const url = ayahSrc(r, t.s, t.a);
    if (this.preloadedUrl === url) return;
    this.preloadedUrl = url;
    if (!this.preloader) {
      this.preloader = new Audio();
      this.preloader.preload = 'auto';
    }
    this.preloader.src = url;
    this.preloader.load();
  }

  toggle(): void | Promise<void> {
    if (!this.audio) return;
    if (this.idx < 0 && isMushaf() && this.playlist[0]) return this.playKey(this.playlist[0].s, this.playlist[0].a);
    if (this.idx < 0) return this.playIdx(0);
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  next() {
    this.memCount = 0;
    if (this.range && this.idx >= this.range.to) return this.playIdx(this.range.from);
    this.playIdx(Math.min(this.idx + 1, this.playlist.length - 1));
  }

  prev() {
    this.memCount = 0;
    this.playIdx(Math.max(this.idx - 1, 0));
  }

  stop() {
    this.audio?.pause();
    this.setPlayerOpen(false);
    this.clearHighlight();
    this.idx = -1;
    if (isMushaf()) window.dispatchEvent(new CustomEvent('mushaf:audio-ayah', { detail: null }));
  }

  onEnded() {
    if (this.repeatOne) return this.playIdx(this.idx);
    if (this.currentReciter?.type === 'surah') return this.setIcon(false);
    if (this.memorize) {
      this.memCount++;
      if (this.memRep === 0 || this.memCount < this.memRep) return this.playIdx(this.idx);
      this.memCount = 0;
    }
    if (this.range) {
      if (this.idx >= this.range.to) return this.playIdx(this.range.from);
      return this.playIdx(this.idx + 1);
    }
    if (this.idx < this.playlist.length - 1) this.playIdx(this.idx + 1);
    else if (isMushaf() && this.playlist[this.idx].s < 114) this.continueNextSurah();
    else this.setIcon(false);
  }

  async continueNextSurah() {
    const next = await this.surahTracks(this.playlist[this.idx].s + 1);
    this.playlist = this.playlist.concat(next);
    this.playIdx(this.idx + 1);
  }

  armRange(btn: Element) {
    if (this.range) {
      this.range = null;
      this.rangeArm = null;
      btn.classList.remove('on');
      toast('Повтор диапазона выключен');
      return;
    }
    if (this.idx < 0) return toast('Сначала включите аят');
    this.rangeArm = this.idx;
    btn.classList.add('on');
    toast('Начало диапазона задано. Нажмите ещё раз на конечном аяте.');
  }

  setRange(endIdx: number) {
    if (this.rangeArm == null) return;
    const from = Math.min(this.rangeArm, endIdx);
    const to = Math.max(this.rangeArm, endIdx);
    this.range = { from, to };
    this.rangeArm = null;
    const a = this.playlist[from],
      b = this.playlist[to];
    toast(`Повтор ${a.s}:${a.a}–${b.a}`);
  }

  cycleSpeed() {
    const opts = [0.75, 1, 1.25, 1.5];
    this.speed = opts[(opts.indexOf(this.speed) + 1) % opts.length];
    LS.set(K.speed, this.speed);
    if (this.audio) this.audio.playbackRate = this.speed;
    this.updateSpeedLabel();
  }

  updateSpeedLabel() {
    const l = $('[data-player-speed-label]');
    if (l) l.textContent = this.speed + '×';
  }

  setIcon(playing: boolean) {
    const btn = $('[data-player-toggle]');
    if (btn && !btn.classList.contains('loading')) btn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    this.updateAyahButtons();
  }

  setLoading(on: boolean) {
    const btn = $('[data-player-toggle]');
    if (btn) {
      btn.classList.toggle('loading', on);
      if (!on) btn.innerHTML = this.audio && !this.audio.paused ? ICON_PAUSE : ICON_PLAY;
    }
    this.updateAyahButtons();
  }

  updateAyahButtons() {
    const cur = this.idx >= 0 ? this.playlist[this.idx] : null;
    const playing = !!(this.audio && !this.audio.paused);
    $$('[data-ayah-key] [data-act="play"]').forEach((btn) => {
      const key = (btn.closest('[data-ayah-key]') as Element)?.getAttribute('data-ayah-key');
      const isCur = !!cur && key === `${cur.s}:${cur.a}`;
      btn.classList.toggle('on', isCur);
      btn.innerHTML = isCur && playing ? ICON_PAUSE : ICON_PLAY;
    });
  }

  onError() {
    if (this.idx < 0 || !this.audio) return;
    const r = this.currentReciter;
    const t = this.playlist[this.idx];
    if (r && r.ea && !this.triedFallback) {
      this.triedFallback = true;
      this.audio.src = eaUrl(r, t.s, t.a);
      this.audio.playbackRate = this.speed;
      this.audio.play().catch(() => {});
      return;
    }
    this.setLoading(false);
    toast('Аудио недоступно — попробуйте другого чтеца');
  }

  async setTitle(t: Track) {
    const title = $('[data-player-title]');
    const sub = $('[data-player-sub]');
    const meta = surahIndex.find((s) => s.n === t.s);
    const nr = meta ? meta.nr : 'Сура ' + t.s;
    const isSurah = this.currentReciter?.type === 'surah';
    if (title) title.textContent = isSurah ? `Сура ${nr}` : `${nr} · аят ${t.a}`;
    if (sub) sub.textContent = this.currentReciter ? this.currentReciter.name : await this.reciterName();
    if (!meta) loadIndex().then(() => this.setTitle(t));
  }

  highlight(t: Track) {
    this.clearHighlight();
    if (isMushaf()) {
      // подсветку и перелистывание к звучащему аяту делает мусхаф (mushaf-reader.ts)
      window.dispatchEvent(new CustomEvent('mushaf:audio-ayah', { detail: t }));
      return;
    }
    const el = $(`[data-ayah-key="${t.s}:${t.a}"]`);
    el?.classList.add('active');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  clearHighlight() {
    $$('.ayah.active').forEach((e) => e.classList.remove('active'));
  }
}

export function createAudioPlayer() {
  return new AudioPlayerController();
}

const ICON_PLAY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 4.5v15l13-7.5z" fill="currentColor" stroke="none"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
