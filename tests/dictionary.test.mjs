import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import initSQL from 'sql.js';
import { createDictionary, rows } from '../site/dictionary.mjs';
const root = new URL('../site/data/', import.meta.url);
const readJSON = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const [SQL, courseMap, soundExamples, exampleAudio, provenance] = await Promise.all([
  initSQL(),
  readJSON('courses.json'),
  readJSON('sound-examples.json'),
  readJSON('example-audio.json'),
  readJSON('provenance.json'),
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
const dictionary = createDictionary({ loadDatabase, courseMap, soundExamples, exampleAudio });
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
