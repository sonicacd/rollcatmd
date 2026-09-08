import { readPreferences, savePreferences, applyPreferences } from './workspace-preferences.js';
import { createDocumentHistory } from './document-history.js';
import { buildDocumentOutline, currentOutlineIndex } from './document-outline.js';

const MODES = new Set(['wysiwyg', 'markdown', 'reader']);

export function createDraftPersistence(history, reportError = () => {}) {
  let tail = Promise.resolve();
  const latest = new Map();
  function queue(task) {
    const result = tail.then(task).then(() => undefined);
    tail = result.catch(reportError);
    return result;
  }
  return {
    save(record, token, { contentToken = token } = {}) {
      const previous = latest.get(record.id);
      if (previous?.suppressed && previous.token === contentToken) return previous.promise || tail;
      if (previous?.token === token) return previous.promise || tail;
      const entry = { token, promise: null };
      latest.set(record.id, entry);
      entry.promise = queue(() => history.saveDraft(record));
      entry.promise.then(() => { entry.promise = null; }, () => {
        if (latest.get(record.id) === entry) latest.delete(record.id);
      });
      return entry.promise;
    },
    remove(id, suppressToken) {
      // An explicit deletion suppresses this unchanged version until the next edit.
      const entry = suppressToken === undefined ? null : { token: suppressToken, promise: null, suppressed: true };
      if (entry) latest.set(id, entry); else latest.delete(id);
      const result = queue(() => history.removeDraft(id));
      if (entry) {
        entry.promise = result;
        result.then(() => { entry.promise = null; }, () => {
          if (latest.get(id) === entry) latest.delete(id);
        });
      }
      return result;
    },
    flush: () => tail
  };
}

function draftToken(context) {
  // Restoring the same draft starts a new document session with a fresh revision counter.
  return `${context.documentId}:${context.revision}`;
}

