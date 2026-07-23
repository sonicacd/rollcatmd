import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function readPngSize(url) {
  const png = readFileSync(url);

  assert.deepEqual(
    [...png.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${url} must be a PNG`
  );

  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20)
  };
}

test('the generated cat MD icon has the expected Tauri PNG sizes', () => {
  const icons = [
    ['../src-tauri/icons/32x32.png', 32],
    ['../src-tauri/icons/128x128.png', 128],
    ['../src-tauri/icons/128x128@2x.png', 256],
    ['../src-tauri/icons/icon.png', 512],
    ['../src/assets/cat-md-icon.png', 128]
  ];

  for (const [path, size] of icons) {
    assert.deepEqual(readPngSize(new URL(path, import.meta.url)), {
      width: size,
      height: size
    });
  }
});

test('the Windows icon is a non-empty ICO and the sidebar uses the new mark', () => {
  const ico = readFileSync(new URL('../src-tauri/icons/icon.ico', import.meta.url));
  const pageHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tauriConfig = JSON.parse(
    readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
  );

  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
  assert.ok(ico.readUInt16LE(4) > 0, 'ICO should contain at least one image');
  assert.match(pageHtml, /src="\/src\/assets\/cat-md-icon\.png"/);
  assert.deepEqual(tauriConfig.bundle.icon, [
    'icons/32x32.png',
    'icons/128x128.png',
    'icons/128x128@2x.png',
    'icons/icon.ico'
  ]);
});
