import assert from 'node:assert/strict';
import test from 'node:test';
import { createDraftPersistence, createWorkspaceController } from '../src/workspace-controller.js';
import { addTextPackImage, createTextPack, readTextPackImage } from '../src/textpack.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = async () => { for (let index = 0; index < 15; index += 1) await Promise.resolve(); };

function memoryHistory() {
  const recent = new Map(), drafts = new Map();
  const calls = [];
  return {
    recent, drafts, calls,
    async rememberDocument(record) { calls.push(['remember', record.key]); recent.set(record.key, { ...record, updatedAt: 1 }); },
    async getRecent(key) { return recent.get(key) ?? null; },
    async listRecent() { return [...recent.values()]; },
    async forgetRecent(key) { calls.push(['forget', key]); recent.delete(key); },
    async clearRecent() { calls.push(['clear']); recent.clear(); },
    async saveDraft(record) { calls.push(['save', record.id, record.content]); drafts.set(record.id, { ...record, updatedAt: 1 }); },
    async removeDraft(id) { calls.push(['remove', id]); drafts.delete(id); },
    async listDrafts() { return [...drafts.values()]; }
  };
}

class Element {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase(); this.document = document;
    this.children = []; this.dataset = {}; this.attributes = new Map();
    this.className = ''; this.hidden = false; this.disabled = false; this.open = false;
    this.type = ''; this.isConnected = true; this.listeners = new Map();
    this.style = { setProperty() {} };
    this.classList = {
      add: (name) => { if (!this.className.split(' ').includes(name)) this.className += ` ${name}`; },
      remove: (name) => { this.className = this.className.split(' ').filter((value) => value !== name).join(' '); }
    };
  }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text || this.children.map((child) => child.textContent).join(''); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...elements) {
    elements.forEach((element) => {
      if (element.tagName === 'FRAGMENT') this.append(...element.children);
      else { element.parent = this; this.children.push(element); }
    });
  }
  replaceChildren(...elements) { this.children = []; this.text = ''; this.append(...elements); }
  matches(selector) {
    if (selector === '[aria-current]') return this.attributes.has('aria-current');
    if (selector === '[data-index]') return this.dataset.index !== undefined;
    const index = /^\[data-index="(.*?)"\]$/.exec(selector);
    if (index) return this.dataset.index === index[1];
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const match = child.querySelector(selector); if (match) return match;
    }
    return null;
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  async emit(type, event = {}) {
    await Promise.all((this.listeners.get(type) || []).map((callback) => callback({ target: this, ...event })));
  }
  focus() { this.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.onclose?.(); }
}

function fixture({ history = memoryHistory(), dirty = false } = {}) {
  const nodes = new Map(), timers = new Map(), stored = new Map();
  let timerId = 0;
  const document = new Element('document'); document.document = document;
  document.documentElement = new Element('html', document);
  document.createElement = (tag) => new Element(tag, document);
  document.createDocumentFragment = () => new Element('fragment', document);
  document.getElementById = (id) => {
    if (!nodes.has(id)) {
      const node = new Element(id.endsWith('Dialog') ? 'dialog' : id === 'outlineList' ? 'ol' : 'div', document);
      node.id = id;
      if (id === 'outlineEnabled' || id === 'showTokens') node.type = 'checkbox';
      nodes.set(id, node);
    }
    return nodes.get(id);
  };
  document.querySelectorAll = () => [];
  document.querySelector = (selector) => selector === 'dialog[open]'
    ? [...nodes.values()].find((node) => node.tagName === 'DIALOG' && node.open) ?? null : null;
  const window = new Element('window', document);
  window.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  window.requestAnimationFrame = (callback) => { queueMicrotask(callback); return ++timerId; };
  window.matchMedia = () => ({ matches: false });
  const context = { documentId: 1, draftId: 'draft-1', revision: dirty ? 1 : 0, isDirty: dirty,
    filePath: '/note.md', name: '同名.md', mode: 'wysiwyg', fileWritable: true, textFormat: { lineEnding: '\n' } };
  const state = { context, text: '# 一级\n正文\n## 二级', position: { scrollRatio: 0.25 }, statuses: [], restorations: [] };
  const api = {
    context: () => ({ ...state.context }), markdown: () => state.text,
    lineSource: () => { const lines = state.text.split('\n'); return { lineCount: lines.length, getLine: (number) => lines[number - 1] }; },
    status: (message) => state.statuses.push(message), capturePosition: () => ({ ...state.position }),
    restorePosition: (mode, position) => { state.context.mode = mode; state.restorations.push({ mode, position }); },
    visibleLine: () => 1, navigateHeading() {}, preferencesChanged() {},
    async save() { state.context.isDirty = false; }, async openRecent() {}, restoreDraft() {}
  };
  const controller = createWorkspaceController(api, { history, document, window,
    storage: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) } });
  return { controller, api, state, history, document, window, timers, $: document.getElementById };
}