export function createWorkspaceController(api, options = {}) {
  const document = options.document || globalThis.document;
  const window = options.window || globalThis.window;
  const $ = (id) => document.getElementById(id);
  const history = options.history || createDocumentHistory();
  const storage = options.storage;
  const readSettings = () => readPreferences(storage);
  const saveSettings = (value) => savePreferences(value, storage);
  const applySettings = (value) => applyPreferences(value, { root: document.documentElement, persist: false });
  const scheduleFrame = options.requestAnimationFrame || window.requestAnimationFrame.bind(window);
  const setTimeout = options.setTimeout || window.setTimeout.bind(window);
  const clearTimeout = options.clearTimeout || window.clearTimeout.bind(window);
  const matchMedia = options.matchMedia || window.matchMedia.bind(window);
  let preferences = applySettings(readSettings());
  let headings = [];
  let outlineAbort;
  let outlineTimer;
  let draftTimer;
  let draftDeadline;
  let recentTimer;
  let scrollFrame;
  let leavePromise;
  let recentTail = Promise.resolve();
  let recentEpoch = 0;
  let restoringDocument = null;
  let recentRender = 0;
  let draftRender = 0;
  const suppressedRecent = new Set();
  let persistenceWarning = false;
  const reportStorageError = (error) => {
    console.warn('本地记录保存失败', error);
    if (!persistenceWarning) { api.status('本地恢复记录写入失败，请及时保存文档。'); persistenceWarning = true; }
  };
  const drafts = createDraftPersistence(history, reportStorageError);
  const queueRecent = (task) => {
    const result = recentTail.then(task);
    recentTail = result.then(() => undefined, reportStorageError);
    return result;
  };

  function closeMenus() { document.querySelectorAll('.sidebar details[open]').forEach((menu) => { menu.open = false; }); }
  function showDialog(id) { closeMenus(); if (!$(id).open) $(id).showModal(); }
  function updateOutlineVisibility(open = !$('outlinePanel').hidden) {
    $('outlineToggle').hidden = !preferences.outlineEnabled;
    $('outlinePanel').hidden = !preferences.outlineEnabled || !open;
    $('outlineToggle').setAttribute('aria-expanded', String(!$('outlinePanel').hidden));
    $('outlineToggle').title = $('outlinePanel').hidden ? '展开章节大纲' : '收起章节大纲';
  }

  async function rebuildOutline() {
    outlineAbort?.abort();
    if (!preferences.outlineEnabled) { headings = []; $('outlineList').replaceChildren(); return; }
    const controller = new AbortController();
    outlineAbort = controller;
    const context = api.context();
    try {
      const next = await buildDocumentOutline(api.lineSource(), { signal: controller.signal });
      if (controller.signal.aborted || api.context().documentId !== context.documentId || api.context().revision !== context.revision) return;
      headings = next;
      $('outlineList').replaceChildren();
      $('outlineEmpty').hidden = Boolean(headings.length);
      // Render the list in batches so a document containing thousands of short
      // headings remains responsive and cancellation can stop stale DOM work.
      for (let start = 0; start < headings.length; start += 250) {
        if (controller.signal.aborted) return;
        const fragment = document.createDocumentFragment();
        headings.slice(start, start + 250).forEach((heading, index) => {
          const item = document.createElement('li'); item.className = 'outline-item';
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.index = String(start + index);
          button.style.setProperty('--outline-level', String(heading.level));
          button.textContent = heading.title; button.title = `${heading.title} · 第 ${heading.line} 行`;
          item.append(button); fragment.append(item);
        });
        $('outlineList').append(fragment);
        if (start + 250 < headings.length) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      updateCurrentHeading();
    } catch (error) { if (error.name !== 'AbortError') console.warn('章节索引失败', error); }
  }

  function updateCurrentHeading() {
    if ($('outlinePanel').hidden || !headings.length) return;
    const index = currentOutlineIndex(headings, api.visibleLine(headings));
    const previous = $('outlineList').querySelector('[aria-current]');
    if (previous?.dataset.index === String(index)) return;
    previous?.removeAttribute('aria-current'); previous?.classList.remove('active');
    const button = $('outlineList').querySelector(`[data-index="${index}"]`);
    button?.setAttribute('aria-current', 'location'); button?.classList.add('active');
  }

  function rememberRecord(record, epoch = recentEpoch) {
    return queueRecent(async () => {
      if (epoch !== recentEpoch || suppressedRecent.has(record.key)) return;
      await history.rememberDocument(record);
      await api.rememberNative?.(record.filePath);
    }).catch(reportStorageError);
  }

  function recentRecord(context, position) {
    return {
      key: context.filePath, filePath: context.filePath, name: context.name,
      mode: context.mode, position, browserFileHandle: context.browserFileHandle,
      fileWritable: context.fileWritable
    };
  }

  function rememberCurrent() {
    const context = api.context();
    if (!context.filePath || suppressedRecent.has(context.filePath) || restoringDocument?.id === context.documentId) return recentTail;
    return rememberRecord(recentRecord(context, api.capturePosition()));
  }

  async function persistDraft() {
    clearTimeout(draftTimer); clearTimeout(draftDeadline); draftDeadline = null;
    const context = api.context();
    if (!context.isDirty) return drafts.flush();
    const position = api.capturePosition();
    const record = {
      id: context.draftId, filePath: context.filePath, name: context.name,
      content: api.markdown(), textFormat: context.textFormat,
      textPack: context.textPack || null,
      mode: context.mode, position, revision: context.revision
    };
    // Modes and positions can change without an edit. Capture them at these
    // debounced/lifecycle checkpoints; scrolling itself never writes a full draft.
    const token = JSON.stringify([draftToken(context), context.mode, position]);
    return drafts.save(record, token, { contentToken: draftToken(context) });
  }

  function changed() {
    clearTimeout(outlineTimer); outlineTimer = setTimeout(rebuildOutline, 500);
    clearTimeout(draftTimer); draftTimer = setTimeout(() => void persistDraft().catch(reportStorageError), 1500);
    if (!draftDeadline) draftDeadline = setTimeout(() => void persistDraft().catch(reportStorageError), 10000);
  }

  async function documentOpened() {
    const context = api.context();
    clearTimeout(recentTimer);
    void rebuildOutline();
    if (!context.filePath) return;
    suppressedRecent.delete(context.filePath);
    const restoration = { id: context.documentId };
    restoringDocument = restoration;
    try {
      const previous = await queueRecent(() => history.getRecent(context.filePath));
      if (api.context().documentId !== context.documentId || api.context().revision !== context.revision || api.context().mode !== context.mode) return;
      if (previous && MODES.has(previous.mode)) api.restorePosition(previous.mode, previous.position);
      // The editor restores scroll over animation frames. Keep the stored anchor
      // while that layout runs, instead of replacing it with the initial viewport.
      await rememberRecord(recentRecord(api.context(), previous?.position ?? api.capturePosition()));
      await new Promise((resolve) => scheduleFrame(() => scheduleFrame(resolve)));
    } catch (error) { reportStorageError(error); }
    finally { if (restoringDocument === restoration) restoringDocument = null; }
  }

  async function askToLeave() {
    // Only the action that opened this prompt may proceed. Concurrent shortcuts
    // or native close requests must not all consume the same affirmative answer.
    if (leavePromise) return false;
    if (!api.context().isDirty) {
      const cleanDocumentId = api.context().documentId;
      await flush();
      if (api.context().documentId !== cleanDocumentId) return false;
      return api.context().isDirty ? askToLeave() : true;
    }
    const context = api.context();
    const dialog = $('confirmSaveDialog');
    const buttons = ['saveAndContinueButton', 'discardChangesButton', 'cancelDiscardButton'].map($);
    const returnFocus = document.activeElement;
    let settled = false;
    let busy = false;
    let resolveLeave;
    leavePromise = new Promise((resolve) => { resolveLeave = resolve; });
    const result = leavePromise;
    $('confirmSaveName').textContent = context.name;
    const setBusy = (value) => {
      busy = value; buttons.forEach((button) => { button.disabled = value; });
      dialog.setAttribute('aria-busy', String(value));
    };
    const finish = (value) => {
      if (settled) return;
      settled = true; setBusy(false);
      buttons.forEach((button) => { button.onclick = null; });
      dialog.oncancel = null; dialog.onclose = null;
      if (dialog.open) dialog.close();
      leavePromise = null; resolveLeave(value);
      if (!value && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
    const action = (task) => async () => {
      if (busy || settled) return;
      setBusy(true);
      try {
        if (api.context().documentId !== context.documentId) { finish(false); return; }
        await task();
      } catch (error) {
        reportStorageError(error);
        api.status('操作未完成，当前文档已保留。请保存文档或取消。');
      } finally { if (!settled) setBusy(false); }
    };
    $('saveAndContinueButton').onclick = action(async () => {
      await api.save();
      if (api.context().documentId !== context.documentId) { finish(false); return; }
      if (!api.context().isDirty) { await flush(); finish(true); }
    });
    $('discardChangesButton').onclick = action(async () => {
      const revision = api.context().revision;
      await flush();
      if (api.context().documentId !== context.documentId) { finish(false); return; }
      if (api.context().revision !== revision) {
        api.status('文档出现新更改，请确认后再继续。'); return;
      }
      finish(true);
    });
    $('cancelDiscardButton').onclick = () => { if (!busy) finish(false); };
    dialog.oncancel = (event) => { event.preventDefault(); if (!busy) finish(false); };
    dialog.onclose = () => { if (!settled) finish(false); };
    try { showDialog('confirmSaveDialog'); $('saveAndContinueButton').focus(); }
    catch (error) { reportStorageError(error); finish(false); }
    return result;
  }

  function listItem(record, action, remove) {
    const item = document.createElement('div'); item.className = 'document-list-item';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'document-list-main';
    const title = document.createElement('strong'); title.textContent = record.name;
    const meta = document.createElement('span'); meta.className = 'document-list-meta';
    meta.textContent = `${new Date(record.updatedAt).toLocaleString()}${record.filePath ? ` · ${record.filePath}` : ' · 未命名草稿'}`;
    button.append(title, meta);
    const removeButton = document.createElement('button'); removeButton.type = 'button'; removeButton.className = 'document-list-remove';
    removeButton.textContent = '移除'; removeButton.setAttribute('aria-label', `移除 ${record.name}`);
    let busy = false;
    const perform = (operation) => async () => {
      if (busy) return;
      busy = true; button.disabled = true; removeButton.disabled = true;
      try { await operation(item, removeButton); }
      catch (error) { reportStorageError(error); api.status(`操作失败：${error.message || error}`); }
      finally { busy = false; button.disabled = false; removeButton.disabled = false; }
    };
    button.onclick = perform(action); removeButton.onclick = perform(remove);
    item.append(button, removeButton); return item;
  }

  async function showRecent() {
    showDialog('recentDialog'); await renderRecent();
  }
  async function renderRecent() {
    const render = ++recentRender;
    try {
      const records = await queueRecent(() => history.listRecent());
      if (render !== recentRender) return;
      $('recentList').replaceChildren();
      if (!records.length) $('recentList').textContent = '打开文档后，会在这里保留最近 20 项。';
      records.forEach((record) => $('recentList').append(listItem(record, async () => {
        $('recentDialog').close();
        if (await askToLeave()) {
          try { await api.openRecent(record); }
          catch (error) { api.status(`无法重新打开：${error.message || error}。可通过“打开”重新选择文件。`); }
        }
      }, async () => {
        suppressedRecent.add(record.key);
        await queueRecent(async () => { await history.forgetRecent(record.key); await api.forgetNative?.(record.filePath); });
        await renderRecent();
      })));
    } catch (error) { if (render === recentRender) $('recentList').textContent = `无法读取记录：${error.message || error}`; }
  }

  async function showDrafts() { showDialog('draftsDialog'); await renderDrafts(); }
  async function renderDrafts() {
    const render = ++draftRender;
    try {
      await drafts.flush();
      const records = await history.listDrafts();
      if (render !== draftRender) return;
      $('draftsList').replaceChildren();
      if (!records.length) $('draftsList').textContent = '暂无恢复草稿。编辑中的文档会自动在本机保留恢复副本。';
      records.forEach((record) => $('draftsList').append(listItem(record, async () => {
        $('draftsDialog').close();
        if (await askToLeave()) {
          api.restoreDraft(record); await rebuildOutline();
          api.status('已恢复本地草稿，请检查后保存。');
        }
      }, async (item, removeButton) => {
        // Two-step inline action gives a concrete chance to cancel deletion.
        if (!item.dataset.confirmRemove) {
          item.dataset.confirmRemove = 'true'; removeButton.textContent = '确认移除';
          removeButton.setAttribute('aria-label', `确认移除草稿 ${record.name}`);
          return;
        }
        const current = api.context();
        await drafts.remove(record.id, current.draftId === record.id ? draftToken(current) : undefined);
        await renderDrafts();
      })));
    } catch (error) { if (render === draftRender) $('draftsList').textContent = `无法读取草稿：${error.message || error}`; }
  }

  function init() {
    const fields = { fontSizeSelect: 'fontSize', lineHeightSelect: 'lineHeight', contentWidthSelect: 'contentWidth', outlineEnabled: 'outlineEnabled', showTokens: 'showTokens' };
    Object.entries(fields).forEach(([id, field]) => {
      const input = $(id);
      if (input.type === 'checkbox') input.checked = preferences[field]; else input.value = String(preferences[field]);
      input.addEventListener('change', () => {
        const position = api.capturePosition();
        preferences = saveSettings({ ...preferences, [field]: input.type === 'checkbox' ? input.checked : input.value });
        preferences = applySettings(preferences);
        updateOutlineVisibility(preferences.outlineExpanded); api.preferencesChanged(preferences, position);
        if (field === 'outlineEnabled') void rebuildOutline();
      });
    });
    updateOutlineVisibility(preferences.outlineExpanded !== false);
    function toggleOutline(open) {
      preferences = saveSettings({ ...preferences, outlineExpanded: open });
      updateOutlineVisibility(open); updateCurrentHeading();
    }
    $('outlineToggle').onclick = () => toggleOutline($('outlinePanel').hidden);
    $('outlineCloseButton').onclick = () => { toggleOutline(false); $('outlineToggle').focus(); };
    $('outlineList').onclick = (event) => {
      const button = event.target.closest('[data-index]');
      if (!button) return;
      const index = Number(button.dataset.index);
      if (!headings[index]) return;
      api.navigateHeading(headings[index], index);
      if (matchMedia('(max-width: 820px)').matches) toggleOutline(false);
      scheduleFrame(updateCurrentHeading);
    };
    $('recentButton').onclick = () => void showRecent();
    $('draftsButton').onclick = () => void showDrafts();
    $('closeRecentButton').onclick = () => $('recentDialog').close();
    $('closeDraftsButton').onclick = () => $('draftsDialog').close();
    $('clearRecentButton').onclick = async () => {
      const button = $('clearRecentButton');
      if (button.disabled) return;
      button.disabled = true; recentEpoch += 1;
      const currentPath = api.context().filePath;
      if (currentPath) suppressedRecent.add(currentPath);
      clearTimeout(recentTimer);
      try {
        await queueRecent(async () => { await history.clearRecent(); await api.clearNative?.(); });
        await renderRecent();
      } catch (error) { reportStorageError(error); }
      finally { button.disabled = false; }
    };
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.sidebar details')) closeMenus();
      if (event.target.closest('.sidebar details button')) closeMenus();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenus();
        if (!document.querySelector('dialog[open]') && !$('outlinePanel').hidden) { toggleOutline(false); $('outlineToggle').focus(); }
      }
    });
    document.addEventListener('scroll', () => {
      if (scrollFrame) return;
      scrollFrame = scheduleFrame(() => { scrollFrame = null; updateCurrentHeading(); });
      clearTimeout(recentTimer); recentTimer = setTimeout(() => void rememberCurrent(), 800);
    }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) void flush().catch(reportStorageError); });
    window.addEventListener('pagehide', () => { void flush().catch(reportStorageError); });
    void rebuildOutline();
    // Startup only advertises recoverable drafts; the current document remains
    // visible, including one supplied through the operating system.
    history.listDrafts().then((drafts) => {
      if (drafts.length) { $('draftsButton').textContent = `恢复草稿 (${drafts.length})`; api.status(`有 ${drafts.length} 份本地草稿可恢复，请在“更多”中查看。`); }
    }).catch(reportStorageError);
  }

  async function flush() {
    clearTimeout(recentTimer);
    // Both calls capture the current document before either operation awaits.
    const draftWork = persistDraft();
    const recentWork = rememberCurrent();
    await Promise.all([draftWork, recentWork]);
    await Promise.all([drafts.flush(), recentTail]);
  }

  return {
    init, changed, documentOpened, askToLeave,
    get preferences() { return preferences; },
    beforeDocumentChange() {
      const pending = flush();
      // setDocument is synchronous. The queued records already contain the old
      // document's text and position, and flush() on close waits for this work.
      void pending.catch(reportStorageError);
      clearTimeout(outlineTimer); outlineAbort?.abort();
      return pending;
    },
    saved(snapshot) {
      if (api.context().documentId === snapshot.documentId && !api.context().isDirty) {
        clearTimeout(draftTimer); clearTimeout(draftDeadline); draftDeadline = null;
        void drafts.remove(snapshot.draftId).catch(reportStorageError);
      }
      void rememberCurrent();
    },
    modeChanged() { clearTimeout(recentTimer); recentTimer = setTimeout(() => void rememberCurrent(), 1200); scheduleFrame(updateCurrentHeading); },
    flush,
    rebuildOutline, showRecent, showDrafts
  };
}
