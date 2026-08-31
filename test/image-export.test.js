import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildImagePageFileName,
  buildStreamingImagePageFileName,
  createImageExportPlan,
  DEFAULT_IMAGE_EXPORT_PAGE_HEIGHT,
  deriveMaxCanvasCssHeight,
  imageDataToUint8Array,
  iterateImageExportPages
} from '../src/image-export.js';
import { createImagePageCollector } from '../src/image-page-collector.js';

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
  assert.equal(paged.pixelWidth, 1440);
  assert.equal(DEFAULT_IMAGE_EXPORT_PAGE_HEIGHT * paged.scale, 4072);
  assert.equal(buildStreamingImagePageFileName('novel.md', 9), 'novel-0009.png');
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

test('honors cancellation while a ZIP is finishing', async () => {
  const controller = new AbortController();
  const collector = createImagePageCollector({
    fileName: 'novel.md',
    forceArchive: true,
    signal: controller.signal
  });
  await collector.add(new Blob(['png']));

  const finishing = collector.finish();
  controller.abort();

  await assert.rejects(finishing, { name: 'AbortError' });
});
