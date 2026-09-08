import {
  hasImageSignature, inlineRemoteImages, REMOTE_IMAGE_EXPORT_LIMITS
} from './remote-image-export.js';

const LIMITS = REMOTE_IMAGE_EXPORT_LIMITS;
const OMIT_TAGS = new Set(['SCRIPT', 'STYLE', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'NOSCRIPT', 'HEAD', 'BASE', 'META', 'LINK']);
const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'DL', 'DT', 'DD']);

function aborted(signal) {
  if (signal?.aborted) throw new DOMException('网页粘贴已取消', 'AbortError');
}

function escapeText(value) { return String(value).replace(/[\\`*_[\]<>#|~]/g, '\\$&'); }
function destination(value) {
  return String(value).replace(/[\s()<>\\]/g, (character) => character === '(' ? '%28' : character === ')' ? '%29' : encodeURIComponent(character));
}
function normalizeSpace(value) { return String(value).replace(/[\t\r\n ]+/g, ' '); }

function resolveUrl(source, baseUrl, { image = false } = {}) {
  if (typeof source !== 'string' || !source.trim()) return '';
  const value = source.trim();
  if (image && /^(data:image\/|blob:)/i.test(value)) return value;
  try {
    const url = new URL(value, baseUrl || undefined);
    return (image ? ['http:', 'https:'] : ['http:', 'https:', 'mailto:', 'tel:']).includes(url.protocol) ? url.href : '';
  } catch { return !image && /^#[^\s]*$/.test(value) ? value : ''; }
}

function failedImageMarkdown(alternative, source) {
  const label = `图片未保存${alternative?.trim() ? `：${alternative.trim()}` : ''}`;
  const url = resolveUrl(source);
  return url && /^https?:/i.test(url) ? `[${escapeText(label)}](${destination(url)})` : `〔${escapeText(label)}〕`;
}

/** Converts an inert, sanitized DOM tree. No clipboard HTML is inserted into the editor. */
export function webPasteDomToMarkdown(root, { imageMarkdown = new Map(), baseUrl = '' } = {}) {
  const children = (node) => Array.from(node.childNodes || []).map(visit).join('');
  const block = (text) => `\n\n${text.trim()}\n\n`;
  const wrap = (text, delimiter) => text.trim()
    ? `${/^\s/.test(text) ? ' ' : ''}${delimiter}${text.trim()}${delimiter}${/\s$/.test(text) ? ' ' : ''}` : text;
  function visit(node) {
    if (node.nodeType === 3) return escapeText(normalizeSpace(node.textContent || ''));
    if (node.nodeType !== 1 && node.nodeType !== 11 && node.nodeType !== 9) return '';
    const tag = String(node.tagName || '').toUpperCase();
    if (OMIT_TAGS.has(tag)) return '';
    if (tag === 'IMG') return imageMarkdown.get(node) ?? failedImageMarkdown(node.getAttribute('alt'), resolveUrl(node.getAttribute('src'), baseUrl, { image: true }));
    if (tag === 'BR') return '  \n';
    if (tag === 'HR') return '\n\n---\n\n';
    if (tag === 'PRE') {
      const text = (node.textContent || '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
      const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
      const fence = '`'.repeat(longest + 1);
      return block(`${fence}\n${text}\n${fence}`);
    }
    if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') {
      const text = normalizeSpace(node.textContent || '');
      const delimiter = '`'.repeat(Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length)) + 1);
      const padding = /^`|`$/.test(text) || /^ .* $/.test(text) ? ' ' : '';
      return `${delimiter}${padding}${text}${padding}${delimiter}`;
    }
    if (tag === 'UL' || tag === 'OL') {
      let index = Math.max(1, Number.parseInt(node.getAttribute('start'), 10) || 1);
      const items = Array.from(node.childNodes || []).filter((child) => child.tagName === 'LI').map((item) => {
        const prefix = tag === 'OL' ? `${index++}. ` : '- ';
        return children(item).trim().split('\n').map((line, i) => i ? `${' '.repeat(prefix.length)}${line}` : `${prefix}${line}`).join('\n');
      });
      return block(items.join('\n'));
    }
    if (tag === 'TABLE') {
      const rows = Array.from(node.querySelectorAll('tr')).map((row) => Array.from(row.childNodes || [])
        .filter((cell) => ['TD', 'TH'].includes(cell.tagName)).map((cell) => children(cell).trim().replace(/\n+/g, ' / ')));
      const width = Math.max(0, ...rows.map((row) => row.length));
      if (!width) return '';
      const line = (row) => `| ${Array.from({ length: width }, (_, i) => row[i] || '').join(' | ')} |`;
      return block([line(rows[0]), line(new Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n'));
    }
    const text = children(node);
    if (/^H[1-6]$/.test(tag)) return block(`${'#'.repeat(Number(tag[1]))} ${text.trim()}`);
    if (tag === 'STRONG' || tag === 'B') return wrap(text, '**');
    if (tag === 'EM' || tag === 'I') return wrap(text, '*');
    if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') return wrap(text, '~~');
    if (tag === 'A') {
      const url = resolveUrl(node.getAttribute('href'), baseUrl);
      // A failed image already becomes a clickable source link; a second
      // enclosing Markdown link would produce invalid nested-link syntax.
      if (Array.from(node.querySelectorAll('img')).some((image) => (imageMarkdown.get(image) || '').startsWith('['))) return text;
      return url ? `[${text.trim() || escapeText(url)}](${destination(url)})` : text;
    }
    if (tag === 'BLOCKQUOTE') return block(text.trim().split('\n').map((line) => `> ${line}`).join('\n'));
    return BLOCK_TAGS.has(tag) ? block(text) : text;
  }
  return visit(root).replace(/\n[ \t]+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function getImageSource(image, baseUrl) {
  // Many news/blog pages copy the lazy-loading URL with a tiny placeholder src.
  const lazy = ['data-original', 'data-src', 'data-lazy-src', 'data-actualsrc'].map((key) => image.getAttribute(key)).find(Boolean);
  const srcset = image.getAttribute('data-srcset') || image.getAttribute('srcset');
  const candidate = srcset?.split(',').map((part) => part.trim().split(/\s+/)).filter(([url]) => url)
    .sort((a, b) => (Number.parseFloat(b[1]) || 1) - (Number.parseFloat(a[1]) || 1))[0]?.[0];
  return [lazy, candidate, image.getAttribute('src')].map((value) => resolveUrl(value, baseUrl, { image: true })).find(Boolean) || '';
}

function decodeDataImage(source) {
  const match = /^data:([^,]*),([\s\S]*)$/i.exec(source);
  if (!match) throw new Error('内嵌图片格式不支持');
  const [mediaType, ...parameters] = match[1].split(';');
  const type = mediaType.toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) throw new Error('内嵌图片格式不支持');
  const base64 = parameters.at(-1)?.toLowerCase() === 'base64';
  if (parameters.slice(0, base64 ? -1 : undefined).some((value) => !/^[^=]+=[^;]*$/.test(value))) throw new Error('内嵌图片参数无效');
  const payload = match[2];
  const maximumEncoded = Math.ceil(LIMITS.maxImageBytes * (base64 ? 4 / 3 : 1)) + 8;
  if (payload.length > maximumEncoded * 3) throw new Error('图片超过 8 MiB');
  if (/%(?![\da-f]{2})/i.test(payload) || /[^\x00-\x7f]/.test(payload)) throw new Error('内嵌图片编码无效');
  const unescaped = payload.replace(/%([\da-f]{2})/gi, (_, value) => String.fromCharCode(Number.parseInt(value, 16)));
  let bytes;
  if (base64) {
    const encoded = unescaped.replace(/\s/g, '');
    if (encoded.length > maximumEncoded) throw new Error('图片超过 8 MiB');
    const binary = atob(encoded);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } else {
    if (unescaped.length > LIMITS.maxImageBytes) throw new Error('图片超过 8 MiB');
    bytes = Uint8Array.from(unescaped, (character) => character.charCodeAt(0));
  }
  if (bytes.length > LIMITS.maxImageBytes) throw new Error('图片超过 8 MiB');
  if (!hasImageSignature(bytes, type)) throw new Error('图片内容与格式不匹配');
  return new Blob([bytes], { type });
}

function imageAdapter(source, alternative) {
  const attributes = new Map([['src', source], ['alt', alternative || '']]);
  return {
    ownerDocument: { createElement: () => ({ textContent: '' }) },
    getAttribute: (name) => attributes.get(name) || null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    replaceWith() { this.failed = true; }
  };
}

/** Prepare text and original raster bytes together; commit the returned Markdown atomically. */
export async function prepareWebPaste(html, {
  document = globalThis.document, sanitizeHTML = (value) => value, storeImage,
  nativeRuntime, signal, onProgress, fetchImpl
} = {}) {
  aborted(signal);
  if (!document?.createElement) throw new Error('当前环境不支持读取网页剪贴板');
  if (typeof storeImage !== 'function') throw new Error('网页图片保存功能不可用');
  const raw = String(html || '');
  const clipboardHeader = /^(?:(?:Version|StartHTML|EndHTML|StartFragment|EndFragment|StartSelection|EndSelection|SourceURL):[^\r\n]*(?:\r?\n|$))+/i.exec(raw)?.[0] || '';
  let baseUrl = resolveUrl(/^SourceURL:(.+)$/mi.exec(clipboardHeader)?.[1]);
  // A template is inert: parsing clipboard markup cannot execute scripts or
  // start image/iframe requests. Only the vetted downloader performs requests.
  const original = document.createElement('template');
  original.innerHTML = raw;
  const base = original.content.querySelector('base[href]')?.getAttribute('href');
  baseUrl = resolveUrl(base, baseUrl) || baseUrl;
  const fragment = /<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i.exec(raw)?.[1]
    ?? raw.slice(clipboardHeader.length);
  const template = document.createElement('template');
  template.innerHTML = sanitizeHTML(fragment);
  const root = template.content;
  // DOMPurify defaults omit these too; pruning keeps the converter and image
  // discovery safe when a host supplies a less restrictive sanitizer callback.
  for (const node of root.querySelectorAll([...OMIT_TAGS].map((tag) => tag.toLowerCase()).join(','))) node.remove();
  const images = Array.from(root.querySelectorAll('img'));
  const groups = new Map();
  const imageMarkdown = new Map();
  const session = { urls: new Set(), usedBytes: 0, cache: new Map() };
  for (const image of images) {
    const source = getImageSource(image, baseUrl);
    imageMarkdown.set(image, failedImageMarkdown(image.getAttribute('alt'), source));
    if (!source) continue;
    if (groups.has(source)) { groups.get(source).images.push(image); continue; }
    if (groups.size >= LIMITS.maxImages) continue;
    const group = { source, images: [image], adapter: imageAdapter(source, image.getAttribute('alt')) };
    groups.set(source, group);
    if (/^data:/i.test(source)) {
      session.urls.add(source);
      try {
        group.blob = decodeDataImage(source);
        if (session.usedBytes + group.blob.size > LIMITS.maxTotalBytes) throw new Error('图片总量超过 32 MiB');
        session.usedBytes += group.blob.size;
      } catch { group.blob = null; }
    }
  }
  aborted(signal);
  const blobHandles = new Map();
  const remote = await inlineRemoteImages({ querySelectorAll: () => Array.from(groups.values(), (group) => group.adapter) }, {
    nativeRuntime, signal, onProgress, fetchImpl, session,
    createObjectURL(blob) { const handle = `blob:web-paste-${blobHandles.size}`; blobHandles.set(handle, blob); return handle; },
    revokeObjectURL() {}
  });
  let includedImages = 0;
  try {
    for (const group of groups.values()) {
      aborted(signal);
      const blob = group.blob || (/^https?:/i.test(group.source) ? blobHandles.get(group.adapter.getAttribute('src')) : null);
      if (!blob) continue;
      let relativePath;
      try {
        relativePath = await storeImage(blob);
        aborted(signal);
        if (typeof relativePath !== 'string' || !relativePath || /^[a-z][\w+.-]*:|^[/\\]/i.test(relativePath)
          || relativePath.replaceAll('\\', '/').split('/').includes('..')) throw new Error('图片保存路径无效');
      } catch { aborted(signal); continue; }
      for (const image of group.images) {
        imageMarkdown.set(image, `![${escapeText(image.getAttribute('alt') || '')}](${destination(relativePath)})`);
      }
      includedImages += group.images.length;
    }
    aborted(signal);
    return {
      markdown: webPasteDomToMarkdown(root, { imageMarkdown, baseUrl }),
      includedImages, failedImages: images.length - includedImages
    };
  } finally { remote.release(); blobHandles.clear(); }
}
