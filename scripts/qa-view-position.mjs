// Isolated Edge checks for preserving the reading position between all views.
// npm install --prefix work/qa --no-package-lock --no-save playwright
// Optional suites: node scripts/qa-view-position.mjs textpack sync desktop narrow large
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '../work/qa/node_modules/playwright/index.mjs';
import { createTextPack, addTextPackImage, encodeTextPack } from '../src/textpack.js';

const outputDirectory = new URL('../work/qa/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  server: { host: '127.0.0.1', port: 1428, strictPort: true, hmr: false,
    watch: { ignored: ['**/src-tauri/**', '**/work/**'] } },
  optimizeDeps: { entries: ['index.html'], force: true }, clearScreen: false
});
const checks = [], failures = [], errors = [], alerts = [];
const settleTime = 1200; // Includes the position controller's one-second cleanup.
const suites = new Set(process.argv.slice(2));
for (const suite of suites) assert.ok(['textpack', 'sync', 'desktop', 'narrow', 'large'].includes(suite), `Unknown suite: ${suite}`);
const runSuite = name => suites.size === 0 || suites.has(name);
const resultFile = `view-position-results${suites.size ? `-${[...suites].join('-')}` : ''}.json`;
const modeKeys = { wysiwyg: '1', markdown: '2', reader: '3' };
let browser, activePage, appUrl;

const imageBytes = await readFile(new URL('../src/assets/cat-md-icon.png', import.meta.url));
const packedImage = await addTextPackImage(createTextPack(), new Blob([imageBytes], { type: 'image/png' }));
const packedSections = Array.from({ length: 40 }, (_, index) => {
  const id = String(index).padStart(4, '0');
  return `## VP${id}H 图文章节\n\nVP${id}P 阅读位置段落，包含**加粗文字**和普通正文。` +
    '连续文字内容与换行测试。'.repeat(13) +
    (index % 4 === 0 ? `\n\n![第${index}张图片](${packedImage.relativePath})` : '');
}).join('\n\n');
const packedMarkdown = packedSections.padEnd(10630, '文');
assert.equal(packedMarkdown.length, 10630);
const packedDocument = Array.from(await encodeTextPack(packedImage.textPack, packedMarkdown));

const ordinary = Array.from({ length: 160 }, (_, index) => {
  const id = String(index).padStart(4, '0');
  return `## VP${id}H 标题\n\nVP${id}P 阅读位置段落，包含**加粗**与普通正文。` +
    '连续文字帮助验证换行后仍保持当前阅读段落。'.repeat(9) +
    (index % 10 === 0 ? `\n\n| 项目 | 内容 |\n| --- | --- |\n| VP${id}T | 表格中的阅读位置 |` : '');
}).join('\n\n');
const large = Array.from({ length: 7000 }, (_, index) => {
  const id = String(index).padStart(4, '0');
  return `## VP${id}H 大文档标题\n\nVP${id}P ` + '大文档按可视区分块渲染，切换视图保持正在阅读的段落。'.repeat(6);
}).join('\n\n');
assert.ok(Buffer.byteLength(large, 'utf8') >= 2.5 * 1024 * 1024);

function selectors(mode, isLarge = false) {
  if (isLarge) return { root: '#largeFileEditor .cm-content', scroll: '#largeFileEditor .cm-scroller' };
  if (mode === 'reader') return { root: '#viewer', scroll: '#readerPanel' };
  if (mode === 'preview') return { root: '.toastui-editor-md-preview .toastui-editor-contents', scroll: '.toastui-editor-md-preview' };
  const root = `.toastui-editor-${mode === 'markdown' ? 'md' : 'ww'}-container .ProseMirror`;
  return { root, scroll: root };
}

