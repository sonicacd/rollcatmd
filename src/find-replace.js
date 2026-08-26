function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function decodeFindReplaceEscapes(value) {
  return value.replace(/\\([nrt\\])/g, (_, escape) => {
    switch (escape) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      default:
        return '\\';
    }
  });
}

export function buildMappedTextBlocks(blocks) {
  const spans = [];
  let text = '';
  let previousBlock = null;

  blocks.forEach((block) => {
    if (previousBlock !== null) {
      text += '\n';
      spans.push({
        from: previousBlock.to,
        to: block.from,
        separator: true,
        replaceable: previousBlock.parent === block.parent
      });
    }

    block.segments.forEach((segment) => {
      text += segment.text;

      for (let index = 0; index < segment.text.length; index += 1) {
        spans.push({
          from: segment.from + index,
          to: segment.from + index + 1,
          separator: false,
          replaceable: segment.replaceable !== false
        });
      }
    });

    previousBlock = block;
  });

  return { text, spans };
}

export function mappedTextRange(spans, from, to) {
  const first = spans[from];
  const last = spans[to - 1];

  return first && last ? [first.from, last.to] : null;
}

export function mappedTextOffsetAtPosition(spans, position) {
  const target = Math.max(0, Number(position) || 0);
  let offset = 0;

  while (offset < spans.length && spans[offset].to <= target) {
    offset += 1;
  }

  return offset;
}

export function findTextMatches(text, query, { caseSensitive = false } = {}) {
  const decodedQuery = decodeFindReplaceEscapes(query);

  if (!decodedQuery) {
    return [];
  }

  const flags = caseSensitive ? 'gu' : 'giu';
  const pattern = new RegExp(escapeRegExp(decodedQuery), flags);

  return Array.from(text.matchAll(pattern), (match) => ({
    from: match.index,
    to: match.index + match[0].length
  }));
}

export function findMatchIndex(matches, offset = 0, direction = 1) {
  if (!matches.length) {
    return -1;
  }

  const anchor = Math.max(0, Number(offset) || 0);

  if (direction < 0) {
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      if (matches[index].to <= anchor) {
        return index;
      }
    }

    return matches.length - 1;
  }

  const index = matches.findIndex((match) => match.from >= anchor);
  return index === -1 ? 0 : index;
}

export function replaceAllText(text, matches, replacement) {
  if (!matches.length) {
    return text;
  }

  const decodedReplacement = decodeFindReplaceEscapes(replacement);
  const parts = [];
  let offset = 0;

  matches.forEach((match) => {
    parts.push(text.slice(offset, match.from), decodedReplacement);
    offset = match.to;
  });
  parts.push(text.slice(offset));

  return parts.join('');
}

export function offsetToMarkdownPosition(text, offset) {
  const target = Math.max(0, Math.min(Number(offset) || 0, text.length));
  let line = 1;
  let lineStart = 0;

  for (let index = 0; index < target; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }

  return [line, target - lineStart + 1];
}
