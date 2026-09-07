import test from 'node:test';
import assert from 'node:assert/strict';
import { copyImageBlob, copyText, hydrateLocalImages, inlineLocalImages, isRelativeImageSource, MAX_LOCAL_IMAGE_BYTES, persistDocumentImage } from '../src/local-images.js';

function image(source) {
  const attributes = new Map([['src', source]]);
  return {
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name)
  };
}
const pngBlob = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
const imageResponse = { base64: 'iVBORw0KGgo=', mime: 'image/png' };

test('relative images allow nested encoded names and refuse traversal, URLs, absolute paths and invalid encoding', () => {
  for (const value of ['assets/a.png', './assets/hello%20world.jpg', '插图/图一.png', 'assets\\图二.webp']) assert.equal(isRelativeImageSource(value), true, value);
  for (const value of ['', '../a.png', 'assets/../a.png', '%2e%2e/a.png', '/a.png', '\\a.png', 'C:\\a.png', 'https://a/b.png', 'data:image/png;base64,abc', 'file:///a.png', 'assets/%00.png', 'assets/%x.png']) assert.equal(isRelativeImageSource(value), false, value);
});

test('export resolves original relative attributes once per reference and releases all URLs', async () => {
  const first = image('assets/a.png');
  first.src = 'http://tauri.localhost/assets/a.png';
  const second = image('assets/a.png');
  const remote = image('https://example.com/image.png');
  let calls = 0;
  const revoked = [];
  const result = await inlineLocalImages({ querySelectorAll: () => [first, second, remote] }, {
    documentPath: 'C:\\notes\\doc.md',
    invoke: async (command, args) => { calls++; assert.equal(command, 'read_local_image'); assert.equal(args.source, 'assets/a.png'); return imageResponse; },
    createObjectURL: () => 'blob:local-1', revokeObjectURL: (url) => revoked.push(url)
  });
  assert.equal(calls, 1);
  assert.equal(result.includedImages, 2);
  assert.equal(first.getAttribute('src'), 'blob:local-1');
  assert.equal(first.getAttribute('data-local-image-source'), 'assets/a.png');
  assert.equal(remote.getAttribute('src'), 'https://example.com/image.png');
  result.release(); result.release();
  assert.deepEqual(revoked, ['blob:local-1']);
});

test('unavailable local images are reported and expose a readable diagnostic', async () => {
  const missing = image('assets/missing.png');
  const result = await inlineLocalImages({ querySelectorAll: () => [missing] }, {
    documentPath: 'C:\\doc.md', invoke: async () => { throw new Error('文件已移动'); }, replaceFailed: false
  });
  assert.equal(result.failedImages, 1);
  assert.match(missing.getAttribute('title'), /文件已移动/);
  assert.match(result.failures[0].reason, /文件已移动/);
});

test('aborted native reads do not mutate images or retain a URL', async () => {
  const controller = new AbortController();
  const original = image('assets/a.png');
  let created = false;
  await assert.rejects(inlineLocalImages({ querySelectorAll: () => [original] }, {
    documentPath: 'C:\\doc.md', signal: controller.signal,
    invoke: async () => { controller.abort(); return imageResponse; },
    createObjectURL: () => { created = true; return 'blob:bad'; }
  }), { name: 'AbortError' });
  assert.equal(created, false);
  assert.equal(original.getAttribute('src'), 'assets/a.png');
});

test('live hydration exposes readiness and revokes URLs on disposal', async () => {
  const original = image('assets/a.png');
  const revoked = [];
  const dispose = hydrateLocalImages({ querySelectorAll: () => [original] }, {
    documentPath: 'C:\\doc.md', invoke: async () => imageResponse,
    createObjectURL: () => 'blob:view', revokeObjectURL: (url) => revoked.push(url)
  });
  await dispose.ready;
  assert.equal(original.getAttribute('src'), 'blob:view');
  dispose();
  assert.deepEqual(revoked, ['blob:view']);
});

test('attachment persistence requires a saved document and valid bounded raster bytes', async () => {
  const calls = [];
  const invoke = async (command, args) => { calls.push({ command, args }); return { relativePath: 'assets/image-unique.png' }; };
  assert.equal(await persistDocumentImage(pngBlob, { documentPath: 'C:\\doc.md', invoke }), 'assets/image-unique.png');
  assert.equal(calls[0].command, 'write_document_image');
  assert.deepEqual(calls[0].args.bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
  await assert.rejects(persistDocumentImage(pngBlob, { invoke }), /先保存/);
  await assert.rejects(persistDocumentImage(new Blob(['<svg/>'], { type: 'image/svg+xml' }), { documentPath: 'C:\\doc.md', invoke }), /SVG/);
  await assert.rejects(persistDocumentImage({ type: 'image/png', size: MAX_LOCAL_IMAGE_BYTES + 1 }, { documentPath: 'C:\\doc.md', invoke }), /32 MiB/);
  assert.equal(calls.length, 1);
});

test('native clipboard routes text and PNG to purpose-specific commands', async () => {
  const calls = [];
  const invoke = async (command, args) => calls.push({ command, args });
  await copyImageBlob(pngBlob, { invoke });
  await copyText('const answer = 42;', { invoke });
  assert.equal(calls[0].command, 'copy_image_clipboard');
  assert.equal(calls[1].command, 'copy_text_clipboard');
  assert.equal(calls[1].args.text, 'const answer = 42;');
});
