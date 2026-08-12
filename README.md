<p align="center">
  <img src="src/assets/cat-md-icon.png" width="96" height="96" alt="滚猫md 图标">
</p>

# 滚猫md / rollcat-md

一款轻量的 Windows Markdown 阅读与编辑软件，支持所见即所得、源码编辑、专注阅读，以及面向大文件的可视区分块渲染。

A lightweight Windows Markdown reader and editor with WYSIWYG editing, source editing, focused reading, and viewport rendering for large files.

[中文说明](#中文说明) · [English Guide](#english-guide)

---

## 中文说明

### 直接运行

1. 从 [GitHub Releases](https://github.com/sonicacd/rollcatmd/releases/latest/download/rollcat-md.exe) 下载 `rollcat-md.exe`。
2. 把它放到希望长期保存的位置。
3. 双击 EXE 即可启动，不需要安装。

单文件版不会创建开始菜单快捷方式，也不会自动修改 Markdown 的默认打开程序。如果 Windows 提示文件来源未知，请只在确认 EXE 来自可信来源时运行。

滚猫md使用 Windows 的 Microsoft Edge WebView2 Runtime。Windows 10/11 通常已经安装；如果程序无法启动，请先安装或修复 WebView2 Runtime。

### 快速上手

1. 点击“新建”创建文档，或点击“打开”选择已有文件。
2. 在“所见即所得”“源码”“阅读”三种视图之间切换。
3. 编辑完成后点击“保存”；需要保留原文件时使用“另存为”。
4. 从“主题”菜单选择纯黑、纯白或护眼主题。

当前文件名显示在 Windows 窗口标题栏中。标题末尾出现 `*` 时，表示文档还有未保存的修改。界面同时显示当前文档的字符数和 LLM token 估算值。

token 数会显示为“约 N tokens”。这是不依赖网络或特定模型的快速估算，不同 LLM、不同版本分词器得到的精确结果可能不同。

### 三种视图

- **所见即所得**：直接查看排版效果并编辑内容，适合日常写作。
- **源码**：直接编辑 Markdown 原文，适合精确控制格式。
- **阅读**：只显示渲染后的内容，适合专注阅读。

所见即所得、阅读及大文档轻量预览使用一致的 Obsidian 风格正文节奏：16px 正文、1.5 倍行高和清晰段距。排版内容宽度会随窗口自适应，宽屏下最大为 1200px。

### 支持的 Markdown 格式

工具栏支持：

- 标题、粗体、斜体、删除线和分隔线
- 引用、无序列表、有序列表和任务列表
- 缩进、减少缩进
- 表格和链接
- 行内代码和代码块

阅读模式还支持常见的 Obsidian 风格提示块，例如：

```markdown
> [!note] 提示
> 这里是提示内容。

> [!warning] 注意
> 这里是警告内容。
```

### 主题

滚猫md提供三套完整配色：

- **纯黑**：适合暗光环境
- **纯白**：清晰明亮
- **护眼**：柔和的浅绿色背景

主题会同步调整界面、编辑区、阅读区和代码区的背景及文字颜色。选择会自动记住，下次启动时继续使用。

### 大文件分块渲染

打开达到 **2.5 MiB（2,621,440 字节）** 的文档时，滚猫md会直接进入可视区分块渲染，不会先把全文交给完整排版引擎。界面只挂载屏幕附近的内容，从而降低打开、滚动和编辑大文件时的卡顿风险。

分块渲染仍然支持：

- 编辑、选择、复制和粘贴
- 所见即所得（轻量 Live Preview）、源码和阅读（只读轻量预览）三种视图
- Markdown 标题、强调、链接、引用、表格及代码块的可读样式
- 查找
- 撤销和重做
- 保存与另存为
- 字符数和 LLM token 估算

为了不打断正在编辑的内容，普通文档在编辑或粘贴后增长到 2.5 MiB 时不会突然更换编辑器；保存并重新打开后才会使用分块渲染。大文件视图采用轻量 Live Preview，复杂组件的外观可能与普通文档的完整所见即所得略有不同。

### 支持的文件

可以从软件内打开和保存：

- `.md`
- `.markdown`
- `.mdown`
- `.mkd`
- `.txt`

单文件版不会自动注册文件关联。可以从软件内点击“打开”选择文档；如果希望双击 Markdown 时启动滚猫md，可在 Windows“打开方式”中浏览并选择 `rollcat-md.exe`。

文件必须是有效的 **UTF-8** 文本，可以带或不带 UTF-8 BOM。为了避免乱码后覆盖原文件，GBK、UTF-16 等其他编码会被拒绝打开，请先使用其他工具转换为 UTF-8。

### 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新建 | `Ctrl+N` |
| 打开 | `Ctrl+O` |
| 保存 | `Ctrl+S` |
| 另存为 | `Ctrl+Shift+S` |
| 所见即所得 | `Ctrl+1` |
| 源码 | `Ctrl+2` |
| 阅读 | `Ctrl+3` |
| 查找（源码及分块渲染视图） | `Ctrl+F` |

### 保存与数据安全

- 滚猫md不会自动保存，请留意窗口标题末尾的 `*`。
- 新建、打开其他文件或关闭程序前，如果存在未保存内容，软件会提示确认。
- 保存采用安全替换方式；写入失败时会尽量保留原文件。
- 软件会尽量保留 UTF-8 BOM 和原文主要使用的换行格式。
- 滚猫md不提供云同步、版本历史或回收站。重要文档仍建议自行备份。

### 隐私

- 文档在本机读取、编辑和保存，不需要登录，也不会上传到服务器。
- 软件不收集编辑器使用统计。
- 如果文档引用网络图片，显示图片时仍可能访问对应的图片网址。

### 当前限制

- Markdown 中的相对本地图片路径暂时不能正常显示。
- 混合使用多种换行符的文档，在编辑后保存时可能统一为占主导的换行格式。
- 大文件为减少内存占用，不会额外保留一份完整原文；混合换行在保存时也可能被统一。
- 仅支持 UTF-8 文本，不会自动猜测或转换其他编码。

### 常见问题

**程序无法启动怎么办？**

安装或修复 Microsoft Edge WebView2 Runtime，然后重新启动滚猫md。

**为什么大文件的排版与普通文档略有不同？**

达到 2.5 MiB 的文件会使用轻量 Live Preview，只为当前可视区域创建排版元素。标题、强调、链接、引用和代码块仍然清晰可读，同时避免打开文件时生成整篇页面而卡死。

**为什么文件无法打开？**

请确认文件扩展名受支持，并且内容是有效 UTF-8。GBK、UTF-16 文件需要先转换编码。

**为什么本地图片不显示？**

当前版本尚未开放对 Markdown 相对本地图片路径的读取。网络图片链接通常可以正常显示。

**怎样把滚猫md设为 Markdown 的默认打开程序？**

在 Windows 中右键 Markdown 文件，选择“打开方式 → 选择其他应用 → 在电脑上选择应用”，找到 `rollcat-md.exe`，然后设为默认应用。

### 开源许可

滚猫md依据 [Apache License 2.0](LICENSE) 开源。欢迎查看源码、报告问题和参与改进；开发与贡献方法请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## English Guide

### Run the EXE

1. Download `rollcat-md.exe` from [GitHub Releases](https://github.com/sonicacd/rollcatmd/releases/latest/download/rollcat-md.exe).
2. Move it to a location where you want to keep it.
3. Double-click the EXE to launch it. No installation is required.

The standalone EXE does not create Start-menu shortcuts or automatically change the default Markdown application. If Windows warns that the file has an unknown source, run it only when you trust where the EXE came from.

rollcat-md uses the Microsoft Edge WebView2 Runtime included with most Windows 10 and Windows 11 systems. If the app does not start, install or repair WebView2 Runtime first.

### Quick Start

1. Select **New** to create a document, or **Open** to choose an existing file.
2. Switch between **WYSIWYG**, **Source**, and **Reader** views.
3. Select **Save** after editing, or **Save As** to keep the original file unchanged.
4. Choose Black, White, or Eye Comfort from the Theme menu.

The current filename appears in the Windows title bar. A trailing `*` means that the document has unsaved changes. The interface also shows a live character count and an estimated LLM token count.

Tokens are displayed as “approximately N tokens.” This is a fast, model-independent estimate that requires no network access. Exact results vary between LLMs and tokenizer versions.

### Three Views

- **WYSIWYG**: edit while seeing the formatted result.
- **Source**: edit the Markdown text directly.
- **Reader**: display only the rendered document.

WYSIWYG, Reader, and large-document lightweight preview share an Obsidian-inspired reading rhythm: 16px body text, 1.5 line height, and clear paragraph spacing. Rendered content adapts to the window and is capped at 1200px on wide screens.

### Markdown Support

The toolbar supports:

- Headings, bold, italic, strikethrough, and horizontal rules
- Block quotes, bulleted lists, numbered lists, and task lists
- Indent and outdent
- Tables and links
- Inline code and fenced code blocks

Reader mode also supports common Obsidian-style callouts:

```markdown
> [!note] Note
> Callout content goes here.

> [!warning] Warning
> Warning content goes here.
```

### Themes

Three complete color themes are available:

- **Black** for dark environments
- **White** for a bright, clean canvas
- **Eye Comfort** with a soft light-green background

The theme updates the application, editor, reader, and code colors together. Your choice is remembered for the next launch.

### Viewport Rendering for Large Files

When opening a document at or above **2.5 MiB (2,621,440 bytes)**, rollcat-md goes directly into viewport rendering instead of first passing the whole file to the full layout engine. Only content near the screen is mounted, reducing the risk of stalls while opening, scrolling, and editing large files.

Viewport rendering still supports:

- Editing, selection, copy, and paste
- WYSIWYG (lightweight Live Preview), Source, and Reader (read-only lightweight preview) views
- Readable Markdown styling for headings, emphasis, links, quotes, tables, and code blocks
- Search
- Undo and redo
- Save and Save As
- Character count and estimated LLM tokens

To avoid interrupting active work, a regular document that grows past 2.5 MiB while being edited or pasted into does not suddenly replace its editor. Viewport rendering is selected the next time that saved document is opened. Large files use a lightweight Live Preview, so complex components may look slightly different from the full WYSIWYG editor used for regular documents.

### Supported Files

The application can open and save:

- `.md`
- `.markdown`
- `.mdown`
- `.mkd`
- `.txt`

The standalone EXE does not register file associations automatically. Open documents from inside the app, or use Windows **Open with** to select `rollcat-md.exe` as the default Markdown application.

Files must contain valid **UTF-8** text, with or without a UTF-8 BOM. GBK, UTF-16, and other encodings are rejected to prevent corrupted text from overwriting the original file. Convert them to UTF-8 before opening.

### Keyboard Shortcuts

| Action | Shortcut |
| --- | --- |
| New | `Ctrl+N` |
| Open | `Ctrl+O` |
| Save | `Ctrl+S` |
| Save As | `Ctrl+Shift+S` |
| WYSIWYG view | `Ctrl+1` |
| Source view | `Ctrl+2` |
| Reader view | `Ctrl+3` |
| Find in Source or viewport-rendered view | `Ctrl+F` |

### Saving and Data Safety

- rollcat-md does not auto-save. Watch for the trailing `*` in the title bar.
- The app asks for confirmation before creating or opening another document, or closing the app, when changes are unsaved.
- Files are saved through a safe replacement process that attempts to preserve the original if writing fails.
- UTF-8 BOM and the document's dominant line-ending style are preserved where possible.
- Cloud sync, version history, and a recycle bin are not included. Keep separate backups of important documents.

### Privacy

- Documents are opened, edited, and saved locally. No account is required and document contents are not uploaded.
- Editor usage statistics are disabled.
- A document containing remote images may still connect to those image URLs when they are displayed.

### Current Limitations

- Relative local image paths in Markdown are not displayed yet.
- Mixed line endings may be normalized to the dominant style after editing and saving.
- Large files do not retain a second full copy of the original text, so mixed line endings may also be normalized when saved.
- Only UTF-8 text is supported; other encodings are not guessed or converted automatically.

### Troubleshooting

**The application does not start.**

Install or repair Microsoft Edge WebView2 Runtime, then launch 滚猫md again.

**Why does a large file look slightly different from a regular document?**

Files at or above 2.5 MiB use a lightweight Live Preview that only creates layout elements for the visible area. Headings, emphasis, links, quotes, and code blocks remain readable without constructing a full page for the entire document during opening.

**Why will a file not open?**

Check that its extension is supported and that it contains valid UTF-8 text. Convert GBK or UTF-16 files before opening.

**Why is a local image missing?**

Relative local image paths are not supported in the current version. Remote image URLs normally work.

**How do I make rollcat-md the default Markdown application?**

Right-click a Markdown file, choose **Open with → Choose another app → Choose an app on your PC**, locate `rollcat-md.exe`, and set it as the default.

### License

rollcat-md is open source under the [Apache License 2.0](LICENSE). Source-code setup and contribution guidance are available in [CONTRIBUTING.md](CONTRIBUTING.md).
