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
  const matched = spans.slice(from, to);
  const first = matched[0];
  const last = matched[matched.length - 1];

  if (!first || !last || matched.some((span) => span.replaceable === false)) {
    return null;
  }

  // Reader-mode spans carry leaf/token metadata. A replacement must stay
  // inside one AST literal: otherwise the raw range between its endpoints can
  // contain Markdown delimiters, link destinations, or inline HTML tags.
  if (first.leafId !== undefined) {
    if (matched.some((span) => span.leafId !== first.leafId)) {
      return null;
    }

    for (let index = 1; index < matched.length; index += 1) {
      const previous = matched[index - 1];
      const current = matched[index];
      const sameToken = previous.tokenId === current.tokenId;

      if (!sameToken && previous.to !== current.from) {
        return null;
      }
    }

    if (
      (spans[from - 1]?.tokenId && spans[from - 1].tokenId === first.tokenId) ||
      (spans[to]?.tokenId && spans[to].tokenId === last.tokenId)
    ) {
      return null;
    }
  }

  return [first.from, last.to];
}

export function mappedTextOffsetAtPosition(spans, position) {
  const target = Math.max(0, Number(position) || 0);
  let offset = 0;

  while (offset < spans.length && spans[offset].to <= target) {
    offset += 1;
  }

  return offset;
}

export function mappedTextNodeId(spans, from, to) {
  const nodeIds = new Set(
    spans
      .slice(from, to)
      .map((span) => span.nodeId)
      .filter((nodeId) => nodeId !== null && nodeId !== undefined)
  );

  return nodeIds.size === 1 ? [...nodeIds][0] : null;
}

function markdownLineStarts(markdown) {
  const starts = [0];

  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }

  return starts;
}

function markdownSourceOffset(lineStarts, position, markdownLength) {
  const line = Math.max(1, Number(position?.[0]) || 1);
  const column = Math.max(1, Number(position?.[1]) || 1);
  const lineStart = lineStarts[Math.min(line - 1, lineStarts.length - 1)] ?? 0;

  return Math.min(markdownLength, lineStart + column - 1);
}

