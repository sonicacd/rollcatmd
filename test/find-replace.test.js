import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMappedTextBlocks,
  decodeFindReplaceEscapes,
  findMatchIndex,
  findTextMatches,
  mappedTextOffsetAtPosition,
  mappedTextRange,
  offsetToMarkdownPosition,
  replaceAllText
} from '../src/find-replace.js';

test('decodes supported find and replace escape sequences', () => {
  assert.equal(decodeFindReplaceEscapes('\\n\\n'), '\n\n');
  assert.equal(decodeFindReplaceEscapes('\\r\\t\\\\'), '\r\t\\');
});

test('preserves unknown escape sequences and a trailing backslash', () => {
  assert.equal(decodeFindReplaceEscapes('\\x\\q\\'), '\\x\\q\\');
});

test('finds literal text case-insensitively without treating punctuation as regex', () => {
  assert.deepEqual(findTextMatches('A.b a.B a-b', 'a.b'), [
    { from: 0, to: 3 },
    { from: 4, to: 7 }
  ]);
});

test('finds Unicode text and supports case-sensitive searches', () => {
  assert.deepEqual(findTextMatches('滚猫md 滚猫MD', '滚猫MD'), [
    { from: 0, to: 4 },
    { from: 5, to: 9 }
  ]);
  assert.deepEqual(findTextMatches('滚猫md 滚猫MD', '滚猫MD', { caseSensitive: true }), [
    { from: 5, to: 9 }
  ]);
});

test('chooses the next or previous result and wraps at document edges', () => {
  const matches = findTextMatches('one two one', 'one');

  assert.equal(findMatchIndex(matches, 1), 1);
  assert.equal(findMatchIndex(matches, 99), 0);
  assert.equal(findMatchIndex(matches, 8, -1), 0);
  assert.equal(findMatchIndex(matches, 0, -1), 1);
});

test('replaces all matches with replacement text literally', () => {
  const text = 'cat CAT cat';
  const matches = findTextMatches(text, 'cat');

  assert.equal(replaceAllText(text, matches, '$& dog'), '$& dog $& dog $& dog');
  assert.equal(replaceAllText(text, [], 'dog'), text);
});

test('finds escaped line breaks and collapses double line breaks with replace all', () => {
  const text = 'first\n\nsecond\n\nthird';
  const matches = findTextMatches(text, '\\n\\n');

  assert.deepEqual(matches, [
    { from: 5, to: 7 },
    { from: 13, to: 15 }
  ]);
  assert.equal(replaceAllText(text, matches, '\\n'), 'first\nsecond\nthird');
});

test('maps visible rich-text characters and empty blocks back to editor positions', () => {
  const documentParent = {};
  const mapped = buildMappedTextBlocks([
    { from: 1, to: 2, parent: documentParent, segments: [{ text: 'a', from: 1 }] },
    { from: 4, to: 4, parent: documentParent, segments: [] },
    { from: 6, to: 7, parent: documentParent, segments: [{ text: 'b', from: 6 }] }
  ]);

  assert.equal(mapped.text, 'a\n\nb');
  assert.deepEqual(mappedTextRange(mapped.spans, 1, 3), [2, 6]);
  assert.equal(mappedTextOffsetAtPosition(mapped.spans, 1), 0);
  assert.equal(mappedTextOffsetAtPosition(mapped.spans, 2), 1);
  assert.equal(mappedTextOffsetAtPosition(mapped.spans, 6), 3);
});

test('marks atom text and cross-container separators as unsafe to replace', () => {
  const mapped = buildMappedTextBlocks([
    {
      from: 1,
      to: 3,
      parent: {},
      segments: [
        { text: 'a', from: 1 },
        { text: '\uFFFC', from: 2, replaceable: false }
      ]
    },
    {
      from: 7,
      to: 8,
      parent: {},
      segments: [{ text: 'b', from: 7 }]
    }
  ]);

  assert.equal(mapped.text, 'a\uFFFC\nb');
  assert.equal(mapped.spans[1].replaceable, false);
  assert.equal(mapped.spans[2].replaceable, false);
});

test('converts string offsets to Toast UI one-based Markdown positions', () => {
  const text = 'abc\n你好\n';

  assert.deepEqual(offsetToMarkdownPosition(text, 0), [1, 1]);
  assert.deepEqual(offsetToMarkdownPosition(text, 4), [2, 1]);
  assert.deepEqual(offsetToMarkdownPosition(text, 6), [2, 3]);
  assert.deepEqual(offsetToMarkdownPosition(text, text.length), [3, 1]);
});