async function openFixture(content, name, viewport) {
  const context = await browser.newContext({ viewport });
  context.setDefaultTimeout(30000);
  const page = await context.newPage(); activePage = page;
  page.on('pageerror', error => errors.push(error.stack));
  page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
  await page.addInitScript(({ content, name }) => {
    localStorage.setItem('rollcat-md.hide-startup-help', 'true');
    window.showOpenFilePicker = async () => [{
      kind: 'file', name,
      async getFile() { return new File([Array.isArray(content) ? new Uint8Array(content) : content], name); },
      async queryPermission() { return 'granted'; }
    }];
  }, { content, name });
  await page.goto(appUrl);
  await page.locator('.toastui-editor-ww-container .ProseMirror').waitFor({ state: 'visible' });
  await page.locator('#openButton').click();
  await page.waitForFunction(name => document.title.includes(name), name);
  await page.waitForTimeout(settleTime);
  if (viewport.width < 600 && await page.locator('#outlineToggle').getAttribute('aria-expanded') === 'true') {
    await page.locator('#outlineCloseButton').click();
  }
  console.log(`OPEN ${name}`);
  return { context, page };
}

async function changeMode(page, mode, shortcut = false, isLarge = false) {
  if (await page.locator(`#${mode}Mode`).getAttribute('aria-pressed') === 'true') return;
  if (shortcut) await page.keyboard.press(`Control+${modeKeys[mode]}`);
  else await page.locator(`#${mode}Mode`).click();
  await page.waitForFunction(mode => document.querySelector(`#${mode}Mode`).getAttribute('aria-pressed') === 'true', mode);
  await page.locator(selectors(mode, isLarge).root).waitFor({ state: 'visible' });
  await page.waitForTimeout(settleTime);
}

async function waitForPackedImages(page) {
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.toastui-editor-ww-container .ProseMirror img[data-local-image-source]')];
    return images.length === 10 && images.every(image => image.complete && image.naturalWidth > 0);
  });
}

// Inspect rendered text only; the test never reaches into Toast UI/CodeMirror state.
async function viewportState(page, mode, isLarge = false) {
  return page.evaluate(({ root, scroll }) => {
    const content = document.querySelector(root), scroller = document.querySelector(scroll);
    const bounds = scroller.getBoundingClientRect(), markers = [];
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of node.textContent.matchAll(/VP\d{4}[HPT]/g)) {
        const range = document.createRange();
        range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        if (rect.width && rect.bottom > bounds.top && rect.top < bounds.bottom) {
          markers.push({ text: match[0], top: rect.top - bounds.top });
        }
      }
    }
    return { markers, top: scroller.scrollTop, maximum: scroller.scrollHeight - scroller.clientHeight,
      height: scroller.clientHeight, title: document.title,
      selectedText: window.getSelection()?.anchorNode?.textContent?.slice(0, 80) };
  }, selectors(mode, isLarge));
}

async function staleEndThenRead(page, mode, isLarge = false) {
  const { root, scroll } = selectors(mode, isLarge);
  await page.locator(root).evaluate(element => element.focus({ preventScroll: true }));
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(150);
  await page.locator(scroll).evaluate(element => { element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.47; });
  await page.waitForTimeout(350);
  const state = await viewportState(page, mode, isLarge);
  assert.ok(state.top > 100 && state.top < state.maximum - state.height, 'precondition: reading away from both document edges');
  assert.ok(state.markers.length, `precondition: visible fixture marker ${JSON.stringify(state)}`);
  return state.markers.reduce((best, marker) => Math.abs(marker.top - state.height * 0.3) < Math.abs(best.top - state.height * 0.3) ? marker : best).text;
}

async function expectVisible(page, mode, marker, label, isLarge = false) {
  const state = await viewportState(page, mode, isLarge);
  assert.ok(state.markers.some(item => item.text === marker), `${label}: ${marker} left the viewport: ${JSON.stringify(state)}`);
  assert.ok(!state.title.endsWith(' *'), `${label}: view switching marked the file modified`);
}

