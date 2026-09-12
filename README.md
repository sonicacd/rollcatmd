<p align="center">
  <img src="src/assets/cat-md-icon.png" width="96" height="96" alt="滚猫md 图标">
</p>

# 滚猫 md / TumblingCat

一款轻量的 Windows 与 Android Markdown 阅读与编辑软件，支持 TextPack 单文件图文文档、所见即所得、源码编辑、专注阅读，以及面向大文件的可视区分块渲染。

A lightweight Windows and Android Markdown reader and editor with single-file TextPack documents, WYSIWYG editing, source editing, focused reading, and viewport rendering for large files.

**[官网 / Website](https://tumblingcat.com/?utm_source=github&utm_medium=referral&utm_campaign=launch_202609) · [English](https://tumblingcat.com/en/?utm_source=github&utm_medium=referral&utm_campaign=launch_202609) · [下载 / Downloads](https://tumblingcat.com/?utm_source=github&utm_medium=referral&utm_campaign=launch_202609#download) · [Gitee 镜像](https://gitee.com/rhoninarcher/tumblingcatmd)**

![滚猫 md 的 Windows 所见即所得编辑界面 / Actual Windows WYSIWYG editor, shown in Chinese](https://tumblingcat.com/tumblingcat-windows-editor.png)

- **轻便 / Portable** — Windows v0.5.3 EXE 免安装，依赖系统 WebView2；Android v0.5.2 ARM64 APK 约 10.63 MiB。
- **图文一起带走 / Keep images with your notes** — TextPack 将 Markdown 与可访问的本地图片放进一个文件。Existing remote images keep their URLs.
- **本地读写 / Local files** — 无需账号，原文档手动保存；本机恢复草稿提供额外恢复入口。No account required; save the original file manually.

[下载可打开的 TextPack 样例 / Try a TextPack sample](https://tumblingcat.com/samples/tumblingcat-demo.textpack) · [图文分享指南](https://tumblingcat.com/guides/markdown-with-images/) · [Windows 使用指南](https://tumblingcat.com/guides/windows-markdown-editor/) · [Android 使用指南](https://tumblingcat.com/guides/android-markdown-reader/)

[中文说明](#中文说明) · [English Guide](#english-guide) · [更新记录](CHANGELOG.md) · [v0.5.3 发布说明](docs/releases/v0.5.3.md)

---

## 中文说明

### 直接运行

1. 从 [GitHub Releases](https://github.com/sonicacd/tumblingcatmd/releases/latest/download/rollcat-md.exe) 下载 `rollcat-md.exe`。
2. 把它放到希望长期保存的位置。
3. 双击 EXE 即可启动，不需要安装。

单文件版不会创建开始菜单快捷方式，也不会自动修改 Markdown 的默认打开程序。如果 Windows 提示文件来源未知，请只在确认 EXE 来自可信来源时运行。

滚猫md使用 Windows 的 Microsoft Edge WebView2 Runtime。Windows 10/11 通常已经安装；如果程序无法启动，请先安装或修复 WebView2 Runtime。

桌面端顶部工具栏集中提供文件操作、三种视图、查找和大纲；“更多”菜单收纳最近打开、恢复草稿和分享操作。顶部控件可以收起，保留当前文档名和展开按钮，为正文腾出空间。

免安装 EXE 的阅读设置、最近打开记录和恢复草稿保存在本机 WebView 应用数据中。复制 EXE 到另一台设备时，这些记录不会随文件迁移；移动普通 Markdown 文档时请一并复制引用的图片附件，TextPack 内置附件会随文件一起移动。

### Windows 打开方式与默认应用

Windows 版“更多”菜单提供两个入口：

- **添加到右键打开方式**：将当前运行的 EXE 注册为当前用户的打开候选，支持 `.md`、`.markdown`、`.mdown`、`.mkd`、`.txt` 和 `.textpack`，无需管理员权限。随后可在文件的“打开方式”中选择“滚猫md”。注册后现有默认应用继续保留。
- **设为默认 .md 程序**：先完成上述注册，再打开 Windows“默认应用”设置。找到 `.md`，选择“滚猫md”，并在系统界面中确认。应用只提示设置页已打开，默认应用由这一步确认决定。

支持应用专页的 Windows 11 版本可直接进入滚猫md的默认应用页面；较旧系统会进入“默认应用”总页，可在其中搜索 `.md`。这些入口仅在 Windows 原生版显示，Android 和浏览器版隐藏。

注册记录指向当前 EXE 的完整路径。请先把便携版放到长期使用的位置；以后移动或重命名 EXE，应从新位置启动，再点击一次“添加到右键打开方式”更新路径。

### Android 版

从 [v0.5.2 Release](https://github.com/sonicacd/tumblingcatmd/releases/tag/v0.5.2) 下载 `rollcat-md-android-arm64.apk`。本次 v0.5.3 更新 Windows EXE，Android 继续使用 v0.5.2 APK。

安装后，可在文件管理器中对 `.md`、`.txt`、`.textpack` 选择“打开方式”→“滚猫md”。应用同时兼容常见 Markdown、文本、TextPack 及通用二进制/ZIP 类型声明，接收后按文件的真实名称检查支持的扩展名。因此部分其他二进制或 ZIP 文件也可能显示滚猫md候选，选择后会提示文件类型不支持。具体入口样式由文件管理器决定。

Android 桌面图标与 PC 使用同一张猫图标，并提供系统所需的圆形和自适应资源。

Android 版使用系统文件选择器，不申请整盘存储权限。从系统选择器打开的文件会作为导入文档；第一次点击“保存”时会让你选择导出位置，之后在当前会话中可直接覆盖该导出文档。

移动端顶部提供收起按钮。阅读模式向下滚动超过 40px 后会自动进入沉浸阅读：顶部缩成文件名栏，底部模式按钮暂时隐藏；回到文档顶部会自动展开，也可以随时点击顶部箭头手动切换。

本地构建需要 Android SDK 36、NDK、JDK 和 Rust Android target。初次生成工程后，使用 `npm run dist:android` 生成 ARM64 APK。

### 快速上手

首次打开时会自动显示帮助，先介绍 Windows 的打开方式和默认 `.md` 程序设置，再说明编辑、阅读、TextPack、网页粘贴等常用功能。勾选“下次不再展示”并关闭帮助后，以后启动不再自动弹出；仍可通过“更多”→“使用帮助”手动打开。

1. 点击“新建”创建文档，点击“打开”选择已有文件，或把支持的文件直接拖进窗口。“更多”→“最近打开”可以继续之前的文档。
2. 在“所见即所得”“源码”“阅读”三种视图之间切换；点击“大纲”按章节导航，点击“查找”搜索和替换文字。
3. 从“阅读设置”调整字号、行距和正文宽度，从“主题”选择纯黑、纯白或护眼配色。
4. 编辑完成后点击“保存”；需要保留原文件时使用“另存为”。未保存内容会自动写入本机恢复草稿，可在“更多”→“恢复草稿”找回。
5. 使用“更多”→“导出全文图片”保存全文；选中文字后可选择“选中内容复制为图片”。

当前文件名显示在 Windows 窗口标题栏或 Android 顶部应用栏中。名称后出现圆点或标题末尾出现 `*` 时，表示原文档文件还有未保存的修改。界面默认显示字符数；LLM token 估算默认隐藏，可在“阅读设置”中开启。

token 数会显示为“约 N tokens”。这是不依赖网络或特定模型的快速估算，不同 LLM、不同版本分词器得到的精确结果可能不同。

### 三种视图

- **所见即所得**：直接查看排版效果并编辑内容，适合日常写作。
- **源码**：直接编辑 Markdown 原文，适合精确控制格式。
- **阅读**：只显示渲染后的内容，适合专注阅读。

所见即所得、阅读及大文档轻量预览使用一致的 Obsidian 风格正文节奏，默认采用 16px 正文、1.5 倍行高和 1200px 最大正文宽度。“阅读设置”提供 14 / 16 / 18 / 20 / 24px 字号、1.5 / 1.7 / 2 倍行高，以及 1200 / 1600 / 2100px 或铺满可用宽度四种排版。正文始终适应可用窗口宽度，设置会记住。

普通文档的阅读模式会在正文的显式换行处增加留白，方便阅读逐字稿等连续长文，原文内容和换行保持不变。列表、引用和代码块保留原有间距。桌面端三种视图使用紧凑的分段按钮组，文件操作靠左，视图切换与主题控件靠右。

点击视图按钮或使用 `Ctrl+1/2/3` 切换时，会根据当前屏幕上的文字恢复阅读位置，尽量让正在看的段落留在相近位置；文首和文末也会保留。即使编辑光标留在文末，切换到源码也会保持当前阅读位置。大文档按文档位置恢复。三种视图的换行和排版高度不同，位置可能有少量偏移；缺少可匹配文字时按阅读进度恢复。“跳转到行”仍优先定位到指定行。

### 大纲与继续阅读

大纲默认启用并展开。工具栏“大纲”可以展开或收起章节列表，点击标题可跳到对应章节。只想临时腾出空间时收起面板即可；也可以在“阅读设置”中关闭“启用章节大纲”，隐藏整个大纲入口，需要时再开启。启用和展开状态都会记住。

“更多”→“最近打开”保留最近 20 篇文档及各自的视图和位置。再次打开时会尝试继续上次阅读；文件移动、删除，或系统文件授权失效后，需要重新选择文件。清除最近记录不会删除文档文件或恢复草稿。

### 跳转到行与导出图片

从“更多”选择“跳转到行”或按 `Ctrl+G`，输入行号后即可定位到当前文档的对应行。普通文档从所见即所得或阅读模式跳转时会切换到源码模式，以保证行号精确。

从“更多”选择“导出全文图片”可导出当前文档：

- 点击后会先显示确认弹窗；选择“开始导出”后，同一弹窗会显示解析、下载网络图片、排版、生成、打包和保存进度。解析、下载、排版、生成和打包期间可以取消；开始写入最终文件后取消按钮暂不可用。取消成功不会生成或覆盖目标文件。
- 每张 PNG 宽 1440px、高度最多约 4072px（约两张竖版 A4）；内容不足时会按实际高度裁短。一页直接保存为 PNG，多页使用固定四位编号（如 `小说-0001.png`）并打包为 ZIP。
- 超长文档按块保持阅读视图的 Markdown 排版，不再退化为带行号的源码图片；每批内容及其临时排版元素在生成后立即释放。
- Windows 和 Android 原生版把多页图片流式写入临时 ZIP，最多导出 2,000 页；浏览器版仍在内存中生成 ZIP，累计达到 128 MiB 时会停止并提示拆分文档。
- Windows 和 Android 原生版会下载并嵌入公网 HTTPS 地址的 PNG、JPEG、GIF 和 WebP 图片。每次导出对地址去重，使用 3 路并发；单图限 10 秒和 8 MiB，最多 32 个唯一地址、合计 32 MiB。浏览器版仍受图片服务器的 CORS 策略限制；下载失败或不支持的图片会保留替代文字占位，并在完成时汇总数量。

选中文字后，使用“更多”→“选中内容复制为图片”可生成 PNG 并复制到剪贴板；系统不支持图片剪贴板时，请按界面提示保存图片。代码块右上角提供复制按钮，方便复制完整代码。

### 本地图片与截图附件

Windows 版支持文档所在目录及其子目录内的相对图片，例如 `![截图](assets/screenshot.png)`。所见即所得、阅读与图片导出使用当前文档的位置解析图片。支持 PNG、JPEG、GIF 和 WebP，每张图片最大 32 MiB；SVG 暂不支持。父目录越级路径、绝对路径和指向授权目录外的符号链接不会读取。

普通 Markdown 文档需先保存，然后粘贴截图或选择“更多”→“插入本地图片”。图片会使用唯一文件名写入文档旁的 `assets/` 文件夹，并插入 Markdown 相对路径。移动文档时请连同附件目录一起移动。普通 Markdown 的“另存为”到其他目录只保存正文文件，请将引用的附件目录一并复制到新位置，保持相对路径有效。

Android 版先从“更多”→“关联图片文件夹”打开系统目录选择器，授权直接包含当前 Markdown 文件的文件夹。系统允许保留授权时，以后可以继续读取相对图片并在该目录的 `assets/` 中保存附件。部分应用提供的内容来源无法关联可访问目录，需要通过系统选择器重新打开或另存文档后再授权。浏览器版受文件系统访问权限限制，请按界面提示操作。

### TextPack 单文件图文文档

从“更多”选择“另存为 TextPack”，即可将当前 Markdown 正文和引用的可访问本地图片保存为一个 `.textpack` 文件。TextPack 使用 ZIP 容器，包内保存 Markdown、`info.json` 和原始二进制图片；图片无需写成 Base64。移动或发送这个文件时，内置图片会一起携带。

- 从“更多”选择“新建 TextPack”可直接创建带内置附件的文档，无需先建立外部图片文件夹。
- 使用“打开”选择 `.textpack`，Windows 也支持拖入或通过命令行打开。打开后可在三种视图中编辑与阅读；“保存”和普通“另存为”继续使用 TextPack 格式。
- 在 TextPack 内粘贴截图或使用“插入本地图片”，图片会直接加入包内附件；手动保存后写入 `.textpack`。恢复草稿同时保留正文和包内附件。
- 将普通 Markdown 转为 TextPack 时，需要能读取它引用的本地图片。Windows 使用文档所在目录；Android 需要先关联图片文件夹。网络图片保留原网址，离线阅读仍需要图片已在包内。
- TextPack 的内置图片可在浏览器版显示。浏览器直接打开普通 `.md` 时没有旁边图片目录的访问权限；请在原生版完成含此类附件的转换。浏览器回退为下载时，应用无法确认下载已保存，会保留当前文档状态和未保存提示。
- 支持 PNG、JPEG、GIF 和 WebP，每张最多 32 MiB；压缩包大小与解压后总大小分别最多 128 MiB，最多 4,096 个条目。当前不直接打开 `.textbundle` 文件夹。

其他软件需要支持 TextPack 才能直接编辑。也可以用 ZIP 解压工具取出正文和附件，再用普通 Markdown 编辑器打开正文。Android 从系统选择器导入 TextPack 后，首次保存仍需要选择导出位置。

### 粘贴网页图文

在网页中选中包含文字和图片的内容并复制，然后粘贴到编辑区。应用会把剪贴板中的 HTML 转为 Markdown，保留主要内容顺序、标题、列表及基础文字样式，并尝试下载其中可访问的 HTTPS 图片。

在 TextPack 中，成功下载的图片直接加入包内附件。空白且未保存的文档在成功包含网页图片后自动采用 TextPack；已有普通 Markdown 文档在原生版中使用文档旁的 `assets/` 附件目录。下载失败的图片保留可见的 Markdown 链接，方便稍后重新获取。

每次网页图文粘贴最多下载 32 张图片，每张最多 8 MiB，合计最多 32 MiB；仅访问 HTTPS 图片。浏览器下载仍受来源服务器的 CORS 策略限制。剪贴板需提供 HTML，复杂网页布局会转换为适合 Markdown 的基本结构。

### 支持的 Markdown 格式

工具栏支持：

- 标题、粗体、斜体、删除线和分隔线
- 引用、无序列表、有序列表和任务列表
- 缩进、减少缩进
- 表格和链接
- 行内代码和代码块

所见即所得与阅读视图使用一致的 Obsidian 风格提示块样式，例如：

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
- `.textpack`（Markdown 正文与内置图片）

Windows 版也可以把支持的文件直接拖进程序窗口打开。从“更多”选择“添加到右键打开方式”可登记上述扩展名的打开候选；需要双击 `.md` 时启动滚猫md，可选择“设为默认 .md 程序”并在 Windows 设置中完成确认。

普通文本文件及 TextPack 包内的 Markdown 正文必须是有效的 **UTF-8** 文本，可以带或不带 UTF-8 BOM。为了避免乱码后覆盖原文件，GBK、UTF-16 等其他编码会被拒绝打开，请先使用其他工具转换为 UTF-8。

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
| 查找和替换 | `Ctrl+F` |
| 跳转到行 | `Ctrl+G` |

### 保存与恢复草稿

- **原文档文件由你手动保存。** 标题末尾的 `*` 或文件名旁的圆点表示仍有修改未写入原文件。
- 编辑停止约 1.5 秒后，软件会自动将完整未保存内容写入本机恢复草稿；持续输入时每约 10 秒检查并保存一次。大文档也保留完整正文，TextPack 草稿还包含包内附件。
- 在“更多”→“恢复草稿”中找回内容。最多滚动保留 5 份恢复副本，同一份草稿会随编辑更新；超过数量时淘汰较早记录。这里提供有限的恢复副本，长期版本历史和重要文档备份仍需自行管理。
- 新建、打开其他文件或关闭程序前，存在未保存内容时可以选择“保存并继续”“放弃更改”或“取消”。选择放弃后，已保留的恢复草稿仍可找回；原文件保持上次手动保存的内容。
- 成功保存当前完整内容后，对应恢复草稿会移除。草稿写入失败时界面会提示，请及时手动保存。
- 原生版文件保存采用安全替换方式；写入失败时会尽量保留原文件，并尽量保留 UTF-8 BOM 和原文主要使用的换行格式。
- 最近记录和恢复草稿使用本机 IndexedDB，设置和记录随本机 WebView 应用数据保存。清除应用数据、卸载或浏览器清理站点数据可能移除它们；仅复制 EXE 不会迁移这些数据。

### 隐私

- 文档在本机读取、编辑和保存，不需要登录，也不会上传到服务器。
- 最近文档路径、阅读位置和完整恢复草稿会保留在本机应用数据中。可以在界面清除最近记录或删除不需要的草稿。
- 软件不收集编辑器使用统计。
- 显示、导出网络图片或粘贴网页图文时，软件会访问对应的 HTTPS 图片网址；图片服务器可能记录 IP 地址等常规请求信息。

### 当前限制

- 普通 Markdown 的本地图片需要文档所在目录的访问权限，Android 和浏览器文件选择器存在平台边界；TextPack 内置图片随包读取。浏览器版导出网络图片仍受图片服务器的 CORS 策略限制。
- 普通 Markdown 另存为 TextPack 时，现有网络图片链接保留原网址；网页图文粘贴会尝试下载剪贴板中的图片。`.textbundle` 文件夹暂不支持。单图 32 MiB、包大小和解压总大小各 128 MiB、4,096 条目的限制也适用于保存。
- 混合使用多种换行符的文档，在编辑后保存时可能统一为占主导的换行格式。
- 大文件编辑器减少常驻的原文副本；恢复草稿仍保存完整正文，混合换行在手动保存时可能统一。
- 恢复草稿最多保留 5 份，自动保存存在短暂延迟；重要内容请及时手动保存并另行备份。
- Markdown 正文仅支持 UTF-8，不会自动猜测或转换其他编码。

### 常见问题

**程序无法启动怎么办？**

安装或修复 Microsoft Edge WebView2 Runtime，然后重新启动滚猫md。

**为什么大文件的排版与普通文档略有不同？**

达到 2.5 MiB 的文件会使用轻量 Live Preview，只为当前可视区域创建排版元素。标题、强调、链接、引用和代码块仍然清晰可读，同时避免打开文件时生成整篇页面而卡死。

**为什么文件无法打开？**

请确认文件扩展名受支持，并且正文是有效 UTF-8。GBK、UTF-16 文件需要先转换编码。TextPack 还需包含有效的正文与元信息；损坏、超限或不受支持的压缩包会提示错误。

**为什么本地图片不显示？**

确认图片随文档一起保存、路径相对于当前 Markdown 文件有效，并检查当前平台是否拥有对应目录的访问权限。移动或另存文档时也要检查附件路径。

**已经保存恢复草稿，为什么标题仍有 `*`？**

恢复草稿保存在本机应用数据中；点击“保存”才会把编辑内容写入文档文件。草稿最多保留 5 份，请定期保存重要内容。

**把 EXE 复制到另一台电脑后，为什么没有最近记录？**

EXE 可以直接运行。阅读设置、最近记录和恢复草稿各自存放在设备的 WebView 应用数据中，复制 EXE 不会迁移这些记录。

**为什么导出的网络图片是大片空白？**

v0.3.4 已修复网络图片下载成功后仍可能空白的问题。请从 GitHub Releases 下载最新版本；浏览器版受到图片服务器 CORS 限制时，会显示带说明的占位。

**怎样把滚猫md设为 Markdown 的默认打开程序？**

在 Windows 版“更多”中选择“设为默认 .md 程序”。程序先注册当前 EXE，再打开系统“默认应用”设置；找到 `.md`，选择“滚猫md”并确认。也可以右键文件，通过“打开方式 → 选择其他应用”选择程序。移动或重命名便携 EXE 后，先从新位置运行并重新注册打开方式。

### 开源许可

滚猫md依据 [Apache License 2.0](LICENSE) 开源。欢迎查看源码、报告问题和参与改进；开发与贡献方法请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## English Guide

### Run the EXE

1. Download `rollcat-md.exe` from [GitHub Releases](https://github.com/sonicacd/tumblingcatmd/releases/latest/download/rollcat-md.exe).
2. Move it to a location where you want to keep it.
3. Double-click the EXE to launch it. No installation is required.

The standalone EXE does not create Start-menu shortcuts or automatically change the default Markdown application. If Windows warns that the file has an unknown source, run it only when you trust where the EXE came from.

The toolbar groups file actions, view switching, Find, and Outline. More contains recent documents, recovery drafts, and sharing actions. Collapsing the controls leaves the current filename and an expand button visible.

Reading preferences, recent documents, and recovery drafts live in this device's WebView application data. Copying the EXE to another device does not transfer those records. Move external attachments together with ordinary Markdown files; embedded TextPack attachments travel inside the document file.

rollcat-md uses the Microsoft Edge WebView2 Runtime included with most Windows 10 and Windows 11 systems. If the app does not start, install or repair WebView2 Runtime first.

### Windows Open With and Default Apps

The native Windows app provides two actions in **More**:

- **Add to Open with** registers the currently running EXE for the current user, supporting `.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`, and `.textpack`. No administrator privileges are needed. You can then choose **滚猫md** in a file's **Open with** menu; existing defaults are retained.
- **Set as default for .md** registers the app, then opens Windows **Default apps** settings. Find `.md`, select **滚猫md**, and confirm in Windows. The app reports that Settings was opened; the final default-app choice is made there.

Windows 11 versions that support app-specific settings can open the rollcat-md page directly. Older systems open the general **Default apps** page, where you can search for `.md`. Both actions are hidden in Android and browser builds.

Registration points to the full path of the running EXE. Keep the portable EXE in a stable location. After moving or renaming it, launch it from the new location and choose **Add to Open with** again to update the registration.

### Android

Download `rollcat-md-android-arm64.apk` from the [v0.5.2 release](https://github.com/sonicacd/tumblingcatmd/releases/tag/v0.5.2). This v0.5.3 release updates the Windows EXE; Android continues to use the v0.5.2 APK.

After installation, choose **Open with → 滚猫md** for `.md`, `.txt`, or `.textpack` in your file manager. The app registers common Markdown, text, TextPack, generic binary, and ZIP MIME types, then validates the real display name after receiving a file. Some unrelated binary or ZIP files may also list the app; unsupported extensions are rejected on receipt. The exact chooser UI depends on the file manager.

Android launcher icons now use the same cat artwork as the PC app, with round and adaptive resources for Android launchers.

The Android build uses the system document picker and does not request broad storage access. A file selected for opening is imported read-only; the first **Save** asks for an export destination, and that exported document can then be overwritten for the rest of the current session.

The mobile app bar includes a collapse control. Scrolling more than 40px in Reader view automatically enters focused reading: the top bar shrinks to the filename and the bottom mode controls slide away. Returning to the document top expands them, and the top arrow can toggle them at any time.

Local builds require Android SDK 36, the NDK, a JDK, and the Rust Android targets. After the Android project has been initialized, run `npm run dist:android` to produce an ARM64 APK.

### Quick Start

Help opens automatically on first launch, starting with the Windows Open with and default `.md` actions, followed by editing, reading, TextPack, web pasting, and other common features. Check **Don't show next time** and close Help to stop automatic startup display. You can still open it manually through **More → Help**.

1. Select **New**, choose **Open**, or drag a supported file onto the Windows app. Use **More → Recent Documents** to continue a previous document.
2. Switch between **WYSIWYG**, **Source**, and **Reader**. Use **Outline** to navigate chapters and **Find** to search and replace text.
3. Open **Reading Settings** to adjust font size, line height, and content width; choose Black, White, or Eye Comfort from Theme.
4. Select **Save** after editing, or **Save As** to keep a separate file. Unsaved work is automatically copied to local recovery drafts, available from **More → Recovery Drafts**.
5. Export the whole document as images from **More**, or select text and use **Copy Selection as Image**.

The current filename appears in the Windows title bar or the Android app bar. A trailing `*` or a dot beside the filename means changes have not been saved to the document file. Character count is visible by default. Estimated LLM tokens are hidden by default and can be enabled in Reading Settings.

Tokens are displayed as “approximately N tokens.” This is a fast, model-independent estimate that requires no network access. Exact results vary between LLMs and tokenizer versions.

### Three Views

- **WYSIWYG**: edit while seeing the formatted result.
- **Source**: edit the Markdown text directly.
- **Reader**: display only the rendered document.

WYSIWYG, Reader, and large-document lightweight preview share an Obsidian-inspired reading rhythm. Defaults remain 16px text, 1.5 line height, and a 1200px maximum content width. Reading Settings offers 14 / 16 / 18 / 20 / 24px text, 1.5 / 1.7 / 2 line height, and 1200 / 1600 / 2100px or full available width. Content always fits the available window width, and preferences are remembered.

For regular documents, Reader adds breathing room at explicit body-text line breaks to make transcripts and long passages easier to read, while preserving the source text and line breaks. Lists, quotes, and code blocks retain their existing spacing. Desktop views use a compact segmented control, with file actions on the left and view/theme controls on the right.

Switching views with the buttons or `Ctrl+1/2/3` uses the text currently on screen to keep the paragraph being read near its previous screen position, including the start and end of the document. Switching to Source preserves the reading position even when the editing cursor remains at the end of the document. Large documents restore their document position. Different wrapping and layout may cause small shifts; when matching text is unavailable, the app restores relative reading progress. Go to Line continues to prioritize the requested line.

### Outline and Resuming Documents

Outline is enabled and expanded by default. Use **Outline** to expand or collapse the chapter list, then select a heading to navigate to its section. Reading Settings also includes a separate **Enable Outline** preference that hides or restores the entire Outline entry point. Both preferences are remembered.

**More → Recent Documents** retains the last 20 documents with each document's view and reading position. Reopening a document attempts to restore that context. Select the file again if it was moved or deleted, or if its system file permission expired. Clearing recent records leaves document files and recovery drafts intact.

### Go to Line and Image Export

Choose **More → Go to Line** or press `Ctrl+G`, then enter a line number to move to that line in the current document. Jumping from WYSIWYG or Reader switches a regular document to Source mode so the line number stays exact.

Choose **More → Export Document Images** to export the current document:

- Selecting **Image** first opens a confirmation dialog. After **Start Export** is selected, the same dialog shows progress for parsing, downloading remote images, layout, rendering, packaging, and saving. Cancellation is available through parsing, downloading, layout, rendering, and packaging. It is disabled while the final file is being written; a successful cancellation does not create or replace the destination file.
- Each PNG is 1440px wide and up to approximately 4072px high (about two portrait A4 pages); shorter content is cropped to its actual height. One page is saved directly as PNG, while multiple pages use fixed four-digit names such as `novel-0001.png` and are packaged as ZIP.
- Very long documents are laid out in chunks while preserving the Reader-style Markdown presentation. They no longer fall back to source-code images with line numbers, and each chunk's temporary layout is released after it is rendered.
- Native Windows and Android builds stream multi-page output into a temporary ZIP and allow up to 2,000 pages. The browser build still creates ZIP files in memory and stops at a cumulative 128 MiB with a prompt to split the document.
- Native Windows and Android builds download and embed PNG, JPEG, GIF, and WebP images from public HTTPS URLs. Each export deduplicates URLs and uses three concurrent downloads, with limits of 10 seconds and 8 MiB per image, 32 unique URLs, and 32 MiB in total. Browser exports remain subject to the image server's CORS policy; failed or unsupported images keep a visible alt-text placeholder and are counted in the completion summary.

Select text and use **More → Copy Selection as Image** to create a PNG for the clipboard. If the platform cannot write images to the clipboard, follow the prompt to save the image. A copy button at the top right of a code block copies its complete code.

### Local Images and Screenshot Attachments

Windows supports images referenced relative to the document's own directory or its subdirectories, such as `![Screenshot](assets/screenshot.png)`. WYSIWYG, Reader, and image export resolve images from the current document's location. Supported formats are PNG, JPEG, GIF, and WebP, up to 32 MiB per image. SVG, parent-directory traversal, absolute paths, and symbolic links leading outside the authorized directory are unsupported.

For ordinary Markdown, save the document first, then paste a screenshot or select **More → Insert Local Image**. The app writes the image under a unique name in an `assets/` folder beside the document and inserts a relative Markdown link. Move the attachments together with the document. **Save As** for ordinary Markdown in another directory writes only the text file; copy the referenced attachment folders to that location as well to preserve relative paths.

On Android, select **More → Link Image Folder** and use the system directory picker to authorize the folder directly containing the current Markdown file. When the system retains this permission, the app can continue reading relative images and saving attachments in that folder's `assets/` directory. Some content providers cannot expose a suitable folder; reopen or save the document through the system picker before linking its folder. Browser behavior depends on file-system permissions and is explained by the interface.

### Single-file TextPack Documents

Choose **More → Save As TextPack** to save the current Markdown and its accessible local images as a `.textpack` file. TextPack uses a ZIP container holding Markdown, `info.json`, and the original binary images, without encoding those images as Base64. Embedded images travel with the file when it is moved or shared.

- Choose **More → New TextPack** to start a document with embedded attachments, without first creating an external image folder.
- Open `.textpack` from the file picker, or use drag-and-drop or a command-line path on Windows. All three views support editing and reading; **Save** and regular **Save As** retain the TextPack format.
- Pasting a screenshot or using **Insert Local Image** in a TextPack adds an attachment inside the package. A manual save writes it to disk. Recovery drafts retain both the text and package attachments.
- Converting ordinary Markdown requires access to its local images. Windows uses the document directory; Android requires a linked image folder. Remote images retain their URLs, so they still need a network connection unless already embedded.
- The browser build can display embedded TextPack images. Opening an ordinary `.md` in a browser does not grant access to sibling image folders; use the native app to convert such documents with their attachments. If saving falls back to a browser download, the app cannot confirm that the file was saved and retains the current document state and unsaved indicator.
- PNG, JPEG, GIF, and WebP are supported, up to 32 MiB per image. The compressed file and total uncompressed content are each limited to 128 MiB, with up to 4,096 entries. Opening `.textbundle` directories is currently unsupported.

Other editors need TextPack support for direct editing. A ZIP tool can also extract the text and attachments for use with an ordinary Markdown editor. Android imports still require an export destination on the first save.

### Pasting Web Text and Images

Copy a selection containing text and images from a web page, then paste it into the editor. The app converts clipboard HTML to Markdown, retaining the main content order, headings, lists, and basic text styling, and attempts to download accessible HTTPS images.

In a TextPack, downloaded images become embedded attachments. A blank, unsaved document switches to TextPack when web images are successfully included. Existing ordinary Markdown documents use the adjacent `assets/` folder in the native app. Failed image downloads remain as visible Markdown links for later retrieval.

Each web paste downloads up to 32 images, with limits of 8 MiB per image and 32 MiB in total. Only HTTPS image URLs are fetched. Browser downloads are subject to the source server's CORS policy. The clipboard must provide HTML, and complex web layouts are converted into basic Markdown structure.

### Markdown Support

The toolbar supports:

- Headings, bold, italic, strikethrough, and horizontal rules
- Block quotes, bulleted lists, numbered lists, and task lists
- Indent and outdent
- Tables and links
- Inline code and fenced code blocks

WYSIWYG and Reader share consistent styling for common Obsidian-style callouts:

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
- `.textpack` (Markdown with embedded images)

The Windows app also opens supported files dropped directly onto its window. Choose **More → Add to Open with** to register the supported extensions. To open `.md` files by double-clicking, choose **Set as default for .md** and confirm the selection in Windows Settings.

Ordinary text files and Markdown inside a TextPack must contain valid **UTF-8** text, with or without a UTF-8 BOM. GBK, UTF-16, and other encodings are rejected to prevent corrupted text from overwriting the original file. Convert them to UTF-8 before opening.

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
| Find and replace | `Ctrl+F` |
| Go to line | `Ctrl+G` |

### Saving and Recovery Drafts

- **Save the document file manually.** A trailing `*` or a dot beside its name means the file still has unsaved changes.
- After approximately 1.5 seconds without an edit, the app writes the complete unsaved content to a local recovery draft. During continuous editing it checks and saves approximately every 10 seconds. Large-document drafts keep their full text; TextPack drafts also retain package attachments.
- Open **More → Recovery Drafts** to recover work. Up to five recovery copies are retained, with each active draft updated as you edit. Older entries are removed when the limit is exceeded. Keep separate backups for long-term version history and important documents.
- Before creating or opening another document or closing the app, choose **Save and Continue**, **Discard Changes**, or **Cancel** when changes are unsaved. Discarding leaves a retained draft available for recovery and leaves the document file at its last manually saved state.
- Saving the complete current content successfully removes its recovery draft. The interface reports draft write failures so you can save the document manually.
- Native file saves use a safe replacement process that attempts to preserve the original on failure. UTF-8 BOM and the dominant line-ending style are preserved where possible.
- Recent records and recovery drafts use local IndexedDB. They and reading preferences live in this device's WebView application data. Clearing application or browser site data, or uninstalling, can remove them. Copying the EXE does not transfer these records.

### Privacy

- Documents are opened, edited, and saved locally. No account is required and document contents are not uploaded.
- Recent document paths, reading positions, and complete recovery drafts are retained in local application data. You can clear recent records or delete unwanted drafts from the interface.
- Editor usage statistics are disabled.
- Displaying or exporting remote images, or pasting web text and images, connects to the corresponding HTTPS image URLs. Image servers may record the IP address and other standard request metadata.

### Current Limitations

- Local images in ordinary Markdown require access to the document's directory; Android and browser file pickers have platform-specific limits. Embedded TextPack images are read from the package. Browser exports of remote images remain subject to the image server's CORS policy.
- Saving ordinary Markdown as TextPack retains existing remote image URLs; web pastes attempt to download images from the clipboard content. `.textbundle` directories are unsupported. The 32 MiB image limit, 128 MiB compressed and uncompressed limits, and 4,096-entry limit also apply when saving.
- Mixed line endings may be normalized to the dominant style after editing and saving.
- The large-document editor reduces resident copies of the source text; recovery drafts still keep complete text. Mixed line endings may be normalized when the document file is saved.
- Recovery drafts retain up to five entries and have a short write delay. Save important content manually and keep separate backups.
- Markdown text must use UTF-8; other encodings are not guessed or converted automatically.

### Troubleshooting

**The application does not start.**

Install or repair Microsoft Edge WebView2 Runtime, then launch 滚猫md again.

**Why does a large file look slightly different from a regular document?**

Files at or above 2.5 MiB use a lightweight Live Preview that only creates layout elements for the visible area. Headings, emphasis, links, quotes, and code blocks remain readable without constructing a full page for the entire document during opening.

**Why will a file not open?**

Check that its extension is supported and that its text uses valid UTF-8. Convert GBK or UTF-16 files before opening. TextPack also requires valid document content and metadata; damaged, oversized, or unsupported archives produce an error.

**Why is a local image missing?**

Check that the image was moved with the document, that its path is valid relative to the current Markdown file, and that the platform has permission to access the directory. Recheck attachment paths after moving or saving the document elsewhere.

**Why does the title still show `*` after a recovery draft was saved?**

Recovery drafts live in local application data. Select Save to write changes to the document file. The draft list retains up to five entries, so save important work regularly.

**Why are recent documents missing after copying the EXE to another computer?**

The EXE runs without installation. Reading preferences, recent records, and recovery drafts live separately in each device's WebView application data and do not transfer with the executable.

**Why is a remote image blank in an exported file?**

This was a known issue in v0.3.3 and is fixed in v0.3.4 and later. Download the latest release. In the browser build, a remote image blocked by the server's CORS policy is shown as a labelled placeholder instead of a silent blank area.

**How do I make rollcat-md the default Markdown application?**

Choose **More → Set as default for .md** in the Windows app. It registers the current EXE and opens Windows **Default apps** settings; find `.md`, select **滚猫md**, and confirm. You can also select the app through a file's **Open with → Choose another app** menu. After moving or renaming the portable EXE, launch it from its new location and register **Open with** again.

### License

rollcat-md is open source under the [Apache License 2.0](LICENSE). Source-code setup and contribution guidance are available in [CONTRIBUTING.md](CONTRIBUTING.md).
