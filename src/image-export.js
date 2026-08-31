export const MAX_CANVAS_SIDE = 4096;
export const MAX_CANVAS_PIXELS = 16_000_000;
// 720 CSS pixels at 2x produces a 1440px-wide image. Two portrait A4 pages
// stacked vertically are 2 * sqrt(2) times as tall as they are wide.
export const DEFAULT_IMAGE_EXPORT_WIDTH = 720;
export const DEFAULT_IMAGE_EXPORT_SCALE = 2;
export const DEFAULT_IMAGE_EXPORT_PAGE_HEIGHT = Math.floor(
  DEFAULT_IMAGE_EXPORT_WIDTH * Math.SQRT2 * 2
);

const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError(`${name} 必须是大于 0 的有限数字`);
  }
  return number;
}

export function deriveMaxCanvasCssHeight({
  width = DEFAULT_IMAGE_EXPORT_WIDTH,
  scale = DEFAULT_IMAGE_EXPORT_SCALE,
  maxCanvasSide = MAX_CANVAS_SIDE,
  maxCanvasPixels = MAX_CANVAS_PIXELS
} = {}) {
  const cssWidth = positiveNumber(width, '导出宽度');
  const pixelScale = positiveNumber(scale, '导出缩放');
  const sideLimit = Math.floor(positiveNumber(maxCanvasSide, 'Canvas 边长上限'));
  const pixelLimit = Math.floor(positiveNumber(maxCanvasPixels, 'Canvas 像素上限'));
  const pixelWidth = Math.ceil(cssWidth * pixelScale);

  if (pixelWidth > sideLimit) {
    throw new RangeError(`导出宽度 ${pixelWidth}px 超过 Canvas 边长上限 ${sideLimit}px`);
  }

  const pixelHeight = Math.min(sideLimit, Math.floor(pixelLimit / pixelWidth));
  const cssHeight = Math.floor(pixelHeight / pixelScale);
  if (cssHeight < 1) {
    throw new RangeError('当前宽度和缩放倍率没有可用的 Canvas 高度');
  }
  return cssHeight;
}

function displayFileName(fileName) {
  let decoded = String(fileName || '未命名.md');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep malformed provider URIs usable as export names.
  }
  const withoutQuery = decoded.split(/[?#]/, 1)[0];
  return withoutQuery.split(/[\\/]/).filter(Boolean).at(-1) || '未命名.md';
}

export function imageExportBaseName(fileName) {
  const displayName = displayFileName(fileName);
  const extensionIndex = displayName.lastIndexOf('.');
  let baseName = (extensionIndex > 0 ? displayName.slice(0, extensionIndex) : displayName)
    .replace(INVALID_FILE_NAME_CHARACTERS, '_')
    .replace(/[. ]+$/g, '')
    .trim();

  if (!baseName || baseName === '.' || baseName === '..') {
    baseName = '未命名';
  }
  return WINDOWS_RESERVED_FILE_NAME.test(baseName) ? `_${baseName}` : baseName;
}

export function buildImagePageFileName(fileName, pageNumber, pageCount) {
  const digits = Math.max(3, String(pageCount).length);
  return pageCount === 1
    ? `${imageExportBaseName(fileName)}.png`
    : `${imageExportBaseName(fileName)}-${String(pageNumber).padStart(digits, '0')}.png`;
}

export function buildStreamingImagePageFileName(fileName, pageNumber) {
  return `${imageExportBaseName(fileName)}-${String(pageNumber).padStart(4, '0')}.png`;
}

export function createImageExportPlan({
  contentHeight,
  fileName = '未命名.md',
  width = DEFAULT_IMAGE_EXPORT_WIDTH,
  scale = DEFAULT_IMAGE_EXPORT_SCALE,
  pageHeight
}) {
  const rawHeight = Number(contentHeight);
  if (!Number.isFinite(rawHeight) || rawHeight < 0) {
    throw new RangeError('渲染内容高度必须是大于或等于 0 的有限数字');
  }

  const contentCssHeight = Math.max(1, Math.ceil(rawHeight));
  const cssWidth = positiveNumber(width, '导出宽度');
  const pixelScale = positiveNumber(scale, '导出缩放');
  const safePageCssHeight = deriveMaxCanvasCssHeight({ width: cssWidth, scale: pixelScale });
  const pageCssHeight = pageHeight === undefined
    ? Math.min(safePageCssHeight, DEFAULT_IMAGE_EXPORT_PAGE_HEIGHT)
    : Math.min(safePageCssHeight, Math.floor(positiveNumber(pageHeight, '单页高度')));
  const pageCount = Math.ceil(contentCssHeight / pageCssHeight);

  return Object.freeze({
    fileName: displayFileName(fileName),
    baseName: imageExportBaseName(fileName),
    cssWidth,
    pixelWidth: Math.ceil(cssWidth * pixelScale),
    scale: pixelScale,
    contentCssHeight,
    pageCssHeight,
    pageCount
  });
}

export function* iterateImageExportPages(plan) {
  for (let index = 0; index < plan.pageCount; index += 1) {
    const offsetY = index * plan.pageCssHeight;
    const cssHeight = Math.min(plan.pageCssHeight, plan.contentCssHeight - offsetY);
    yield Object.freeze({
      index,
      pageNumber: index + 1,
      pageCount: plan.pageCount,
      offsetY,
      cssWidth: plan.cssWidth,
      cssHeight,
      pixelWidth: plan.pixelWidth,
      pixelHeight: Math.ceil(cssHeight * plan.scale),
      fileName: buildImagePageFileName(plan.fileName, index + 1, plan.pageCount)
    });
  }
}

export async function imageDataToUint8Array(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new TypeError('图片数据必须是 Blob、ArrayBuffer 或 Uint8Array');
}
