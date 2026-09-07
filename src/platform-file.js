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

  const path = String(filePath);
  if (!isUriBackedFilePath(path)) {
    // Desktop paths may contain a verbatim Windows prefix (\\?\), literal
    // percent signs or # characters. They have no URI query or escaping rules.
    return path.replace(/^[a-z]:/i, '').split(/[\\/]/).filter(Boolean).at(-1) || fallback;
  }

  // Remove the URI's real query/fragment before decoding escaped filename
  // characters such as %23 and %3F, which belong to the displayed filename.
  let decodedPath = path.split(/[?#]/, 1)[0];

  try {
    decodedPath = decodeURIComponent(decodedPath);
  } catch {
    // Keep malformed percent-encoded provider paths readable instead of
    // letting a cosmetic filename failure interrupt document handling.
  }

  const segments = decodedPath.split(/[\\/:]/).filter(Boolean);
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
