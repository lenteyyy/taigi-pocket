import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRoman,
  numberToTone,
  numericRoman,
  judgeSpelling,
  nextReview,
  buildQueue,
  buildDailyPlan,
  buildStudyQueue,
  recordStudyActivity,
  studyDay,
  parseCSV,
  validateBackup,
  initialState,
  chooseOptions,
  loadState,
  escapeHTML,
} from '../site/core.mjs';

test('臺羅與白話字搜尋鍵保留鼻化，接受調符與數字輸入', () => {
  assert.equal(normalizeRoman('chhiáⁿ'), 'tshiann');
  assert.equal(normalizeRoman('o\u0358'), 'oo');
  assert.equal(normalizeRoman('ó\u0358'), 'oo');
  assert.equal(normalizeRoman('tsia̍h8'), 'tsiah');
});

test('大寫臺羅也正確放置調號', () => {
  assert.equal(numberToTone('UI2'), 'UÍ');
  assert.equal(numberToTone('NG5'), 'N̂G');
  assert.equal(numberToTone('OO7'), 'ŌO');
});
test('私人筆記獨立儲存並隨新舊備份往返，HTML 僅作文字顯示', () => {
  const data = initialState();
  data.notes = {
    'moe:5570': '阿媽講：食飽未？\n<img src=x onerror=alert(1)>',
    'moe:1': 'a'.repeat(2100),
    bad: '不正確鍵',
    'moe:2': null,
  };
  const restored = validateBackup(JSON.parse(JSON.stringify({ data })));
  assert.equal(restored.notes['moe:5570'], data.notes['moe:5570']);
  assert.equal(restored.notes['moe:1'].length, 2000);
  assert.equal(Object.keys(restored.notes).length, 2);
  assert.ok(escapeHTML(restored.notes['moe:5570']).includes('&lt;img'));
  delete data.notes;
  assert.deepEqual(validateBackup(data).notes, {});
  assert.deepEqual(loadState({ getItem: () => '{invalid' }).notes, {});
});
test('備份驗證過濾損壞欄位且保存續學選項及作答', () => {
  const data = initialState();
  data.history = [null, { key: 'moe:1', time: 100 }];
  data.progress = {
    'moe:1': { due: 100, seen: 2, correct: 'x', streak: -1 },
    'moe:2': { due: 200, seen: -1 },
  };
  data.session = {
    queue: ['moe:1'],
    cursor: 0,
    score: '<b>',
    deck: 'all',
    mode: 'meaning',
    options: ['moe:1', 'moe:3'],
    answered: { correct: true, selected: 0 },
  };
  const result = validateBackup(data);
  assert.equal(result.history.length, 1);
  assert.equal(Object.keys(result.progress).length, 1);
  assert.equal(result.progress['moe:1'].streak, 0);
  assert.equal(result.session.score, 0);
  assert.deepEqual(result.session.options, data.session.options);
  assert.equal(result.session.answered.selected, 0);
  assert.equal(result.session.answered.correct, true);
  data.session.cursor = 2000;
  assert.equal(validateBackup(data).session, null);
});
test('數字調號與等價 Unicode 答案，分開判斷拼寫與聲調', () => {
  assert.equal(numberToTone('ho2'), 'hó');
  assert.equal(numberToTone('tsiah8'), 'tsia̍h');
  assert.equal(numberToTone('ui2'), 'uí');
  assert.equal(numberToTone('iu2'), 'iú');
  assert.equal(numberToTone('oo7'), 'ōo');
  assert.equal(numericRoman('食'), '食');
  assert.equal(judgeSpelling('tsiah8', ['tsia̍h']).correct, true);
  assert.equal(judgeSpelling('ho2', ['ho\u0301']).correct, true);
  assert.equal(judgeSpelling('ho3', ['hó']).kind, 'tone');
  assert.equal(judgeSpelling('ha2', ['hó']).kind, 'spelling');
  assert.equal(judgeSpelling('to-sia7', ['to-siā']).correct, true);
  assert.equal(judgeSpelling('chhiáⁿ', ['tshiánn']).correct, true);
  assert.equal(judgeSpelling('ó\u0358', ['óo']).correct, true);
});
test('優先安排到期詞，再加入指定數量新詞', () => {
  const entries = [1, 2, 3, 4].map((id) => ({ id, source: 'moe' }));
  const progress = { 'moe:1': { due: 200 }, 'moe:2': { due: 50 } };
  assert.deepEqual(buildQueue(entries, progress, 1, 100), ['moe:2', 'moe:3']);
  const first = nextReview(null, true, 100);
  assert.equal(first.due, 100 + 86400000);
  assert.equal(nextReview(first, true, 100).due, 100 + 3 * 86400000);
  assert.equal(nextReview(first, false, 100).due, 100 + 600000);
});
test('CSV 處理中文、引號與跨行；備份拒絕不正確格式', () => {
  assert.deepEqual(parseCSV('\uFEFF漢字,臺羅\r\n"食,飯","tsia̍h"\r\n"多\n謝",to-siā'), [
    ['漢字', '臺羅'],
    ['食,飯', 'tsia̍h'],
    ['多\n謝', 'to-siā'],
  ]);
  assert.throws(() => parseCSV('"不完整'));
  assert.equal(validateBackup({ version: 1 }), null);
  const data = initialState();
  data.favorites = ['moe:1', '<script>'];
  assert.deepEqual(validateBackup(data).favorites, ['moe:1']);
});
test('選擇題只留一個正解，排除同字與重複釋義', () => {
  const target = { id: 1, hanji: '食', senses: [{ definition: '吃。' }] };
  const pool = [
    target,
    { id: 2, hanji: '食', senses: [{ definition: '喝。' }] },
    { id: 3, hanji: '吃', senses: [{ definition: '吃。' }] },
    { id: 4, hanji: '水', senses: [{ definition: '水。' }] },
    { id: 5, hanji: '火', senses: [{ definition: '火。' }] },
  ];
  const options = chooseOptions(target, pool, 'definition', () => 0.5);
  assert.equal(options.filter((x) => x.senses[0].definition === '吃。').length, 1);
  assert.equal(options.filter((x) => x.hanji === '食').length, 1);
});
test('每日目標跨詞表共用，依今日進度安排首輪學習', () => {
  const now = Date.parse('2026-10-19T06:00:00Z');
  const entries = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, source: 'moe' }));
  const state = initialState();
  state.prefs.reviewLimit = 2;
  state.prefs.newLimit = 3;
  for (let i = 1; i <= 5; i++)
    state.progress['moe:' + i] = { seen: 2, due: now - 1000, last: now - 86400000 };
  assert.deepEqual(buildDailyPlan(entries, state, now).queue, [
    'moe:1',
    'moe:2',
    'moe:6',
    'moe:7',
    'moe:8',
  ]);
  recordStudyActivity(state, 'moe:1', false, now);
  state.progress['moe:1'] = nextReview(state.progress['moe:1'], true, now);
  recordStudyActivity(state, 'moe:6', true, now);
  state.progress['moe:6'] = nextReview(null, true, now);
  const plan = buildDailyPlan(entries.slice(1), state, now);
  assert.equal(plan.reviewDone, 1);
  assert.equal(plan.newDone, 1);
  assert.equal(plan.reviewCount, 1);
  assert.equal(plan.newCount, 2);
  state.prefs.newLimit = 0;
  state.prefs.reviewLimit = 0;
  assert.deepEqual(buildDailyPlan(entries, state, now).queue, []);
  state.prefs.newLimit = 80;
  assert.equal(buildDailyPlan(entries, state, now).newCount, 79);
});
test('同日答錯重練不重複計數；臺灣午夜重置每日目標進度', () => {
  const now = Date.parse('2026-10-19T15:30:00Z');
  const state = initialState();
  state.prefs.newLimit = 1;
  const entries = [{ id: 1 }, { id: 2 }];
  recordStudyActivity(state, 'moe:1', true, now);
  state.progress['moe:1'] = nextReview(null, false, now);
  const later = now + 600001;
  assert.deepEqual(buildDailyPlan(entries, state, later).queue, ['moe:1']);
  recordStudyActivity(state, 'moe:1', false, later);
  assert.equal(buildDailyPlan(entries, state, later).newDone, 1);
  assert.equal(buildDailyPlan(entries, state, later).reviewDone, 0);
  const tomorrow = Date.parse('2026-10-19T16:00:00Z');
  assert.equal(studyDay(tomorrow), '2026-10-20');
  const plan = buildDailyPlan(entries, state, tomorrow);
  assert.equal(plan.newDone, 0);
  assert.equal(plan.reviewDone, 0);
  assert.deepEqual(plan.queue, ['moe:1', 'moe:2']);
});
test('學完十個新詞可接著學第十一個，連續加學不改每日目標', () => {
  const now = Date.parse('2026-10-20T06:00:00Z');
  const state = initialState();
  const entries = Array.from({ length: 35 }, (_, i) => ({ id: i + 1 }));
  for (let batch = 0; batch < 3; batch++) {
    const queue = buildStudyQueue(entries, state, now);
    assert.deepEqual(
      queue,
      entries.slice(batch * 10, batch * 10 + 10).map((e) => `moe:${e.id}`),
    );
    for (const key of queue) {
      recordStudyActivity(state, key, true, now);
      state.progress[key] = nextReview(null, true, now);
    }
    assert.equal(buildDailyPlan(entries, state, now).newDone, (batch + 1) * 10);
    assert.equal(state.prefs.newLimit, 10);
  }
  assert.deepEqual(buildStudyQueue(entries, state, now), [
    'moe:31',
    'moe:32',
    'moe:33',
    'moe:34',
    'moe:35',
  ]);
});
test('複習達標、零目標、收藏全學過及跨日仍可主動練習，空詞表回傳空佇列', () => {
  const now = Date.parse('2026-10-20T06:00:00Z');
  const state = initialState();
  state.prefs.reviewLimit = 1;
  state.prefs.newLimit = 0;
  const entries = [{ id: 1 }, { id: 2 }];
  for (const entry of entries)
    state.progress[`moe:${entry.id}`] = nextReview(null, true, now - 2 * 86400000);
  assert.deepEqual(buildStudyQueue(entries, state, now), ['moe:1']);
  recordStudyActivity(state, 'moe:1', false, now);
  state.progress['moe:1'] = nextReview(state.progress['moe:1'], true, now);
  assert.deepEqual(buildStudyQueue(entries, state, now), ['moe:2']);
  recordStudyActivity(state, 'moe:2', false, now);
  state.progress['moe:2'] = nextReview(state.progress['moe:2'], true, now);
  assert.deepEqual(buildStudyQueue(entries, state, now), ['moe:1']);
  assert.equal(buildDailyPlan(entries, state, now).reviewDone, 2);
  state.prefs.reviewLimit = 0;
  assert.deepEqual(buildStudyQueue(entries, state, now), ['moe:1', 'moe:2']);
  assert.deepEqual(buildStudyQueue([{ id: 3 }, { id: 3 }], state, now), ['moe:3']);
  assert.deepEqual(buildStudyQueue(entries, state, now + 86400000), ['moe:1', 'moe:2']);
  assert.deepEqual(buildStudyQueue([], state, now), []);
});
test('正式音量預設八成，舊測試音量遷移且保留詞庫與每日設定', () => {
  const state = initialState();
  assert.equal(state.prefs.volume, 0.8);
  state.prefs.volume = 0.1;
  delete state.prefs.volumeRevision;
  state.favorites = ['moe:1'];
  state.progress['moe:1'] = { seen: 1, due: 100 };
  state.prefs.newLimit = 0;
  state.prefs.reviewLimit = 55;
  state.daily = { '2026-10-19': { newKeys: ['moe:1'], reviewKeys: [] } };
  const restored = validateBackup(state);
  assert.equal(restored.prefs.volume, 0.8);
  assert.deepEqual(restored.favorites, ['moe:1']);
  assert.equal(restored.progress['moe:1'].seen, 1);
  assert.equal(restored.prefs.newLimit, 0);
  assert.equal(restored.prefs.reviewLimit, 55);
  assert.deepEqual(restored.daily, state.daily);
  restored.prefs.volume = 0.3;
  assert.equal(validateBackup(restored).prefs.volume, 0.3);
});
