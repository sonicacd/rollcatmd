import Editor from '@toast-ui/editor';
import DOMPurify from 'dompurify';
import '@toast-ui/editor/dist/i18n/zh-cn';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/toastui-editor-viewer.css';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { search, searchKeymap } from '@codemirror/search';
import {
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers
} from '@codemirror/view';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import {
  LARGE_DOCUMENT_THRESHOLD_BYTES,
  estimateLlmTokensFromByteLength,
  estimateLlmTokensInChunks,
  formatFileSize,
  shouldUseLargeDocumentMode
} from './document-size.js';
import {
  decodeUtf8Document,
  markdownPositionToOffset,
  normalizeEditorText,
  projectedUtf8ByteLength,
  serializeTextDocument,
  utf8ByteLength
} from './text-format.js';
import {
  classifySaveResult,
  createSnapshotTaskQueue,
  getSaveCoalesceKey,
  isOpenRequestCurrent,
  materializeTextSnapshot,
  matchesDocumentRevision
} from './operation-queue.js';
import { applyTheme, readStoredTheme } from './theme.js';
import { formatWindowTitle } from './window-title.js';
import './styles.css';

const initialTheme = applyTheme(readStoredTheme(), { persist: false });

const initialMarkdown = `# 欢迎使用滚猫md

滚猫md（rollcat-md）是一款轻量的 Windows 桌面 Markdown 阅读和编辑器，支持所见即所得、源码编辑、专注阅读和大文件流畅处理。

## 常用格式

- **加粗文字**
- *斜体文字*
- ~~删除线~~
- \`行内代码\`
- [链接](https://www.markdownguide.org/)

> 引用块会像这样显示，适合摘录和笔记。

> [!note] 灵感卡片
> 阅读模式会把 Obsidian 风格的 callout 渲染成更醒目的提示块。

> [!warning] 待确认
> 保存前请留意窗口标题末尾的星号，它表示当前内容还没有保存。

### 任务列表

- [x] 打开和保存 .md 文件
- [x] 所见即所得编辑
- [x] 源码编辑
- [x] 阅读模式
- [x] 不再打包 Chromium

### 表格

| 格式 | 显示效果 |
| --- | --- |
| \`# 标题\` | 一级标题 |
| \`**文字**\` | 加粗 |
| \`- 项目\` | 列表 |

### 代码块

\`\`\`js
function hello(name) {
  return \`你好，\${name}\`;
}
\`\`\`
`;

const editorElement = document.querySelector('#editor');
const viewerElement = document.querySelector('#viewer');
const editorPanel = document.querySelector('#editorPanel');
const readerPanel = document.querySelector('#readerPanel');
const largeFilePanel = document.querySelector('#largeFilePanel');
const largeFileEditorElement = document.querySelector('#largeFileEditor');
const largeFileNotice = document.querySelector('#largeFileNotice');
const statusText = document.querySelector('#statusText');
const countText = document.querySelector('#countText');
const themeSelect = document.querySelector('#themeSelect');
themeSelect.value = initialTheme;

const markdownFilters = [
  { name: 'Markdown 文件', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: '文本文件', extensions: ['txt'] }
];

const browserFileTypes = [
  {
    description: 'Markdown 文件',
    accept: {
      'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'],
      'text/plain': ['.txt']
    }
  }
];

const calloutTitles = {
  abstract: '摘要',
  summary: '摘要',
  tldr: '摘要',
  info: '信息',
  todo: '待办',
  tip: '提示',
  hint: '提示',
  important: '重要',
  success: '成功',
  check: '完成',
  done: '完成',
  question: '问题',
  help: '帮助',
  faq: '常见问题',
  warning: '警告',
  caution: '注意',
  attention: '注意',
  failure: '失败',
  fail: '失败',
  missing: '缺失',
  danger: '危险',
  error: '错误',
  bug: '问题',
  example: '示例',
  quote: '引用',
  cite: '引用',
  note: '笔记'
};

const controls = {
  newButton: document.querySelector('#newButton'),
  openButton: document.querySelector('#openButton'),
  saveButton: document.querySelector('#saveButton'),
  saveAsButton: document.querySelector('#saveAsButton'),
  wysiwygMode: document.querySelector('#wysiwygMode'),
  markdownMode: document.querySelector('#markdownMode'),
  readerMode: document.querySelector('#readerMode')
};

