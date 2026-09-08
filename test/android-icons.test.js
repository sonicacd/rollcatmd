import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = new URL('../src-tauri/icons/android/', import.meta.url);
const consumer = new URL('../src-tauri/gen/android/app/src/main/res/', import.meta.url);
const densities = [
  ['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]
];

test('Android launcher PNGs use density-specific sizes and match the resources Gradle consumes', () => {
  for (const [density, iconSize, foregroundSize] of densities) {
    for (const [name, size] of [['ic_launcher', iconSize], ['ic_launcher_round', iconSize], ['ic_launcher_foreground', foregroundSize]]) {
      const relative = `mipmap-${density}/${name}.png`;
      const generated = readFileSync(new URL(relative, source));
      const packaged = readFileSync(new URL(relative, consumer));
      assert.deepEqual(packaged, generated, `${relative}: Android project has stale launcher artwork; run node scripts/sync-android-icons.mjs`);
      assert.equal(generated.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', relative);
      assert.equal(generated.readUInt32BE(16), size, `${relative}: width`);
      assert.equal(generated.readUInt32BE(20), size, `${relative}: height`);
    }
  }
});

test('both Android launcher names select the same adaptive cat foreground and background', () => {
  const normal = readFileSync(new URL('mipmap-anydpi-v26/ic_launcher.xml', source), 'utf8');
  const round = readFileSync(new URL('mipmap-anydpi-v26/ic_launcher_round.xml', source), 'utf8');
  assert.equal(normal, round);
  assert.match(normal, /<adaptive-icon\b/);
  assert.match(normal, /@mipmap\/ic_launcher_foreground/);
  assert.match(normal, /@color\/ic_launcher_background/);
  for (const relative of ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml', 'values/ic_launcher_background.xml']) {
    assert.equal(readFileSync(new URL(relative, consumer), 'utf8'), readFileSync(new URL(relative, source), 'utf8'), relative);
  }
  assert.match(readFileSync(new URL('values/ic_launcher_background.xml', consumer), 'utf8'), /#15191c/);
});
