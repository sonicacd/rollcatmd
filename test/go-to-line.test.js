import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { countTextLines, parseLineNumber } from '../src/go-to-line.js';

const pageHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');

test('counts logical Markdown lines including an empty final line', () => {
  assert.equal(countTextLines(''), 1);
  assert.equal(countTextLines('one'), 1);
  assert.equal(countTextLines('one\ntwo'), 2);
  assert.equal(countTextLines('one\ntwo\n'), 3);
});

test('accepts only whole line numbers inside the document', () => {
  assert.deepEqual(parseLineNumber(' 2 ', 3), {
    valid: true,
    line: 2,
    maximum: 3
  });
  assert.equal(parseLineNumber('', 3).reason, 'integer');
  assert.equal(parseLineNumber('1.5', 3).reason, 'integer');
  assert.equal(parseLineNumber('1e2', 300).reason, 'integer');
  assert.equal(parseLineNumber('0', 3).reason, 'range');
  assert.equal(parseLineNumber('4', 3).reason, 'range');
});

test('exposes an accessible jump control and line-number dialog', () => {
  assert.match(
    pageHtml,
    /id="goToLineButton"[^>]*aria-haspopup="dialog"[^>]*aria-controls="goToLineDialog"[^>]*aria-keyshortcuts="Control\+G Meta\+G"/
  );
  assert.match(
    pageHtml,
    /<dialog[\s\S]*?id="goToLineDialog"[\s\S]*?aria-labelledby="goToLineTitle"[\s\S]*?aria-describedby="goToLineSummary goToLineError"/
  );
  assert.match(
    pageHtml,
    /id="goToLineInput"[^>]*type="number"[^>]*min="1"[^>]*step="1"[^>]*inputmode="numeric"/
  );
  assert.match(pageHtml, /id="goToLineError"[^>]*role="alert"[^>]*aria-live="assertive"/);
});

test('jumps directly in large documents and uses exact source lines otherwise', () => {
  const jumpSource = rendererSource.match(
    /function jumpToLine\([^]*?(?=\nfunction submitGoToLine\()/
  )?.[0] || '';

  assert.match(jumpSource, /state\.isLargeDocument[\s\S]*?documentText\.line\(line\)\.from/);
  assert.match(jumpSource, /largeFileEditor\.dispatch\([\s\S]*?scrollIntoView:\s*true/);
  assert.match(jumpSource, /state\.mode !== 'markdown'[\s\S]*?setMode\('markdown'\)/);
  assert.match(jumpSource, /editor\.setSelection\(\[line, 1\]\)/);
});

test('registers Ctrl+G and documents it in Help', () => {
  assert.match(rendererSource, /g:\s*'go-to-line'/);
  assert.match(rendererSource, /'go-to-line':\s*openGoToLine/);
  assert.match(pageHtml, /跳转到行[\s\S]*?<kbd>Ctrl<\/kbd>\s*\+\s*<kbd>G<\/kbd>/);
});
