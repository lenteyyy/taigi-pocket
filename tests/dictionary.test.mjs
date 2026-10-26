import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import initSQL from 'sql.js';
import { createDictionary, rows } from '../site/dictionary.mjs';
import { exampleTranslationHTML } from '../site/examples.mjs';
import { searchWithScope } from '../site/search-session.mjs';
const root = new URL('../site/data/', import.meta.url);
const readJSON = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const [SQL, courseMap, soundExamples, exampleAudio, provenance, searchData] = await Promise.all([
  initSQL(),
  readJSON('courses.json'),
  readJSON('sound-examples.json'),
  readJSON('example-audio.json'),
  readJSON('provenance.json'),
  readJSON('search.json'),
]);
const databases = new Map();
async function loadDatabase(source) {
  if (!databases.has(source)) {
    const name = source === 'moe' ? 'taigi-dict.sqlite' : 'taigi-soannteng.sqlite';
    const data = gunzipSync(await readFile(new URL(name + '.gz', root)));
    assert.equal(createHash('sha256').update(data).digest('hex'), provenance[name].publishedSHA256);
    databases.set(source, new SQL.Database(data));
  }
  return databases.get(source);
}
const dictionary = createDictionary({
  loadDatabase,
  courseMap,
  soundExamples,
  exampleAudio,
  searchData,
});
test('動物分類找不到揤時，前端擴大搜尋可找到原詞及臺羅', async () => {
  const request = (url) => dictionary.request(url);
  assert.equal((await request('/api/search?q=揤&category=3')).total, 0);
  const response = await searchWithScope(request, { q: '揤', category: '3' });
  assert.equal(response.expandedFrom, '3');
  assert.equal(response.category, '');
  assert.equal(response.result.total, 2);
  assert.equal(response.result.entries[0].id, 6001);
  assert.equal(response.result.entries[0].tailo, 'tshi̍h');
  const animal = await searchWithScope(request, { q: '小管仔', category: '3' });
  assert.equal(animal.category, '3');
  assert.equal(animal.expandedFrom, '');
  assert.ok(animal.result.total > 0);
  const alias = await searchWithScope(request, { q: '坏小子', category: '3' });
  assert.equal(alias.result.entries[0].id, 894);
});
test('17,907 筆例句均保留原始繁體華語翻譯，課程與詞目 API 不漏譯', async () => {
  const all = rows(await loadDatabase('moe'), 'SELECT id,hanji,huagi FROM example');
  assert.equal(all.length, 17907);
  for (const example of all) {
    assert.ok(example.huagi?.trim(), `例句 ${example.id} 缺少華語翻譯`);
    const html = exampleTranslationHTML(example);
    assert.ok(html.includes('lang="zh-Hant-TW"'), `例句 ${example.id} 缺少語言標記`);
    assert.ok(html.includes('華語：'), `例句 ${example.id} 未顯示翻譯`);
  }
  const word = await dictionary.getEntry(5014);
  const example = word.senses.flatMap((sense) => sense.examples).find((ex) => ex.id === 5594);
  assert.equal(example.hanji, '伊若真正按呢做，就傷超過矣。');
  assert.equal(example.huagi, '他如果真的這樣做，就太過份了。');
  const cards = await dictionary.request('/api/course');
  const examples = cards.flatMap((entry) => entry.senses.flatMap((sense) => sense.examples));
  assert.equal(examples.length, 1749);
  assert.ok(examples.every((ex) => ex.huagi?.trim()));
});

