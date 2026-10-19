import { request, audioURL, exampleHasAudio } from './api.mjs';
import { mountWidgets } from './widgets.mjs';
import {
  keyOf,
  escapeHTML as esc,
  loadState,
  STORAGE_KEY,
  nextReview,
  buildDailyPlan,
  dailyLimit,
  recordStudyActivity,
  normalizeRoman,
  numberToTone,
  judgeSpelling,
  chooseOptions,
  parseCSV,
  csvCell,
  validateBackup,
  numericRoman,
} from './core.mjs';
import { LESSONS, LESSON_SOURCE, MANUAL_SOURCE } from './lessons.mjs';

const $ = (s) => document.querySelector(s);
const icons = {
  search: 'm21 21-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  bookmark: 'M6 3h12v19l-6-4-6 4Z',
  clock: 'M12 8v5l4 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  read: 'M3 5c4-2 7-1 9 1 3-2 6-3 9-1v15c-4-2-7-1-9 1-3-2-6-3-9-1Z M12 6v15',
  learn: 'm2 8 10-5 10 5-10 5Z M6 10v7c4 3 8 3 12 0v-7 M22 8v8',
  list: 'M5 4h14v17H5Z M8 8h8 M8 12h8 M8 16h5',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  sound: 'M4 9h4l5-5v16l-5-5H4Z M17 8q4 4 0 8 M20 5q6 7 0 14',
  arrow: 'm9 5 7 7-7 7',
  back: 'm15 5-7 7 7 7',
  close: 'm6 6 12 12 M6 18 18 6',
  plus: 'M12 4v16 M4 12h16',
  check: 'm5 12 4 4L20 5',
  download: 'M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4',
  upload: 'M12 16V4 m-5 5 5-5 5 5 M4 17v4h16v-4',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1',
  moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11',
  flag: 'M5 22V3c5-3 9 4 14 0v11c-5 4-9-3-14 0',
  refresh: 'M20 7V2l-4 4 M4 17v5l4-4 M20 7a9 9 0 0 0-15 0 M4 17a9 9 0 0 0 15 0',
  info: 'M12 11v7 M12 7v.1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.read}"/></svg>`;
let state = loadState(),
  page = 'search',
  meta = null,
  cards = [],
  selected = null,
  query = '',
  searchMode = 'prefix',
  category = '',
  searchToken = 0,
  offset = 0,
  searchResults = [],
  searchTotal = 0,
  listKey = 'favorites',
  listFilter = '',
  listStatus = 'all',
  readingText = '',
  tokens = [],
  tokenChoices = null,
  sessionOptions = [],
  sessionPool = [],
  answered = null,
  unitQuiz = null;
const entryCache = new Map();
// Made By 冷踢踢
let viewVersion = 0,
  entryTicket = 0,
  playbackTicket = 0;
const noteDrafts = new Map();
const audio = new Audio();
audio.preload = 'none';
audio.volume = 0.8;
audio.dataset.volume = String(audio.volume);
audio.id = 'pronunciation-player';
audio.hidden = true;
document.body.append(audio);
let currentAudioButton = null,
  toastTimer;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    toast('儲存空間不足，請先匯出備份。');
    return false;
  }
}
function prefs() {
  audio.volume = state.prefs.volume ?? 0.8;
  audio.dataset.volume = String(audio.volume);
  document.documentElement.style.setProperty('--base', state.prefs.font + 'px');
  document.body.classList.toggle('dark', state.prefs.theme === 'dark');
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 4000);
}
const marker = (m) => ({ bun: '文讀', peh: '白讀', siok: '俗讀' })[m] || '';
const wordLabel = (e) => e.hanji.replace(/【替】/g, '');
function brandLogos() {
  return '<div class="brand-logos"><span class="personal-logo"><img src="./assets/lenteyyy-logo.png" alt="Lenteyyy 個人 Logo" width="512" height="512"></span><span class="brand-mark" aria-label="台語小辭典 Logo">台</span></div>';
}
function header(title) {
  return `<header class="page-header"><div class="mobile-brand">${brandLogos()}</div><div class="page-title"><div class="eyebrow">台語小辭典</div><h1>${title}</h1></div><button class="icon-btn header-settings" data-action="settings" aria-label="閱讀設定">${icon('settings')}</button></header>`;
}
function sidebar() {
  const nav = [
    ['search', 'search', '查詞'],
    ['favorites', 'bookmark', '收藏'],
    ['history', 'clock', '瀏覽紀錄'],
    ['reading', 'read', '讀音'],
    ['study', 'learn', '學習'],
    ['lists', 'list', '詞表'],
  ];
  $('#sidebar').innerHTML =
    `<div class="brand">${brandLogos()}<div><div class="brand-name">台語小辭典</div><div class="brand-sub">Tâi-gí sió sû-tián</div></div></div><nav class="nav">${nav.map(([id, i, title]) => `<button ${meta ? '' : 'disabled'} data-action="nav" data-page="${id}" class="${page === id ? 'active' : ''}" ${page === id ? 'aria-current="page"' : ''}>${icon(i)}<span>${title}</span>${id === 'favorites' && state.favorites.length ? `<span class="badge">${state.favorites.length}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-foot"><button class="settings-btn" data-action="settings">${icon('settings')}閱讀設定與備份</button><button class="settings-btn" data-action="sources" ${meta ? '' : 'disabled'}>${icon('info')}資料來源</button><div style="margin-top:14px;font-size:13px">Made By 冷踢踢</div></div>`;
}
const empty = (title, text, i = 'read') =>
  `<div class="empty">${icon(i)}<h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;
function navigate(next) {
  if (!['search', 'favorites', 'history', 'reading', 'study', 'lists'].includes(next)) return;
  if (page === 'reading') readingScroll = $('.reading-editor')?.scrollTop || 0;
  viewVersion++;
  entryTicket++;
  page = next;
  tokenChoices = null;
  sidebar();
  if (['search', 'favorites', 'history'].includes(page)) renderDictionary();
  else if (page === 'reading') renderReading();
  else if (page === 'study') renderStudy();
  else if (page === 'lists') renderLists();
}

function searchTools() {
  return `<div class="search-tools"><div class="search-box">${icon('search')}<input id="search-input" type="search" value="${esc(query)}" placeholder="漢字、臺羅、白話字" aria-label="搜尋詞目" autocomplete="off"><button data-action="clear-search" class="clear" aria-label="清除搜尋">${icon('close')}</button></div><div class="segments" aria-label="搜尋方式">${[
    ['prefix', '前綴'],
    ['contains', '包含'],
    ['suffix', '後綴'],
    ['wildcard', '萬用字元'],
  ]
    .map(
      ([id, label]) =>
        `<button data-action="search-mode" data-mode="${id}" class="${searchMode === id ? 'active' : ''}" aria-pressed="${searchMode === id}">${label}</button>`,
    )
    .join(
      '',
    )}</div>${searchMode === 'wildcard' ? '<p class="small" style="margin-top:10px">＊任意字數，? 一個字。例如：日*子</p>' : ''}${category ? `<button class="text-btn small" data-action="clear-category">${esc(meta.categories.find((x) => String(x.id) === category)?.name || '主題')} ${icon('close')}</button>` : ''}</div>`;
}
function rowHTML(e) {
  const k = keyOf(e);
  return `<button class="entry-row ${selected && keyOf(selected) === k ? 'selected' : ''}" data-action="entry" data-key="${k}"><div class="row"><span class="hanji">${esc(wordLabel(e))}</span>${marker(e.marker) ? `<span class="pill">${marker(e.marker)}</span>` : ''}${state.favorites.includes(k) ? `<span style="color:var(--blue);margin-left:auto">${icon('bookmark')}</span>` : ''}</div><div class="roman">${esc(e.tailo)}</div>${e.definition ? `<div class="snippet">${esc(e.definition)}</div>` : ''}</button>`;
}
async function renderDictionary() {
  const version = ++viewVersion;
  const names = { search: '查詞', favorites: '收藏', history: '瀏覽紀錄' };
  $('#main').innerHTML =
    header(
      names[page],
      page === 'search' ? '教育部詞典 ＋ 台文華文線頂辭典' : '每一個詞，都可以再聽一次。',
    ) +
    `<div class="dictionary"><section class="results" aria-label="詞目列表">${page === 'search' ? searchTools() : `<div class="search-tools row between"><h2>${names[page]}</h2>${page === 'history' && state.history.length ? '<button class="text-btn small" data-action="clear-history">清除紀錄</button>' : ''}</div>`}<div id="result-list"></div></section><article class="detail" id="detail" aria-label="詞目內容">${selected ? detailHTML(selected) : empty('今天想學什麼？', '輸入一個漢字或臺羅，或選擇左邊的主題。')}</article></div>`;
  if (page === 'search') {
    bindSearch();
    loadSearch();
  } else {
    const keys =
      page === 'favorites' ? state.favorites : [...new Set(state.history.map((x) => x.key))];
    if (!keys.length) {
      $('#result-list').innerHTML = empty(
        page === 'favorites' ? '還沒有收藏' : '還沒有瀏覽紀錄',
        page === 'favorites'
          ? '在詞目右上方點選書籤，就能留在這裡。'
          : '開啟過的詞目會顯示在這裡。',
        page === 'favorites' ? 'bookmark' : 'clock',
      );
      return;
    }
    try {
      const entries = await getEntries(keys);
      if (version !== viewVersion || !['favorites', 'history'].includes(page)) return;
      $('#result-list').innerHTML =
        `<div class="result-count">${entries.length} 個詞目</div>` + entries.map(rowHTML).join('');
    } catch (e) {
      toast(e.message);
    }
  }
}
function bindSearch() {
  let timer;
  $('#search-input').addEventListener('input', (event) => {
    if (event.isComposing) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = event.target.value;
      offset = 0;
      loadSearch();
    }, 220);
  });
  $('#search-input').addEventListener('compositionend', (event) => {
    clearTimeout(timer);
    query = event.target.value;
    offset = 0;
    loadSearch();
  });
}
async function loadSearch(append = false) {
  const ticket = ++searchToken;
  if (!append) offset = 0;
  const resultEl = $('#result-list');
  if (!resultEl) return;
  if (!query && !category) {
    resultEl.innerHTML = `<div class="theme-title">依主題瀏覽</div>${meta.categories.map((c) => `<button class="category-row" data-action="category" data-id="${c.id}"><span>${esc(c.name)}</span><span>${c.entry_count.toLocaleString('zh-TW')} ${icon('arrow')}</span></button>`).join('')}`;
    return;
  }
  if (!append) resultEl.innerHTML = '<div class="loading">正在查詢…</div>';
  try {
    const result = await request(
      '/api/search?' + new URLSearchParams({ q: query, mode: searchMode, category, offset }),
    );
    if (ticket !== searchToken || page !== 'search') return;
    searchResults = append ? [...searchResults, ...result.entries] : result.entries;
    searchTotal = result.total;
    const note =
      result.source === 'soannteng'
        ? '教育部詞典查無結果，改查線頂辭典'
        : result.via
          ? `依${result.via}找到`
          : '';
    resultEl.innerHTML =
      `<div class="result-count">${note ? esc(note) + '<br>' : ''}共 ${result.total.toLocaleString('zh-TW')} 個詞目</div>` +
      (searchResults.length
        ? searchResults.map(rowHTML).join('')
        : empty('查無詞目', '可以試試不加調符，或改用「包含」搜尋。', 'search')) +
      (searchTotal > searchResults.length
        ? '<div style="padding:20px;text-align:center"><button class="secondary" data-action="more-results">顯示更多</button></div>'
        : '');
  } catch (e) {
    if (ticket === searchToken) resultEl.innerHTML = empty('暫時無法查詞', e.message);
  }
}
async function getEntry(key) {
  if (entryCache.has(key)) return entryCache.get(key);
  const [source, id] = key.split(':');
  const e = await request('/api/entry?' + new URLSearchParams({ source, id }));
  entryCache.set(key, e);
  return e;
}
async function getEntries(keys) {
  const results = [];
  for (let i = 0; i < keys.length; i += 200) {
    const group = keys.slice(i, i + 200);
    const missing = group.filter((k) => !entryCache.has(k));
    if (missing.length) {
      const es = await request('/api/entries?' + new URLSearchParams({ ids: missing.join(',') }));
      es.forEach((e) => entryCache.set(keyOf(e), e));
    }
    results.push(...group.map((k) => entryCache.get(k)).filter(Boolean));
  }
  return results;
}
function audioButton(e, example = 0, large = false, label = '') {
  if (example && !exampleHasAudio(example))
    return `<a class="icon-btn" href="https://sutian.moe.edu.tw/zh-hant/su/${e.id}/" target="_blank" rel="noopener" aria-label="至教育部聽例句錄音" title="至教育部詞目頁聆聽例句">${icon('sound')}</a>`;
  const available = example ? true : e.audio;
  return `<button class="${large ? 'big-play' : 'icon-btn'}" data-action="audio" data-key="${keyOf(e)}" ${example ? `data-example="${example}"` : ''} ${available ? '' : 'disabled'} aria-label="${esc(label || '播放' + (example ? '例句' : '詞目') + '錄音')}" title="${available ? '播放教育部錄音' : '未提供錄音'}">${icon('sound')}</button>`;
}
// Made By 冷踢踢
function notesHTML(key) {
  const text = noteDrafts.has(key) ? noteDrafts.get(key) : state.notes[key] || '';
  return `<details class="private-note" ${text ? 'open' : ''}><summary>私人筆記${text ? ' · 已有內容' : ''}</summary><form data-note-key="${key}"><label>私人筆記<textarea name="note" aria-label="私人筆記" maxlength="2000" rows="3" placeholder="記下自己的例句或使用情境">${esc(text)}</textarea></label><div class="row between wrap"><span class="small">僅存於此瀏覽器，包含在備份中。</span><button type="submit" class="secondary">儲存筆記</button></div></form></details>`;
}
function detailHTML(e) {
  const k = keyOf(e);
  const progress = state.progress[k];
  return `<button class="mobile-back" data-action="mobile-back">${icon('back')}回到${page === 'reading' ? '文章' : '詞目列表'}</button>${tokenChoices ? `<div class="readings-choices"><span class="small">這個詞的候選讀音</span><div>${tokenChoices.map((x) => `<button data-action="choose-reading" data-key="${keyOf(x)}">${esc(x.tailo)} ${marker(x.marker)}</button>`).join('')}</div>` : ''}<div class="detail-top"><div><h2 class="word-head">${esc(wordLabel(e))}</h2><div class="word-roman">${esc(e.tailo)}</div><div class="word-sub">${marker(e.marker) ? `<span class="pill blue">${marker(e.marker)}</span>` : ''}${e.hanji.includes('【替】') ? '<span class="pill">替用字</span>' : ''}${e.variants?.length ? `<span class="muted">異用字：${e.variants.map(esc).join('、')}</span>` : ''}${progress ? `<span class="pill green">已學過</span>` : ''}</div></div><div class="detail-actions">${audioButton(e)}<button class="icon-btn ${state.favorites.includes(k) ? 'active' : ''}" data-action="favorite" data-key="${k}" aria-label="${state.favorites.includes(k) ? '取消收藏' : '加入收藏'}">${icon('bookmark')}</button><button class="icon-btn" data-action="add-to-list" data-key="${k}" aria-label="加入詞表">${icon('plus')}</button></div></div>${e.source === 'soannteng' ? `<div class="source-note">台文華文線頂辭典${e.poj ? ` · 白話字 ${esc(e.poj)}` : ''}</div>` : ''}${e.readings?.length > 1 ? `<div class="source-note">收錄讀音：${e.readings.map(esc).join('／')}。錄音為官方提供的主音讀。</div>` : ''}${notesHTML(k)}<div class="categories">${(e.categories || []).map((x) => `<span class="pill blue">${esc(x.name)}</span>`).join('')}</div>${e.senses?.length ? e.senses.map((s, i) => `<section class="sense"><div class="sense-head"><span class="sense-number">${i + 1}</span>${s.pos ? `<span class="pill">${esc(s.pos)}</span>` : ''}</div><p class="definition">${esc(s.definition)}</p>${(s.examples || []).map((ex) => `<div class="example"><div class="row"><p class="example-hanji">${esc(ex.hanji)}</p>${ex.audio_basename ? audioButton(e, ex.id) : ''}</div><p class="roman">${esc(ex.tailo)}</p>${ex.huagi ? `<p class="translation">${esc(ex.huagi)}</p>` : ''}</div>`).join('')}</section>`).join('') : '<div class="sense"><p class="muted">這筆資料未另列釋義，可參考相關詞目。</p></div>'}${e.alternates?.length ? `<details class="fold"><summary>其他讀音</summary>${e.alternates.map((x) => `<div class="dialect-row">${esc(x.hanji)}　<span class="muted">${esc(x.tailo_raw)}</span></div>`).join('')}</details>` : ''}${e.relations?.length ? `<div class="section-heading"><h3>相關詞目</h3></div><div class="relation-list">${e.relations.map((r) => `<button class="relation" data-action="entry" data-key="moe:${r.id}">${esc(r.hanji)}<span>${r.type === 'synonym' ? '近義' : r.type === 'antonym' ? '反義' : '相關'}　${esc(r.tailo)}</span></button>`).join('')}</div>` : ''}${e.dialects?.length ? `<details class="fold"><summary>各地用語比較</summary>${e.dialects.map((d) => `<div class="dialect-row"><small>${esc(d.accent)}</small><div>${esc(d.hanji)}　<span class="muted">${esc(d.tailo_raw)}</span></div></div>`).join('')}</details>` : ''}${e.accentVariants?.length ? `<details class="fold"><summary>方言差異</summary>${e.accentVariants.map((d) => `<div class="dialect-row"><small>${esc(d.accent_region)}</small><div>${esc(d.hanji)}　${esc(d.tailo_raw)}</div></div>`).join('')}</details>` : ''}<div class="source-note">${e.source === 'soannteng' ? '台文華文線頂辭典｜鄭良偉、楊允言與校對義工｜CC BY-SA 4.0' : '教育部《臺灣台語常用詞辭典》｜CC BY-ND 3.0 臺灣'}<br>釋義、例句及錄音依原始資料呈現。${e.source === 'moe' ? `<a href="https://sutian.moe.edu.tw/zh-hant/su/${e.id}/" target="_blank" rel="noopener">查看原始詞目</a>` : ''}</div>`;
}
async function openEntry(key, { modal = false, history = true } = {}) {
  const ticket = ++entryTicket,
    version = viewVersion;
  try {
    const e = await getEntry(key);
    if (ticket !== entryTicket || version !== viewVersion) return;
    if (history) {
      state.history = [
        { key, time: Date.now() },
        ...state.history.filter((x) => x.key !== key),
      ].slice(0, 150);
      save();
    }
    if (modal) {
      showDialog('詞目內容', `<div class="detail">${detailHTML(e)}</div>`);
      return;
    }
    selected = e;
    const el = $('#detail');
    if (el) {
      el.innerHTML = detailHTML(e);
      el.scrollTop = 0;
      $('.dictionary,.reading-grid')?.classList.add('mobile-detail');
      document
        .querySelectorAll('.entry-row')
        .forEach((x) => x.classList.toggle('selected', x.dataset.key === key));
    } else openEntry(key, { modal: true, history: false });
  } catch (e) {
    toast(e.message);
  }
}
function showDialog(title, body) {
  entryTicket++;
  $('#dialog-content').innerHTML =
    `<div class="dialog-head"><h2>${esc(title)}</h2><button class="icon-btn" data-action="close-dialog" aria-label="關閉">${icon('close')}</button></div><div class="dialog-body">${body}</div>`;
  if (!$('#dialog').open) $('#dialog').showModal();
}
function updateFavorite(key) {
  if (state.favorites.includes(key)) state.favorites = state.favorites.filter((x) => x !== key);
  else state.favorites.unshift(key);
  save();
  sidebar();
  document.querySelectorAll(`[data-action="favorite"][data-key="${key}"]`).forEach((b) => {
    const yes = state.favorites.includes(key);
    b.classList.toggle('active', yes);
    b.setAttribute('aria-label', yes ? '取消收藏' : '加入收藏');
  });
  toast(state.favorites.includes(key) ? '已加入收藏' : '已取消收藏');
  if (page === 'favorites') renderDictionary();
}

async function playSound(button, key, example = 0, sound = '') {
  const ticket = ++playbackTicket;
  if (currentAudioButton) currentAudioButton.classList.remove('playing');
  audio.pause();
  currentAudioButton = button;
  button?.classList.add('playing');
  try {
    const e = key ? await getEntry(key) : null;
    if (ticket !== playbackTicket) return;
    const label = sound
      ? `範例音 ${sound}`
      : e
        ? (example ? '例句：' : '') + wordLabel(e)
        : '臺語錄音';
    $('#player').innerHTML =
      `${icon('sound')}<span>正在載入：${esc(label)}</span><button data-action="stop-audio" aria-label="停止播放">${icon('close')}</button>`;
    $('#player').hidden = false;
    audio.src = await audioURL(e, example, sound);
    if (ticket !== playbackTicket) return;
    await audio.play();
    if (ticket !== playbackTicket) return;
    $('#player span').textContent = '正在播放：' + label;
  } catch {
    if (ticket !== playbackTicket) return;
    if (audio.error || audio.readyState === 0) toast('音檔暫時無法播放，請確認網路後再試一次。');
    stopAudio();
  }
}
function stopAudio() {
  playbackTicket++;
  audio.pause();
  currentAudioButton?.classList.remove('playing');
  currentAudioButton = null;
  $('#player').hidden = true;
}
audio.addEventListener('ended', stopAudio);

function renderReadingBase() {
  const editor = `<section class="reading-editor"><label class="field-label" for="reading-input">貼上台語漢字或文章</label><textarea id="reading-input" maxlength="5000" placeholder="例如：今仔日天氣真好。">${esc(readingText)}</textarea><div class="row between"><button class="primary" data-action="annotate">${icon('read')}標示讀音</button><button class="text-btn small" data-action="reading-example">試試範例</button></div><p class="small">依詞典標示本調，請依語意確認候選讀音。點選詞語可查釋義、選讀音或聽錄音；虛線為未收錄的字詞。</p><div id="annotation" class="annotation">${annotationHTML()}</div>${state.sentences.length ? `<div class="section-heading"><h3>讀過的句子</h3></div><div class="reading-history">${state.sentences.map((x, i) => `<button data-action="past-sentence" data-index="${i}">${esc(x.slice(0, 22))}${x.length > 22 ? '…' : ''}</button>`).join('')}</div>` : ''}</section>`;
  $('#main').innerHTML =
    header('讀音與閱讀', '讀一段台文，認識每個詞。') +
    `<div class="reading-grid">${editor}<article class="detail" id="detail">${selected ? detailHTML(selected) : empty('點選文章中的詞語', '候選讀音與詞目釋義會顯示在這裡。')}</article></div>`;
}
function annotationHTML() {
  return tokens
    .map((t, i) =>
      t.kind === 'punct'
        ? esc(t.text)
        : `<button class="token ${t.kind === 'unknown' ? 'unknown' : ''}" data-action="token" data-index="${i}" ${t.kind === 'unknown' ? 'disabled' : ''}><span class="roman">${esc(t.chosen?.tailo || t.entries[0]?.tailo || '未收錄')}</span><strong>${esc(t.text)}</strong></button>`,
    )
    .join('');
}
async function annotateText() {
  const version = viewVersion;
  readingText = $('#reading-input').value.trim();
  if (!readingText) {
    toast('請先輸入一段台語漢字。');
    return;
  }
  const b = $('[data-action="annotate"]');
  b.disabled = true;
  try {
    tokens = await request('/api/annotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: readingText }),
    });
    state.sentences = [readingText, ...state.sentences.filter((s) => s !== readingText)].slice(
      0,
      20,
    );
    save();
    if (page === 'reading' && version === viewVersion) renderReading();
  } catch (e) {
    toast(e.message);
  } finally {
    if (b.isConnected) b.disabled = false;
  }
}

function studyStats(pool = cards) {
  const now = Date.now();
  pool = pool.filter((e) => e.senses?.[0]?.definition);
  return {
    available: pool.length,
    due: pool.filter((e) => state.progress[keyOf(e)]?.due <= now).length,
    new: pool.filter((e) => !state.progress[keyOf(e)]).length,
    learned: pool.filter((e) => state.progress[keyOf(e)]).length,
  };
}
function studySummaryHTML() {
  const plan = buildDailyPlan(
    cards.filter((e) => e.senses?.[0]?.definition),
    state,
  );
  return `<section class="study-banner"><div><h2>今日學習</h2><p>待複習 ${plan.reviewCount} 個　新詞 ${plan.newCount} 個</p></div><button class="primary" data-action="${state.session ? 'resume-study' : 'start-study'}" data-deck="all" ${!state.session && !plan.queue.length ? 'disabled' : ''}>${icon(state.session ? 'refresh' : 'learn')}${state.session ? '繼續學習' : '開始學習'}</button></section>
    <form id="daily-plan-form" class="card daily-plan-form">
      <h2>每日學習設定</h2>
      <div class="daily-plan-fields">
        <label for="daily-review-limit">每日複習<input id="daily-review-limit" name="reviewCount" type="number" min="0" max="1000" step="1" required value="${state.prefs.reviewLimit}"><span class="small">個詞</span></label>
        <label for="daily-new-limit">每日新詞<input id="daily-new-limit" name="newCount" type="number" min="0" max="1000" step="1" required value="${state.prefs.newLimit}"><span class="small">個詞</span></label>
        <button class="primary" type="submit">儲存設定</button>
      </div>
    </form>
    <div class="stats"><div class="stat"><strong>${plan.reviewDone}／${plan.reviewLimit}</strong><span>今日已複習</span></div><div class="stat"><strong>${plan.newDone}／${plan.newLimit}</strong><span>今日已新學</span></div><div class="stat"><strong>${Object.keys(state.progress).length}</strong><span>已學過的詞</span></div></div>`;
}
function renderStudyBase() {
  if (state.session && sessionPool.length) {
    renderSession();
    return;
  }
  $('#main').innerHTML =
    header('學習', '每天幾個詞，一點一點累積。') +
    `<div class="content">${studySummaryHTML()}<div class="study-links"><button data-action="start-study" data-deck="favorites">${icon('bookmark')}從收藏學習</button><button data-action="studied-list">${icon('list')}已學過的詞</button><button data-action="start-study" data-deck="all" data-mode="dictation">${icon('sound')}臺羅聽寫</button></div><div class="section-heading"><h2>常用 700 字詞</h2><span class="pill blue">七課全部開放</span></div><p class="small" style="margin-bottom:20px">依原始序號分課；重複項目合併後共 693 個詞，其中 682 個有釋義可出題。</p><div class="course-grid">${Array.from(
      { length: 7 },
      (_, i) => {
        const pool = cards.filter((e) => e.lesson === i + 1),
          s = studyStats(pool);
        return `<section class="card course-card"><div class="course-num">第 ${i + 1} 課</div><h3>第 ${String(i * 100 + 1).padStart(3, '0')}–${(i + 1) * 100} 字詞</h3><p>${pool.length} 個詞　可練習 ${s.available} 個　已學 ${s.learned} 個</p><div class="progress-track"><span style="width:${(s.learned / (s.available || 1)) * 100}%"></span></div><div class="row"><button class="secondary" data-action="course-list" data-lesson="${i + 1}">看詞表</button><button class="primary" data-action="start-study" data-deck="lesson:${i + 1}">開始學習</button></div></section>`;
      },
    ).join(
      '',
    )}</div><div class="section-heading"><h2>臺羅基礎</h2></div><div class="lesson-groups">${[
      ...new Set(LESSONS.map((x) => x.group)),
    ]
      .map(
        (g) =>
          `<section class="lesson-group"><h3>${g}</h3>${LESSONS.filter((x) => x.group === g)
            .map(
              (l) =>
                `<button class="lesson-row" data-action="lesson" data-id="${l.id}"><div><strong>${l.title}</strong><span>${esc(l.sub)}</span></div>${icon('arrow')}</button>`,
            )
            .join('')}</section>`,
      )
      .join('')}</div></div>`;
}
async function deckEntries(deck) {
  if (deck === 'all') return cards;
  if (deck.startsWith('lesson:')) return cards.filter((x) => x.lesson === +deck.split(':')[1]);
  if (deck === 'favorites') return getEntries(state.favorites);
  if (deck === 'studied') return getEntries(Object.keys(state.progress));
  if (deck.startsWith('custom:'))
    return getEntries(state.lists.find((x) => x.id === deck.slice(7))?.entries || []);
  return [];
}
const MODES = [
  ['meaning', '看漢字選詞義'],
  ['sound-hanji', '聽音選漢字'],
  ['sound-meaning', '聽音選詞義'],
  ['meaning-sound', '看詞義辨音'],
  ['dictation', '臺羅聽寫'],
  ['flash', '翻卡複習'],
];
async function startStudy(deck = 'all', mode = 'meaning') {
  const version = viewVersion;
  const pool = (await deckEntries(deck)).filter(
    (e) => e.senses?.[0]?.definition && (['meaning', 'flash'].includes(mode) || e.audio),
  );
  if (version !== viewVersion) return;
  if (!pool.length) {
    toast('這份詞表還沒有可學習的詞，先加入幾個詞吧。');
    return;
  }
  const queue = buildDailyPlan(pool, state).queue;
  if (!queue.length) {
    toast('目前沒有符合每日設定的詞目。');
    return;
  }
  if (state.session && !confirm('要結束目前的練習，改學這份詞表嗎？')) return;
  state.session = { queue, cursor: 0, score: 0, deck, mode, started: Date.now() };
  sessionPool = pool;
  answered = null;
  delete state.session.answered;
  save();
  page = 'study';
  sidebar();
  renderSession();
}
async function resumeStudy() {
  if (!state.session) return;
  const session = state.session,
    version = viewVersion;
  sessionPool = (await deckEntries(state.session.deck)).filter((e) => e.senses?.[0]?.definition);
  await getEntries([...session.queue, ...(session.options || [])]);
  if (session !== state.session || version !== viewVersion) return;
  answered = state.session.answered || null;
  page = 'study';
  sidebar();
  renderSession();
}
function sessionTarget() {
  return entryCache.get(state.session?.queue[state.session.cursor]);
}
function constrainSession() {
  const session = state.session;
  const start = session.cursor + (session.answered ? 1 : 0);
  const pending = session.queue.slice(start);
  const entries = pending.map((key) => entryCache.get(key)).filter(Boolean);
  const allowed = new Set(buildDailyPlan(entries, state).queue);
  session.queue = [...session.queue.slice(0, start), ...pending.filter((key) => allowed.has(key))];
}
function renderSession() {
  const session = state.session;
  if (!session) {
    renderStudy();
    return;
  }
  constrainSession();
  if (session.cursor >= session.queue.length) {
    finishSession();
    return;
  }
  const target = sessionTarget();
  if (!target) {
    resumeStudy().catch((e) => toast(e.message));
    return;
  }
  const savedOptions = (session.options || []).map((key) => entryCache.get(key)).filter(Boolean);
  if (savedOptions.length && savedOptions.some((e) => keyOf(e) === keyOf(target)))
    sessionOptions = savedOptions;
  else {
    sessionOptions = chooseOptions(
      target,
      (sessionPool.length > 4 ? sessionPool : cards).filter(
        (e) => session.mode !== 'meaning-sound' || e.audio,
      ),
      session.mode === 'sound-hanji' ? 'hanji' : 'definition',
    );
    session.options = sessionOptions.map(keyOf);
    // 舊版已作答但未儲存選項時，僅恢復正解，避免錯配舊索引。
    if (answered) answered.selected = -1;
    save();
  }
  const audioMode = ['sound-hanji', 'sound-meaning', 'dictation'].includes(session.mode);
  const prompt = {
    meaning: '這個詞是什麼意思？',
    'sound-hanji': '聽錄音，選出對應的漢字。',
    'sound-meaning': '聽錄音，選出正確的意思。',
    'meaning-sound': '看釋義，選出對應的錄音。',
    dictation: '聽錄音，寫出臺羅。',
    flash: '想一想，你還記得嗎？',
  }[session.mode];
  const ex = target.senses.flatMap((x) => x.examples || [])[0];
  $('#main').innerHTML =
    header('每日學習', '先複習，再學新詞。') +
    `<div class="content study-content"><div class="study-toolbar"><button class="text-btn" data-action="pause-study">${icon('back')}暫停並返回</button><select id="study-mode" aria-label="練習方式" ${answered ? 'disabled' : ''}>${MODES.map(([k, v]) => `<option value="${k}" ${session.mode === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="session-progress"><span>第 ${session.cursor + 1}／${session.queue.length} 張</span><span>答對 ${session.score} 張</span></div><div class="progress-track"><span style="width:${(session.cursor / session.queue.length) * 100}%"></span></div><section class="card question-card"><p class="question-kind">${prompt}</p>${audioMode ? audioButton(target, 0, true) : session.mode === 'meaning-sound' ? `<div class="definition" style="margin:28px 0">${esc(target.senses[0].definition)}</div>` : `<h2 class="question-word">${esc(wordLabel(target))}</h2>${session.mode === 'flash' ? `<div class="word-roman">${esc(target.tailo)}</div>` : ''}${audioButton(target)}`}${session.mode === 'meaning' && ex ? `<div class="question-context"><div class="row between"><span>${esc(ex.hanji)}</span>${ex.audio_basename ? audioButton(target, ex.id) : ''}</div><p class="roman">${esc(ex.tailo)}</p></div>` : ''}${session.mode === 'dictation' ? `<form id="dictation-form"><input class="dictation" id="dictation-answer" aria-label="輸入臺羅答案" placeholder="例如：ho2 或 hó" autocomplete="off" autocapitalize="off" spellcheck="false" ${answered ? 'disabled' : ''} value="${esc(answered?.input || '')}"><div class="tone-keys">${['2', '3', '5', '7', '8', '9', '--'].map((x) => `<button type="button" data-action="tone-key" data-tone="${x}" ${answered ? 'disabled' : ''}>${x === '--' ? '--' : numberToTone('a' + x)}</button>`).join('')}</div>${!answered ? '<button class="primary" style="width:100%;margin-top:18px" type="submit">檢查答案</button>' : ''}</form>` : session.mode === 'flash' ? `${!answered ? '<button class="primary" style="margin-top:25px" data-action="reveal-card">顯示答案</button>' : ''}` : `<div class="answers">${sessionOptions.map((e, i) => `<div>${session.mode === 'meaning-sound' ? `<div class="row" style="justify-content:center;margin-bottom:9px">${audioButton(e)}<span class="small">錄音 ${i + 1}</span></div>` : ''}<button class="answer ${answered ? (keyOf(e) === keyOf(target) ? 'correct' : answered.selected === i ? 'wrong' : '') : ''}" style="width:100%" data-action="answer" data-index="${i}" ${answered ? 'disabled' : ''}>${session.mode === 'meaning-sound' ? `選擇錄音 ${i + 1}` : esc(session.mode === 'sound-hanji' ? wordLabel(e) : e.senses?.[0]?.definition || e.definition)}</button></div>`).join('')}</div>`}</section>${answered ? feedbackHTML(target) : ''}<div class="session-bottom"><button class="text-btn small" data-action="study-entry" data-key="${keyOf(target)}">查看完整詞目</button>${answered && session.mode !== 'flash' ? '<button class="primary" data-action="next-card">下一張 ' + icon('arrow') + '</button>' : ''}${!answered && audioMode ? '<button class="text-btn small" data-action="skip-card">音檔無法播放？先跳過</button>' : ''}</div><p class="source-note">答對後依序於 1、3、7、14、30、60 天後複習；答錯於 10 分鐘後再練。收錄讀音以詞典本調為準，錄音可能包含自然連讀。</p></div>`;
  const form = $('#dictation-form');
  if (form)
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      checkDictation();
    });
}
function feedbackHTML(e) {
  const wrong = !answered.correct;
  return `<div class="feedback ${wrong ? 'wrong' : ''}"><h3>${answered.reveal ? '記得這個詞嗎？' : answered.correct ? '答對了' : answered.kind === 'tone' ? '拼寫正確，再留意聲調' : '再看一次這個詞'}</h3><p><strong>${esc(wordLabel(e))}</strong>　<span style="color:var(--blue)">${esc(e.tailo)}</span></p><p>${esc(e.senses[0].definition)}</p>${answered.reveal ? '<div class="row wrap" style="margin-top:20px"><button class="secondary" data-action="grade-flash" data-correct="false">再練一次</button><button class="primary" data-action="grade-flash" data-correct="true">記得了</button></div>' : ''}</div>`;
}
function recordAnswer(correct, extra = {}) {
  const target = sessionTarget();
  if (!target || (answered && !answered.reveal)) return;
  const key = keyOf(target);
  recordStudyActivity(state, key, !state.progress[key]);
  state.progress[key] = nextReview(state.progress[key], correct);
  if (correct) state.session.score++;
  answered = { correct, ...extra };
  state.session.answered = answered;
  save();
  renderSession();
}
function checkDictation() {
  const input = $('#dictation-answer').value;
  const target = sessionTarget();
  const result = judgeSpelling(
    input,
    target.readings?.length ? target.readings : target.tailo.split('/'),
  );
  if (result.kind === 'empty') {
    toast('請先輸入答案。');
    return;
  }
  recordAnswer(result.correct, { input, kind: result.kind });
}
function nextCard() {
  stopAudio();
  state.session.cursor++;
  answered = null;
  delete state.session.answered;
  delete state.session.options;
  if (state.session.cursor >= state.session.queue.length) {
    finishSession();
  } else {
    save();
    renderSession();
  }
}
function finishSession() {
  const s = state.session;
  state.session = null;
  sessionPool = [];
  save();
  $('#main').innerHTML =
    header('練習完成') +
    `<div class="content study-content"><div class="card empty">${icon('check')}<h1>練習完成</h1><p>完成 ${Math.min(s.cursor, s.queue.length)} 張卡，答對 ${s.score} 張。</p><button class="primary" data-action="study-home">回到學習</button></div></div>`;
}

