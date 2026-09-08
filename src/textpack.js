import { Inflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { decodeUtf8Document } from './text-format.js';
import { LARGE_DOCUMENT_THRESHOLD_BYTES } from './document-size.js';

export const MAX_TEXTPACK_BYTES = 128 * 1024 * 1024;
export const MAX_TEXTPACK_ENTRIES = 4096;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MARKDOWN_TYPE = 'net.daringfireball.markdown';
const encoder = new TextEncoder();
const utf8 = new TextDecoder('utf-8', { fatal: true });
const cp437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function invalid(message = 'ZIP 结构损坏或格式不受支持') {
  return new Error(`无法打开 TextPack：${message}`);
}

function bytesOf(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw invalid('文件数据无效');
}

function checkPath(path) {
  const parts = path.replace(/\/$/, '').split('/');
  if (!path || path.length > 1024 || /[\\:\u0000-\u001f\u007f]/.test(path)
    || parts.some((part) => !part || part === '.' || part === '..')) {
    throw invalid('压缩包包含不安全的文件路径');
  }
}

function decodeName(bytes, flags) {
  try {
    return flags & 0x800 ? utf8.decode(bytes)
      : Array.from(bytes, (byte) => byte < 128 ? String.fromCharCode(byte) : cp437[byte - 128]).join('');
  } catch { throw invalid('压缩包文件名编码无效'); }
}

// Parse and bound every entry before allocating decompressed storage. Never
// extract to disk, and never let a declared output size control an unbounded inflate.
function inspectZip(bytes) {
  if (bytes.byteLength > MAX_TEXTPACK_BYTES) throw invalid('压缩包最多 128 MiB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset) => view.getUint16(offset, true);
  const u32 = (offset) => view.getUint32(offset, true);
  let end = bytes.length - 22;
  const minimum = Math.max(0, end - 65535);
  for (; end >= minimum; end--) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
  }
  if (end < minimum || u16(end + 4) || u16(end + 6)) throw invalid();
  const count = u16(end + 10);
  if (count === 65535 || u32(end + 12) === 0xffffffff || u32(end + 16) === 0xffffffff) {
    throw invalid('暂不支持 ZIP64 压缩包');
  }
  if (!count || count !== u16(end + 8) || count > MAX_TEXTPACK_ENTRIES) throw invalid('压缩包条目数无效或超过 4096');
  const directoryStart = u32(end + 16);
  if (directoryStart + u32(end + 12) !== end) throw invalid();
  let position = directoryStart;
  let total = 0;
  const entries = [];
  const names = new Set();
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || u32(position) !== 0x02014b50) throw invalid();
    const flags = u16(position + 8);
    const method = u16(position + 10);
    const checksum = u32(position + 16);
    const compressedSize = u32(position + 20);
    const size = u32(position + 24);
    const nameLength = u16(position + 28);
    const extraLength = u16(position + 30);
    const next = position + 46 + nameLength + extraLength + u16(position + 32);
    const localOffset = u32(position + 42);
    if (flags & ~0x080e || ![0, 8].includes(method)) throw invalid('不支持加密或此压缩方式');
    if (next > end || u16(position + 34) || localOffset + 30 > directoryStart) throw invalid();
    // Unix symlinks have no useful meaning in a portable document container.
    if (((u32(position + 38) >>> 16) & 0xf000) === 0xa000) throw invalid('压缩包包含符号链接');
    let name = decodeName(bytes.subarray(position + 46, position + 46 + nameLength), flags);
    for (let extra = position + 46 + nameLength; extra < position + 46 + nameLength + extraLength;) {
      if (extra + 4 > position + 46 + nameLength + extraLength) throw invalid();
      const id = u16(extra);
      const length = u16(extra + 2);
      const extraEnd = extra + 4 + length;
      if (extraEnd > position + 46 + nameLength + extraLength || id === 1) throw invalid('额外字段无效或使用 ZIP64');
      // Info-ZIP Unicode path extra field, used with legacy filename encodings.
      if (id === 0x7075 && length >= 5 && bytes[extra + 4] === 1
        && u32(extra + 5) === crc32(bytes.subarray(position + 46, position + 46 + nameLength))) {
        try { name = utf8.decode(bytes.subarray(extra + 9, extraEnd)); }
        catch { throw invalid('压缩包文件名编码无效'); }
      }
      extra = extraEnd;
    }
    checkPath(name);
    const key = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
    if (names.has(key)) throw invalid('压缩包包含重复的文件路径');
    names.add(key);
    total += size;
    if (total > MAX_TEXTPACK_BYTES) throw invalid('解压后总大小最多 128 MiB');
    if (name.endsWith('/') && size !== 0) throw invalid('目录条目包含文件数据');
    if (method === 0 && compressedSize !== size) throw invalid('文件大小校验失败');
    if (u32(localOffset) !== 0x04034b50 || u16(localOffset + 6) !== flags || u16(localOffset + 8) !== method) throw invalid();
    const localNameLength = u16(localOffset + 26);
    const dataOffset = localOffset + 30 + localNameLength + u16(localOffset + 28);
    let dataEnd = dataOffset + compressedSize;
    if (dataEnd > directoryStart || dataOffset > directoryStart || localNameLength !== nameLength) throw invalid();
    for (let i = 0; i < nameLength; i++) {
      if (bytes[localOffset + 30 + i] !== bytes[position + 46 + i]) throw invalid('文件名校验失败');
    }
    if (flags & 8) {
      if (dataEnd + 12 > directoryStart) throw invalid('文件描述符缺失');
      const descriptor = dataEnd + (u32(dataEnd) === 0x08074b50 ? 4 : 0);
      if (descriptor + 12 > directoryStart || u32(descriptor) !== checksum
        || u32(descriptor + 4) !== compressedSize || u32(descriptor + 8) !== size) throw invalid('文件描述符校验失败');
      dataEnd = descriptor + 12;
    } else if (u32(localOffset + 14) !== checksum || u32(localOffset + 18) !== compressedSize || u32(localOffset + 22) !== size) {
      throw invalid('文件大小或校验码不一致');
    }
    entries.push({ name, method, checksum, size, dataOffset, dataEnd, compressedSize, localOffset });
    position = next;
  }
  if (position !== end) throw invalid();
  const byOffset = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  for (let i = 1; i < byOffset.length; i++) {
    if (byOffset[i].localOffset < byOffset[i - 1].dataEnd) throw invalid('压缩包条目数据重叠');
  }
  return entries;
}