async function check(label, run) {
  try {
    await run(); checks.push(label); console.log(`PASS ${label}`);
  } catch (error) {
    failures.push({ label, message: error.message }); console.error(`FAIL ${label}: ${error.message}`);
    if (failures.length <= 3) await activePage?.screenshot({ path: fileURLToPath(new URL(`view-position-failure-${failures.length}.png`, outputDirectory)) }).catch(() => {});
  }
}

async function roundTrip(page, label, { shortcut = false, isLarge = false } = {}) {
  await changeMode(page, 'wysiwyg', false, isLarge);
  const marker = await staleEndThenRead(page, 'wysiwyg', isLarge);
  await check(`${label}: WYSIWYG → source${shortcut ? ' (Ctrl+2)' : ' (button)'}`, async () => {
    await changeMode(page, 'markdown', shortcut, isLarge);
    await expectVisible(page, 'markdown', marker, label, isLarge);
  });
  // Reset the reading position to make the reverse check independent of a forward failure.
  const sourceMarker = await staleEndThenRead(page, 'markdown', isLarge);
  await check(`${label}: source → WYSIWYG`, async () => {
    await changeMode(page, 'wysiwyg', shortcut, isLarge);
    await expectVisible(page, 'wysiwyg', sourceMarker, label, isLarge);
  });
  const readerMarker = await staleEndThenRead(page, 'wysiwyg', isLarge);
  await check(`${label}: WYSIWYG → reader → source → reader → WYSIWYG`, async () => {
    for (const mode of ['reader', 'markdown', 'reader', 'wysiwyg']) {
      await changeMode(page, mode, false, isLarge);
      await expectVisible(page, mode, readerMarker, `${label} → ${mode}`, isLarge);
    }
  });
}

async function checkEdges(page, label, isLarge = false) {
  for (const edge of ['top', 'bottom']) {
    await check(`${label}: ${edge} through all views`, async () => {
      await changeMode(page, 'wysiwyg', false, isLarge);
      await page.locator(selectors('wysiwyg', isLarge).scroll).evaluate((element, edge) => {
        element.scrollTop = edge === 'top' ? 0 : element.scrollHeight;
      }, edge);
      await page.waitForTimeout(350);
      for (const mode of ['markdown', 'reader', 'wysiwyg']) {
        await changeMode(page, mode, false, isLarge);
        const state = await viewportState(page, mode, isLarge);
        if (isLarge && edge === 'bottom') {
          // CodeMirror keeps its last visible line anchored while remeasuring
          // preview heights; the last paragraph must remain in the viewport.
          assert.ok(state.markers.some(marker => marker.text === 'VP6999P'),
            `${label} final paragraph → ${mode}: ${JSON.stringify(state)}`);
        } else {
          assert.ok(Math.abs(state.top - (edge === 'top' ? 0 : state.maximum)) <= 2,
            `${label} ${edge} → ${mode}: ${JSON.stringify(state)}`);
        }
        assert.ok(!state.title.endsWith(' *'));
      }
    });
  }
}

async function checkManualScrollSync(page, origin, delta) {
  const target = origin === 'markdown' ? 'preview' : 'markdown';
  const beforeOrigin = await viewportState(page, origin), beforeTarget = await viewportState(page, target);
  await page.locator(selectors(origin).scroll).hover();
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(settleTime);
  const afterOrigin = await viewportState(page, origin), afterTarget = await viewportState(page, target);
  assert.ok((afterOrigin.top - beforeOrigin.top) * Math.sign(delta) > 100, `${origin} must scroll in the requested direction`);
  assert.ok((afterTarget.top - beforeTarget.top) * Math.sign(delta) > 100,
    `${target} must follow ${origin}: ${JSON.stringify({ beforeTarget, afterTarget })}`);
  const originSections = afterOrigin.markers.map(marker => Number(marker.text.slice(2, 6)));
  const targetSections = afterTarget.markers.map(marker => Number(marker.text.slice(2, 6)));
  assert.ok(originSections.some(section => targetSections.some(other => Math.abs(other - section) <= 1)),
    `source and preview must show nearby sections: ${JSON.stringify({ afterOrigin, afterTarget })}`);
  assert.ok(!afterOrigin.title.endsWith(' *'));
}

