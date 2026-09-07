import { toBlob } from 'html-to-image';

export function captureSelectedContent(root) {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = selection.toString();
  const container = document.createElement('div');
  container.append(range.cloneContents());
  let ancestor = range.commonAncestorContainer;
  if (ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentElement;
  // A range inside one block has no outer wrapper in cloneContents(). Restore
  // the semantic wrappers so code, tables and lists keep their selected styles.
  while (ancestor && ancestor !== root && !ancestor.classList.contains('toastui-editor-contents')) {
    if (/^(P|H[1-6]|PRE|CODE|BLOCKQUOTE|TABLE|THEAD|TBODY|TR|TD|TH|UL|OL|LI|STRONG|EM)$/.test(ancestor.tagName)) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.removeAttribute('id'); wrapper.removeAttribute('contenteditable');
      wrapper.append(...container.childNodes); container.append(wrapper);
    }
    ancestor = ancestor.parentElement;
  }
  container.querySelectorAll('button, .reader-line-gap, [contenteditable]').forEach((element) => {
    if (element.tagName === 'BUTTON' || element.classList.contains('reader-line-gap')) element.remove();
    else element.removeAttribute('contenteditable');
  });
  // A selection ending at the next block can clone an empty wrapper for that
  // block. Do not turn this boundary artifact into an empty code box or heading.
  [...container.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre,code,blockquote')].reverse().forEach((element) => {
    if (!element.textContent.trim() && !element.querySelector('img,hr,table')) element.remove();
  });
  return text.trim() || container.querySelector('img') ? { html: container.innerHTML, text } : null;
}

function prepareSelectionLayout(contents) {
  // Export snapshots have no horizontal scrollbar. Wrap code and table cells
  // inside the image instead of losing content beyond the visible viewport.
  for (const element of contents.querySelectorAll('pre, pre code, pre code *')) {
    Object.assign(element.style, {
      whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word',
      overflow: 'visible', maxWidth: '100%', boxSizing: 'border-box'
    });
  }
  for (const table of contents.querySelectorAll('table')) {
    table.removeAttribute('width');
    Object.assign(table.style, {
      display: 'table', tableLayout: 'fixed', width: '100%', maxWidth: '100%',
      minWidth: '0', overflow: 'visible', boxSizing: 'border-box'
    });
    for (const element of table.querySelectorAll('col, colgroup, th, td')) {
      element.removeAttribute('width');
      Object.assign(element.style, {
        width: 'auto', minWidth: '0', maxWidth: 'none', whiteSpace: 'normal',
        overflowWrap: 'anywhere', wordBreak: 'break-word', boxSizing: 'border-box'
      });
    }
    for (const element of table.querySelectorAll('th *, td *')) {
      Object.assign(element.style, { whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word', maxWidth: '100%' });
    }
  }
}

export async function renderSelectedImage({ html, markdown, renderMarkdown, inlineImages, signal, toImageBlob = toBlob }) {
  // Keep the positioning used to hide the measurement host out of the node
  // passed to html-to-image, matching the full-document image export path.
  const host = document.createElement('section');
  host.className = 'reader-panel image-export-stage';
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '720px', height: 'auto', overflow: 'visible', border: '0', borderRadius: '0' });
  const stage = document.createElement('div');
  stage.className = 'image-export-viewport selection-image-stage';
  Object.assign(stage.style, { position: 'relative', left: '0', top: '0', width: '720px', height: 'auto', overflow: 'visible', padding: '28px', boxSizing: 'border-box' });
  const mount = document.createElement('div');
  stage.append(mount); host.append(stage); document.body.append(host);
  let rendered;
  let images;
  try {
    let contents;
    if (markdown !== undefined) {
      rendered = await renderMarkdown(markdown, mount); contents = rendered.contents;
    } else {
      contents = document.createElement('div'); contents.className = 'toastui-editor-contents image-export-content';
      contents.innerHTML = html; mount.append(contents);
    }
    Object.assign(contents.style, { width: '664px', maxWidth: 'none', padding: '0', margin: '0' });
    contents.querySelectorAll('button').forEach((button) => button.remove());
    prepareSelectionLayout(contents);
    images = await inlineImages(contents, { signal });
    await document.fonts.ready;
    await Promise.all([...contents.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
    const height = Math.ceil(stage.getBoundingClientRect().height);
    if (height > 4096) throw new Error('选区图片过长，请缩小选区，或使用“导出图片”生成分页图片');
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
    const blob = await toImageBlob(stage, {
      width: 720, height, pixelRatio: 2, backgroundColor, fontEmbedCSS: '', skipAutoScale: true
    });
    if (!blob) throw new Error('生成图片失败，请重试');
    return { blob, failedImages: images?.failedImages || 0 };
  } finally { images?.release?.(); rendered?.destroy?.(); host.remove(); }
}
