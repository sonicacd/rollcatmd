export const DOCUMENT_HISTORY_DATABASE = 'rollcat-md.document-history';
export const RECENT_DOCUMENT_LIMIT = 20;
export const RECOVERY_DRAFT_LIMIT = 5;

/** Return a new array; the original records (including file handles) stay intact. */
export function sortAndLimitHistory(records, limit = RECENT_DOCUMENT_LIMIT) {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new TypeError('历史记录数量必须是非负整数');
  }

  return [...records].sort((left, right) => {
    const difference = historyTimestamp(right) - historyTimestamp(left);
    if (difference) return difference;
    const leftKey = String(left.key ?? left.id ?? '');
    const rightKey = String(right.key ?? right.id ?? '');
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  }).slice(0, limit);
}

function historyTimestamp(record) {
  return Number.isFinite(record.updatedAt) ? record.updatedAt : 0;
}

export class DocumentHistoryError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'DocumentHistoryError';
  }
}

function storageError(error, action = '读写本地记录失败') {
  if (error instanceof DocumentHistoryError) return error;
  return new DocumentHistoryError(`${action}：${error?.message || error || '存储不可用'}`, error);
}

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label}必须是非空字符串`);
  }
  return value;
}

/**
 * All methods reject on unavailable storage, quota failures or clone failures.
 * FileSystemFileHandle objects are stored by IndexedDB structured cloning.
 * Draft content is retained in full; callers control when snapshots are taken.
 */
export function createDocumentHistory({ indexedDB, now = Date.now } = {}) {
  let databasePromise = null;

  function openDatabase() {
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
      let factory;
      try {
        factory = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
        if (!factory?.open) throw new Error('当前环境不支持 IndexedDB');
      } catch (error) {
        reject(storageError(error, '无法打开本地记录'));
        return;
      }

      let request;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(storageError(error, '无法打开本地记录'));
      };

      try {
        request = factory.open(DOCUMENT_HISTORY_DATABASE, 1);
      } catch (error) {
        fail(error);
        return;
      }

      request.onupgradeneeded = () => {
        try {
          for (const [name, keyPath] of [['recent', 'key'], ['drafts', 'id']]) {
            const objectStore = request.result.objectStoreNames.contains(name)
              ? request.transaction.objectStore(name)
              : request.result.createObjectStore(name, { keyPath });
            if (!objectStore.indexNames.contains('updatedAt')) {
              objectStore.createIndex('updatedAt', 'updatedAt');
            }
          }
        } catch (error) {
          try { request.transaction.abort(); } catch { /* Already aborted. */ }
          fail(error);
        }
      };
      request.onblocked = () => fail(new Error('记录数据库正在升级，请关闭其他滚猫md窗口后重试'));
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        database.onclose = () => { databasePromise = null; };
        resolve(database);
      };
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });

    return databasePromise;
  }

  async function transaction(storeName, mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      let activeTransaction;
      try {
        activeTransaction = database.transaction(storeName, mode);
      } catch (error) {
        reject(storageError(error));
        return;
      }

      let value;
      let failure;
      const fail = (error) => {
        failure = error;
        try {
          activeTransaction.abort();
        } catch {
          reject(storageError(error));
        }
      };
      const guard = (callback) => (...args) => {
        try { callback(...args); } catch (error) { fail(error); }
      };

      activeTransaction.oncomplete = () => resolve(value);
      activeTransaction.onerror = (event) => {
        failure ||= event.target?.error || activeTransaction.error;
      };
      activeTransaction.onabort = () => reject(storageError(failure || activeTransaction.error));
      guard(operation)(activeTransaction.objectStore(storeName), (result) => { value = result; }, guard);
    });
  }

  function pruneStore(store, limit, complete, guard) {
    // Key cursors avoid materializing every draft's full text just to trim it.
    const records = [];
    const request = store.index('updatedAt').openKeyCursor();
    request.onsuccess = guard(() => {
      const cursor = request.result;
      if (cursor) {
        records.push({ key: cursor.primaryKey, updatedAt: cursor.key });
        cursor.continue();
        return;
      }
      const keptKeys = new Set(sortAndLimitHistory(records, limit).map((record) => record.key));
      for (const record of records) {
        if (!keptKeys.has(record.key)) store.delete(record.key);
      }
      complete();
    });
  }

  async function list(storeName, limit) {
    return transaction(storeName, 'readonly', (store, setResult, guard) => {
      const request = store.getAll();
      request.onsuccess = guard(() => setResult(sortAndLimitHistory(request.result, limit)));
    });
  }

  async function upsert(storeName, identifier, record, limit) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('文档记录必须是对象');
    }
    const key = requireIdentifier(record[identifier], identifier);
    const updatedAt = record.updatedAt ?? now();
    if (!Number.isFinite(updatedAt) || updatedAt < 0) {
      throw new TypeError('记录时间必须是有效的毫秒时间戳');
    }
    // Capture the supplied fields before the asynchronous database open.
    const incoming = { ...record, updatedAt };
    return transaction(storeName, 'readwrite', (store, setResult, guard) => {
      const request = store.get(key);
      request.onsuccess = guard(() => {
        const stored = { ...request.result, ...incoming };
        store.put(stored);
        pruneStore(store, limit, () => setResult(stored), guard);
      });
    });
  }

  return {
    async listRecent() {
      return list('recent', RECENT_DOCUMENT_LIMIT);
    },
    async rememberDocument(record) {
      return upsert('recent', 'key', record, RECENT_DOCUMENT_LIMIT);
    },
    async getRecent(key) {
      requireIdentifier(key, 'key');
      return transaction('recent', 'readonly', (store, setResult, guard) => {
        const request = store.get(key);
        request.onsuccess = guard(() => setResult(request.result ?? null));
      });
    },
    async forgetRecent(key) {
      requireIdentifier(key, 'key');
      return transaction('recent', 'readwrite', (store) => { store.delete(key); });
    },
    async clearRecent() {
      return transaction('recent', 'readwrite', (store) => { store.clear(); });
    },
    async saveDraft(record) {
      if (typeof record?.content !== 'string') {
        throw new TypeError('恢复草稿必须包含完整的文本内容');
      }
      return upsert('drafts', 'id', record, RECOVERY_DRAFT_LIMIT);
    },
    async listDrafts() {
      return list('drafts', RECOVERY_DRAFT_LIMIT);
    },
    async removeDraft(id) {
      requireIdentifier(id, 'id');
      return transaction('drafts', 'readwrite', (store) => { store.delete(id); });
    }
  };
}
