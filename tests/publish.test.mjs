import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

test('發布入口以內容版本載入樣式與程式，GitHub 子路徑正確', async () => {
  const root = new URL('../', import.meta.url);
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root });
  const index = await readFile(new URL('dist/index.html', root), 'utf8');
  for (const file of ['style.css', 'app.mjs']) {
    const content = await readFile(new URL('dist/' + file, root));
    const version = createHash('sha256').update(content).digest('hex').slice(0, 12);
    const url = `./${file}?v=${version}`;
    assert.ok(index.includes(`"${url}"`));
    assert.equal(
      new URL(url, 'https://lenteyyy.github.io/taigi-pocket/').pathname,
      '/taigi-pocket/' + file,
    );
  }
});
