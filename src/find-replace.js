function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findTextMatches(text, query, { caseSensitive = false } = {}) {
  if (!query) {
    return [];
  }

  const flags = caseSensitive ? 'gu' : 'giu';
  const pattern = new RegExp(escapeRegExp(query), flags);

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

  const parts = [];
  let offset = 0;

  matches.forEach((match) => {
    parts.push(text.slice(offset, match.from), replacement);
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
