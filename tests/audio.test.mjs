import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createAudioPlayer,
  createStudyAutoplay,
  studyAudioTracks,
  answerAudioTracks,
  studyExample,
} from '../site/audio-player.mjs';
import { exampleSources, wordSources } from '../site/audio-sources.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
class FakeAudio extends EventTarget {
  constructor(play = () => Promise.resolve()) {
    super();
    this.onPlay = play;
    this.sources = [];
    this.error = null;
  }
  set src(value) {
    this.source = value;
    this.error = null;
    this.sources.push(value);
  }
  get src() {
    return this.source;
  }
  play() {
    return this.onPlay(this.src);
  }
  pause() {}
  end() {
    this.dispatchEvent(new Event('ended'));
  }
  fail() {
    this.error = new Error('network');
    this.dispatchEvent(new Event('error'));
  }
}

test('例句以官方實際網址或完整鏡像播放，不猜本機編號、不開網頁', async () => {
  const official = JSON.parse(
    await readFile(new URL('../site/data/example-audio.json', import.meta.url)),
  );
  const catalog = JSON.parse(
    await readFile(new URL('../site/data/audio-catalog.json', import.meta.url)),
  );
  assert.equal(Object.keys(catalog.files).length, 17907);
  const sources = exampleSources(13307, official, catalog);
  assert.ok(sources[0].endsWith('/leku/58/58234.mp3'));
  assert.ok(sources[1].endsWith('/leku/12183-1-1.mp3'));
  assert.ok(exampleSources(1000, official, catalog)[0].endsWith('/898-1-1.mp3'));
  assert.throws(() =>
    exampleSources(1, {}, { baseURL: 'https://example.com/', files: { 1: '../evil.mp3' } }),
  );
  assert.throws(() => exampleSources(999999, official, catalog));
});

test('播放完成回傳成功；主音檔失敗後改用備援', async () => {
  const started = deferred();
  const audio = new FakeAudio((src) =>
    src === 'official' ? Promise.reject(new Error('network')) : Promise.resolve(),
  );
  const player = createAudioPlayer(audio);
  const done = player.play(['official', 'mirror'], started.resolve);
  await started.promise;
  assert.deepEqual(audio.sources, ['official', 'mirror']);
  audio.end();
  assert.equal(await done, true);
});

test('單字優先使用核對過的原始鏡像，保留官方備援；拒絕錯詞與外部網址', async () => {
  const catalog = JSON.parse(
    await readFile(new URL('../site/data/word-audio-catalog.json', import.meta.url)),
  );
  assert.equal(Object.keys(catalog.files).length, 22298);
  for (const id of [1, 2, 4496, 5570, 6001]) {
    const sources = wordSources(id, catalog);
    assert.ok(sources[0].endsWith(`/sutiau/${id}(1).mp3`));
    assert.equal(
      sources[1],
      `https://sutian.moe.edu.tw/media/senn/mp3/imtong/subak/${Math.floor(id / 1000)}/${id}.mp3`,
    );
  }
  for (const bad of [
    { ...catalog, baseURL: 'https://example.com/' },
    { ...catalog, files: { 1: '2(1).mp3' } },
    { ...catalog, files: { 1: '../1(1).mp3' } },
    undefined,
  ])
    assert.deepEqual(wordSources(1, bad), [wordSources(1)[0]]);
  for (const bad of [0, -1, '../1', 1.5, Infinity]) assert.throws(() => wordSources(bad, catalog));
});

