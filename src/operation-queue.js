export function createSnapshotTaskQueue(
  captureSnapshot,
  runTask,
  { getCoalesceKey = null } = {}
) {
  let tail = Promise.resolve();
  const pendingByKey = new Map();

  return (...args) => {
    // Capture synchronously, before any earlier task has completed. This is
    // essential for UI actions whose surrounding document may later change.
    const snapshot = captureSnapshot(...args);
    const coalesceKey = getCoalesceKey?.(snapshot, ...args);

    if (coalesceKey !== null && coalesceKey !== undefined) {
      const pending = pendingByKey.get(coalesceKey);

      if (pending) {
        return pending;
      }
    }

    const operation = tail.then(() => runTask(snapshot, ...args));
    tail = operation.catch(() => {});

    if (coalesceKey !== null && coalesceKey !== undefined) {
      pendingByKey.set(coalesceKey, operation);
      const clearPending = () => {
        if (pendingByKey.get(coalesceKey) === operation) {
          pendingByKey.delete(coalesceKey);
        }
      };
      operation.then(clearPending, clearPending);
    }

    return operation;
  };
}

export function materializeTextSnapshot(snapshot, serializeText) {
  const content = snapshot.documentText
    ? snapshot.documentText.toString()
    : snapshot.content;

  return {
    content,
    serializedContent: snapshot.serializedContent ?? serializeText(
      content,
      snapshot.textFormat
    )
  };
}

export function classifySaveResult(result) {
  if (result?.canceled) {
    return 'canceled';
  }

  if (result?.unconfirmedExport) {
    return 'unconfirmed-export';
  }

  return 'confirmed';
}

export function getSaveCoalesceKey(snapshot, saveAs) {
  return `save:${snapshot.documentId}:${snapshot.revision}:${Boolean(saveAs)}`;
}

export function matchesDocumentRevision(snapshot, current) {
  return (
    snapshot.documentId === current.documentId &&
    snapshot.revision === current.revision
  );
}

export function isOpenRequestCurrent(request, current) {
  return (
    request.requestId === current.openRequestId &&
    matchesDocumentRevision(request, current)
  );
}
