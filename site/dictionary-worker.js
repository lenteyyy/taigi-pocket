/* Made By 冷踢踢. 詞典查詢留在瀏覽器，避免阻塞畫面。 */
importScripts('./vendor/sql-wasm.js');
const databases = new Map();
const SQL = initSqlJs({
  locateFile: (file) => new URL('./vendor/' + file, self.location.href).href,
});
async function json(path) {
  const url = new URL(path, self.location.href);
  const version = new URL(self.location.href).searchParams.get('v');
  if (version) url.searchParams.set('v', version);
  const response = await fetch(url);
  if (!response.ok) throw new Error('無法下載詞典資料，請確認網路後重新整理。');
  return response.json();
}
async function loadDatabase(source) {
  if (!databases.has(source)) {
    const promise = (async () => {
      if (!self.DecompressionStream)
        throw new Error('請使用新版 Safari、Chrome、Edge 或 Firefox 開啟詞典。');
      const file = source === 'moe' ? 'taigi-dict.sqlite.gz' : 'taigi-soannteng.sqlite.gz';
      const response = await fetch('./data/' + file);
      if (!response.ok) throw new Error('無法下載詞典資料，請確認網路後重新整理。');
      const bytes = await new Response(
        response.body.pipeThrough(new DecompressionStream('gzip')),
      ).arrayBuffer();
      return new (await SQL).Database(new Uint8Array(bytes));
    })();
    databases.set(source, promise);
    promise.catch(() => databases.delete(source));
  }
  return databases.get(source);
}
const ready = Promise.all([
  import('./dictionary.mjs'),
  json('./data/courses.json'),
  json('./data/sound-examples.json'),
  json('./data/example-audio.json'),
  json('./data/audio-catalog.json'),
  json('./data/search.json'),
]).then(([module, courseMap, soundExamples, exampleAudio, audioCatalog, searchData]) =>
  module.createDictionary({
    loadDatabase,
    courseMap,
    soundExamples,
    exampleAudio,
    audioCatalog,
    searchData,
  }),
);
ready.catch(() => {});
self.onmessage = async (event) => {
  const { id, path, options } = event.data;
  try {
    self.postMessage({ id, result: await (await ready).request(path, options) });
  } catch (error) {
    self.postMessage({ id, error: error.message || '詞典暫時無法讀取，請重新整理。' });
  }
};
