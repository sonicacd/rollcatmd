import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWebPaste, webPasteDomToMarkdown } from '../src/web-paste.js';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const dataUrl = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;
const response = () => new Response(PNG, { headers: { 'content-type': 'image/png' } });

// The production parser is the browser's inert HTML template. These small DOM
// fixtures exercise conversion/download behavior without a new DOM dependency.
function element(tag, attributes = {}, ...children) {
  const node = {
    nodeType: tag ? 1 : 11, tagName: tag.toUpperCase(), attributes: { ...attributes }, childNodes: [],
    get textContent() { return this.childNodes.map((child) => child.textContent).join(''); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((child) => child !== this); },
    querySelectorAll(selector) {
      const matches = (candidate) => selector.split(',').some((part) => {
        const match = /^(\w+)(?:\[(\w+)\])?$/.exec(part);
        return match && candidate.tagName === match[1].toUpperCase() && (!match[2] || candidate.getAttribute(match[2]) !== null);
      });
      const found = [];
      const walk = (parent) => { for (const child of parent.childNodes || []) { if (matches(child)) found.push(child); walk(child); } };
      walk(this);
      return found;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  node.childNodes = children.flat().map((child) => typeof child === 'string' ? { nodeType: 3, textContent: child, parentNode: node } : child);
  for (const child of node.childNodes) child.parentNode = node;
  return node;
}
const img = (source, alt = '') => element('img', { src: source, alt });
const p = (...children) => element('p', {}, ...children);
const root = (...children) => element('', {}, ...children);
const clone = (node) => node.nodeType === 3 ? node.textContent : element(node.tagName, node.attributes, ...node.childNodes.map(clone));
function documentFor(tree) {
  return { createElement(tag) {
    assert.equal(tag, 'template');
    return { set innerHTML(value) { this.content = clone(tree); }, content: null };
  } };
}
async function prepare(tree, options = {}) {
  return prepareWebPaste(options.html || '<clipboard>', {
    document: documentFor(tree), sanitizeHTML: (html) => html, nativeRuntime: false,
    storeImage: async () => 'assets/copied.png', fetchImpl: async () => response(), ...options
  });
}

test('converts headings, inline emphasis, links, lists, code, quotes and tables in order', () => {
  const tree = root(
    element('h2', {}, '标题'),
    p('一个 ', element('strong', {}, '重点'), ' 与 ', element('em', {}, '强调'), ' ', element('a', { href: '/guide' }, '指南'), '。'),
    element('ol', { start: '3' }, element('li', {}, '第三项'), element('li', {}, '第四项')),
    p('示例 ', element('code', {}, 'a`b')),
    element('pre', {}, element('code', {}, 'x < y\n```\nz')),
    element('blockquote', {}, p('引用')),
    element('table', {},
      element('tr', {}, element('th', {}, '列 A'), element('th', {}, '列 B')),
      element('tr', {}, element('td', {}, 'x|y'), element('td', {}, 'z')))
  );
  assert.equal(webPasteDomToMarkdown(tree, { baseUrl: 'https://example.com/article' }), [
    '## 标题', '一个 **重点** 与 *强调* [指南](https://example.com/guide)。',
    '3. 第三项\n4. 第四项', '示例 ``a`b``', '````\nx < y\n```\nz\n````', '> 引用',
    '| 列 A | 列 B |\n| --- | --- |\n| x\\|y | z |'
  ].join('\n\n'));
});

test('downloads text and images together, preserves order, and stores duplicates once', async () => {
  const calls = [];
  const stored = [];
  const result = await prepare(root(p('前文'), img('https://cdn.example.com/a.png', '第一张'), p('中间'), img('https://cdn.example.com/a.png', '同图'), p('后文')), {
    fetchImpl: async (url) => { calls.push(url); return response(); },
    storeImage: async (blob) => { stored.push(new Uint8Array(await blob.arrayBuffer())); return 'assets/image-1.png'; }
  });
  assert.deepEqual(calls, ['https://cdn.example.com/a.png']);
  assert.deepEqual(stored, [PNG]);
  assert.equal(result.markdown, '前文\n\n![第一张](assets/image-1.png)\n\n中间\n\n![同图](assets/image-1.png)\n\n后文');
  assert.equal(result.includedImages, 2);
  assert.equal(result.failedImages, 0);
});

test('stores downloaded images sequentially in clipboard order despite out-of-order fetching', async () => {
  let active = 0;
  let maximum = 0;
  let stored = 0;
  const result = await prepare(root(...Array.from({ length: 5 }, (_, i) => img(`https://cdn.example.com/${i}.png`, `图${i}`))), {
    fetchImpl: async (url) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, url.endsWith('0.png') ? 12 : 1));
      active--;
      return response();
    },
    storeImage: async () => `assets/image-${++stored}.png`
  });
  assert.equal(maximum, 3);
  assert.equal(result.includedImages, 5);
  for (let i = 0; i < 5; i++) assert.ok(result.markdown.includes(`![图${i}](assets/image-${i + 1}.png)`));
});