const state = {
  currentFilePath: null,
  browserFileHandle: null,
  isDirty: false,
  isLargeDocument: false,
  documentByteSize: null,
  mode: 'wysiwyg',
  suppressChangeCount: 0,
  documentId: 0,
  revision: 0,
  savedRevision: 0,
  openRequestId: 0,
  activeSaveCount: 0,
  lastSavedContent: initialMarkdown,
  lastSavedSerializedContent: initialMarkdown,
  textFormat: {
    lineEnding: '\n',
    hasBom: false
  }
};

function sanitizeMarkdownHTML(content) {
  return DOMPurify.sanitize(content, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['rel', 'target', 'hreflang', 'type'],
    FORBID_TAGS: [
      'script',
      'style',
      'iframe',
      'embed',
      'object',
      'form',
      'button',
      'input',
      'textarea',
      'select',
      'meta',
      'link',
      'title',
      'base'
    ]
  });
}

const largeFileEditorExtensions = [
  lineNumbers(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  search({ top: true }),
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
  EditorState.tabSize.of(2),
  EditorView.contentAttributes.of({
    'aria-label': '大文件 Markdown 源码编辑器',
    'aria-multiline': 'true',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false'
  }),
  EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'var(--surface-deep)',
      color: 'var(--text)'
    },
    '&.cm-focused': {
      outline: '1px solid var(--focus-ring)'
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: '"Cascadia Code", "Consolas", "Microsoft YaHei", monospace',
      fontSize: '14px',
      lineHeight: '1.65'
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '18px 0 56px',
      caretColor: 'var(--accent-strong)'
    },
    '.cm-line': {
      padding: '0 18px'
    },
    '.cm-gutters': {
      borderRight: '1px solid var(--line)',
      backgroundColor: 'var(--sidebar)',
      color: 'var(--muted-soft)'
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'var(--active-line)'
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--selection)'
    },
    '.cm-panels': {
      borderColor: 'var(--line)',
      backgroundColor: 'var(--surface-raised)',
      color: 'var(--text)'
    },
    '.cm-panels input': {
      border: '1px solid var(--line-strong)',
      backgroundColor: 'var(--surface-deep)',
      color: 'var(--text)'
    }
  }),
  EditorView.updateListener.of((update) => {
    if (!update.docChanged || state.suppressChangeCount > 0) {
      return;
    }

    noteDocumentChanged();
  })
];

function createLargeFileEditorState(content = '') {
  return EditorState.create({
    doc: content,
    extensions: largeFileEditorExtensions
  });
}

const largeFileEditor = new EditorView({
  state: createLargeFileEditorState(),
  parent: largeFileEditorElement
});

const editor = new Editor({
  el: editorElement,
  height: '100%',
  initialEditType: 'wysiwyg',
  previewStyle: 'vertical',
  initialValue: initialMarkdown,
  language: 'zh-CN',
  usageStatistics: false,
  customHTMLSanitizer: sanitizeMarkdownHTML,
  hideModeSwitch: true,
  toolbarItems: [
    ['heading', 'bold', 'italic', 'strike'],
    ['hr', 'quote'],
    ['ul', 'ol', 'task', 'indent', 'outdent'],
    ['table', 'link'],
    ['code', 'codeblock']
  ]
});

let viewer = Editor.factory({
  el: viewerElement,
  viewer: true,
  initialValue: initialMarkdown,
  customHTMLSanitizer: sanitizeMarkdownHTML
});
enhanceRenderedMarkdown(viewerElement);

function getCurrentMarkdown() {
  if (state.isLargeDocument) {
    return largeFileEditor.state.doc.toString();
  }

  return editor.getMarkdown();
}

function getDisplayName(filePath) {
  if (!filePath) {
    return '未命名.md';
  }

  return filePath.split(/[\\/]/).pop() || filePath;
}

function isTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

function decodeOpenedDocument(bytes) {
  return decodeUtf8Document(bytes, {
    preserveOriginal: bytes.byteLength < LARGE_DOCUMENT_THRESHOLD_BYTES
  });
}

