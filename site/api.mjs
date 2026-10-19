const serverMode = document.documentElement.dataset.runtime === 'server';
const base = new URL('.', import.meta.url);
const pending = new Map();
let worker = null,
  sequence = 0,
  metadata = null;
export const assetURL = (path) => new URL(path, base).href;
export const exampleHasAudio = (id) =>
  serverMode || metadata?.exampleAudioKeys?.includes(String(id));
function getWorker() {
  if (!worker) {
    worker = new Worker(assetURL('dictionary-worker.js'));
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task) return;
      clearTimeout(task.timer);
      pending.delete(data.id);
      data.error ? task.reject(new Error(data.error)) : task.resolve(data.result);
    };
    worker.onerror = () => {
      for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(new Error('詞典載入失敗，請重新整理後再試。'));
      }
      pending.clear();
      worker.terminate();
      worker = null;
    };
  }
  return worker;
}
export async function request(path, options) {
  let result;
  if (serverMode) {
    let response;
    try {
      response = await fetch(assetURL(path.replace(/^\//, '')), options);
    } catch {
      throw new Error('無法連線至本機服務，請確認服務已啟動。');
    }
    try {
      result = await response.json();
    } catch {
      throw new Error('服務回應格式不正確，請重新整理後再試。');
    }
    if (!response.ok) throw new Error(result.error || '資料暫時無法讀取。');
  } else {
    const client = getWorker(),
      id = ++sequence;
    result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('詞典載入逾時，請確認網路後重試。'));
      }, 60000);
      pending.set(id, { resolve, reject, timer });
      client.postMessage({ id, path, options });
    });
  }
  if (path === '/api/meta') metadata = result;
  return result;
}
let sounds = null,
  examples = null;
const json = async (path) => {
  const response = await fetch(assetURL(path));
  if (!response.ok) throw new Error('音檔資料暫時無法讀取。');
  return response.json();
};
export async function audioURL(entry, example = 0, sound = '') {
  if (sound) {
    sounds ||= json('data/sound-examples.json');
    const item = (await sounds)[sound];
    if (!item) throw new Error('這個範例目前沒有錄音。');
    return wordAudioURL(item.entry);
  }
  if (serverMode)
    return assetURL(
      'api/audio?' + new URLSearchParams({ entry: entry.id, ...(example ? { example } : {}) }),
    );
  if (example) {
    examples ||= json('data/example-audio.json');
    const path = (await examples)[String(example)];
    if (!path) throw new Error('請至教育部原始詞目聆聽這筆例句。');
    return 'https://sutian.moe.edu.tw' + path;
  }
  return wordAudioURL(entry.id);
}
export function wordAudioURL(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error('詞目編號不正確。');
  return (
    'https://sutian.moe.edu.tw/media/senn/mp3/imtong/subak/' +
    Math.floor(Number(id) / 1000) +
    '/' +
    Number(id) +
    '.mp3'
  );
}
