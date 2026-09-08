import { markdownLanguage } from '@codemirror/lang-markdown';
import { isRelativeImageSource } from './local-images.js';
import { addTextPackImage, createTextPack } from './textpack.js';

const MARKDOWN_ESCAPES_AND_ENTITIES = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])|&(?:#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/gi;
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const RAW_HTML = new Set(['code', 'pre', 'script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/gi, (entity, name) => {
    if (name[0] === '#') {
      const hexadecimal = name[1]?.toLowerCase() === 'x';
      const number = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '\ufffd';
    }
    if (Object.hasOwn(NAMED_ENTITIES, name)) return NAMED_ENTITIES[name];
    // Browser decoding covers the full HTML entity table without a second
    // parser dependency. The non-DOM fallback refuses unfamiliar entities.
    if (globalThis.document?.createElement) {
      const element = document.createElement('textarea');
      element.innerHTML = entity;
      return element.value;
    }
    throw new Error(`图片路径包含暂不支持的 HTML 实体：${entity}`);
  });
}

function decodeDestination(value, markdown) {
  const unwrapped = markdown && value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
  return markdown ? unwrapped.replace(MARKDOWN_ESCAPES_AND_ENTITIES, (match, escaped) => escaped ?? decodeEntities(match)) : decodeEntities(unwrapped);
}

function referenceKey(value) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function markdownDestination(content, node) {
  let from = node.from;
  let to = node.to;
  if (content[from] === '<' && content[to - 1] === '>') { from++; to--; }
  return { from, to, source: decodeDestination(content.slice(node.from, node.to), true) };
}

function imageReference(content, node) {
  const label = node.getChild('LinkLabel');
  if (label && label.to - label.from > 2) return referenceKey(content.slice(label.from + 1, label.to - 1));
  const closing = node.getChildren('LinkMark').find((mark) => content.slice(mark.from, mark.to) === ']');
  return closing ? referenceKey(content.slice(node.from + 2, closing.from)) : '';
}

function collectHtmlImages(content, from, to, state, destinations) {
  let position = from;
  while (position < to) {
    const start = content.indexOf('<', position);
    if (start < 0 || start >= to) break;
    if (content.startsWith('<!--', start)) {
      const end = content.indexOf('-->', start + 4);
      position = end < 0 ? to : end + 3;
      continue;
    }
    const opening = /^<(\/?)\s*([a-z][\w:-]*)\b/i.exec(content.slice(start, to));
    if (!opening) { position = start + 1; continue; }
    let end = start + opening[0].length;
    let quote = '';
    for (; end < to; end++) {
      const character = content[end];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end >= to) break;
    position = end + 1;
    const tag = opening[2].toLowerCase();
    const closing = Boolean(opening[1]);
    if (state.blocked) {
      if (tag === state.blocked) {
        if (closing) { if (--state.depth === 0) state.blocked = null; }
        else if (tag === 'code' || tag === 'pre') state.depth++;
      }
      continue;
    }
    if (closing) continue;
    if (RAW_HTML.has(tag)) { state.blocked = tag; state.depth = 1; continue; }
    if (tag !== 'img') continue;
    const attributesFrom = start + opening[0].length;
    const attributes = content.slice(attributesFrom, end);
    const attributePattern = /\s+([^\s/=>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const match of attributes.matchAll(attributePattern)) {
      if (match[1].toLowerCase() !== 'src') continue;
      const value = match[2] ?? match[3] ?? match[4];
      if (value === undefined) break;
      const valueInMatch = match[0].indexOf('=') + 1;
      const prefix = /^\s*["']?/.exec(match[0].slice(valueInMatch))[0];
      const valueFrom = attributesFrom + match.index + valueInMatch + prefix.length;
      destinations.push({ from: valueFrom, to: valueFrom + value.length, source: decodeDestination(value, false) });
      break; // HTML uses the first occurrence of a duplicate src attribute.
    }
  }
}

function collectDestinations(content) {
  const tree = markdownLanguage.parser.parse(content);
  const definitions = new Map();
  const references = new Set();
  const destinations = [];
  const htmlState = { blocked: null, depth: 0 };
  tree.iterate({ enter({ node }) {
    if (node.name === 'LinkReference') {
      const label = node.getChild('LinkLabel');
      const url = node.getChild('URL');
      if (label && url) {
        const key = referenceKey(content.slice(label.from + 1, label.to - 1));
        if (!definitions.has(key)) definitions.set(key, url);
      }
      return false;
    }
    if (node.name === 'Image') {
      if (htmlState.blocked) return false;
      const url = node.getChild('URL');
      if (url) destinations.push(markdownDestination(content, url));
      else references.add(imageReference(content, node));
      return false;
    }
    if (node.name === 'HTMLTag' || node.name === 'HTMLBlock') {
      collectHtmlImages(content, node.from, node.to, htmlState, destinations);
      return false;
    }
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'CommentBlock'].includes(node.name)) return false;
  } });
  for (const reference of references) {
    const definition = definitions.get(reference);
    if (definition) destinations.push(markdownDestination(content, definition));
  }
  return destinations.sort((left, right) => left.from - right.from);
}

function sourceKey(source) {
  return decodeURIComponent(source.trim().split(/[?#]/, 1)[0]).replaceAll('\\', '/').split('/').filter((part) => part && part !== '.').join('/');
}

/** Package local Markdown images while preserving all surrounding source text. */
export async function importMarkdownToTextPack(serializedContent, { readImage } = {}) {
  const content = String(serializedContent ?? '');
  let textPack = createTextPack();
  const destinations = collectDestinations(content);
  const imported = new Map();
  const replacements = [];
  for (const destination of destinations) {
    const { source } = destination;
    if (/^https?:\/\//i.test(source.trim())) continue;
    if (!isRelativeImageSource(source)) throw new Error(`无法打包图片「${source}」：须使用文档内的安全相对路径`);
    if (typeof readImage !== 'function') throw new Error('无法打包本地图片：缺少图片读取器');
    const key = sourceKey(source);
    if (!imported.has(key)) {
      try {
        const blob = await readImage(source);
        const added = await addTextPackImage(textPack, blob);
        textPack = added.textPack;
        imported.set(key, added.relativePath);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new Error(`无法打包图片「${source}」：${error?.message || error}`, { cause: error });
      }
    }
    replacements.push({ ...destination, path: imported.get(key) });
  }
  let result = content;
  for (const { from, to, path } of replacements.reverse()) result = result.slice(0, from) + path + result.slice(to);
  return { textPack, serializedContent: result };
}
