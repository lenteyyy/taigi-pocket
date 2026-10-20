import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

test('發布入口以內容版本載入樣式與程式，GitHub 子路徑正確', async () => {
  const root = new URL('../', import.meta.url);
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root });
  const index = await readFile(new URL('dist/index.html', root), 'utf8');
  const version = index.match(/style\.css\?v=([a-f0-9]{12})/)[1];
  for (const file of ['style.css', 'app.mjs']) {
    const url = `./${file}?v=${version}`;
    assert.ok(index.includes(`"${url}"`));
    assert.equal(
      new URL(url, 'https://lenteyyy.github.io/taigi-pocket/').pathname,
      '/taigi-pocket/' + file,
    );
  }
  for (const file of [
    'app.mjs',
    'api.mjs',
    'audio-player.mjs',
    'dictionary.mjs',
    'dictionary-worker.js',
  ]) {
    const source = await readFile(new URL('dist/' + file, root), 'utf8');
    const imports = [
      ...source.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*['"](\.\/[^'"]+\.mjs[^'"]*)['"]/g),
    ];
    assert.ok(imports.length, file);
    for (const [, target] of imports)
      assert.ok(target.endsWith('?v=' + version), file + ': ' + target);
  }
});
