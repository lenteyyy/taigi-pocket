import { escapeHTML } from './core.mjs';

// Made By 冷踢踢。各處例句共用原始華語翻譯，避免學習頁遺漏。
export function exampleTranslationHTML(example) {
  if (!example?.huagi?.trim()) return '';
  return `<p class="translation" lang="zh-Hant-TW"><span class="translation-label">華語：</span>${escapeHTML(example.huagi)}</p>`;
}