function inspectBundle(files) {
  const candidates = Object.keys(files).filter((path) => /^(?:[^/]+\.textbundle\/)?text\.[^/]+$/.test(path));
  if (candidates.length !== 1) throw invalid('需要唯一的 text.md 或 text.markdown 正文');
  const textPath = candidates[0];
  if (!/\/text\.(md|markdown)$/.test('/' + textPath)) throw invalid('仅支持 Markdown 正文');
  const root = textPath.slice(0, textPath.lastIndexOf('/') + 1);
  let info;
  try { info = JSON.parse(utf8.decode(files[`${root}info.json`])); }
  catch { throw invalid('缺少有效的 info.json 元信息'); }
  if (!info || Array.isArray(info) || ![1, 2].includes(info.version)
    || (info.type !== undefined && info.type !== MARKDOWN_TYPE)) throw invalid('元信息版本或正文类型不受支持');
  if ((info.transient !== undefined && typeof info.transient !== 'boolean')
    || ['creatorURL', 'creatorIdentifier', 'sourceURL'].some((key) => info[key] !== undefined && typeof info[key] !== 'string')) {
    throw invalid('元信息字段类型无效');
  }
  return { format: 'textpack', root, textPath, files };
}

function checkContainer(textPack) {
  if (textPack?.format !== 'textpack' || !textPack.files || typeof textPack.files !== 'object') throw invalid('文档容器无效');
  const entries = Object.entries(textPack.files);
  if (entries.length > MAX_TEXTPACK_ENTRIES) throw invalid('压缩包条目数超过 4096');
  let total = 0;
  for (const [path, bytes] of entries) {
    checkPath(path);
    if (!(bytes instanceof Uint8Array)) throw invalid('附件数据无效');
    total += bytes.byteLength;
  }
  if (total > MAX_TEXTPACK_BYTES) throw invalid('文档和附件总大小最多 128 MiB');
  if (typeof textPack.root !== 'string' || textPack.textPath !== `${textPack.root}text.md`
    && textPack.textPath !== `${textPack.root}text.markdown` || !Object.hasOwn(textPack.files, textPack.textPath)) throw invalid('正文路径无效');
  return total;
}

