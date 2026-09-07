import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOCUMENT_HISTORY_DATABASE,
  DocumentHistoryError,
  RECENT_DOCUMENT_LIMIT,
  RECOVERY_DRAFT_LIMIT,
  createDocumentHistory,
  sortAndLimitHistory
} from '../src/document-history.js';

// A request/transaction harness: writes commit only on completion and failures
// abort the transaction. Browser integration separately exercises native IDB.
function indexedDbHarness() {
  const tables = new Map();
  const harness = { quotaExceeded: false, opens: 0 };
  const database = {
    objectStoreNames: { contains: (name) => tables.has(name) },
    createObjectStore(name, { keyPath }) {
      const table = { keyPath, rows: new Map(), indexes: new Set() };
      tables.set(name, table);
      return {
        indexNames: { contains: (index) => table.indexes.has(index) },
        createIndex: (index) => table.indexes.add(index)
      };
    },
    close() {},
    transaction(name, mode) {
      const table = tables.get(name);
      const rows = new Map(table.rows);
      const transaction = { error: null };
      let pending = 0;
      let finished = false;
      const abort = () => {
        if (finished) return;
        finished = true;
        queueMicrotask(() => transaction.onabort?.());
      };
      transaction.abort = abort;
      const enqueue = (request, operation) => {
        pending += 1;
        queueMicrotask(() => {
          if (finished) return;
          try {
            request.result = operation();
            request.onsuccess?.({ target: request });
          } catch (error) {
            request.error = error;
            transaction.error = error;
            transaction.onerror?.({ target: request });
            abort();
          }
          pending -= 1;
          queueMicrotask(() => {
            if (pending || finished) return;
            finished = true;
            if (mode === 'readwrite') table.rows = rows;
            transaction.oncomplete?.();
          });
        });
      };
      const requestFor = (operation) => {
        const request = {};
        enqueue(request, operation);
        return request;
      };
      const write = (operation) => requestFor(() => {
        if (harness.quotaExceeded) throw new DOMException('Disk full', 'QuotaExceededError');
        return operation();
      });
      transaction.objectStore = () => ({
        get: (key) => requestFor(() => structuredClone(rows.get(key))),
        getAll: () => requestFor(() => structuredClone([...rows.values()])),
        put(record) {
          const copy = structuredClone(record);
          return write(() => rows.set(copy[table.keyPath], copy));
        },
        delete: (key) => write(() => rows.delete(key)),
        clear: () => write(() => rows.clear()),
        index() {
          return {
            openKeyCursor() {
              const request = {};
              let entries;
              let offset = 0;
              const next = () => {
                entries ||= [...rows.values()];
                const record = entries[offset++];
                if (!record) return null;
                return {
                  key: record.updatedAt,
                  primaryKey: record[table.keyPath],
                  continue: () => enqueue(request, next)
                };
              };
              enqueue(request, next);
              return request;
            }
          };
        }
      });
      return transaction;
    }
  };
  harness.open = (name, version) => {
    assert.equal(name, DOCUMENT_HISTORY_DATABASE);
    assert.equal(version, 1);
    harness.opens += 1;
    const request = {};
    queueMicrotask(() => {
      request.result = database;
      if (!tables.size) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  };
  return harness;
}

test('history sorts newest first with deterministic ties without changing input or handles', () => {
  const handle = { kind: 'file', name: 'note.md' };
  const records = [
    { key: 'z', updatedAt: 2, browserFileHandle: handle },
    { key: 'b', updatedAt: 4 },
    { key: 'a', updatedAt: 4 },
    { id: 'untitled', updatedAt: 1 }
  ];
  const snapshot = [...records];
  assert.deepEqual(sortAndLimitHistory(records, 2).map((record) => record.key), ['a', 'b']);
  assert.deepEqual(records, snapshot);
  assert.equal(sortAndLimitHistory(records, 4)[2].browserFileHandle, handle);
  assert.deepEqual(sortAndLimitHistory(records, 0), []);
  assert.throws(() => sortAndLimitHistory(records, -1), TypeError);
});

test('recent records persist across instances, merge positions and are capped at twenty', async () => {
  const indexedDB = indexedDbHarness();
  const history = createDocumentHistory({ indexedDB, now: () => 100 });
  assert.deepEqual(await history.listRecent(), []);
  for (let index = 0; index < 25; index += 1) {
    await history.rememberDocument({ key: `file-${index}`, name: `note-${index}.md`, updatedAt: index });
  }
  assert.equal((await history.listRecent()).length, RECENT_DOCUMENT_LIMIT);
  assert.equal(await history.getRecent('file-0'), null);
  const browserFileHandle = { kind: 'file', name: 'note-24.md', serializable: true };
  await history.rememberDocument({ key: 'file-24', browserFileHandle, mode: 'reader' });
  await history.rememberDocument({ key: 'file-24', position: { progress: 0.7 } });
  const reopened = createDocumentHistory({ indexedDB });
  assert.deepEqual(await reopened.getRecent('file-24'), {
    key: 'file-24', name: 'note-24.md', updatedAt: 100,
    browserFileHandle, mode: 'reader', position: { progress: 0.7 }
  });
  await reopened.forgetRecent('file-24');
  assert.equal(await reopened.getRecent('file-24'), null);
  await reopened.clearRecent();
  assert.deepEqual(await history.listRecent(), []);
});

test('drafts keep full large content and formatting independently from recent records', async () => {
  const indexedDB = indexedDbHarness();
  const history = createDocumentHistory({ indexedDB });
  const content = '会议记录：原文\r\n'.repeat(400_000);
  const textFormat = { lineEnding: '\r\n', hasBom: true };
  for (let index = 0; index < 7; index += 1) {
    await history.saveDraft({ id: `draft-${index}`, content: index === 6 ? content : '', textFormat, updatedAt: index });
  }
  await history.clearRecent();
  const drafts = await history.listDrafts();
  assert.equal(drafts.length, RECOVERY_DRAFT_LIMIT);
  assert.deepEqual(drafts.map((record) => record.id), ['draft-6', 'draft-5', 'draft-4', 'draft-3', 'draft-2']);
  assert.equal(drafts[0].content, content);
  assert.deepEqual(drafts[0].textFormat, textFormat);
  assert.equal(drafts[1].content, '');
  await history.removeDraft('draft-6');
  assert.equal((await history.listDrafts()).length, 4);
});

test('quota and structured clone failures reject without losing earlier drafts', async () => {
  const indexedDB = indexedDbHarness();
  const history = createDocumentHistory({ indexedDB });
  await history.saveDraft({ id: 'draft', content: 'original' });
  indexedDB.quotaExceeded = true;
  await assert.rejects(history.saveDraft({ id: 'draft', content: 'replacement' }), (error) => {
    assert.ok(error instanceof DocumentHistoryError);
    assert.equal(error.cause.name, 'QuotaExceededError');
    return true;
  });
  indexedDB.quotaExceeded = false;
  await assert.rejects(history.saveDraft({ id: 'draft', content: 'bad clone', invalid: () => {} }), DocumentHistoryError);
  assert.equal((await history.listDrafts())[0].content, 'original');
  await history.saveDraft({ id: 'draft', content: 'retry succeeded' });
  assert.equal((await history.listDrafts())[0].content, 'retry succeeded');
});

test('unavailable storage and invalid records fail explicitly', async () => {
  const history = createDocumentHistory({ indexedDB: null });
  await assert.rejects(history.listRecent(), DocumentHistoryError);
  await assert.rejects(history.listDrafts(), /IndexedDB/);
  await assert.rejects(history.rememberDocument({ key: '' }), TypeError);
  await assert.rejects(history.saveDraft({ id: 'draft', content: null }), TypeError);
  await assert.rejects(history.saveDraft({ id: 'draft', content: '', updatedAt: NaN }), TypeError);
  await assert.rejects(history.getRecent(undefined), TypeError);
});

test('an open failure can be retried and never silently discards the operation', async () => {
  const available = indexedDbHarness();
  let failNext = true;
  const indexedDB = {
    open(...args) {
      if (failNext) {
        failNext = false;
        throw new Error('Temporary storage failure');
      }
      return available.open(...args);
    }
  };
  const history = createDocumentHistory({ indexedDB });
  await assert.rejects(history.rememberDocument({ key: 'note' }), /Temporary storage failure/);
  await history.rememberDocument({ key: 'note' });
  assert.equal((await history.listRecent())[0].key, 'note');
});
