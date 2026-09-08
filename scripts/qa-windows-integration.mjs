// Optional isolated Edge checks. Install the runner with:
// npm install --prefix work/qa --no-package-lock --no-save playwright
// Every Tauri IPC call is intercepted in this browser; no registry/settings API runs.
import assert from 'node:assert/strict';
import { chromium } from '../work/qa/node_modules/playwright/index.mjs';
import { createServer } from 'vite';

const server = await createServer({
  server: {
    host: '127.0.0.1', port: 1424, strictPort: false, hmr: false,
    watch: { ignored: ['**/src-tauri/**', '**/work/**'] }
  },
  optimizeDeps: { entries: ['index.html'] }, clearScreen: false
});
await server.listen();
const appUrl = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true })
  .catch(async (error) => { await server.close(); throw error; });
const checks = [], errors = [], alerts = [];
let activePage;

async function fixture({ nativeRuntime, platform, android = false }) {
  const context = await browser.newContext({
    viewport: { width: 860, height: 560 },
    ...(android ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36' } : {})
  });
  const page = await context.newPage();
  activePage = page;
  page.on('pageerror', (error) => errors.push(error.stack));
  page.on('dialog', async (dialog) => { alerts.push(dialog.message()); await dialog.dismiss(); });
  await page.addInitScript(({ nativeRuntime, platform }) => {
    localStorage.setItem('rollcat-md.hide-startup-help', 'true');
    Object.defineProperty(navigator, 'platform', { configurable: true, value: platform });
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform } });
    const qa = window.__windowsQa = { calls: [], unexpected: [], mode: 'success', pending: null };
    if (!nativeRuntime) return;
    let callbackId = 0;
    const callbacks = new Map();
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(callback) { const id = ++callbackId; callbacks.set(id, callback); return id; },
      unregisterCallback(id) { callbacks.delete(id); },
      async invoke(command, args) {
        qa.calls.push({ command, args });
        if (['register_windows_file_associations', 'open_windows_default_apps'].includes(command)) {
          if (qa.mode === 'failure') throw new Error('模拟系统调用失败');
          if (qa.mode === 'pending') return new Promise((resolve, reject) => { qa.pending = { resolve, reject }; });
          return;
        }
        if (command === 'plugin:event|listen') return ++callbackId;
        if (command === 'get_initial_file') return null;
        if (command === 'take_opened_urls') return [];
        if (['plugin:event|unlisten', 'plugin:window|set_title'].includes(command)) return;
        qa.unexpected.push(command);
        throw new Error(`Unexpected mocked IPC: ${command}`);
      }
    };
  }, { nativeRuntime, platform });
  await page.goto(appUrl);
  await page.locator('.toastui-editor-ww-container [contenteditable="true"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#countText').textContent !== '0 字符');
  if (await page.locator('#helpDialog').evaluate((dialog) => dialog.open)) await page.locator('#closeHelpButton').click();
  return { context, page };
}

async function openMenu(page) {
  if (await page.locator('#moreMenu').getAttribute('open') === null) await page.locator('#moreButton').click();
}

async function integrationCalls(page) {
  return page.evaluate(() => window.__windowsQa.calls
    .filter(({ command }) => ['register_windows_file_associations', 'open_windows_default_apps'].includes(command))
    .map(({ command }) => command));
}

async function verifyMock(page) {
  assert.deepEqual(await page.evaluate(() => window.__windowsQa.unexpected), []);
}