function renderLesson(id) {
  const unit = LESSONS.find((x) => x.id === id);
  if (!unit) return;
  unitQuiz = null;
  $('#main').innerHTML =
    header('臺羅基礎', unit.group) +
    `<div class="content study-content"><button class="text-btn" data-action="study-home">${icon('back')}回到學習</button><section class="card lesson-intro"><div class="eyebrow">${unit.group}</div><h1 style="margin:10px 0">${unit.title}</h1><p class="muted" style="margin-bottom:23px">${esc(unit.sub)}</p><p class="lesson-text">${esc(unit.text)}</p>${unit.parts ? `<div class="sound-grid">${unit.parts.map(([symbol, sound]) => `<button class="sound-card" data-action="local-audio" data-sound="${sound}" aria-label="播放 ${symbol} 範例音"><strong>${symbol}</strong><span>${icon('sound')} ${esc(meta.soundExamples?.[sound]?.hanji || '範例音')}</span></button>`).join('')}</div><p class="small">錄音為上列教育部例字的完整讀音，請留意本單元要辨認的聲母或韻母。</p>` : ''}${unit.examples ? `<div class="sound-grid">${unit.examples.map(([tone, roman]) => `<button class="sound-card" data-action="tone-example" data-roman="${esc(roman)}"><strong>${esc(roman)}</strong><span>第 ${tone} 調 ${icon('sound')}</span></button>`).join('')}</div>` : ''}${unit.rules ? `<table class="rule-table"><tbody>${unit.rules.map(([a, b]) => `<tr><td>第 ${a} 調</td><td>→</td><td>第 ${b} 調</td></tr>`).join('')}</tbody></table>` : ''}<button class="primary" style="width:100%;margin-top:28px" data-action="unit-quiz" data-id="${unit.id}">${unit.parts || unit.id === 'tones' ? '開始聽辨' : '練習看看'} ${icon('arrow')}</button></section><p class="source-note">課程依教育部<a href="${MANUAL_SOURCE}" target="_blank" rel="noopener">臺羅拼音方案使用手冊</a>及<a href="${LESSON_SOURCE}" target="_blank" rel="noopener">臺羅標注說明</a>獨立編寫。語音依原始錄音呈現。</p></div>`;
}
function startUnitQuiz(id) {
  const unit = LESSONS.find((x) => x.id === id);
  let questions;
  if (unit.parts) {
    questions = unit.parts.map(([symbol, sound]) => ({
      q: '聽例音，選出本單元對應的部分。',
      options: unit.parts.map((x) => x[0]),
      answer: symbol,
      sound,
    }));
  } else if (id === 'tones') {
    questions = cards
      .filter((e) => (e.readings?.[0] || '').match(/^[a-z\u0300-\u036fâāáàêēéèîīíìôōóòûūúùḿńǹ]+$/i))
      .slice(0, 10)
      .map((e) => ({
        q: '聽錄音，選出這個音節的聲調。',
        options: ['1', '2', '3', '4', '5', '7', '8'],
        answer: numericRoman(e.readings[0]).slice(-1),
        entry: keyOf(e),
      }));
  } else questions = unit.questions || [];
  unitQuiz = {
    id,
    questions: questions.sort(() => Math.random() - 0.5).slice(0, Math.min(5, questions.length)),
    cursor: 0,
    score: 0,
    answer: null,
  };
  renderUnitQuiz();
}
function renderUnitQuiz() {
  const u = unitQuiz;
  const q = u.questions[u.cursor];
  if (!q) {
    $('#main').innerHTML =
      header('練習完成', '臺羅基礎') +
      `<div class="content study-content"><div class="card empty">${icon('check')}<h2>完成 ${u.questions.length} 題，答對 ${u.score} 題</h2><button class="primary" data-action="lesson" data-id="${u.id}">回到單元</button><button class="secondary" data-action="study-home">回到學習</button></div></div>`;
    return;
  }
  $('#main').innerHTML =
    header('臺羅練習', '先聽清楚，再選答案。') +
    `<div class="content study-content"><div class="study-toolbar"><button class="text-btn" data-action="lesson" data-id="${u.id}">${icon('back')}回到單元</button><span class="small">第 ${u.cursor + 1}／${u.questions.length} 題</span></div><section class="card question-card"><h2>${esc(q.q)}</h2>${q.sound ? `<button class="big-play" data-action="local-audio" data-sound="${q.sound}" aria-label="播放範例音">${icon('sound')}</button>` : q.entry ? audioButton(entryCache.get(q.entry), 0, true) : ''}<div class="answers">${q.options.map((o) => `<button class="answer ${u.answer !== null ? (o === q.answer ? 'correct' : o === u.answer ? 'wrong' : '') : ''}" data-action="unit-answer" data-answer="${esc(o)}" ${u.answer !== null ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div></section>${u.answer !== null ? `<div class="feedback ${u.answer === q.answer ? '' : 'wrong'}"><h3>${u.answer === q.answer ? '答對了' : '正確答案：' + esc(q.answer)}</h3></div><div class="session-bottom"><span></span><button class="primary" data-action="unit-next">下一題 ${icon('arrow')}</button></div>` : ''}</div>`;
}

function listName(k) {
  if (k === 'favorites') return '收藏詞目';
  if (k === 'studied') return '已學過的詞';
  if (k.startsWith('lesson:')) return '常用字詞・第 ' + k.slice(7) + ' 課';
  return state.lists.find((l) => l.id === k)?.name || '自建詞表';
}
async function listEntries(k) {
  if (k === 'favorites') return getEntries(state.favorites);
  if (k === 'studied')
    return getEntries(
      Object.keys(state.progress).sort((a, b) => state.progress[b].last - state.progress[a].last),
    );
  if (k.startsWith('lesson:')) return cards.filter((x) => x.lesson === +k.slice(7));
  return getEntries(state.lists.find((l) => l.id === k)?.entries || []);
}
async function renderLists() {
  const current = listKey;
  $('#main').innerHTML =
    header('詞表', '收藏、課程與自己的詞，放在一起管理。') +
    `<div class="content"><div class="list-layout"><nav class="list-menu" aria-label="詞表選擇">${[['favorites', '收藏詞目'], ['studied', '已學過的詞'], ...Array.from({ length: 7 }, (_, i) => ['lesson:' + (i + 1), '第 ' + (i + 1) + ' 課']), ...state.lists.map((l) => [l.id, l.name])].map(([id, name]) => `<button data-action="select-list" data-id="${esc(id)}" class="${listKey === id ? 'active' : ''}">${esc(name)}</button>`).join('')}<div class="divider"></div><button data-action="new-list">${icon('plus')} 建立詞表</button></nav><section><div class="list-heading row between wrap"><div><h2>${esc(listName(listKey))}</h2><p id="list-description">正在整理詞表…</p></div><div class="row">${!listKey.startsWith('lesson:') && listKey !== 'studied' ? '<button class="secondary" data-action="import-list">' + icon('upload') + ' 匯入</button>' : ''}<button class="primary" data-action="study-list">${icon('learn')}學習</button></div></div><div class="list-controls"><div class="search-box">${icon('search')}<input id="list-filter" aria-label="篩選詞表" placeholder="找詞表裡的詞" value="${esc(listFilter)}"></div><select id="list-status" aria-label="學習狀態篩選"><option value="all">全部狀態</option><option value="new" ${listStatus === 'new' ? 'selected' : ''}>尚未學習</option><option value="due" ${listStatus === 'due' ? 'selected' : ''}>到期複習</option><option value="learned" ${listStatus === 'learned' ? 'selected' : ''}>已學過</option></select><button class="secondary" data-action="export-list">匯出</button>${state.lists.some((l) => l.id === listKey) ? '<button class="danger" data-action="delete-list">刪除詞表</button>' : ''}</div><div id="list-table"></div></section></div></div>`;
  try {
    const es = await listEntries(current);
    if (page !== 'lists' || current !== listKey) return;
    $('#list-description').textContent = `${es.length} 個詞目，學習進度儲存在本機。`;
    const draw = () => {
      const term = normalizeRoman(listFilter);
      const now = Date.now();
      const filtered = es.filter((e) => {
        const p = state.progress[keyOf(e)];
        return (
          (!term ||
            normalizeRoman(
              e.hanji + ' ' + e.tailo + ' ' + (e.definition || e.senses?.[0]?.definition || ''),
            ).includes(term)) &&
          (listStatus === 'all' ||
            (listStatus === 'new' && !p) ||
            (listStatus === 'due' && p?.due <= now) ||
            (listStatus === 'learned' && p))
        );
      });
      $('#list-table').innerHTML = filtered.length
        ? `<div class="table-wrap"><table class="list-table"><thead><tr><th>詞目／臺羅</th><th class="definition-cell">釋義</th><th>學習狀態</th><th></th></tr></thead><tbody>${filtered
            .map((e) => {
              const key = keyOf(e),
                p = state.progress[key];
              return `<tr><td><button class="word-link" data-action="modal-entry" data-key="${key}">${esc(wordLabel(e))}</button><div class="roman">${esc(e.tailo)}</div></td><td class="definition-cell">${esc((e.senses?.[0]?.definition || e.definition || '').slice(0, 70))}</td><td>${p ? `<span class="pill ${p.due <= now ? 'blue' : 'green'}">${p.due <= now ? '到期複習' : '已學過'}</span><div class="small">${new Date(p.due).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })} 複習</div>` : '<span class="pill">新詞</span>'}</td><td>${state.lists.some((l) => l.id === listKey) ? `<button class="icon-btn" data-action="remove-list-word" data-key="${key}" aria-label="移出詞表">${icon('close')}</button>` : audioButton(e)}</td></tr>`;
            })
            .join('')}</tbody></table></div>`
        : empty('這裡還沒有詞', '可從詞目頁加入，或匯入自己的詞表。', 'list');
    };
    draw();
    $('#list-filter').addEventListener('input', (ev) => {
      listFilter = ev.target.value;
      draw();
    });
    $('#list-status').addEventListener('change', (ev) => {
      listStatus = ev.target.value;
      draw();
    });
  } catch (e) {
    toast(e.message);
  }
}
function newListDialog(key = '') {
  showDialog(
    '建立詞表',
    `<form id="new-list-form"><label class="field-label" for="new-list-name">詞表名稱</label><input type="text" id="new-list-name" maxlength="40" required placeholder="例如：日常生活"><button class="primary" type="submit">建立詞表</button></form>`,
  );
  $('#new-list-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('#new-list-name').value.trim();
    if (!name) return;
    const id = 'list-' + Date.now();
    state.lists.push({ id, name, entries: key ? [key] : [] });
    save();
    $('#dialog').close();
    toast('已建立「' + name + '」');
    if (page === 'lists') {
      listKey = id;
      renderLists();
    }
  });
  $('#new-list-name').focus();
}
function addToList(key) {
  showDialog(
    '加入詞表',
    `${state.lists.length ? `<div class="stack">${state.lists.map((l) => `<button class="secondary" data-action="assign-list" data-id="${esc(l.id)}" data-key="${key}">${esc(l.name)}${l.entries.includes(key) ? '　✓' : ''}</button>`).join('')}</div>` : '<p class="muted">先建立一份自己的詞表。</p>'}<button class="primary" data-action="new-list" data-key="${key}">${icon('plus')}建立詞表</button>`,
  );
}
function download(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function pickFile(accept, onFile) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.addEventListener('change', async () => {
    if (!input.files[0]) return;
    try {
      await onFile(input.files[0]);
    } catch (e) {
      toast(e instanceof SyntaxError ? 'JSON 格式不正確，請檢查檔案。' : e.message);
    }
  });
  input.click();
}
async function exportList(format) {
  const es = await listEntries(listKey);
  const name = listName(listKey);
  if (format === 'csv') {
    const rows = [
      ['資料來源', '詞目編號', '漢字', '臺羅'],
      ...es.map((e) => [e.source, e.id, e.hanji, e.tailo]),
    ];
    download(
      name + '.csv',
      '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'),
      'text/csv;charset=utf-8',
    );
  } else
    download(
      name + '.json',
      JSON.stringify(
        {
          type: 'taigi-word-list',
          version: 1,
          name,
          entries: es.map((e) => ({ source: e.source, id: e.id, hanji: e.hanji, tailo: e.tailo })),
        },
        null,
        2,
      ),
    );
  $('#dialog').close();
}
async function importList(file) {
  if (file.size > 5e6) throw new Error('請匯入 5 MB 以下的詞表。');
  const text = await file.text();
  let items;
  if (/\.json$/i.test(file.name)) {
    const j = JSON.parse(text);
    items = Array.isArray(j) ? j : j?.entries;
    if (!Array.isArray(items)) throw new Error('詞表格式不正確。');
  } else {
    const rows = parseCSV(text);
    const head = rows.shift() || [];
    const find = (...names) => head.findIndex((x) => names.includes(x.trim()));
    const idCol = find('詞目編號', 'id', 'entryId'),
      sourceCol = find('資料來源', 'source'),
      hanjiCol = find('漢字', 'hanji'),
      tailoCol = find('臺羅', '台羅', 'tailo');
    if (idCol < 0 && hanjiCol < 0) throw new Error('CSV 需要「詞目編號」或「漢字」欄位。');
    items = rows.map((r) => ({
      id: r[idCol],
      source: r[sourceCol] || 'moe',
      hanji: r[hanjiCol],
      tailo: r[tailoCol],
    }));
  }
  if (items.length > 1000) throw new Error('每次最多匯入 1,000 個詞目。');
  toast('正在核對詞目…');
  let keys = [],
    miss = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      miss++;
      continue;
    }
    if (
      item.id &&
      /^\d+$/.test(String(item.id)) &&
      ['moe', 'soannteng'].includes(item.source || 'moe')
    ) {
      keys.push((item.source || 'moe') + ':' + item.id);
    } else if (typeof item.hanji === 'string' && item.hanji) {
      const result = await request(
        '/api/search?' + new URLSearchParams({ q: item.hanji, mode: 'exact' }),
      );
      const match = result.entries.find(
        (e) => !item.tailo || normalizeRoman(e.tailo) === normalizeRoman(String(item.tailo)),
      );
      if (match) keys.push(keyOf(match));
      else miss++;
    } else miss++;
  }
  keys = [...new Set(keys)];
  const valid = await getEntries(keys);
  miss += keys.length - valid.length;
  keys = valid.map(keyOf);
  if (listKey === 'favorites') state.favorites = [...new Set([...state.favorites, ...keys])];
  else {
    let l = state.lists.find((l) => l.id === listKey);
    if (!l) {
      l = { id: 'list-' + Date.now(), name: file.name.replace(/\.(csv|json)$/i, ''), entries: [] };
      state.lists.push(l);
      listKey = l.id;
    }
    l.entries = [...new Set([...l.entries, ...keys])];
  }
  save();
  renderLists();
  toast(`已匯入 ${keys.length} 個詞目${miss ? '，' + miss + ' 筆未能對應' : ''}`);
}

function dailySettingsLinkHTML() {
  return '<div class="settings-section"><label>每日學習</label><button class="secondary" data-action="daily-settings">調整每日新詞與複習數量</button></div>';
}
function settings() {
  showDialog(
    '閱讀設定與備份',
    `<div class="settings-section"><label>字級大小</label><div class="segments">${[20, 22, 24, 26, 28].map((n) => `<button data-action="font" data-size="${n}" class="${state.prefs.font === n ? 'active' : ''}">${n}</button>`).join('')}</div><p class="small" style="margin-top:10px">目前 ${state.prefs.font} px，釋義與例句會一起放大。</p></div><div class="settings-section"><label>外觀</label><div class="segments"><button data-action="theme" data-theme="light" class="${state.prefs.theme === 'light' ? 'active' : ''}">淺色</button><button data-action="theme" data-theme="dark" class="${state.prefs.theme === 'dark' ? 'active' : ''}">深色</button></div></div><div class="settings-section"><label for="play-volume">播放音量 <span id="volume-label">${Math.round((state.prefs.volume ?? 0.8) * 100)}%</span></label><input id="play-volume" type="range" min="0" max="100" value="${Math.round((state.prefs.volume ?? 0.8) * 100)}" aria-label="播放音量" style="width:100%"></div>${dailySettingsLinkHTML()}<div class="settings-section"><label>收藏、詞表、私人筆記與學習紀錄</label><div class="row wrap"><button class="secondary" data-action="backup">${icon('download')}匯出備份</button><button class="secondary" data-action="restore">${icon('upload')}匯入備份</button></div><p class="small" style="margin-top:12px">紀錄儲存在目前瀏覽器。換瀏覽器或清除網站資料前，請先備份。</p></div><button class="text-btn" style="margin-top:20px" data-action="sources">查看資料來源與使用說明</button>`,
  );
  $('#play-volume').addEventListener('input', (ev) => {
    state.prefs.volume = +ev.target.value / 100;
    audio.volume = state.prefs.volume;
    audio.dataset.volume = String(audio.volume);
    $('#volume-label').textContent = ev.target.value + '%';
    save();
  });
}
function sources() {
  showDialog(
    '資料來源與使用說明',
    `<div class="source-panel"><p>主詞典收錄 ${meta.dictionaryCount.toLocaleString('zh-TW')} 筆詞目，另可查詢 ${meta.fallbackCount.toLocaleString('zh-TW')} 筆線頂辭典資料；兩者分開呈現，未當作去重詞彙總數。</p><p><a href="https://sutian.moe.edu.tw/zh-hant/piantsip/pankhuan-singbing/" target="_blank" rel="noopener">教育部《臺灣台語常用詞辭典》</a><br>詞目、釋義、例句與語音依 CC BY-ND 3.0 臺灣授權，本文與錄音未改寫。</p><p><a href="https://github.com/ChhoeTaigi/ChhoeTaigiDatabase" target="_blank" rel="noopener">台文華文線頂辭典</a><br>基礎資料：鄭良偉教授；增加編修：楊允言教授與打字、校對義工。資料依 CC BY-SA 4.0 授權；SQLite 格式轉換及搜尋索引不變更原文。</p><p>常用字詞依教育部推薦用字範圍及所附課程映射分七課，去重後共 693 張卡。課程說明由本專案獨立編寫，參考<a href="${MANUAL_SOURCE}" target="_blank" rel="noopener">教育部臺羅拼音方案使用手冊</a>。</p><p>生僻字使用國家發展委員會 CNS11643 全字庫正宋體（政府資料開放授權條款第 1 版），另使用 Plangothic Project，依 <a href="./fonts/LICENSE-Plangothic-OFL.txt" target="_blank" rel="noopener">SIL Open Font License 1.1</a> 授權。</p><p>查詞、標音及學習資料在本機處理。課程與詞目使用教育部原始例字錄音，播放時需要網路。線上版尚未核對音檔網址的例句會開啟官方詞目頁，避免以不同版本的編號播放錯誤錄音。主音讀不代表所有異讀或腔口都有獨立錄音。</p><p>個人 Logo：Lenteyyy，保留品牌及圖像權利，不包含在程式碼 MIT 授權內。程式碼署名：Made By 冷踢踢。私人筆記僅存於目前瀏覽器，並納入匯出備份。</p><p>本版採 MIT 授權開放程式碼。詞典、字型與 Logo 另依各自授權使用。<a href="https://github.com/lenteyyy/taigi-pocket" target="_blank" rel="noopener">GitHub 原始碼</a>。<br>本版提供詞典、收藏、自建詞表、七課學習、臺羅聽寫、讀音與閱讀、發音課程、備份及大字設定。系統桌面小工具及跨應用程式擴充不屬於網頁功能。所有功能開放，不收費。</p></div>`,
  );
}

document.addEventListener('input', (event) => {
  const form = event.target.closest('form[data-note-key]');
  if (form) noteDrafts.set(form.dataset.noteKey, event.target.value);
});
document.addEventListener('submit', (event) => {
  if (event.target.matches('form[data-note-key]')) {
    event.preventDefault();
    const form = event.target,
      key = form.dataset.noteKey;
    const previous = state.notes[key];
    const value = form.elements.note.value.trim().slice(0, 2000);
    if (value) state.notes[key] = value;
    else delete state.notes[key];
    if (save()) {
      noteDrafts.delete(key);
      form.closest('details').querySelector('summary').textContent = value
        ? '私人筆記 · 已有內容'
        : '私人筆記';
      toast(value ? '已儲存私人筆記。' : '已清空這個詞的私人筆記。');
    } else {
      if (previous === undefined) delete state.notes[key];
      else state.notes[key] = previous;
    }
    return;
  }
  const form = event.target;
  if (form.id !== 'daily-plan-form') return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  state.prefs.reviewLimit = dailyLimit(form.elements.namedItem('reviewCount').value, 20);
  state.prefs.newLimit = dailyLimit(form.elements.namedItem('newCount').value, 10);
  save();
  renderStudy();
  toast('每日設定已儲存。');
});
document.addEventListener('click', async (event) => {
  const b = event.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const a = b.dataset.action;
  try {
    if (a === 'nav') {
      navigate(b.dataset.page);
      return;
    }
    if (a === 'entry') {
      if ($('#dialog').open) openEntry(b.dataset.key, { modal: true });
      else openEntry(b.dataset.key);
    } else if (a === 'modal-entry' || a === 'study-entry')
      openEntry(b.dataset.key, { modal: true });
    else if (a === 'favorite') updateFavorite(b.dataset.key);
    else if (a === 'audio') await playSound(b, b.dataset.key, +(b.dataset.example || 0));
    else if (a === 'local-audio') await playSound(b, null, 0, b.dataset.sound);
    else if (a === 'stop-audio') stopAudio();
    else if (a === 'mobile-back') $('.dictionary,.reading-grid')?.classList.remove('mobile-detail');
    else if (a === 'close-dialog') $('#dialog').close();
    else if (a === 'search-mode') {
      searchMode = b.dataset.mode;
      $('#main .search-tools').outerHTML = searchTools();
      bindSearch();
      loadSearch();
    } else if (a === 'clear-search') {
      query = '';
      category = '';
      renderDictionary();
      $('#search-input')?.focus();
    } else if (a === 'category') {
      category = b.dataset.id;
      query = '';
      renderDictionary();
    } else if (a === 'clear-category') {
      category = '';
      renderDictionary();
    } else if (a === 'more-results') {
      offset = searchResults.length;
      loadSearch(true);
    } else if (a === 'clear-history') {
      if (confirm('要清除這個網頁的瀏覽紀錄嗎？')) {
        state.history = [];
        save();
        renderDictionary();
      }
    } else if (a === 'settings') settings();
    else if (a === 'daily-settings') {
      $('#dialog').close();
      sessionPool = [];
      answered = null;
      navigate('study');
    } else if (a === 'sources') sources();
    else if (a === 'font') {
      state.prefs.font = +b.dataset.size;
      prefs();
      save();
      settings();
    } else if (a === 'theme') {
      state.prefs.theme = b.dataset.theme;
      prefs();
      save();
      settings();
    } else if (a === 'backup')
      download(
        '台語小辭典備份-' + new Date().toLocaleDateString('sv-SE') + '.json',
        JSON.stringify(
          { app: 'taigi-pocket', version: 1, exportedAt: new Date().toISOString(), data: state },
          null,
          2,
        ),
      );
    else if (a === 'restore')
      pickFile('.json', async (file) => {
        if (file.size > 10e6) throw new Error('備份檔案過大。');
        const restored = validateBackup(JSON.parse(await file.text()));
        if (!restored) throw new Error('這不是有效的台語小辭典備份。');
        if (confirm('要以備份取代目前的收藏、詞表、私人筆記與學習紀錄嗎？')) {
          noteDrafts.clear();
          state = restored;
          save();
          prefs();
          $('#dialog').close();
          sessionPool = [];
          navigate(page);
          toast('已還原備份。');
        }
      });
    else if (a === 'annotate') await annotateText();
    else if (a === 'reading-example') {
      $('#reading-input').value = '今仔日天氣真好。食飽未？';
      await annotateText();
    } else if (a === 'past-sentence') {
      $('#reading-input').value = state.sentences[+b.dataset.index];
      await annotateText();
    } else if (a === 'token') {
      const t = tokens[+b.dataset.index];
      tokenChoices = t.entries;
      tokens.forEach((x) => (x.active = false));
      t.active = true;
      await openEntry(keyOf(t.chosen || t.entries[0]));
      document.querySelectorAll('.token').forEach((x) => x.classList.toggle('active', x === b));
    } else if (a === 'choose-reading') {
      const key = b.dataset.key;
      const t = tokens.find((x) => x.active);
      if (t) t.chosen = tokenChoices.find((x) => keyOf(x) === key);
      $('#annotation').innerHTML = annotationHTML();
      await openEntry(key);
    } else if (a === 'start-study')
      await startStudy(b.dataset.deck || 'all', b.dataset.mode || 'meaning');
    else if (a === 'resume-study') await resumeStudy();
    else if (a === 'study-home') {
      sessionPool = [];
      answered = null;
      page = 'study';
      sidebar();
      renderStudy();
    } else if (a === 'pause-study') {
      sessionPool = [];
      save();
      renderStudy();
    } else if (a === 'answer') {
      if (!answered)
        recordAnswer(keyOf(sessionOptions[+b.dataset.index]) === keyOf(sessionTarget()), {
          selected: +b.dataset.index,
        });
    } else if (a === 'next-card') nextCard();
    else if (a === 'skip-card') {
      delete state.session.options;
      state.session.queue.splice(state.session.cursor, 1);
      if (!state.session.queue.length || state.session.cursor >= state.session.queue.length) {
        state.session = null;
        sessionPool = [];
        save();
        renderStudy();
      } else {
        save();
        renderSession();
      }
    } else if (a === 'reveal-card') {
      answered = { reveal: true };
      state.session.answered = answered;
      save();
      renderSession();
    } else if (a === 'grade-flash') {
      recordAnswer(b.dataset.correct === 'true');
      nextCard();
    } else if (a === 'tone-key') {
      const input = $('#dictation-answer');
      const p = input.selectionStart;
      const before = input.value.slice(0, p);
      input.value =
        (b.dataset.tone === '--'
          ? before + '--'
          : before.replace(/([a-z\u0300-\u036fáàâāéèêēíìîīóòôōúùûū]+)$/i, (x) =>
              numberToTone(normalizeRoman(x) + b.dataset.tone),
            )) + input.value.slice(input.selectionEnd);
      input.focus();
    } else if (a === 'course-list') {
      listKey = 'lesson:' + b.dataset.lesson;
      listFilter = '';
      navigate('lists');
    } else if (a === 'studied-list') {
      listKey = 'studied';
      listFilter = '';
      navigate('lists');
    } else if (a === 'lesson') renderLesson(b.dataset.id);
    else if (a === 'unit-quiz') startUnitQuiz(b.dataset.id);
    else if (a === 'unit-answer') {
      if (unitQuiz.answer === null) {
        unitQuiz.answer = b.dataset.answer;
        if (unitQuiz.answer === unitQuiz.questions[unitQuiz.cursor].answer) unitQuiz.score++;
        renderUnitQuiz();
      }
    } else if (a === 'unit-next') {
      unitQuiz.cursor++;
      unitQuiz.answer = null;
      renderUnitQuiz();
    } else if (a === 'tone-example') {
      const result = await request(
        '/api/search?' + new URLSearchParams({ q: b.dataset.roman, mode: 'exact' }),
      );
      let match;
      for (const candidate of result.entries) {
        const e = await getEntry(keyOf(candidate));
        if (e.readings?.some((r) => numericRoman(r) === numericRoman(b.dataset.roman)) && e.audio) {
          match = e;
          break;
        }
      }
      if (match) await playSound(b, keyOf(match));
      else toast('這個範例目前未找到可播放的詞目錄音。');
    } else if (a === 'select-list') {
      listKey = b.dataset.id;
      listFilter = '';
      listStatus = 'all';
      renderLists();
    } else if (a === 'new-list') newListDialog(b.dataset.key || '');
    else if (a === 'add-to-list') addToList(b.dataset.key);
    else if (a === 'assign-list') {
      const l = state.lists.find((l) => l.id === b.dataset.id);
      if (!l.entries.includes(b.dataset.key)) l.entries.push(b.dataset.key);
      save();
      $('#dialog').close();
      toast('已加入「' + l.name + '」');
    } else if (a === 'remove-list-word') {
      const l = state.lists.find((l) => l.id === listKey);
      l.entries = l.entries.filter((x) => x !== b.dataset.key);
      save();
      renderLists();
    } else if (a === 'delete-list') {
      if (confirm('要刪除「' + listName(listKey) + '」嗎？詞目原文與學習紀錄會保留。')) {
        state.lists = state.lists.filter((x) => x.id !== listKey);
        listKey = 'favorites';
        save();
        renderLists();
      }
    } else if (a === 'study-list') {
      const deck = listKey.startsWith('lesson:')
        ? listKey
        : listKey === 'favorites'
          ? 'favorites'
          : listKey === 'studied'
            ? 'studied'
            : 'custom:' + listKey;
      await startStudy(deck);
    } else if (a === 'export-list')
      showDialog(
        '匯出詞表',
        '<div class="stack"><button class="secondary" data-action="export-format" data-format="json">JSON（保留詞目編號）</button><button class="secondary" data-action="export-format" data-format="csv">CSV（試算表可開啟）</button></div>',
      );
    else if (a === 'export-format') await exportList(b.dataset.format);
    else if (a === 'import-list') pickFile('.json,.csv', importList);
  } catch (e) {
    console.error(e);
    toast(e.message || '操作未完成，請重試。');
  }
});
document.addEventListener('change', (ev) => {
  if (ev.target.id === 'study-mode' && state.session && !answered) {
    if (!['meaning', 'flash'].includes(ev.target.value) && !sessionTarget()?.audio) {
      ev.target.value = state.session.mode;
      toast('這個詞未提供錄音，請使用看漢字選詞義或翻卡複習。');
      return;
    }
    state.session.mode = ev.target.value;
    delete state.session.options;
    answered = null;
    save();
    renderSession();
  }
});
$('#dialog').addEventListener('close', () => {
  entryTicket++;
});
$('#dialog').addEventListener('click', (ev) => {
  if (ev.target === $('#dialog')) {
    const r = $('#dialog').getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom)
      $('#dialog').close();
  }
});
async function init() {
  prefs();
  save();
  sidebar();
  try {
    [meta, cards] = await Promise.all([
      request('/api/meta'),
      request('/api/course'),
      getEntries(state.favorites),
    ]);
    cards.forEach((e) => entryCache.set(keyOf(e), e));
    sidebar();
    renderDictionary();
    await openEntry('moe:5570', { history: false });
    $('.dictionary')?.classList.remove('mobile-detail');
  } catch (e) {
    $('#main').innerHTML =
      header('台語小辭典') + empty('詞典尚未開啟', '請確認網路與瀏覽器支援，再重新整理網頁。');
    console.error(e);
  }
}
init();

let readingScroll = 0;
function renderStudy() {
  renderStudyBase();
  mountWidgets({ cards, state, cache: entryCache, audioButton });
}
function renderReading() {
  renderReadingBase();
  $('.reading-editor').scrollTop = readingScroll;
}
