import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROXIMATE_UTF8_BYTES_PER_LLM_TOKEN,
  LARGE_DOCUMENT_THRESHOLD_BYTES,
  estimateLlmTokens,
  estimateLlmTokensFromByteLength,
  estimateLlmTokensInChunks,
  shouldUseLargeDocumentMode
} from '../src/document-size.js';

test('uses 2.5 MiB as the viewport-rendering threshold', () => {
  assert.equal(LARGE_DOCUMENT_THRESHOLD_BYTES, 2_621_440);
});

test('uses the regular editor below the large-document threshold', () => {
  assert.equal(
    shouldUseLargeDocumentMode(LARGE_DOCUMENT_THRESHOLD_BYTES - 1, 10_000_000),
    false
  );
});

test('uses lightweight mode at and above the threshold', () => {
  assert.equal(shouldUseLargeDocumentMode(LARGE_DOCUMENT_THRESHOLD_BYTES, 1), true);
  assert.equal(shouldUseLargeDocumentMode(15 * 1024 * 1024, 1), true);
});

test('falls back to character count when byte size is unavailable', () => {
  assert.equal(shouldUseLargeDocumentMode(undefined, LARGE_DOCUMENT_THRESHOLD_BYTES), true);
  assert.equal(shouldUseLargeDocumentMode(undefined, 100), false);
});

test('estimates LLM tokens from UTF-8 bytes without a tokenizer dependency', () => {
  assert.equal(APPROXIMATE_UTF8_BYTES_PER_LLM_TOKEN, 4);
  assert.equal(estimateLlmTokens(''), 0);
  assert.equal(estimateLlmTokens('abcd'), 1);
  assert.equal(estimateLlmTokens('abcde'), 2);
  assert.equal(estimateLlmTokens('你好'), 2);
  assert.equal(estimateLlmTokensFromByteLength(undefined), 0);
});

test('estimates tokens across virtual-document chunks before rounding', () => {
  assert.equal(estimateLlmTokensInChunks(['a', 'b', 'c', 'd']), 1);
  assert.equal(estimateLlmTokensInChunks(['a', 'b', 'c', 'd', 'e']), 2);
  assert.equal(estimateLlmTokensInChunks(['你', '好']), 2);
  assert.equal(estimateLlmTokensInChunks(['\ud83d', '\ude00']), estimateLlmTokens('😀'));
});
