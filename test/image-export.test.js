import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildImagePageFileName,
  createImageExportPlan,
  deriveMaxCanvasCssHeight,
  imageDataToUint8Array,
  iterateImageExportPages
} from '../src/image-export.js';

test('keeps every page inside conservative canvas limits', () => {
  assert.equal(deriveMaxCanvasCssHeight(), 2048);
  assert.throws(
    () => deriveMaxCanvasCssHeight({ width: 3000, scale: 2 }),
    /Canvas 边长上限/
  );
});

test('plans one PNG or stable numbered PNG pages', () => {
  const single = createImageExportPlan({ contentHeight: 800, fileName: 'notes.md' });
  assert.equal(single.pageCount, 1);
  assert.equal([...iterateImageExportPages(single)][0].fileName, 'notes.png');

  const paged = createImageExportPlan({ contentHeight: 5000, fileName: 'notes.md' });
  const pages = [...iterateImageExportPages(paged)];
  assert.equal(paged.pageCount, 3);
  assert.deepEqual(pages.map((page) => page.fileName), [
    'notes-001.png',
    'notes-002.png',
    'notes-003.png'
  ]);
  assert.ok(pages.every((page) => page.pixelWidth <= 4096 && page.pixelHeight <= 4096));
});

test('sanitizes export names for the local filesystem', () => {
  assert.equal(buildImagePageFileName('CON.md', 1, 1), '_CON.png');
  assert.equal(buildImagePageFileName('content://docs/My%20File.md', 2, 12), 'My File-002.png');
});

test('converts browser and native binary values to Uint8Array', async () => {
  assert.deepEqual(await imageDataToUint8Array(new Blob(['png'])), new Uint8Array([112, 110, 103]));
  assert.deepEqual(
    await imageDataToUint8Array(new Uint16Array([258])),
    new Uint8Array(new Uint16Array([258]).buffer)
  );
});
