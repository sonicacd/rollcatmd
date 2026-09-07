export const MAX_LOCAL_IMAGE_BYTES = 32 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

function aborted(signal) {
  if (signal?.aborted) throw new DOMException('图片操作已取消', 'AbortError');
}

export function isRelativeImageSource(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  let source;
  try { source = decodeURIComponent(value.trim().split(/[?#]/, 1)[0]).replaceAll('\\', '/'); }
  catch { return false; }
  return Boolean(source) && !source.startsWith('/') && !source.includes(':')
    && !/[\u0000-\u001f\u007f]/.test(source) && !source.split('/').includes('..');
}

async function nativeInvoke(override) {
  if (override) return override;
  return (await import('@tauri-apps/api/core')).invoke;
}

function sourceOf(image) {
  // getAttribute preserves a relative reference; .src expands it against the app URL.
  return image.getAttribute?.('data-local-image-source') || image.getAttribute?.('src') || '';
}

function decodeImage(result) {
  if (!IMAGE_TYPES.has(result?.mime) || typeof result.base64 !== 'string') throw new Error('本地图片响应格式无效');
  if (result.base64.length > Math.ceil(MAX_LOCAL_IMAGE_BYTES / 3) * 4) throw new Error('每张图片最多 32 MiB');
  const binary = atob(result.base64);
  if (binary.length > MAX_LOCAL_IMAGE_BYTES) throw new Error('每张图片最多 32 MiB');
  return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: result.mime });
}

function markFailure(image, error, replaceFailed) {
  const message = String(error?.message || error);
  if (replaceFailed && image.ownerDocument?.createElement && image.replaceWith) {
    const placeholder = image.ownerDocument.createElement('span');
    placeholder.className = 'image-export-local-image';
    placeholder.textContent = `[本地图片：${image.getAttribute('alt') || sourceOf(image)}；${message}]`;
    image.replaceWith(placeholder);
  } else {
    if (!image.getAttribute?.('data-local-image-error')) image.setAttribute?.('data-local-image-original-title', image.getAttribute?.('title') || '');
    image.setAttribute?.('title', `本地图片加载失败：${message}`);
    image.setAttribute?.('data-local-image-error', message);
  }
}

function clearFailure(image) {
  if (image.getAttribute?.('data-local-image-error')) {
    const originalTitle = image.getAttribute('data-local-image-original-title');
    if (originalTitle) image.setAttribute('title', originalTitle);
    else image.removeAttribute('title');
    image.removeAttribute('data-local-image-original-title');
    image.removeAttribute('data-local-image-error');
  }
}

/** Hydrate an export clone. Keep returned URLs alive until image rendering ends. */
export async function inlineLocalImages(root, {
  documentPath, invoke, signal, replaceFailed = true,
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url)
} = {}) {
  aborted(signal);
  const images = Array.from(root.querySelectorAll('img')).filter((image) => isRelativeImageSource(sourceOf(image)));
  const groups = new Map();
  for (const image of images) {
    const source = sourceOf(image);
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(image);
  }
  const urls = [];
  const release = () => { while (urls.length) revokeObjectURL(urls.pop()); };
  const failures = [];
  let includedImages = 0;
  let failedImages = 0;
  try {
    const call = groups.size && documentPath ? await nativeInvoke(invoke) : null;
    for (const [source, matches] of groups) {
      aborted(signal);
      try {
        if (!documentPath) throw new Error('请先打开或保存文档，以确定图片所属目录');
        const blob = decodeImage(await call('read_local_image', { documentPath, source }));
        aborted(signal);
        const url = createObjectURL(blob);
        urls.push(url);
        for (const image of matches) {
          image.setAttribute('data-local-image-source', source);
          image.removeAttribute?.('srcset');
          image.removeAttribute?.('crossorigin');
          clearFailure(image);
          image.setAttribute('src', url);
        }
        includedImages += matches.length;
      } catch (error) {
        aborted(signal);
        failedImages += matches.length;
        failures.push({ source, reason: String(error?.message || error), occurrences: matches.length });
        for (const image of matches) markFailure(image, error, replaceFailed);
      }
    }
    return { includedImages, failedImages, failures, release };
  } catch (error) { release(); throw error; }
}

export const resolveLocalImages = inlineLocalImages;

/** Watches a live reading/editor view. Dispose before changing documentPath. */
export function hydrateLocalImages(root, {
  documentPath, invoke, signal, onError,
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url)
} = {}) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  const cache = new Map();
  const visited = new WeakMap();
  const urls = new Map();
  let disposed = false;
  let timer;
  let pending = Promise.resolve();
  const scan = async () => {
    if (disposed || controller.signal.aborted) return;
    for (const image of root.querySelectorAll('img')) {
      const rawSource = image.getAttribute('src') || '';
      // Source edits must invalidate the retained display reference.
      if (!rawSource.startsWith('blob:') && rawSource !== image.getAttribute('data-local-image-source')) {
        image.removeAttribute('data-local-image-source');
      }
      const source = sourceOf(image);
      if (!isRelativeImageSource(source) || visited.get(image) === source) continue;
      visited.set(image, source);
      try {
        if (!documentPath) throw new Error('请先打开或保存文档，以确定图片所属目录');
        if (!cache.has(source)) cache.set(source, (async () => {
          const call = await nativeInvoke(invoke);
          const blob = decodeImage(await call('read_local_image', { documentPath, source }));
          aborted(controller.signal);
          const url = createObjectURL(blob);
          if (urls.has(source)) revokeObjectURL(urls.get(source));
          urls.set(source, url);
          return url;
        })());
        const url = await cache.get(source);
        aborted(controller.signal);
        // An editor may have replaced the node while native I/O was pending.
        if (sourceOf(image) !== source || (root.contains && !root.contains(image))) continue;
        image.setAttribute('data-local-image-source', source);
        image.removeAttribute('srcset');
        image.removeAttribute('crossorigin');
        clearFailure(image);
        image.setAttribute('src', url);
      } catch (error) {
        if (controller.signal.aborted) return;
        markFailure(image, error, false);
        onError?.({ source, error });
      }
    }
    // Virtualized large-document views remove offscreen nodes. Their blobs can
    // be released and loaded again when those source lines re-enter the view.
    const visibleSources = new Set(Array.from(root.querySelectorAll('img'), sourceOf));
    for (const [source, url] of urls) {
      if (!visibleSources.has(source)) { revokeObjectURL(url); urls.delete(source); cache.delete(source); }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { pending = pending.then(scan); }, 60);
  };
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
  observer?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  pending = scan();
  const release = () => {
    disposed = true;
    controller.abort();
    observer?.disconnect();
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
    cache.clear();
    for (const url of urls.values()) revokeObjectURL(url);
    urls.clear();
  };
  release.ready = pending;
  release.refresh = () => { cache.clear(); for (const image of root.querySelectorAll('img')) visited.delete(image); schedule(); };
  return release;
}