export function isTextPackFile(filePath, input) {
  if (/\.textpack(?:[?#]|$)/i.test(String(filePath || ''))) return true;
  if (!input) return false;
  const bytes = bytesOf(input);
  // Android SAF URIs often omit the display filename and extension.
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
}

export async function decodeTextPack(input) {
  const bytes = bytesOf(input);
  const entries = inspectZip(bytes);
  const files = Object.create(null);
  for (const entry of entries) {
    const data = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
    let result;
    if (entry.method === 0) result = new Uint8Array(data);
    else {
      result = new Uint8Array(entry.size);
      let written = 0;
      const inflater = new Inflate((chunk) => {
        if (written + chunk.length > entry.size) throw invalid('解压大小超过声明值');
        result.set(chunk, written);
        written += chunk.length;
      });
      try {
        if (data.length < 2) throw invalid();
        // A small compressed chunk bounds the temporary output even if the
        // attacker lies about the ZIP size; check actual output on every push.
        for (let offset = 0; offset < data.length; offset += 8192) {
          inflater.push(data.subarray(offset, offset + 8192), offset + 8192 >= data.length);
        }
      } catch (error) { throw invalid(`解压失败：${error.message}`); }
      if (written !== entry.size) throw invalid('解压后文件大小不一致');
    }
    if (crc32(result) !== entry.checksum) throw invalid('文件 CRC 校验失败，压缩包可能损坏');
    files[entry.name] = result;
  }
  const textPack = inspectBundle(files);
  const markdown = files[textPack.textPath];
  return {
    ...decodeUtf8Document(markdown, { preserveOriginal: markdown.byteLength < LARGE_DOCUMENT_THRESHOLD_BYTES }),
    byteSize: markdown.length, textPack
  };
}

export function createTextPack() {
  return {
    format: 'textpack', root: '', textPath: 'text.md',
    files: {
      'info.json': encoder.encode(JSON.stringify({ version: 2, type: MARKDOWN_TYPE, creatorIdentifier: 'local.light-markdown-editor' }, null, 2) + '\n'),
      'text.md': new Uint8Array(0)
    }
  };
}

export async function encodeTextPack(textPack, serializedContent) {
  checkContainer(textPack);
  const files = { ...textPack.files, [textPack.textPath]: encoder.encode(serializedContent) };
  checkContainer({ ...textPack, files });
  // Stream ZIP output to retain arbitrary filenames, including names such as
  // __proto__, which object-flattening ZIP helpers can silently discard.
  const chunks = [];
  let length = 0;
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    length += chunk.length;
    if (length > MAX_TEXTPACK_BYTES) throw invalid('保存后的压缩包超过 128 MiB');
    chunks.push(chunk);
  });
  for (const [path, bytes] of Object.entries(files)) {
    const file = /\.(png|jpe?g|gif|webp)$/i.test(path) ? new ZipPassThrough(path) : new ZipDeflate(path, { level: 6 });
    zip.add(file);
    file.push(bytes, true);
  }
  zip.end();
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

function sniffImage(bytes) {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('每张图片最多 32 MiB');
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return { type: 'image/png', extension: 'png' };
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { type: 'image/jpeg', extension: 'jpg' };
  const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return { type: 'image/gif', extension: 'gif' };
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { type: 'image/webp', extension: 'webp' };
  throw new Error('支持 PNG、JPEG、GIF 和 WebP 图片；暂不支持 SVG');
}

export async function readTextPackImage(textPack, source) {
  let path;
  try { path = decodeURIComponent(String(source).trim().split(/[?#]/, 1)[0]); }
  catch { throw new Error('图片路径编码无效'); }
  while (path.startsWith('./')) path = path.slice(2);
  checkPath(path);
  if (!path.startsWith('assets/') || path.endsWith('/')) throw new Error('TextPack 图片须位于 assets/ 目录');
  const key = `${textPack.root}${path}`;
  if (!Object.hasOwn(textPack.files, key)) throw new Error(`压缩包中找不到图片：${path}`);
  const bytes = textPack.files[key];
  const { type } = sniffImage(bytes);
  return new Blob([bytes], { type });
}

export async function addTextPackImage(textPack, blob) {
  const total = checkContainer(textPack);
  if ((blob?.size ?? blob?.byteLength ?? 0) > MAX_IMAGE_BYTES) throw new Error('每张图片最多 32 MiB');
  const bytes = blob instanceof Uint8Array ? new Uint8Array(blob) : new Uint8Array(await blob.arrayBuffer());
  const { extension } = sniffImage(bytes);
  if (total + bytes.length > MAX_TEXTPACK_BYTES) throw new Error('文档和附件总大小最多 128 MiB');
  if (Object.keys(textPack.files).length >= MAX_TEXTPACK_ENTRIES) throw new Error('压缩包条目数超过 4096');
  let number = 1;
  let relativePath;
  const names = new Set(Object.keys(textPack.files).map((path) => path.replace(/\/$/, '').normalize('NFC').toLowerCase()));
  do { relativePath = `assets/image-${number++}.${extension}`; }
  while (names.has(`${textPack.root}${relativePath}`.normalize('NFC').toLowerCase()));
  return { textPack: { ...textPack, files: { ...textPack.files, [`${textPack.root}${relativePath}`]: bytes } }, relativePath };
}