test('draft writes, removal and later edits commit in order; restored sessions can reuse an id', async () => {
  const history = memoryHistory(), gate = deferred();
  const originalSave = history.saveDraft;
  history.saveDraft = async (record) => { if (record.content === 'old') await gate.promise; return originalSave(record); };
  const persistence = createDraftPersistence(history);
  const old = persistence.save({ id: 'same', content: 'old' }, 'session-1:1');
  const removed = persistence.remove('same');
  const current = persistence.save({ id: 'same', content: 'new' }, 'session-1:2');
  gate.resolve(); await Promise.all([old, removed, current]);
  assert.equal(history.drafts.get('same').content, 'new');
  assert.deepEqual(history.calls.map(([action]) => action), ['save', 'remove', 'save']);
  await persistence.save({ id: 'same', content: 'restored and edited' }, 'session-2:2');
  assert.equal(history.drafts.get('same').content, 'restored and edited');
});

test('an earlier failure does not clear deduplication for a newer queued draft', async () => {
  const history = memoryHistory(), failed = deferred();
  const originalSave = history.saveDraft;
  history.saveDraft = async (record) => { if (record.content === 'fail') await failed.promise; return originalSave(record); };
  const persistence = createDraftPersistence(history);
  const first = persistence.save({ id: 'same', content: 'fail' }, '1:1');
  const rejection = assert.rejects(first, /quota/);
  const newer = persistence.save({ id: 'same', content: 'newer' }, '1:2');
  failed.reject(new Error('quota')); await rejection; await newer;
  await persistence.save({ id: 'same', content: 'duplicate' }, '1:2');
  assert.equal(history.drafts.get('same').content, 'newer');
  assert.equal(history.calls.length, 1);
});

test('beforeDocumentChange captures the old text immediately and flush waits for its write', async () => {
  const f = fixture({ dirty: true }), gate = deferred();
  const originalSave = f.history.saveDraft;
  f.history.saveDraft = async (record) => { await gate.promise; return originalSave(record); };
  const oldText = f.state.text;
  const pending = f.controller.beforeDocumentChange();
  f.state.context = { ...f.state.context, documentId: 2, draftId: 'draft-2', isDirty: false, filePath: '/other.md' };
  f.state.text = 'new document';
  let finished = false;
  const closing = f.controller.flush().then(() => { finished = true; });
  await tick(); assert.equal(finished, false);
  gate.resolve(); await Promise.all([pending, closing]);
  assert.equal(f.history.drafts.get('draft-1').content, oldText);
  assert.equal(f.history.drafts.has('draft-2'), false);
});

test('TextPack recovery checkpoints retain binary attachments through structured cloning and document changes', async () => {
  const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const { textPack, relativePath } = await addTextPackImage(createTextPack(), new Blob([pngBytes], { type: 'image/png' }));
  const f = fixture({ dirty: true }), gate = deferred();
  const originalSave = f.history.saveDraft;
  // IndexedDB clones typed arrays when writing and when reading records.
  f.history.saveDraft = async (record) => {
    const persisted = structuredClone(record);
    await gate.promise;
    return originalSave(persisted);
  };
  f.history.listDrafts = async () => structuredClone([...f.history.drafts.values()]);
  f.state.context = { ...f.state.context, filePath: '/with-images.textpack', name: 'with-images.textpack', textPack };
  f.state.text = `# 待恢复\n\n![图片](${relativePath})`;
  const originalContent = f.state.text;
  const checkpoint = f.controller.beforeDocumentChange();
  f.state.context = { ...f.state.context, documentId: 2, draftId: 'draft-2', isDirty: false, filePath: '/other.md', textPack: null };
  f.state.text = 'other document';
  await tick();
  gate.resolve(); await checkpoint;

  const stored = f.history.drafts.get('draft-1');
  assert.equal(stored.content, originalContent);
  assert.equal(stored.filePath, '/with-images.textpack');
  assert.ok(stored.textPack.files[relativePath] instanceof Uint8Array);
  assert.notEqual(stored.textPack.files[relativePath], textPack.files[relativePath]);
  assert.equal(f.history.drafts.has('draft-2'), false);

  let restored;
  f.api.restoreDraft = (record) => { restored = record; };
  await f.controller.showDrafts();
  await f.$('draftsList').children[0].querySelector('.document-list-main').onclick();
  assert.equal(restored.content, originalContent);
  const restoredImage = await readTextPackImage(restored.textPack, relativePath);
  assert.deepEqual(new Uint8Array(await restoredImage.arrayBuffer()), pngBytes);
  // Mutating a newly restored session cannot corrupt the stored recovery copy.
  restored.textPack.files[relativePath][0] = 0;
  assert.deepEqual(stored.textPack.files[relativePath], pngBytes);
});

