import assert from 'node:assert/strict';
import test from 'node:test';
import { STARTUP_HELP_STORAGE_KEY, isStartupHelpHidden, storeStartupHelpHidden } from '../src/startup-help.js';

test('startup help remains visible for new and unrecognized preferences', () => {
  for (const value of [null, '', 'false', '1', 'invalid']) {
    assert.equal(isStartupHelpHidden({ getItem: () => value }), false);
  }
});

test('opting out survives a fresh read and can be reversed from manual help', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(storeStartupHelpHidden(true, storage), true);
  assert.equal(values.get(STARTUP_HELP_STORAGE_KEY), 'true');
  assert.equal(isStartupHelpHidden(storage), true);
  assert.equal(storeStartupHelpHidden(false, storage), true);
  assert.equal(isStartupHelpHidden(storage), false);
});

test('unavailable or denied preference storage cannot block help or crash closing', () => {
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(isStartupHelpHidden(denied), false);
  assert.equal(storeStartupHelpHidden(true, denied), false);
  assert.equal(isStartupHelpHidden(null), false);
  assert.equal(storeStartupHelpHidden(true, null), false);
});