test('failed downloads retain all text and accessible original links with visible warnings', async () => {
  const result = await prepare(root(p('完整前文'), img('https://cdn.example.com/denied.png', '解释图片'), p('完整后文')), {
    fetchImpl: async () => new Response('', { status: 403 }),
    storeImage: async () => assert.fail('failure should not store an image')
  });
  assert.equal(result.markdown, '完整前文\n\n[图片未保存：解释图片](https://cdn.example.com/denied.png)\n\n完整后文');
  assert.equal(result.includedImages, 0);
  assert.equal(result.failedImages, 1);
});

test('linked failed images retain one valid source link', async () => {
  const result = await prepare(root(element('a', { href: 'https://example.com/article' }, img('https://cdn.example.com/failed.png', '示意图'))), {
    fetchImpl: async () => new Response('', { status: 403 })
  });
  assert.equal(result.markdown, '[图片未保存：示意图](https://cdn.example.com/failed.png)');
});

test('clipboard header removal never strips matching lines inside HTML content', async () => {
  const html = '<pre>Version:1.0\nSourceURL:https://example.com/example\n</pre>';
  const result = await prepare(root(element('pre', {}, 'Version:1.0\nSourceURL:https://example.com/example\n')), {
    html, sanitizeHTML(value) { assert.equal(value, html); return value; }
  });
  assert.ok(result.markdown.includes('Version:1.0\nSourceURL:https://example.com/example'));
});

test('resolves clipboard SourceURL, base href, lazy attributes and srcset', async () => {
  const seen = [];
  const result = await prepare(root(
    element('base', { href: '../assets/' }), p(element('a', { href: 'guide' }, '链接')),
    img('./one.png'), element('img', { src: dataUrl, 'data-src': 'two.png' }),
    element('img', { srcset: 'small.png 1x, large.png 2x' })
  ), {
    html: 'Version:1.0\r\nSourceURL:https://example.com/articles/one\r\n<!--StartFragment--><p>fixture</p><!--EndFragment-->',
    sanitizeHTML(value) { assert.equal(value, '<p>fixture</p>'); return value; },
    fetchImpl: async (url) => { seen.push(url); return response(); }
  });
  assert.deepEqual(seen, ['https://example.com/assets/one.png', 'https://example.com/assets/two.png', 'https://example.com/assets/large.png']);
  assert.ok(result.markdown.includes('[链接](https://example.com/assets/guide)'));
  assert.equal(result.includedImages, 3);
});

test('decodes data raster images to original binary and never writes base64 Markdown', async () => {
  const saved = [];
  const result = await prepare(root(p('截图'), img(dataUrl, '截图'), img(dataUrl, '副本')), {
    fetchImpl: async () => assert.fail('data images need no network'),
    storeImage: async (blob) => { saved.push(new Uint8Array(await blob.arrayBuffer())); return 'assets/paste.png'; }
  });
  assert.deepEqual(saved, [PNG]);
  assert.equal(result.includedImages, 2);
  assert.equal(result.failedImages, 0);
  assert.ok(!result.markdown.includes('base64'));
  assert.ok(result.markdown.includes('![截图](assets/paste.png)'));
});

test('decodes percent-encoded binary and parameterized percent-escaped base64 data URLs exactly', async () => {
  const binary = `data:image/png,${Array.from(PNG, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('')}`;
  const encoded = `data:image/png;charset=utf-8;base64,${Array.from(Buffer.from(PNG).toString('base64'), (character) => `%${character.charCodeAt(0).toString(16)}`).join('')}`;
  const stored = [];
  const result = await prepare(root(img(binary), img(encoded)), {
    fetchImpl: async () => assert.fail('data URLs must not perform network I/O'),
    storeImage: async (blob) => { stored.push(new Uint8Array(await blob.arrayBuffer())); return `assets/data-${stored.length}.png`; }
  });
  assert.equal(result.includedImages, 2);
  assert.deepEqual(stored, [PNG, PNG]);
});

