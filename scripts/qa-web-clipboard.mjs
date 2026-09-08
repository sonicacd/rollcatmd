// Isolated Edge clipboard checks. Install the optional runner with:
// npm install --prefix work/qa --no-package-lock --no-save playwright
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../work/qa/node_modules/playwright/index.mjs';
import { decodeTextPack, readTextPackImage } from '../src/textpack.js';

const png = new Uint8Array(await readFile(new URL('../src/assets/cat-md-icon.png', import.meta.url)));
const { createServer } = await import('vite');
const server = await createServer({ server: { host: '127.0.0.1', port: 1422, strictPort: false, hmr: false, watch: { ignored: ['**/src-tauri/**', '**/work/**'] } }, optimizeDeps: { entries: ['index.html'] }, clearScreen: false });
await server.listen();
const appUrl = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(async error => { await server.close(); throw error; });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appUrl });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://clipboard-fixture.example.test' });
await context.route('https://images.example.com/copied-real.png', route => route.fulfill({
  status: 200, contentType: 'image/png', body: Buffer.from(png), headers: { 'access-control-allow-origin': '*' }
}));
await context.route('https://clipboard-fixture.example.test/', route => route.fulfill({
  status: 200, contentType: 'text/html', body: '<!doctype html><html><head><meta charset="UTF-8"><title>Clipboard fixture</title></head><body><article><h2>真实剪贴板标题</h2><p>REALCLIPBEFORE <strong>加粗段落</strong></p><img src="https://images.example.com/copied-real.png" alt="实际复制的图片" width="80"><p>REALCLIPAFTER</p></article></body></html>'
}));
const app = await context.newPage();
const errors = [], alerts = [], checks = [];
app.on('pageerror', error => errors.push(error.stack));
app.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
await app.addInitScript(() => {
  localStorage.setItem('rollcat-md.hide-startup-help', 'true');
  const files = new Map();
  window.__qa = { files, saves: 0, pastedTypes: [] };
  const handle = { name: 'clipboard-real.textpack', kind: 'file',
    async getFile() { return new File([files.get(this.name)], this.name); },
    async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
    async createWritable() { let bytes; return { async write(value) { bytes = new Uint8Array(value); },
      async close() { files.set('clipboard-real.textpack', bytes); window.__qa.saves++; } }; } };
  window.showSaveFilePicker = async () => handle;
  window.showOpenFilePicker = async () => [handle];
  document.addEventListener('paste', event => { window.__qa.pastedTypes = Array.from(event.clipboardData?.types || []); }, true);
});
try {
  await app.goto(appUrl);
  await app.locator('.toastui-editor-ww-container [contenteditable="true"]').waitFor({ state: 'visible' });
  await app.evaluate(() => Promise.all([import('/src/web-paste.js'), import('/src/local-images.js')]));
  await app.locator('#moreButton').click(); await app.locator('#newTextPackButton').click();
  const source = await context.newPage();
  await source.goto('https://clipboard-fixture.example.test/');
  await source.waitForFunction(() => document.querySelector('img').naturalWidth > 0);
  await source.evaluate(() => {
    const selection = window.getSelection(), range = document.createRange();
    range.selectNodeContents(document.querySelector('article'));
    selection.removeAllRanges(); selection.addRange(range);
  });
  await source.keyboard.press('Control+C');
  checks.push('selected a real webpage range and copied it with Control+C');
  await app.bringToFront();
  await app.locator('.toastui-editor-ww-container [contenteditable="true"]').click();
  await app.keyboard.press('Control+End'); await app.keyboard.press('Control+V');
  await app.waitForFunction(() => document.querySelector('.toastui-editor-ww-container').textContent.includes('REALCLIPAFTER'), null, { timeout: 15000 });
  const clipboardTypes = await app.evaluate(() => window.__qa.pastedTypes);
  assert.ok(clipboardTypes.includes('text/html'), `native clipboard types: ${clipboardTypes.join(',')}`);
  await app.waitForFunction(() => Array.from(document.querySelectorAll('.toastui-editor-ww-container img[data-local-image-source]')).some(image => image.naturalWidth > 0), null, { timeout: 10000 });
  await app.locator('#markdownMode').click();
  const markdown = await app.locator('.toastui-editor-md-container [contenteditable="true"]').innerText();
  assert.match(markdown, /真实剪贴板标题/); assert.match(markdown, /\*\*加粗段落\*\*/);
  assert.match(markdown, /assets\/image-1.png/); assert.doesNotMatch(markdown, /blob:|data:image/);
  assert.ok(markdown.indexOf('REALCLIPBEFORE') < markdown.indexOf('assets/image-1.png'));
  assert.ok(markdown.indexOf('assets/image-1.png') < markdown.indexOf('REALCLIPAFTER'));
  checks.push('Control+V delivers actual text/html clipboard data; text order, bold formatting and embedded image survive');
  await app.locator('#saveButton').click(); await app.waitForFunction(() => window.__qa.saves === 1);
  const bytes = new Uint8Array(await app.evaluate(() => Array.from(window.__qa.files.get('clipboard-real.textpack'))));
  const saved = await decodeTextPack(bytes);
  assert.deepEqual(new Uint8Array(await (await readTextPackImage(saved.textPack, 'assets/image-1.png')).arrayBuffer()), png);
  assert.match(saved.content, /REALCLIPAFTER/);
  await app.locator('#openButton').click(); await app.waitForFunction(() => document.title.includes('clipboard-real.textpack'));
  await app.waitForFunction(() => Array.from(document.querySelectorAll('.toastui-editor-ww-container img[data-local-image-source]')).some(image => image.naturalWidth > 0));
  assert.match(await app.locator('.toastui-editor-ww-container [contenteditable="true"]').innerText(), /REALCLIPAFTER/);
  checks.push('saved TextPack has exact original PNG bytes and reopens with text and image');
  assert.deepEqual(errors, []); assert.deepEqual(alerts, []);
  console.log(JSON.stringify({ checks, clipboardTypes, errors, alerts }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ checks, errors, alerts, clipboardTypes: await app.evaluate(() => window.__qa.pastedTypes), body: await app.locator('body').innerText() }, null, 2));
  throw error;
} finally { await Promise.allSettled([browser.close(), server.close()]); }
