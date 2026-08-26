const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdown',
  'mkd',
  'txt'
]);

export function isSupportedDroppedFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return false;
  }

  const fileName = filePath.split(/[\\/]/).at(-1) || '';
  const extensionSeparator = fileName.lastIndexOf('.');

  if (extensionSeparator <= 0 || extensionSeparator === fileName.length - 1) {
    return false;
  }

  return SUPPORTED_DOCUMENT_EXTENSIONS.has(
    fileName.slice(extensionSeparator + 1).toLowerCase()
  );
}

export function selectDroppedDocumentPath(paths) {
  if (!Array.isArray(paths)) {
    return null;
  }

  return paths.find(isSupportedDroppedFilePath) || null;
}

/**
 * Creates a handler for Tauri's `onDragDropEvent` API. Only completed drops
 * are handled; enter/over/leave events must not trigger document reads.
 *
 * Tauri does not await event-listener return values, so errors from async drop
 * work are caught here and forwarded explicitly instead of becoming unhandled
 * promise rejections.
 */
export function createNativeFileDropHandler({
  onFileDrop,
  onUnsupportedDrop = () => {},
  onError = () => {}
}) {
  if (typeof onFileDrop !== 'function') {
    throw new TypeError('onFileDrop must be a function');
  }

  return (event) => {
    if (event?.payload?.type !== 'drop') {
      return undefined;
    }

    const paths = Array.isArray(event.payload.paths) ? event.payload.paths : [];
    const filePath = selectDroppedDocumentPath(paths);
    const operation = filePath
      ? Promise.resolve().then(() => onFileDrop(filePath, paths))
      : Promise.resolve().then(() => onUnsupportedDrop(paths));

    return operation.catch((error) => onError(error, { filePath, paths }));
  };
}

export function registerNativeFileDrop(tauriWindow, callbacks) {
  if (typeof tauriWindow?.onDragDropEvent !== 'function') {
    throw new TypeError('tauriWindow.onDragDropEvent must be a function');
  }

  return tauriWindow.onDragDropEvent(createNativeFileDropHandler(callbacks));
}
