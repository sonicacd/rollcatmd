import Editor from '@toast-ui/editor';
import DOMPurify from 'dompurify';
import '@toast-ui/editor/dist/i18n/zh-cn';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/toastui-editor-viewer.css';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { search } from '@codemirror/search';
import {
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { Slice } from 'prosemirror-model';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import {
  LARGE_DOCUMENT_THRESHOLD_BYTES,
  estimateLlmTokensFromByteLength,
  shouldUseLargeDocumentMode
} from './document-size.js';
import {
  decodeUtf8Document,
  markdownPositionToOffset,
  normalizeEditorText,
  serializeTextDocument,
  utf8ByteLength,
  utf8ByteLengthInChunks
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
import { largeDocumentPreview } from './large-document-preview.js';
import {
  canOverwriteOpenedFile,
  getFileDisplayName,
  isUriBackedFilePath,
  writeNativeDocument
} from './platform-file.js';
import {
  createMobileChromeState,
  isMobileChromeCollapsed,
  reduceMobileChrome
} from './mobile-chrome.js';
import {
  buildMarkdownAstFindSnapshot,
  buildMappedTextBlocks,
  decodeFindReplaceEscapes,
  findMatchIndex,
  findTextMatches,
  mapVisibleFindSnapshotToSource,
  mappedTextNodeId,
  mappedTextOffsetAtPosition,
  mappedTextRange,
  offsetToMarkdownPosition,
  replaceAllText
} from './find-replace.js';
import { registerNativeFileDrop } from './file-drop.js';
import { isTextPackFile, createTextPack, decodeTextPack, encodeTextPack, readTextPackImage, addTextPackImage } from './textpack.js';
import { importMarkdownToTextPack } from './textpack-import.js';
import { countTextLines, parseLineNumber } from './go-to-line.js';
import { captureViewPosition, createViewPositionController } from './view-position.js';
import { imageDataToUint8Array, imageExportBaseName } from './image-export.js';
import {
  renderMarkdownAsImages,
  renderMarkdownSourceAsImages
} from './image-export-runtime.js';
import { createImageExportDialog, getImageExportDialogElements } from './image-export-dialog.js';
import { createNativeArchiveTemp } from './image-export-file.js';
import { createImagePageCollector } from './image-page-collector.js';
import { throwIfAborted } from './markdown-export-chunks.js';
import { inlineRemoteImages } from './remote-image-export.js';
import { createWorkspaceController } from './workspace-controller.js';
import { initializeWindowsIntegration } from './windows-integration.js';
import { isStartupHelpHidden, storeStartupHelpHidden } from './startup-help.js';
import { calloutEditorPlugin } from './editor-callouts.js';
import { captureSelectedContent, renderSelectedImage } from './selection-image.js';
import './styles.css';

const initialTheme = applyTheme(readStoredTheme(), { persist: false });
document.documentElement.classList.toggle(
  'android-runtime',
  /Android/i.test(navigator.userAgent) && isTauriRuntime()
);

const initialMarkdown = `# 欢迎使用滚猫md

滚猫md（rollcat-md）是一款轻量的 Markdown 阅读和编辑器，支持所见即所得、源码编辑、专注阅读和大型文档流畅处理。

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
const statusText = document.querySelector('#statusText');
const countText = document.querySelector('#countText');
const mobileDocumentName = document.querySelector('#mobileDocumentName');
const mobileDirtyState = document.querySelector('#mobileDirtyState');
const mobileChromeToggle = document.querySelector('#mobileChromeToggle');
const mobileFileToolbar = document.querySelector('#mobileFileToolbar');
const mobileModeSwitch = document.querySelector('#mobileModeSwitch');
const themeSelect = document.querySelector('#themeSelect');
const themeControl = themeSelect.closest('.theme-control');
const mobileLayoutQuery = window.matchMedia('(max-width: 820px)');
themeSelect.value = initialTheme;

const findReplaceElements = {
  panel: document.querySelector('#findReplacePanel'),
  findInput: document.querySelector('#findInput'),
  replaceInput: document.querySelector('#replaceInput'),
  matchCount: document.querySelector('#findMatchCount'),
  previousButton: document.querySelector('#findPreviousButton'),
  nextButton: document.querySelector('#findNextButton'),
  replaceButton: document.querySelector('#replaceButton'),
  replaceAllButton: document.querySelector('#replaceAllButton'),
  closeButton: document.querySelector('#closeFindButton')
};

const helpElements = {
  dialog: document.querySelector('#helpDialog'),
  closeButton: document.querySelector('#closeHelpButton'),
  doneButton: document.querySelector('#helpDoneButton'),
  hideOnStartup: document.querySelector('#hideStartupHelp')
};

const goToLineElements = {
  dialog: document.querySelector('#goToLineDialog'),
  form: document.querySelector('#goToLineForm'),
  input: document.querySelector('#goToLineInput'),
  current: document.querySelector('#currentLineNumber'),
  total: document.querySelector('#totalLineNumber'),
  error: document.querySelector('#goToLineError'),
  closeButton: document.querySelector('#closeGoToLineButton'),
  cancelButton: document.querySelector('#cancelGoToLineButton')
};

const markdownFilters = [
  { name: 'Markdown 文件', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: '文本文件', extensions: ['txt'] },
  { name: 'TextPack 图文文档', extensions: ['textpack'] }
];

const browserFileTypes = [
  {
    description: 'Markdown 文件',
    accept: {
      'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'],
      'text/plain': ['.txt']
    }
  },
  { description: 'TextPack 图文文档', accept: { 'application/zip': ['.textpack'] } }
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
  goToLineButton: document.querySelector('#goToLineButton'),
  exportImageButton: document.querySelector('#exportImageButton'),
  helpButton: document.querySelector('#helpButton'),
  wysiwygMode: document.querySelector('#wysiwygMode'),
  markdownMode: document.querySelector('#markdownMode'),
  readerMode: document.querySelector('#readerMode')
};

const state = {
  draftId: crypto.randomUUID(),
  currentFilePath: null,
  currentFileWritable: false,
  browserFileHandle: null,
  textPack: null,
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
  mobileChrome: createMobileChromeState({ mobile: mobileLayoutQuery.matches }),
  lastSavedContent: initialMarkdown,
  lastSavedSerializedContent: initialMarkdown,
  textFormat: {
    lineEnding: '\n',
    hasBom: false
  }
};

let workspaceController = null;
let allowNativeClose = false;
let imageHydrationTimer;
let imageHydrationAbort;
let webPasteAbort;

const findReplaceState = {
  query: '',
  matches: [],
  activeIndex: -1,
  anchorOffset: 0,
  documentRevision: -1,
  mode: null,
  snapshot: null
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

const largeDocumentMode = new Compartment();

const largeDocumentHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6
    ],
    color: 'var(--text)',
    fontWeight: 'inherit'
  },
  { tag: tags.strong, color: 'inherit', fontWeight: '600' },
  { tag: tags.emphasis, color: 'inherit', fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  {
    tag: [tags.link, tags.url],
    color: 'var(--link)',
    textDecoration: 'underline'
  },
  {
    tag: tags.monospace,
    color: 'var(--inline-code-text)',
    fontFamily: '"Cascadia Code", "Consolas", monospace'
  },
  { tag: tags.quote, color: 'inherit' },
  { tag: [tags.meta, tags.contentSeparator], color: 'var(--muted-soft)' }
]);

function getLargeDocumentModeExtensions(mode) {
  const isSource = mode === 'markdown';
  const isReader = mode === 'reader';
  const editorClass = isSource
    ? 'cm-large-source'
    : `cm-large-preview${isReader ? ' cm-large-reader' : ''}`;

  return [
    EditorState.readOnly.of(isReader),
    EditorView.editable.of(!isReader),
    EditorView.editorAttributes.of({ class: editorClass }),
    isSource ? [] : largeDocumentPreview
  ];
}

const largeFileEditorExtensions = [
  lineNumbers(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  search({ top: true }),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  markdown({
    base: markdownLanguage,
    addKeymap: false,
    completeHTMLTags: false,
    pasteURLAsLink: false
  }),
  syntaxHighlighting(largeDocumentHighlightStyle),
  EditorState.tabSize.of(2),
  EditorView.lineWrapping,
  largeDocumentMode.of(getLargeDocumentModeExtensions('wysiwyg')),
  EditorView.contentAttributes.of({
    'aria-label': 'Markdown 编辑器',
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
      fontSize: 'var(--source-font-size, 14px)',
      lineHeight: 'var(--document-line-height, 1.5)'
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '18px 0 56px',
      caretColor: 'var(--accent-strong)'
    },
    '.cm-line': {
      padding: '0 18px'
    },
    '&.cm-large-preview .cm-scroller': {
      fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, "Microsoft YaHei", sans-serif',
      fontSize: 'var(--document-font-size, 16px)',
      lineHeight: 'var(--document-line-height, 1.5)'
    },
    '&.cm-large-preview .cm-gutters': {
      display: 'none'
    },
    '&.cm-large-preview .cm-sizer': {
      maxWidth: 'var(--document-layout-max-width)',
      marginLeft: 'auto',
      marginRight: 'auto'
    },
    '&.cm-large-preview .cm-content': {
      maxWidth: 'var(--document-layout-max-width)'
    },
    '&.cm-large-preview .cm-line': {
      maxWidth: 'var(--document-layout-max-width)',
      paddingLeft: '36px',
      paddingRight: '36px'
    },
    '&.cm-large-preview .cm-md-heading': {
      color: 'var(--text)',
      paddingTop: '1rem',
      paddingBottom: '0'
    },
    '&.cm-large-preview .cm-md-heading-1': {
      fontSize: '1.618em',
      fontWeight: '700',
      lineHeight: '1.2',
      letterSpacing: '-0.015em'
    },
    '&.cm-large-preview .cm-md-heading-2': {
      fontSize: '1.462em',
      fontWeight: '680',
      lineHeight: '1.2',
      letterSpacing: '-0.011em'
    },
    '&.cm-large-preview .cm-md-heading-3': {
      fontSize: '1.318em',
      fontWeight: '660',
      lineHeight: '1.3',
      letterSpacing: '-0.008em'
    },
    '&.cm-large-preview .cm-md-heading-4': {
      fontSize: '1.188em',
      fontWeight: '640',
      lineHeight: '1.4',
      letterSpacing: '-0.005em'
    },
    '&.cm-large-preview .cm-md-heading-5': {
      fontSize: '1.076em',
      fontWeight: '620',
      lineHeight: '1.5',
      letterSpacing: '-0.002em'
    },
    '&.cm-large-preview .cm-md-heading-6': {
      fontSize: '1em',
      fontWeight: '600',
      lineHeight: '1.5'
    },
    '&.cm-large-preview .cm-md-blockquote': {
      borderLeft: '2px solid var(--accent)',
      backgroundColor: 'transparent',
      color: 'inherit'
    },
    '&.cm-large-preview .cm-md-codeblock': {
      backgroundColor: 'var(--code-bg)',
      color: 'var(--code-text)',
      fontFamily: '"Cascadia Code", "Consolas", monospace',
      fontSize: '0.9em'
    },
    '&.cm-large-preview .cm-md-table': {
      backgroundColor: 'var(--table-stripe)',
      fontFamily: '"Cascadia Code", "Consolas", "Microsoft YaHei", monospace',
      fontSize: '0.92em'
    },
    '&.cm-large-preview .cm-md-table-header': {
      backgroundColor: 'var(--table-head-bg)',
      color: 'var(--text-strong)',
      fontWeight: '700'
    },
    '&.cm-large-preview .cm-md-horizontal-rule': {
      color: 'var(--muted-soft)'
    },
    '&.cm-large-reader .cm-cursor, &.cm-large-reader .cm-dropCursor': {
      display: 'none'
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

    noteDocumentChanged(updateLargeDocumentByteSize(update));
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
  plugins: [calloutEditorPlugin],
  toolbarItems: [
    ['heading', 'bold', 'italic', 'strike'],
    ['hr', 'quote'],
    ['ul', 'ol', 'task', 'indent', 'outdent'],
    ['table', 'link'],
    ['code', 'codeblock']
  ]
});

const viewPosition = createViewPositionController();

let viewer = Editor.factory({
  el: viewerElement,
  viewer: true,
  initialValue: initialMarkdown,
  customHTMLSanitizer: sanitizeMarkdownHTML
});
enhanceRenderedMarkdown(viewerElement);

const editorFormattingToolbar = editorElement.querySelector('.toastui-editor-toolbar');
editorFormattingToolbar.id = 'mobileFormattingToolbar';
const mobileChromeRegions = [
  mobileFileToolbar,
  mobileModeSwitch,
  themeControl,
  editorFormattingToolbar
];
let mobileReaderScrollFrame = null;
let pendingMobileReaderScrollTarget = null;
let mobileReaderProgrammaticUntil = 0;

function renderMobileChrome() {
  const collapsed = isMobileChromeCollapsed(state.mobileChrome);
  const actionLabel = collapsed ? '展开界面控件' : '收起界面控件';

  document.documentElement.classList.toggle('mobile-chrome-collapsed', collapsed);
  document.documentElement.dataset.mobileChrome = collapsed ? 'compact' : 'expanded';
  mobileChromeToggle.setAttribute('aria-expanded', String(!collapsed));
  mobileChromeToggle.title = actionLabel;
  mobileChromeToggle.querySelector('.mobile-chrome-toggle-label').textContent = actionLabel;

  if (
    collapsed &&
    mobileChromeRegions.some((region) => region.contains(document.activeElement))
  ) {
    mobileChromeToggle.focus({ preventScroll: true });
  }

  mobileChromeRegions.forEach((region) => {
    region.inert = collapsed;
    if (collapsed) {
      region.setAttribute('aria-hidden', 'true');
    } else {
      region.removeAttribute('aria-hidden');
    }
  });
}

function dispatchMobileChrome(event) {
  const wasCollapsed = isMobileChromeCollapsed(state.mobileChrome);
  state.mobileChrome = reduceMobileChrome(state.mobileChrome, event);
  const isCollapsed = isMobileChromeCollapsed(state.mobileChrome);

  if (wasCollapsed !== isCollapsed || event.type !== 'reader-scroll') {
    renderMobileChrome();
  }
}

function markMobileReaderScrollProgrammatic(duration = 240) {
  mobileReaderProgrammaticUntil = performance.now() + duration;
}

function scheduleMobileReaderScroll(event) {
  pendingMobileReaderScrollTarget = event.currentTarget;

  if (mobileReaderScrollFrame !== null) {
    return;
  }

  mobileReaderScrollFrame = window.requestAnimationFrame(() => {
    mobileReaderScrollFrame = null;
    const scrollTarget = pendingMobileReaderScrollTarget;
    pendingMobileReaderScrollTarget = null;

    if (!scrollTarget || !mobileLayoutQuery.matches || state.mode !== 'reader') {
      return;
    }

    dispatchMobileChrome({
      type: 'reader-scroll',
      scrollTop: scrollTarget.scrollTop,
      reason: performance.now() < mobileReaderProgrammaticUntil ? 'programmatic' : 'user'
    });
  });
}

function getCurrentMarkdown() {
  if (state.isLargeDocument) {
    return largeFileEditor.state.doc.toString();
  }

  return editor.getMarkdown();
}

function getDisplayName(filePath) {
  return getFileDisplayName(filePath, state.textPack ? '未命名.textpack' : '未命名.md');
}

function isTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

async function decodeOpenedDocument(bytes, filePath) {
  if (isTextPackFile(filePath, bytes)) return decodeTextPack(bytes);
  return { ...decodeUtf8Document(bytes, {
    preserveOriginal: bytes.byteLength < LARGE_DOCUMENT_THRESHOLD_BYTES
  }), byteSize: bytes.byteLength, textPack: null };
}

async function openBrowserFileWithPicker() {
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: browserFileTypes
  });
  const file = await handle.getFile();
  setStatus('正在读取文件…');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoded = await decodeOpenedDocument(bytes, file.name);

  return {
    canceled: false,
    filePath: file.name,
    ...decoded,
    browserFileHandle: handle
  };
}

async function openBrowserFileWithInput() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.mkd,.txt,.textpack,text/markdown,text/plain,application/zip';
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
          ...await decodeOpenedDocument(bytes, file.name),
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

  const selected = document.documentElement.classList.contains('android-runtime')
    ? await invoke('open_document_picker')
    : await openDialog({
    title: '打开 Markdown 或 TextPack 文档',
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
    ...await decodeOpenedDocument(bytes, filePath)
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
  const blob = new Blob([content], { type: content instanceof Uint8Array ? 'application/zip' : 'text/markdown;charset=utf-8' });
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

function textPackFileName(filePath) {
  return `${(filePath || '未命名.md').replace(/\.[^./\\]+$/, '')}.textpack`;
}

// Materialize the complete output before touching the selected destination.
async function prepareDocumentSave({ content, textPack, sourcePath, targetName, targetFormat }) {
  const wantsPack = targetFormat === 'textpack' || isTextPackFile(targetName);
  if (wantsPack && targetName && !isUriBackedFilePath(targetName) && !isTextPackFile(targetName)) {
    throw new Error('TextPack 图文文档的文件名须以 .textpack 结尾。');
  }
  if (textPack && !wantsPack) throw new Error('图文文档请使用 .textpack 扩展名保存，以保留内置图片。');
  if (!wantsPack) return { content, serializedContent: content, textPack: null };
  if (!textPack) {
    const { readDocumentImageBlob } = await import('./local-images.js');
    const converted = await importMarkdownToTextPack(content, { readImage: (source) => {
      if (!isTauriRuntime()) throw new Error('浏览器无法读取 Markdown 旁的图片，请在 Windows 或 Android 版中打包，或先创建 TextPack 再插入图片。');
      return readDocumentImageBlob(source, { documentPath: sourcePath, invoke });
    } });
    textPack = converted.textPack;
    content = converted.serializedContent;
  }
  return { content: await encodeTextPack(textPack, content), serializedContent: content, textPack };
}

async function saveBrowserFile({ filePath, content, saveAs, browserFileHandle, textPack, sourcePath, targetFormat }) {
  const prepare = (targetName) => prepareDocumentSave({ content, textPack, sourcePath, targetName, targetFormat });
  if (!saveAs && browserFileHandle?.createWritable) {
    const prepared = await prepare(browserFileHandle.name);
    return { ...await saveBrowserFileWithHandle(browserFileHandle, prepared.content), ...prepared };
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: textPack || targetFormat === 'textpack' ? textPackFileName(getDisplayName(filePath)) : getDisplayName(filePath),
        types: textPack || targetFormat === 'textpack' ? browserFileTypes.slice(-1) : browserFileTypes
      });

      const prepared = await prepare(handle.name);
      return { ...await saveBrowserFileWithHandle(handle, prepared.content), ...prepared };
    } catch (error) {
      if (error.name === 'AbortError') {
        return { canceled: true };
      }

      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        const name = textPack || targetFormat === 'textpack' ? textPackFileName(getDisplayName(filePath)) : filePath;
        const prepared = await prepare(name);
        return { ...downloadBrowserFile(name, prepared.content), ...prepared };
      }

      throw error;
    }
  }

  const name = textPack || targetFormat === 'textpack' ? textPackFileName(getDisplayName(filePath)) : filePath;
  const prepared = await prepare(name);
  return { ...downloadBrowserFile(name, prepared.content), ...prepared };
}

async function saveMarkdownFile({
  filePath,
  content,
  saveAs,
  browserFileHandle,
  fileWritable,
  textPack,
  sourcePath,
  targetFormat
}) {
  if (!isTauriRuntime()) {
    return saveBrowserFile({
      filePath,
      content,
      saveAs,
      browserFileHandle,
      textPack, sourcePath, targetFormat
    });
  }

  let targetPath = filePath;

  if (!targetPath || saveAs || !fileWritable) {
    const suggestedPath = targetPath && !isUriBackedFilePath(targetPath) ? targetPath : getDisplayName(targetPath);
    targetPath = await saveDialog({
      title: textPack || targetFormat === 'textpack' ? '保存 TextPack 图文文档' : '保存文档',
      defaultPath: textPack || targetFormat === 'textpack' ? textPackFileName(suggestedPath) : suggestedPath,
      filters: textPack || targetFormat === 'textpack' ? markdownFilters.slice(-1) : markdownFilters
    });

    if (!targetPath) {
      return { canceled: true };
    }
  }

  const prepared = await prepareDocumentSave({ content, textPack, sourcePath, targetName: targetPath, targetFormat });
  await writeNativeDocument({
    filePath: targetPath,
    content: prepared.content,
    writeFile,
    invoke
  });
  return { canceled: false, filePath: targetPath, fileWritable: true, ...prepared };
}

function imageExportFileType(fileName) {
  const isArchive = fileName.toLowerCase().endsWith('.zip');
  return isArchive
    ? {
        description: '分页图片压缩包',
        mimeType: 'application/zip',
        extensions: ['zip']
      }
    : {
        description: 'PNG 图片',
        mimeType: 'image/png',
        extensions: ['png']
      };
}

function downloadBinaryFile(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function chooseImageExportPath(fileName) {
  const fileType = imageExportFileType(fileName);
  return await saveDialog({
    title: '保存图片',
    defaultPath: fileName,
    filters: [{ name: fileType.description, extensions: fileType.extensions }]
  });
}

async function saveImageExport(fileName, blob, { onSaving } = {}) {
  if (isTauriRuntime()) {
    const targetPath = await chooseImageExportPath(fileName);
    if (!targetPath) {
      return { canceled: true };
    }
    onSaving?.();
    await writeFile(targetPath, await imageDataToUint8Array(blob));
    return { canceled: false, filePath: targetPath, download: false };
  }

  downloadBinaryFile(fileName, blob);
  return { canceled: false, filePath: fileName, download: true };
}

let imageExportInProgress = false;
let imageExportAbortController = null;

async function renderImageExportChunk(markdown, mount) {
  mount.replaceChildren();
  const chunkViewer = Editor.factory({
    el: mount,
    viewer: true,
    initialValue: markdown,
    customHTMLSanitizer: sanitizeMarkdownHTML
  });
  enhanceRenderedMarkdown(mount);
  const contents = mount.querySelector('.toastui-editor-contents');
  return {
    contents,
    destroy() {
      chunkViewer.destroy();
      mount.replaceChildren();
    }
  };
}

function imageExportProgressStatus(event) {
  if (event.phase === 'downloading-images') {
    return `正在下载网络图片 ${event.completed || 0} / ${event.total || 0}…`;
  }
  if (event.phase === 'rendering') {
    return `正在生成第 ${(event.pageCount || 0) + 1} 张图片…`;
  }
  if (event.phase === 'saving') {
    return '正在保存图片…';
  }
  return '正在准备图片导出…';
}

const imageExportDialog = createImageExportDialog({
  ...getImageExportDialogElements(document),
  onStart: () => {
    void startImageExport();
  },
  onCancel: ({ state: dialogState }) => {
    if (dialogState === 'confirm') {
      setStatus('已取消图片导出');
      return;
    }
    if (imageExportAbortController && !imageExportAbortController.signal.aborted) {
      imageExportAbortController.abort(new DOMException('已取消图片导出', 'AbortError'));
    }
  }
});

function openImageExportDialog() {
  if (imageExportInProgress || imageExportDialog.state !== 'closed') {
    return;
  }
  imageExportDialog.openConfirm({
    description: '将按阅读排版导出；一页保存为 PNG，多页自动打包为 ZIP。',
    note: '单张最长约两张竖版 A4。网络图片会按安全限制下载，开始后可以取消。'
  });
}

async function startImageExport() {
  if (imageExportInProgress) {
    return;
  }

  imageExportInProgress = true;
  const abortController = new AbortController();
  imageExportAbortController = abortController;
  controls.exportImageButton.disabled = true;
  controls.exportImageButton.setAttribute('aria-busy', 'true');
  const fileName = getDisplayName(state.currentFilePath);
  const exportDocumentPath = state.currentFilePath;
  const exportTextPack = state.textPack;
  let nativeArchive = null;
  let archiveCollector = null;
  let archiveFinished = false;
  let archiveCommitted = false;
  const reportProgress = (event) => {
    imageExportDialog.updateProgress(event);
    setStatus(imageExportProgressStatus(event));
  };

  try {
    let output;
    if (state.isLargeDocument) {
      const documentText = largeFileEditor.state.doc;
      let targetPath = null;
      if (isTauriRuntime()) {
        const archiveName = `${imageExportBaseName(fileName)}-图片.zip`;
        reportProgress({ phase: 'preparing', detail: '请选择分页图片压缩包的保存位置…' });
        targetPath = await chooseImageExportPath(archiveName);
        if (!targetPath) {
          setStatus('已取消图片导出');
          return;
        }
        throwIfAborted(abortController.signal);
        nativeArchive = await createNativeArchiveTemp();
        archiveCollector = createImagePageCollector({
          fileName,
          forceArchive: true,
          signal: abortController.signal,
          writeArchiveChunk: (chunk) => nativeArchive.write(chunk)
        });
      }

      output = await renderMarkdownSourceAsImages({
        fileName,
        lineSource: {
          lineCount: documentText.lines,
          getLine: (lineNumber) => documentText.line(lineNumber).text,
          length: documentText.length
        },
        renderChunk: renderImageExportChunk,
        inlineImages: (root, options) => inlineDocumentImages(root, { ...options, documentPath: exportDocumentPath, textPack: exportTextPack }),
        signal: abortController.signal,
        onProgress: reportProgress,
        onPage: archiveCollector ? (blob) => archiveCollector.add(blob) : undefined
      });

      if (archiveCollector) {
        const archiveOutput = await archiveCollector.finish();
        throwIfAborted(abortController.signal);
        archiveFinished = true;
        await nativeArchive.finish();
        throwIfAborted(abortController.signal);
        imageExportAbortController = null;
        imageExportDialog.setSaving('正在把分页图片写入所选文件…');
        await nativeArchive.commit(targetPath, ({ completed, total }) => {
          imageExportDialog.updateProgress({
            phase: 'saving',
            completed,
            total,
            pageCount: output.pageCount,
            includedImages: output.includedImages,
            failedImages: output.failedImages
          });
        });
        archiveCommitted = true;
        output = { ...output, ...archiveOutput, filePath: targetPath };
      }
    } else {
      if (state.mode !== 'reader') {
        refreshReader();
      }
      const contents = viewerElement.querySelector('.toastui-editor-contents');
      if (!contents) {
        throw new Error('没有可导出的 Markdown 内容');
      }
      const markdown = getCurrentMarkdown();
      const markdownLines = markdown.split('\n');
      if (isTauriRuntime()) {
        nativeArchive = await createNativeArchiveTemp();
        archiveCollector = createImagePageCollector({
          fileName,
          signal: abortController.signal,
          writeArchiveChunk: (chunk) => nativeArchive.write(chunk)
        });
      }
      output = await renderMarkdownAsImages({
        contents,
        fileName,
        lineSource: {
          lineCount: markdownLines.length,
          getLine: (lineNumber) => markdownLines[lineNumber - 1] ?? '',
          length: markdown.length
        },
        renderChunk: renderImageExportChunk,
        inlineImages: (root, options) => inlineDocumentImages(root, { ...options, documentPath: exportDocumentPath, textPack: exportTextPack }),
        signal: abortController.signal,
        onProgress: reportProgress,
        onPage: archiveCollector ? (blob) => archiveCollector.add(blob) : undefined
      });

      if (archiveCollector) {
        const archiveOutput = await archiveCollector.finish();
        throwIfAborted(abortController.signal);
        archiveFinished = true;
        output = { ...output, ...archiveOutput };

        if (archiveOutput.kind === 'zip') {
          await nativeArchive.finish();
          throwIfAborted(abortController.signal);
          const targetPath = await chooseImageExportPath(archiveOutput.fileName);
          if (!targetPath) {
            setStatus('已取消图片导出');
            return;
          }
          throwIfAborted(abortController.signal);
          imageExportAbortController = null;
          imageExportDialog.setSaving('正在把分页图片写入所选文件…');
          await nativeArchive.commit(targetPath, ({ completed, total }) => {
            imageExportDialog.updateProgress({
              phase: 'saving',
              completed,
              total,
              pageCount: output.pageCount,
              includedImages: output.includedImages,
              failedImages: output.failedImages
            });
          });
          archiveCommitted = true;
          output = { ...output, filePath: targetPath };
        }
      }
    }

    let result = { canceled: false, download: false };
    if (!archiveCommitted) {
      throwIfAborted(abortController.signal);
      reportProgress({
        phase: 'preparing',
        detail: isTauriRuntime() ? '请选择图片保存位置…' : '正在准备浏览器下载…',
        pageCount: output.pageCount,
        includedImages: output.includedImages,
        failedImages: output.failedImages
      });
      result = await saveImageExport(output.fileName, output.blob, {
        onSaving: () => {
          throwIfAborted(abortController.signal);
          imageExportAbortController = null;
          imageExportDialog.setSaving();
        }
      });
      if (result.canceled) {
        setStatus('已取消图片导出');
        return;
      }
    }

    const imageWarning = output.failedImages > 0
      ? `，${output.failedImages.toLocaleString()} 张图片未包含`
      : '';
    const action = result.download ? '已请求下载' : '已导出';
    setStatus(output.pageCount > 1
      ? `${action} ${output.pageCount.toLocaleString()} 张分页图片${imageWarning}`
      : `${action}图片${imageWarning}`);
  } catch (error) {
    if (error?.name === 'AbortError' || abortController.signal.aborted) {
      setStatus('已取消图片导出');
      return;
    }
    console.error('导出图片失败', error);
    setStatus('图片导出失败');
    window.alert(`导出图片失败：${error.message || error}`);
  } finally {
    if (archiveCollector && !archiveFinished) {
      archiveCollector.abort();
    }
    if (nativeArchive && !archiveCommitted) {
      try {
        await nativeArchive.discard();
      } catch (error) {
        console.warn('清理图片导出临时文件失败', error);
      }
    }
    imageExportAbortController = null;
    imageExportInProgress = false;
    controls.exportImageButton.disabled = false;
    controls.exportImageButton.setAttribute('aria-busy', 'false');
    imageExportDialog.close();
  }
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
    const decoded = await decodeOpenedDocument(bytes, result.filePath);

    if (!canApplyOpenRequest(request)) {
      return;
    }

    openDocument({
      ...result,
      ...decoded
    });
  } catch (error) {
    if (!canApplyOpenRequest(request)) {
      return;
    }

    setStatus('启动文件打开失败');
    window.alert(`打开启动文件失败：${error.message || error}`);
  }
}

let lastExternalOpen = { uri: null, time: 0 };

async function openExternalFileUrls(urls) {
  const filePath = Array.isArray(urls)
    ? urls.find((url) => typeof url === 'string' && url.length > 0)
    : null;

  if (!filePath) {
    return false;
  }

  const now = Date.now();
  if (lastExternalOpen.uri === filePath && now - lastExternalOpen.time < 1500) {
    return false;
  }
  lastExternalOpen = { uri: filePath, time: now };

  if (!await confirmDiscardChanges()) {
    setStatus('已取消打开外部文件');
    return false;
  }

  const request = beginOpenRequest();

  try {
    setStatus('正在读取外部文件…');
    const bytes = await readFile(filePath);
    const decoded = await decodeOpenedDocument(bytes, filePath);

    if (!canApplyOpenRequest(request)) {
      return false;
    }

    openDocument({
      filePath,
      ...decoded,
      fileWritable: false
    });
    return true;
  } catch (error) {
    if (!canApplyOpenRequest(request)) {
      return false;
    }

    setStatus('打开外部文件失败');
    window.alert(`打开外部文件失败：${error.message || error}`);
    return false;
  }
}

async function initializeNativeFileOpenHandling() {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    await listen('opened', (event) => {
      void openExternalFileUrls(event.payload);
    });

    const openedUrls = await invoke('take_opened_urls');
    if (await openExternalFileUrls(openedUrls)) {
      return;
    }
  } catch (error) {
    console.warn('初始化移动端文件打开处理失败', error);
  }

  await openInitialLaunchFile();
}

async function openDroppedFile(filePath) {
  if (!await confirmDiscardChanges()) {
    setStatus('已取消打开拖入文件');
    return false;
  }

  const request = beginOpenRequest();

  try {
    setStatus('正在读取拖入文件…');
    const bytes = await readFile(filePath);
    const decoded = await decodeOpenedDocument(bytes, filePath);

    if (!canApplyOpenRequest(request)) {
      return false;
    }

    openDocument({
      filePath,
      ...decoded
    });
    return true;
  } catch (error) {
    if (!canApplyOpenRequest(request)) {
      return false;
    }

    throw error;
  }
}

async function initializeNativeFileDrop() {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    await registerNativeFileDrop(getCurrentWindow(), {
      onFileDrop: openDroppedFile,
      onUnsupportedDrop: () => {
        setStatus('仅支持 Markdown 或文本文件');
      },
      onError: (error) => {
        setStatus('拖入文件打开失败');
        window.alert(`打开拖入文件失败：${error.message || error}`);
      }
    });
  } catch (error) {
    console.warn('初始化文件拖放处理失败', error);
  }
}

let statusHideTimer = null;

function setStatus(message) {
  statusText.textContent = message;
  statusText.classList.add('visible');
  window.clearTimeout(statusHideTimer);
  statusHideTimer = window.setTimeout(() => {
    statusText.classList.remove('visible');
  }, 2600);
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

function documentTextChunks(documentText, from = 0, to = documentText.length) {
  return {
    *[Symbol.iterator]() {
      const iterator = documentText.iterRange(from, to);

      while (!iterator.next().done) {
        yield iterator.value;
      }
    }
  };
}

function updateLargeDocumentByteSize(update) {
  if (!Number.isFinite(state.documentByteSize)) {
    return null;
  }

  let byteDelta = 0;

  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    byteDelta -= utf8ByteLengthInChunks(
      documentTextChunks(update.startState.doc, fromA, toA)
    );
    byteDelta += utf8ByteLengthInChunks(documentTextChunks(inserted));
  });

  return Math.max(0, state.documentByteSize + byteDelta);
}

function noteDocumentChanged(documentByteSize = null) {
  state.revision += 1;
  state.documentByteSize = documentByteSize;
  setDirty(state.revision !== state.savedRevision);
  scheduleCountsUpdate();
  workspaceController?.changed();
  scheduleImageHydration();
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
    const byteSize = Number.isFinite(state.documentByteSize)
      ? state.documentByteSize
      : utf8ByteLengthInChunks(documentTextChunks(documentText));
    state.documentByteSize = byteSize;
    const tokenEstimate = estimateLlmTokensFromByteLength(byteSize);

    countText.textContent = `${documentText.length.toLocaleString()} 字符${workspaceController?.preferences.showTokens ? ` / 约 ${tokenEstimate.toLocaleString()} tokens` : ''}`;
    countText.title = `${documentText.length.toLocaleString()} 字符 / 约 ${tokenEstimate.toLocaleString()} tokens（通用估算）`;
    return;
  }

  const text = editor.getMarkdown();
  const tokenEstimate = estimateLlmTokensFromByteLength(
    utf8ByteLength(text)
  );
  countText.textContent = `${text.length.toLocaleString()} 字符${workspaceController?.preferences.showTokens ? ` / 约 ${tokenEstimate.toLocaleString()} tokens` : ''}`;
  countText.title = `${text.length.toLocaleString()} 字符 / 约 ${tokenEstimate.toLocaleString()} tokens（通用估算）`;
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
  mobileDocumentName.textContent = displayName;
  mobileDirtyState.textContent = state.isDirty ? ' •' : '';
  mobileDocumentName.title = state.isDirty ? `${displayName}（未保存）` : displayName;
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

  controls.wysiwygMode.disabled = false;
  controls.readerMode.disabled = false;
  controls.wysiwygMode.title = '';
  controls.readerMode.title = '';
  controls.wysiwygMode.removeAttribute('aria-describedby');
  controls.readerMode.removeAttribute('aria-describedby');
}

function getCalloutTitle(type, rawTitle) {
  if (rawTitle) {
    return rawTitle;
  }

  return calloutTitles[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

function enhanceRenderedMarkdown(root) {
  // Keep source breaks and text nodes intact for copying and mapped search.
  // The empty spacer affects only top-level body text in the reading view.
  root.querySelectorAll('.toastui-editor-contents > p br').forEach((lineBreak) => {
    if (lineBreak.nextElementSibling?.classList.contains('reader-line-gap')) {
      return;
    }
    const gap = document.createElement('span');
    gap.className = 'reader-line-gap';
    gap.setAttribute('aria-hidden', 'true');
    lineBreak.after(gap);
  });

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
  enhanceCodeBlocks(root);
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
  scheduleImageHydration();
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
  state.mode = 'wysiwyg';
  state.lastSavedContent = null;
  state.lastSavedSerializedContent = null;

  // Clear the rich editor before assigning the large text so Toast UI never
  // parses or retains the large document.
  editor.setMarkdown('', false);
  editorElement.classList.add('hidden');
  editorElement.setAttribute('aria-hidden', 'true');
  largeFilePanel.classList.remove('hidden');
  largeFilePanel.setAttribute('aria-hidden', 'false');
  largeFileEditor.setState(createLargeFileEditorState(content));
  showEditorPanel();

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
    fileWritable = canOverwriteOpenedFile(filePath),
    lineEnding = '\n',
    hasBom = false,
    originalSerializedContent = null,
    textPack = null
  } = {}
) {
  workspaceController?.beforeDocumentChange();
  imageHydrationAbort?.abort();
  webPasteAbort?.abort();
  viewPosition.cancel();
  closeFindReplace({ restoreMode: false, restoreFocus: false });
  const content = normalizeEditorText(markdown || '');
  const measuredSize = Number.isFinite(byteSize) ? byteSize : utf8ByteLength(content);
  const isLargeDocument = shouldUseLargeDocumentMode(measuredSize, content.length);

  state.documentId += 1;
  state.draftId = crypto.randomUUID();
  state.revision = 0;
  state.savedRevision = 0;
  state.currentFilePath = filePath;
  state.currentFileWritable = fileWritable;
  state.browserFileHandle = browserFileHandle;
  state.textPack = textPack;
  state.textFormat = { lineEnding, hasBom };
  // Keep an exact source bypass for Toast UI documents. CodeMirror already
  // preserves large-document text, so retaining another multi-megabyte string
  // there would only increase memory pressure.
  state.lastSavedContent = isLargeDocument ? null : content;
  state.lastSavedSerializedContent = isLargeDocument
    ? null
    : (originalSerializedContent ?? serializeTextDocument(content, { lineEnding, hasBom }));
  state.documentByteSize = measuredSize;
  markMobileReaderScrollProgrammatic();
  readerPanel.scrollTop = 0;
  largeFileEditor.scrollDOM.scrollTop = 0;
  dispatchMobileChrome({ type: 'document-change', mode: 'wysiwyg' });
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
  scheduleImageHydration();
  void workspaceController?.rebuildOutline();
  return isLargeDocument;
}

function openDocument({
  content,
  filePath,
  byteSize,
  browserFileHandle = null,
  fileWritable = canOverwriteOpenedFile(filePath),
  lineEnding = '\n',
  hasBom = false,
  originalSerializedContent = null,
  textPack = null
}) {
  const isLargeDocument = setDocument(content, filePath, byteSize, {
    browserFileHandle,
    fileWritable,
    lineEnding,
    hasBom,
    originalSerializedContent,
    textPack
  });

  setStatus(`已打开 ${getDisplayName(filePath)}`);
  void workspaceController?.documentOpened();
}

async function confirmDiscardChanges() {
  if (!state.isDirty) {
    return true;
  }

  return workspaceController ? workspaceController.askToLeave() : false;
}

async function newFile() {
  if (!await confirmDiscardChanges()) {
    return;
  }

  invalidateOpenRequests();
  setDocument('# 未命名笔记\n\n开始写 Markdown...\n', null, 0);
  setStatus('已新建文件');
}

async function newTextPack() {
  if (!await confirmDiscardChanges()) return;
  invalidateOpenRequests();
  setDocument('# 未命名笔记\n\n开始写 Markdown...\n', null, 0, { textPack: createTextPack(), fileWritable: false });
  setStatus('已新建 TextPack，可直接粘贴或插入图片，保存时图片会一同写入文档');
}

async function openFile() {
  if (!await confirmDiscardChanges()) {
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
    const targetFileWritable = !saveAs && isCurrentDocument
      ? state.currentFileWritable
      : snapshot.fileWritable;
    const result = await saveMarkdownFile({
      filePath: targetFilePath,
      content: materialized.serializedContent,
      saveAs,
      browserFileHandle: targetBrowserHandle,
      fileWritable: targetFileWritable,
      textPack: snapshot.textPack,
      sourcePath: snapshot.filePath,
      targetFormat: snapshot.targetFormat || (snapshot.textPack ? 'textpack' : null)
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

    const hasNewerChanges = !matchesDocumentRevision(snapshot, state);
    if (!snapshot.textPack && result.textPack) {
      if (hasNewerChanges) {
        setStatus(`已打包 ${getDisplayName(result.filePath)}；当前文档有更新，继续保留编辑中的内容`);
        return;
      }
      const mode = state.mode;
      const position = captureDocumentPosition();
      state.currentFilePath = result.filePath;
      setDirty(false);
      workspaceController?.saved(snapshot);
      const decoded = decodeUtf8Document(new TextEncoder().encode(result.serializedContent), { preserveOriginal: !state.isLargeDocument });
      setDocument(decoded.content, result.filePath, utf8ByteLength(result.serializedContent), {
        ...decoded, textPack: result.textPack, fileWritable: result.fileWritable ?? false,
        browserFileHandle: result.browserFileHandle ?? null
      });
      restoreDocumentPosition(mode, position);
      void workspaceController?.documentOpened();
      setStatus(`已保存 ${getDisplayName(result.filePath)}，本地图片已内置`);
      return;
    }

    state.currentFilePath = result.filePath;
    state.currentFileWritable = result.fileWritable ?? snapshot.fileWritable;
    state.browserFileHandle = result.browserFileHandle || snapshot.browserFileHandle;
    state.savedRevision = snapshot.revision;
    state.lastSavedContent = state.isLargeDocument ? null : materialized.content;
    state.lastSavedSerializedContent = state.isLargeDocument
      ? null
      : materialized.serializedContent;
    setDirty(hasNewerChanges);
    workspaceController?.saved(snapshot);
    scheduleImageHydration();
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

function captureSaveSnapshot(_saveAs, targetFormat = null) {
  const hasUnchangedSource =
    state.revision === state.savedRevision &&
    state.lastSavedContent !== null &&
    state.lastSavedSerializedContent !== null;
  const content = state.isLargeDocument
    ? null
    : (hasUnchangedSource ? state.lastSavedContent : editor.getMarkdown());
  const textFormat = { ...state.textFormat };

  return {
    draftId: state.draftId,
    documentId: state.documentId,
    revision: state.revision,
    filePath: state.currentFilePath,
    fileWritable: state.currentFileWritable,
    browserFileHandle: state.browserFileHandle,
    textPack: state.textPack,
    targetFormat,
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
    getCoalesceKey: (snapshot, saveAs) => `${getSaveCoalesceKey(snapshot, saveAs)}:${snapshot.targetFormat || ''}`
  }
);

function saveFile(saveAs = false, targetFormat = null) {
  return enqueueSaveTask(saveAs, targetFormat);
}

function isFindReplaceOpen() {
  return !findReplaceElements.panel.hidden;
}

function createWysiwygFindSnapshot() {
  const documentNode = editor.wwEditor?.view?.state?.doc;

  if (!documentNode?.descendants) {
    return { kind: 'wysiwyg-raw', text: getCurrentMarkdown() };
  }

  const blocks = [];
  documentNode.descendants((node, position, parent) => {
    if (!node.isTextblock) {
      return true;
    }

    const blockStart = position + 1;
    const segments = [];
    node.descendants((child, childPosition) => {
      if (child.isText && child.text) {
        segments.push({
          text: child.text,
          from: blockStart + childPosition
        });
      } else if (child.isLeaf) {
        segments.push({
          text: '\uFFFC',
          from: blockStart + childPosition,
          replaceable: false
        });
      }

      return !child.isText;
    });
    blocks.push({
      from: blockStart,
      to: blockStart + node.content.size,
      parent,
      segments
    });

    return false;
  });

  return {
    kind: 'wysiwyg',
    ...buildMappedTextBlocks(blocks)
  };
}

function createReaderFindSnapshot() {
  const markdown = getCurrentMarkdown();
  const root = viewer?.toastMark?.getRootNode?.();
  const visibleSnapshot = createVisibleFindSnapshot(viewerElement, {
    includeNodeIds: true
  });

  if (!root) {
    return {
      kind: 'reader-readonly',
      ...visibleSnapshot
    };
  }

  const nodeIdCounts = new Map();
  viewerElement.querySelectorAll('[data-nodeid]').forEach((element) => {
    const nodeId = Number(element.getAttribute('data-nodeid'));
    if (Number.isFinite(nodeId)) {
      nodeIdCounts.set(nodeId, (nodeIdCounts.get(nodeId) || 0) + 1);
    }
  });
  const invalidNodeIds = [...nodeIdCounts]
    .filter(([, count]) => count !== 1)
    .map(([nodeId]) => nodeId);
  const sourceSnapshot = buildMarkdownAstFindSnapshot(markdown, root);

  return {
    kind: 'reader',
    ...mapVisibleFindSnapshotToSource(visibleSnapshot, sourceSnapshot, {
      invalidNodeIds
    })
  };
}

function getFindSearchSnapshot(query = findReplaceElements.findInput.value) {
  if (state.isLargeDocument) {
    return { kind: 'large', text: getCurrentMarkdown() };
  }

  if (state.mode === 'wysiwyg') {
    if (decodeFindReplaceEscapes(query).includes('\n')) {
      return { kind: 'wysiwyg-source', text: getCurrentMarkdown() };
    }

    return createWysiwygFindSnapshot();
  }

  if (state.mode === 'reader') {
    if (decodeFindReplaceEscapes(query).includes('\n')) {
      return { kind: 'reader-source', text: getCurrentMarkdown() };
    }

    return createReaderFindSnapshot();
  }

  return {
    kind: 'markdown',
    text: getCurrentMarkdown()
  };
}

function getFindCursorOffset(snapshot = getFindSearchSnapshot()) {
  if (snapshot.kind === 'large') {
    return largeFileEditor.state.selection.main.head;
  }

  if (snapshot.kind === 'wysiwyg') {
    const selection = editor.getSelection();
    return mappedTextOffsetAtPosition(snapshot.spans, selection?.[1] ?? selection?.[0]);
  }

  if (snapshot.kind !== 'markdown') {
    return 0;
  }

  const selection = editor.getSelection();
  const cursor = Array.isArray(selection?.[1]) ? selection[1] : selection?.[0];
  return markdownPositionToOffset(snapshot.text, cursor);
}

function getSelectedFindText() {
  if (state.mode === 'reader') {
    return '';
  }

  if (state.isLargeDocument) {
    const selection = largeFileEditor.state.selection.main;
    return largeFileEditor.state.doc.sliceString(selection.from, selection.to);
  }

  return editor.getSelectedText();
}

const visibleFindBlockSelector = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'pre',
  'blockquote',
  'td',
  'th'
].join(',');

function createVisibleFindSnapshot(
  root,
  { directNodeText = false, includeNodeIds = false } = {}
) {
  const spans = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
  );
  let text = '';
  let previousBlock = null;
  let previousTextNode = null;
  let previousBreakParent = null;
  let currentNode = walker.nextNode();

  while (currentNode) {
    if (currentNode.nodeType === Node.ELEMENT_NODE) {
      if (currentNode.tagName === 'BR') {
        const owner = currentNode.parentElement?.closest('[data-nodeid]');
        if (!directNodeText || owner === root) {
          text += '\n';
          spans.push({
            node: null,
            beforeNode: previousTextNode,
            afterNode: null,
            nodeId: includeNodeIds ? Number(owner?.getAttribute('data-nodeid')) : null,
            separator: true,
            replaceable: false
          });
          previousBreakParent = currentNode.parentElement;
        }
      }
      currentNode = walker.nextNode();
      continue;
    }

    const textNode = currentNode;
    if (
      directNodeText &&
      textNode.parentElement?.closest('[data-nodeid]') !== root
    ) {
      currentNode = walker.nextNode();
      continue;
    }

    let value = textNode.nodeValue || '';
    let textNodeOffset = 0;
    const parent = textNode.parentElement;

    if (parent === previousBreakParent) {
      const normalizedValue = value.replace(/^\r?\n/, '');
      textNodeOffset = value.length - normalizedValue.length;
      value = normalizedValue;
    }
    previousBreakParent = null;

    const isPreformatted = Boolean(parent?.closest('pre, code'));
    const isRendererWhitespace =
      !isPreformatted &&
      !value.trim() &&
      /[\r\n]/.test(value) &&
      (
        !parent?.matches('p, h1, h2, h3, h4, h5, h6, li, td, th') ||
        Boolean(parent?.querySelector(':scope > br'))
      );

    if (isRendererWhitespace) {
      currentNode = walker.nextNode();
      continue;
    }

    const block = textNode.parentElement?.closest(visibleFindBlockSelector) || root;
    const owner = textNode.parentElement?.closest('[data-nodeid]');
    const nodeId = includeNodeIds
      ? Number(owner?.getAttribute('data-nodeid'))
      : null;

    if (value && text && block !== previousBlock) {
      text += '\n';
      spans.push({
        node: null,
        beforeNode: previousTextNode,
        afterNode: textNode,
        nodeId: null,
        separator: true,
        replaceable: false
      });
    }

    for (let index = 0; index < value.length; index += 1) {
      text += value[index];
      spans.push({
        node: textNode,
        from: textNodeOffset + index,
        to: textNodeOffset + index + 1,
        nodeId: Number.isFinite(nodeId) ? nodeId : null,
        separator: false,
        replaceable: false
      });
    }

    if (value) {
      previousBlock = block;
      previousTextNode = textNode;
    }
    currentNode = walker.nextNode();
  }

  return { text, spans };
}

function clearVisibleFindSelection(root) {
  const selection = window.getSelection();

  if (selection?.anchorNode && root.contains(selection.anchorNode)) {
    selection.removeAllRanges();
  }
}

function selectVisibleFindMatch(root, query, activeIndex, options) {
  const snapshot = createVisibleFindSnapshot(root, options);
  const matches = findTextMatches(snapshot.text, query);

  if (!matches.length) {
    clearVisibleFindSelection(root);
    return;
  }

  const match = matches[activeIndex % matches.length];
  let first = match.from;
  let last = match.to - 1;

  while (first <= last && !snapshot.spans[first]?.node) {
    first += 1;
  }
  while (last >= first && !snapshot.spans[last]?.node) {
    last -= 1;
  }

  if (first <= last) {
    const firstSpan = snapshot.spans[first];
    const lastSpan = snapshot.spans[last];
    const range = document.createRange();
    range.setStart(firstSpan.node, firstSpan.from);
    range.setEnd(lastSpan.node, lastSpan.to);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    firstSpan.node.parentElement?.scrollIntoView({ block: 'center' });
    return;
  }

  const separator = snapshot.spans[match.from];
  separator?.afterNode?.parentElement?.scrollIntoView({ block: 'center' });
}

function renderFindReplaceState() {
  const { matches, activeIndex } = findReplaceState;
  const hasMatches = matches.length > 0;
  const snapshot = findReplaceState.snapshot;
  const isWritable = snapshot?.kind !== 'reader-readonly';
  const isMappedMatchWritable = (match) => (
    !snapshot?.spans || Boolean(mappedTextRange(snapshot.spans, match.from, match.to))
  );
  const canReplace = hasMatches && isWritable && isMappedMatchWritable(matches[activeIndex]);
  const canReplaceAll = hasMatches && isWritable && matches.some(isMappedMatchWritable);

  findReplaceElements.matchCount.value = hasMatches
    ? `${activeIndex + 1} / ${matches.length}`
    : '0 / 0';
  findReplaceElements.previousButton.disabled = !hasMatches;
  findReplaceElements.nextButton.disabled = !hasMatches;
  findReplaceElements.replaceButton.disabled = !canReplace;
  findReplaceElements.replaceAllButton.disabled = !canReplaceAll;
}

function selectFindMatch() {
  const match = findReplaceState.matches[findReplaceState.activeIndex];
  const snapshot = findReplaceState.snapshot;

  renderFindReplaceState();
  if (!match) {
    if (snapshot?.kind?.startsWith('reader')) {
      clearVisibleFindSelection(viewerElement);
    }
    return;
  }

  if (snapshot.kind === 'large') {
    largeFileEditor.dispatch({
      selection: { anchor: match.from, head: match.to },
      scrollIntoView: true
    });
    return;
  }

  if (snapshot.kind === 'wysiwyg') {
    const range = mappedTextRange(snapshot.spans, match.from, match.to);

    if (range) {
      editor.setSelection(range[0], range[1]);
    }
    return;
  }

  if (
    snapshot.kind === 'reader' ||
    snapshot.kind === 'reader-readonly' ||
    snapshot.kind === 'reader-source' ||
    snapshot.kind === 'wysiwyg-raw' ||
    snapshot.kind === 'wysiwyg-source'
  ) {
    if (snapshot.kind === 'reader') {
      const nodeId = mappedTextNodeId(snapshot.spans, match.from, match.to);
      const anchors = nodeId === null || nodeId === undefined
        ? []
        : viewerElement.querySelectorAll(`[data-nodeid="${nodeId}"]`);
      const anchor = anchors.length === 1 ? anchors[0] : null;

      if (anchor) {
        const anchorMatchIndex = findReplaceState.matches
          .slice(0, findReplaceState.activeIndex)
          .filter((candidate) => (
            mappedTextNodeId(snapshot.spans, candidate.from, candidate.to) === nodeId
          ))
          .length;
        selectVisibleFindMatch(
          anchor,
          findReplaceElements.findInput.value,
          anchorMatchIndex,
          { directNodeText: true }
        );
        return;
      }
    }

    selectVisibleFindMatch(
      snapshot.kind.startsWith('reader')
        ? viewerElement
        : (editorElement.querySelector('.toastui-editor-ww-container') || editorElement),
      findReplaceElements.findInput.value,
      findReplaceState.activeIndex
    );
    return;
  }

  editor.setSelection(
    offsetToMarkdownPosition(snapshot.text, match.from),
    offsetToMarkdownPosition(snapshot.text, match.to)
  );
}

function refreshFindMatches({
  anchorOffset = findReplaceState.anchorOffset,
  direction = 1,
  snapshot = getFindSearchSnapshot(findReplaceElements.findInput.value)
} = {}) {
  const query = findReplaceElements.findInput.value;

  findReplaceState.query = query;
  findReplaceState.snapshot = snapshot;
  findReplaceState.mode = state.mode;
  const matches = findTextMatches(snapshot.text, query);
  findReplaceState.matches = snapshot.kind === 'wysiwyg' && snapshot.spans
    ? matches.filter((match) => (
      snapshot.spans
        .slice(match.from, match.to)
        .every((span) => span.replaceable !== false)
    ))
    : matches;
  findReplaceState.activeIndex = findMatchIndex(
    findReplaceState.matches,
    anchorOffset,
    direction
  );
  findReplaceState.documentRevision = state.revision;
  selectFindMatch();
}

function ensureCurrentFindMatches() {
  const query = findReplaceElements.findInput.value;

  if (
    query !== findReplaceState.query ||
    findReplaceState.documentRevision !== state.revision ||
    findReplaceState.mode !== state.mode
  ) {
    const snapshot = getFindSearchSnapshot(query);
    findReplaceState.anchorOffset = getFindCursorOffset(snapshot);
    refreshFindMatches({ snapshot });
  }
}

function moveFindMatch(direction) {
  ensureCurrentFindMatches();
  const matchCount = findReplaceState.matches.length;

  if (!matchCount) {
    return;
  }

  findReplaceState.activeIndex =
    (findReplaceState.activeIndex + direction + matchCount) % matchCount;
  selectFindMatch();
}

function replaceMappedWysiwygRange(snapshot, from, to, replacement) {
  if (snapshot.text.slice(from, to) === replacement) {
    return false;
  }

  const range = mappedTextRange(snapshot.spans, from, to);
  if (!range) {
    return false;
  }

  const matchedSpans = snapshot.spans.slice(from, to);
  const isInlineReplacement =
    !/[\r\n]/.test(replacement) &&
    matchedSpans.every((span) => !span.separator);
  const wysiwygView = editor.wwEditor?.view;

  if (isInlineReplacement && wysiwygView?.state?.tr) {
    const { doc, schema, tr } = wysiwygView.state;
    let preservedMarks = null;
    doc.nodesBetween(range[0], range[1], (node) => {
      if (!node.isText) {
        return true;
      }

      preservedMarks = preservedMarks === null
        ? node.marks
        : preservedMarks.filter((mark) => mark.isInSet(node.marks));
      return false;
    });

    const transaction = replacement
      ? tr.replaceWith(
        range[0],
        range[1],
        schema.text(replacement, preservedMarks || [])
      )
      : tr.deleteRange(range[0], range[1]);
    transaction.scrollIntoView();
    wysiwygView.dispatch(transaction);
  } else {
    editor.wwEditor.replaceSelection(replacement, range[0], range[1]);
  }

  return true;
}

function commitReaderMarkdown(nextText) {
  const releaseSuppression = beginSuppressChanges();

  try {
    editor.setMarkdown(nextText, false);
  } finally {
    releaseSuppression();
  }

  noteDocumentChanged();
  refreshReader();
}

function replaceFindRange(from, to, replacement) {
  const snapshot = findReplaceState.snapshot || getFindSearchSnapshot();

  if (snapshot.kind === 'wysiwyg') {
    return replaceMappedWysiwygRange(snapshot, from, to, replacement);
  }

  if (snapshot.kind === 'reader-readonly') {
    return false;
  }

  if (snapshot.kind === 'reader') {
    if (snapshot.text.slice(from, to) === replacement) {
      return false;
    }

    const range = mappedTextRange(snapshot.spans, from, to);
    if (!range) {
      return false;
    }

    const markdown = getCurrentMarkdown();
    const nextText = `${markdown.slice(0, range[0])}${replacement}${markdown.slice(range[1])}`;
    commitReaderMarkdown(nextText);
    return true;
  }

  const text = getCurrentMarkdown();

  if (text.slice(from, to) === replacement) {
    return false;
  }

  if (state.isLargeDocument) {
    largeFileEditor.dispatch({
      changes: { from, to, insert: replacement },
      selection: { anchor: from + replacement.length }
    });
  } else if (snapshot.kind === 'markdown') {
    editor.replaceSelection(
      replacement,
      offsetToMarkdownPosition(text, from),
      offsetToMarkdownPosition(text, to)
    );
  } else {
    const nextText = `${text.slice(0, from)}${replacement}${text.slice(to)}`;
    const releaseSuppression = beginSuppressChanges();
    try {
      editor.setMarkdown(nextText, false);
    } finally {
      releaseSuppression();
    }
    noteDocumentChanged();

    if (snapshot.kind === 'reader-source') {
      refreshReader();
    }
  }

  return true;
}

function replaceCurrentFindMatch() {
  ensureCurrentFindMatches();
  const match = findReplaceState.matches[findReplaceState.activeIndex];

  if (!match) {
    return;
  }

  const replacement = decodeFindReplaceEscapes(findReplaceElements.replaceInput.value);
  const changed = replaceFindRange(match.from, match.to, replacement);
  findReplaceState.anchorOffset = match.from + replacement.length;
  refreshFindMatches({ anchorOffset: findReplaceState.anchorOffset });

  if (changed) {
    setStatus('已替换 1 处');
  }
}

function replaceAllFindMatches() {
  ensureCurrentFindMatches();
  const text = findReplaceState.snapshot?.text ?? getCurrentMarkdown();
  const matches = findReplaceState.matches;

  if (!matches.length) {
    return;
  }

  const replacementInput = findReplaceElements.replaceInput.value;
  const replacement = decodeFindReplaceEscapes(replacementInput);

  if (findReplaceState.snapshot?.kind === 'reader') {
    let nextText = getCurrentMarkdown();
    let replacementCount = 0;

    [...matches].reverse().forEach((match) => {
      if (text.slice(match.from, match.to) === replacement) {
        return;
      }

      const range = mappedTextRange(
        findReplaceState.snapshot.spans,
        match.from,
        match.to
      );

      if (range) {
        nextText = `${nextText.slice(0, range[0])}${replacement}${nextText.slice(range[1])}`;
        replacementCount += 1;
      }
    });

    if (replacementCount) {
      commitReaderMarkdown(nextText);
    }

    findReplaceState.anchorOffset = 0;
    refreshFindMatches({ anchorOffset: 0 });

    if (replacementCount) {
      setStatus(`已替换 ${replacementCount} 处`);
    }
    return;
  }

  if (findReplaceState.snapshot?.kind === 'wysiwyg') {
    let replacementCount = 0;

    [...matches].reverse().forEach((match) => {
      if (
        replaceMappedWysiwygRange(
          findReplaceState.snapshot,
          match.from,
          match.to,
          replacement
        )
      ) {
        replacementCount += 1;
      }
    });

    findReplaceState.anchorOffset = 0;
    refreshFindMatches({ anchorOffset: 0 });

    if (replacementCount) {
      setStatus(`已替换 ${replacementCount} 处`);
    }
    return;
  }

  const replacedText = replaceAllText(text, matches, replacementInput);
  const changed = replaceFindRange(0, text.length, replacedText);
  findReplaceState.anchorOffset = 0;
  refreshFindMatches({ anchorOffset: 0 });

  if (changed) {
    setStatus(`已替换 ${matches.length} 处`);
  }
}

function openFindReplace() {
  const wasOpen = isFindReplaceOpen();
  let selectedText = '';

  if (!wasOpen) {
    selectedText = getSelectedFindText();
    findReplaceElements.panel.hidden = false;
    if (selectedText && selectedText.length <= 200 && !/[\r\n]/.test(selectedText)) {
      findReplaceElements.findInput.value = selectedText;
    }
    const snapshot = getFindSearchSnapshot(findReplaceElements.findInput.value);
    findReplaceState.anchorOffset = getFindCursorOffset(snapshot);
    refreshFindMatches({ snapshot });
  }

  window.requestAnimationFrame(() => {
    findReplaceElements.findInput.focus({ preventScroll: true });
    findReplaceElements.findInput.select();
  });
}

function closeFindReplace({ restoreFocus = true } = {}) {
  if (!isFindReplaceOpen()) {
    return;
  }

  findReplaceElements.panel.hidden = true;
  clearVisibleFindSelection(viewerElement);
  clearVisibleFindSelection(editorElement);
  findReplaceState.matches = [];
  findReplaceState.activeIndex = -1;
  findReplaceState.mode = null;
  findReplaceState.snapshot = null;
  renderFindReplaceState();

  if (restoreFocus) {
    if (state.isLargeDocument) {
      largeFileEditor.focus();
    } else if (state.mode === 'reader') {
      readerPanel.focus({ preventScroll: true });
    } else {
      editor.focus();
    }
  }
}

let goToLineReturnFocus = null;
let restoreGoToLineFocusOnClose = true;
let lastRequestedLine = 1;

function getDocumentLineCount() {
  return state.isLargeDocument
    ? largeFileEditor.state.doc.lines
    : countTextLines(getCurrentMarkdown());
}

function getCurrentLineNumber() {
  if (state.isLargeDocument) {
    const head = largeFileEditor.state.selection.main.head;
    return largeFileEditor.state.doc.lineAt(head).number;
  }

  if (state.mode !== 'markdown') {
    return Math.min(lastRequestedLine, getDocumentLineCount());
  }

  const selection = editor.getSelection();
  const cursor = Array.isArray(selection?.[1]) ? selection[1] : selection?.[0];
  return Math.max(1, Number(cursor?.[0]) || 1);
}

function setGoToLineError(message = '') {
  goToLineElements.error.textContent = message;
  goToLineElements.error.hidden = !message;
  goToLineElements.input.setAttribute('aria-invalid', String(Boolean(message)));
}

function openGoToLine() {
  if (goToLineElements.dialog.open) {
    return;
  }

  goToLineReturnFocus = document.activeElement;
  restoreGoToLineFocusOnClose = true;
  closeFindReplace({ restoreFocus: false });

  const totalLines = getDocumentLineCount();
  const currentLine = Math.min(getCurrentLineNumber(), totalLines);
  goToLineElements.current.value = currentLine.toLocaleString();
  goToLineElements.total.value = totalLines.toLocaleString();
  goToLineElements.input.max = String(totalLines);
  goToLineElements.input.value = String(currentLine);
  setGoToLineError();

  if (typeof goToLineElements.dialog.showModal === 'function') {
    goToLineElements.dialog.showModal();
  } else {
    goToLineElements.dialog.setAttribute('open', '');
  }

  window.requestAnimationFrame(() => {
    goToLineElements.input.focus({ preventScroll: true });
    goToLineElements.input.select();
  });
}

function closeGoToLine({ restoreFocus = true } = {}) {
  if (!goToLineElements.dialog.open) {
    return;
  }

  restoreGoToLineFocusOnClose = restoreFocus;
  if (typeof goToLineElements.dialog.close === 'function') {
    goToLineElements.dialog.close();
  } else {
    goToLineElements.dialog.removeAttribute('open');
    goToLineElements.dialog.dispatchEvent(new Event('close'));
  }
}

function jumpToLine(line) {
  viewPosition.cancel();
  lastRequestedLine = line;

  if (state.isLargeDocument) {
    const documentText = largeFileEditor.state.doc;
    const offset = documentText.line(line).from;
    largeFileEditor.dispatch({
      selection: { anchor: offset },
      scrollIntoView: true
    });
    largeFileEditor.focus();
  } else {
    if (state.mode !== 'markdown') {
      setMode('markdown');
    }
    editor.setSelection([line, 1]);
    editor.focus();
  }

  setStatus(`已跳转到第 ${line.toLocaleString()} 行`);
}

function submitGoToLine() {
  const result = parseLineNumber(goToLineElements.input.value, getDocumentLineCount());

  if (!result.valid) {
    const message = result.reason === 'range'
      ? `请输入 1 到 ${result.maximum.toLocaleString()} 之间的行号。`
      : '请输入整数行号。';
    setGoToLineError(message);
    goToLineElements.input.focus({ preventScroll: true });
    goToLineElements.input.select();
    return;
  }

  closeGoToLine({ restoreFocus: false });
  window.requestAnimationFrame(() => jumpToLine(result.line));
}

let helpReturnFocus = null;

function openHelp() {
  if (helpElements.dialog.open) {
    return;
  }

  helpReturnFocus = document.activeElement;
  closeFindReplace({ restoreFocus: false });
  helpElements.hideOnStartup.checked = isStartupHelpHidden();

  if (typeof helpElements.dialog.showModal === 'function') {
    helpElements.dialog.showModal();
  } else {
    helpElements.dialog.setAttribute('open', '');
  }
  helpElements.dialog.querySelector('.help-dialog-content').scrollTop = 0;
}

function closeHelp() {
  if (!helpElements.dialog.open) {
    return;
  }

  if (typeof helpElements.dialog.close === 'function') {
    helpElements.dialog.close();
  } else {
    helpElements.dialog.removeAttribute('open');
    helpElements.dialog.dispatchEvent(new Event('close'));
  }
}

function changeModeFromControl(mode) {
  if (mode === state.mode) return;
  viewPosition.cancel();
  const position = state.isLargeDocument
    ? largeFileEditor.scrollSnapshot()
    : captureViewPosition(...getCurrentViewElements());
  closeFindReplace({ restoreFocus: false });
  setMode(mode);
  if (state.isLargeDocument) {
    largeFileEditor.dispatch({ effects: position });
  } else {
    viewPosition.restore(position, ...getCurrentViewElements());
  }
}

function getCurrentViewElements() {
  if (state.mode === 'reader') return [viewerElement, readerPanel];
  const root = state.mode === 'markdown' ? editor.mdEditor.view.dom : editor.wwEditor.view.dom;
  return [root, root];
}

function setMode(mode) {
  state.mode = mode;
  markMobileReaderScrollProgrammatic();
  dispatchMobileChrome({ type: 'mode-change', mode });
  workspaceController?.modeChanged();
  scheduleImageHydration();

  if (state.isLargeDocument) {
    showEditorPanel();
    largeFileEditor.dispatch({
      effects: largeDocumentMode.reconfigure(getLargeDocumentModeExtensions(mode))
    });
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
    try {
      showEditorPanel();
      // The app restores the viewport itself. Toast UI's cursor mapping can
      // point past the last source line after inserting adjacent image atoms.
      editor.changeMode(mode, true);
      const [root] = getCurrentViewElements();
      root.focus({ preventScroll: true });
    } finally { releaseSuppression(); }
  }

  updateModeButtons();
}

function runAction(action) {
  const actions = {
    new: newFile,
    open: openFile,
    save: () => saveFile(false),
    'save-as': () => saveFile(true),
    find: openFindReplace,
    'go-to-line': openGoToLine,
    'export-image': openImageExportDialog,
    wysiwyg: () => changeModeFromControl('wysiwyg'),
    markdown: () => changeModeFromControl('markdown'),
    reader: () => changeModeFromControl('reader')
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
controls.goToLineButton.addEventListener('click', openGoToLine);
controls.exportImageButton.addEventListener('click', openImageExportDialog);
controls.helpButton.addEventListener('click', openHelp);
controls.wysiwygMode.addEventListener('click', () => changeModeFromControl('wysiwyg'));
controls.markdownMode.addEventListener('click', () => changeModeFromControl('markdown'));
controls.readerMode.addEventListener('click', () => changeModeFromControl('reader'));
findReplaceElements.panel.addEventListener('submit', (event) => {
  event.preventDefault();
  moveFindMatch(1);
});
findReplaceElements.panel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeFindReplace();
  } else if (
    event.key === 'Enter' &&
    !event.isComposing &&
    (
      event.target === findReplaceElements.findInput ||
      event.target === findReplaceElements.replaceInput
    )
  ) {
    event.preventDefault();
    moveFindMatch(event.shiftKey ? -1 : 1);
  }
});
findReplaceElements.findInput.addEventListener('input', () => {
  refreshFindMatches();
});
findReplaceElements.previousButton.addEventListener('click', () => moveFindMatch(-1));
findReplaceElements.replaceButton.addEventListener('click', () => {
  replaceCurrentFindMatch();
  window.requestAnimationFrame(() => {
    findReplaceElements.replaceButton.focus({ preventScroll: true });
  });
});
findReplaceElements.replaceAllButton.addEventListener('click', () => {
  replaceAllFindMatches();
  window.requestAnimationFrame(() => {
    findReplaceElements.replaceAllButton.focus({ preventScroll: true });
  });
});
findReplaceElements.closeButton.addEventListener('click', () => closeFindReplace());
goToLineElements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitGoToLine();
});
goToLineElements.input.addEventListener('input', () => setGoToLineError());
goToLineElements.closeButton.addEventListener('click', () => closeGoToLine());
goToLineElements.cancelButton.addEventListener('click', () => closeGoToLine());
goToLineElements.dialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeGoToLine();
  }
});
goToLineElements.dialog.addEventListener('click', (event) => {
  if (event.target === goToLineElements.dialog) {
    closeGoToLine();
  }
});
goToLineElements.dialog.addEventListener('close', () => {
  const returnFocus = goToLineReturnFocus;
  const shouldRestoreFocus = restoreGoToLineFocusOnClose;
  goToLineReturnFocus = null;
  restoreGoToLineFocusOnClose = true;

  if (shouldRestoreFocus && returnFocus instanceof HTMLElement && returnFocus.isConnected) {
    returnFocus.focus({ preventScroll: true });
  }
});
helpElements.closeButton.addEventListener('click', closeHelp);
helpElements.doneButton.addEventListener('click', closeHelp);
helpElements.dialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeHelp();
  }
});
helpElements.dialog.addEventListener('click', (event) => {
  if (event.target === helpElements.dialog) {
    closeHelp();
  }
});
helpElements.dialog.addEventListener('close', () => {
  if (!storeStartupHelpHidden(helpElements.hideOnStartup.checked)) {
    setStatus('帮助已关闭，暂时无法记住“下次不再展示”的设置。');
  }
  const returnFocus = helpReturnFocus;
  helpReturnFocus = null;

  if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
    returnFocus.focus({ preventScroll: true });
  }
});
mobileChromeToggle.addEventListener('click', () => {
  dispatchMobileChrome({ type: 'toggle' });
});
readerPanel.addEventListener('scroll', scheduleMobileReaderScroll, { passive: true });
largeFileEditor.scrollDOM.addEventListener('scroll', scheduleMobileReaderScroll, {
  passive: true
});
mobileLayoutQuery.addEventListener('change', (event) => {
  dispatchMobileChrome({ type: 'viewport-change', mobile: event.matches });
});
themeSelect.addEventListener('change', () => {
  const theme = applyTheme(themeSelect.value);
  themeSelect.value = theme;
});

document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]') || imageExportDialog.state !== 'closed') {
    return;
  }

  if (event.key === 'Escape' && isFindReplaceOpen()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeFindReplace();
    return;
  }

  const isMod = event.ctrlKey || event.metaKey;

  if (!isMod) {
    return;
  }

  const key = event.key.toLowerCase();
  const shortcutMap = {
    n: 'new',
    o: 'open',
    s: event.shiftKey ? 'save-as' : 'save',
    f: 'find',
    g: 'go-to-line',
    '1': 'wysiwyg',
    '2': 'markdown',
    '3': 'reader'
  };

  const action = shortcutMap[key];

  if (!action) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  if (event.repeat) {
    return;
  }

  runAction(action);
}, true);

window.addEventListener('beforeunload', (event) => {
  if (!state.isDirty || allowNativeClose) {
    return;
  }

  event.preventDefault();
  event.returnValue = false;
});

function currentLineSource() {
  if (state.isLargeDocument) {
    const text = largeFileEditor.state.doc;
    return { lineCount: text.lines, getLine: (number) => text.line(number).text };
  }
  const lines = getCurrentMarkdown().split('\n');
  return { lineCount: lines.length, getLine: (number) => lines[number - 1] };
}

function captureDocumentPosition() {
  if (!state.isLargeDocument) return captureViewPosition(...getCurrentViewElements());
  const view = largeFileEditor;
  const maximum = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return { large: true, offset: block.from, scrollRatio: maximum > 0 ? view.scrollDOM.scrollTop / maximum : 0 };
}

function restoreDocumentPosition(mode, position) {
  if (mode !== state.mode) setMode(mode);
  if (!position) return;
  markMobileReaderScrollProgrammatic(1200);
  if (state.isLargeDocument) {
    const view = largeFileEditor;
    const id = state.documentId;
    const offset = Math.min(view.state.doc.length, Math.max(0, Number(position.offset) || 0));
    requestAnimationFrame(() => {
      if (state.documentId !== id) return;
      if (position.scrollRatio >= 0.999) view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
      else view.dispatch({ effects: EditorView.scrollIntoView(offset, { y: 'start', yMargin: 18 }) });
    });
  } else viewPosition.restore(position, ...getCurrentViewElements());
}

function visibleDocumentLine(headings) {
  if (state.isLargeDocument) {
    const block = largeFileEditor.lineBlockAtHeight(largeFileEditor.scrollDOM.scrollTop + 40);
    return largeFileEditor.state.doc.lineAt(block.from).number;
  }
  const [root, scroller] = getCurrentViewElements();
  const bounds = scroller.getBoundingClientRect();
  if (state.mode === 'markdown') {
    const view = editor.mdEditor.view;
    const hit = view.posAtCoords({ left: bounds.left + 40, top: bounds.top + 45 });
    return hit ? view.state.doc.resolve(hit.pos).index(0) + 1 : 1;
  }
  const nodes = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  let index = -1;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].getBoundingClientRect().top <= bounds.top + 70) index = i;
    else break;
  }
  return headings[Math.max(0, index)]?.line || 1;
}

function navigateDocumentHeading(heading, index) {
  if (!heading) return;
  viewPosition.cancel(); markMobileReaderScrollProgrammatic();
  if (state.isLargeDocument) {
    const line = largeFileEditor.state.doc.line(Math.min(heading.line, largeFileEditor.state.doc.lines));
    largeFileEditor.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }) });
  } else if (state.mode === 'markdown') {
    editor.setSelection([heading.line, 1]); editor.focus();
  } else {
    const [root, scroller] = getCurrentViewElements();
    const node = root.querySelectorAll('h1,h2,h3,h4,h5,h6')[index];
    if (node) scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
  }
  setStatus(heading.title);
}

async function openRecentDocument(record) {
  const request = beginOpenRequest();
  let bytes;
  if (isTauriRuntime()) {
    await invoke('authorize_recent_file', { path: record.filePath });
    bytes = await readFile(record.filePath);
  } else {
    const handle = record.browserFileHandle;
    if (!handle) { await openFile(); return; }
    let permission = await handle.queryPermission({ mode: 'read' });
    if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'read' });
    if (permission !== 'granted') throw new Error('没有获得文件读取权限');
    bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }
  const decoded = await decodeOpenedDocument(bytes, record.filePath);
  if (!canApplyOpenRequest(request)) return;
  openDocument({ filePath: record.filePath, ...decoded,
    browserFileHandle: record.browserFileHandle, fileWritable: record.fileWritable && canOverwriteOpenedFile(record.filePath) });
}

function enhanceCodeBlocks(root) {
  root.querySelectorAll('pre').forEach((block) => {
    if (block.querySelector('.code-copy-button')) return;
    const code = block.querySelector('code');
    if (!code) return;
    block.classList.add('code-copy-host');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'code-copy-button';
    button.textContent = '复制代码'; button.setAttribute('aria-label', '复制代码');
    button.addEventListener('click', async () => {
      try { const { copyText } = await import('./local-images.js'); await copyText(code.textContent, isTauriRuntime() ? { invoke } : {}); button.textContent = '已复制'; setStatus('代码已复制'); }
      catch (error) { setStatus(`复制失败：${error.message || error}`); }
      setTimeout(() => { button.textContent = '复制代码'; }, 1800);
    });
    block.append(button);
  });
}

const imageHydrationReleases = new Map();
function scheduleImageHydration() {
  clearTimeout(imageHydrationTimer);
  imageHydrationTimer = setTimeout(async () => {
    if (!imageHydrationAbort || imageHydrationAbort.signal.aborted) imageHydrationAbort = new AbortController();
    const controller = imageHydrationAbort;
    try {
      const { hydrateLocalImages } = await import('./local-images.js');
      if (controller.signal.aborted) return;
      const roots = state.isLargeDocument ? [largeFileEditor.dom] : [viewerElement, editor.wwEditor.view.dom, editorElement.querySelector('.toastui-editor-md-preview')].filter(Boolean);
      for (const [root, entry] of imageHydrationReleases) {
        if (!roots.includes(root) || entry.documentId !== state.documentId || entry.path !== state.currentFilePath || entry.textPack !== state.textPack) {
          entry.release(); imageHydrationReleases.delete(root);
        }
      }
      for (const root of roots) {
        if (imageHydrationReleases.has(root)) continue;
        const textPack = state.textPack;
        const release = hydrateLocalImages(root, { documentPath: state.currentFilePath, invoke, signal: controller.signal,
          readImage: textPack ? (source) => readTextPackImage(textPack, source) : undefined });
        imageHydrationReleases.set(root, { release, documentId: state.documentId, path: state.currentFilePath, textPack });
      }
    } catch (error) { if (error.name !== 'AbortError') console.warn('加载本地图片失败', error); }
  }, 120);
}

async function inlineDocumentImages(root, { documentPath = state.currentFilePath, textPack = state.textPack, ...options } = {}) {
  const { inlineLocalImages } = await import('./local-images.js');
  const local = await inlineLocalImages(root, { ...options, documentPath, invoke,
    readImage: textPack ? (source) => readTextPackImage(textPack, source) : undefined });
  try {
    const remote = await inlineRemoteImages(root, options);
    return { includedImages: (local.includedImages || 0) + (remote.includedImages || 0),
      failedImages: (local.failedImages || 0) + (remote.failedImages || 0),
      release() { local.release?.(); remote.release?.(); } };
  } catch (error) { local.release?.(); throw error; }
}

let selectedImageContent = null;
function rememberImageSelection() {
  let selection;
  if (state.isLargeDocument || state.mode === 'markdown') {
    const text = state.isLargeDocument
      ? largeFileEditor.state.doc.sliceString(largeFileEditor.state.selection.main.from, largeFileEditor.state.selection.main.to)
      : editor.getSelectedText();
    if (text) selection = { markdown: text };
  } else selection = captureSelectedContent(getCurrentViewElements()[0]);
  if (selection) selectedImageContent = { ...selection, documentId: state.documentId, revision: state.revision };
}

async function copySelectedImage() {
  rememberImageSelection();
  const selection = selectedImageContent;
  if (!selection || selection.documentId !== state.documentId || selection.revision !== state.revision) {
    setStatus('请先在文档中选中要复制的段落、表格或代码。'); return;
  }
  const button = document.getElementById('copySelectionImageButton'); button.disabled = true;
  const documentPath = state.currentFilePath;
  const textPack = state.textPack;
  try {
    setStatus('正在生成选区图片…');
    const { blob, failedImages } = await renderSelectedImage({ ...selection,
      renderMarkdown: renderImageExportChunk, inlineImages: (root, options) => inlineDocumentImages(root, { ...options, documentPath, textPack }) });
    try {
      const { copyImageBlob } = await import('./local-images.js'); await copyImageBlob(blob, isTauriRuntime() ? { invoke } : {});
      setStatus(`选区图片已复制${failedImages ? `，${failedImages} 张图片未包含` : ''}`);
    } catch {
      setStatus('当前环境无法写入图片剪贴板，请保存 PNG。');
      const result = await saveImageExport(`${imageExportBaseName(getDisplayName(documentPath))}-选区.png`, blob);
      if (!result.canceled) setStatus('已保存选区图片');
    }
  } catch (error) { setStatus(`生成选区图片失败：${error.message || error}`); }
  finally { button.disabled = false; }
}

async function insertDocumentImage(blob) {
  if (state.mode === 'reader') { setStatus('请切换到编辑或源码视图后插入图片。'); return; }
  const initiatingDocumentId = state.documentId;
  if (!state.textPack && (!state.currentFilePath || !isTauriRuntime())) {
    if (!isTauriRuntime()) { setStatus('本地附件需要 Windows 或 Android 版，请在原生应用中插入图片。'); return; }
    await saveFile(false);
    if (state.documentId !== initiatingDocumentId) { setStatus('文档已变化，请重新插入图片。'); return; }
    if (!state.currentFilePath) return;
  }
  const context = { documentId: state.documentId, revision: state.revision, filePath: state.currentFilePath,
    browserFileHandle: state.browserFileHandle, textPack: state.textPack };
  let relativePath;
  let nextTextPack;
  if (context.textPack) {
    const result = await addTextPackImage(context.textPack, blob);
    relativePath = result.relativePath;
    nextTextPack = result.textPack;
  } else {
    const { persistDocumentImage } = await import('./local-images.js');
    relativePath = await persistDocumentImage(blob, { documentPath: context.filePath, invoke });
  }
  if (state.documentId !== context.documentId || state.revision !== context.revision || state.textPack !== context.textPack
    || state.currentFilePath !== context.filePath || state.browserFileHandle !== context.browserFileHandle) {
    setStatus(context.textPack ? '文档已变化，请重新插入图片。' : `图片已保存到 ${relativePath}，文档已变化，请从附件目录重新插入。`); return;
  }
  if (nextTextPack) state.textPack = nextTextPack;
  const markdown = `![图片](${relativePath})`;
  if (state.isLargeDocument) {
    largeFileEditor.dispatch(largeFileEditor.state.replaceSelection(markdown)); largeFileEditor.focus();
  } else if (state.mode === 'markdown') { editor.replaceSelection(markdown); editor.focus(); }
  else { editor.exec('addImage', { imageUrl: relativePath, altText: '图片' }); editor.focus(); }
  scheduleImageHydration(); setStatus(nextTextPack ? '图片已插入，保存文档时会一同写入 TextPack' : '图片已保存到附件目录并插入');
}

function chooseDocumentImage() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif,image/webp';
  input.onchange = () => { if (input.files[0]) void insertDocumentImage(input.files[0]).catch((error) => setStatus(`插入图片失败：${error.message || error}`)); };
  input.click();
}

function insertPastedMarkdown(markdown, selection) {
  if (state.isLargeDocument) {
    largeFileEditor.dispatch({ changes: { from: selection.from, to: selection.to, insert: markdown },
      selection: { anchor: selection.from + markdown.length }, scrollIntoView: true });
    largeFileEditor.focus();
  } else if (state.mode === 'markdown') {
    editor.replaceSelection(markdown, selection[0], selection[1]);
    editor.focus();
  } else {
    // Parse only the pasted fragment with the installed Toast UI parser. A
    // ProseMirror transaction keeps surrounding content and undo history.
    const parser = new editor.toastMark.constructor(markdown, { disallowedHtmlBlockTags: ['br', 'img'], referenceDefinition: true });
    const model = editor.convertor.toWysiwygModel(parser.getRootNode());
    editor.setSelection(selection[0], selection[1]);
    const view = editor.wwEditor.view;
    const slice = model.childCount === 1 && model.firstChild.type.name === 'paragraph'
      ? Slice.maxOpen(model.content) : model.slice(0);
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
    editor.focus();
  }
}

async function pasteWebContent(html) {
  webPasteAbort?.abort();
  const controller = new AbortController();
  webPasteAbort = controller;
  const context = { documentId: state.documentId, revision: state.revision, mode: state.mode,
    filePath: state.currentFilePath, browserFileHandle: state.browserFileHandle, textPack: state.textPack };
  const selection = state.isLargeDocument
    ? { from: largeFileEditor.state.selection.main.from, to: largeFileEditor.state.selection.main.to }
    : structuredClone(editor.getSelection());
  let stagedTextPack = context.textPack || (!context.filePath ? createTextPack() : null);
  const stillCurrent = () => state.documentId === context.documentId && state.revision === context.revision
    && state.mode === context.mode && state.textPack === context.textPack
    && state.currentFilePath === context.filePath && state.browserFileHandle === context.browserFileHandle;
  try {
    setStatus('正在粘贴网页内容并保存图片…');
    const { prepareWebPaste } = await import('./web-paste.js');
    const { persistDocumentImage } = await import('./local-images.js');
    const result = await prepareWebPaste(html, {
      document, signal: controller.signal, nativeRuntime: isTauriRuntime(),
      sanitizeHTML: (value) => DOMPurify.sanitize(value, { FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'] }),
      storeImage: async (blob) => {
        if (!stillCurrent()) { controller.abort(); throw new DOMException('文档已变化', 'AbortError'); }
        if (stagedTextPack) {
          const added = await addTextPackImage(stagedTextPack, blob);
          stagedTextPack = added.textPack;
          return added.relativePath;
        }
        if (!isTauriRuntime()) throw new Error('浏览器中请先新建 TextPack，再粘贴内置图片');
        return persistDocumentImage(blob, { documentPath: context.filePath, invoke, signal: controller.signal });
      }
    });
    if (!stillCurrent() || controller.signal.aborted) {
      if (state.documentId === context.documentId) setStatus('文档已变化，请重新粘贴网页内容。');
      return;
    }
    if (!result.markdown) { setStatus('剪贴板中没有可粘贴的正文。'); return; }
    if (stagedTextPack && (context.textPack || result.includedImages > 0)) state.textPack = stagedTextPack;
    try { insertPastedMarkdown(result.markdown, selection); }
    catch (error) { if (state.revision === context.revision) state.textPack = context.textPack; throw error; }
    // Some clipboard fragments contain only an atom; ensure asset changes also
    // enter the same revision/draft lifecycle when the editor emits no change.
    if (state.revision === context.revision) noteDocumentChanged();
    scheduleImageHydration();
    const savedImages = result.includedImages ? `，${result.includedImages} 张图片已${state.textPack ? '内置' : '保存到附件目录'}` : '';
    const failedImages = result.failedImages ? `；${result.failedImages} 张图片未能保存，已保留链接或说明` : '';
    setStatus(`已粘贴网页内容${savedImages}${failedImages}${!context.textPack && state.textPack ? '；文档将保存为 TextPack' : ''}`);
  } catch (error) {
    if (state.documentId === context.documentId) setStatus(error.name === 'AbortError' ? '网页粘贴已取消，请重新粘贴。' : `网页粘贴失败：${error.message || error}`);
  } finally { if (webPasteAbort === controller) webPasteAbort = null; }
}

workspaceController = createWorkspaceController({
  context: () => ({ ...state, filePath: state.currentFilePath, fileWritable: state.currentFileWritable, name: getDisplayName(state.currentFilePath) }),
  markdown: getCurrentMarkdown, lineSource: currentLineSource, status: setStatus, save: () => saveFile(false),
  capturePosition: captureDocumentPosition, restorePosition: restoreDocumentPosition,
  visibleLine: visibleDocumentLine, navigateHeading: navigateDocumentHeading, openRecent: openRecentDocument,
  restoreDraft(record) {
    setDocument(record.content, record.filePath, undefined, { ...record.textFormat, textPack: record.textPack || null, fileWritable: false });
    state.draftId = record.id; state.revision = 1; state.savedRevision = 0; setDirty(true);
    restoreDocumentPosition(record.mode || 'wysiwyg', record.position); workspaceController.changed();
  },
  preferencesChanged(_preferences, position) { updateCounts(); largeFileEditor.requestMeasure(); restoreDocumentPosition(state.mode, position); },
  rememberNative: (path) => isTauriRuntime() ? invoke('remember_recent_file', { path }) : undefined,
  forgetNative: (path) => isTauriRuntime() ? invoke('forget_recent_file', { path }) : undefined,
  clearNative: () => isTauriRuntime() ? invoke('clear_recent_files') : undefined
});
workspaceController.init();
initializeWindowsIntegration({
  document, nativeRuntime: isTauriRuntime(),
  platform: navigator.userAgentData?.platform || navigator.platform,
  invoke, setStatus
});
document.getElementById('findButton').addEventListener('click', openFindReplace);
document.getElementById('insertImageButton').addEventListener('click', chooseDocumentImage);
document.getElementById('newTextPackButton').addEventListener('click', newTextPack);
document.getElementById('saveTextPackButton').addEventListener('click', () => saveFile(true, 'textpack'));
document.getElementById('copySelectionImageButton').addEventListener('pointerdown', rememberImageSelection);
document.getElementById('copySelectionImageButton').addEventListener('click', copySelectedImage);
document.addEventListener('selectionchange', rememberImageSelection);
document.addEventListener('markdown-media-visible', scheduleImageHydration);
document.addEventListener('paste', (event) => {
  if (!editorPanel.contains(event.target) || state.mode === 'reader') return;
  if (event.target.closest?.('input, textarea, select')) return;
  const html = event.clipboardData?.getData('text/html');
  if (html?.trim()) {
    event.preventDefault(); event.stopImmediatePropagation();
    void pasteWebContent(html);
    return;
  }
  const image = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith('image/'))?.getAsFile();
  if (!image) return;
  event.preventDefault(); event.stopImmediatePropagation();
  void insertDocumentImage(image).catch((error) => setStatus(`粘贴图片失败：${error.message || error}`));
}, true);
if (document.documentElement.classList.contains('android-runtime')) {
  const folderButton = document.getElementById('linkImageFolderButton'); folderButton.hidden = false;
  folderButton.addEventListener('click', async () => {
    if (state.textPack) { setStatus('TextPack 的图片随文档保存，可直接插入，无需关联图片文件夹。'); return; }
    if (!state.currentFilePath) { setStatus('请先打开或保存文档，再关联图片文件夹。'); return; }
    try { const result = await invoke('link_image_folder', { documentPath: state.currentFilePath }); if (result.linked) { for (const entry of imageHydrationReleases.values()) entry.release.refresh(); scheduleImageHydration(); setStatus('已关联图片文件夹'); } }
    catch (error) { setStatus(`关联失败：${error.message || error}`); }
  });
}
if (isTauriRuntime()) {
  void getCurrentWindow().onCloseRequested(async (event) => {
    if (allowNativeClose) return;
    event.preventDefault();
    try {
      if (await confirmDiscardChanges()) {
        await workspaceController.flush(); allowNativeClose = true;
        await getCurrentWindow().destroy();
      }
    } catch (error) { allowNativeClose = false; setStatus(`关闭失败：${error.message || error}`); }
  });
}

updateTitle();
updateModeButtons();
renderMobileChrome();
updateSavingState();
updateCounts();
renderFindReplaceState();
void initializeNativeFileOpenHandling().finally(() => {
  if (!isStartupHelpHidden()) openHelp();
});
void initializeNativeFileDrop();