async function openBrowserFileWithPicker() {
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: browserFileTypes
  });
  const file = await handle.getFile();
  setStatus('正在读取文件…');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoded = decodeOpenedDocument(bytes);

  return {
    canceled: false,
    filePath: file.name,
    ...decoded,
    byteSize: file.size,
    browserFileHandle: handle
  };
}

async function openBrowserFileWithInput() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain';
    input.className = 'visually-hidden-file-input';
    document.body.append(input);

    let settled = false;
    let focusTimer = null;

    const cleanup = () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('focus', handleWindowFocus);
      input.remove();
    };

    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback(value);
    };

    const cancel = () => settle(resolve, { canceled: true });

    const handleWindowFocus = () => {
      // Browsers without the input "cancel" event return focus before firing
      // "change", so give that event a turn before treating it as a cancel.
      focusTimer = window.setTimeout(() => {
        if (!input.files?.length) {
          cancel();
        }
      }, 250);
    };

    input.addEventListener('cancel', cancel, { once: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];

      if (!file) {
        cancel();
        return;
      }

      try {
        setStatus('正在读取文件…');
        const bytes = new Uint8Array(await file.arrayBuffer());
        settle(resolve, {
          canceled: false,
          filePath: file.name,
          ...decodeOpenedDocument(bytes),
          byteSize: file.size,
          browserFileHandle: null
        });
      } catch (error) {
        settle(reject, error);
      }
    }, { once: true });

    window.addEventListener('focus', handleWindowFocus, { once: true });
    input.click();
  });
}

async function openBrowserFile() {
  if (window.showOpenFilePicker) {
    try {
      return await openBrowserFileWithPicker();
    } catch (error) {
      if (error.name === 'AbortError') {
        return { canceled: true };
      }

      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        return openBrowserFileWithInput();
      }

      throw error;
    }
  }

  return openBrowserFileWithInput();
}

async function openMarkdownFile() {
  if (!isTauriRuntime()) {
    return openBrowserFile();
  }

  const selected = await openDialog({
    title: '打开 Markdown 文件',
    multiple: false,
    filters: [
      ...markdownFilters,
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  const filePath = Array.isArray(selected) ? selected[0] : selected;

  if (!filePath) {
    return { canceled: true };
  }

  setStatus('正在读取文件…');
  const bytes = await readFile(filePath);
  return {
    canceled: false,
    filePath,
    ...decodeOpenedDocument(bytes),
    byteSize: bytes.byteLength
  };
}

async function saveBrowserFileWithHandle(handle, content) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();

  return {
    canceled: false,
    filePath: handle.name,
    browserFileHandle: handle
  };
}

function downloadBrowserFile(filePath, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = getDisplayName(filePath || '未命名.md');
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);

  return {
    canceled: false,
    filePath: filePath || link.download,
    browserFileHandle: null,
    unconfirmedExport: true
  };
}

async function saveBrowserFile({ filePath, content, saveAs, browserFileHandle }) {
  if (!saveAs && browserFileHandle?.createWritable) {
    return saveBrowserFileWithHandle(browserFileHandle, content);
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: getDisplayName(filePath || '未命名.md'),
        types: browserFileTypes
      });

      return saveBrowserFileWithHandle(handle, content);
    } catch (error) {
      if (error.name === 'AbortError') {
        return { canceled: true };
      }

      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        return downloadBrowserFile(filePath, content);
      }

      throw error;
    }
  }

  return downloadBrowserFile(filePath, content);
}

async function saveMarkdownFile({
  filePath,
  content,
  saveAs,
  browserFileHandle
}) {
  if (!isTauriRuntime()) {
    return saveBrowserFile({
      filePath,
      content,
      saveAs,
      browserFileHandle
    });
  }

  let targetPath = filePath;

  if (!targetPath || saveAs) {
    targetPath = await saveDialog({
      title: '保存 Markdown 文件',
      defaultPath: targetPath || '未命名.md',
      filters: markdownFilters
    });

    if (!targetPath) {
      return { canceled: true };
    }
  }

  await invoke('write_text_file_atomic', { path: targetPath, content });
  return { canceled: false, filePath: targetPath };
}

