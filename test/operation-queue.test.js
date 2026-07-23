import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySaveResult,
  createSnapshotTaskQueue,
  getSaveCoalesceKey,
  isOpenRequestCurrent,
  materializeTextSnapshot,
  matchesDocumentRevision
} from '../src/operation-queue.js';

test('captures queued work immediately while executing tasks serially', async () => {
  let currentDocument = 'A';
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const started = [];
  const enqueue = createSnapshotTaskQueue(
    () => currentDocument,
    async (snapshot) => {
      started.push(snapshot);
      if (snapshot === 'A') {
        await firstGate;
      }
      return snapshot;
    }
  );

  const first = enqueue();
  await Promise.resolve();
  currentDocument = 'B';
  const second = enqueue();
  currentDocument = 'C';
  releaseFirst();

  assert.equal(await first, 'A');
  assert.equal(await second, 'B');
  assert.deepEqual(started, ['A', 'B']);
});

test('continues after a failed queued task', async () => {
  const enqueue = createSnapshotTaskQueue(
    (value) => value,
    async (snapshot) => {
      if (snapshot === 'bad') {
        throw new Error('failed');
      }
      return snapshot;
    }
  );

  await assert.rejects(enqueue('bad'), /failed/);
  assert.equal(await enqueue('good'), 'good');
});

test('coalesces repeated pending snapshots without retaining one task per key', async () => {
  let releaseTask;
  const gate = new Promise((resolve) => {
    releaseTask = resolve;
  });
  let runCount = 0;
  const sharedDocument = Object.freeze({ id: 'immutable-text' });
  const enqueue = createSnapshotTaskQueue(
    () => ({ documentId: 8, revision: 21, documentText: sharedDocument }),
    async (snapshot) => {
      runCount += 1;
      await gate;
      return snapshot.documentText;
    },
    {
      getCoalesceKey: (snapshot) => `${snapshot.documentId}:${snapshot.revision}`
    }
  );

  const first = enqueue();
  const repeated = Array.from({ length: 10_000 }, () => enqueue());

  assert.equal(repeated.every((operation) => operation === first), true);
  await Promise.resolve();
  assert.equal(runCount, 1);
  releaseTask();
  assert.equal(await first, sharedDocument);
});

test('separates save coalescing by document, revision, and save-as intent', () => {
  const snapshot = { documentId: 8, revision: 21 };
  const normalKey = getSaveCoalesceKey(snapshot, false);

  assert.equal(normalKey, getSaveCoalesceKey(snapshot, false));
  assert.notEqual(normalKey, getSaveCoalesceKey(snapshot, true));
  assert.notEqual(normalKey, getSaveCoalesceKey({ documentId: 9, revision: 21 }, false));
  assert.notEqual(normalKey, getSaveCoalesceKey({ documentId: 8, revision: 22 }, false));
});

test('materializes immutable document text only when the queued task executes', async () => {
  let toStringCount = 0;
  const documentText = {
    toString() {
      toStringCount += 1;
      return 'snapshot content';
    }
  };
  let releaseTask;
  const gate = new Promise((resolve) => {
    releaseTask = resolve;
  });
  const enqueue = createSnapshotTaskQueue(
    (snapshot) => snapshot,
    async (snapshot) => {
      await gate;
      return materializeTextSnapshot(snapshot, (content) => `saved:${content}`);
    }
  );
  const operation = enqueue({ documentText, serializedContent: null, textFormat: {} });

  await Promise.resolve();
  assert.equal(toStringCount, 0);
  releaseTask();
  assert.deepEqual(await operation, {
    content: 'snapshot content',
    serializedContent: 'saved:snapshot content'
  });
  assert.equal(toStringCount, 1);
});

test('reuses an unchanged original serialization without normalizing it again', () => {
  let serializeCount = 0;
  const materialized = materializeTextSnapshot({
    content: 'one\ntwo\nthree',
    documentText: null,
    serializedContent: 'one\r\ntwo\nthree',
    textFormat: { lineEnding: '\r\n' }
  }, () => {
    serializeCount += 1;
    return 'unexpected';
  });

  assert.equal(materialized.serializedContent, 'one\r\ntwo\nthree');
  assert.equal(serializeCount, 0);
});

test('does not classify a browser download fallback as a confirmed save', () => {
  assert.equal(classifySaveResult({ canceled: true }), 'canceled');
  assert.equal(
    classifySaveResult({ canceled: false, unconfirmedExport: true }),
    'unconfirmed-export'
  );
  assert.equal(classifySaveResult({ canceled: false, filePath: 'note.md' }), 'confirmed');
});

test('rejects stale open results after a newer request, edit, or document replacement', () => {
  const request = { requestId: 4, documentId: 7, revision: 2 };

  assert.equal(isOpenRequestCurrent(request, {
    openRequestId: 4,
    documentId: 7,
    revision: 2
  }), true);
  assert.equal(isOpenRequestCurrent(request, {
    openRequestId: 5,
    documentId: 7,
    revision: 2
  }), false);
  assert.equal(isOpenRequestCurrent(request, {
    openRequestId: 4,
    documentId: 7,
    revision: 3
  }), false);
  assert.equal(isOpenRequestCurrent(request, {
    openRequestId: 4,
    documentId: 8,
    revision: 2
  }), false);
});

test('only clears dirty state when the saved revision is still current', () => {
  const saved = { documentId: 3, revision: 10 };

  assert.equal(matchesDocumentRevision(saved, { documentId: 3, revision: 10 }), true);
  assert.equal(matchesDocumentRevision(saved, { documentId: 3, revision: 11 }), false);
  assert.equal(matchesDocumentRevision(saved, { documentId: 4, revision: 10 }), false);
});
