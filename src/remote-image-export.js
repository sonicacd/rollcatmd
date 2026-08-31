const DEFAULT_LIMITS = Object.freeze({
  concurrency: 3,
  timeoutMs: 10_000,
  maxImageBytes: 8 * 1024 * 1024,
  maxImages: 32,
  maxTotalBytes: 32 * 1024 * 1024,
  maxRedirects: 3
});

const SUPPORTED_IMAGE_TYPES = new Map([
  ['image/png', 'image/png'],
  ['image/jpeg', 'image/jpeg'],
  ['image/jpg', 'image/jpeg'],
  ['image/gif', 'image/gif'],
  ['image/webp', 'image/webp']
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const REMOTE_IMAGE_EXPORT_LIMITS = DEFAULT_LIMITS;

function createAbortError(reason) {
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason;
  }

  if (typeof DOMException === 'function') {
    return new DOMException('图片导出已取消', 'AbortError');
  }

  const error = new Error('图片导出已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError(signal.reason);
  }
}

function parseIpv4(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return null;
  }

  const values = parts.map(Number);
  return values.every((value) => value >= 0 && value <= 255) ? values : null;
}

function parseIpv6(hostname) {
  const unwrapped = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!unwrapped.includes(':') || unwrapped.includes('%')) {
    return null;
  }

  const halves = unwrapped.split('::');
  if (halves.length > 2) {
    return null;
  }

  const expandSide = (value) => {
    if (!value) {
      return [];
    }
    const pieces = value.split(':');
    const final = pieces.at(-1);
    if (final?.includes('.')) {
      const ipv4 = parseIpv4(final);
      if (!ipv4) {
        return null;
      }
      pieces.splice(
        pieces.length - 1,
        1,
        ((ipv4[0] << 8) | ipv4[1]).toString(16),
        ((ipv4[2] << 8) | ipv4[3]).toString(16)
      );
    }
    if (pieces.some((piece) => !/^[\da-f]{1,4}$/.test(piece))) {
      return null;
    }
    return pieces.map((piece) => Number.parseInt(piece, 16));
  };

  const left = expandSide(halves[0]);
  const right = expandSide(halves[1] || '');
  if (!left || !right) {
    return null;
  }

  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }

  const missing = 8 - left.length - right.length;
  if (missing < 1) {
    return null;
  }
  return [...left, ...new Array(missing).fill(0), ...right];
}

function isPublicIpv4(parts) {
  const [a, b, c] = parts;
  return !(
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  );
}

function isPublicIpv6(words) {
  const allZero = words.every((word) => word === 0);
  const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  const uniqueLocal = (words[0] & 0xfe00) === 0xfc00;
  const linkLocal = (words[0] & 0xffc0) === 0xfe80;
  const multicast = (words[0] & 0xff00) === 0xff00;
  const documentation = words[0] === 0x2001 && words[1] === 0x0db8;
  const ipv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const ipv4Compatible = words.slice(0, 6).every((word) => word === 0);
  if (ipv4Mapped || ipv4Compatible) {
    return isPublicIpv4([
      words[6] >> 8,
      words[6] & 0xff,
      words[7] >> 8,
      words[7] & 0xff
    ]);
  }
  return !(allZero || loopback || uniqueLocal || linkLocal || multicast || documentation);
}

function isPublicHostname(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    return isPublicIpv4(ipv4);
  }

  const ipv6 = parseIpv6(normalized);
  if (ipv6) {
    return isPublicIpv6(ipv6);
  }

  if (
    !normalized.includes('.')
    || normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal')
    || normalized.endsWith('.home.arpa')
  ) {
    return false;
  }

  return /^[\da-z](?:[\da-z.-]*[\da-z])?$/i.test(normalized);
}

