import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rendererSource = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
const previewSource = readFileSync(
  new URL('../src/large-document-preview.js', import.meta.url),
  'utf8'
);

function functionSource(name, nextMarker) {
  return rendererSource.match(
    new RegExp(`function ${name}\\([^]*?(?=\\nfunction ${nextMarker}\\()`)
  )?.[0] || '';
}

test('only document opening selects viewport rendering; editing does not replace the editor', () => {
  const updateCountsSource = rendererSource.match(
    /function updateCounts\(\)\s*\{[\s\S]*?\n\}\n\nlet countUpdateTimer/
  )?.[0] || '';

  assert.doesNotMatch(updateCountsSource, /activateLargeDocument/);
  assert.doesNotMatch(rendererSource, /planLargeInsertion|interceptLargeInsertion/);

  const setDocumentSource = functionSource('setDocument', 'openDocument');
  assert.match(setDocumentSource, /shouldUseLargeDocumentMode/);
  assert.match(setDocumentSource, /if \(isLargeDocument\) \{\s*activateLargeDocument/);
});

test('large documents use Markdown-aware viewport rendering in all three views', () => {
  assert.match(rendererSource, /markdown\(\{[\s\S]*?base:\s*markdownLanguage/);
  assert.match(rendererSource, /EditorView\.lineWrapping/);
  assert.match(rendererSource, /largeDocumentPreview/);
  assert.match(rendererSource, /largeDocumentMode\.reconfigure/);
  assert.match(rendererSource, /EditorState\.readOnly\.of\(isReader\)/);
  assert.doesNotMatch(rendererSource, /disabled\s*=\s*state\.isLargeDocument/);
  assert.match(
    previewSource,
    /update\.startState\.readOnly\s*!==\s*update\.state\.readOnly/
  );
});

test('large-document token estimates update from edit deltas instead of rescanning the file', () => {
  assert.match(
    rendererSource,
    /noteDocumentChanged\(updateLargeDocumentByteSize\(update\)\)/
  );
  assert.match(rendererSource, /update\.changes\.iterChanges/);
  assert.match(rendererSource, /state\.documentByteSize \+ byteDelta/);
});
