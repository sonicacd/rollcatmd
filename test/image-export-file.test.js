import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeArchiveTemp, writeAll } from '../src/image-export-file.js';

test('writeAll handles partial file writes', async () => {
  const output = [];
  const file = {
    async write(bytes) {
      const count = Math.min(2, bytes.byteLength);
      output.push(...bytes.subarray(0, count));
      return count;
    }
  };

  await writeAll(file, new Uint8Array([1, 2, 3, 4, 5]));
  assert.deepEqual(output, [1, 2, 3, 4, 5]);
});

test('native archive temp keeps the destination untouched until commit', async () => {
  const files = new Map();
  const removed = [];
  const handles = new Set();

  function writableHandle(path, initial = new Uint8Array()) {
    let bytes = [...initial];
    let readOffset = 0;
    const handle = {
      async write(chunk) {
        bytes.push(...chunk);
        files.set(path, new Uint8Array(bytes));
        return chunk.byteLength;
      },
      async read(buffer) {
        const stored = files.get(path) || new Uint8Array();
        if (readOffset >= stored.byteLength) {
          return null;
        }
        const count = Math.min(buffer.byteLength, stored.byteLength - readOffset);
        buffer.set(stored.subarray(readOffset, readOffset + count));
        readOffset += count;
        return count;
      },
      async close() {
        handles.delete(handle);
      }
    };
    handles.add(handle);
    return handle;
  }

  const archive = await createNativeArchiveTemp({
    randomUUID: () => 'test',
    createFile: async (path) => {
      files.set(path, new Uint8Array());
      return writableHandle(path);
    },
    openFile: async (path, options) => {
      if (options?.truncate) {
        files.set(path, new Uint8Array());
      }
      return writableHandle(path, options?.truncate ? new Uint8Array() : files.get(path));
    },
    removeFile: async (path) => {
      removed.push(path);
      files.delete(path);
    }
  });

  await archive.write(new Uint8Array([9, 8, 7]));
  assert.equal(files.has('chosen.zip'), false);
  await archive.finish();
  await archive.commit('chosen.zip');

  assert.deepEqual([...files.get('chosen.zip')], [9, 8, 7]);
  assert.deepEqual(removed, ['image-export-test.zip']);
  assert.equal(handles.size, 0);
});
