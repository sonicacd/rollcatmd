import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeUtf8Document,
  markdownPositionToOffset,
  projectedUtf8ByteLength,
  serializeTextDocument,
  utf8ByteLength,
  utf8ByteLengthInChunks
} from '../src/text-format.js';
import { LARGE_DOCUMENT_THRESHOLD_BYTES } from '../src/document-size.js';

test('measures UTF-8 without allocating an encoded copy', () => {
  assert.equal(utf8ByteLength('hello'), 5);
  assert.equal(utf8ByteLength('你好'), 6);
  assert.equal(utf8ByteLength('A😀B'), 6);
});

test('measures UTF-8 when a surrogate pair crosses a virtual-document chunk', () => {
  assert.equal(utf8ByteLengthInChunks(['A\ud83d', '\ude00B']), 6);
  assert.equal(utf8ByteLengthInChunks(['\ud83d', '', '\ude00']), 4);
  assert.equal(utf8ByteLengthInChunks(['\ud83d']), 3);
});

test('decodes UTF-8 strictly and preserves BOM/CRLF metadata', () => {
  const bytes = new Uint8Array([
    0xef, 0xbb, 0xbf,
    ...new TextEncoder().encode('第一行\r\nsecond\r\n')
  ]);
  const decoded = decodeUtf8Document(bytes);

  assert.deepEqual(decoded, {
    content: '第一行\nsecond\n',
    lineEnding: '\r\n',
    hasBom: true,
    originalSerializedContent: '\uFEFF第一行\r\nsecond\r\n'
  });
  assert.equal(serializeTextDocument(decoded.content, decoded), '\uFEFF第一行\r\nsecond\r\n');
});

test('retains the original serialized form for unchanged mixed line endings', () => {
  const original = '\uFEFFalpha\r\nbeta\ngamma\rdelta';
  const decoded = decodeUtf8Document(new TextEncoder().encode(original));

  assert.equal(decoded.content, 'alpha\nbeta\ngamma\ndelta');
  assert.equal(decoded.originalSerializedContent, original);
});

test('can release the original serialized copy for large documents', () => {
  const decoded = decodeUtf8Document(
    new TextEncoder().encode('\uFEFFone\r\ntwo'),
    { preserveOriginal: false }
  );

  assert.equal(decoded.content, 'one\ntwo');
  assert.equal(decoded.originalSerializedContent, null);
});

test('preserves a second U+FEFF that is part of the document content', () => {
  const original = '\uFEFF\uFEFFheading';
  const decoded = decodeUtf8Document(new TextEncoder().encode(original));

  assert.equal(decoded.hasBom, true);
  assert.equal(decoded.content, '\uFEFFheading');
  assert.equal(decoded.originalSerializedContent, original);
});

test('rejects non-UTF-8 bytes instead of replacing data', () => {
  assert.throws(
    () => decodeUtf8Document(new Uint8Array([0x81, 0x40])),
    /不是有效的 UTF-8/
  );
});

test('converts Toast UI one-based Markdown positions to offsets', () => {
  const markdown = 'abc\ndef\n';

  assert.equal(markdownPositionToOffset(markdown, [1, 1]), 0);
  assert.equal(markdownPositionToOffset(markdown, [1, 4]), 3);
  assert.equal(markdownPositionToOffset(markdown, [2, 2]), 5);
  assert.equal(markdownPositionToOffset(markdown, [99, 1]), markdown.length);
});

test('projects insertion bytes with UTF-8 and selection replacement', () => {
  assert.equal(projectedUtf8ByteLength('abc', 1, 2, '你好'), 8);
  assert.equal(projectedUtf8ByteLength('abc', 3, 3, '😀'), 7);
  assert.equal(projectedUtf8ByteLength('abc', 99, -10, ''), 0);
});

test('projects the exact large-document boundary without off-by-one errors', () => {
  const belowThreshold = 'x'.repeat(LARGE_DOCUMENT_THRESHOLD_BYTES - 1);

  assert.equal(
    projectedUtf8ByteLength(belowThreshold, belowThreshold.length, belowThreshold.length, ''),
    LARGE_DOCUMENT_THRESHOLD_BYTES - 1
  );
  assert.equal(
    projectedUtf8ByteLength(belowThreshold, belowThreshold.length, belowThreshold.length, 'x'),
    LARGE_DOCUMENT_THRESHOLD_BYTES
  );
});