export function inspectRemoteImageUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return { remote: false, allowed: false, reason: 'invalid-url', url: null };
  }

  const remote = url.protocol === 'http:' || url.protocol === 'https:';
  if (!remote) {
    return { remote: false, allowed: false, reason: 'not-remote', url };
  }
  if (url.protocol !== 'https:') {
    return { remote: true, allowed: false, reason: 'https-required', url };
  }
  if (url.username || url.password) {
    return { remote: true, allowed: false, reason: 'credentials-not-allowed', url };
  }
  if (!isPublicHostname(url.hostname)) {
    return { remote: true, allowed: false, reason: 'non-public-host', url };
  }

  url.hash = '';
  return { remote: true, allowed: true, reason: null, url };
}

function imageSource(image) {
  return image.currentSrc || image.getAttribute?.('src') || image.src || '';
}

function replaceWithPlaceholder(image) {
  const label = image.ownerDocument.createElement('span');
  const alternative = image.getAttribute?.('alt')?.trim();
  label.className = 'image-export-remote-image';
  label.textContent = alternative
    ? `[网络图片：${alternative}]`
    : '[网络图片未包含]';
  image.replaceWith(label);
}

function hasImageSignature(bytes, contentType) {
  if (contentType === 'image/png') {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return png.every((value, index) => bytes[index] === value);
  }
  if (contentType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/gif') {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  if (contentType === 'image/webp') {
    return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

function createLinkedTimeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) {
    forwardAbort();
  } else {
    parentSignal?.addEventListener('abort', forwardAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('网络图片下载超时'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', forwardAbort);
    }
  };
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The request is already being discarded.
  }
}

async function fetchWithRedirectValidation(startUrl, fetchImpl, {
  nativeRuntime,
  signal,
  timeoutMs,
  maxRedirects
}) {
  let currentUrl = startUrl;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    throwIfAborted(signal);
    const response = await fetchImpl(currentUrl.href, {
      method: 'GET',
      headers: {
        Accept: 'image/png,image/jpeg,image/gif,image/webp'
      },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: nativeRuntime ? 'manual' : 'error',
      signal,
      ...(nativeRuntime
        ? { connectTimeout: timeoutMs, maxRedirections: 0 }
        : {})
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      if (!nativeRuntime || redirectCount === maxRedirects) {
        await cancelResponseBody(response);
        throw new Error('网络图片重定向次数过多');
      }
      const location = response.headers.get('location');
      await cancelResponseBody(response);
      if (!location) {
        throw new Error('网络图片重定向缺少目标地址');
      }
      const inspected = inspectRemoteImageUrl(new URL(location, currentUrl));
      if (!inspected.allowed) {
        throw new Error('网络图片重定向到了非公网 HTTPS 地址');
      }
      currentUrl = inspected.url;
      continue;
    }

    const finalUrl = inspectRemoteImageUrl(response.url || currentUrl);
    if (!finalUrl.allowed) {
      await cancelResponseBody(response);
      throw new Error('网络图片响应来自非公网 HTTPS 地址');
    }
    return response;
  }

  throw new Error('网络图片重定向次数过多');
}

async function readLimitedBody(response, {
  maxImageBytes,
  byteBudget,
  signal
}) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxImageBytes) {
    await cancelResponseBody(response);
    throw new Error('网络图片超过 8 MiB');
  }

  const reader = response.body?.getReader?.();
  const chunks = [];
  let byteLength = 0;
  try {
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!byteBudget.reserve(bytes.byteLength)) {
        throw new Error('网络图片总量超过 32 MiB');
      }
      if (bytes.byteLength > maxImageBytes) {
        throw new Error('网络图片超过 8 MiB');
      }
      return { bytes };
    }

    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      if (!byteBudget.reserve(chunk.byteLength)) {
        throw new Error('网络图片总量超过 32 MiB');
      }
      byteLength += chunk.byteLength;
      if (byteLength > maxImageBytes) {
        throw new Error('网络图片超过 8 MiB');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    try {
      await reader?.cancel(error);
    } catch {
      // The response stream is already closed.
    }
    throw error;
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

function isTauriRuntime() {
  return Boolean(globalThis.window?.__TAURI_INTERNALS__ || globalThis.window?.__TAURI__);
}

async function resolveFetch(fetchImpl, nativeRuntime) {
  if (fetchImpl) {
    return fetchImpl;
  }
  if (nativeRuntime) {
    return (await import('@tauri-apps/plugin-http')).fetch;
  }
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('当前环境不支持下载网络图片');
  }
  return globalThis.fetch.bind(globalThis);
}

