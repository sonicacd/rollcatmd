import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextAnchor, createViewPositionController, normalizeAnchorText, resolveTextAnchor } from '../src/view-position.js';

test('a text anchor survives Markdown formatting and different line wrapping', () => {
  const visual = normalizeAnchorText('开头\n阅读中的中文段落包含强调文字以及后续正文。\n结束');
  const source = normalizeAnchorText('# 开头\n\n阅读中的**中文段落**包含强调文字以及后续正文。\n\n结束');
  const offset = visual.indexOf('中文');
  assert.equal(resolveTextAnchor(source, createTextAnchor(visual, offset)), source.indexOf('中文'));
});

test('repeated paragraphs retain their occurrence even when other content changes height', () => {
  const repeated = '相同的正文重复出现时仍应停留在正在阅读的这一段文字';
  const visual = repeated.repeat(90);
  const source = '前言'.repeat(200) + visual;
  const offset = repeated.length * 63 + 5;
  assert.equal(resolveTextAnchor(source, createTextAnchor(visual, offset)), 400 + offset);
});

test('shorter context recovers an anchor next to a raw Markdown URL', () => {
  const visual = normalizeAnchorText('前面的正文内容'.repeat(20) + '正在看的文字链接后面还有其它内容'.repeat(5));
  const source = normalizeAnchorText('前面的正文内容'.repeat(20) + '正在看的文字[链接](https://example.com)后面还有其它内容'.repeat(5));
  const offset = visual.indexOf('正在看');
  assert.equal(resolveTextAnchor(source, createTextAnchor(visual, offset)), source.indexOf('正在看'));
});

test('unmatched and empty content leave restoration to the scroll fallback', () => {
  assert.equal(resolveTextAnchor('', createTextAnchor('', 0)), null);
  assert.equal(resolveTextAnchor('完全不同的文档内容', createTextAnchor('正在阅读原始文档', 2)), null);
});

test('normalization preserves international text and does not split astral letters', () => {
  assert.equal(normalizeAnchorText('**中文** _café_ 𐐀\n123!'), '中文café𐐀123');
});

function restorationHarness() {
  const frames = new Map();
  const listeners = new Map();
  let sequence = 0;
  const win = {
    requestAnimationFrame(fn) { frames.set(++sequence, fn); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout() { return 1; }, clearTimeout() {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); }
  };
  const root = {
    ownerDocument: { defaultView: win }, isConnected: true,
    addEventListener() {}, removeEventListener() {}
  };
  const scroller = { scrollTop: 450, scrollHeight: 2000, clientHeight: 500 };
  return {
    root, scroller, listeners,
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn()); }
  };
}

test('restoration preserves document edges after the target layout settles', () => {
  const h = restorationHarness();
  const controller = createViewPositionController();
  controller.restore({ edge: 'bottom', scrollRatio: 1 }, h.root, h.scroller);
  h.flush();
  assert.equal(h.scroller.scrollTop, 1500);
  h.scroller.scrollHeight = 2300;
  h.flush();
  assert.equal(h.scroller.scrollTop, 1800);
  controller.restore({ edge: 'top', scrollRatio: 0 }, h.root, h.scroller);
  h.flush();
  assert.equal(h.scroller.scrollTop, 0);
  controller.cancel();
});

test('new document and user input cancel stale scheduled scrolling', () => {
  for (const action of ['cancel', 'wheel', 'pointerdown', 'keydown', 'touchstart']) {
    const h = restorationHarness();
    const controller = createViewPositionController();
    controller.restore({ edge: 'top', scrollRatio: 0 }, h.root, h.scroller);
    if (action === 'cancel') controller.cancel();
    else h.listeners.get(action)();
    h.flush();
    assert.equal(h.scroller.scrollTop, 450, action);
    assert.equal(h.listeners.size, 0);
  }
});

test('only the newest rapid view switch may restore its scroll position', () => {
  const h = restorationHarness();
  const controller = createViewPositionController();
  controller.restore({ edge: 'top', scrollRatio: 0 }, h.root, h.scroller);
  controller.restore({ edge: 'bottom', scrollRatio: 1 }, h.root, h.scroller);
  h.flush();
  assert.equal(h.scroller.scrollTop, 1500);
  controller.cancel();
});
