// Isolated Edge race checks. Install the optional runner with:
// npm install --prefix work/qa --no-package-lock --no-save playwright
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../work/qa/node_modules/playwright/index.mjs';
import { createTextPack, encodeTextPack, decodeTextPack, readTextPackImage } from '../src/textpack.js';

const png = new Uint8Array(await readFile(new URL('../src/assets/cat-md-icon.png', import.meta.url)));
const plain = '# Original\n\nBefore\n';
const emptyPack = await encodeTextPack(createTextPack(), plain);
const { createServer } = await import('vite');
const server = await createServer({ server: { host: '127.0.0.1', port: 1423, strictPort: false, hmr: false, watch: { ignored: ['**/src-tauri/**', '**/work/**'] } }, optimizeDeps: { entries: ['index.html'] }, clearScreen: false });
await server.listen();
const appUrl = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(async error => { await server.close(); throw error; });
const checks = [], errors = [], alerts = [];
let activePage;

async function fixture(name = 'original.textpack', content = emptyPack) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); activePage = page;
  page.on('pageerror', error => errors.push(error.stack));
  page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
  await page.addInitScript(({ name, bytes }) => {
    localStorage.setItem('rollcat-md.hide-startup-help', 'true');
    const files = new Map([[name, new Uint8Array(bytes)]]), handles = new Map();
    window.__qa = { files, open: name, save: name, saves: 0 };
    const handle = name => {
      if (!handles.has(name)) handles.set(name, { name, kind: 'file', async getFile() { return new File([files.get(name)], name); },
        async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
        async createWritable() { let data; return { async write(value) { data = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value); },
          async close() { files.set(name, data); window.__qa.saves++; } }; } });
      return handles.get(name);
    };
    window.showOpenFilePicker = async () => [handle(window.__qa.open)];
    window.showSaveFilePicker = async () => handle(window.__qa.save);
  }, { name, bytes: Array.from(content) });
  await page.goto(appUrl);
  await page.locator('.toastui-editor-ww-container [contenteditable="true"]').waitFor({ state: 'visible' });
  await page.evaluate(() => Promise.all([import('/src/web-paste.js'), import('/src/local-images.js')]));
  await page.locator('#openButton').click();
  await page.waitForFunction(name => document.title.includes(name), name);
  return { page, context };
}
async function menu(page, selector) {
  if (await page.locator('#moreMenu').getAttribute('open') === null) await page.locator('#moreButton').click();
  await page.locator(selector).click();
}
async function source(page) {
  await page.locator('#markdownMode').click();
  return page.locator('.toastui-editor-md-container [contenteditable="true"]').innerText();
}
async function gatePaste(page, id) {
  let arrive, release;
  const arrived = new Promise(resolve => { arrive = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  await page.route(`https://images.example.com/${id}.png`, async route => {
    arrive(); await barrier;
    try { await route.fulfill({ status: 200, body: Buffer.from(png), contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }); }
    catch { /* An aborted paste can close the request before its gate opens. */ }
  });
  await page.locator('.toastui-editor-ww-container [contenteditable="true"]').click();
  await page.keyboard.press('Control+End');
  await page.evaluate(id => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/html', `<p>PASTERACE${id}</p><img src="https://images.example.com/${id}.png" alt="race">`);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, id);
  await Promise.race([arrived, new Promise((_, reject) => setTimeout(() => reject(new Error(`image request did not start: ${id}`)), 8000))]);
  return release;
}
async function finishCancelled(page, release) {
  release();
  await page.waitForFunction(() => /已取消|文档已变化/.test(document.querySelector('#statusText').textContent), null, { timeout: 10000 });
}
async function save(page, name, saveAs = false) {
  await page.evaluate(name => { window.__qa.save = name; }, name);
  const count = await page.evaluate(() => window.__qa.saves);
  if (saveAs) await menu(page, '#saveAsButton'); else await page.locator('#saveButton').click();
  await page.waitForFunction(count => window.__qa.saves > count, count);
  return new Uint8Array(await page.evaluate(name => Array.from(window.__qa.files.get(name)), name));
}

try {
  {
    const { page, context } = await fixture();
    const release = await gatePaste(page, 'TYPING');
    await page.keyboard.insertText('KEEPTYPED');
    await finishCancelled(page, release);
    const text = await source(page);
    assert.match(text, /KEEPTYPED/); assert.doesNotMatch(text, /PASTERACETYPING|assets\//);
    const stored = await decodeTextPack(await save(page, 'original.textpack'));
    assert.match(stored.content, /KEEPTYPED/); assert.equal(Object.keys(stored.textPack.files).filter(path => path.startsWith('assets/')).length, 0);
    checks.push('typing during download cancels stale paste and preserves typed text with no orphan pack asset');
    await context.close();
  }
  {
    const { page, context } = await fixture('original.md', new TextEncoder().encode(plain));
    const release = await gatePaste(page, 'SAVEAS');
    await save(page, 'other.md', true);
    await finishCancelled(page, release);
    assert.match(await page.title(), /other\.md/); assert.doesNotMatch(await source(page), /PASTERACESAVEAS|assets\//);
    const stored = new TextDecoder().decode(await save(page, 'other.md'));
    assert.doesNotMatch(stored, /PASTERACESAVEAS|assets\//);
    checks.push('Save As during download cancels paste before committing references for the old destination');
    await context.close();
  }
  {
    const { page, context } = await fixture('original.md', new TextEncoder().encode(plain));
    await page.locator('#newButton').click();
    const release = await gatePaste(page, 'UNSAVED');
    await save(page, 'created.md');
    await finishCancelled(page, release);
    assert.match(await page.title(), /created\.md/); assert.doesNotMatch(await source(page), /PASTERACEUNSAVED|assets\//);
    const stored = await save(page, 'created.md');
    assert.notEqual(stored[0], 0x50); assert.doesNotMatch(new TextDecoder().decode(stored), /PASTERACEUNSAVED/);
    checks.push('saving an untitled MD during download prevents a late TextPack format switch and next Ctrl+S works');
    await context.close();
  }
  {
    const { page, context } = await fixture();
    const release = await gatePaste(page, 'SWITCH');
    await page.locator('#newButton').click();
    await page.locator('.toastui-editor-ww-container [contenteditable="true"]').click();
    await page.keyboard.press('Control+End'); await page.keyboard.insertText('KEEPNEWDOCUMENT');
    release();
    await page.waitForTimeout(250);
    const text = await source(page);
    assert.match(text, /KEEPNEWDOCUMENT/); assert.doesNotMatch(text, /PASTERACESWITCH|assets\//);
    assert.doesNotMatch(new TextDecoder().decode(await save(page, 'new-document.md')), /PASTERACESWITCH/);
    checks.push('switching documents aborts pending paste without changing the new document');
    await context.close();
  }
  {
    const original = '# Native conversion\n\n![inline](assets/original.png)\n\n![reference][same]\n\n[same]: assets/original.png\n\n`![example](skip.png)`\n';
    const { page, context } = await fixture('native.md', new TextEncoder().encode(original));
    await page.waitForTimeout(250);
    await page.evaluate(base64 => {
      window.__qa.nativeCalls = [];
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        async invoke(command, args) {
          window.__qa.nativeCalls.push({ command, args });
          if (command === 'read_local_image') {
            if (args.source !== 'assets/original.png') throw new Error(`unexpected local image: ${args.source}`);
            return { mime: 'image/png', base64 };
          }
          if (command === 'plugin:dialog|save') return 'C:\\notes\\converted.textpack';
          if (command === 'write_binary_file_atomic') { window.__qa.nativeOutput = args.content; return; }
          if (['remember_recent_file', 'plugin:window|set_title'].includes(command)) return;
          throw new Error(`unexpected native call: ${command}`);
        } };
    }, Buffer.from(png).toString('base64'));
    await menu(page, '#saveTextPackButton');
    await page.waitForFunction(() => window.__qa.nativeOutput && document.title.includes('converted.textpack'), null, { timeout: 10000 });
    const calls = await page.evaluate(() => window.__qa.nativeCalls);
    const nativeReads = calls.filter(call => call.command === 'read_local_image');
    assert.equal(nativeReads.length, 1); assert.equal(nativeReads[0].args.documentPath, 'native.md');
    const stored = await decodeTextPack(new Uint8Array(await page.evaluate(() => window.__qa.nativeOutput)));
    assert.match(stored.content, /!\[inline\]\(assets\/image-1.png\)/); assert.match(stored.content, /\[same\]: assets\/image-1.png/);
    assert.match(stored.content, /`!\[example\]\(skip.png\)`/);
    assert.deepEqual(new Uint8Array(await (await readTextPackImage(stored.textPack, 'assets/image-1.png')).arrayBuffer()), png);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.toastui-editor-ww-container img[data-local-image-source]')).some(image => image.naturalWidth > 0));
    const text = await source(page); assert.doesNotMatch(text, /blob:/); assert.match(text, /assets\/image-1.png/);
    checks.push('native MD→TextPack integration reads duplicate image once, keeps code literal, writes binary ZIP and renders original bytes');
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(alerts, []);
  console.log(JSON.stringify({ checks, errors, alerts }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ checks, errors, alerts, title: await activePage?.title().catch(() => ''), body: await activePage?.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally { await Promise.allSettled([browser.close(), server.close()]); }
