import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');

test('places an accessible Help button after Save As and connects it to a dialog', () => {
  assert.match(
    pageHtml,
    /id="saveAsButton"[\s\S]*?id="helpButton"[^>]*aria-haspopup="dialog"[^>]*aria-controls="helpDialog"[^>]*>帮助<\/button>/
  );
  assert.match(
    pageHtml,
    /<dialog[\s\S]*?id="helpDialog"[\s\S]*?aria-labelledby="helpDialogTitle"[\s\S]*?aria-describedby="helpDialogSummary"/
  );
  assert.match(
    pageHtml,
    /id="closeHelpButton"[\s\S]*?aria-label="关闭帮助"[\s\S]*?aria-keyshortcuts="Escape"/
  );
});

test('Help covers file operations, current-view find and replace, escapes, and save safety', () => {
  assert.match(pageHtml, /Ctrl[\s\S]*?N[\s\S]*?Ctrl[\s\S]*?O[\s\S]*?Ctrl[\s\S]*?S/);
  assert.match(pageHtml, /\.md[\s\S]*?\.markdown[\s\S]*?\.mdown[\s\S]*?\.mkd[\s\S]*?\.txt/);
  assert.match(pageHtml, /三个模式[\s\S]*?保持当前界面[\s\S]*?阅读模式也允许替换[\s\S]*?即时刷新/);
  assert.match(pageHtml, /查找和替换[\s\S]*?Ctrl[\s\S]*?F[\s\S]*?Enter[\s\S]*?Esc/);
  assert.match(pageHtml, /<code>\\n<\/code>[\s\S]*?<code>\\r<\/code>[\s\S]*?<code>\\t<\/code>[\s\S]*?<code>\\\\<\/code>/);
  assert.match(pageHtml, /合并空行：[\s\S]*?<code>\\n\\n<\/code>[\s\S]*?<code>\\n<\/code>/);
  assert.match(pageHtml, /UTF-8[\s\S]*?BOM[\s\S]*?安全替换[\s\S]*?换行风格/);
});

test('Help uses theme-aware modal styling and a touch-friendly responsive layout', () => {
  assert.match(
    styles,
    /\.help-dialog\s*\{[\s\S]*?width:\s*min\(720px,[\s\S]*?max-height:\s*calc\(100dvh - 32px\);[\s\S]*?background:\s*var\(--surface\);[\s\S]*?color:\s*var\(--text\);/
  );
  assert.match(styles, /\.help-dialog::backdrop\s*\{[\s\S]*?background:\s*rgba\(0, 0, 0, 0\.5\);/);
  assert.match(
    styles,
    /@media \(max-width:\s*700px\)[\s\S]*?\.help-dialog-close\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;[\s\S]*?\.help-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/
  );
});

test('the seven-button toolbar fits one mobile row', () => {
  assert.match(styles, /\.toolbar\s*\{[\s\S]*?flex:\s*2 1 310px;/);
  assert.match(
    styles,
    /@media \(max-width:\s*820px\)[\s\S]*?\.toolbar\s*\{[\s\S]*?grid-template-columns:\s*repeat\(7, minmax\(40px, 58px\)\);/
  );
});

test('Help opens modally, closes with Escape, and restores focus', () => {
  assert.match(rendererSource, /helpElements\.dialog\.showModal\(\)/);
  assert.match(
    rendererSource,
    /helpElements\.dialog\.addEventListener\('keydown',[\s\S]*?event\.key === 'Escape'[\s\S]*?closeHelp\(\)/
  );
  assert.match(
    rendererSource,
    /helpElements\.dialog\.addEventListener\('close',[\s\S]*?returnFocus\.focus\(\{ preventScroll: true \}\)/
  );
});