async function openInitialLaunchFile() {
  if (!isTauriRuntime()) {
    return;
  }

  const request = beginOpenRequest();

  try {
    const result = await invoke('get_initial_file');

    if (!result || !canApplyOpenRequest(request)) {
      return;
    }

    setStatus('正在读取启动文件…');
    const bytes = await readFile(result.filePath);

    if (!canApplyOpenRequest(request)) {
      return;
    }

    openDocument({
      ...result,
      ...decodeOpenedDocument(bytes),
      byteSize: bytes.byteLength
    });
  } catch (error) {
    if (!canApplyOpenRequest(request)) {
      return;
    }

    setStatus('启动文件打开失败');
    window.alert(`打开启动文件失败：${error.message || error}`);
  }
}

function setStatus(message) {
  statusText.textContent = message;
}

function beginOpenRequest() {
  return {
    requestId: ++state.openRequestId,
    documentId: state.documentId,
    revision: state.revision
  };
}

function canApplyOpenRequest(request) {
  return isOpenRequestCurrent(request, state);
}

function invalidateOpenRequests() {
  state.openRequestId += 1;
}

function beginSuppressChanges() {
  state.suppressChangeCount += 1;
  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;
    state.suppressChangeCount = Math.max(0, state.suppressChangeCount - 1);
  };
}

function noteDocumentChanged() {
  state.revision += 1;
  state.documentByteSize = null;
  setDirty(state.revision !== state.savedRevision);
  scheduleCountsUpdate();
}

function updateSavingState() {
  const isSaving = state.activeSaveCount > 0;
  controls.saveButton.setAttribute('aria-busy', String(isSaving));
  controls.saveAsButton.setAttribute('aria-busy', String(isSaving));
  statusText.closest('.statusbar')?.setAttribute('aria-busy', String(isSaving));
}

function updateCounts() {
  if (state.isLargeDocument) {
    const documentText = largeFileEditor.state.doc;
    let tokenEstimate;

    if (Number.isFinite(state.documentByteSize)) {
      tokenEstimate = estimateLlmTokensFromByteLength(state.documentByteSize);
    } else {
      const iterator = documentText.iter();
      const chunks = {
        *[Symbol.iterator]() {
          while (!iterator.next().done) {
            yield iterator.value;
          }
        }
      };
      tokenEstimate = estimateLlmTokensInChunks(chunks);
    }

    countText.textContent =
      `${documentText.length.toLocaleString()} 字符 / 约 ${tokenEstimate.toLocaleString()} tokens`;
    return;
  }

  const text = editor.getMarkdown();

  // A huge paste/drop is intercepted before Toast UI sees it. This delayed
  // guard also catches programmatic edits and ordinary typing that grows past
  // the threshold one small transaction at a time.
  let byteSize = null;

  if (text.length * 3 >= LARGE_DOCUMENT_THRESHOLD_BYTES) {
    byteSize = utf8ByteLength(text);

    if (byteSize >= LARGE_DOCUMENT_THRESHOLD_BYTES) {
      activateLargeDocument(text, byteSize);
      setStatus('内容已达到大文件阈值，已切换到流畅源码模式');
      return;
    }
  }

  const tokenEstimate = estimateLlmTokensFromByteLength(
    byteSize ?? utf8ByteLength(text)
  );
  countText.textContent =
    `${text.length.toLocaleString()} 字符 / 约 ${tokenEstimate.toLocaleString()} tokens`;
}

let countUpdateTimer = null;
let lastNativeWindowTitle = null;
let nativeWindowTitleQueue = Promise.resolve();

function scheduleCountsUpdate() {
  window.clearTimeout(countUpdateTimer);
  countUpdateTimer = window.setTimeout(updateCounts, state.isLargeDocument ? 500 : 200);
}

function syncNativeWindowTitle(title) {
  if (!isTauriRuntime() || title === lastNativeWindowTitle) {
    return;
  }

  lastNativeWindowTitle = title;
  nativeWindowTitleQueue = nativeWindowTitleQueue
    .catch(() => {})
    .then(() => getCurrentWindow().setTitle(title))
    .catch((error) => {
      if (lastNativeWindowTitle === title) {
        lastNativeWindowTitle = null;
      }

      console.warn('更新窗口标题失败', error);
    });
}

