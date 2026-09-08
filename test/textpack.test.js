import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync } from 'fflate';
import {
  MAX_TEXTPACK_BYTES, MAX_TEXTPACK_ENTRIES, isTextPackFile, createTextPack,
  decodeTextPack, encodeTextPack, addTextPackImage, readTextPackImage
} from '../src/textpack.js';

const encode = (text) => new TextEncoder().encode(text);
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64'));
const info = { version: 2, type: 'net.daringfireball.markdown' };
const bundle = (extra = {}, metadata = info) => ({
  'info.json': encode(JSON.stringify(metadata)), 'text.md': encode('# Hello\n'), ...extra
});
const pack = (files = bundle(), options = { level: 6 }) => zipSync(files, options);

function records(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = view.getUint32(bytes.length - 6, true);
  const result = [];
  while (view.getUint32(position, true) === 0x02014b50) {
    const local = view.getUint32(position + 42, true);
    result.push({ central: position, local, data: local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true) });
    position += 46 + view.getUint16(position + 28, true) + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
  }
  return result;
}

function patchEntry(bytes, index, field, value) {
  const offsets = { flags: [8, 6, 2], method: [10, 8, 2], crc: [16, 14, 4], compressed: [20, 18, 4], size: [24, 22, 4] };
  const [centralField, localField, width] = offsets[field];
  const { central, local } = records(bytes)[index];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view[`setUint${width * 8}`](central + centralField, value, true);
  view[`setUint${width * 8}`](local + localField, value, true);
  return bytes;
}

test('recognizes TextPack names and Android opaque ZIP content', () => {
  assert.equal(isTextPackFile('C:\\notes\\HELLO.TEXTPACK'), true);
  assert.equal(isTextPackFile('content://documents/409', pack()), true);
  assert.equal(isTextPackFile('note.md', encode('# note')), false);
  assert.equal(isTextPackFile(null, new Uint8Array()), false);
});

test('new documents round-trip as standard ZIP with Markdown metadata', async () => {
  const original = createTextPack();
  const bytes = await encodeTextPack(original, '# 笔记\n');
  const decoded = await decodeTextPack(bytes);
  assert.equal(decoded.content, '# 笔记\n');
  assert.equal(decoded.byteSize, encode('# 笔记\n').length);
  assert.equal(original.files['text.md'].length, 0);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unzipSync(bytes)['info.json'])), {
    ...info, creatorIdentifier: 'local.light-markdown-editor'
  });
  assert.deepEqual(Object.keys(decoded.textPack.files).sort(), ['info.json', 'text.md']);
});

test('preserves original BOM, mixed line endings, metadata bytes and unused assets', async () => {
  const metadata = encode('{\n "version": 2, "type": "net.daringfireball.markdown", "org.other.app": {"version":3,"cursor":99}\n}\n');
  const content = '\uFEFF# 标题\r\n![猫](assets/猫.png)\n尾行\r';
  const original = bundle({
    'info.json': metadata, 'text.md': encode(content), 'assets/猫.png': png,
    'assets/unused.bin': new Uint8Array([255, 0, 42]), 'custom/settings.json': encode('{"x":42}')
  });
  const decoded = await decodeTextPack(pack(original));
  assert.equal(decoded.hasBom, true);
  assert.equal(decoded.originalSerializedContent, content);
  assert.equal(decoded.content, '# 标题\n![猫](assets/猫.png)\n尾行\n');
  const restored = unzipSync(await encodeTextPack(decoded.textPack, decoded.originalSerializedContent));
  for (const [path, bytes] of Object.entries(original)) assert.deepEqual(restored[path], bytes, path);
  const image = await readTextPackImage(decoded.textPack, 'assets/%E7%8C%AB.png');
  assert.equal(image.type, 'image/png');
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), png);
});

test('reads single enclosing .textbundle directories and v1 text.markdown', async () => {
  const files = {
    'My Notes.textbundle/': new Uint8Array(),
    'My Notes.textbundle/info.json': encode('{"version":1}'),
    'My Notes.textbundle/text.markdown': encode('![a](assets/photo.png)'),
    'My Notes.textbundle/assets/': new Uint8Array(),
    'My Notes.textbundle/assets/photo.png': png,
    '__MACOSX/._My Notes.textbundle': new Uint8Array([3, 2, 1])
  };
  const decoded = await decodeTextPack(pack(files));
  assert.equal(decoded.textPack.root, 'My Notes.textbundle/');
  const added = await addTextPackImage(decoded.textPack, new Blob([png]));
  assert.equal(added.relativePath, 'assets/image-1.png');
  assert.deepEqual(added.textPack.files['My Notes.textbundle/assets/image-1.png'], png);
  const restored = unzipSync(await encodeTextPack(added.textPack, decoded.content));
  for (const [path, bytes] of Object.entries(files)) assert.deepEqual(restored[path], bytes, path);
});

