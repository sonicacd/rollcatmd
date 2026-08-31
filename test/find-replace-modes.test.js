import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rendererSource = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');

function functionSource(name, nextMarker) {
  return rendererSource.match(
    new RegExp(`function ${name}\\([^]*?(?=\\nfunction ${nextMarker}\\()`)
  )?.[0] || '';
}

test('opening and closing find and replace never changes the current mode', () => {
  const openSource = functionSource('openFindReplace', 'closeFindReplace');
  const closeSource = rendererSource.match(
    /function closeFindReplace\([^]*?(?=\nlet goToLineReturnFocus)/
  )?.[0] || '';

  assert.doesNotMatch(openSource, /setMode|changeMode/);
  assert.doesNotMatch(closeSource, /setMode|changeMode|returnMode/);
});

test('WYSIWYG search indexes visible ProseMirror text and preserves inline marks', () => {
  const snapshotSource = functionSource('createWysiwygFindSnapshot', 'createReaderFindSnapshot');
  const replaceSource = functionSource('replaceMappedWysiwygRange', 'commitReaderMarkdown');

  assert.match(snapshotSource, /editor\.wwEditor\?\.view\?\.state\?\.doc/);
  assert.match(snapshotSource, /node\.isTextblock/);
  assert.match(snapshotSource, /buildMappedTextBlocks/);
  assert.match(replaceSource, /doc\.nodesBetween/);
  assert.match(replaceSource, /schema\.text\(replacement, preservedMarks \|\| \[\]\)/);
  assert.match(replaceSource, /editor\.wwEditor\.replaceSelection/);
  assert.doesNotMatch(replaceSource, /editor\.replaceSelection/);
});

test('newline queries use exact Markdown offsets without leaving WYSIWYG mode', () => {
  const snapshotSource = functionSource('getFindSearchSnapshot', 'getFindCursorOffset');
  const rangeSource = functionSource('replaceFindRange', 'replaceCurrentFindMatch');

  assert.ok(
    snapshotSource.includes(String.raw`decodeFindReplaceEscapes(query).includes('\n')`)
  );
  assert.match(snapshotSource, /kind: 'wysiwyg-source'/);
  assert.doesNotMatch(snapshotSource, /setMode|changeMode/);
  assert.match(rangeSource, /editor\.setMarkdown\(nextText, false\)/);
});

test('reader search uses visible DOM text and maps only safe raw source ranges', () => {
  const snapshotSource = functionSource('createReaderFindSnapshot', 'getFindSearchSnapshot');
  const commitSource = functionSource('commitReaderMarkdown', 'replaceFindRange');
  const singleSource = functionSource('replaceCurrentFindMatch', 'replaceAllFindMatches');
  const rangeSource = functionSource('replaceFindRange', 'replaceCurrentFindMatch');
  const replaceAllSource = functionSource('replaceAllFindMatches', 'openFindReplace');

  assert.match(snapshotSource, /viewer\?\.toastMark\?\.getRootNode/);
  assert.match(snapshotSource, /createVisibleFindSnapshot/);
  assert.match(snapshotSource, /buildMarkdownAstFindSnapshot/);
  assert.match(snapshotSource, /mapVisibleFindSnapshotToSource/);
  assert.match(snapshotSource, /kind: 'reader'/);
  assert.match(snapshotSource, /kind: 'reader-readonly'/);
  assert.match(commitSource, /editor\.setMarkdown\(nextText, false\)/);
  assert.doesNotMatch(snapshotSource + commitSource, /toWysiwygModel|toMarkdownText/);
  assert.match(singleSource, /decodeFindReplaceEscapes/);
  assert.match(singleSource, /match\.from \+ replacement\.length/);
  assert.match(rangeSource, /snapshot\.kind === 'reader'[\s\S]*?mappedTextRange/);
  assert.match(rangeSource, /markdown\.slice\(0, range\[0\]\)/);
  assert.match(commitSource, /noteDocumentChanged\(\)[\s\S]*?refreshReader\(\)/);
  assert.match(replaceAllSource, /snapshot\?\.kind === 'reader'[\s\S]*?mappedTextRange/);
  assert.match(replaceAllSource, /commitReaderMarkdown\(nextText\)/);
});

test('large documents keep their shared CodeMirror document for every mode', () => {
  const snapshotSource = functionSource('getFindSearchSnapshot', 'getFindCursorOffset');
  const rangeSource = functionSource('replaceFindRange', 'replaceCurrentFindMatch');

  assert.match(snapshotSource, /state\.isLargeDocument[\s\S]*?kind: 'large'/);
  assert.match(rangeSource, /largeFileEditor\.dispatch\([\s\S]*?changes:/);
});
