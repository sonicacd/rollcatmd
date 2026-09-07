import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentOutline, currentOutlineIndex } from '../src/document-outline.js';

async function outline(text, options) {
  const lines = text.split('\n');
  return buildDocumentOutline({ lineCount: lines.length, getLine: (n) => lines[n - 1] }, options);
}
test('indexes duplicate ATX and setext headings with exact line and offset', async () => {
  const source = '# 同名\n正文\n## 同名\n\n章节 **二**\n---\n';
  const result = await outline(source);
  assert.deepEqual(result.map(({title,level,line}) => ({title,level,line})), [
    {title:'同名',level:1,line:1}, {title:'同名',level:2,line:3}, {title:'章节 二',level:2,line:5}
  ]);
  assert.equal(result[2].offset, source.indexOf('章节'));
  assert.equal(currentOutlineIndex(result, 4), 1);
});
test('excludes YAML, fenced and indented code, and handles longer fences', async () => {
  const result = await outline('---\n# metadata\n---\n````md\n# code\n```\n## still code\n````\n    # indented\n# Actual ###\n\n> ## Quoted');
  assert.deepEqual(result.map(h => h.title), ['Actual', 'Quoted']);
});
test('large index yields and honors cancellation before scanning the remainder', async () => {
  const abort = new AbortController();
  let reads = 0;
  await assert.rejects(buildDocumentOutline({lineCount:10000,getLine:()=>{reads++;return '# item';}}, {
    signal:abort.signal, yieldWork:async()=>abort.abort()
  }), {name:'AbortError'});
  assert.equal(reads, 2000);
});
