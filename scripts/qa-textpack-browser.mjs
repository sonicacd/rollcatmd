// Isolated Edge integration checks. Install the optional runner with:
// npm install --prefix work/qa --no-package-lock --no-save playwright
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "../work/qa/node_modules/playwright/index.mjs";
import {
  createTextPack,
  addTextPackImage,
  encodeTextPack,
  decodeTextPack,
  readTextPackImage,
} from "../src/textpack.js";

const png = new Uint8Array(
  await readFile(new URL("../src/assets/cat-md-icon.png", import.meta.url)),
);
const added = await addTextPackImage(
  createTextPack(),
  new Blob([png], { type: "image/png" }),
);
const initial = `# TextPack 实测\n\n正文之前\n\n![红点](${added.relativePath})\n\n正文之后\n`;
const fixture = await encodeTextPack(added.textPack, initial);
await mkdir("work/qa", { recursive: true });
const { createServer } = await import("vite");
const server = await createServer({
  server: {
    host: "127.0.0.1",
    port: 1421,
    strictPort: false,
    hmr: false,
    watch: { ignored: ["**/src-tauri/**", "**/work/**"] },
  },
  optimizeDeps: { entries: ["index.html"] },
  clearScreen: false,
});
await server.listen();
const appUrl = server.resolvedUrls.local[0];
const browser = await chromium
  .launch({ channel: "msedge", headless: true })
  .catch(async (error) => {
    await server.close();
    throw error;
  });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [],
  alerts = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.stack));
