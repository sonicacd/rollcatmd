import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const pageHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');

test('the compact toolbar omits duplicate app and file-name blocks', () => {
  assert.doesNotMatch(pageHtml, /class="app-title"/);
  assert.doesNotMatch(pageHtml, /class="file-meta"/);
  assert.doesNotMatch(pageHtml, /id="fileName"/);
});

test('visual status only shows document counts while announcements remain accessible', () => {
  const updateCountsSource = rendererSource.match(
    /function updateCounts\(\)\s*\{[\s\S]*?\n\}\n\nlet countUpdateTimer/
  )?.[0] || '';

  assert.match(
    pageHtml,
    /<span id="statusText" role="status" aria-live="polite" aria-atomic="true">/
  );
  assert.match(
    pageHtml,
    /<span\s+id="countText"\s+aria-live="off"[\s\S]*?>0 字符 \/ 约 0 tokens<\/span>/
  );
  assert.match(
    styles,
    /#statusText\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?clip-path:\s*inset\(50%\);/
  );
  assert.match(
    styles,
    /\.statusbar\s*\{[\s\S]*?flex:\s*0 1 auto;[\s\S]*?gap:\s*0;/
  );
  assert.doesNotMatch(updateCountsSource, /大文件模式|formatFileSize/);
  assert.doesNotMatch(updateCountsSource, /词/);
  assert.match(
    updateCountsSource,
    /documentText\.length\.toLocaleString\(\).*字符\s*\/\s*约.*tokenEstimate\.toLocaleString\(\).*tokens/s
  );
});
