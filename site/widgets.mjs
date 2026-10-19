import { keyOf, escapeHTML as esc, studyDay } from './core.mjs';
let favoriteIndex = 0;
export function mountWidgets({ cards, state, cache, audioButton }) {
  const anchor = document.querySelector('.study-links');
  if (!anchor || !cards.length) return;
  document.querySelector('.word-widgets')?.remove();
  // Made By 冷踢踢
  const day = Math.floor(Date.parse(studyDay() + 'T00:00:00+08:00') / 86400000);
  const daily = cards[day % cards.length];
  const favorites = state.favorites.map((k) => cache.get(k)).filter(Boolean);
  const favorite = favorites.length ? favorites[favoriteIndex % favorites.length] : null;
  const card = (entry, title, extra = '') =>
    `<section class="card word-widget"><div class="row between"><span class="eyebrow">${title}</span>${extra}</div>${entry ? `<div class="row between" style="margin-top:18px"><div><button class="widget-word" data-action="modal-entry" data-key="${keyOf(entry)}">${esc(entry.hanji.replace(/【替】/g, ''))}</button><p class="roman">${esc(entry.tailo)}</p></div>${audioButton(entry)}</div><p class="widget-definition">${esc(entry.senses?.[0]?.definition || entry.definition || '')}</p>` : '<p class="small" style="margin-top:20px">把想再練習的詞加入收藏，就能在這裡輪流複習。</p>'}</section>`;
  const wrapper = document.createElement('div');
  wrapper.className = 'word-widgets';
  wrapper.innerHTML =
    card(
      daily,
      '每日一詞',
      `<span class="small">${new Date().toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}</span>`,
    ) +
    card(
      favorite,
      '收藏輪播',
      favorites.length
        ? '<button class="text-btn small" data-rotate-favorite>下一個 →</button>'
        : '',
    );
  wrapper.querySelector('[data-rotate-favorite]')?.addEventListener('click', () => {
    favoriteIndex++;
    mountWidgets({ cards, state, cache, audioButton });
  });
  anchor.before(wrapper);
}
