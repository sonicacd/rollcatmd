import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');

test('regular documents use the Obsidian-derived reading rhythm at every view', () => {
  assert.match(styles, /--document-font-size:\s*16px;/);
  assert.match(styles, /--document-line-height:\s*1\.5;/);
  assert.match(styles, /--document-paragraph-spacing:\s*1rem;/);
  assert.match(styles, /--document-heading-spacing:\s*2\.5rem;/);

  assert.match(
    styles,
    /:is\(\.toastui-editor-ww-container, \.toastui-editor-md-preview, \.reader-panel\) \.toastui-editor-contents\s*\{[^}]*font-size:\s*var\(--document-font-size\);[^}]*line-height:\s*var\(--document-line-height\);/s
  );
  assert.match(
    styles,
    /:is\(\.toastui-editor-ww-container, \.toastui-editor-md-preview, \.reader-panel\) \.toastui-editor-contents p\s*\{[^}]*margin-block-start:\s*var\(--document-paragraph-spacing\);[^}]*margin-block-end:\s*var\(--document-paragraph-spacing\);/s
  );
  assert.match(
    styles,
    /:is\(\.toastui-editor-ww-container, \.toastui-editor-md-preview, \.reader-panel\) \.toastui-editor-contents :not\(table\)\s*\{[^}]*line-height:\s*inherit;/s
  );
  assert.match(styles, /blockquote:not\(\.obsidian-callout\)/);
  assert.doesNotMatch(styles, /line-height:\s*1\.78;/);
});

test('document width is fluid and capped at 1200 pixels', () => {
  assert.match(styles, /--document-max-width:\s*1200px;/);
  assert.match(
    styles,
    /--document-layout-max-width:\s*calc\(var\(--document-max-width\) \+ 72px\);/
  );
  assert.match(
    styles,
    /\.toastui-editor-ww-container \.ProseMirror\s*\{[^}]*width:\s*min\(100%, var\(--document-layout-max-width\)\);[^}]*max-width:\s*var\(--document-layout-max-width\);[^}]*margin:\s*0 auto;[^}]*padding:\s*32px 36px/s
  );
  assert.match(
    styles,
    /#viewer \.toastui-editor-contents\s*\{[^}]*width:\s*min\(100%, var\(--document-max-width\)\);[^}]*max-width:\s*var\(--document-max-width\);/s
  );
  assert.match(
    styles,
    /\.toastui-editor-md-preview \.toastui-editor-contents\s*\{[^}]*width:\s*min\(100%, var\(--document-layout-max-width\)\);[^}]*max-width:\s*var\(--document-layout-max-width\);[^}]*margin:\s*0 auto;[^}]*padding:\s*32px 36px/s
  );
  assert.doesNotMatch(
    styles,
    /\.toastui-editor-ww-container \.ProseMirror\s*\{[^}]*max-width:\s*none;/s
  );
});

test('heading scale follows the Obsidian default hierarchy without decorative rules', () => {
  assert.match(
    styles,
    /\.toastui-editor-contents h1\s*\{[^}]*font-size:\s*1\.618em;[^}]*font-weight:\s*700;[^}]*line-height:\s*1\.2;[^}]*letter-spacing:\s*-0\.015em;/s
  );
  assert.match(
    styles,
    /\.toastui-editor-contents h2\s*\{[^}]*font-size:\s*1\.462em;[^}]*font-weight:\s*680;[^}]*line-height:\s*1\.2;[^}]*letter-spacing:\s*-0\.011em;/s
  );
  assert.match(styles, /\.toastui-editor-contents h3\s*\{[^}]*font-size:\s*1\.318em;/s);
  assert.match(styles, /\.toastui-editor-contents h4\s*\{[^}]*font-size:\s*1\.188em;/s);
  assert.match(styles, /\.toastui-editor-contents h5\s*\{[^}]*font-size:\s*1\.076em;/s);
  assert.match(styles, /\.toastui-editor-contents h6\s*\{[^}]*font-size:\s*1em;/s);
  assert.match(
    styles,
    /\.toastui-editor-contents :is\(h1, h2, h3, h4, h5, h6\)\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;/s
  );
});

test('viewport-rendered documents keep the same typography and readable width', () => {
  assert.match(
    rendererSource,
    /'&\.cm-large-preview \.cm-scroller':\s*\{[^}]*fontSize:\s*'16px',[^}]*lineHeight:\s*'1\.5'/s
  );
  assert.match(
    rendererSource,
    /'&\.cm-large-preview \.cm-sizer':\s*\{[^}]*maxWidth:\s*'var\(--document-layout-max-width\)'[^}]*marginLeft:\s*'auto'[^}]*marginRight:\s*'auto'/s
  );
  assert.match(
    rendererSource,
    /'&\.cm-large-preview \.cm-md-heading-1':\s*\{[^}]*fontSize:\s*'1\.618em'[^}]*fontWeight:\s*'700'/s
  );
  assert.doesNotMatch(rendererSource, /lineHeight:\s*'1\.72'/);
});
