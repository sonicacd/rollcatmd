import test from 'node:test';
import assert from 'node:assert/strict';

import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';

import { buildLargeDocumentPreviewDecorations } from '../src/large-document-preview.js';

function collectDecorations(
  doc,
  { anchor = 0, readOnly = false, visibleFrom = 0, visibleTo = doc.length } = {}
) {
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      markdown({ base: markdownLanguage, addKeymap: false }),
      EditorState.readOnly.of(readOnly)
    ]
  });
  const decorationSet = buildLargeDocumentPreviewDecorations({
    state,
    visibleRanges: [{ from: visibleFrom, to: visibleTo }]
  });
  const decorations = [];

  decorationSet.between(0, doc.length, (from, to, value) => {
    decorations.push({ from, to, className: value.spec.class || '' });
  });

  return decorations;
}

test('large-document preview styles blocks and hides Markdown marks off the active line', () => {
  const doc = 'cursor\n# Heading **bold** [label](https://example.com)\n> quote';
  const headingStart = doc.indexOf('# Heading');
  const decorations = collectDecorations(doc);

  assert.ok(
    decorations.some(({ from, className }) =>
      from === headingStart && className.includes('cm-md-heading-1')
    )
  );
  assert.ok(
    decorations.some(({ from, to }) =>
      from === headingStart && to === headingStart + 1
    )
  );
  assert.ok(
    decorations.some(({ from, className }) =>
      from === doc.indexOf('> quote') && className.includes('cm-md-blockquote')
    )
  );
  assert.ok(
    decorations.some(({ from, to }) =>
      doc.slice(from, to) === 'https://example.com'
    )
  );
});

test('large-document preview reveals Markdown syntax on the line being edited', () => {
  const doc = '# Heading **bold**';
  const decorations = collectDecorations(doc, { anchor: doc.indexOf('Heading') });

  assert.ok(decorations.some(({ className }) => className.includes('cm-md-heading-1')));
  assert.equal(decorations.some(({ from, to }) => to > from), false);
});

test('large-document reader hides Markdown syntax on every line', () => {
  const doc = '# Heading';
  const decorations = collectDecorations(doc, { readOnly: true });

  assert.ok(decorations.some(({ from, to }) => from === 0 && to === 1));
});

test('large-document preview only creates decorations for the visible range', () => {
  const doc = 'plain first line\n# Offscreen heading';
  const firstLineEnd = doc.indexOf('\n');
  const decorations = collectDecorations(doc, { visibleTo: firstLineEnd });

  assert.equal(
    decorations.some(({ className }) => className.includes('cm-md-heading')),
    false
  );
  assert.equal(decorations.some(({ from }) => from > firstLineEnd), false);
});

test('large-document preview never replaces content across a line boundary', () => {
  const doc = 'cursor\n[label][multi\nline]';
  const decorations = collectDecorations(doc);

  assert.equal(
    decorations.some(({ from, to }) => to > from && doc.slice(from, to).includes('\n')),
    false
  );
});
