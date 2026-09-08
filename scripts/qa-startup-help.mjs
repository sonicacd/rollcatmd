// Isolated Edge startup-help checks. Install the optional runner with:
// npm install --prefix work/qa --no-package-lock --no-save playwright
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../work/qa/node_modules/playwright/index.mjs';

const KEY = 'rollcat-md.hide-startup-help';
const outputDirectory = new URL('../work/qa/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  server: { host: '127.0.0.1', port: 1424, strictPort: false, hmr: false,
    watch: { ignored: ['**/src-tauri/**', '**/work/**'] } },
  optimizeDeps: { entries: ['index.html'] }, clearScreen: false
});
let browser, activePage;
const checks = [], errors = [], alerts = [], layouts = [];

function track(page) {
  activePage = page;
  page.on('pageerror', error => errors.push(error.stack));
  page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
}
async function helpOpen(page) {
  await page.locator('#helpDialog[open]').waitFor({ state: 'visible' });
}
async function helpClosed(page) {
  await page.locator('#helpDialog').waitFor({ state: 'hidden' });
}
async function manualOpen(page) {
  if (await page.locator('#moreMenu').getAttribute('open') === null) await page.locator('#moreButton').click();
  await page.locator('#helpButton').click();
  await helpOpen(page);
}
async function assertRemembered(page, value) {
  await page.waitForFunction(({ key, value }) => localStorage.getItem(key) === value, { key: KEY, value });
}
async function assertLayout(page, width, height) {
  await page.setViewportSize({ width, height });
  const content = page.locator('.help-dialog-content');
  await content.evaluate(element => { element.scrollTop = 0; });
  const geometry = await page.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector), bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom,
        width: bounds.width, height: bounds.height, reachable: element === hit || element.contains(hit) };
    };
    const content = document.querySelector('.help-dialog-content');
    return { dialog: rect('#helpDialog'), checkbox: rect('#hideStartupHelp'), close: rect('#helpDoneButton'),
      footer: rect('.help-dialog-actions'), scrollHeight: content.scrollHeight, clientHeight: content.clientHeight,
      scrollWidth: content.scrollWidth, clientWidth: content.clientWidth };
  });
  for (const [name, rect] of Object.entries(geometry).filter(([, value]) => typeof value === 'object')) {
    assert.ok(rect.left >= -1 && rect.top >= -1 && rect.right <= width + 1 && rect.bottom <= height + 1,
      `${name} outside ${width}x${height}: ${JSON.stringify(rect)}`);
    assert.ok(rect.width > 0 && rect.height > 0, `${name} has no size`);
  }
  assert.ok(geometry.checkbox.reachable && geometry.close.reachable, 'footer controls must receive clicks');
  assert.ok(geometry.scrollHeight > geometry.clientHeight, 'help content should scroll in a small window');
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, 'help content must fit horizontally');
  await content.hover(); await page.mouse.wheel(0, 1600);
  await page.waitForFunction(() => document.querySelector('.help-dialog-content').scrollTop > 0);
  const footerAfter = await page.locator('.help-dialog-actions').boundingBox();
  assert.ok(Math.abs(footerAfter.y - geometry.footer.top) <= 1, 'footer should remain visible while content scrolls');
  layouts.push({ viewport: `${width}x${height}`, contentHeight: geometry.clientHeight, contentScrollHeight: geometry.scrollHeight,
    footerBottom: geometry.footer.bottom, checkboxReachable: geometry.checkbox.reachable, closeReachable: geometry.close.reachable });
  checks.push(`${width}x${height}: help content scrolls with visible, reachable footer controls and no horizontal overflow`);
}

try {
  await server.listen();
  const appUrl = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); track(page);
  await page.goto(appUrl); await helpOpen(page);
  assert.equal(await page.locator('#hideStartupHelp').isChecked(), false);
  const firstSection = page.locator('#helpDialog .help-section').first();
  assert.match(await firstSection.innerText(), /添加到右键打开方式/);
  assert.match(await firstSection.innerText(), /设为默认 \.md 程序/);
  assert.equal(await firstSection.locator('h3').getAttribute('id'), 'helpWindowsTitle');
  await page.screenshot({ path: fileURLToPath(new URL('startup-help.png', outputDirectory)), fullPage: true });
  checks.push('first launch displays Help automatically with the Windows actions first; desktop screenshot saved');

  await page.locator('#helpDoneButton').click(); await helpClosed(page); await assertRemembered(page, 'false');
  await page.reload(); await helpOpen(page);
  checks.push('closing unchecked Help keeps automatic display on the next launch');

  await page.locator('#hideStartupHelp').check();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), 'false');
  checks.push('checking the option alone leaves localStorage unchanged until Help closes');
  await page.locator('#helpDoneButton').click();
  await helpClosed(page); await assertRemembered(page, 'true');
  await page.reload(); await page.locator('.toastui-editor-ww-container [contenteditable="true"]').waitFor({ state: 'visible' });
  await helpClosed(page);
  checks.push('checking the preference and closing with the footer button persists opt-out across reload');

  await manualOpen(page); assert.equal(await page.locator('#hideStartupHelp').isChecked(), true);
  checks.push('More → Help reopens the dialog with the remembered checkbox checked');

  await page.locator('#hideStartupHelp').uncheck(); await page.keyboard.press('Escape');
  await helpClosed(page); await assertRemembered(page, 'false'); await page.reload(); await helpOpen(page);
  checks.push('unchecking and closing with Escape re-enables automatic Help on reload');

  await page.locator('#hideStartupHelp').check(); await page.locator('#closeHelpButton').click();
  await helpClosed(page); await assertRemembered(page, 'true'); await page.reload(); await helpClosed(page);
  await manualOpen(page); assert.equal(await page.locator('#hideStartupHelp').isChecked(), true);
  checks.push('the X close button also saves the opt-out preference');

  await assertLayout(page, 860, 560);
  await assertLayout(page, 390, 640);
  await context.close();

  const failingContext = await browser.newContext({ viewport: { width: 860, height: 560 } });
  await failingContext.addInitScript(key => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    window.__qaStorageFaults = { reads: 0, writes: 0 };
    Storage.prototype.getItem = function (name) {
      if (name === key) { window.__qaStorageFaults.reads++; throw new DOMException('injected storage read failure', 'SecurityError'); }
      return get.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) { window.__qaStorageFaults.writes++; throw new DOMException('injected storage write failure', 'QuotaExceededError'); }
      return set.call(this, name, value);
    };
  }, KEY);
  const failingPage = await failingContext.newPage(); track(failingPage);
  await failingPage.goto(appUrl); await helpOpen(failingPage);
  await failingPage.locator('#hideStartupHelp').check(); await failingPage.locator('#helpDoneButton').click();
  await helpClosed(failingPage);
  await failingPage.waitForFunction(() => /无法记住/.test(document.querySelector('#statusText').textContent));
  const faults = await failingPage.evaluate(() => window.__qaStorageFaults);
  assert.ok(faults.reads > 0 && faults.writes > 0, 'both targeted storage operations must have failed');
  await failingPage.reload(); await helpOpen(failingPage);
  checks.push('targeted localStorage read/write failures allow closing, report the failed preference save and retain startup Help');
  await failingContext.close();

  assert.deepEqual(errors, []); assert.deepEqual(alerts, []);
  console.log(JSON.stringify({ checks, layouts, errors, alerts, screenshot: 'work/qa/startup-help.png' }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ checks, layouts, errors, alerts,
    body: await activePage?.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally { await Promise.allSettled([browser?.close(), server.close()]); }