function decodeSourceEntity(entity) {
  const numeric = entity.match(/^&#(x[\da-f]+|\d+);$/i);

  if (numeric) {
    const value = numeric[1].toLowerCase().startsWith('x')
      ? Number.parseInt(numeric[1].slice(1), 16)
      : Number.parseInt(numeric[1], 10);

    if (Number.isFinite(value) && value >= 0 && value <= 0x10FFFF) {
      return String.fromCodePoint(value);
    }
  }

  const commonEntities = {
    '&amp;': '&',
    '&apos;': "'",
    '&gt;': '>',
    '&lt;': '<',
    '&nbsp;': '\u00A0',
    '&quot;': '"'
  };

  if (commonEntities[entity]) {
    return commonEntities[entity];
  }

  if (typeof document !== 'undefined') {
    const decoder = document.createElement('textarea');
    decoder.innerHTML = entity;
    return decoder.value;
  }

  return entity;
}

function decodeMarkdownSourceSpans(source, sourceStart) {
  const text = [];
  const spans = [];
  let index = 0;

  while (index < source.length) {
    if (source[index] === '\\' && index + 1 < source.length) {
      text.push(source[index + 1]);
      spans.push({
        from: sourceStart + index,
        to: sourceStart + index + 2,
        tokenId: `${sourceStart + index}:${sourceStart + index + 2}`
      });
      index += 2;
      continue;
    }

    if (source[index] === '&') {
      const entity = source.slice(index).match(/^&(?:#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/i)?.[0];

      if (entity) {
        const decoded = decodeSourceEntity(entity);

        if (decoded !== entity) {
          const from = sourceStart + index;
          const to = from + entity.length;

          for (let offset = 0; offset < decoded.length; offset += 1) {
            text.push(decoded[offset]);
            spans.push({ from, to, tokenId: `${from}:${to}` });
          }
          index += entity.length;
          continue;
        }
      }
    }

    text.push(source[index]);
    spans.push({
      from: sourceStart + index,
      to: sourceStart + index + 1,
      tokenId: `${sourceStart + index}:${sourceStart + index + 1}`
    });
    index += 1;
  }

  return { text: text.join(''), spans };
}

function mapMarkdownLiteral(markdown, lineStarts, node) {
  const literal = node.literal;
  const sourcepos = node.sourcepos;

  if (!literal || !Array.isArray(sourcepos?.[0]) || !Array.isArray(sourcepos?.[1])) {
    return null;
  }

  let sourceStart = markdownSourceOffset(lineStarts, sourcepos[0], markdown.length);
  let sourceEnd = Math.min(
    markdown.length,
    markdownSourceOffset(lineStarts, sourcepos[1], markdown.length) + 1
  );
  let source = markdown.slice(sourceStart, sourceEnd);
  let decoded = decodeMarkdownSourceSpans(source, sourceStart);

  if (decoded.text === literal) {
    return { text: literal, spans: decoded.spans };
  }

  const literalIndex = source.indexOf(literal);
  if (literalIndex >= 0 && source.lastIndexOf(literal) === literalIndex) {
    sourceStart += literalIndex;
    return {
      text: literal,
      spans: Array.from({ length: literal.length }, (_, index) => ({
        from: sourceStart + index,
        to: sourceStart + index + 1,
        tokenId: `${sourceStart + index}:${sourceStart + index + 1}`
      }))
    };
  }

  // ToastMark can end an escaped text node at the backslash instead of the
  // escaped character. Scan a small, same-line suffix until the decoded raw
  // text exactly equals the AST literal.
  const lineEnd = markdown.indexOf('\n', sourceEnd);
  const expansionLimit = Math.min(
    lineEnd === -1 ? markdown.length : lineEnd,
    sourceEnd + Math.max(2, literal.length * 2)
  );

  while (sourceEnd < expansionLimit) {
    sourceEnd += 1;
    source = markdown.slice(sourceStart, sourceEnd);
    decoded = decodeMarkdownSourceSpans(source, sourceStart);

    if (decoded.text === literal) {
      return { text: literal, spans: decoded.spans };
    }

    if (decoded.text.length > literal.length) {
      break;
    }
  }

  return null;
}

export function buildMarkdownAstFindSnapshot(markdown, root) {
  const lineStarts = markdownLineStarts(markdown);
  const textParts = [];
  const spans = [];
  const excludedContainers = new Set([
    'customBlock',
    'customInline',
    'frontMatter',
    'htmlBlock',
    'htmlInline',
    'image',
    'refDef'
  ]);
  const calloutPattern = /^\s*\[!([a-z][a-z0-9_-]*)\][+-]?\s*([^\n\r]*)/i;
  const anchorTypes = new Set([
    'blockQuote',
    'code',
    'codeBlock',
    'emph',
    'heading',
    'item',
    'link',
    'paragraph',
    'strike',
    'strong',
    'tableCell'
  ]);
  const displayBlockTypes = new Set([
    'codeBlock',
    'heading',
    'paragraph',
    'tableCell'
  ]);
  const processedBlockQuotes = new WeakSet();
  const skipNextCalloutBreak = new WeakSet();
  let previousSpan = null;
  let previousBlock = null;
  let leafSequence = 0;

  const findAncestor = (node, ancestors, types) => (
    types.has(node.type)
      ? node
      : [...ancestors].reverse().find((ancestor) => types.has(ancestor.type))
  );

  const appendBlockSeparator = (block, nextSpan) => {
    if (textParts.length && block !== previousBlock) {
      textParts.push('\n');
      spans.push({
        from: previousSpan?.to ?? nextSpan.from,
        to: nextSpan.from,
        separator: true,
        replaceable: false
      });
    }

    previousBlock = block;
  };

  const appendMappedNode = (node, ancestors) => {
    const mapped = mapMarkdownLiteral(markdown, lineStarts, node);

    if (!mapped?.text || mapped.spans.length !== mapped.text.length) {
      return;
    }

    let visibleText = mapped.text;
    let visibleSpans = mapped.spans;
    const blockQuote = [...ancestors].reverse().find((ancestor) => (
      ancestor.type === 'blockQuote'
    ));

    // Obsidian callouts hide only a marker at the very start of a blockquote.
    // Never apply this to later text leaves: an ordinary quote may contain a
    // literal "[!note]" on its second line.
    if (blockQuote && !processedBlockQuotes.has(blockQuote)) {
      processedBlockQuotes.add(blockQuote);
      const calloutMatch = visibleText.match(calloutPattern);
      const withoutCallout = calloutMatch
        ? visibleText.slice(calloutMatch[0].length).replace(/^\s+/, '')
        : visibleText;
      const removedLength = visibleText.length - withoutCallout.length;

      if (removedLength) {
        visibleText = withoutCallout;
        visibleSpans = visibleSpans.slice(removedLength);

        if (!visibleText) {
          skipNextCalloutBreak.add(blockQuote);
        }
      }
    }

    if (!visibleText) {
      return;
    }

    const block = findAncestor(node, ancestors, displayBlockTypes) || blockQuote || node;
    appendBlockSeparator(block, visibleSpans[0]);

    const anchorNode = node.type === 'code' || node.type === 'codeBlock'
      ? node
      : [...ancestors].reverse().find((ancestor) => anchorTypes.has(ancestor.type));
    const nodeId = anchorNode && Number.isFinite(Number(anchorNode.id))
      ? Number(anchorNode.id)
      : null;
    const leafId = `leaf-${leafSequence}`;
    leafSequence += 1;

    textParts.push(visibleText);
    visibleSpans.forEach((span) => {
      spans.push({
        ...span,
        leafId,
        nodeId,
        separator: false,
        replaceable: true
      });
    });
    previousSpan = visibleSpans[visibleSpans.length - 1];
  };

  const appendBreak = (node, ancestors) => {
    const blockQuote = [...ancestors].reverse().find((ancestor) => (
      ancestor.type === 'blockQuote'
    ));

    if (blockQuote && skipNextCalloutBreak.has(blockQuote)) {
      skipNextCalloutBreak.delete(blockQuote);
      return;
    }

    const sourcepos = node.sourcepos;
    let from = Array.isArray(sourcepos?.[0])
      ? markdownSourceOffset(lineStarts, sourcepos[0], markdown.length)
      : (previousSpan?.to ?? 0);
    let newline = markdown.indexOf('\n', Math.max(0, from - 1));

    if (newline < 0 || newline > from + 3) {
      newline = markdown.indexOf('\n', from);
    }

    if (newline < 0) {
      from = previousSpan?.to ?? from;
    } else {
      from = newline > 0 && markdown[newline - 1] === '\r' ? newline - 1 : newline;
    }

    const to = newline < 0 ? from : newline + 1;
    const block = findAncestor(node, ancestors, displayBlockTypes) || blockQuote || node;
    appendBlockSeparator(block, { from });
    textParts.push('\n');
    spans.push({
      from,
      to,
      leafId: `break-${leafSequence}`,
      nodeId: null,
      separator: false,
      replaceable: newline >= 0,
      tokenId: `${from}:${to}`
    });
    leafSequence += 1;
    previousSpan = spans[spans.length - 1];
  };

  const visit = (node, ancestors = []) => {
    if (!node || excludedContainers.has(node.type)) {
      return;
    }

    if (node.type === 'text' || node.type === 'code' || node.type === 'codeBlock') {
      appendMappedNode(node, ancestors);

      if (node.type === 'codeBlock') {
        return;
      }
    }

    if (node.type === 'softbreak' || node.type === 'linebreak') {
      appendBreak(node, ancestors);
      return;
    }

    let child = node.firstChild;
    const nextAncestors = [...ancestors, node];

    while (child) {
      visit(child, nextAncestors);
      child = child.next;
    }
  };

  visit(root);
  return { text: textParts.join(''), spans };
}

export function mapVisibleFindSnapshotToSource(
  visibleSnapshot,
  sourceSnapshot,
  { invalidNodeIds = [] } = {}
) {
  const invalidIds = new Set(invalidNodeIds.map((nodeId) => Number(nodeId)));
  const mappedSpans = visibleSnapshot.spans.map((span) => ({
    ...span,
    replaceable: false
  }));
  const visibleGroups = new Map();
  const sourceGroups = new Map();

  visibleSnapshot.spans.forEach((span, index) => {
    if (span.nodeId === null || span.nodeId === undefined || span.separator) {
      return;
    }

    const nodeId = Number(span.nodeId);
    if (!Number.isFinite(nodeId) || invalidIds.has(nodeId)) {
      return;
    }

    const indices = visibleGroups.get(nodeId) || [];
    indices.push(index);
    visibleGroups.set(nodeId, indices);
  });

  sourceSnapshot.spans.forEach((span, index) => {
    if (
      span.nodeId === null ||
      span.nodeId === undefined ||
      span.separator ||
      span.replaceable === false
    ) {
      return;
    }

    const nodeId = Number(span.nodeId);
    if (!Number.isFinite(nodeId) || invalidIds.has(nodeId)) {
      return;
    }

    const indices = sourceGroups.get(nodeId) || [];
    indices.push(index);
    sourceGroups.set(nodeId, indices);
  });

  sourceGroups.forEach((sourceIndices, nodeId) => {
    const visibleIndices = visibleGroups.get(nodeId);

    if (!visibleIndices?.length) {
      return;
    }

    const visibleText = visibleIndices
      .map((index) => visibleSnapshot.text[index])
      .join('');
    const sourceText = sourceIndices
      .map((index) => sourceSnapshot.text[index])
      .join('');
    const leafIds = new Set(
      sourceIndices.map((index) => sourceSnapshot.spans[index].leafId)
    );
    let visibleOffset = visibleText === sourceText ? 0 : -1;

    // A transformed block (notably an Obsidian callout) can leave one safe
    // source leaf as a unique substring of its DOM owner. Anything more
    // ambiguous stays find-only.
    if (visibleOffset < 0 && leafIds.size === 1 && sourceText) {
      const first = visibleText.indexOf(sourceText);
      if (first >= 0 && visibleText.indexOf(sourceText, first + 1) < 0) {
        visibleOffset = first;
      }
    }

    if (visibleOffset < 0 || visibleOffset + sourceIndices.length > visibleIndices.length) {
      return;
    }

    sourceIndices.forEach((sourceIndex, offset) => {
      const visibleIndex = visibleIndices[visibleOffset + offset];
      const visibleSpan = mappedSpans[visibleIndex];
      const sourceSpan = sourceSnapshot.spans[sourceIndex];

      mappedSpans[visibleIndex] = {
        ...visibleSpan,
        from: sourceSpan.from,
        to: sourceSpan.to,
        leafId: sourceSpan.leafId,
        tokenId: sourceSpan.tokenId,
        replaceable: true
      };
    });
  });

  return { text: visibleSnapshot.text, spans: mappedSpans };
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
