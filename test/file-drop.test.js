import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNativeFileDropHandler,
  isSupportedDroppedFilePath,
  registerNativeFileDrop,
  selectDroppedDocumentPath
} from '../src/file-drop.js';

test('recognizes supported Markdown and text file paths case-insensitively', () => {
  for (const filePath of [
    'C:\\notes\\draft.md',
    'C:\\notes\\README.MARKDOWN',
    '/home/user/draft.mdown',
    '/home/user/draft.MKD',
    '/home/user/plain.txt'
  ]) {
    assert.equal(isSupportedDroppedFilePath(filePath), true, filePath);
  }
});

test('rejects empty, extensionless, hidden-extension, and unsupported paths', () => {
  for (const filePath of [
    null,
    '',
    'C:\\notes\\draft',
    'C:\\notes\\draft.md.exe',
    '/home/user/.md',
    '/home/user/page.html'
  ]) {
    assert.equal(isSupportedDroppedFilePath(filePath), false, String(filePath));
  }
});

test('selects the first supported document from a mixed drop', () => {
  assert.equal(selectDroppedDocumentPath([
    'C:\\notes\\image.png',
    'C:\\notes\\first.md',
    'C:\\notes\\second.txt'
  ]), 'C:\\notes\\first.md');
  assert.equal(selectDroppedDocumentPath(['C:\\notes\\image.png']), null);
  assert.equal(selectDroppedDocumentPath(null), null);
});

test('only completed native drops open a document', async () => {
  const opened = [];
  const handler = createNativeFileDropHandler({
    onFileDrop: async (...args) => opened.push(args)
  });

  assert.equal(handler({ payload: { type: 'enter', paths: ['C:\\notes\\draft.md'] } }), undefined);
  assert.equal(handler({ payload: { type: 'over' } }), undefined);
  assert.equal(handler({ payload: { type: 'leave' } }), undefined);
  await handler({
    payload: {
      type: 'drop',
      paths: ['C:\\notes\\image.png', 'C:\\notes\\draft.md']
    }
  });

  assert.deepEqual(opened, [[
    'C:\\notes\\draft.md',
    ['C:\\notes\\image.png', 'C:\\notes\\draft.md']
  ]]);
});

test('reports a drop that contains no supported document', async () => {
  const unsupported = [];
  const handler = createNativeFileDropHandler({
    onFileDrop: () => assert.fail('unsupported drops must not open a file'),
    onUnsupportedDrop: async (paths) => unsupported.push(paths)
  });

  await handler({
    payload: { type: 'drop', paths: ['C:\\notes\\image.png'] }
  });

  assert.deepEqual(unsupported, [['C:\\notes\\image.png']]);
});

test('forwards asynchronous opening failures without an unhandled rejection', async () => {
  const failures = [];
  const handler = createNativeFileDropHandler({
    onFileDrop: async () => {
      throw new Error('read failed');
    },
    onError: async (...args) => failures.push(args)
  });

  await handler({
    payload: { type: 'drop', paths: ['C:\\notes\\draft.md'] }
  });

  assert.equal(failures.length, 1);
  assert.match(failures[0][0].message, /read failed/);
  assert.deepEqual(failures[0][1], {
    filePath: 'C:\\notes\\draft.md',
    paths: ['C:\\notes\\draft.md']
  });
});

test('registers the handler on the Tauri window and returns its unlisten result', async () => {
  let registeredHandler = null;
  const unlisten = () => {};
  const tauriWindow = {
    async onDragDropEvent(handler) {
      registeredHandler = handler;
      return unlisten;
    }
  };
  const opened = [];

  const result = await registerNativeFileDrop(tauriWindow, {
    onFileDrop: (filePath) => opened.push(filePath)
  });
  await registeredHandler({
    payload: { type: 'drop', paths: ['C:\\notes\\draft.md'] }
  });

  assert.equal(result, unlisten);
  assert.deepEqual(opened, ['C:\\notes\\draft.md']);
});
