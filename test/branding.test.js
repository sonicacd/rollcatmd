import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const tauriConfig = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
);
const cargoToml = readFileSync(
  new URL('../src-tauri/Cargo.toml', import.meta.url),
  'utf8'
);
const pageHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('uses the rollcat-md technical name and 滚猫md display name', () => {
  assert.equal(packageJson.name, 'rollcat-md');
  assert.match(cargoToml, /^\s*name\s*=\s*"rollcat-md"\s*$/m);
  assert.equal(tauriConfig.productName, '滚猫md');
  assert.equal(tauriConfig.app.windows[0].title, '滚猫md');
  assert.match(pageHtml, /<title>滚猫md<\/title>/);
});
