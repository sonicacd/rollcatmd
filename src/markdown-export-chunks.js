export const MARKDOWN_EXPORT_CHUNK_CHARACTERS = 16 * 1024;
export const MAX_MARKDOWN_EXPORT_BLOCK_CHARACTERS = 64 * 1024;

const referenceDefinitionPattern = /^ {0,3}\[([^\]]+)\]:\s*(\S+)(?:\s+.*)?$/;
const fencePattern = /^ {0,3}(`{3,}|~{3,})/;
const rawHtmlStartPattern = /^ {0,3}<(pre|script|style|textarea|div|table|section|article)(?:\s|>)/i;
const rawHtmlCommentPattern = /^ {0,3}<!--/;
const tableDelimiterPattern = /^ {0,3}\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export function abortError() {
  return new DOMException('\u5df2\u53d6\u6d88\u56fe\u7247\u5bfc\u51fa', 'AbortError');
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : abortError();
  }
}

export function yieldToMainThread() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function shouldYield(startedAt) {
  const now = globalThis.performance?.now?.() ?? Date.now();
  return now - startedAt >= 12;
}

export async function inspectMarkdownForExport(lineSource, { signal, onProgress } = {}) {
  const definitions = [];
  let definitionCharacters = 0;
  let totalCharacters = 0;
  let sliceStarted = globalThis.performance?.now?.() ?? Date.now();

  for (let lineNumber = 1; lineNumber <= lineSource.lineCount; lineNumber += 1) {
    throwIfAborted(signal);
    const line = String(lineSource.getLine(lineNumber));
    totalCharacters += line.length + (lineNumber < lineSource.lineCount ? 1 : 0);
    const match = referenceDefinitionPattern.exec(line);
    if (match && definitionCharacters + line.length + 1 <= MAX_MARKDOWN_EXPORT_BLOCK_CHARACTERS) {
      definitions.push(line);
      definitionCharacters += line.length + 1;
    }

    if (shouldYield(sliceStarted)) {
      onProgress?.({
        phase: 'parsing',
        completed: totalCharacters,
        total: Math.max(1, lineSource.length || totalCharacters),
        pageCount: 0
      });
      await yieldToMainThread();
      sliceStarted = globalThis.performance?.now?.() ?? Date.now();
    }
  }

  return {
    definitions: definitions.join('\n'),
    totalCharacters: Math.max(1, totalCharacters)
  };
}

function fenceForLine(line, currentFence) {
  const match = fencePattern.exec(line);
  if (!match) {
    return currentFence;
  }
  const marker = match[1];
  if (!currentFence) {
    return { character: marker[0], length: marker.length, opening: line };
  }
  if (marker[0] === currentFence.character && marker.length >= currentFence.length) {
    return null;
  }
  return currentFence;
}

function rawHtmlStateForLine(line, current) {
  if (current?.type === 'comment') {
    return line.includes('-->') ? null : current;
  }
  if (current?.tag) {
    return new RegExp(`</${current.tag}\\s*>`, 'i').test(line) ? null : current;
  }
  if (rawHtmlCommentPattern.test(line) && !line.includes('-->')) {
    return { type: 'comment' };
  }
  const match = rawHtmlStartPattern.exec(line);
  if (match && !new RegExp(`</${match[1]}\\s*>`, 'i').test(line)) {
    return { tag: match[1].toLowerCase() };
  }
  return null;
}

function withDefinitions(markdown, definitions) {
  if (!definitions) {
    return markdown;
  }
  return `${markdown}\n\n${definitions}`;
}

/**
 * Produces bounded Markdown batches without materializing the complete source.
 * Fenced code is closed/reopened at a hard boundary; raw HTML is never split.
 */
export async function* iterateMarkdownExportChunks(lineSource, {
  definitions = '',
  totalCharacters,
  signal,
  onProgress,
  targetCharacters = MARKDOWN_EXPORT_CHUNK_CHARACTERS,
  maximumBlockCharacters = MAX_MARKDOWN_EXPORT_BLOCK_CHARACTERS
} = {}) {
  let lines = [];
  let chunkCharacters = 0;
  let consumedCharacters = 0;
  let chunkStart = 0;
  let fence = null;
  let rawHtml = null;
  let rawHtmlCharacters = 0;
  let tableHeader = null;
  let previousLine = '';
  let sliceStarted = globalThis.performance?.now?.() ?? Date.now();

  const makeChunk = (end, suffix = '') => {
    const source = `${lines.join('\n')}${suffix}`;
    const chunk = {
      markdown: withDefinitions(source, definitions),
      sourceStart: chunkStart,
      sourceEnd: end,
      sourceCharacters: source.length
    };
    lines = [];
    chunkCharacters = 0;
    chunkStart = end;
    return chunk;
  };

  for (let lineNumber = 1; lineNumber <= lineSource.lineCount; lineNumber += 1) {
    throwIfAborted(signal);
    let line = String(lineSource.getLine(lineNumber));
    const newlineCharacters = lineNumber < lineSource.lineCount ? 1 : 0;
    const startsRawHtml = !fence && !rawHtml
      && (rawHtmlStartPattern.test(line) || rawHtmlCommentPattern.test(line));

    if (!fence && !rawHtml && line.length > maximumBlockCharacters) {
      if (startsRawHtml) {
        throw new Error('\u5355\u4e2a HTML \u5757\u8d85\u8fc7 64 KiB\uff0c\u8bf7\u62c6\u5206\u540e\u518d\u5bfc\u51fa');
      }
      if (lines.length) {
        yield makeChunk(consumedCharacters);
      }
      for (let offset = 0; offset < line.length; offset += maximumBlockCharacters) {
        throwIfAborted(signal);
        const piece = line.slice(offset, offset + maximumBlockCharacters);
        const end = consumedCharacters + offset + piece.length;
        yield {
          markdown: withDefinitions(piece, definitions),
          sourceStart: consumedCharacters + offset,
          sourceEnd: end,
          sourceCharacters: piece.length
        };
        await yieldToMainThread();
      }
      consumedCharacters += line.length + newlineCharacters;
      chunkStart = consumedCharacters;
      continue;
    }

    const previousFence = fence;
    const previousRawHtml = rawHtml;
    fence = fenceForLine(line, fence);
    rawHtml = rawHtmlStateForLine(line, rawHtml);
    if (previousRawHtml || rawHtml || startsRawHtml) {
      rawHtmlCharacters += line.length + 1;
      if (rawHtmlCharacters > maximumBlockCharacters) {
        throw new Error('\u5355\u4e2a HTML \u5757\u8d85\u8fc7 64 KiB\uff0c\u8bf7\u62c6\u5206\u540e\u518d\u5bfc\u51fa');
      }
    }
    if (!rawHtml) {
      rawHtmlCharacters = 0;
    }
    if (fence || rawHtml) {
      tableHeader = null;
    } else if (tableDelimiterPattern.test(line) && previousLine.trim().includes('|')) {
      tableHeader = [previousLine, line];
    } else if (tableHeader && (!line.trim() || !line.includes('|'))) {
      tableHeader = null;
    }

    lines.push(line);
    chunkCharacters += line.length + newlineCharacters;
    consumedCharacters += line.length + newlineCharacters;

    const atBlankBoundary = !line.trim() && !fence && !rawHtml;
    if (chunkCharacters >= targetCharacters && atBlankBoundary) {
      yield makeChunk(consumedCharacters);
    } else if (chunkCharacters >= maximumBlockCharacters && !rawHtml) {
      if (fence) {
        yield makeChunk(consumedCharacters, `\n${fence.character.repeat(fence.length)}`);
        lines.push(fence.opening);
        chunkCharacters = fence.opening.length + 1;
        chunkStart = consumedCharacters;
      } else {
        const continuation = tableHeader ? [...tableHeader] : [];
        yield makeChunk(consumedCharacters);
        if (continuation.length) {
          lines.push(...continuation);
          chunkCharacters = continuation.reduce((count, value) => count + value.length + 1, 0);
          chunkStart = consumedCharacters;
        }
      }
    }

    if (shouldYield(sliceStarted)) {
      onProgress?.({
        phase: 'parsing',
        completed: Math.min(consumedCharacters, totalCharacters || consumedCharacters),
        total: totalCharacters || consumedCharacters,
        pageCount: 0
      });
      await yieldToMainThread();
      sliceStarted = globalThis.performance?.now?.() ?? Date.now();
    }

    // A closing fence belongs to the chunk it closes; this keeps the next
    // chunk from inheriting a stale opening marker.
    if (previousFence && !fence && chunkCharacters >= targetCharacters) {
      yield makeChunk(consumedCharacters);
    }
    previousLine = line;
  }

  if (lines.length || lineSource.lineCount === 0) {
    yield makeChunk(consumedCharacters);
  }
}
