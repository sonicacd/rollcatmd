import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AVAILABLE_THEMES,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  applyTheme,
  normalizeTheme,
  readStoredTheme,
  storeTheme
} from '../src/theme.js';

const themeCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const pageHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('only the three supported themes are accepted', () => {
  assert.deepEqual(AVAILABLE_THEMES, ['black', 'white', 'eye']);
  assert.equal(normalizeTheme('black'), 'black');
  assert.equal(normalizeTheme('white'), 'white');
  assert.equal(normalizeTheme('eye'), 'eye');
  assert.equal(normalizeTheme('purple'), DEFAULT_THEME);
  assert.equal(normalizeTheme(null), DEFAULT_THEME);
});

test('stored theme is read and invalid values safely fall back', () => {
  const storage = {
    getItem(key) {
      assert.equal(key, THEME_STORAGE_KEY);
      return 'white';
    }
  };

  assert.equal(readStoredTheme(storage), 'white');
  assert.equal(readStoredTheme({ getItem: () => 'unknown' }), DEFAULT_THEME);
});

test('storage failures never prevent startup or theme changes', () => {
  const unavailableStorage = {
    getItem() {
      throw new Error('storage unavailable');
    },
    setItem() {
      throw new Error('storage unavailable');
    }
  };

  assert.equal(readStoredTheme(unavailableStorage), DEFAULT_THEME);
  assert.equal(storeTheme('black', unavailableStorage), false);
});

test('applyTheme updates the root and optionally persists the choice', () => {
  const writes = [];
  const root = { dataset: {}, style: {} };
  const storage = {
    setItem(key, value) {
      writes.push([key, value]);
    }
  };

  assert.equal(applyTheme('black', { root, storage }), 'black');
  assert.equal(root.dataset.theme, 'black');
  assert.equal(root.style.colorScheme, 'dark');
  assert.deepEqual(writes, [[THEME_STORAGE_KEY, 'black']]);

  applyTheme('white', { root, storage, persist: false });
  assert.equal(root.dataset.theme, 'white');
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(writes.length, 1);
});

test('the page exposes a keyboard-native selector for all three themes', () => {
  assert.match(
    pageHtml,
    /<label\s+[^>]*class="theme-control"[^>]*for="themeSelect"[^>]*>/
  );
  assert.match(pageHtml, /<select id="themeSelect" aria-label="界面主题">/);

  for (const theme of AVAILABLE_THEMES) {
    assert.match(pageHtml, new RegExp(`<option value="${theme}">`));
  }
});

test('theme CSS defines pure canvases and shared editor color tokens', () => {
  assert.match(themeCss, /:root\[data-theme="black"\][\s\S]*?--bg: #000000;/);
  assert.match(themeCss, /:root\[data-theme="white"\][\s\S]*?--bg: #ffffff;/);
  assert.match(themeCss, /:root\[data-theme="eye"\]/);

  for (const token of [
    '--text:',
    '--surface-deep:',
    '--focus-ring:',
    '--selection:',
    '--toolbar-icon-filter:'
  ]) {
    assert.equal(themeCss.split(token).length - 1, 3, `${token} should exist in every theme`);
  }

  assert.doesNotMatch(themeCss, /#(?:9b87f5|c8bfff|d8d0ff|2c2738|24212d|201e27|2a2633|191820)\b/i);
  assert.doesNotMatch(themeCss, /rgba?\(155,\s*135,\s*245/i);
});
