import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAudioPlayer, createStudyAutoplay, studyAudioTracks } from '../site/audio-player.mjs';
import { exampleSources } from '../site/audio-sources.mjs';

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
