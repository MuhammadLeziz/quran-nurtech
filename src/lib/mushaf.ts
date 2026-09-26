import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clampPage,
  pageDataDir,
  type MushafEdition,
  type MushafPage,
  type MushafSurahInfo,
} from './mushaf-layout';

export {
  BASMALA,
  MUSHAF_TOTAL_PAGES,
  pageFontCss,
  pageHasBasmala,
  renderSheetHtml,
  type MushafEdition,
  type MushafPage,
  type MushafPageDeco,
  type MushafPageLine,
  type MushafPageStart,
  type MushafPageWord,
} from './mushaf-layout';

const ROOT = process.cwd();

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

export interface MushafMeta {
  pages: number;
  suraStart: Record<string, number>;
  juzStart: Record<string, number>;
  pageJuz: Record<string, number>;
  suraPages: MushafSurahInfo[];
}

export function getMushafPage(page: number, edition: MushafEdition = 'v4'): MushafPage {
  return readJson<MushafPage>(join(ROOT, 'data', pageDataDir(edition), `${clampPage(page)}.json`));
}

export function getMushafMeta(): MushafMeta {
  return readJson<MushafMeta>(join(ROOT, 'data', 'mushaf-pages', 'meta.json'));
}

export function getMushafSurah(meta: MushafMeta, surah: number) {
  return meta.suraPages.find((s) => s.n === surah);
}
