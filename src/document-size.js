import { utf8ByteLength, utf8ByteLengthInChunks } from './text-format.js';

// Files below this size keep using Toast UI's full WYSIWYG editor. Files at
// or above it open directly in the viewport-rendered CodeMirror editor so the
// large document is never handed to the full-document renderer first.
export const LARGE_DOCUMENT_THRESHOLD_BYTES = 2.5 * 1024 * 1024;
export const APPROXIMATE_UTF8_BYTES_PER_LLM_TOKEN = 4;

export function shouldUseLargeDocumentMode(byteSize, characterCount = 0) {
  if (Number.isFinite(byteSize) && byteSize >= 0) {
    return byteSize >= LARGE_DOCUMENT_THRESHOLD_BYTES;
  }

  // One UTF-16 character is at least one byte in UTF-8. This fallback is only
  // used when the file source cannot provide its byte size.
  return characterCount >= LARGE_DOCUMENT_THRESHOLD_BYTES;
}

export function estimateLlmTokensFromByteLength(byteLength) {
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    return 0;
  }

  return Math.ceil(byteLength / APPROXIMATE_UTF8_BYTES_PER_LLM_TOKEN);
}

export function estimateLlmTokensInChunks(chunks) {
  return estimateLlmTokensFromByteLength(utf8ByteLengthInChunks(chunks));
}

export function estimateLlmTokens(text) {
  return estimateLlmTokensFromByteLength(utf8ByteLength(text));
}
