import test from 'node:test';
import assert from 'node:assert/strict';
import { importMarkdownToTextPack } from '../src/textpack-import.js';
import { encodeTextPack, readTextPackImage, decodeTextPack } from '../src/textpack.js';

const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });

function reader() {
  const sources = [];
  return { sources, readImage: async (source) => { sources.push(source); return png; } };
}

test('Markdown conversion preserves surrounding source and stores original image bytes once', async () => {
  const read = reader();
  const markdown = '# 文档\r\n\r\n![图](<插图/猫 图.png> "说明")\r\n![again](<./插图/猫%20图.png>)\r\n[ordinary](unrelated.png)\r\n';
  const result = await importMarkdownToTextPack(markdown, read);
  assert.equal(result.serializedContent, '# 文档\r\n\r\n![图](<assets/image-1.png> "说明")\r\n![again](<assets/image-1.png>)\r\n[ordinary](unrelated.png)\r\n');
  assert.deepEqual(read.sources, ['插图/猫 图.png']);
  assert.deepEqual(new Uint8Array(await (await readTextPackImage(result.textPack, 'assets/image-1.png')).arrayBuffer()), new Uint8Array(await png.arrayBuffer()));
  const decoded = await decodeTextPack(await encodeTextPack(result.textPack, result.serializedContent));
  assert.equal(decoded.originalSerializedContent, result.serializedContent);
});

test('inline paths decode Markdown escapes and entities once while preserving encoded hash characters', async () => {
  const read = reader();
  const result = await importMarkdownToTextPack(String.raw`![a](images/a\(1\).png) ![b](images/a&amp;b.png) ![c](images/a\&amp;.png) ![d](images/a%23b.png)`, read);
  assert.deepEqual(read.sources, ['images/a(1).png', 'images/a&b.png', 'images/a&amp;.png', 'images/a%23b.png']);
  assert.equal(result.serializedContent, '![a](assets/image-1.png) ![b](assets/image-2.png) ![c](assets/image-3.png) ![d](assets/image-4.png)');
});

test('full, collapsed, shortcut references and case-normalized labels rewrite only used definitions', async () => {
  const read = reader();
  const markdown = '![one][Cat Pic] ![cat pic][] ![CAT PIC] ![missing]\n\n[cat   pic]: <images/cat.png> "猫"\n[unused]: unused.png\n[cat pic]: ignored-duplicate.png\n';
  const result = await importMarkdownToTextPack(markdown, read);
  assert.deepEqual(read.sources, ['images/cat.png']);
  assert.equal(result.serializedContent, markdown.replace('<images/cat.png>', '<assets/image-1.png>'));
});

test('code, escaped Markdown, comments and HTML raw text retain their literal image examples', async () => {
  const read = reader();
  const markdown = [
    '`![inline](skip-1.png)`', '', '```md', '![fenced](skip-2.png)', '<img src="skip-3.png">', '```', '',
    '    ![indented](skip-4.png)', '', String.raw`\![escaped](skip-5.png)`, '',
    '<!-- ![comment](skip-6.png) <img src="skip-7.png"> -->', '',
    '<div>', '<!-- <img src="skip-8.png"> -->', '<pre><img src="skip-9.png"></pre>',
    '<script>const example = \'<img src="skip-10.png">\';</script>', '<img src="actual.png">', '</div>', '',
    'text <code><img src="skip-11.png"> ![x](skip-12.png)</code>', ''
  ].join('\n');
  const result = await importMarkdownToTextPack(markdown, read);
  assert.deepEqual(read.sources, ['actual.png']);
  assert.equal(result.serializedContent, markdown.replace('src="actual.png"', 'src="assets/image-1.png"'));
});

test('HTML img src preserves attribute quoting, case, spacing and title greater-than signs', async () => {
  const read = reader();
  const markdown = '<IMG title="1 > 0" SRC = \'图 片/a&amp;b.png\' width="50">\n\n<div>\n<img src=images/b.png alt="B"><img src="images/b.png" src="ignored.png">\n</div>';
  const result = await importMarkdownToTextPack(markdown, read);
  assert.deepEqual(read.sources, ['图 片/a&b.png', 'images/b.png']);
  assert.equal(result.serializedContent, '<IMG title="1 > 0" SRC = \'assets/image-1.png\' width="50">\n\n<div>\n<img src=assets/image-2.png alt="B"><img src="assets/image-2.png" src="ignored.png">\n</div>');
});

test('remote images stay unchanged across Markdown, references and HTML without a reader', async () => {
  const markdown = '![a](https://example.com/a.png?x=1&y=2) ![b][remote]\n\n[remote]: http://example.com/b.png\n\n<img src="https://example.com/c.png">';
  const result = await importMarkdownToTextPack(markdown);
  assert.equal(result.serializedContent, markdown);
});

test('unsafe or unreadable local sources fail the whole conversion with a useful source', async () => {
  for (const source of ['../secret.png', '%2e%2e/secret.png', '/absolute.png', 'C:/absolute.png', 'file:///secret.png', 'data:image/png;base64,AA==', 'assets/%zz.png']) {
    await assert.rejects(importMarkdownToTextPack(`![x](${source})`, { readImage: async () => assert.fail('unsafe source must not be read') }), /安全相对路径/);
  }
  await assert.rejects(importMarkdownToTextPack('![x](missing.png)', { readImage: async () => { throw new Error('文件不存在'); } }), /missing\.png.*文件不存在/);
  await assert.rejects(importMarkdownToTextPack('![x](a.png)'), /图片读取器/);
  await assert.rejects(importMarkdownToTextPack('![x](a.png)', { readImage: async () => { throw new DOMException('cancelled', 'AbortError'); } }), { name: 'AbortError' });
});
