import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const tauriConfig = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
);

test('release commands build a standalone EXE without an installer bundle', () => {
  assert.match(packageJson.scripts.dist, /tauri build --no-bundle/);
  assert.match(packageJson.scripts['dist:win'], /tauri build --no-bundle/);
  assert.equal(tauriConfig.bundle.active, false);
  assert.equal(tauriConfig.bundle.windows, undefined);
  assert.equal(tauriConfig.bundle.fileAssociations, undefined);
});
