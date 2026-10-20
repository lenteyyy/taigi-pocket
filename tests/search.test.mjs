import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSearchTools } from '../site/search.mjs';

const data = JSON.parse(await readFile(new URL('../site/data/search.json', import.meta.url)));
const tools = createSearchTools(data);

test('完整繁簡搜尋字表保留來源雜湊，合併字形且不改臺羅或罕用字', async () => {
  const raw = await readFile(new URL('../site/vendor/opencc/TSCharacters.txt', import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), data.opencc.sha256);
  assert.equal(Object.keys(data.characters).length, 4113);
  for (const [traditional, simplified] of [
    ['電腦', '电脑'],
    ['臺灣', '台湾'],
    ['壞小子', '坏小子'],
    ['頭髮', '头发'],
    ['發票', '发票'],
    ['乾淨', '干净'],
  ])
    assert.equal(tools.normalizeHan(traditional), tools.normalizeHan(simplified));
  assert.equal(tools.normalizeHan('pháinn-kiánn／tsia̍h／𪜶🛸'), 'pháinn-kiánn／tsia̍h／𪜶🛸');
});

test('華語別稱採完整詞組、去重，萬用字元不誤當精確別稱', () => {
  assert.equal(data.aliases.length, 16);
  for (const group of data.aliases)
    for (const term of group.terms)
      assert.ok(tools.aliasIDs(term, 'prefix').includes(group.entryId), term);
  assert.deepEqual(tools.aliasIDs('坏小子', 'prefix'), [894]);
  assert.deepEqual(tools.aliasIDs('壞小子', 'exact'), [894]);
  assert.deepEqual(tools.aliasIDs('坏', 'prefix'), []);
  assert.deepEqual(tools.aliasIDs('坏*子', 'wildcard'), []);
  assert.deepEqual(tools.aliasIDs("' OR 1=1 --", 'prefix'), []);
});
