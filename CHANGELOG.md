# 更新记录 / Changelog

## 0.5.3

### 视图切换阅读位置 / Reading Position When Switching Views

- 修复所见即所得切到源码时跳至文末的问题：正确同步编辑器焦点与选区，避免旧光标位置在稍后覆盖当前阅读位置。
- 修复源码双栏预览的滚动动画再次拉动正文的问题：恢复阅读位置期间暂停同步并取消在途动画，按源码可视区对齐预览，完成或用户操作后恢复同步状态。
- 增加 10,630 字符、10 张图片的 TextPack 多轮切换回归，以及按钮、快捷键、阅读视图往返、快速切换和取消恢复的检查。本次发布 Windows v0.5.3 EXE 与校验文件；Android 继续使用 v0.5.2 APK。

- Fix jumps to the document end when switching from WYSIWYG to Source by synchronizing editor focus and selection before restoring the reading position.
- Pause preview scroll synchronization and cancel running animations during restoration. Align the preview with the source viewport, then restore the previous synchronization state on completion or user input.
- Add repeated view-switch checks using a 10,630-character TextPack with 10 images, plus buttons, shortcuts, Reader round trips, rapid switching, and cancellation. This release ships the Windows v0.5.3 EXE and checksums; Android remains at v0.5.2.

验证结果与平台范围见 [v0.5.3 发布说明](docs/releases/v0.5.3.md)。

See the [v0.5.3 release notes](docs/releases/v0.5.3.md) for validation and platform scope.

## 0.5.2

### Android 打开方式与图标 / Android Open With and Icon

- 扩展文件打开与分享关联，兼容文件管理器对 Markdown、TXT、TextPack 的常见类型及通用二进制/ZIP 标记；接收后检查实际文件名，拒绝不支持的扩展名。
- 将 PC 猫图标同步到 Android 实际打包资源，补齐普通、圆形及自适应图标，修复 APK 仍使用 Tauri 默认图标的问题。
- 本次更新 Android APK，并包含 v0.5.1 的启动帮助；GitHub Release 集中发布 v0.4.0 之后的累计功能，同时提供已验证的 Windows v0.5.1 EXE。

- Expand Android open/share registration for common Markdown, TXT, and TextPack MIME types, including generic binary/ZIP declarations, and validate the real filename before accepting a document.
- Sync the PC cat artwork into the Android resources actually packaged in the APK, including legacy, round, and adaptive icons, replacing the remaining Tauri template artwork.
- This release updates the Android APK and includes v0.5.1 startup Help. The GitHub release publishes the accumulated changes since v0.4.0 and also provides the validated Windows v0.5.1 EXE.

验证结果与平台范围见 [v0.5.2 发布说明](docs/releases/v0.5.2.md)。

See the [v0.5.2 release notes](docs/releases/v0.5.2.md) for validation and platform scope.

## 0.5.1

### Windows 打开方式 / Windows File Associations

- “更多”新增“添加到右键打开方式”，按当前用户注册正在运行的 EXE，支持 `.md`、`.markdown`、`.mdown`、`.mkd`、`.txt` 和 `.textpack`，无需管理员权限，保留现有默认应用。
- 新增“设为默认 .md 程序”，注册后打开 Windows 默认应用设置，由用户选择 `.md` →“滚猫md”并确认。支持应用专页的 Windows 11 可直接进入应用页面，较旧系统进入默认应用总页；程序提示设置页已打开。
- 注册使用当前 EXE 路径；移动或重命名便携版后，可从新位置再次注册。这两个入口仅在 Windows 原生版显示。
- 首次打开自动显示帮助，先介绍 Windows 的两个新入口，再补充常用功能说明。勾选“下次不再展示”并关闭后停止自动弹出；“更多”→“使用帮助”仍可手动打开。
- 本次仅发布 Windows EXE；Android 继续使用 v0.5.0 APK。

- **More → Add to Open with** registers the running EXE for the current user for `.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`, and `.textpack`, without administrator privileges or changes to existing defaults.
- **Set as default for .md** registers the app and opens Windows Default apps settings, where the user selects **滚猫md** for `.md` and confirms. Supported Windows 11 versions open the app-specific page; older systems open the general page. The app reports that Settings was opened.
- Registration follows the current EXE path. Run the action again after moving or renaming the portable app. Both entries appear only in the native Windows app.
- Help opens automatically on first launch, leading with the Windows actions and covering common features. Check **Don't show next time** and close it to disable automatic display; **More → Help** remains available.
- This release ships the Windows EXE only; Android continues to use the v0.5.0 APK.

验证范围见 [v0.5.1 发布说明](docs/releases/v0.5.1.md)。

See the [v0.5.1 release notes](docs/releases/v0.5.1.md) for validation scope.

## 0.5.0

### 新增 / Added

- 支持打开、编辑与保存 `.textpack`，将 Markdown 正文和原始二进制图片保存在一个 ZIP 容器内。
- “更多”→“另存为 TextPack”可打包当前文档引用的可访问本地图片；网络图片保留原网址。
- “更多”→“新建 TextPack”可直接开始单文件图文写作。网页图文粘贴将 HTML 转为 Markdown，并将成功下载的图片加入 TextPack 或原生 Markdown 的附件目录；空白未保存文档在成功包含网页图片后自动采用 TextPack。
- TextPack 中粘贴或插入本地图片会加入包内附件；恢复草稿同时保留正文和附件。
- Windows 启动文件与拖放、Android 系统文件选择器和最近文档支持 TextPack。Android 导入后首次保存继续要求选择导出位置。

