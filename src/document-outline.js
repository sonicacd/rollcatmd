// Build a small heading index without rendering or duplicating a large document.
export function createOutlineScanner() {
  let fence = null;
  let previous = null;
  let frontmatter = false;
  const headings = [];
  return {
    headings,
    line(text, number, offset = 0) {
      if (number === 1 && text.trim() === '---') { frontmatter = true; return; }
      if (frontmatter) {
        if (number > 1 && /^(---|\.\.\.)\s*$/.test(text)) frontmatter = false;
        return;
      }
      const content = text.replace(/^(?: {0,3}> ?)+/, '');
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
      if (fence) {
        if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
        previous = null;
        return;
      }
      if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
        fence = { character: marker[1][0], length: marker[1].length };
        previous = null;
        return;
      }
      const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(content);
      if (atx) {
        headings.push({ level: atx[1].length, title: plainHeading((atx[2] || '').replace(/[ \t]+#+[ \t]*$/, '')), line: number, offset });
        previous = null;
        return;
      }
      if (previous && /^ {0,3}(?:=+|-+)[ \t]*$/.test(content)) {
        headings.push({ level: content.trim()[0] === '=' ? 1 : 2, title: plainHeading(previous.text), line: previous.number, offset: previous.offset });
        previous = null;
        return;
      }
      previous = content.trim() && !/^(?: {4}|\t| {0,3}(?:[-+*] |\d+[.)] |<|\|))/.test(content)
        ? { text: content.trim(), number, offset } : null;
    }
  };
}

export function plainHeading(text) {
  return text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '').replace(/\\([\\`*_{}\[\]()#+.!-])/g, '$1')
    .replace(/[*_~`]/g, '').trim() || '无标题章节';
}

export async function buildDocumentOutline(source, { signal, yieldWork = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {}) {
  const scanner = createOutlineScanner();
  let offset = 0;
  for (let line = 1; line <= source.lineCount; line += 1) {
    if (signal?.aborted) throw new DOMException('已取消章节索引', 'AbortError');
    const text = source.getLine(line);
    scanner.line(text, line, offset);
    offset += text.length + 1;
    if (line % 2000 === 0) await yieldWork();
  }
  return scanner.headings;
}

export function currentOutlineIndex(headings, line) {
  let lo = 0, hi = headings.length - 1, result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (headings[mid].line <= line) { result = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return result;
}