test('preserves structuredClone-safe immutable image snapshots and unique filenames', async () => {
  const first = createTextPack();
  const imageBytes = png.slice();
  const second = await addTextPackImage(first, imageBytes);
  const third = await addTextPackImage(second.textPack, new Blob([png], { type: 'image/svg+xml' }));
  imageBytes.fill(0);
  assert.equal(second.relativePath, 'assets/image-1.png');
  assert.equal(third.relativePath, 'assets/image-2.png');
  assert.deepEqual(Object.keys(first.files).sort(), ['info.json', 'text.md']);
  assert.equal(second.textPack.files['assets/image-2.png'], undefined);
  assert.deepEqual(second.textPack.files[second.relativePath], png);
  const revived = structuredClone(third.textPack);
  assert.equal((await readTextPackImage(revived, './assets/image-2.png?view=1')).type, 'image/png');
  const restored = await decodeTextPack(await encodeTextPack(revived, '![x](assets/image-2.png)'));
  assert.deepEqual(restored.textPack.files['assets/image-1.png'], png);
});

test('copies Node Buffer inputs instead of retaining mutable buffer slices', async () => {
  const input = Buffer.from(pack(bundle({ 'assets/existing.png': png }), { level: 0 }));
  const decoded = await decodeTextPack(input);
  input.fill(0);
  assert.deepEqual(decoded.textPack.files['assets/existing.png'], png);
  const bufferImage = Buffer.from(png);
  const added = await addTextPackImage(createTextPack(), bufferImage);
  bufferImage.fill(0);
  assert.deepEqual(added.textPack.files[added.relativePath], png);
});

test('never overwrites an asset in a decomposed Unicode bundle directory', async () => {
  const root = 'Cafe\u0301.textbundle/';
  const decoded = await decodeTextPack(pack({
    [`${root}info.json`]: encode('{"version":2}'), [`${root}text.md`]: encode(''),
    [`${root}assets/image-1.png`]: png
  }));
  const added = await addTextPackImage(decoded.textPack, png);
  assert.equal(added.relativePath, 'assets/image-2.png');
  assert.deepEqual(added.textPack.files[`${root}assets/image-1.png`], png);
});

test('sniffs raster formats and rejects SVG regardless of MIME or extension', async () => {
  const signatures = [
    [new Uint8Array([255, 216, 255, 225]), 'image/jpeg', 'jpg'],
    [encode('GIF89a000'), 'image/gif', 'gif'],
    [encode('RIFF0000WEBP0000'), 'image/webp', 'webp']
  ];
  for (const [bytes, type, extension] of signatures) {
    const added = await addTextPackImage(createTextPack(), new Blob([bytes]));
    assert.ok(added.relativePath.endsWith('.' + extension));
    assert.equal((await readTextPackImage(added.textPack, added.relativePath)).type, type);
  }
  await assert.rejects(addTextPackImage(createTextPack(), new Blob(['<svg/>'], { type: 'image/png' })), /SVG/);
  const decoded = await decodeTextPack(pack(bundle({ 'assets/evil.png': encode('<svg/>') })));
  await assert.rejects(readTextPackImage(decoded.textPack, 'assets/evil.png'), /SVG/);
  await assert.rejects(addTextPackImage(createTextPack(), { size: 32 * 1024 * 1024 + 1 }), /32 MiB/);
});

test('blocks image traversal, absolute sources and missing assets', async () => {
  const textPack = (await addTextPackImage(createTextPack(), png)).textPack;
  for (const source of ['../assets/image-1.png', 'assets/%2e%2e/info.json', '/assets/image-1.png', 'assets\\image-1.png', 'C:/assets/image-1.png', 'https://a/image.png', 'data:image/png,x', 'text.md', 'assets/%ZZ']) {
    await assert.rejects(readTextPackImage(textPack, source), undefined, source);
  }
  await assert.rejects(readTextPackImage(textPack, 'assets/missing.png'), /找不到/);
});