- Open, edit, and save `.textpack` files containing Markdown and original binary images in one ZIP container.
- **More → Save As TextPack** bundles accessible local images referenced by the current document. Remote image URLs are retained.
- **More → New TextPack** starts a document with embedded attachments. Web pastes convert HTML to Markdown and save downloaded images inside TextPack or the native Markdown attachment folder. Blank unsaved documents switch to TextPack when web images are successfully included.
- Pasted and inserted images become package attachments, and recovery drafts retain both text and attachments.
- TextPack support for Windows startup files and drag-and-drop, plus Android's document picker and recent documents. Android imports still require an export destination on the first save.

### 保存与兼容性 / Saving and Compatibility

- 桌面 TextPack 与普通文本共用授权检查和原子保存；浏览器下载回退无法确认落盘时保留当前文档状态。
- PNG、JPEG、GIF、WebP 图片每张最多 32 MiB；压缩包与解压总大小分别最多 128 MiB，最多 4,096 个条目。
- 网页图文粘贴保留主要顺序、标题、列表和基础文字样式；失败图片保留可见链接。每次最多下载 32 张 HTTPS 图片，每张 8 MiB、总计 32 MiB，浏览器受 CORS 限制。
- `.textbundle` 文件夹暂不支持；浏览器读取普通 Markdown 旁的图片需要原生版协助完成打包。

- Desktop text and TextPack saves share the same authorization and atomic replacement path. An unconfirmed browser download retains the current document state.
- PNG, JPEG, GIF, and WebP images are limited to 32 MiB each. Compressed and total uncompressed package size are each limited to 128 MiB, with up to 4,096 entries.
- Web pastes retain main content order, headings, lists, and basic text styling. Failed image downloads leave visible links. Each paste downloads up to 32 HTTPS images, limited to 8 MiB each and 32 MiB total; browsers remain subject to CORS.
- `.textbundle` directories are unsupported. Use the native app to bundle images from folders beside ordinary Markdown documents opened in a browser.

验证范围与待验路径见 [v0.5.0 发布说明](docs/releases/v0.5.0.md) 和 [QA 清单](docs/qa-v0.5.0.md)。

See the [v0.5.0 release notes](docs/releases/v0.5.0.md) and [QA checklist](docs/qa-v0.5.0.md) for verification scope and pending checks.

## 0.4.0

### 新增 / Added

- 章节大纲：默认启用并展开，可独立关闭功能或收起面板，记住状态，点击章节定位。
- 阅读设置：14 / 16 / 18 / 20 / 24px 字号、1.5 / 1.7 / 2 倍行高、1200 / 1600 / 2100px 与全宽。默认保留 16px、1.5 和 1200px。
- 最近 20 篇文档，记住各文档的模式和位置。
- 本地完整恢复草稿，编辑停顿约 1.5 秒或连续编辑每约 10 秒保存，最多保留 5 份。
- Windows 相对本地图片及粘贴/插入附件；Android 通过系统目录授权关联图片文件夹。
- 选中内容复制为 PNG 与代码块复制。

- Chapter outline, enabled and expanded by default, with separate, remembered enable/disable and expand/collapse controls.
- Reading settings for 14 / 16 / 18 / 20 / 24px text, 1.5 / 1.7 / 2 line height, and 1200 / 1600 / 2100px or full width. Defaults remain 16px, 1.5, and 1200px.
- Twenty recent documents with per-document view and position restoration.
- Complete local recovery drafts, saved after approximately 1.5 seconds of inactivity or every 10 seconds during continuous editing, with five retained entries.
- Relative local images and pasted/inserted attachments on Windows; linked image folders through Android's system directory picker.
- Copy selected content as PNG and copy complete code blocks.

### 改进 / Changed

- 重排顶部工具栏，查找具有明确入口，低频操作集中在“更多”。
- 未保存文档离开流程提供“保存并继续”“放弃更改”“取消”；成功保存移除当前草稿，明确放弃后仍保留可恢复副本。
- 所见即所得与阅读视图的 callout 样式统一。
- 字符数默认显示，tokens 估算默认隐藏，可在阅读设置中开启。

- Reorganized toolbar with a visible Find action and secondary actions in More.
- Unsaved document prompts offer Save and Continue, Discard Changes, and Cancel. A successful complete save removes its draft; discarded work remains recoverable from a retained draft.
- Consistent callout styling in WYSIWYG and Reader.
- Character count remains visible; estimated tokens are optional and hidden by default.

### 修复 / Fixed

- Windows 长路径、包含 `#` 或 `%` 的文件名及图片导出命名显示正确。
- Ctrl+O 打开文档时不再触发编辑器的有序列表命令。
- Correct filenames and export names for Windows extended paths and names containing `#` or `%`.
- Ctrl+O opens documents without triggering the editor's ordered-list command.

平台边界、数据保留方式和验证记录见 [v0.4.0 发布说明](docs/releases/v0.4.0.md)。

See the [v0.4.0 release notes](docs/releases/v0.4.0.md) for platform limits, data retention, and verification records.
