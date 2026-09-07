import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  applyPreferences,
  normalizePreferences,
  readPreferences,
  savePreferences
} from '../src/workspace-preferences.js';

test('first launch retains the existing width and opens the enabled outline', () => {
  assert.deepEqual(readPreferences({ getItem: () => null }), DEFAULT_PREFERENCES);
  assert.equal(DEFAULT_PREFERENCES.contentWidth, 1200);
  assert.equal(DEFAULT_PREFERENCES.outlineEnabled, true);
  assert.equal(DEFAULT_PREFERENCES.outlineExpanded, true);
  assert.equal(DEFAULT_PREFERENCES.showTokens, false);
});

test('stored widths can widen the document but never reduce its existing width', () => {
  for (const width of [1200, 1600, 2100, 'full']) {
    assert.equal(normalizePreferences({ contentWidth: width }).contentWidth, width);
  }
  for (const width of [800, 900, -1, 0, 1199, 'auto', '100%;color:red']) {
    assert.equal(normalizePreferences({ contentWidth: width }).contentWidth, 1200);
  }
});

test('settings round trip including independently disabling and collapsing the outline', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const preferences = { fontSize: 20, lineHeight: 1.7, contentWidth: 2100, outlineEnabled: false, outlineExpanded: true, showTokens: true };
  assert.deepEqual(savePreferences(preferences, storage), preferences);
  assert.deepEqual(readPreferences(storage), preferences);
  assert.ok(values.has(PREFERENCES_STORAGE_KEY));
  assert.equal(normalizePreferences({ outlineExpanded: false }).outlineEnabled, true);
});

test('malformed or inaccessible storage cannot prevent opening a document', () => {
  assert.deepEqual(readPreferences({ getItem: () => '{bad' }), DEFAULT_PREFERENCES);
  assert.deepEqual(readPreferences({ getItem() { throw Error('denied'); } }), DEFAULT_PREFERENCES);
  assert.doesNotThrow(() => savePreferences({ fontSize: 18 }, { setItem() { throw Error('full'); } }));
  assert.deepEqual(normalizePreferences({ fontSize: NaN, lineHeight: Infinity, showTokens: 'true', outlineEnabled: null }), DEFAULT_PREFERENCES);
});

test('applying settings updates shared typography without losing a theme or forcing a disk write', () => {
  const properties = new Map();
  const root = { style: { setProperty: (key, value) => properties.set(key, value) }, dataset: { theme: 'black' } };
  const preferences = applyPreferences({ fontSize: '24', lineHeight: '2', contentWidth: 'full', outlineEnabled: false }, {
    root, persist: false, storage: { setItem() { throw Error('unexpected persistence'); } }
  });
  assert.equal(preferences.fontSize, 24);
  assert.equal(properties.get('--document-font-size'), '24px');
  assert.equal(properties.get('--document-line-height'), '2');
  assert.equal(properties.get('--document-max-width'), '100%');
  assert.equal(properties.get('--document-layout-max-width'), '100%');
  assert.equal(root.dataset.theme, 'black');
  assert.equal(root.dataset.outlineEnabled, 'false');
  applyPreferences({ contentWidth: 2100 }, { root, persist: false });
  assert.equal(properties.get('--document-layout-max-width'), 'calc(2100px + 72px)');
});