try {
  await server.listen(); appUrl = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  if (runSuite('textpack')) {
    const packed = await openFixture(packedDocument, 'position-10630.textpack', { width: 1280, height: 900 });
    await waitForPackedImages(packed.page);
    await changeMode(packed.page, 'markdown');
    const initialSource = await packed.page.locator(selectors('markdown').root).innerText();
    for (const [index, shortcut] of [false, true, false, true].entries()) {
      await roundTrip(packed.page, `10630-character TextPack repeat ${index + 1}`, { shortcut });
    }
    await check('TextPack source remains identical after repeated view changes', async () => {
      await changeMode(packed.page, 'markdown');
      assert.equal(await packed.page.locator(selectors('markdown').root).innerText(), initialSource);
    });
    await packed.context.close();
  }
  if (runSuite('sync')) {
    const { page, context } = await openFixture(packedDocument, 'scroll-sync-10630.textpack', { width: 1280, height: 900 });
    await waitForPackedImages(page);
    const marker = await staleEndThenRead(page, 'wysiwyg');
    await changeMode(page, 'markdown');
    await expectVisible(page, 'markdown', marker, 'TextPack before manual scrolling');
    await check('TextPack manual source scroll resumes preview synchronization', () => checkManualScrollSync(page, 'markdown', 700));
    await check('TextPack manual preview scroll resumes source synchronization', () => checkManualScrollSync(page, 'preview', -700));
    await check('TextPack rapid repeated view changes keep the current section', async () => {
      await changeMode(page, 'wysiwyg');
      const currentMarker = await staleEndThenRead(page, 'wysiwyg');
      for (const mode of ['markdown', 'reader', 'wysiwyg', 'reader', 'markdown']) {
        await page.locator(`#${mode}Mode`).click();
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(settleTime);
      await expectVisible(page, 'markdown', currentMarker, 'TextPack rapid switches');
    });
    await context.close();
  }
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 760 }]) {
    if (!runSuite(viewport.width < 600 ? 'narrow' : 'desktop')) continue;
    const { page, context } = await openFixture(ordinary, `position-${viewport.width}.md`, viewport);
    for (const theme of ['eye', 'white', 'black']) {
      await page.locator('#themeSelect').selectOption(theme);
      await roundTrip(page, `${viewport.width}px ${theme}`, { shortcut: theme === 'white' });
    }
    await checkEdges(page, `${viewport.width}px ordinary`);
    await context.close();
  }
  if (runSuite('large')) {
    const { page, context } = await openFixture(large, 'large-position.md', { width: 1280, height: 900 });
    assert.equal(await page.locator('#largeFilePanel').getAttribute('aria-hidden'), 'false');
    await roundTrip(page, 'large document', { shortcut: true, isLarge: true });
    await checkEdges(page, 'large document', true);
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(alerts, []);
} catch (error) {
  console.error(JSON.stringify({ error: error.message, checks, failures, errors, alerts,
    images: await activePage?.locator('img').evaluateAll(images => images.map(image => ({ source: image.getAttribute('src'), loaded: image.naturalWidth > 0 }))).catch(() => []),
    title: await activePage?.title().catch(() => '') }, null, 2));
  throw error;
} finally {
  await writeFile(new URL(resultFile, outputDirectory), JSON.stringify({ checks, failures, errors, alerts }, null, 2));
  await Promise.allSettled([browser?.close(), server.close()]);
}
assert.deepEqual(failures, [], `Reading-position checks failed; see work/qa/${resultFile}`);
console.log(JSON.stringify({ checks, failures, errors, alerts }, null, 2));