test('save prompt locks all choices during save and only one pending leave action proceeds', async () => {
  const f = fixture({ dirty: true }), gate = deferred();
  f.api.save = async () => { await gate.promise; f.state.context.isDirty = false; f.controller.saved(f.api.context()); };
  const leaving = f.controller.askToLeave();
  assert.equal(await f.controller.askToLeave(), false);
  const saving = f.$('saveAndContinueButton').onclick();
  assert.equal(f.$('discardChangesButton').disabled, true);
  assert.equal(f.$('cancelDiscardButton').disabled, true);
  await f.$('discardChangesButton').onclick();
  f.$('cancelDiscardButton').onclick();
  f.$('confirmSaveDialog').oncancel({ preventDefault() {} });
  assert.equal(f.$('confirmSaveDialog').open, true);
  gate.resolve(); await saving;
  assert.equal(await leaving, true);
  assert.equal(f.$('confirmSaveDialog').open, false);
  assert.ok(f.history.calls.some(([action, id]) => action === 'remove' && id === 'draft-1'));
});

test('a cancelled save stays in the prompt and cancellation leaves the document intact', async () => {
  const f = fixture({ dirty: true });
  f.api.save = async () => {};
  const leaving = f.controller.askToLeave();
  await f.$('saveAndContinueButton').onclick();
  assert.equal(f.$('confirmSaveDialog').open, true);
  assert.equal(f.$('discardChangesButton').disabled, false);
  f.$('cancelDiscardButton').onclick();
  assert.equal(await leaving, false);
  assert.equal(f.state.context.isDirty, true);
});

test('discard waits for the complete recoverable draft before allowing navigation', async () => {
  const f = fixture({ dirty: true }), gate = deferred();
  const originalSave = f.history.saveDraft;
  f.history.saveDraft = async (record) => { await gate.promise; return originalSave(record); };
  let allowed = false;
  const leaving = f.controller.askToLeave().then((value) => { allowed = value; });
  const discarding = f.$('discardChangesButton').onclick();
  await tick(); assert.equal(allowed, false);
  gate.resolve(); await Promise.all([discarding, leaving]);
  assert.equal(allowed, true);
  assert.equal(f.history.drafts.get('draft-1').content, f.state.text);
});

test('a failed discard checkpoint keeps the document and permits a successful retry', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const f = fixture({ dirty: true });
  const originalSave = f.history.saveDraft;
  f.history.saveDraft = async () => { throw new Error('quota exceeded'); };
  const leaving = f.controller.askToLeave();
  await f.$('discardChangesButton').onclick();
  assert.equal(f.$('confirmSaveDialog').open, true);
  assert.equal(f.state.context.isDirty, true);
  assert.equal(f.history.drafts.size, 0);
  assert.ok(f.state.statuses.some((message) => message.includes('当前文档已保留')));
  f.history.saveDraft = originalSave;
  await f.$('discardChangesButton').onclick();
  assert.equal(await leaving, true);
  assert.equal(f.history.drafts.get('draft-1').content, f.state.text);
});

test('new edits during a save keep the prompt open and the newer draft recoverable', async () => {
  const f = fixture({ dirty: true }), gate = deferred();
  f.api.save = async () => { const snapshot = f.api.context(); await gate.promise; f.controller.saved(snapshot); };
  const leaving = f.controller.askToLeave();
  const saving = f.$('saveAndContinueButton').onclick();
  f.state.context.revision += 1; f.state.text = 'newer content';
  await f.controller.flush();
  gate.resolve(); await saving;
  assert.equal(f.$('confirmSaveDialog').open, true);
  assert.equal(f.history.drafts.get('draft-1').content, 'newer content');
  f.$('cancelDiscardButton').onclick();
  assert.equal(await leaving, false);
});