function mergeLimits(overrides = {}) {
  const limits = {
    ...DEFAULT_LIMITS,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, value]) => Number.isFinite(value) && value > 0)
    )
  };
  for (const key of [
    'concurrency',
    'timeoutMs',
    'maxImageBytes',
    'maxImages',
    'maxTotalBytes',
    'maxRedirects'
  ]) {
    limits[key] = Math.max(1, Math.floor(limits[key]));
  }
  return limits;
}

/**
 * Downloads supported public HTTPS images in an export-only DOM clone and
 * replaces their URLs with temporary Blob URLs. Call `release()` after the
 * final page has been rendered, even when rendering fails.
 */
export async function inlineRemoteImages(root, {
  signal,
  session,
  onProgress,
  fetchImpl,
  nativeRuntime = isTauriRuntime(),
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
  limits: limitOverrides
} = {}) {
  throwIfAborted(signal);
  const limits = mergeLimits(limitOverrides);
  const remoteEntries = [];
  for (const image of root.querySelectorAll('img')) {
    const inspected = inspectRemoteImageUrl(imageSource(image));
    if (inspected.remote) {
      remoteEntries.push({ image, inspected });
    }
  }

  const failures = [];
  const groups = new Map();
  for (const entry of remoteEntries) {
    if (!entry.inspected.allowed) {
      replaceWithPlaceholder(entry.image);
      failures.push({
        url: entry.inspected.url?.href || imageSource(entry.image),
        reason: entry.inspected.reason,
        occurrences: 1
      });
      continue;
    }

    const key = entry.inspected.url.href;
    const existing = groups.get(key);
    if (existing) {
      existing.images.push(entry.image);
    } else {
      groups.set(key, { url: entry.inspected.url, images: [entry.image] });
    }
  }

  let includedImages = 0;
  let failedImages = failures.reduce((count, failure) => count + failure.occurrences, 0);
  let completed = 0;
  const objectUrls = [];
  const release = () => {
    while (objectUrls.length) {
      revokeObjectURL(objectUrls.pop());
    }
  };
  const exportSession = session || { urls: new Set(), usedBytes: 0, cache: new Map() };
  exportSession.urls ||= new Set();
  exportSession.cache ||= new Map();
  exportSession.usedBytes = Number.isFinite(exportSession.usedBytes)
    ? Math.max(0, exportSession.usedBytes)
    : 0;
  const selectedGroups = [];
  for (const group of groups.values()) {
    const cached = exportSession.cache.get(group.url.href);
    if (cached?.ok) {
      const objectUrl = createObjectURL(new Blob([cached.bytes], { type: cached.contentType }));
      objectUrls.push(objectUrl);
      for (const image of group.images) {
        image.removeAttribute?.('srcset');
        image.removeAttribute?.('sizes');
        image.removeAttribute?.('crossorigin');
        image.setAttribute?.('src', objectUrl);
        if ('src' in image) {
          image.src = objectUrl;
        }
      }
      includedImages += group.images.length;
      continue;
    }
    if (cached && !cached.ok) {
      for (const image of group.images) {
        replaceWithPlaceholder(image);
      }
      failedImages += group.images.length;
      failures.push({
        url: group.url.href,
        reason: cached.reason,
        occurrences: group.images.length
      });
      continue;
    }
    if (!exportSession.urls.has(group.url.href) && exportSession.urls.size >= limits.maxImages) {
      for (const image of group.images) {
        replaceWithPlaceholder(image);
      }
      failedImages += group.images.length;
      failures.push({
        url: group.url.href,
        reason: 'image-count-limit',
        occurrences: group.images.length
      });
      continue;
    }
    exportSession.urls.add(group.url.href);
    selectedGroups.push(group);
  }

  const reportProgress = () => onProgress?.({
    phase: 'downloading-images',
    completed,
    total: selectedGroups.length,
    pageCount: 0,
    includedImages,
    failedImages
  });
  reportProgress();

  if (!selectedGroups.length) {
    return {
      includedImages,
      failedImages,
      downloadedImages: 0,
      failures,
      release
    };
  }

  let requestFetch;
  try {
    requestFetch = await resolveFetch(fetchImpl, nativeRuntime);
  } catch (error) {
    throwIfAborted(signal);
    for (const group of selectedGroups) {
      for (const image of group.images) {
        replaceWithPlaceholder(image);
      }
      const reason = String(error?.message || error);
      exportSession.cache.set(group.url.href, { ok: false, reason });
      failures.push({
        url: group.url.href,
        reason,
        occurrences: group.images.length
      });
      failedImages += group.images.length;
      completed += 1;
      reportProgress();
    }
    return {
      includedImages,
      failedImages,
      downloadedImages: 0,
      failures,
      release
    };
  }
  const byteBudget = {
    reserve(size) {
      if (exportSession.usedBytes + size > limits.maxTotalBytes) {
        return false;
      }
      exportSession.usedBytes += size;
      return true;
    }
  };
  let nextIndex = 0;
  let downloadedImages = 0;

  const worker = async () => {
    while (nextIndex < selectedGroups.length) {
      if (signal?.aborted) {
        return;
      }
      const group = selectedGroups[nextIndex];
      nextIndex += 1;
      const requestSignal = createLinkedTimeoutSignal(signal, limits.timeoutMs);
      try {
        const response = await fetchWithRedirectValidation(group.url, requestFetch, {
          nativeRuntime,
          signal: requestSignal.signal,
          timeoutMs: limits.timeoutMs,
          maxRedirects: limits.maxRedirects
        });
        if (!response.ok) {
          await cancelResponseBody(response);
          throw new Error(`网络图片请求失败（HTTP ${response.status}）`);
        }

        const declaredType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
        const contentType = SUPPORTED_IMAGE_TYPES.get(declaredType);
        if (!contentType) {
          await cancelResponseBody(response);
          throw new Error('网络图片格式不支持');
        }

        const body = await readLimitedBody(response, {
          maxImageBytes: limits.maxImageBytes,
          byteBudget,
          signal: requestSignal.signal
        });
        if (!hasImageSignature(body.bytes, contentType)) {
          throw new Error('网络图片内容与格式不匹配');
        }

        exportSession.cache.set(group.url.href, {
          ok: true,
          bytes: body.bytes,
          contentType
        });
        const objectUrl = createObjectURL(new Blob([body.bytes], { type: contentType }));
        objectUrls.push(objectUrl);
        for (const image of group.images) {
          image.removeAttribute?.('srcset');
          image.removeAttribute?.('sizes');
          image.removeAttribute?.('crossorigin');
          image.setAttribute?.('src', objectUrl);
          if ('src' in image) {
            image.src = objectUrl;
          }
        }
        includedImages += group.images.length;
        downloadedImages += 1;
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        const reason = requestSignal.timedOut ? 'timeout' : String(error?.message || error);
        exportSession.cache.set(group.url.href, { ok: false, reason });
        for (const image of group.images) {
          replaceWithPlaceholder(image);
        }
        failedImages += group.images.length;
        failures.push({
          url: group.url.href,
          reason,
          occurrences: group.images.length
        });
      } finally {
        requestSignal.dispose();
        completed += 1;
        reportProgress();
      }
    }
  };

  const workerResults = await Promise.allSettled(
    new Array(Math.min(limits.concurrency, selectedGroups.length))
      .fill(null)
      .map(() => worker())
  );

  const rejectedWorker = workerResults.find((result) => result.status === 'rejected');
  if (rejectedWorker) {
    release();
    throw rejectedWorker.reason;
  }

  if (signal?.aborted) {
    release();
    throw createAbortError(signal.reason);
  }

  return {
    includedImages,
    failedImages,
    downloadedImages,
    failures,
    release
  };
}
