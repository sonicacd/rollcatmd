import { toBlob as elementToBlob } from 'html-to-image';

import {
  DEFAULT_IMAGE_EXPORT_PAGE_HEIGHT,
  DEFAULT_IMAGE_EXPORT_SCALE,
  DEFAULT_IMAGE_EXPORT_WIDTH,
  imageExportBaseName
} from './image-export.js';
import { createImagePageCollector } from './image-page-collector.js';
import {
  abortError,
  inspectMarkdownForExport,
  iterateMarkdownExportChunks,
  throwIfAborted,
  yieldToMainThread
} from './markdown-export-chunks.js';

const MAX_DIRECT_RENDER_PAGES = 12;
const MAX_IMAGE_EXPORT_PAGES = 2000;
const PAGE_GUTTER = 32;
const PAGE_FILL_FALLBACK = 0.55;
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function cssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function waitForAbort(signal) {
  return new Promise((_, reject) => {
    if (!signal) {
      return;
    }
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : abortError());
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

async function waitForImages(root, { signal, timeout = 10000 } = {}) {
  throwIfAborted(signal);
  const pending = [...root.querySelectorAll('img')].filter((image) => !image.complete);
  if (!pending.length) {
    return;
  }

  const settled = Promise.all(pending.map((image) => new Promise((resolve) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', resolve, { once: true });
  })));
  const timeoutPromise = new Promise((resolve) => window.setTimeout(resolve, timeout));
  await Promise.race([settled, timeoutPromise, waitForAbort(signal)]);
  throwIfAborted(signal);
}

function remoteImagePlaceholder(image) {
  const label = document.createElement('span');
  const alternative = image.getAttribute('alt')?.trim();
  label.className = 'image-export-remote-image';
  label.textContent = alternative
    ? `[\u7f51\u7edc\u56fe\u7247\uff1a${alternative}]`
    : '[\u7f51\u7edc\u56fe\u7247\u672a\u5305\u542b]';
  image.replaceWith(label);
}

function replaceRemoteImages(root) {
  let failedImages = 0;
  for (const image of root.querySelectorAll('img')) {
    const source = image.currentSrc || image.getAttribute('src') || '';
    if (/^https?:\/\//i.test(source)) {
      remoteImagePlaceholder(image);
      failedImages += 1;
    }
  }
  return { includedImages: 0, failedImages };
}

function prepareExportContents(contents) {
  contents.classList.add('image-export-content');
  Object.assign(contents.style, {
    boxSizing: 'border-box',
    width: `${DEFAULT_IMAGE_EXPORT_WIDTH}px`,
    maxWidth: 'none',
    minHeight: '0',
    margin: '0',
    padding: '0 48px'
  });
  for (const image of contents.querySelectorAll('img')) {
    Object.assign(image.style, {
      maxWidth: '100%',
      maxHeight: `${DEFAULT_IMAGE_EXPORT_PAGE_HEIGHT - PAGE_GUTTER * 2}px`,
      objectFit: 'contain'
    });
  }
}

function elementOffset(element, rootRect) {
  const rect = element.getBoundingClientRect();
  return {
    top: Math.max(0, rect.top - rootRect.top),
    bottom: Math.max(0, rect.bottom - rootRect.top)
  };
}

export function collectVisualPageBoundaries(contents, contentHeight) {
  const rootRect = contents.getBoundingClientRect();
  const values = new Set([0, contentHeight]);
  const orphanHeadingBoundaries = new Set();
  const selector = [
    ':scope > *',
    ':scope > ul > li',
    ':scope > ol > li',
    ':scope > table tr',
    ':scope > blockquote > *',
    ':scope img'
  ].join(',');

  for (const element of contents.querySelectorAll(selector)) {
    const { top, bottom } = elementOffset(element, rootRect);
    if (top > 0 && top < contentHeight) {
      values.add(top);
    }
    if (bottom > 0 && bottom < contentHeight) {
      values.add(bottom);
    }
    if (/^H[1-6]$/.test(element.tagName)) {
      orphanHeadingBoundaries.add(bottom);
    }
  }

  return {
    boundaries: [...values].sort((left, right) => left - right),
    orphanHeadingBoundaries
  };
}

export function createVisualPageRanges({
  contentHeight,
  boundaries,
  orphanHeadingBoundaries = new Set(),
  usableHeight = DEFAULT_IMAGE_EXPORT_PAGE_HEIGHT - PAGE_GUTTER * 2
}) {
  const ranges = [];
  let start = 0;

  while (start < contentHeight) {
    const target = Math.min(contentHeight, start + usableHeight);
    if (target >= contentHeight) {
      ranges.push({ start, end: contentHeight });
      break;
    }

    const candidates = boundaries.filter((value) => (
      value > start + 1 &&
      value <= target &&
      !orphanHeadingBoundaries.has(value)
    ));
    let end = candidates.at(-1) || target;
    if (end - start < usableHeight * PAGE_FILL_FALLBACK) {
      end = target;
    }
    if (end <= start) {
      end = target;
    }
    ranges.push({ start, end });
    start = end;
  }

  return ranges.length ? ranges : [{ start: 0, end: 1 }];
}

function createStage() {
  const stage = document.createElement('div');
  const viewport = document.createElement('div');
  const mount = document.createElement('div');
  stage.className = 'reader-panel image-export-stage';
  viewport.className = 'image-export-viewport';
  viewport.style.width = `${DEFAULT_IMAGE_EXPORT_WIDTH}px`;
  mount.className = 'image-export-mount';
  mount.style.width = `${DEFAULT_IMAGE_EXPORT_WIDTH}px`;
  viewport.append(mount);
  stage.append(viewport);
  document.body.append(stage);
  return { stage, viewport, mount };
}

async function inlineExportImages(contents, inlineImages, options) {
  if (!inlineImages) {
    return { ...replaceRemoteImages(contents), release: () => {} };
  }
  const result = await inlineImages(contents, options);
  return {
    includedImages: result?.includedImages ?? result?.included ?? 0,
    failedImages: result?.failedImages ?? result?.failed ?? 0,
    release: result?.release || (() => {})
  };
}

async function renderRange({ viewport, mount, range, signal, backgroundColor }) {
  throwIfAborted(signal);
  const height = Math.min(
    DEFAULT_IMAGE_EXPORT_PAGE_HEIGHT,
    Math.max(1, Math.ceil(range.end - range.start + PAGE_GUTTER * 2))
  );
  viewport.style.height = `${height}px`;
  mount.style.transform = `translateY(${PAGE_GUTTER - range.start}px)`;

  const blob = await elementToBlob(viewport, {
    width: DEFAULT_IMAGE_EXPORT_WIDTH,
    height,
    pixelRatio: DEFAULT_IMAGE_EXPORT_SCALE,
    backgroundColor,
    imagePlaceholder: TRANSPARENT_PIXEL,
    fontEmbedCSS: '',
    skipAutoScale: true,
    fetchRequestInit: signal ? { signal } : undefined
  });
  throwIfAborted(signal);
  if (!blob) {
    throw new Error('\u6d4f\u89c8\u5668\u6ca1\u6709\u751f\u6210\u56fe\u7247\u6570\u636e');
  }
  return blob;
}

async function renderPreparedContents({
  contents,
  viewport,
  mount,
  signal,
  onProgress,
  onPage,
  pageNumberStart = 0,
  sourceCompleted,
  sourceTotal,
  imageStats
}) {
  prepareExportContents(contents);
  await (document.fonts?.ready || Promise.resolve());
  await waitForImages(contents, { signal });
  const contentHeight = Math.max(1, Math.ceil(contents.scrollHeight));
  const { boundaries, orphanHeadingBoundaries } = collectVisualPageBoundaries(
    contents,
    contentHeight
  );
  const ranges = createVisualPageRanges({
    contentHeight,
    boundaries,
    orphanHeadingBoundaries
  });
  const backgroundColor = cssColor('--surface', '#ffffff');
  let pageNumber = pageNumberStart;

  for (const range of ranges) {
    throwIfAborted(signal);
    pageNumber += 1;
    if (pageNumber > MAX_IMAGE_EXPORT_PAGES) {
      throw new Error('\u5206\u9875\u56fe\u7247\u8d85\u8fc7 2,000 \u9875\uff0c\u8bf7\u62c6\u5206\u6587\u6863\u540e\u518d\u5bfc\u51fa');
    }
    onProgress?.({
      phase: 'rendering',
      completed: sourceCompleted,
      total: sourceTotal,
      pageCount: pageNumber - 1,
      ...imageStats
    });
    const blob = await renderRange({
      viewport,
      mount,
      range,
      signal,
      backgroundColor
    });
    const cssHeight = Math.min(
      DEFAULT_IMAGE_EXPORT_PAGE_HEIGHT,
      range.end - range.start + PAGE_GUTTER * 2
    );
    await onPage(blob, {
      pageNumber,
      width: DEFAULT_IMAGE_EXPORT_WIDTH * DEFAULT_IMAGE_EXPORT_SCALE,
      height: Math.round(cssHeight * DEFAULT_IMAGE_EXPORT_SCALE)
    });
    await yieldToMainThread();
  }

  mount.style.transform = '';
  return { pageNumber, rangeCount: ranges.length };
}

function normalizeRenderedChunk(rendered, mount) {
  if (rendered instanceof Element) {
    return { contents: rendered, destroy: () => {} };
  }
  const contents = rendered?.contents || mount.querySelector('.toastui-editor-contents');
  if (!contents) {
    throw new Error('\u65e0\u6cd5\u751f\u6210 Markdown \u9605\u8bfb\u6392\u7248');
  }
  return { contents, destroy: rendered?.destroy || (() => {}) };
}

export async function renderMarkdownSourceAsImages({
  lineSource,
  fileName,
  renderChunk,
  inlineImages,
  signal,
  onProgress,
  onPage,
  forceArchive = true
}) {
  if (typeof renderChunk !== 'function') {
    throw new TypeError('\u957f\u6587\u5bfc\u51fa\u9700\u8981 Markdown \u5206\u5757\u6e32\u67d3\u5668');
  }
  const collector = onPage ? null : createImagePageCollector({
    fileName,
    forceArchive,
    signal
  });
  const consumePage = onPage || ((blob) => collector.add(blob));
  const { stage, viewport, mount } = createStage();
  const imageStats = { includedImages: 0, failedImages: 0 };
  const remoteImageSession = { urls: new Set(), usedBytes: 0, cache: new Map() };
  let pageCount = 0;

  try {
    const inspected = await inspectMarkdownForExport(lineSource, { signal, onProgress });
    for await (const chunk of iterateMarkdownExportChunks(lineSource, {
      ...inspected,
      signal,
      onProgress
    })) {
      throwIfAborted(signal);
      onProgress?.({
        phase: 'layout',
        completed: chunk.sourceStart,
        total: inspected.totalCharacters,
        pageCount,
        ...imageStats
      });
      const rendered = normalizeRenderedChunk(
        await renderChunk(chunk.markdown, mount),
        mount
      );
      try {
        const batchImages = await inlineExportImages(rendered.contents, inlineImages, {
          signal,
          session: remoteImageSession,
          onProgress: (event) => onProgress?.({
            ...event,
            includedImages: imageStats.includedImages + (event.includedImages || 0),
            failedImages: imageStats.failedImages + (event.failedImages || 0),
            pageCount
          })
        });
        imageStats.includedImages += batchImages.includedImages;
        imageStats.failedImages += batchImages.failedImages;
        try {
          const result = await renderPreparedContents({
            contents: rendered.contents,
            viewport,
            mount,
            signal,
            onProgress,
            onPage: consumePage,
            pageNumberStart: pageCount,
            sourceCompleted: chunk.sourceEnd,
            sourceTotal: inspected.totalCharacters,
            imageStats
          });
          pageCount = result.pageNumber;
        } finally {
          batchImages.release();
        }
      } finally {
        await rendered.destroy();
        mount.replaceChildren();
        mount.style.transform = '';
      }
    }

    onProgress?.({
      phase: 'packaging',
      completed: inspected.totalCharacters,
      total: inspected.totalCharacters,
      pageCount,
      ...imageStats
    });
    const output = collector ? await collector.finish() : {
      kind: forceArchive || pageCount > 1 ? 'zip' : 'png',
      blob: null,
      fileName: forceArchive || pageCount > 1
        ? `${imageExportBaseName(fileName)}-\u56fe\u7247.zip`
        : `${imageExportBaseName(fileName)}.png`,
      pageCount
    };
    return { ...output, ...imageStats };
  } catch (error) {
    collector?.abort();
    throw error;
  } finally {
    stage.remove();
  }
}

export async function renderMarkdownAsImages({
  contents,
  fileName,
  lineSource,
  renderChunk,
  inlineImages,
  signal,
  onProgress,
  onPage
}) {
  const { stage, viewport, mount } = createStage();
  const clonedContents = contents.cloneNode(true);
  mount.append(clonedContents);
  prepareExportContents(clonedContents);

  try {
    await (document.fonts?.ready || Promise.resolve());
    const estimatedPages = Math.ceil(
      Math.max(1, clonedContents.scrollHeight) /
      (DEFAULT_IMAGE_EXPORT_PAGE_HEIGHT - PAGE_GUTTER * 2)
    );
    if (estimatedPages > MAX_DIRECT_RENDER_PAGES && lineSource && renderChunk) {
      stage.remove();
      return await renderMarkdownSourceAsImages({
        lineSource,
        fileName,
        renderChunk,
        inlineImages,
        signal,
        onProgress,
        onPage,
        forceArchive: true
      });
    }

    const inlineResult = await inlineExportImages(clonedContents, inlineImages, {
      signal,
      session: { urls: new Set(), usedBytes: 0, cache: new Map() },
      onProgress
    });
    const imageStats = {
      includedImages: inlineResult.includedImages,
      failedImages: inlineResult.failedImages
    };
    const collector = onPage ? null : createImagePageCollector({ fileName, signal });
    const consumePage = onPage || ((blob) => collector.add(blob));
    try {
      const { pageNumber: pageCount } = await renderPreparedContents({
        contents: clonedContents,
        viewport,
        mount,
        signal,
        onProgress,
        onPage: consumePage,
        pageNumberStart: 0,
        sourceCompleted: 1,
        sourceTotal: 1,
        imageStats
      });
      const output = collector ? await collector.finish() : {
        kind: pageCount > 1 ? 'zip' : 'png',
        blob: null,
        fileName: pageCount > 1
          ? `${imageExportBaseName(fileName)}-\u56fe\u7247.zip`
          : `${imageExportBaseName(fileName)}.png`,
        pageCount
      };
      return { ...output, ...imageStats };
    } catch (error) {
      collector?.abort();
      throw error;
    } finally {
      inlineResult.release();
    }
  } finally {
    stage.remove();
  }
}
