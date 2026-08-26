import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findMatchIndex,
  findTextMatches,
  offsetToMarkdownPosition,
  replaceAllText
} from '../src/find-replace.js';

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

test('converts string offsets to Toast UI one-based Markdown positions', () => {
  const text = 'abc\n你好\n';

  assert.deepEqual(offsetToMarkdownPosition(text, 0), [1, 1]);
  assert.deepEqual(offsetToMarkdownPosition(text, 4), [2, 1]);
  assert.deepEqual(offsetToMarkdownPosition(text, 6), [2, 3]);
  assert.deepEqual(offsetToMarkdownPosition(text, text.length), [3, 1]);
});
