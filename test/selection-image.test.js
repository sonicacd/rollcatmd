import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSelectedImage } from '../src/selection-image.js';

function fakeElement(tagName) {
  return {
    tagName: tagName.toUpperCase(), style: {}, children: [], removed: false,
    append(...children) { this.children.push(...children); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { height: 121 }; },
    remove() { this.removed = true; }
  };
}

test('selection image rasterizes the inner viewport and releases its offscreen host', async (t) => {
  const oldDocument = globalThis.document;
  const oldComputedStyle = globalThis.getComputedStyle;
  t.after(() => {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldComputedStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = oldComputedStyle;
  });
  const body = fakeElement('body');
  globalThis.document = { createElement: fakeElement, body, fonts: { ready: Promise.resolve() }, documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#f8faf4' });
  let imageResourcesReleased = false;
  let viewerDestroyed = false;
  let renderedStage;
  const expectedBlob = new Blob(['rasterizer result'], { type: 'image/png' });
  const result = await renderSelectedImage({
    markdown: '这是选中的中文内容',
    renderMarkdown: async (markdown, mount) => {
      assert.equal(markdown, '这是选中的中文内容');
      const contents = fakeElement('div'); mount.append(contents);
      return { contents, destroy() { viewerDestroyed = true; } };
    },
    inlineImages: async () => ({ failedImages: 0, release() { imageResourcesReleased = true; } }),
    toImageBlob: async (stage, options) => {
      renderedStage = stage;
      const host = body.children[0];
      assert.equal(host.style.left, '-10000px', 'only the host carries the screen-hiding offset');
      assert.equal(host.children[0], stage);
      assert.notEqual(host, stage, 'the offscreen host must never be the rasterized node');
      assert.equal(stage.style.position, 'relative');
      assert.equal(stage.style.left, '0');
      assert.equal(stage.style.top, '0');
      assert.equal(options.width, 720);
      assert.equal(options.height, 121);
      assert.equal(options.pixelRatio, 2);
      return expectedBlob;
    }
  });
  assert.equal(result.blob, expectedBlob);
  assert.equal(result.failedImages, 0);
  assert.equal(body.children[0].removed, true);
  assert.equal(body.children[0].children[0], renderedStage);
  assert.equal(imageResourcesReleased, true);
  assert.equal(viewerDestroyed, true);
});
