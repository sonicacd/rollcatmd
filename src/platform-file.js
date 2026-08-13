const URI_BACKED_FILE_PATTERN = /^(?:content|file):\/\//i;

export function isUriBackedFilePath(filePath) {
  return typeof filePath === 'string' && URI_BACKED_FILE_PATTERN.test(filePath);
}

export function canOverwriteOpenedFile(filePath) {
  return Boolean(filePath) && !isUriBackedFilePath(filePath);
}

export function getFileDisplayName(filePath, fallback = '未命名.md') {
  if (!filePath) {
    return fallback;
  }

  let decodedPath = String(filePath);

  try {
    decodedPath = decodeURIComponent(decodedPath);
  } catch {
    // Keep malformed percent-encoded provider paths readable instead of
    // letting a cosmetic filename failure interrupt document handling.
  }

  const withoutQuery = decodedPath.split(/[?#]/, 1)[0];
  const segments = withoutQuery.split(/[\\/:]/).filter(Boolean);
  return segments.at(-1) || fallback;
}

export async function writeNativeDocument({
  filePath,
  content,
  writeFile,
  invoke
}) {
  if (isUriBackedFilePath(filePath)) {
    await writeFile(filePath, new TextEncoder().encode(content));
    return 'document-uri';
  }

  await invoke('write_text_file_atomic', { path: filePath, content });
  return 'atomic-path';
}
