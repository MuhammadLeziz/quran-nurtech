// Клиентская точка сборки Корана онлайн. Ванильный TS, бандлится Astro.
import { createAudioPlayer } from './audio-player';
import { initBookmarks, initContinue, toggleBookmark } from './bookmarks';
import { initDrawer } from './drawer';
import { initHomeFilter } from './home-filter';
import { initHotkeys } from './hotkeys';
import { initHapticInteractions } from './interactions';
import { initMemorize } from './memorize';
import { initMushafLinks } from './mushaf-store';
import { initQuick } from './quick-nav';
import { DV, loadIndex } from './quran-data';
import { initReadingAnalytics } from './reading-analytics';
import { initAyahActions, initAyahContextMenu, initMushafAyahSheet } from './reader-actions';
import {
  initReading,
  initTheme,
  initTranslation,
  initTransShow,
  initView,
  setViewHotkey,
} from './reader-settings';
import { initTajweed } from './tajweed';
import { closeMenus, initMenus } from './ui-menus';

const player = createAudioPlayer();

/* ==========================================================================
   Старт
   ========================================================================== */
function boot() {
  initHomeFilter();
  initMemorize(player);
  initTheme();
  initReading();
  initView();
  initTranslation();
  initMenus();
  initDrawer({ dataVersion: DV, loadIndex });
  initTransShow();
  initTajweed(DV);
  initQuick({ loadIndex });
  initBookmarks();
  initContinue();
  initMushafLinks();
  initAyahActions({ player });
  initAyahContextMenu({ player });
  initMushafAyahSheet({ player });
  initReadingAnalytics();
  player.init();
  initHotkeys({ player, setViewHotkey, toggleBookmark, closeMenus });
  initHapticInteractions();
  loadIndex(); // прогреть индекс для плеера/заголовков
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
