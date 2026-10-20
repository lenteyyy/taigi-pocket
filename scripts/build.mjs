import { mkdir, copyFile, readFile, writeFile, readdir, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
await mkdir(new URL('site/vendor/', root), { recursive: true });
for (const file of ['sql-wasm.js', 'sql-wasm.wasm'])
  await copyFile(
    new URL('node_modules/sql.js/dist/' + file, root),
    new URL('site/vendor/' + file, root),
  );
await copyFile(
  new URL('node_modules/sql.js/LICENSE', root),
  new URL('site/vendor/LICENSE-sql.js.txt', root),
);
const manifest = JSON.parse(await readFile(new URL('site/data/provenance.json', root)));
if (
  manifest['taigi-dict.sqlite'].entryCount !== 29591 ||
  manifest['taigi-soannteng.sqlite'].entryCount !== 91332
)
  throw new Error('詞典快照數量不符。');
await rm(new URL('dist/', root), { recursive: true, force: true });
await cp(new URL('site/', root), new URL('dist/', root), { recursive: true });
// 所有自有模組共用同一版本，避免入口更新後仍匯入舊版音訊程式。
const modules = (await readdir(new URL('site/', root)))
  .filter((name) => /\.(mjs|js)$/.test(name))
  .sort();
const hash = createHash('sha256');
for (const file of [...modules, 'style.css', 'data/audio-catalog.json', 'data/example-audio.json'])
  hash.update(file).update(await readFile(new URL('site/' + file, root)));
const version = hash.digest('hex').slice(0, 12);
for (const file of modules) {
  const path = new URL('dist/' + file, root);
  const source = await readFile(path, 'utf8');
  await writeFile(
    path,
    source.replace(
      /((?:\bfrom\s*|\bimport\s*\()\s*['"])(\.\/[^'"]+\.mjs)(['"])/g,
      (_, before, target, after) => before + target + '?v=' + version + after,
    ),
  );
}
let index = await readFile(new URL('dist/index.html', root), 'utf8');
for (const file of ['style.css', 'app.mjs']) {
  index = index.replace(`"./${file}"`, `"./${file}?v=${version}"`);
}
await writeFile(new URL('dist/index.html', root), index);
console.log('GitHub Pages 靜態網站已建立：dist/');
