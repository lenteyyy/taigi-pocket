import test from 'node:test';
import assert from 'node:assert/strict';
import { searchWithScope } from '../site/search-session.mjs';

const empty = { total: 0, entries: [] };
const found = { total: 2, entries: [{ id: 6001 }, { id: 6056 }] };
const params = { q: '揤', mode: 'prefix', category: '3', offset: 0 };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('分類零筆時重查全部，保留文字與搜尋方式', async () => {
  const calls = [];
  const response = await searchWithScope(async (url) => {
    const query = Object.fromEntries(new URL(url, 'https://test.invalid').searchParams);
    calls.push(query);
    return query.category ? empty : found;
  }, params);
  assert.deepEqual(calls, [
    { ...params, offset: '0' },
    { ...params, category: '', offset: '0' },
  ]);
  assert.deepEqual(response, { result: found, category: '', expandedFrom: '3' });
  assert.equal(params.category, '3');
});

test('分類內有結果時仍保留分類，不混入全詞庫', async () => {
  let calls = 0;
  const response = await searchWithScope(async () => {
    calls++;
    return found;
  }, params);
  assert.equal(calls, 1);
  assert.deepEqual(response, { result: found, category: '3', expandedFrom: '' });
});

test('分類瀏覽、空白查詢、分頁與全庫搜尋不觸發擴大', async () => {
  for (const override of [{ q: '' }, { q: '  ' }, { offset: 60 }, { category: '' }]) {
    let calls = 0;
    const input = { ...params, ...override };
    const response = await searchWithScope(async () => {
      calls++;
      return empty;
    }, input);
    assert.equal(calls, 1, JSON.stringify(override));
    assert.equal(response.category, input.category);
    assert.equal(response.expandedFrom, '');
  }
});

test('全部分類仍無詞目時保留真實零筆結果', async () => {
  let calls = 0;
  const response = await searchWithScope(async () => {
    calls++;
    return empty;
  }, params);
  assert.equal(calls, 2);
  assert.deepEqual(response, { result: empty, category: '', expandedFrom: '3' });
});

test('舊分類查詢完成時，不再發出全庫查詢或回傳可套用結果', async () => {
  let current = true,
    calls = 0;
  const waiting = deferred();
  const pending = searchWithScope(
    () => {
      calls++;
      return waiting.promise;
    },
    params,
    () => current,
  );
  current = false;
  waiting.resolve(empty);
  assert.equal(await pending, null);
  assert.equal(calls, 1);
});

test('擴大搜尋期間換字或離頁，舊結果不得清除新分類', async () => {
  let current = true,
    calls = 0;
  const waiting = deferred(),
    expanded = deferred();
  const pending = searchWithScope(
    () => {
      calls++;
      if (calls === 1) return Promise.resolve(empty);
      expanded.resolve();
      return waiting.promise;
    },
    params,
    () => current,
  );
  await expanded.promise;
  current = false;
  waiting.resolve(found);
  assert.equal(await pending, null);
  assert.equal(calls, 2);
  assert.equal(
    await searchWithScope(
      () => {
        throw Error('不應送出');
      },
      params,
      () => false,
    ),
    null,
  );
});

test('擴大搜尋沿用繁簡字、別稱與萬用字元，網路錯誤不偽裝成查無結果', async () => {
  for (const [q, mode] of [
    ['坏小子', 'contains'],
    ['揤*', 'wildcard'],
    ['揤', 'suffix'],
  ]) {
    const calls = [];
    const response = await searchWithScope(
      async (url) => {
        const query = new URL(url, 'https://test.invalid').searchParams;
        calls.push(query);
        return calls.length === 1 ? empty : found;
      },
      { ...params, q, mode },
    );
    assert.equal(response.result, found);
    assert.ok(calls.every((query) => query.get('q') === q && query.get('mode') === mode));
  }
  let calls = 0;
  await assert.rejects(
    searchWithScope(async () => {
      if (++calls === 1) return empty;
      throw new Error('載入失敗');
    }, params),
    /載入失敗/,
  );
});
