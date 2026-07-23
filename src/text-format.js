const UTF8_BOM = [0xef, 0xbb, 0xbf];

export function utf8ByteLengthInChunks(chunks) {
  let byteLength = 0;
  let pendingHighSurrogate = false;

  for (const text of chunks) {
    let index = 0;

    if (pendingHighSurrogate && text.length > 0) {
      const firstCode = text.charCodeAt(0);

      if (firstCode >= 0xdc00 && firstCode <= 0xdfff) {
        byteLength += 4;
        index = 1;
      } else {
        byteLength += 3;
      }

      pendingHighSurrogate = false;
    }

    for (; index < text.length; index += 1) {
      const code = text.charCodeAt(index);

      if (code <= 0x7f) {
        byteLength += 1;
      } else if (code <= 0x7ff) {
        byteLength += 2;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        if (index + 1 >= text.length) {
          pendingHighSurrogate = true;
          continue;
        }

        const nextCode = text.charCodeAt(index + 1);

        if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
          byteLength += 4;
          index += 1;
        } else {
          byteLength += 3;
        }
      } else {
        byteLength += 3;
      }
    }
  }

  if (pendingHighSurrogate) {
    byteLength += 3;
  }

  return byteLength;
}

export function utf8ByteLength(text) {
  return utf8ByteLengthInChunks([text]);
}

export function detectLineEnding(text) {
  let crlfCount = 0;
  let lfCount = 0;
  let crCount = 0;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (code === 0x0d) {
      if (text.charCodeAt(index + 1) === 0x0a) {
        crlfCount += 1;
        index += 1;
      } else {
        crCount += 1;
      }
    } else if (code === 0x0a) {
      lfCount += 1;
    }
  }

  if (crlfCount >= lfCount && crlfCount >= crCount && crlfCount > 0) {
    return '\r\n';
  }

  if (crCount > lfCount) {
    return '\r';
  }

  return '\n';
}

export function normalizeEditorText(text) {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

export function decodeUtf8Document(input, { preserveOriginal = true } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const hasBom =
    bytes.length >= UTF8_BOM.length &&
    UTF8_BOM.every((byte, index) => bytes[index] === byte);

  let decoded;

  try {
    // The leading BOM is handled explicitly so a second U+FEFF that belongs
    // to the actual document content is not silently stripped by TextDecoder.
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      hasBom ? bytes.subarray(UTF8_BOM.length) : bytes
    );
  } catch {
    throw new TypeError('文件不是有效的 UTF-8 文本；为防止内容损坏，已停止打开。');
  }

  return {
    content: normalizeEditorText(decoded),
    lineEnding: detectLineEnding(decoded),
    hasBom,
    originalSerializedContent: preserveOriginal
      ? `${hasBom ? '\uFEFF' : ''}${decoded}`
      : null
  };
}

export function serializeTextDocument(content, { lineEnding = '\n', hasBom = false } = {}) {
  const normalized = normalizeEditorText(content);
  const withOriginalLineEndings = lineEnding === '\n'
    ? normalized
    : normalized.replace(/\n/g, lineEnding);

  return `${hasBom ? '\uFEFF' : ''}${withOriginalLineEndings}`;
}

export function markdownPositionToOffset(text, position) {
  if (!Array.isArray(position)) {
    return 0;
  }

  const targetLine = Math.max(1, Number(position[0]) || 1);
  const targetColumn = Math.max(1, Number(position[1]) || 1);
  let offset = 0;
  let line = 1;

  while (line < targetLine && offset < text.length) {
    const nextLine = text.indexOf('\n', offset);

    if (nextLine === -1) {
      return text.length;
    }

    offset = nextLine + 1;
    line += 1;
  }

  const lineEnd = text.indexOf('\n', offset);
  const maximumOffset = lineEnd === -1 ? text.length : lineEnd;
  return Math.min(offset + targetColumn - 1, maximumOffset);
}

export function projectedUtf8ByteLength(text, start, end, insertion) {
  const from = Math.max(0, Math.min(start, end, text.length));
  const to = Math.max(from, Math.min(Math.max(start, end), text.length));
  return (
    utf8ByteLength(text) -
    utf8ByteLength(text.slice(from, to)) +
    utf8ByteLength(insertion)
  );
}