test('華語翻譯以純文字顯示，不執行例句內容中的 HTML', () => {
  const html = exampleTranslationHTML({ huagi: '<img src=x onerror="alert(1)">&' });
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;'));
  assert.ok(!html.includes('<img'));
  assert.equal(exampleTranslationHTML({ huagi: ' ' }), '');
  assert.equal(exampleTranslationHTML(null), '');
});
test('全數例句錄音均對應原始音檔名稱，所有播放鍵都有資料', async () => {
  const audioCatalog = await readJSON('audio-catalog.json');
  const all = rows(await loadDatabase('moe'), 'SELECT id,audio_basename FROM example');
  assert.equal(all.length, 17907);
  assert.equal(Object.keys(audioCatalog.files).length, all.length);
  for (const entry of all)
    assert.equal(audioCatalog.files[entry.id], entry.audio_basename + '.mp3');
  const full = createDictionary({
    loadDatabase,
    courseMap,
    soundExamples,
    exampleAudio,
    audioCatalog,
  });
  assert.equal((await full.request('/api/meta')).exampleAudioKeys.length, all.length);
});
test('公開資料快照完整且兩部詞庫分開標示授權', async () => {
  const meta = await dictionary.request('/api/meta');
  assert.equal(meta.dictionaryCount, 29591);
  assert.equal(
    rows(await loadDatabase('soannteng'), 'SELECT COUNT(*) AS total FROM entry')[0].total,
    91332,
  );
  assert.ok(provenance['taigi-dict.sqlite'].metadata.license.includes('BY-ND'));
  assert.ok(provenance['taigi-soannteng.sqlite'].metadata.license.includes('BY-SA'));
});
test('瀏覽器搜尋與本機規則一致，參數不拼入 SQL', async () => {
  for (const query of ['食', 'tsiah8', 'chiah8']) {
    const result = await dictionary.request(
      '/api/search?' + new URLSearchParams({ q: query, mode: 'exact' }),
    );
    assert.ok(result.entries.some((x) => x.id === 5570));
  }
  assert.equal((await dictionary.request('/api/search?q=ho2&mode=exact')).entries[0].tailo, 'hó');
  assert.ok(
    (
      await dictionary.request(
        '/api/search?' + new URLSearchParams({ q: '日*子', mode: 'wildcard' }),
      )
    ).total > 0,
  );
  for (const mode of ['prefix', 'contains', 'suffix']) {
    const result = await dictionary.request(
      '/api/search?' + new URLSearchParams({ q: '食', mode }),
    );
    assert.ok(result.entries.length > 0);
    for (const e of result.entries) {
      const word = e.hanji.replace(/【替】/g, '');
      assert.ok(
        mode === 'prefix'
          ? word.startsWith('食')
          : mode === 'suffix'
            ? word.endsWith('食')
            : word.includes('食'),
      );
    }
  }
  assert.equal(
    (
      await dictionary.request(
        '/api/search?' + new URLSearchParams({ q: "' OR 1=1 --", mode: 'exact' }),
      )
    ).total,
    0,
  );
  await assert.rejects(dictionary.request('/api/search?mode=bad'), /搜尋模式/);
});
test('繁簡與華語別稱找到原始歹囝，別稱結果不重複且保留分頁與分類', async () => {
  for (const query of ['坏小子', '壞小子', '坏孩子', '不良少年']) {
    const result = await dictionary.request('/api/search?' + new URLSearchParams({ q: query }));
    assert.equal(result.entries[0].id, 894, query);
    assert.equal(result.entries[0].hanji, '歹囝');
    assert.equal(result.entries[0].tailo, 'pháinn-kiánn');
    assert.equal(result.via, '華語別稱');
    assert.equal(new Set(result.entries.map((e) => e.id)).size, result.entries.length);
  }
  const next = await dictionary.request(
    '/api/search?' + new URLSearchParams({ q: '坏小子', offset: 1 }),
  );
  assert.equal(next.total, 1);
  assert.deepEqual(next.entries, []);
  const category = await dictionary.request(
    '/api/search?' + new URLSearchParams({ q: '坏小子', category: 1 }),
  );
  assert.equal(category.total, 0);
  assert.deepEqual(category.entries, []);
  assert.equal((await dictionary.getEntry(894)).definition, '不良少年、浪蕩子。');
});
test('簡體查詞、華語釋義與例句可逆查，繁體原詞優先排序', async () => {
  for (const [query, id] of [
    ['电脑', 10332],
    ['头毛', 12041],
    ['自行车', 10126],
    ['西红柿', 5090],
  ]) {
    const result = await dictionary.request('/api/search?' + new URLSearchParams({ q: query }));
    assert.equal(result.entries[0].id, id, query);
  }
  const definition = await dictionary.request(
    '/api/search?' + new URLSearchParams({ q: '名词前缀' }),
  );
  assert.ok(definition.entries.some((e) => e.id === 4496));
  const example = await dictionary.request(
    '/api/search?' + new URLSearchParams({ q: '他如果真的这样做' }),
  );
  assert.equal(example.entries[0].id, 5014);
  assert.equal(example.via, '華語意思');
  const native = await dictionary.request(
    '/api/search?' + new URLSearchParams({ q: '發', mode: 'exact' }),
  );
  assert.equal(native.entries[0].hanji, '發');
  const wildcard = await dictionary.request(
    '/api/search?' + new URLSearchParams({ q: '电*', mode: 'wildcard' }),
  );
  assert.ok(wildcard.entries.some((e) => e.id === 10332));
  const fallback = await dictionary.request(
    '/api/search?' + new URLSearchParams({ q: 'a̍h有一个', mode: 'exact' }),
  );
  assert.equal(fallback.source, 'soannteng');
  assert.equal(fallback.entries[0].id, 48);
  assert.equal(fallback.entries[0].hanji, 'a̍h有一個');
  for (const group of searchData.aliases)
    assert.ok((await dictionary.getEntry(group.entryId)).senses[0].definition);
});
test('七課與六題型使用完整詞條、例句及關聯', async () => {
  const cards = await dictionary.request('/api/course');
  assert.equal(cards.length, 693);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, i) => cards.filter((e) => e.lesson === i + 1).length),
    [97, 100, 98, 100, 100, 99, 99],
  );
  assert.equal(cards.filter((e) => e.senses?.[0]?.definition).length, 682);
  assert.equal(cards.filter((e) => !e.senses?.[0]?.definition).length, 11);
  const word = await dictionary.getEntry(5570);
  assert.equal(word.readings[0], 'tsia̍h');
  assert.ok(word.senses.flatMap((x) => x.examples).some((x) => x.hanji === '食果子'));
  assert.ok(word.relations.length);
  assert.ok(
    (await dictionary.request('/api/entries?ids=moe:5570,moe:2415,bad:1,moe:9999999')).length === 2,
  );
});
test('相關詞目保留第八調組合符號，未被轉碼或刪除', async () => {
  const word = await dictionary.getEntry(67);
  const relation = word.relations.find((x) => x.id === 17734);
  assert.equal(relation.hanji, '十八仔');
  assert.equal(relation.tailo, 'si\u030dp-pat-á');
  assert.equal((await dictionary.getEntry(17734)).tailo, relation.tailo);
  assert.equal(
    (await dictionary.request('/api/search?q=sip8-pat4-a2&mode=exact')).entries[0].id,
    17734,
  );
});
test('標音保留罕用字與表情符號，白讀優先，拒絕無效本文', async () => {
  const text = '今仔日天氣真好。𪜶🛸';
  const result = await dictionary.annotate(text);
  assert.equal(result.map((t) => t.text).join(''), text);
  assert.equal(result[0].text, '今仔日');
  assert.equal((await dictionary.annotate('未'))[0].entries[0].marker, 'peh');
  await assert.rejects(dictionary.request('/api/annotate', { body: 'null' }), /最多輸入/);
  await assert.rejects(dictionary.annotate('字'.repeat(5001)), /最多輸入/);
});
test('54 個課程例字均使用實際有錄音的教育部詞目；例句網址不猜本地編號', async () => {
  assert.equal(Object.keys(soundExamples).length, 54);
  for (const item of Object.values(soundExamples)) {
    const entry = await dictionary.getEntry(item.entry);
    assert.equal(entry.audio, true);
    assert.equal(entry.hanji.replace(/【替】/g, ''), item.hanji.replace(/【替】/g, ''));
  }
  assert.ok(
    Object.values(exampleAudio).every((url) =>
      /^\/media\/senn\/mp3\/imtong\/leku\/\d+\/\d+\.mp3$/.test(url),
    ),
  );
});
