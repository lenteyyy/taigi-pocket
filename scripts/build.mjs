import { mkdir, copyFile, readFile, writeFile, rm, cp } from 'node:fs/promises';
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
// 入口與樣式更新後使用新網址，避免重新部署時仍讀到快取的字型規則。
let index = await readFile(new URL('dist/index.html', root), 'utf8');
for (const file of ['style.css', 'app.mjs']) {
  const content = await readFile(new URL('dist/' + file, root));
  const version = createHash('sha256').update(content).digest('hex').slice(0, 12);
  index = index.replace(`"./${file}"`, `"./${file}?v=${version}"`);
}
await writeFile(new URL('dist/index.html', root), index);
console.log('GitHub Pages 靜態網站已建立：dist/');