test('rejects absent, malformed, unsupported and ambiguously typed metadata/documents', async () => {
  const invalidFiles = [
    { 'text.md': encode('hi') }, bundle({ 'info.json': encode('{') }),
    bundle({}, { version: 3 }), bundle({}, { version: '2' }),
    bundle({}, { version: 2, type: 'com.example.fountain' }),
    bundle({}, { version: 2, transient: 'false' }),
    bundle({ 'text.markdown': encode('second') }), bundle({ 'text.fountain': encode('second') }),
    { 'info.json': encode('{"version":2}'), 'text.txt': encode('hi') },
    { 'note/info.json': encode('{"version":2}'), 'note/text.md': encode('hi') },
    bundle({ 'another.textbundle/text.md': encode('second'), 'another.textbundle/info.json': encode('{"version":2}') }),
    bundle({ 'text.md': new Uint8Array([0xff]) })
  ];
  for (const files of invalidFiles) await assert.rejects(decodeTextPack(pack(files)));
});

test('rejects unsafe archive paths, duplicate names and case collisions before extraction', async () => {
  for (const path of ['../evil', '/absolute', 'assets/../evil', 'assets\\evil', 'C:/evil', 'assets//evil', 'assets/./evil', 'assets/\u0000evil']) {
    await assert.rejects(decodeTextPack(pack(bundle({ [path]: new Uint8Array() }))), /路径/, path);
  }
  await assert.rejects(decodeTextPack(pack(bundle({ 'ASSETS/a': png, 'assets/A': png }))), /重复/);
  const duplicate = pack(bundle({ 'same1': encode('one'), 'same2': encode('two') }), { level: 0 });
  const record = records(duplicate)[3];
  duplicate.set(encode('same1'), record.local + 30);
  duplicate.set(encode('same1'), record.central + 46);
  await assert.rejects(decodeTextPack(duplicate), /重复/);
});

test('detects truncation, corruption, encrypted entries and unsupported compression', async () => {
  const valid = pack();
  for (const length of [0, 2, 21, valid.length - 1, valid.length - 22]) {
    await assert.rejects(decodeTextPack(valid.slice(0, length)), /TextPack/);
  }
  const corrupt = pack(bundle(), { level: 0 });
  corrupt[records(corrupt)[1].data] ^= 1;
  await assert.rejects(decodeTextPack(corrupt), /CRC/);
  await assert.rejects(decodeTextPack(patchEntry(pack(), 0, 'flags', 1)), /加密/);
  await assert.rejects(decodeTextPack(patchEntry(pack(), 0, 'method', 99)), /压缩方式/);
  const mismatched = pack();
  mismatched[records(mismatched)[1].local + 14] ^= 1;
  await assert.rejects(decodeTextPack(mismatched), /校验码/);
});

test('preflights expanded sizes and entry count, and checks actual inflated length', async () => {
  await assert.rejects(decodeTextPack(patchEntry(pack(), 0, 'size', MAX_TEXTPACK_BYTES + 1)), /128 MiB/);
  const sumTooLarge = pack(bundle());
  patchEntry(sumTooLarge, 0, 'size', MAX_TEXTPACK_BYTES - 1);
  patchEntry(sumTooLarge, 1, 'size', 2);
  await assert.rejects(decodeTextPack(sumTooLarge), /128 MiB/);
  const tooMany = pack();
  const view = new DataView(tooMany.buffer);
  view.setUint16(tooMany.length - 14, MAX_TEXTPACK_ENTRIES + 1, true);
  view.setUint16(tooMany.length - 12, MAX_TEXTPACK_ENTRIES + 1, true);
  await assert.rejects(decodeTextPack(tooMany), /4096/);
  const lying = pack(bundle({ 'assets/repeating.bin': new Uint8Array(2 * 1024 * 1024) }));
  patchEntry(lying, 2, 'size', 1);
  await assert.rejects(decodeTextPack(lying), /超过声明值/);
  const inflatedTooShort = patchEntry(pack(), 1, 'size', 1024);
  await assert.rejects(decodeTextPack(inflatedTooShort), /大小不一致/);
});

test('ZIP output preserves prototype-like filenames as ordinary entries', async () => {
  const textPack = createTextPack();
  textPack.files = { ...textPack.files, ['__proto__']: encode('opaque'), constructor: encode('also opaque') };
  const decoded = await decodeTextPack(await encodeTextPack(textPack, '# test'));
  assert.deepEqual(decoded.textPack.files.__proto__, encode('opaque'));
  assert.deepEqual(decoded.textPack.files.constructor, encode('also opaque'));
});
