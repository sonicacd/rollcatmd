import { Zip, ZipPassThrough } from 'fflate';

import {
  buildStreamingImagePageFileName,
  imageDataToUint8Array,
  imageExportBaseName
} from './image-export.js';
import { abortError, throwIfAborted } from './markdown-export-chunks.js';

export const MAX_BROWSER_IMAGE_ARCHIVE_BYTES = 128 * 1024 * 1024;

export function createImagePageCollector({
  fileName,
  forceArchive = false,
  signal,
  writeArchiveChunk,
  maximumArchiveBytes = MAX_BROWSER_IMAGE_ARCHIVE_BYTES
}) {
  let pageCount = 0;
  let firstPage = null;
  let zip = null;
  let chunks = [];
  let totalBytes = 0;
  let writeQueue = Promise.resolve();
  let resolveZip;
  let rejectZip;
  let settled = false;
  let stopped = false;
  const zipFinished = new Promise((resolve, reject) => {
    resolveZip = resolve;
    rejectZip = reject;
  });
  zipFinished.catch(() => {});

  const fail = (error) => {
    if (!settled) {
      settled = true;
      rejectZip(error);
    }
  };

  const ensureZip = () => {
    if (zip) {
      return;
    }
    zip = new Zip((error, chunk, final) => {
      if (error) {
        fail(error);
        return;
      }
      if (stopped) {
        return;
      }

      totalBytes += chunk.byteLength;
      if (!writeArchiveChunk && totalBytes > maximumArchiveBytes) {
        const limitError = new Error('\u5206\u9875\u56fe\u7247\u8d85\u8fc7 128 MiB\uff0c\u8bf7\u4f7f\u7528 Windows/Android \u7248\u6216\u62c6\u5206\u6587\u6863');
        stopped = true;
        zip?.terminate();
        fail(limitError);
        return;
      }

      if (writeArchiveChunk) {
        writeQueue = writeQueue.then(() => writeArchiveChunk(chunk));
      } else {
        chunks.push(chunk);
      }

      if (final) {
        writeQueue.then(() => {
          if (settled) {
            return;
          }
          settled = true;
          resolveZip(writeArchiveChunk
            ? null
            : new Blob(chunks, { type: 'application/zip' }));
        }, fail);
      }
    });
  };

  const addToZip = async (blob, number) => {
    throwIfAborted(signal);
    ensureZip();
    const bytes = await imageDataToUint8Array(blob);
    throwIfAborted(signal);
    const entry = new ZipPassThrough(buildStreamingImagePageFileName(fileName, number));
    zip.add(entry);
    entry.push(bytes, true);
    await writeQueue;
  };

  return {
    get pageCount() {
      return pageCount;
    },

    async add(blob) {
      throwIfAborted(signal);
      pageCount += 1;
      if (pageCount === 1 && !forceArchive) {
        firstPage = blob;
        return;
      }
      if (pageCount === 2 && firstPage) {
        await addToZip(firstPage, 1);
        firstPage = null;
      }
      await addToZip(blob, pageCount);
    },

    async finish() {
      throwIfAborted(signal);
      if (pageCount === 0) {
        throw new Error('\u6ca1\u6709\u53ef\u4fdd\u5b58\u7684\u56fe\u7247\u9875');
      }
      if (pageCount === 1 && !forceArchive) {
        return {
          kind: 'png',
          blob: firstPage,
          fileName: `${imageExportBaseName(fileName)}.png`,
          pageCount,
          byteLength: firstPage.size
        };
      }
      zip.end();
      const blob = await zipFinished;
      throwIfAborted(signal);
      chunks = [];
      return {
        kind: 'zip',
        blob,
        fileName: `${imageExportBaseName(fileName)}-\u56fe\u7247.zip`,
        pageCount,
        byteLength: totalBytes
      };
    },

    abort() {
      if (stopped) {
        return;
      }
      stopped = true;
      zip?.terminate();
      firstPage = null;
      chunks = [];
      fail(signal?.reason instanceof Error ? signal.reason : abortError());
    }
  };
}