page.on("dialog", async (dialog) => {
  if (dialog.type() === "beforeunload") {
    await dialog.accept();
    return;
  }
  alerts.push(dialog.message());
  await dialog.dismiss();
});
await page.route("https://images.example.com/**", (route) => {
  if (route.request().url().includes("missing"))
    return route.fulfill({
      status: 404,
      body: "missing",
      headers: { "access-control-allow-origin": "*" },
    });
  return route.fulfill({
    status: 200,
    body: Buffer.from(png),
    contentType: "image/png",
    headers: { "access-control-allow-origin": "*" },
  });
});
await page.addInitScript(
  ({ fixture }) => {
    localStorage.setItem('rollcat-md.hide-startup-help', 'true');
    const files = new Map([["sample.textpack", new Uint8Array(fixture)]]);
    window.__qa = {
      files,
      open: "sample.textpack",
      save: "sample.textpack",
      saves: 0,
      fail: false,
    };
    const handle = (name) => ({
      name,
      kind: "file",
      async getFile() {
        return new File([files.get(name)], name);
      },
      async queryPermission() {
        return "granted";
      },
      async requestPermission() {
        return "granted";
      },
      async createWritable() {
        let pending;
        return {
          async write(value) {
            if (window.__qa.fail) {
              window.__qa.fail = false;
              throw new Error("injected write failure");
            }
            pending =
              typeof value === "string"
                ? new TextEncoder().encode(value)
                : new Uint8Array(value);
          },
          async close() {
            files.set(name, pending);
            window.__qa.saves++;
          },
        };
      },
    });
    window.showOpenFilePicker = async () => [handle(window.__qa.open)];
    window.showSaveFilePicker = async (options) => {
      window.__qa.suggested = options.suggestedName;
      return handle(window.__qa.save || options.suggestedName);
    };
  },
  { fixture: Array.from(fixture) },
);
async function menu(id) {
  if (
    !(await page
      .locator("#moreMenu")
      .getAttribute("open")
      .then((x) => x !== null))
  )
    await page.locator("#moreButton").click();
  await page.locator(id).click();
}
async function waitImage() {
  await page.waitForFunction(
    () =>
      Array.from(
        document.querySelectorAll("img[data-local-image-source]"),
      ).some((img) => img.getClientRects().length && img.naturalWidth > 0),
    null,
    { timeout: 10000 },
  );
}
async function source() {
  await page.locator("#markdownMode").click();
  return page
    .locator('.toastui-editor-md-container [contenteditable="true"]')
    .innerText();
}
async function save() {
  const count = await page.evaluate(() => window.__qa.saves);
  await page.locator("#saveButton").click();
  await page.waitForFunction((n) => window.__qa.saves > n, count);
  return new Uint8Array(
    await page.evaluate(() =>
      Array.from(window.__qa.files.get(window.__qa.save)),
    ),
  );
}
async function paste(html) {
  await page
    .locator('.toastui-editor-ww-container [contenteditable="true"]')
    .click();
  await page.keyboard.press("Control+End");
  await page.evaluate((html) => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", "clipboard fallback");
    document.activeElement.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, html);
}
try {
  await page.goto(appUrl);
  await page
    .locator('.toastui-editor-ww-container [contenteditable="true"]')
    .waitFor({ state: "visible" });
  await page.locator("#openButton").click();
  await page.waitForFunction(() => document.title.includes("sample.textpack"));
  await waitImage();
  checks.push("open TextPack renders embedded raster");
  const raw = await source();
  assert.match(raw, /assets\/image-1.png/);
  assert.doesNotMatch(raw, /blob:/);
  checks.push("WYSIWYG hydration leaves source relative");
  await page
    .locator('.toastui-editor-md-container [contenteditable="true"]')
    .click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n追加保存测试");
  const saved = await decodeTextPack(await save());
  assert.match(saved.content, /追加保存测试/);
  assert.deepEqual(
    new Uint8Array(
      await (
        await readTextPackImage(saved.textPack, added.relativePath)
      ).arrayBuffer(),
    ),
    png,
  );
  checks.push("editing and save round-trip original image bytes");
  await page.locator("#readerMode").click();
  await waitImage();
  await page.locator("#wysiwygMode").click();
  await waitImage();
  checks.push("reader and WYSIWYG show embedded image");
  await page.evaluate(() => (window.__qa.save = "sample-copy.textpack"));
  await menu("#saveAsButton");
  await page.waitForFunction(() =>
    window.__qa.files.has("sample-copy.textpack"),
  );
  checks.push("Save As preserves TextPack images");
  await menu("#newTextPackButton");
  await page.evaluate(() => (window.__qa.save = "web.textpack"));
  await paste(
    '<h2>网页标题</h2><p>段落 A <strong>粗体</strong></p><img src="https://images.example.com/good.png" alt="网页图"><p>段落 B</p><img src="https://images.example.com/missing.png" alt="失败图"><ul><li>项目一</li><li>项目二</li></ul>',
  );
  await page.waitForFunction(
    () =>
      document.body.textContent.includes("网页标题") &&
      document.body.textContent.includes("图片未保存"),
    null,
    { timeout: 15000 },
  );
  await waitImage();
  const pasted = await source();
  assert.match(pasted, /网页标题/);
  assert.match(pasted, /段落 A/);
  assert.match(pasted, /段落 B/);
  assert.match(pasted, /assets\/image-/);
  assert.match(pasted, /missing.png/);
  assert.ok(pasted.indexOf("段落 A") < pasted.indexOf("assets/"));
  assert.ok(pasted.indexOf("assets/") < pasted.indexOf("段落 B"));
  assert.doesNotMatch(pasted, /blob:|data:image/);
  checks.push(
    "web paste preserves ordered text, embedded image and failed-image link",
  );
  const web = await decodeTextPack(await save());
  assert.match(web.content, /网页标题/);
  assert.equal(
    Object.keys(web.textPack.files).filter((p) => p.startsWith("assets/"))
      .length,
    1,
  );
  checks.push("pasted web content saved as self-contained pack");
  await page.evaluate(() => (window.__qa.open = "web.textpack"));
  await page.locator("#openButton").click();
  await waitImage();
  assert.match(await source(), /网页标题/);
  checks.push("pasted webpage survives reopen");
  await page.locator("#wysiwygMode").click();
  await waitImage();
  await page.screenshot({
    path: "work/qa/textpack-web-paste.png",
    fullPage: true,
  });
  const originalBytes = await page.evaluate(() =>
    Array.from(window.__qa.files.get("web.textpack")),
  );
  await source();
  await page
    .locator('.toastui-editor-md-container [contenteditable="true"]')
    .click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n失败后保留");
  await page.evaluate(() => (window.__qa.fail = true));
  await page.locator("#saveButton").click();
  await page.waitForFunction(
    () => document.querySelector("#statusText").textContent === "保存失败",
  );
  assert.deepEqual(
    await page.evaluate(() =>
      Array.from(window.__qa.files.get("web.textpack")),
    ),
    originalBytes,
  );
  assert.match(await page.title(), /\*/);
  await save();
  checks.push(
    "failed save leaves original bytes and dirty changes intact; retry succeeds",
  );
  await source();
  await page
    .locator('.toastui-editor-md-container [contenteditable="true"]')
    .click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("beforeafter");
  await page.locator("#wysiwygMode").click();
  await page
    .locator('.toastui-editor-ww-container [contenteditable="true"]')
    .click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/html", "<b>word</b>");
    document.activeElement.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForFunction(() =>
    document
      .querySelector(".toastui-editor-ww-container")
      .textContent.includes("word"),
  );
  const inlineSource = (await source()).trim();
  assert.equal(inlineSource.replace("**word**", ""), "beforeafter");
  assert.doesNotMatch(inlineSource, /\n/);
  await save();
  checks.push("inline formatted paste preserves a single paragraph");
  await page.locator("#newButton").click();
  await source();
  await page
    .locator('.toastui-editor-md-container [contenteditable="true"]')
    .click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.locator("#wysiwygMode").click();
  await paste(
    `<p>离线网页段落</p><img src="data:image/png;base64,${Buffer.from(png).toString("base64")}" alt="内嵌图">`,
  );
  await page.waitForFunction(() => document.title.includes("未命名.textpack"));
  await waitImage();
  await page.evaluate(() => (window.__qa.save = "auto.textpack"));
  const auto = await decodeTextPack(await save());
  assert.match(auto.content, /离线网页段落/);
  assert.doesNotMatch(auto.content, /base64/);
  checks.push(
    "web image paste into unsaved document creates TextPack without storing Base64",
  );
  await page
    .locator('.toastui-editor-ww-container [contenteditable="true"]')
    .click();
  await page.keyboard.press("Control+End");
  await page.evaluate((png) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array(png)], "screenshot.png", { type: "image/png" }),
    );
    document.activeElement.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, Array.from(png));
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        ".toastui-editor-ww-container img[data-local-image-source]",
      ).length === 2,
  );
  await waitImage();
  const screenshotSource = await source();
  assert.match(screenshotSource, /assets\/image-2.png/);
  await save();
  checks.push("clipboard screenshot persists as another binary asset");
  // Actual IndexedDB draft contains unsaved archive bytes, and can restore them after a reload.
  await page
    .locator('.toastui-editor-md-container [contenteditable="true"]')
    .click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n草稿恢复测试");
  let draftReady = false;
  for (let i = 0; i < 40 && !draftReady; i++) {
    draftReady = await page.evaluate(async () => {
      const { createDocumentHistory } =
        await import("/src/document-history.js");
      const records = await createDocumentHistory().listDrafts();
      return records.some(
        (r) =>
          r.content.includes("草稿恢复测试") &&
          r.textPack &&
          Object.keys(r.textPack.files).filter((p) => p.startsWith("assets/"))
            .length === 2,
      );
    });
    if (!draftReady) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(
    draftReady,
    "complete text and both image assets are committed to IndexedDB",
  );
  await page.reload();
  await page
    .locator('.toastui-editor-ww-container [contenteditable="true"]')
    .waitFor({ state: "visible" });
  await menu("#draftsButton");
  await page.waitForFunction(
    () =>
      document
        .querySelector("#draftsList")
        .textContent.includes("auto.textpack"),
    null,
    { timeout: 10000 },
  );
  const draftButton = page
    .locator("#draftsList button")
    .filter({ hasText: "auto.textpack" })
    .first();
  await draftButton.click();
  await page.waitForFunction(() =>
    document.body.textContent.includes("草稿恢复测试"),
  );
  await page.locator("#wysiwygMode").click();
  await waitImage();
  checks.push(
    "IndexedDB recovery restores text and binary attachments after reload",
  );
  assert.deepEqual(errors, []);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /injected write failure/);
  console.log(JSON.stringify({ checks, errors, alerts }, null, 2));
} catch (error) {
  await page.screenshot({ path: "work/qa/failure.png", fullPage: true });
  console.error(
    JSON.stringify(
      {
        checks,
        errors,
        alerts,
        title: await page.title(),
        images: await page
          .locator("img")
          .evaluateAll((imgs) =>
            imgs.map((img) => ({
              src: img.getAttribute("src"),
              source: img.getAttribute("data-local-image-source"),
              err: img.getAttribute("data-local-image-error"),
              width: img.naturalWidth,
              visible: !!img.getClientRects().length,
            })),
          ),
        body: (await page.locator("body").innerText()).slice(-2500),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await server.close();
}
