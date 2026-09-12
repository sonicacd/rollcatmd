import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../node_modules/@toast-ui/editor/dist/esm/index.js', import.meta.url), 'utf8');
const start = source.indexOf('var ANIMATION_TIME = 100;');
const end = source.indexOf('\nvar queryMap = {', start);
assert.ok(start >= 0 && end > start, 'locate the installed Toast UI scroll synchronization implementation');

function createHarness() {
  // Execute the installed animation and controller code with real timers; the
  // DOM stand-ins expose only the scrolling surfaces needed by this regression.
  const ScrollSync = vm.runInNewContext(source.slice(start, end) + '\nScrollSync;', { setTimeout, clearTimeout, Date });
  const handlers = new Map();
  const events = {
    listen(type, callback) { handlers.set(type, callback); },
    emit(type, ...args) { handlers.get(type)?.(...args); }
  };
  const editor = { scrollTop: 0 }, preview = { scrollTop: 0 };
  const sync = new ScrollSync({ view: { dom: editor }, getToastMark() { return {}; } },
    { el: preview, previewContent: {} }, events);
  return { sync, events, editor, preview, close() { events.emit('toggleScrollSync', false); } };
}

test('pausing Toast UI scroll synchronization cancels animations in both directions', async () => {
  for (const from of ['editor', 'preview']) {
    const h = createHarness();
    try {
      const target = from === 'editor' ? h.preview : h.editor;
      h.sync.run(from, 900, 0);
      assert.ok(h.sync.blockedScroll);
      h.events.emit('toggleScrollSync', false);
      target.scrollTop = 345; // The app restores its captured reading position.
      await delay(140);
      assert.equal(target.scrollTop, 345, `${from} animation must not overwrite restoration`);
      assert.equal(h.sync.blockedScroll, null);
    } finally { h.close(); }
  }
});

test('pausing clears a pending preview-render timer and ignores renders while paused', async () => {
  const h = createHarness(), calls = [];
  h.sync.syncPreviewScrollTop = editing => calls.push(editing);
  try {
    h.events.emit('afterPreviewRender');
    assert.ok(h.sync.timer);
    h.events.emit('toggleScrollSync', false);
    assert.equal(h.sync.timer, null);
    h.events.emit('afterPreviewRender');
    assert.equal(h.sync.timer, null);
    h.events.emit('toggleScrollSync', true);
    await delay(240);
    assert.deepEqual(calls, [], 'resuming must not revive the old render callback');
    h.events.emit('afterPreviewRender');
    await delay(240);
    assert.deepEqual(calls, [true], 'new render events synchronize normally after resume');
  } finally { h.close(); }
});

test('resuming restores editor and preview scroll synchronization', async () => {
  const h = createHarness(), calls = [];
  h.sync.syncPreviewScrollTop = () => { calls.push('editor'); h.sync.run('editor', 700, h.preview.scrollTop); };
  h.sync.syncEditorScrollTop = () => { calls.push('preview'); h.sync.run('preview', 800, h.editor.scrollTop); };
  try {
    h.events.emit('toggleScrollSync', false);
    h.events.emit('scroll', 'editor');
    h.events.emit('scroll', 'preview');
    assert.deepEqual(calls, []);
    h.events.emit('toggleScrollSync', true);
    h.events.emit('scroll', 'editor');
    await delay(140);
    assert.equal(h.preview.scrollTop, 700);
    h.events.emit('scroll', 'preview');
    await delay(140);
    assert.equal(h.editor.scrollTop, 800);
    assert.deepEqual(calls, ['editor', 'preview']);
  } finally { h.close(); }
});