test('unavailable clipboard blob URLs cannot collide with internal download handles', async () => {
  let stored = 0;
  const result = await prepare(root(img('https://cdn.example.com/a.png', '网络'), img('blob:web-paste-0', '不可用')), {
    storeImage: async () => { stored++; return 'assets/one.png'; }
  });
  assert.equal(stored, 1);
  assert.equal(result.includedImages, 1);
  assert.equal(result.failedImages, 1);
  assert.ok(result.markdown.includes('〔图片未保存：不可用〕'));
});

test('rejects SVG, local files, blob sources and unresolved relative paths without fetching', async () => {
  const sources = ['data:image/svg+xml;base64,PHN2Zy8+', 'file:///C:/secret.png', 'C:\\secret.png', 'blob:https://example.com/id', '../unknown.png', 'javascript:alert(1)'];
  const result = await prepare(root(p('正文'), ...sources.map((source, i) => img(source, `图${i}`))), {
    fetchImpl: async () => assert.fail('unsafe source must not be fetched'),
    storeImage: async () => assert.fail('unsafe source must not be stored')
  });
  assert.equal(result.failedImages, sources.length);
  assert.equal(result.includedImages, 0);
  assert.ok(result.markdown.startsWith('正文'));
  assert.ok(!result.markdown.includes('secret.png'));
  assert.ok(!result.markdown.includes('data:'));
});

test('prunes active content and form images even with a permissive sanitizer', async () => {
  const tree = root(p('保留'), element('script', {}, 'alert(1)'), element('style', {}, 'body{display:none}'),
    element('form', {}, '表单', img('https://cdn.example.com/form.png')), element('iframe', { src: 'https://evil.example.com' }),
    p(element('a', { href: 'javascript:alert(1)' }, '正常文字')));
  const result = await prepare(tree, { fetchImpl: async () => assert.fail('form image must not download') });
  assert.equal(result.markdown, '保留\n\n正常文字');
  assert.equal(result.failedImages, 0);
});

test('enforces 32 unique images across data and HTTPS inputs without dropping later text', async () => {
  let requests = 0;
  const tree = root(img(dataUrl), ...Array.from({ length: 33 }, (_, i) => img(`https://cdn.example.com/${i}.png`, `${i}`)), p('末尾文字'));
  const result = await prepare(tree, { fetchImpl: async () => { requests++; return response(); } });
  assert.equal(requests, 31);
  assert.equal(result.includedImages, 32);
  assert.equal(result.failedImages, 2);
  assert.ok(result.markdown.endsWith('末尾文字'));
  assert.ok(result.markdown.includes('[图片未保存：32](https://cdn.example.com/32.png)'));
});

test('image size and storage failures retain source links', async () => {
  const result = await prepare(root(img('https://cdn.example.com/huge.png', '大图'), img('https://cdn.example.com/small.png', '保存失败')), {
    fetchImpl: async (url) => url.endsWith('huge.png') ? new Response(PNG, { headers: { 'content-type': 'image/png', 'content-length': String(8 * 1024 * 1024 + 1) } }) : response(),
    storeImage: async () => { throw new Error('disk full'); }
  });
  assert.equal(result.failedImages, 2);
  assert.ok(result.markdown.includes('[图片未保存：大图](https://cdn.example.com/huge.png)'));
  assert.ok(result.markdown.includes('[图片未保存：保存失败](https://cdn.example.com/small.png)'));
});

test('cancellation aborts download and never commits partial Markdown', async () => {
  const controller = new AbortController();
  const promise = prepare(root(p('文字'), img('https://cdn.example.com/slow.png')), {
    signal: controller.signal,
    fetchImpl: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    storeImage: async () => assert.fail('cancelled work must not store')
  });
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
});

test('escapes Markdown metacharacters from copied text and image labels', async () => {
  const result = await prepare(root(p('literal [link](target) <tag> *star*'), img(dataUrl, 'a](')), {
    storeImage: async () => 'assets/a (1).png'
  });
  assert.ok(result.markdown.includes('literal \\[link\\](target) \\<tag\\> \\*star\\*'));
  assert.ok(result.markdown.includes('![a\\](](assets/a%20%281%29.png)'));
});
