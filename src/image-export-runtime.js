import { Zip, ZipPassThrough } from 'fflate';
import { toBlob as elementToBlob } from 'html-to-image';
import {
  DEFAULT_IMAGE_EXPORT_SCALE,
  DEFAULT_IMAGE_EXPORT_WIDTH,
  createImageExportPlan,
  deriveMaxCanvasCssHeight,
  imageDataToUint8Array,
  iterateImageExportPages
} from './image-export.js';

const SOURCE_FONT_SIZE = 16;
const SOURCE_LINE_HEIGHT = 24;
const SOURCE_TOP = 72;
const SOURCE_BOTTOM = 40;
const SOURCE_SIDE = 48;
const MAX_RENDERED_IMAGE_PAGES = 12;
const MAX_SOURCE_IMAGE_PAGES = 2000;
const MAX_IMAGE_ARCHIVE_BYTES = 128 * 1024 * 1024;
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function cssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function waitForImages(root, timeout = 3000) {
  const pending = [...root.querySelectorAll('img')].filter((image) => !image.complete);

  if (!pending.length) {
    return Promise.resolve();
  }

  const settled = Promise.all(pending.map((image) => new Promise((resolve) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', resolve, { once: true });
  })));

  return Promise.race([
    settled,
    new Promise((resolve) => window.setTimeout(resolve, timeout))
  ]);
}

function replaceRemoteImages(root) {
  for (const image of root.querySelectorAll('img')) {
    const source = image.currentSrc || image.getAttribute('src') || '';
    if (!/^https?:\/\//i.test(source)) {
      continue;
    }

    const label = document.createElement('span');
    const alternative = image.getAttribute('alt')?.trim();
    label.className = 'image-export-remote-image';
    label.textContent = alternative
      ? `[网络图片：${alternative}]`
      : '[网络图片未包含]';
    image.replaceWith(label);
  }
}

function createZipCollector() {
  const chunks = [];
  let totalBytes = 0;
  let resolveFinished;
  let rejectFinished;
  const finished = new Promise((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      rejectFinished(error);
      return;
    }

    chunks.push(chunk);
    if (final) {
      resolveFinished(new Blob(chunks, { type: 'application/zip' }));
    }
  });

  return {
    async add(fileName, data) {
      const bytes = await imageDataToUint8Array(data);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_IMAGE_ARCHIVE_BYTES) {
        throw new Error('分页图片超过 128 MiB，请拆分文档后再导出');
      }

      const file = new ZipPassThrough(fileName);
      zip.add(file);
      file.push(bytes, true);
    },
    close() {
      zip.end();
      return finished;
    }
  };
}

async function collectPages(plan, renderPage, onProgress) {
  let singlePage = null;
  const archive = plan.pageCount > 1 ? createZipCollector() : null;

  for (const page of iterateImageExportPages(plan)) {
    onProgress?.(page.pageNumber, page.pageCount);
    const data = await renderPage(page);
    if (archive) {
      await archive.add(page.fileName, data);
    } else {
      singlePage = data;
    }
  }

  if (!archive) {
    return {
      blob: singlePage,
      fileName: `${plan.baseName}.png`,
      pageCount: plan.pageCount
    };
  }

  return {
    blob: await archive.close(),
    fileName: `${plan.baseName}-图片.zip`,
    pageCount: plan.pageCount
  };
}

export async function renderMarkdownAsImages({
  contents,
  fileName,
  lineSource,
  onProgress
}) {
  const stage = document.createElement('div');
  const viewport = document.createElement('div');
  const clonedContents = contents.cloneNode(true);
  stage.className = 'reader-panel image-export-stage';
  viewport.className = 'image-export-viewport';
  clonedContents.classList.add('image-export-content');
  viewport.append(clonedContents);
  stage.append(viewport);
  document.body.append(stage);

  try {
    replaceRemoteImages(clonedContents);
    await document.fonts?.ready;
    await waitForImages(clonedContents);
    const contentHeight = Math.max(1, Math.ceil(clonedContents.scrollHeight));
    const plan = createImageExportPlan({ contentHeight, fileName });
    const backgroundColor = cssColor('--surface', '#ffffff');

    if (plan.pageCount > MAX_RENDERED_IMAGE_PAGES && lineSource) {
      stage.remove();
      return await renderSourceAsImages({ lineSource, fileName, onProgress });
    }

    return await collectPages(plan, async (page) => {
      viewport.style.width = `${page.cssWidth}px`;
      viewport.style.height = `${page.cssHeight}px`;
      clonedContents.style.transform = `translateY(-${page.offsetY}px)`;
      const blob = await elementToBlob(viewport, {
        width: page.cssWidth,
        height: page.cssHeight,
        pixelRatio: plan.scale,
        backgroundColor,
        imagePlaceholder: TRANSPARENT_PIXEL,
        fontEmbedCSS: '',
        skipAutoScale: true
      });

      if (!blob) {
        throw new Error('浏览器没有生成图片数据');
      }

      return blob;
    }, onProgress);
  } finally {
    stage.remove();
  }
}