try {
  for (const environment of [
    { nativeRuntime: false, platform: 'Windows', label: 'ordinary Windows browser' },
    { nativeRuntime: true, platform: 'Android', android: true, label: 'Android native runtime' }
  ]) {
    const { page, context } = await fixture(environment);
    await openMenu(page);
    assert.equal(await page.locator('[data-windows-integration]').count(), 4);
    for (const element of await page.locator('[data-windows-integration]').all()) {
      assert.equal(await element.isHidden(), true, environment.label);
    }
    // A hidden platform action has no native listener even if a script dispatches an event.
    await page.evaluate(() => {
      document.querySelector('#registerOpenWithButton').dispatchEvent(new Event('click'));
      document.querySelector('#defaultMarkdownButton').dispatchEvent(new Event('click'));
    });
    assert.deepEqual(await integrationCalls(page), []);
    await verifyMock(page);
    checks.push(`${environment.label}: Windows heading, separator and both actions stay hidden and inactive`);
    await context.close();
  }

  {
    const { page, context } = await fixture({ nativeRuntime: true, platform: 'Windows' });
    await openMenu(page);
    for (const element of await page.locator('[data-windows-integration]').all()) assert.equal(await element.isVisible(), true);
    const menu = await page.locator('#morePanel').evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight, overflowY: getComputedStyle(panel).overflowY };
    });
    assert.equal(menu.overflowY, 'auto');
    assert.ok(menu.scrollHeight > menu.clientHeight, JSON.stringify(menu));
    assert.ok(menu.top >= 0 && menu.bottom <= 560, JSON.stringify(menu));
    for (const id of ['registerOpenWithButton', 'defaultMarkdownButton', 'helpButton']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      const target = await page.locator(`#${id}`).evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const panel = button.closest('#morePanel').getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { reachable: button.contains(hit), top: rect.top, bottom: rect.bottom, panelTop: panel.top, panelBottom: panel.bottom };
      });
      assert.ok(target.reachable && target.top >= target.panelTop && target.bottom <= target.panelBottom, `${id}: ${JSON.stringify(target)}`);
    }
    checks.push('860×560 Windows menu scrolls; both new actions and the final Help action are unobstructed and reachable');

    await page.evaluate(() => { window.__windowsQa.mode = 'pending'; });
    await page.locator('#registerOpenWithButton').click();
    await page.waitForFunction(() => window.__windowsQa.pending !== null);
    assert.equal(await page.locator('#registerOpenWithButton').isDisabled(), true);
    assert.equal(await page.locator('#defaultMarkdownButton').isDisabled(), true);
    await page.evaluate(() => {
      document.querySelector('#registerOpenWithButton').dispatchEvent(new Event('click'));
      document.querySelector('#defaultMarkdownButton').dispatchEvent(new Event('click'));
    });
    assert.deepEqual(await integrationCalls(page), ['register_windows_file_associations']);
    await page.evaluate(() => { window.__windowsQa.pending.resolve(); window.__windowsQa.pending = null; });
    await page.waitForFunction(() => document.querySelector('#statusText').textContent === '已添加到右键“打开方式”，可选择“滚猫md”打开文档。');
    assert.equal(await page.locator('#registerOpenWithButton').isDisabled(), false);
    assert.equal(await page.locator('#defaultMarkdownButton').isDisabled(), false);
    checks.push('real DOM registration uses the expected IPC, blocks duplicate/competing events, then restores both buttons');

    await page.evaluate(() => { window.__windowsQa.mode = 'failure'; });
    await openMenu(page);
    await page.locator('#defaultMarkdownButton').click();
    await page.waitForFunction(() => document.querySelector('#statusText').textContent === '打开默认应用设置失败：模拟系统调用失败');
    assert.equal(await page.locator('#registerOpenWithButton').isDisabled(), false);
    assert.equal(await page.locator('#defaultMarkdownButton').isDisabled(), false);
    await page.evaluate(() => { window.__windowsQa.mode = 'success'; });
    await openMenu(page);
    await page.locator('#defaultMarkdownButton').click();
    await page.waitForFunction(() => document.querySelector('#statusText').textContent === '已打开默认应用设置；请选择 .md → 滚猫md，并确认默认应用。');
    assert.deepEqual(await integrationCalls(page), ['register_windows_file_associations', 'open_windows_default_apps', 'open_windows_default_apps']);
    checks.push('default-settings failure permits retry; success directs the user to confirm .md in the system settings');
    await verifyMock(page);
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(alerts, []);
  console.log(JSON.stringify({ checks, errors, alerts }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ checks, errors, alerts, title: await activePage?.title().catch(() => ''), body: await activePage?.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally {
  await Promise.allSettled([browser.close(), server.close()]);
}
