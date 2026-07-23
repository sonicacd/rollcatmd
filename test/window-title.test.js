import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { formatWindowTitle } from '../src/window-title.js';

const rendererSource = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
const capabilities = JSON.parse(
  readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8')
);

test('window titles place the file name after the application name', () => {
  assert.equal(
    formatWindowTitle('notes.md', false),
    '滚猫md — notes.md'
  );
  assert.equal(
    formatWindowTitle('notes.md', true),
    '滚猫md — notes.md *'
  );
  assert.equal(
    formatWindowTitle('', false),
    '滚猫md — 未命名.md'
  );
});

test('the desktop app is allowed to update its native title bar', () => {
  assert.match(rendererSource, /getCurrentWindow\(\)\.setTitle\(title\)/);
  assert.ok(capabilities.permissions.includes('core:window:allow-set-title'));
});
