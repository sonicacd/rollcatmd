import { BaseDirectory } from '@tauri-apps/api/path';
import { create, open, remove } from '@tauri-apps/plugin-fs';

const COPY_BUFFER_BYTES = 1024 * 1024;

export async function writeAll(file, data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let offset = 0;

  while (offset < bytes.byteLength) {
    const written = await file.write(bytes.subarray(offset));
    if (!Number.isInteger(written) || written <= 0) {
      throw new Error('\u5199\u5165\u5206\u9875\u56fe\u7247\u65f6\u672a\u5199\u5165\u4efb\u4f55\u6570\u636e');
    }
    offset += written;
  }
}

function exportTempName(randomUUID) {
  const id = randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `image-export-${id}.zip`;
}

/**
 * Streams a ZIP into the application cache. The chosen destination is not
 * touched until commit(), so cancelling a long export cannot overwrite it.
 */
export async function createNativeArchiveTemp({
  createFile = create,
  openFile = open,
  removeFile = remove,
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
} = {}) {
  const tempPath = exportTempName(randomUUID);
  let output = await createFile(tempPath, { baseDir: BaseDirectory.AppCache });
  let removed = false;
  let tempSize = 0;

  const closeOutput = async () => {
    if (!output) {
      return;
    }
    const current = output;
    output = null;
    await current.close();
  };

  const removeTemp = async () => {
    if (removed) {
      return;
    }
    removed = true;
    await removeFile(tempPath, { baseDir: BaseDirectory.AppCache });
  };

  return {
    tempPath,

    async write(chunk) {
      if (!output) {
        throw new Error('\u5206\u9875\u56fe\u7247\u4e34\u65f6\u6587\u4ef6\u5df2\u5173\u95ed');
      }
      await writeAll(output, chunk);
      tempSize += chunk.byteLength;
    },

    async finish() {
      await closeOutput();
    },

    async discard() {
      try {
        await closeOutput();
      } finally {
        try {
          await removeTemp();
        } catch (error) {
          console.warn('\u6e05\u7406\u56fe\u7247\u5bfc\u51fa\u4e34\u65f6\u6587\u4ef6\u5931\u8d25', error);
        }
      }
    },

    async commit(targetPath, onProgress) {
      await closeOutput();
      let source = null;
      let target = null;

      try {
        source = await openFile(tempPath, {
          read: true,
          baseDir: BaseDirectory.AppCache
        });
        target = await openFile(targetPath, {
          write: true,
          truncate: true,
          create: true
        });

        const buffer = new Uint8Array(COPY_BUFFER_BYTES);
        let copied = 0;
        while (true) {
          const read = await source.read(buffer);
          if (read === null) {
            break;
          }
          if (read <= 0) {
            throw new Error('\u8bfb\u53d6\u5206\u9875\u56fe\u7247\u4e34\u65f6\u6587\u4ef6\u5931\u8d25');
          }
          await writeAll(target, buffer.subarray(0, read));
          copied += read;
          onProgress?.({ completed: copied, total: tempSize });
        }

        return { bytesWritten: copied };
      } finally {
        await Promise.allSettled([source?.close(), target?.close()]);
        await removeTemp();
      }
    }
  };
}