function* wrapSourceLine(context, source, maximumWidth, startOffset = 0) {
  const text = String(source);

  if (!text) {
    if (startOffset === 0) {
      yield { text: '', start: 0, end: 0 };
    }
    return;
  }

  const minimumAdvance = Math.max(
    1,
    Math.min(
      context.measureText('i').width,
      context.measureText(' ').width,
      context.measureText('.').width
    )
  );
  const maximumCharacters = Math.max(32, Math.ceil(maximumWidth / minimumAdvance) + 16);
  let start = Math.min(Math.max(0, startOffset), text.length);
  while (start < text.length) {
    let low = start + 1;
    let high = Math.min(text.length, start + maximumCharacters);
    let best = low;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const measured = text.slice(start, middle).replaceAll('\t', '  ');
      if (context.measureText(measured).width <= maximumWidth) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (/^[\uDC00-\uDFFF]$/.test(text[best]) && best > start + 1) {
      best -= 1;
    }

    const candidate = text.slice(start, best);
    const softBreak = candidate.search(/\s+\S*$/);
    if (softBreak > Math.floor(candidate.length * 0.6)) {
      best = start + softBreak + candidate.slice(softBreak).match(/^\s+/)[0].length;
    }

    yield {
      text: text.slice(start, best).replaceAll('\t', '  ').replace(/\s+$/u, ''),
      start,
      end: best
    };
    start = best;
  }
}

function buildSourcePageStarts(lineSource, context, maximumWidth, rowsPerPage) {
  const starts = [];
  let row = 0;

  for (let lineNumber = 1; lineNumber <= lineSource.lineCount; lineNumber += 1) {
    for (const segment of wrapSourceLine(context, lineSource.getLine(lineNumber), maximumWidth)) {
      if (row % rowsPerPage === 0) {
        starts.push({ lineNumber, offset: segment.start });
        if (starts.length > MAX_SOURCE_IMAGE_PAGES) {
          throw new Error('分页图片超过 2,000 页，请拆分文档后再导出');
        }
      }
      row += 1;
    }
  }

  return starts.length ? starts : [{ lineNumber: 1, offset: 0 }];
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('浏览器没有生成 PNG 图片'));
      }
    }, 'image/png');
  });
}

export async function renderSourceAsImages({
  lineSource,
  fileName,
  onProgress
}) {
  let cachedLineNumber = 0;
  let cachedLineText = '';
  const readLine = (lineNumber) => {
    if (lineNumber !== cachedLineNumber) {
      cachedLineNumber = lineNumber;
      cachedLineText = lineSource.getLine(lineNumber);
    }
    return cachedLineText;
  };
  const cssWidth = DEFAULT_IMAGE_EXPORT_WIDTH;
  const scale = DEFAULT_IMAGE_EXPORT_SCALE;
  const pageHeight = deriveMaxCanvasCssHeight({ width: cssWidth, scale });
  const measureCanvas = document.createElement('canvas');
  const measure = measureCanvas.getContext('2d');
  measure.font = `${SOURCE_FONT_SIZE}px "Cascadia Code", Consolas, monospace`;
  const lineNumberWidth = Math.max(56, String(lineSource.lineCount).length * 10 + 24);
  const textWidth = cssWidth - SOURCE_SIDE * 2 - lineNumberWidth;
  const rowsPerPage = Math.max(
    1,
    Math.floor((pageHeight - SOURCE_TOP - SOURCE_BOTTOM) / SOURCE_LINE_HEIGHT)
  );
  const pageStarts = buildSourcePageStarts(
    { lineCount: lineSource.lineCount, getLine: readLine },
    measure,
    textWidth,
    rowsPerPage
  );
  const plan = createImageExportPlan({
    contentHeight: pageStarts.length * pageHeight,
    fileName,
    width: cssWidth,
    scale,
    pageHeight
  });
  const colors = {
    background: cssColor('--surface-deep', '#ffffff'),
    text: cssColor('--text', '#202020'),
    muted: cssColor('--muted', '#666666'),
    line: cssColor('--line', '#dddddd'),
    accent: cssColor('--accent-strong', '#754117')
  };

  return collectPages(plan, async (page) => {
    const canvas = document.createElement('canvas');
    canvas.width = page.pixelWidth;
    canvas.height = page.pixelHeight;
    const context = canvas.getContext('2d');
    context.scale(scale, scale);
    context.fillStyle = colors.background;
    context.fillRect(0, 0, cssWidth, pageHeight);
    context.font = `600 15px ui-sans-serif, "Microsoft YaHei", sans-serif`;
    context.fillStyle = colors.accent;
    context.fillText(fileName, SOURCE_SIDE, 28, cssWidth - SOURCE_SIDE * 2 - 140);
    context.textAlign = 'right';
    context.fillStyle = colors.muted;
    context.fillText(`${page.pageNumber} / ${page.pageCount}`, cssWidth - SOURCE_SIDE, 28);
    context.textAlign = 'left';
    context.strokeStyle = colors.line;
    context.beginPath();
    context.moveTo(SOURCE_SIDE, 54.5);
    context.lineTo(cssWidth - SOURCE_SIDE, 54.5);
    context.stroke();
    context.font = `${SOURCE_FONT_SIZE}px "Cascadia Code", Consolas, monospace`;
    context.textBaseline = 'top';

    const start = pageStarts[page.index];
    let drawnRows = 0;
    for (
      let lineNumber = start.lineNumber;
      lineNumber <= lineSource.lineCount && drawnRows < rowsPerPage;
      lineNumber += 1
    ) {
      const offset = lineNumber === start.lineNumber ? start.offset : 0;
      for (const segment of wrapSourceLine(
        measure,
        readLine(lineNumber),
        textWidth,
        offset
      )) {
        if (drawnRows >= rowsPerPage) {
          break;
        }

        const y = SOURCE_TOP + drawnRows * SOURCE_LINE_HEIGHT;
        context.textAlign = 'right';
        context.fillStyle = colors.muted;
        context.fillText(segment.start === 0 ? String(lineNumber) : '·', SOURCE_SIDE + lineNumberWidth - 18, y);
        context.textAlign = 'left';
        context.fillStyle = colors.text;
        context.fillText(segment.text, SOURCE_SIDE + lineNumberWidth, y);
        drawnRows += 1;
      }
    }

    return canvasToPng(canvas);
  }, onProgress);
}
