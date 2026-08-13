import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canOverwriteOpenedFile,
  getFileDisplayName,
  isUriBackedFilePath,
  writeNativeDocument
} from '../src/platform-file.js';

test('recognizes Android and iOS document URIs without misclassifying desktop paths', () => {
  assert.equal(isUriBackedFilePath('content://provider/document/notes.md'), true);
  assert.equal(isUriBackedFilePath('file:///storage/emulated/0/notes.md'), true);
  assert.equal(isUriBackedFilePath('C:\\notes\\draft.md'), false);
  assert.equal(isUriBackedFilePath('/home/user/draft.md'), false);
});

test('opened document URIs require a save destination before they can be overwritten', () => {
  assert.equal(canOverwriteOpenedFile('content://provider/document/notes.md'), false);
  assert.equal(canOverwriteOpenedFile('C:\\notes\\draft.md'), true);
  assert.equal(canOverwriteOpenedFile(null), false);
});

test('extracts readable names from Android storage-provider URIs', () => {
  assert.equal(
    getFileDisplayName(
      'content://com.android.providers.downloads.documents/document/primary%3ADownload%2F%E7%AC%94%E8%AE%B0.md'
    ),
    '笔记.md'
  );
  assert.equal(getFileDisplayName('C:\\notes\\draft.md'), 'draft.md');
  assert.equal(getFileDisplayName(null), '未命名.md');
});

test('writes document URIs through the filesystem plugin', async () => {
  const calls = [];

  const route = await writeNativeDocument({
    filePath: 'content://provider/document/notes.md',
    content: '你好 Android',
    writeFile: async (path, bytes) => calls.push(['writeFile', path, bytes]),
    invoke: async (...args) => calls.push(['invoke', ...args])
  });

  assert.equal(route, 'document-uri');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'writeFile');
  assert.equal(calls[0][1], 'content://provider/document/notes.md');
  assert.equal(new TextDecoder().decode(calls[0][2]), '你好 Android');
});

test('keeps atomic replacement for ordinary desktop paths', async () => {
  const calls = [];

  const route = await writeNativeDocument({
    filePath: 'C:\\notes\\draft.md',
    content: 'desktop',
    writeFile: async (...args) => calls.push(['writeFile', ...args]),
    invoke: async (...args) => calls.push(['invoke', ...args])
  });

  assert.equal(route, 'atomic-path');
  assert.deepEqual(calls, [[
    'invoke',
    'write_text_file_atomic',
    { path: 'C:\\notes\\draft.md', content: 'desktop' }
  ]]);
});