test('same-name drafts are removed by their own row and unchanged active drafts stay deleted', async () => {
  const f = fixture({ dirty: true });
  f.history.drafts.set('other', { id: 'other', name: '同名.md', content: 'other', updatedAt: 1 });
  f.history.drafts.set('draft-1', { id: 'draft-1', name: '同名.md', content: 'current', updatedAt: 2 });
  await f.controller.showDrafts();
  const rows = f.$('draftsList').children;
  const remove = rows[1].querySelector('.document-list-remove');
  await remove.onclick();
  assert.equal(rows[0].dataset.confirmRemove, undefined);
  assert.equal(remove.textContent, '确认移除');
  await remove.onclick();
  assert.equal(f.history.drafts.has('other'), true);
  assert.equal(f.history.drafts.has('draft-1'), false);
  f.state.context.mode = 'reader'; f.state.position = { scrollRatio: 0.8 };
  await f.controller.flush();
  assert.equal(f.history.drafts.has('draft-1'), false);
  f.state.context.revision += 1; f.state.text = 'new edit';
  await f.controller.flush();
  assert.equal(f.history.drafts.get('draft-1').content, 'new edit');
});

test('unchanged draft text retains the latest mode and position when leaving', async () => {
  const f = fixture({ dirty: true });
  await f.controller.flush();
  f.state.context.mode = 'reader'; f.state.position = { scrollRatio: 0.75 };
  await f.controller.flush();
  const record = f.history.drafts.get('draft-1');
  assert.equal(record.mode, 'reader');
  assert.deepEqual(record.position, { scrollRatio: 0.75 });
  assert.equal(record.content, f.state.text);
  const writes = f.history.calls.filter(([action]) => action === 'save').length;
  await f.controller.flush();
  assert.equal(f.history.calls.filter(([action]) => action === 'save').length, writes);
});

test('reopening preserves the stored anchor while asynchronous layout still shows the top', async () => {
  const f = fixture();
  const position = { scrollRatio: 0.83, text: { before: 'chapter', after: 'content' } };
  f.history.recent.set('/note.md', { key: '/note.md', filePath: '/note.md', name: '同名.md', mode: 'reader', position });
  f.state.position = { scrollRatio: 0 };
  await f.controller.documentOpened();
  assert.deepEqual(f.state.restorations, [{ mode: 'reader', position }]);
  assert.deepEqual(f.history.recent.get('/note.md').position, position);
  assert.equal(f.history.recent.get('/note.md').mode, 'reader');
});

test('clearing recents stays cleared through scroll, mode changes and close; explicit reopening resumes recording', async () => {
  const f = fixture(); f.controller.init(); await tick();
  await f.controller.documentOpened();
  assert.equal(f.history.recent.size, 1);
  await f.$('clearRecentButton').onclick();
  f.controller.modeChanged(); await f.controller.flush();
  assert.equal(f.history.recent.size, 0);
  f.state.context.documentId += 1;
  await f.controller.documentOpened();
  assert.equal(f.history.recent.size, 1);
});

test('outline uses semantic list items, remembers collapse, and restores its enabled preference', async () => {
  const f = fixture(); f.controller.init(); await tick();
  assert.equal(f.$('outlinePanel').hidden, false);
  assert.equal(f.$('outlineToggle').title, '收起章节大纲');
  const first = f.$('outlineList').children[0];
  assert.equal(first.tagName, 'LI'); assert.equal(first.className, 'outline-item');
  assert.equal(first.children[0].tagName, 'BUTTON');
  assert.equal(first.children[0].getAttribute('aria-current'), 'location');
  f.$('outlineEnabled').checked = false; await f.$('outlineEnabled').emit('change');
  assert.equal(f.$('outlineToggle').hidden, true);
  f.$('outlineEnabled').checked = true; await f.$('outlineEnabled').emit('change');
  assert.equal(f.$('outlinePanel').hidden, false);
  f.$('outlineCloseButton').onclick();
  f.$('outlineEnabled').checked = false; await f.$('outlineEnabled').emit('change');
  f.$('outlineEnabled').checked = true; await f.$('outlineEnabled').emit('change');
  assert.equal(f.$('outlinePanel').hidden, true);
  assert.equal(f.controller.preferences.outlineExpanded, false);
  assert.equal(f.$('outlineToggle').getAttribute('aria-expanded'), 'false');
});

test('Escape in a dialog preserves the saved outline expansion preference', async () => {
  const f = fixture({ dirty: true }); f.controller.init(); await tick();
  const leaving = f.controller.askToLeave();
  await f.document.emit('keydown', { key: 'Escape' });
  assert.equal(f.controller.preferences.outlineExpanded, true);
  f.$('confirmSaveDialog').oncancel({ preventDefault() {} });
  assert.equal(await leaving, false);
});
