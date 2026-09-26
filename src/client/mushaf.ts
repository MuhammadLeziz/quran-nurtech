// Мусхаф (/mushaf/[page]): листание, раскладка, панели и офлайн. Шторка аята — reader-actions.ts.
import { createMushafReader } from './mushaf-reader';
import { initMushafPanels } from './mushaf-panels';

const root = document.querySelector<HTMLElement>('[data-mushaf-reader]');
if (root && document.body.getAttribute('data-page-mode') === 'mushaf') {
  const reader = createMushafReader(root);
  if (reader) initMushafPanels(reader);
}
