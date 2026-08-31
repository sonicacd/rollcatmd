import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inlineRemoteImages,
  inspectRemoteImageUrl,
  REMOTE_IMAGE_EXPORT_LIMITS
} from '../src/remote-image-export.js';

function createFakeImage(source, alternative = '') {
  const attributes = new Map([
    ['src', source],
    ['alt', alternative]
  ]);
  return {
    currentSrc: '',
    ownerDocument: {
      createElement() {
        return { className: '', textContent: '' };
      }
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    replaceWith(value) {
      this.replacement = value;
    }
  };
}

function createRoot(images) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, 'img');
      return images;
    }
  };
}

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00
]);

function pngResponse() {
  return new Response(PNG_BYTES, {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });
}

test('only accepts credential-free public HTTPS image URLs', () => {
  assert.equal(inspectRemoteImageUrl('https://cdn.example.com/book/cover.png').allowed, true);
  for (const source of [
    'http://cdn.example.com/image.png',
    'https://localhost/image.png',
    'https://127.0.0.1/image.png',
    'https://10.0.0.4/image.png',
    'https://[::1]/image.png',
    'https://user:password@example.com/image.png'
  ]) {
    const result = inspectRemoteImageUrl(source);
    assert.equal(result.remote, true, source);
    assert.equal(result.allowed, false, source);
  }
  assert.equal(inspectRemoteImageUrl('data:image/png;base64,AA==').remote, false);
});

test('downloads duplicate images once, embeds a Blob URL, and releases it', async () => {
  const images = [
    createFakeImage('https://images.example.com/a.png', '封面'),
    createFakeImage('https://images.example.com/a.png', '封面副本')
  ];
  let fetchCount = 0;
  let objectUrlCount = 0;
  const revoked = [];
  const progress = [];
  const session = { urls: new Set(), usedBytes: 0, cache: new Map() };
  const result = await inlineRemoteImages(createRoot(images), {
    session,
    nativeRuntime: false,
    fetchImpl: async () => {
      fetchCount += 1;
      return pngResponse();
    },
    createObjectURL: () => `blob:test-cover-${objectUrlCount += 1}`,
    revokeObjectURL: (url) => revoked.push(url),
    onProgress: (event) => progress.push(event)
  });

  assert.equal(fetchCount, 1);
  assert.equal(result.downloadedImages, 1);
  assert.equal(result.includedImages, 2);
  assert.equal(result.failedImages, 0);
  assert.deepEqual(images.map((image) => image.getAttribute('src')), [
    'blob:test-cover-1',
    'blob:test-cover-1'
  ]);
  assert.deepEqual(progress.at(-1), {
    phase: 'downloading-images',
    completed: 1,
    total: 1,
    pageCount: 0,
    includedImages: 2,
    failedImages: 0
  });

  result.release();
  result.release();
  const repeated = createFakeImage('https://images.example.com/a.png', '再次出现');
  const repeatedResult = await inlineRemoteImages(createRoot([repeated]), {
    session,
    nativeRuntime: false,
    fetchImpl: async () => {
      fetchCount += 1;
      return pngResponse();
    },
    createObjectURL: () => `blob:test-cover-${objectUrlCount += 1}`,
    revokeObjectURL: (url) => revoked.push(url)
  });
  assert.equal(fetchCount, 1);
  assert.equal(repeatedResult.downloadedImages, 0);
  assert.equal(repeatedResult.includedImages, 1);
  assert.equal(repeated.getAttribute('src'), 'blob:test-cover-2');
  repeatedResult.release();
  assert.deepEqual(revoked, ['blob:test-cover-1', 'blob:test-cover-2']);
});

test('validates every native redirect before following it', async () => {
  const image = createFakeImage('https://images.example.com/redirect.png');
  const requests = [];
  const result = await inlineRemoteImages(createRoot([image]), {
    nativeRuntime: true,
    fetchImpl: async (url, init) => {
      requests.push({ url, maxRedirections: init.maxRedirections });
      if (requests.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.com/final.png' }
        });
      }
      return pngResponse();
    },
    createObjectURL: () => 'blob:redirected',
    revokeObjectURL: () => {}
  });

  assert.deepEqual(requests, [
    { url: 'https://images.example.com/redirect.png', maxRedirections: 0 },
    { url: 'https://cdn.example.com/final.png', maxRedirections: 0 }
  ]);
  assert.equal(result.includedImages, 1);
  assert.equal(image.getAttribute('src'), 'blob:redirected');
  result.release();
});

test('uses at most three downloads and leaves failures as visible placeholders', async () => {
  const sources = new Array(5)
    .fill(null)
    .map((_, index) => `https://images${index}.example.com/page.png`);
  const images = [
    ...sources.map((source) => createFakeImage(source)),
    createFakeImage('http://insecure.example.com/page.png', '不安全图片')
  ];
  let active = 0;
  let maximumActive = 0;
  const result = await inlineRemoteImages(createRoot(images), {
    nativeRuntime: false,
    fetchImpl: async (url) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (url.includes('images4.')) {
        return new Response('not an image', {
          status: 200,
          headers: { 'content-type': 'text/plain' }
        });
      }
      return pngResponse();
    },
    createObjectURL: (_, index) => `blob:${index || 'image'}`,
    revokeObjectURL: () => {}
  });

  assert.equal(REMOTE_IMAGE_EXPORT_LIMITS.concurrency, 3);
  assert.equal(maximumActive, 3);
  assert.equal(result.includedImages, 4);
  assert.equal(result.failedImages, 2);
  assert.equal(images[4].replacement.textContent, '[网络图片未包含]');
  assert.equal(images[5].replacement.textContent, '[网络图片：不安全图片]');
  result.release();
});

test('aborts in-flight native or browser requests without producing an image', async () => {
  const controller = new AbortController();
  const image = createFakeImage('https://images.example.com/slow.png');
  const exporting = inlineRemoteImages(createRoot([image]), {
    signal: controller.signal,
    nativeRuntime: false,
    fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    createObjectURL: () => {
      throw new Error('should not create an object URL');
    }
  });

  controller.abort();
  await assert.rejects(exporting, { name: 'AbortError' });
  assert.equal(image.replacement, undefined);
});
