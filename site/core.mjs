// Made By 冷踢踢
export const STORAGE_KEY = 'taigi-pocket.v1';
export const keyOf = (e) => `${e.source || 'moe'}:${e.id}`;
export const escapeHTML = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function normalizeRoman(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/o(\p{M}*)\u0358/gu, 'o$1o')
    .replace(/ⁿ/g, 'nn')
    .replace(/\p{M}/gu, '')
    .replace(/chh/g, 'tsh')
    .replace(/ch/g, 'ts')
    .replace(/eng/g, 'ing')
    .replace(/ek/g, 'ik')
    .replace(/[1-9]/g, '')
    .trim();
}
const MARKS = { 2: '\u0301', 3: '\u0300', 5: '\u0302', 7: '\u0304', 8: '\u030d', 9: '\u030b' };
export function numberToTone(s) {
  return s.replace(/([a-z]+)([1-9])/gi, (_, base, tone) => {
    const mark = MARKS[tone];
    if (!mark) return base;
    const lower = base.toLowerCase();
    let i = lower.indexOf('a');
    if (i < 0) i = lower.indexOf('oo');
    if (i < 0) i = lower.search(/[eo]/);
    if (i < 0) i = Math.max(lower.lastIndexOf('i'), lower.lastIndexOf('u'));
    if (i < 0) i = lower.indexOf('n') >= 0 ? lower.indexOf('n') : lower.indexOf('m');
    return i < 0 ? base : (base.slice(0, i + 1) + mark + base.slice(i + 1)).normalize('NFC');
  });
}
export function numericRoman(s) {
  const input = numberToTone(
    String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/o(\p{M}*)\u0358/gu, 'o$1o')
      .replace(/ⁿ/g, 'nn')
      .trim(),
  ).normalize('NFD');
  return input
    .replace(/[a-z\u0300-\u036f]+/g, (syllable) => {
      let tone = Object.entries(MARKS).find(([, mark]) => syllable.includes(mark))?.[0];
      const base = normalizeRoman(syllable);
      if (!tone) tone = /[ptkh]$/.test(base) ? '4' : '1';
      return base + tone;
    })
    .replace(/[\s–—]+/g, '-')
    .replace(/^-|-$/g, '');
}
export function judgeSpelling(answer, readings) {
  const clean = (s) => numericRoman(s).replace(/[.,!?。！？]/g, '');
  if (!answer.trim()) return { correct: false, kind: 'empty' };
  if (readings.some((x) => clean(x) === clean(answer))) return { correct: true, kind: 'correct' };
  const plain = (s) =>
    normalizeRoman(s)
      .replace(/[\s–—]+/g, '-')
      .replace(/[.,!?。！？]/g, '');
  return {
    correct: false,
    kind: readings.some((x) => plain(x) === plain(answer)) ? 'tone' : 'spelling',
  };
}
export function nextReview(previous, correct, now = Date.now()) {
  const streak = correct ? (previous?.streak || 0) + 1 : 0;
  const days = [0, 1, 3, 7, 14, 30, 60];
  return {
    seen: (previous?.seen || 0) + 1,
    correct: (previous?.correct || 0) + (correct ? 1 : 0),
    streak,
    last: now,
    due: now + (correct ? days[Math.min(streak, 6)] * 86400000 : 600000),
  };
}
export function buildQueue(entries, progress, newLimit = 10, now = Date.now()) {
  const due = entries
    .filter((e) => progress[keyOf(e)]?.due <= now)
    .sort((a, b) => progress[keyOf(a)].due - progress[keyOf(b)].due);
  const fresh = entries.filter((e) => !progress[keyOf(e)]).slice(0, newLimit);
  return [...due, ...fresh].slice(0, 50).map(keyOf);
}
export function dailyLimit(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1000, Math.floor(number))) : fallback;
}
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function studyDay(now = Date.now()) {
  return DAY_FORMAT.format(new Date(now));
}
export function todayActivity(state, now = Date.now()) {
  const today = studyDay(now);
  const saved = state.daily?.[today];
  const fresh = new Set(saved?.newKeys || []);
  const review = new Set(saved?.reviewKeys || []);
  // 舊版只有一次作答紀錄時，可確定那是首次學習；較早紀錄不推測首次日期。
  for (const [key, progress] of Object.entries(state.progress)) {
    if (!Number.isFinite(progress.last) || studyDay(progress.last) !== today) continue;
    if (fresh.has(key) || review.has(key)) continue;
    if (progress.seen === 1) fresh.add(key);
    else review.add(key);
  }
  for (const key of fresh) review.delete(key);
  return { newKeys: [...fresh], reviewKeys: [...review] };
}
export function recordStudyActivity(state, key, isNew, now = Date.now()) {
  const today = studyDay(now);
  const activity = todayActivity(state, now);
  if (isNew || activity.newKeys.includes(key)) {
    if (!activity.newKeys.includes(key)) activity.newKeys.push(key);
    activity.reviewKeys = activity.reviewKeys.filter((x) => x !== key);
  } else if (!activity.reviewKeys.includes(key)) activity.reviewKeys.push(key);
  state.daily ||= {};
  state.daily[today] = activity;
}
export function buildDailyPlan(entries, state, now = Date.now()) {
  const activity = todayActivity(state, now);
  const newDone = new Set(activity.newKeys);
  const reviewDone = new Set(activity.reviewKeys);
  const newLimit = dailyLimit(state.prefs.newLimit, 10);
  const reviewLimit = dailyLimit(state.prefs.reviewLimit, 20);
  const newRemaining = Math.max(0, newLimit - newDone.size);
  const reviewRemaining = Math.max(0, reviewLimit - reviewDone.size);
  const unique = [...new Map(entries.map((e) => [keyOf(e), e])).values()];
  const due = unique
    .filter((e) => state.progress[keyOf(e)]?.due <= now)
    .sort((a, b) => state.progress[keyOf(a)].due - state.progress[keyOf(b)].due);
  const retry = due.filter((e) =>
    newDone.has(keyOf(e)) ? newLimit > 0 : reviewDone.has(keyOf(e)) && reviewLimit > 0,
  );
  const review = due
    .filter((e) => !newDone.has(keyOf(e)) && !reviewDone.has(keyOf(e)))
    .slice(0, reviewRemaining);
  const fresh = unique.filter((e) => !state.progress[keyOf(e)]).slice(0, newRemaining);
  return {
    queue: [...retry, ...review, ...fresh].map(keyOf),
    newDone: newDone.size,
    reviewDone: reviewDone.size,
    newLimit,
    reviewLimit,
    newRemaining,
    reviewRemaining,
    newCount: fresh.length,
    reviewCount: review.length + retry.length,
    retryCount: retry.length,
  };
}
export function initialState() {
  return {
    version: 1,
    favorites: [],
    history: [],
    progress: {},
    lists: [],
    sentences: [],
    notes: {},
    daily: {},
    prefs: {
      font: 24,
      theme: 'light',
      newLimit: 10,
      reviewLimit: 20,
      volume: 0.8,
      volumeRevision: 2,
    },
    session: null,
  };
}
export function loadState(storage = globalThis.localStorage) {
  try {
    return validateBackup(JSON.parse(storage.getItem(STORAGE_KEY))) || initialState();
  } catch {
    return initialState();
  }
}
const validKey = (x) => typeof x === 'string' && /^(moe|soannteng):\d+$/.test(x);
export function validateBackup(raw) {
  const data = raw?.data || raw;
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.favorites) ||
    !data.progress ||
    typeof data.progress !== 'object' ||
    Array.isArray(data.progress)
  )
    return null;
  const result = initialState();
  result.favorites = data.favorites.filter(validKey);
  result.history = Array.isArray(data.history)
    ? data.history.filter((x) => x && validKey(x.key) && Number.isFinite(x.time)).slice(0, 150)
    : [];
  result.progress = Object.fromEntries(
    Object.entries(data.progress)
      .filter(
        ([k, v]) =>
          validKey(k) &&
          v &&
          Number.isFinite(v.due) &&
          v.due >= 0 &&
          Number.isInteger(v.seen) &&
          v.seen > 0,
      )
      .map(([k, v]) => [
        k,
        {
          due: v.due,
          seen: v.seen,
          last: Number.isFinite(v.last) && v.last >= 0 ? v.last : 0,
          correct: Number.isInteger(v.correct) ? Math.max(0, Math.min(v.seen, v.correct)) : 0,
          streak: Number.isInteger(v.streak) ? Math.max(0, Math.min(v.seen, v.streak)) : 0,
        },
      ]),
  );
  result.lists = Array.isArray(data.lists)
    ? data.lists
        .filter(
          (x) =>
            x &&
            /^list-[a-zA-Z0-9-]+$/.test(x.id) &&
            typeof x.name === 'string' &&
            Array.isArray(x.entries),
        )
        .map((x) => ({ id: x.id, name: x.name.slice(0, 50), entries: x.entries.filter(validKey) }))
    : [];
  result.sentences = Array.isArray(data.sentences)
    ? data.sentences.filter((x) => typeof x === 'string').slice(0, 30)
    : [];
  if (data.notes && typeof data.notes === 'object' && !Array.isArray(data.notes)) {
    result.notes = Object.fromEntries(
      Object.entries(data.notes)
        .filter(([key, value]) => validKey(key) && typeof value === 'string' && value.trim())
        .map(([key, value]) => [key, value.slice(0, 2000)]),
    );
  }
  if (data.daily && typeof data.daily === 'object' && !Array.isArray(data.daily)) {
    for (const [day, activity] of Object.entries(data.daily)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !activity) continue;
      const newKeys = [
        ...new Set(Array.isArray(activity.newKeys) ? activity.newKeys.filter(validKey) : []),
      ];
      const reviewKeys = [
        ...new Set(Array.isArray(activity.reviewKeys) ? activity.reviewKeys.filter(validKey) : []),
      ].filter((key) => !newKeys.includes(key));
      result.daily[day] = { newKeys, reviewKeys };
    }
  }
  if (data.prefs)
    result.prefs = {
      font: [20, 22, 24, 26, 28].includes(+data.prefs.font) ? +data.prefs.font : 24,
      theme: ['light', 'dark'].includes(data.prefs.theme) ? data.prefs.theme : 'light',
      newLimit: dailyLimit(data.prefs.newLimit, 10),
      reviewLimit: dailyLimit(data.prefs.reviewLimit, 20),
      volume:
        data.prefs.volumeRevision === 2 && Number.isFinite(data.prefs.volume)
          ? Math.max(0, Math.min(1, data.prefs.volume))
          : 0.8,
      volumeRevision: 2,
    };
  const session = data.session;
  if (
    session &&
    Array.isArray(session.queue) &&
    session.queue.every(validKey) &&
    typeof session.deck === 'string' &&
    ['meaning', 'sound-hanji', 'sound-meaning', 'meaning-sound', 'dictation', 'flash'].includes(
      session.mode,
    ) &&
    Number.isInteger(session.cursor) &&
    session.cursor >= 0 &&
    session.cursor < Math.min(session.queue.length, 2000)
  ) {
    result.session = {
      queue: session.queue.slice(0, 2000),
      cursor: session.cursor,
      deck: session.deck,
      mode: session.mode,
      score: Number.isInteger(session.score)
        ? Math.max(0, Math.min(session.cursor + 1, session.score))
        : 0,
      started: Number.isFinite(session.started) ? session.started : 0,
    };
    if (
      Array.isArray(session.options) &&
      session.options.length <= 4 &&
      session.options.every(validKey)
    )
      result.session.options = session.options;
    if (session.answered && typeof session.answered === 'object') {
      const answer = session.answered;
      if (typeof answer.correct === 'boolean' || answer.reveal === true)
        result.session.answered = {
          correct: answer.correct === true,
          reveal: answer.reveal === true,
          selected:
            Number.isInteger(answer.selected) && answer.selected >= 0 && answer.selected < 4
              ? answer.selected
              : -1,
          input: typeof answer.input === 'string' ? answer.input.slice(0, 500) : '',
          kind: ['correct', 'tone', 'spelling'].includes(answer.kind) ? answer.kind : 'spelling',
        };
    }
  }
  return result;
}
export function parseCSV(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV 引號沒有成對，請檢查檔案。');
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export const csvCell = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
export function chooseOptions(target, pool, type, random = Math.random) {
  const label = (e) =>
    type === 'hanji' ? e.hanji : e.senses?.[0]?.definition || e.definition || '';
  const answer = label(target);
  const choices = [target];
  const synonyms = new Set(
    (target.relations || []).filter((r) => r.type === 'synonym').map((r) => 'moe:' + r.id),
  );
  const definitions = new Set((target.senses || []).map((s) => s.definition));
  const candidates = pool.filter(
    (e) =>
      keyOf(e) !== keyOf(target) &&
      !synonyms.has(keyOf(e)) &&
      label(e) &&
      label(e) !== answer &&
      e.hanji !== target.hanji &&
      !(e.senses || []).some((s) => definitions.has(s.definition)),
  );
  for (const candidate of candidates.sort(() => random() - 0.5)) {
    if (!choices.some((x) => label(x) === label(candidate))) choices.push(candidate);
    if (choices.length === 4) break;
  }
  return choices.sort(() => random() - 0.5);
}
