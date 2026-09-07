# 更新记录 / Changelog

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