function updateTitle() {
  const displayName = getDisplayName(state.currentFilePath);
  const title = formatWindowTitle(displayName, state.isDirty);
  document.title = title;
  syncNativeWindowTitle(title);
}

function updateModeButtons() {
  const modeButtons = [
    [controls.wysiwygMode, 'wysiwyg'],
    [controls.markdownMode, 'markdown'],
    [controls.readerMode, 'reader']
  ];

  modeButtons.forEach(([button, mode]) => {
    const isActive = state.mode === mode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  controls.wysiwygMode.disabled = state.isLargeDocument;
  controls.readerMode.disabled = state.isLargeDocument;
  const disabledReason = state.isLargeDocument
    ? '大文件模式下已关闭实时 Markdown 渲染'
    : '';
  controls.wysiwygMode.title = disabledReason;
  controls.readerMode.title = disabledReason;

  [controls.wysiwygMode, controls.readerMode].forEach((button) => {
    if (state.isLargeDocument) {
      button.setAttribute('aria-describedby', 'largeFileNotice');
    } else {
      button.removeAttribute('aria-describedby');
    }
  });
}

function getCalloutTitle(type, rawTitle) {
  if (rawTitle) {
    return rawTitle;
  }

  return calloutTitles[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

function enhanceRenderedMarkdown(root) {
  const calloutPattern = /^\s*\[!([a-z][a-z0-9_-]*)\][+-]?\s*([^\n\r]*)/i;

  root.querySelectorAll('blockquote').forEach((block) => {
    const match = block.textContent.match(calloutPattern);

    if (!match) {
      return;
    }

    const type = match[1].toLowerCase();
    const title = getCalloutTitle(type, match[2].trim());
    block.classList.add('obsidian-callout', `obsidian-callout-${type}`);
    block.dataset.calloutTitle = title;

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let firstTextNode = walker.nextNode();

    while (firstTextNode && !calloutPattern.test(firstTextNode.nodeValue)) {
      firstTextNode = walker.nextNode();
    }

    if (firstTextNode) {
      const parent = firstTextNode.parentElement;
      firstTextNode.nodeValue = firstTextNode.nodeValue
        .replace(calloutPattern, '')
        .replace(/^\s+/, '');

      if (parent && parent !== block && !parent.textContent.trim()) {
        parent.remove();
      }
    }
  });
}

function refreshReader() {
  const markdown = getCurrentMarkdown();
  viewer.destroy();
  viewerElement.innerHTML = '';
  viewer = Editor.factory({
    el: viewerElement,
    viewer: true,
    initialValue: markdown,
    customHTMLSanitizer: sanitizeMarkdownHTML
  });
  enhanceRenderedMarkdown(viewerElement);
}

function setDirty(isDirty) {
  const changed = state.isDirty !== isDirty;
  state.isDirty = isDirty;
  updateTitle();

  if (changed) {
    setStatus(isDirty ? '有未保存更改' : '已保存');
  }
}

function showEditorPanel() {
  readerPanel.classList.add('hidden');
  readerPanel.setAttribute('aria-hidden', 'true');
  editorPanel.classList.remove('hidden');
  editorPanel.setAttribute('aria-hidden', 'false');
}

function activateLargeDocument(content, byteSize = null) {
  const releaseSuppression = beginSuppressChanges();
  state.isLargeDocument = true;
  state.documentByteSize = byteSize;
  state.mode = 'markdown';
  state.lastSavedContent = null;
  state.lastSavedSerializedContent = null;

  // Clear the rich editor before assigning the large text so Toast UI never
  // parses or retains the large document.
  editor.setMarkdown('', false);
  editor.changeMode('markdown', true);
  editorElement.classList.add('hidden');
  editorElement.setAttribute('aria-hidden', 'true');
  largeFilePanel.classList.remove('hidden');
  largeFilePanel.setAttribute('aria-hidden', 'false');
  largeFileEditor.setState(createLargeFileEditorState(content));
  showEditorPanel();

  const size = formatFileSize(byteSize);
  largeFileNotice.textContent = `${size ? `${size}，` : ''}为保持流畅，已关闭所见即所得和阅读渲染。`;
  updateModeButtons();
  updateCounts();
  releaseSuppression();
}

function setDocument(
  markdown,
  filePath = null,
  byteSize = null,
  {
    browserFileHandle = null,
    lineEnding = '\n',
    hasBom = false,
    originalSerializedContent = null
  } = {}
) {
  const content = normalizeEditorText(markdown || '');
  const measuredSize = Number.isFinite(byteSize) ? byteSize : utf8ByteLength(content);
  const isLargeDocument = shouldUseLargeDocumentMode(measuredSize, content.length);

  state.documentId += 1;
  state.revision = 0;
  state.savedRevision = 0;
  state.currentFilePath = filePath;
  state.browserFileHandle = browserFileHandle;
  state.textFormat = { lineEnding, hasBom };
  // Keep an exact source bypass for Toast UI documents. CodeMirror already
  // preserves large-document text, so retaining another multi-megabyte string
  // there would only increase memory pressure.
  state.lastSavedContent = isLargeDocument ? null : content;
  state.lastSavedSerializedContent = isLargeDocument
    ? null
    : (originalSerializedContent ?? serializeTextDocument(content, { lineEnding, hasBom }));
  state.documentByteSize = measuredSize;
  showEditorPanel();

  if (isLargeDocument) {
    activateLargeDocument(content, measuredSize);
  } else {
    const releaseSuppression = beginSuppressChanges();
    state.isLargeDocument = false;
    state.mode = 'wysiwyg';
    largeFileEditor.setState(createLargeFileEditorState());
    largeFilePanel.classList.add('hidden');
    largeFilePanel.setAttribute('aria-hidden', 'true');
    editorElement.classList.remove('hidden');
    editorElement.setAttribute('aria-hidden', 'false');
    editor.changeMode('wysiwyg', true);
    editor.setMarkdown(content, false);
    updateModeButtons();
    updateCounts();
    releaseSuppression();
  }

  setDirty(false);
  return isLargeDocument;
}

function openDocument({
  content,
  filePath,
  byteSize,
  browserFileHandle = null,
  lineEnding = '\n',
  hasBom = false,
  originalSerializedContent = null
}) {
  const isLargeDocument = setDocument(content, filePath, byteSize, {
    browserFileHandle,
    lineEnding,
    hasBom,
    originalSerializedContent
  });

  if (isLargeDocument) {
    setStatus(`已打开 ${getDisplayName(filePath)}（大文件模式）`);
  } else {
    setStatus(`已打开 ${getDisplayName(filePath)}`);
  }
}

function getRegularEditorSelectionOffsets(markdown) {
  try {
    let [start, end] = editor.getSelection();

    if (typeof start === 'number' && typeof end === 'number') {
      [start, end] = editor.convertPosToMatchEditorMode(start, end, 'markdown');
    }

    const startOffset = markdownPositionToOffset(markdown, start);
    const endOffset = markdownPositionToOffset(markdown, end);
    return [Math.min(startOffset, endOffset), Math.max(startOffset, endOffset)];
  } catch {
    return [markdown.length, markdown.length];
  }
}

function planLargeInsertion(insertedText) {
  if (state.isLargeDocument || !insertedText) {
    return null;
  }

  const current = editor.getMarkdown();
  const [start, end] = getRegularEditorSelectionOffsets(current);
  const normalizedInsertion = normalizeEditorText(insertedText);
  const nextByteSize = projectedUtf8ByteLength(
    current,
    start,
    end,
    normalizedInsertion
  );

  if (nextByteSize < LARGE_DOCUMENT_THRESHOLD_BYTES) {
    return null;
  }

  return {
    content: current.slice(0, start) + normalizedInsertion + current.slice(end),
    cursorOffset: start + normalizedInsertion.length,
    byteSize: nextByteSize
  };
}

function applyLargeInsertion(plan) {
  activateLargeDocument(plan.content, plan.byteSize);
  largeFileEditor.dispatch({
    selection: { anchor: plan.cursorOffset },
    scrollIntoView: true
  });
  noteDocumentChanged();
  setStatus('插入内容较大，已在解析前切换到流畅源码模式');
  largeFileEditor.focus();
}

function interceptLargeInsertion(event, text) {
  const plan = planLargeInsertion(text);

  if (!plan) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  applyLargeInsertion(plan);
}

editorElement.addEventListener('paste', (event) => {
  interceptLargeInsertion(event, event.clipboardData?.getData('text/plain') || '');
}, true);

editorElement.addEventListener('drop', (event) => {
  if (event.dataTransfer?.files?.length) {
    return;
  }

  interceptLargeInsertion(event, event.dataTransfer?.getData('text/plain') || '');
}, true);

const largeInsertionInputTypes = new Set([
  'insertText',
  'insertFromPaste',
  'insertFromDrop',
  'insertReplacementText'
]);

editorElement.addEventListener('beforeinput', (event) => {
  // Paste and drop have richer events above. This catches other browser or
  // assistive-technology insertions that deliver a large text payload.
  if (largeInsertionInputTypes.has(event.inputType) && (event.data?.length || 0) >= 64 * 1024) {
    interceptLargeInsertion(event, event.data);
  }
}, true);

function confirmDiscardChanges() {
  if (!state.isDirty) {
    return true;
  }

  return window.confirm('当前文件还没有保存。继续操作会丢失这些更改，确定继续吗？');
}

async function newFile() {
  if (!confirmDiscardChanges()) {
    return;
  }

  invalidateOpenRequests();
  setDocument('# 未命名笔记\n\n开始写 Markdown...\n', null, 0);
  setStatus('已新建文件');
}

async function openFile() {
  if (!confirmDiscardChanges()) {
    return;
  }

  const request = beginOpenRequest();

  try {
    const result = await openMarkdownFile();
    if (result.canceled) {
      return;
    }

    if (!canApplyOpenRequest(request)) {
      if (request.requestId === state.openRequestId) {
        setStatus('文件已读取，但当前文档已有新更改，未覆盖现有内容');
      }
      return;
    }

    openDocument(result);
  } catch (error) {
    if (!canApplyOpenRequest(request)) {
      return;
    }

    setStatus('打开失败');
    window.alert(`打开文件失败：${error.message || error}`);
  }
}

async function performSave(saveAs, snapshot) {
  state.activeSaveCount += 1;
  updateSavingState();
  setStatus('正在保存…');

  try {
    const materialized = materializeTextSnapshot(snapshot, serializeTextDocument);
    const isCurrentDocument = state.documentId === snapshot.documentId;
    const targetFilePath = !saveAs && isCurrentDocument
      ? state.currentFilePath
      : snapshot.filePath;
    const targetBrowserHandle = !saveAs && isCurrentDocument
      ? state.browserFileHandle
      : snapshot.browserFileHandle;
    const result = await saveMarkdownFile({
      filePath: targetFilePath,
      content: materialized.serializedContent,
      saveAs,
      browserFileHandle: targetBrowserHandle
    });
    const resultStatus = classifySaveResult(result);

    if (resultStatus === 'canceled') {
      setStatus(state.isDirty ? '已取消保存，仍有未保存更改' : '已取消保存');
      return;
    }

    if (resultStatus === 'unconfirmed-export') {
      const currentDocumentNote = state.documentId !== snapshot.documentId
        ? '；当前文档未受影响'
        : (state.isDirty ? '；当前文档仍有未保存更改' : '');
      setStatus(`已导出 ${getDisplayName(result.filePath)} 副本，但浏览器无法确认文件已保存${currentDocumentNote}`);
      return;
    }

    if (state.documentId !== snapshot.documentId) {
      setStatus(`已保存 ${getDisplayName(result.filePath)}；当前文档未受影响`);
      return;
    }

    state.currentFilePath = result.filePath;
    state.browserFileHandle = result.browserFileHandle || snapshot.browserFileHandle;
    state.savedRevision = snapshot.revision;
    state.lastSavedContent = state.isLargeDocument ? null : materialized.content;
    state.lastSavedSerializedContent = state.isLargeDocument
      ? null
      : materialized.serializedContent;
    const hasNewerChanges = !matchesDocumentRevision(snapshot, state);
    setDirty(hasNewerChanges);
    setStatus(hasNewerChanges
      ? `已保存 ${getDisplayName(result.filePath)} 的较早版本，仍有未保存更改`
      : `已保存 ${getDisplayName(result.filePath)}`);
  } catch (error) {
    setStatus('保存失败');
    window.alert(`保存文件失败：${error.message || error}`);
  } finally {
    state.activeSaveCount = Math.max(0, state.activeSaveCount - 1);
    updateSavingState();
  }
}

function captureSaveSnapshot() {
  const hasUnchangedSource =
    state.revision === state.savedRevision &&
    state.lastSavedContent !== null &&
    state.lastSavedSerializedContent !== null;
  const content = state.isLargeDocument
    ? null
    : (hasUnchangedSource ? state.lastSavedContent : editor.getMarkdown());
  const textFormat = { ...state.textFormat };

  return {
    documentId: state.documentId,
    revision: state.revision,
    filePath: state.currentFilePath,
    browserFileHandle: state.browserFileHandle,
    content,
    documentText: state.isLargeDocument ? largeFileEditor.state.doc : null,
    serializedContent: hasUnchangedSource
      ? state.lastSavedSerializedContent
      : null,
    textFormat
  };
}

const enqueueSaveTask = createSnapshotTaskQueue(
  captureSaveSnapshot,
  (snapshot, saveAs) => performSave(saveAs, snapshot),
  {
    getCoalesceKey: getSaveCoalesceKey
  }
);

function saveFile(saveAs = false) {
  return enqueueSaveTask(saveAs);
}

function setMode(mode) {
  if (state.isLargeDocument && mode !== 'markdown') {
    setStatus('大文件模式仅支持源码编辑；实时渲染已关闭');
    return;
  }

  state.mode = mode;

  if (state.isLargeDocument) {
    showEditorPanel();
    largeFileEditor.focus();
    updateModeButtons();
    return;
  }

  if (mode === 'reader') {
    refreshReader();
    editorPanel.classList.add('hidden');
    editorPanel.setAttribute('aria-hidden', 'true');
    readerPanel.classList.remove('hidden');
    readerPanel.setAttribute('aria-hidden', 'false');
  } else {
    const releaseSuppression = beginSuppressChanges();
    showEditorPanel();
    editor.changeMode(mode);
    editor.focus();
    releaseSuppression();
  }

  updateModeButtons();
}

function runAction(action) {
  const actions = {
    new: newFile,
    open: openFile,
    save: () => saveFile(false),
    'save-as': () => saveFile(true),
    wysiwyg: () => setMode('wysiwyg'),
    markdown: () => setMode('markdown'),
    reader: () => setMode('reader')
  };

  actions[action]?.();
}

editor.on('change', () => {
  if (state.suppressChangeCount > 0) {
    return;
  }

  noteDocumentChanged();
});

controls.newButton.addEventListener('click', newFile);
controls.openButton.addEventListener('click', openFile);
controls.saveButton.addEventListener('click', () => saveFile(false));
controls.saveAsButton.addEventListener('click', () => saveFile(true));
controls.wysiwygMode.addEventListener('click', () => setMode('wysiwyg'));
controls.markdownMode.addEventListener('click', () => setMode('markdown'));
controls.readerMode.addEventListener('click', () => setMode('reader'));
themeSelect.addEventListener('change', () => {
  const theme = applyTheme(themeSelect.value);
  themeSelect.value = theme;
});

document.addEventListener('keydown', (event) => {
  const isMod = event.ctrlKey || event.metaKey;

  if (!isMod) {
    return;
  }

  const key = event.key.toLowerCase();
  const shortcutMap = {
    n: 'new',
    o: 'open',
    s: event.shiftKey ? 'save-as' : 'save',
    '1': 'wysiwyg',
    '2': 'markdown',
    '3': 'reader'
  };

  const action = shortcutMap[key];

  if (!action) {
    return;
  }

  event.preventDefault();

  if (event.repeat) {
    return;
  }

  runAction(action);
});

window.addEventListener('beforeunload', (event) => {
  if (!state.isDirty) {
    return;
  }

  event.preventDefault();
  event.returnValue = false;
});

updateTitle();
updateModeButtons();
updateSavingState();
updateCounts();
openInitialLaunchFile();