export async function persistDocumentImage(blob, { documentPath, invoke, signal, mime = blob?.type } = {}) {
  aborted(signal);
  if (!documentPath) throw new Error('请先保存文档，再插入图片');
  if (!IMAGE_TYPES.has(mime)) throw new Error('支持 PNG、JPEG、GIF 和 WebP 图片；暂不支持 SVG');
  if ((blob?.size ?? blob?.byteLength ?? 0) > MAX_LOCAL_IMAGE_BYTES) throw new Error('每张图片最多 32 MiB');
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_LOCAL_IMAGE_BYTES) throw new Error('每张图片最多 32 MiB');
  aborted(signal);
  const call = await nativeInvoke(invoke);
  const result = await call('write_document_image', { documentPath, bytes: Array.from(bytes), mime });
  aborted(signal);
  if (!isRelativeImageSource(result?.relativePath)) throw new Error('保存附件未返回有效的相对路径');
  return result.relativePath;
}

function isNative() { return Boolean(globalThis.window?.__TAURI_INTERNALS__ || globalThis.window?.__TAURI__); }

export async function copyImageBlob(blob, { invoke, nativeRuntime = isNative() } = {}) {
  if (blob.type !== 'image/png') throw new Error('剪贴板图片须为 PNG 格式');
  if (blob.size > MAX_LOCAL_IMAGE_BYTES) throw new Error('复制图片超过 32 MiB，请缩小选中范围');
  if (nativeRuntime || invoke) {
    const call = await nativeInvoke(invoke);
    await call('copy_image_clipboard', { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
  } else {
    if (!globalThis.ClipboardItem || !globalThis.navigator?.clipboard?.write) throw new Error('当前环境不支持复制图片，请使用导出图片');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }
}

export async function copyText(text, { invoke, nativeRuntime = isNative() } = {}) {
  if (nativeRuntime || invoke) {
    const call = await nativeInvoke(invoke);
    await call('copy_text_clipboard', { text: String(text) });
  } else {
    if (!globalThis.navigator?.clipboard?.writeText) throw new Error('当前环境不支持复制文本');
    await navigator.clipboard.writeText(String(text));
  }
}