test('詞目、課程例字均取得鏡像與備援；索引下載失敗可再試', async () => {
  const original = { document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = { documentElement: { dataset: { runtime: 'static' } } };
  let failedOnce = false;
  globalThis.fetch = async (url) => {
    const name = new URL(url).pathname.split('/').pop();
    if (name === 'word-audio-catalog.json' && !failedOnce) {
      failedOnce = true;
      throw new Error('network');
    }
    return {
      ok: true,
      json: async () =>
        JSON.parse(await readFile(new URL(`../site/data/${name}`, import.meta.url))),
    };
  };
  try {
    const api = await import('../site/api.mjs?audio-regression');
    assert.equal((await api.audioURLs({ id: 1 })).length, 1);
    assert.equal((await api.audioURLs({ id: 1 })).length, 2);
    const sounds = JSON.parse(
      await readFile(new URL('../site/data/sound-examples.json', import.meta.url)),
    );
    for (const key of Object.keys(sounds))
      assert.equal((await api.audioURLs(null, 0, key)).length, 2);
  } finally {
    globalThis.document = original.document;
    globalThis.fetch = original.fetch;
  }
});

test('媒體 error 與 play 拒絕同時發生時，只切換一次來源', async () => {
  const first = deferred(),
    started = deferred();
  const audio = new FakeAudio((src) => (src === 'a' ? first.promise : Promise.resolve()));
  const player = createAudioPlayer(audio);
  const done = player.play(['a', 'b', 'c'], started.resolve);
  audio.fail();
  first.reject(new Error('network'));
  await started.promise;
  assert.deepEqual(audio.sources, ['a', 'b']);
  audio.end();
  assert.equal(await done, true);
});

test('快速換詞會取消前次播放，舊 play Promise 不會更新新詞狀態', async () => {
  const first = deferred(),
    started = deferred();
  let oldUpdates = 0;
  const audio = new FakeAudio((src) => (src === 'old' ? first.promise : Promise.resolve()));
  const player = createAudioPlayer(audio);
  const old = player.play(['old'], () => oldUpdates++);
  const next = player.play(['new'], started.resolve);
  assert.equal(await old, false);
  first.resolve();
  await started.promise;
  assert.equal(oldUpdates, 0);
  assert.equal(audio.src, 'new');
  player.stop();
  assert.equal(await next, false);
});

test('瀏覽器拒絕自動播放時回報限制，不輪流嘗試全部來源', async () => {
  const error = new Error('blocked');
  error.name = 'NotAllowedError';
  const audio = new FakeAudio(() => Promise.reject(error));
  const player = createAudioPlayer(audio);
  await assert.rejects(player.play(['a', 'b']), { name: 'NotAllowedError' });
  assert.deepEqual(audio.sources, ['a']);
});

test('載入逾時會切換來源並可停止，不留下待播錄音', async () => {
  const started = deferred();
  const audio = new FakeAudio((src) =>
    src === 'stalled' ? new Promise(() => {}) : Promise.resolve(),
  );
  const player = createAudioPlayer(audio, 10);
  const done = player.play(['stalled', 'ready'], started.resolve);
  await started.promise;
  assert.deepEqual(audio.sources, ['stalled', 'ready']);
  player.stop();
  assert.equal(await done, false);
});

test('播放已開始但緩衝卡住仍切換備援，恢復播放或停止時取消計時', async () => {
  const audio = new FakeAudio();
  const player = createAudioPlayer(audio, 15);
  const started = deferred(),
    backup = deferred();
  let plays = 0;
  const done = player.play(['mirror', 'official'], () =>
    (++plays === 1 ? started : backup).resolve(),
  );
  await started.promise;
  audio.dispatchEvent(new Event('waiting'));
  await backup.promise;
  assert.deepEqual(audio.sources, ['mirror', 'official']);
  audio.end();
  assert.equal(await done, true);
  const nextStarted = deferred();
  const next = player.play(['mirror', 'official'], nextStarted.resolve);
  await nextStarted.promise;
  audio.dispatchEvent(new Event('waiting'));
  audio.dispatchEvent(new Event('playing'));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(audio.sources.length, 3);
  audio.dispatchEvent(new Event('waiting'));
  player.stop();
  assert.equal(await next, false);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(audio.sources.length, 3);
});

test('五種詞目題型自動讀詞，辨音模式依順序讀選項且不標示正解', () => {
  const target = { id: 1, audio: true };
  for (const mode of ['meaning', 'sound-hanji', 'sound-meaning', 'dictation', 'flash'])
    assert.deepEqual(studyAudioTracks(target, mode), [{ key: 'moe:1', label: '' }]);
  assert.deepEqual(studyAudioTracks(target, 'meaning-sound', [target, { id: 2, audio: true }]), [
    { key: 'moe:1', label: '錄音 1' },
    { key: 'moe:2', label: '錄音 2' },
  ]);
  assert.deepEqual(studyAudioTracks({ id: 2, audio: false }, 'flash'), []);
});

test('同張卡重新繪製不重播；換詞會取消舊選項序列', async () => {
  const calls = [];
  let pending;
  const autoplay = createStudyAutoplay(
    (track) => {
      calls.push(track.key);
      pending = deferred();
      return pending.promise;
    },
    () => pending?.resolve(false),
  );
  const first = autoplay.run('card1', [{ key: 'a' }, { key: 'b' }]);
  await autoplay.run('card1', [{ key: 'a' }, { key: 'b' }]);
  assert.deepEqual(calls, ['a']);
  const next = autoplay.run('card2', [{ key: 'c' }]);
  await first;
  assert.deepEqual(calls, ['a', 'c']);
  autoplay.cancel();
  await next;
});

test('辨音選項播完一個再播下一個，手動停止即停止序列', async () => {
  const calls = [];
  const autoplay = createStudyAutoplay(
    async (track) => {
      calls.push(track.key);
      return track.key !== 'b';
    },
    () => {},
  );
  await autoplay.run('one', [{ key: 'a' }, { key: 'b' }, { key: 'c' }]);
  assert.deepEqual(calls, ['a', 'b']);
});

test('作答後只讀正確詞目，再讀第一筆有錄音的例句；缺音不偽造來源', () => {
  const target = {
    id: 12183,
    audio: true,
    senses: [
      {
        examples: [
          { id: 1, hanji: '無錄音' },
          { id: 13307, audio_basename: '12183-1-1' },
          { id: 2, audio_basename: '12183-1-2' },
        ],
      },
    ],
  };
  assert.equal(studyExample(target).id, 13307);
  assert.deepEqual(answerAudioTracks(target), [
    { key: 'moe:12183', label: '' },
    { key: 'moe:12183', example: 13307, label: '' },
  ]);
  assert.deepEqual(answerAudioTracks({ id: 1, audio: true }), [{ key: 'moe:1', label: '' }]);
  assert.deepEqual(answerAudioTracks({ id: 1, audio: false }), []);
  assert.deepEqual(answerAudioTracks(null), []);
  assert.deepEqual(answerAudioTracks({ ...target, audio: false }), [
    { key: 'moe:12183', example: 13307, label: '' },
  ]);
});

test('作答錄音等詞目 ended 才播例句，換下一詞不殘留上一詞例句', async () => {
  const audio = new FakeAudio();
  const player = createAudioPlayer(audio);
  const starts = [deferred(), deferred(), deferred(), deferred()];
  let index = 0;
  const autoplay = createStudyAutoplay(
    (track) =>
      player.play([`${track.key}/${track.example || 'word'}`], () => starts[index++].resolve()),
    player.stop,
  );
  const target = {
    id: 1,
    audio: true,
    senses: [{ examples: [{ id: 42, audio_basename: 'one' }] }],
  };
  const first = autoplay.run('answer1', answerAudioTracks(target));
  await starts[0].promise;
  assert.deepEqual(audio.sources, ['moe:1/word']);
  audio.end();
  await starts[1].promise;
  assert.deepEqual(audio.sources, ['moe:1/word', 'moe:1/42']);
  audio.end();
  await first;
  const second = autoplay.run('answer2', answerAudioTracks(target));
  await starts[2].promise;
  const next = autoplay.run('next', [{ key: 'moe:2' }]);
  await starts[3].promise;
  await second;
  assert.deepEqual(audio.sources, ['moe:1/word', 'moe:1/42', 'moe:1/word', 'moe:2/word']);
  autoplay.cancel();
  await next;
});
