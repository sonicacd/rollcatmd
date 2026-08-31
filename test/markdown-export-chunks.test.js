import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectMarkdownForExport,
  iterateMarkdownExportChunks
} from '../src/markdown-export-chunks.js';

function lines(source) {
  const values = source.split('\n');
  return {
    lineCount: values.length,
    getLine: (lineNumber) => values[lineNumber - 1]
  };
}

test('chunked export keeps fenced code valid and carries reference definitions', async () => {
  const source = [
    '# Chapter',
    '',
    '```js',
    ...Array.from({ length: 30 }, (_, index) => `console.log(${index});`),
    '```',
    '',
    '![cover][image]',
    '',
    '[image]: https://example.com/cover.png'
  ].join('\n');
  const lineSource = lines(source);
  const inspected = await inspectMarkdownForExport(lineSource);
  const chunks = [];
  for await (const chunk of iterateMarkdownExportChunks(lineSource, {
    ...inspected,
    targetCharacters: 80,
    maximumBlockCharacters: 180
  })) {
    chunks.push(chunk);
  }

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.markdown.includes('[image]: https://example.com/cover.png')));
  assert.ok(chunks.filter((chunk) => chunk.markdown.includes('console.log')).every((chunk) => {
    const fences = chunk.markdown.match(/^```/gm) || [];
    return fences.length % 2 === 0;
  }));
});

test('chunk inspection and iteration honor cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    inspectMarkdownForExport(lines('one\ntwo'), { signal: controller.signal }),
    { name: 'AbortError' }
  );
});
