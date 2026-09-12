// Formatting and wrapping differ between views. Match nearby document text,
// retaining occurrence counts so repeated paragraphs stay at the same location.
export function normalizeAnchorText(text) {
  return text.replace(/[^\p{L}\p{N}]/gu, '');
}

function occurrences(text, query) {
  const positions = [];
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + 1)) {
    positions.push(at);
  }
  return positions;
}

export function createTextAnchor(text, offset) {
  const at = Math.max(0, Math.min(offset, text.length));
  const candidates = [];
  for (const size of [96, 48, 24, 12]) {
    for (const backwards of [false, true]) {
      const start = backwards ? Math.max(0, at - size) : at;
      const end = backwards ? at : Math.min(text.length, at + size);
      const query = text.slice(start, end);
      if (query.length < 4) continue;
      const matches = occurrences(text, query);
      candidates.push({
        query, relative: at - start, count: matches.length,
        occurrence: matches.indexOf(start),
        before: text.slice(Math.max(0, start - 32), start),
        after: text.slice(end, end + 32)
      });
    }
  }
  return { candidates, progress: text.length ? at / text.length : 0 };
}

export function resolveTextAnchor(text, anchor) {
  for (const candidate of anchor.candidates) {
    const matches = occurrences(text, candidate.query);
    if (!matches.length) continue;
    if (matches.length === candidate.count && candidate.occurrence >= 0) {
      return matches[candidate.occurrence] + candidate.relative;
    }
    let best = matches[0];
    let bestScore = -Infinity;
    for (const match of matches) {
      const before = text.slice(Math.max(0, match - candidate.before.length), match);
      const end = match + candidate.query.length;
      const after = text.slice(end, end + candidate.after.length);
      const score = Number(before === candidate.before) + Number(after === candidate.after)
        - Math.abs((match + candidate.relative) / Math.max(1, text.length) - anchor.progress);
      if (score > bestScore) {
        best = match;
        bestScore = score;
      }
    }
    return best + candidate.relative;
  }
  return null;
}

function indexText(root) {
  const segments = [];
  const parts = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  let length = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('[aria-hidden="true"], button, select')) continue;
    const text = normalizeAnchorText(node.nodeValue || '');
    if (!text) continue;
    segments.push({ node, start: length, end: length + text.length });
    parts.push(text);
    length += text.length;
  }
  return { text: parts.join(''), segments };
}

function rangeAt(index, offset) {
  const segment = index.segments.find((item) => item.end > offset) || index.segments.at(-1);
  if (!segment) return null;
  const value = segment.node.nodeValue;
  let remaining = Math.max(0, offset - segment.start);
  let position = 0;
  for (const character of value) {
    if (normalizeAnchorText(character)) {
      if (remaining < character.length) break;
      remaining -= character.length;
    }
    position += character.length;
  }
  const range = segment.node.ownerDocument.createRange();
  range.setStart(segment.node, position);
  const characterSize = value.codePointAt(position) > 0xffff ? 2 : 1;
  range.setEnd(segment.node, Math.min(value.length, position + characterSize));
  return range;
}

export function captureViewPosition(root, scroller) {
  const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const scrollRatio = maximum ? scroller.scrollTop / maximum : 0;
  const edge = scroller.scrollTop <= 1 ? 'top'
    : maximum && scroller.scrollTop >= maximum - 1 ? 'bottom' : null;
  if (edge) return { edge, scrollRatio };

  const bounds = scroller.getBoundingClientRect();
  const index = indexText(root);
  const doc = root.ownerDocument;
  const x = bounds.left + bounds.width * 0.4;
  const y = bounds.top + scroller.clientHeight * 0.3;
  const caret = doc.caretRangeFromPoint?.(x, y);
  let segment = index.segments.find((item) => item.node === caret?.startContainer);
  let offset = segment
    ? segment.start + normalizeAnchorText(segment.node.nodeValue.slice(0, caret.startOffset)).length
    : null;

  // Empty space, an image or a table border may have no text caret. Use the
  // nearest visible text node; its position is still tied to document content.
  if (!segment) {
    let distance = Infinity;
    for (const item of index.segments) {
      const range = doc.createRange();
      range.selectNodeContents(item.node);
      for (const rect of range.getClientRects()) {
        if (rect.bottom < bounds.top || rect.top > bounds.bottom || !rect.width) continue;
        const nextDistance = Math.abs(rect.top - y);
        if (nextDistance < distance) {
          distance = nextDistance;
          segment = item;
          offset = item.start;
        }
      }
    }
  }
  if (!segment) return { scrollRatio };
  const rect = rangeAt(index, offset).getBoundingClientRect();
  return {
    scrollRatio,
    text: createTextAnchor(index.text, offset),
    viewportFraction: Math.max(0, Math.min(1, (rect.top - bounds.top) / scroller.clientHeight))
  };
}

export function createViewPositionController({
  suspendScrollSync = () => () => {},
  syncScroll = () => {}
} = {}) {
  let cleanup = () => {};
  return {
    cancel() { cleanup(); },
    restore(anchor, root, scroller) {
      cleanup();
      const resumeScrollSync = suspendScrollSync();
      let stopped = false;
      let frame;
      let timer;
      let range;
      const win = root.ownerDocument.defaultView;
      const stopEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
      const stop = () => {
        if (stopped) return;
        stopped = true;
        win.cancelAnimationFrame(frame);
        win.clearTimeout(timer);
        root.removeEventListener('load', correct, true);
        stopEvents.forEach((type) => win.removeEventListener(type, stop, true));
        cleanup = () => {};
        resumeScrollSync();
      };
      const correct = () => {
        if (stopped || !root.isConnected) return;
        if (range?.startContainer.isConnected) {
          const top = range.getBoundingClientRect().top;
          scroller.scrollTop += top - scroller.getBoundingClientRect().top
            - anchor.viewportFraction * scroller.clientHeight;
        } else {
          const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = maximum * (anchor.edge === 'bottom' ? 1 : anchor.scrollRatio);
        }
        syncScroll();
      };
      cleanup = stop;
      stopEvents.forEach((type) => win.addEventListener(type, stop, { capture: true, passive: true }));
      frame = win.requestAnimationFrame(() => {
        if (stopped) return;
        if (anchor.text) {
          const index = indexText(root);
          const offset = resolveTextAnchor(index.text, anchor.text);
          if (offset !== null) range = rangeAt(index, offset);
        }
        correct();
        // Allow the editor's own layout/preview synchronization to settle.
        frame = win.requestAnimationFrame(correct);
        root.addEventListener('load', correct, true);
        timer = win.setTimeout(stop, 1000);
      });
    }
  };
}
