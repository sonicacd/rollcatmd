import test from 'node:test';
import assert from 'node:assert/strict';
import { copyImageBlob, copyText, hydrateLocalImages, inlineLocalImages, isRelativeImageSource, MAX_LOCAL_IMAGE_BYTES, persistDocumentImage, readDocumentImageBlob } from '../src/local-images.js';

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

test('export reads in-memory attachments without a document path or native calls and deduplicates sources', async () => {
  const originals = [image('assets/a.png'), image('assets/a.png')];
  const sources = [];
  const revoked = [];
  const result = await inlineLocalImages({ querySelectorAll: () => originals }, {
    readImage: async (source) => { sources.push(source); return pngBlob; },
    invoke: () => { throw new Error('native calls must not run'); },
    createObjectURL: (blob) => { assert.equal(blob, pngBlob); return 'blob:memory'; },
    revokeObjectURL: (url) => revoked.push(url)
  });
  assert.deepEqual(sources, ['assets/a.png']);
  assert.equal(result.includedImages, 2);
  assert.equal(originals[1].getAttribute('src'), 'blob:memory');
  result.release();
  assert.deepEqual(revoked, ['blob:memory']);
});

test('in-memory export reports invalid and missing image blobs', async () => {
  const originals = [image('assets/missing.png'), image('assets/invalid.png')];
  const result = await inlineLocalImages({ querySelectorAll: () => originals }, {
    readImage: async (source) => { if (source.includes('missing')) throw new Error('附件不存在'); return new Blob(['<svg/>'], { type: 'image/svg+xml' }); },
    replaceFailed: false,
    createObjectURL: () => assert.fail('invalid images must not create URLs')
  });
  assert.equal(result.failedImages, 2);
  assert.match(result.failures[0].reason, /附件不存在/);
  assert.match(result.failures[1].reason, /格式无效/);
});

test('in-memory export cancellation releases earlier URLs and does not mark an aborted image as failed', async () => {
  const originals = [image('assets/a.png'), image('assets/b.png')];
  const revoked = [];
  await assert.rejects(inlineLocalImages({ querySelectorAll: () => originals }, {
    readImage: async (source) => { if (source.includes('/b.')) throw new DOMException('cancelled', 'AbortError'); return pngBlob; },
    createObjectURL: () => 'blob:first', revokeObjectURL: (url) => revoked.push(url)
  }), { name: 'AbortError' });
  assert.deepEqual(revoked, ['blob:first']);
  assert.equal(originals[1].getAttribute('data-local-image-error'), null);
});

test('live in-memory hydration releases URLs on external abort', async () => {
  const originals = [image('assets/a.png'), image('assets/a.png')];
  const controller = new AbortController();
  const revoked = [];
  let reads = 0;
  const dispose = hydrateLocalImages({ querySelectorAll: () => originals }, {
    signal: controller.signal, readImage: async () => { reads++; return pngBlob; },
    createObjectURL: () => 'blob:memory', revokeObjectURL: (url) => revoked.push(url)
  });
  await dispose.ready;
  assert.equal(reads, 1);
  assert.equal(originals[1].getAttribute('src'), 'blob:memory');
  controller.abort(); dispose();
  assert.deepEqual(revoked, ['blob:memory']);
});

test('disposing live hydration during an in-memory read prevents late mutation and URL creation', async () => {
  const original = image('assets/a.png');
  let finish;
  const dispose = hydrateLocalImages({ querySelectorAll: () => [original] }, {
    readImage: () => new Promise((resolve) => { finish = resolve; }),
    createObjectURL: () => assert.fail('cancelled reads must not create URLs'),
    onError: () => assert.fail('cancelled reads must not report errors')
  });
  dispose(); finish(pngBlob);
  await dispose.ready;
  assert.equal(original.getAttribute('src'), 'assets/a.png');
});

test('standalone document image reads enforce paths, response format, and cancellation', async () => {
  const calls = [];
  const invoke = async (command, args) => { calls.push({ command, args }); return imageResponse; };
  const options = { documentPath: 'C:\\notes\\doc.md', invoke };
  const blob = await readDocumentImageBlob('assets/a.png', options);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array(await pngBlob.arrayBuffer()));
  assert.deepEqual(calls, [{ command: 'read_local_image', args: { documentPath: options.documentPath, source: 'assets/a.png' } }]);
  await assert.rejects(readDocumentImageBlob('assets/a.png', { invoke }), /先打开或保存/);
  await assert.rejects(readDocumentImageBlob('../outside.png', options), /相对路径/);
  const controller = new AbortController();
  await assert.rejects(readDocumentImageBlob('assets/a.png', { ...options, signal: controller.signal, invoke: async () => { controller.abort(); return imageResponse; } }), { name: 'AbortError' });
  await assert.rejects(readDocumentImageBlob('assets/a.png', { ...options, invoke: async () => ({ mime: 'image/svg+xml', base64: 'PHN2Zy8+' }) }), /格式无效/);
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
