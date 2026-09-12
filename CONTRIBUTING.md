# 参与滚猫md开发 / Contributing to rollcat-md

感谢你愿意参与滚猫md。提交问题或代码前，请先确认现有 issue 中没有相同内容，并尽量提供可复现步骤、系统与软件版本、使用视图和最小 Markdown 样例。图片问题请说明相对路径结构与文件格式；恢复草稿问题请说明操作顺序，分享样例前移除私人内容。

Thank you for contributing to rollcat-md. Before opening an issue or pull request, check for existing reports and provide reproducible steps, OS and app versions, the active view, and a minimal Markdown sample. For image issues, include the relative directory structure and image format. For recovery issues, include the action sequence and remove private content from shared samples.

## 本地开发 / Local development

需要：

- Windows 10 或 Windows 11
- Node.js 18 或更高版本
- Rust stable 与 Cargo
- Microsoft C++ Build Tools
- Microsoft Edge WebView2 Runtime

Requirements:

- Windows 10 or Windows 11
- Node.js 18 or later
- Rust stable and Cargo
- Microsoft C++ Build Tools
- Microsoft Edge WebView2 Runtime

安装依赖并运行测试：

Install dependencies and run the checks:

```powershell
npm install
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build:renderer
```

启动开发版：

Start the development build:

```powershell
npm run dev
```

生成免安装的 Windows EXE：

Build the standalone Windows EXE:

```powershell
npm run dist:win
```

输出文件位于 `src-tauri/target/release/rollcat-md.exe`。

The output is written to `src-tauri/target/release/rollcat-md.exe`.

### TextPack 与网页粘贴集成检查 / TextPack and web-paste checks

Windows 上可用本机 Edge 运行隔离浏览器检查。可选测试依赖放在忽略的 `work/qa` 中，不进入应用构建：

Run isolated integration checks with the installed Edge on Windows. The optional runner stays under ignored `work/qa` and is excluded from application builds:

```powershell
npm install --prefix work/qa --no-package-lock --no-save playwright
npm run test:browser
npm run test:clipboard
npm run test:paste-races
npm run test:windows
npm run test:help
npm run test:position
```

脚本自行启动本地 Vite 服务，退出时关闭服务和隔离浏览器。它们分别覆盖文件往返与草稿恢复、真实 Ctrl+C/Ctrl+V 图文粘贴，以及异步粘贴与保存的竞态。文件选择和原生文件接口使用测试替身；图片请求使用固定样例，截图与日志写入 `work/qa`。原生文件授权、Android 系统文件选择与设备安装仍需单独验证。

Each script starts and stops its own local Vite server and isolated browser. They cover file round trips and draft recovery, real Ctrl+C/Ctrl+V with web content, and asynchronous paste/save races. File pickers and native file interfaces use test doubles; image requests use fixtures, with screenshots and logs under `work/qa`. Native file authorization, Android system pickers, and device installation require separate checks.

`test:windows` 验证平台可见性、菜单滚动和模拟 IPC 的成功、失败与重复点击。`test:help` 验证真实 localStorage 下的首次启动、勾选关闭后记忆、手动重开及小窗口布局。Rust 文件关联测试仅写入独立临时注册表子树，不登记正式打开候选或修改当前默认应用。

`test:windows` covers platform visibility, menu scrolling, and mocked IPC success, failure, and duplicate clicks. `test:help` exercises first launch, persisted opt-out after closing, manual reopening, and small-window layout with real localStorage. Rust association tests write only an isolated temporary registry subtree; they do not register production candidates or change current defaults.

`test:position` 验证视图切换后的阅读位置，包括编辑光标留在文末时，通过按钮和快捷键从所见即所得切到源码，以及带图片的 TextPack 文档。

`test:position` checks reading position after view switches, including switching from WYSIWYG to Source with buttons and shortcuts while the editing cursor remains at the end, and TextPack documents with images.

### 阅读、恢复与附件的开发约定 / Reading, recovery, and attachments

- 保持三种视图及普通/大文档行为一致。新增大纲、图片或阅读设置时，验证分块渲染没有转成全文 DOM 排版。
- 原文档由用户手动保存；恢复草稿保存完整未保存内容。不要截断大文件草稿，也不要在保存失败或仅保存较早修订时删除较新的恢复内容。
- `src/document-history.js` 负责 IndexedDB 最近记录和恢复草稿。修改持久化格式时保留升级路径，文件句柄使用结构化克隆；配额、授权与克隆错误应传递到界面。
- 最近文档最多 20 条，恢复草稿最多 5 条。清除最近记录、删除草稿、保存文档与放弃编辑具有不同的数据保留行为，需分别验证。
- 阅读偏好默认保持 16px、1.5 倍行高和 1200px 正文宽度；新增宽度选项应保留 1600px、2100px 与全宽选择。tokens 估算默认隐藏。
- 本地图片读取和附件写入必须遵守当前文档目录授权；Android 使用系统目录选择器与 SAF 权限。覆盖父目录路径、符号链接、失效授权与另存为路径变化。
- 本机 WebView 应用数据包含文档路径、阅读位置与完整恢复副本。调试时使用测试文档，截图和发布产物不得夹带个人记录。

- Keep all three views consistent for regular and large documents. Outline, image, and preference changes must preserve viewport rendering for large files.
- Document files are saved manually; recovery drafts retain complete unsaved text. Preserve large drafts and newer recovery content when a save fails or only an earlier revision is saved.
- `src/document-history.js` owns IndexedDB recent records and drafts. Preserve upgrade paths when changing storage formats, retain structured-clone support for file handles, and surface quota, permission, and clone failures.
- Recent documents are capped at 20 and recovery drafts at five. Verify the distinct retention behavior of clearing recents, deleting drafts, saving files, and discarding edits.
- Reading defaults remain 16px text, 1.5 line height, and 1200px content width. Preserve 1600px, 2100px, and full-width choices. Token estimates are hidden by default.
- Local image reads and attachment writes must respect the current document's authorized directory. Android uses the system directory picker and SAF permissions. Cover parent traversal, symbolic links, expired grants, and changed Save As locations.
- Local WebView application data contains document paths, reading positions, and complete recovery copies. Use test documents and keep personal records out of screenshots and release artifacts.

### Android 开发 / Android development

Android 构建另外需要 JDK、Android SDK Platform 36、Build-Tools 36、Platform-Tools、NDK（Side by side），以及 Rust Android targets。设置 `JAVA_HOME`、`ANDROID_HOME` 和 `NDK_HOME` 后，执行：

Android builds additionally require a JDK, Android SDK Platform 36, Build-Tools 36, Platform-Tools, an NDK (Side by side), and the Rust Android targets. After setting `JAVA_HOME`, `ANDROID_HOME`, and `NDK_HOME`, run:

```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npm run android:init
npm run dist:android
```

`android:init` 只用于尚未生成 `src-tauri/gen/android` 的工作树。`dist:android` 默认构建适用于现代 Android 真机的 ARM64 APK。

Run `android:init` only when `src-tauri/gen/android` has not been generated yet. `dist:android` builds an ARM64 APK for modern physical Android devices.

`dist:android` 会先执行 `icons:android`，从 PC 原图 `src-tauri/icons/icon.png` 同步 Android 图标源目录和实际 Gradle 资源目录。可以单独运行 `npm run icons:android`。修改图标后，核对普通、圆形与自适应资源，并在最终 APK 中验证实际打包的图片，避免只更新图标源目录。

`dist:android` runs `icons:android` first to sync the PC artwork in `src-tauri/icons/icon.png` into both the Android icon source directory and the resources consumed by Gradle. Run `npm run icons:android` separately when needed. Check legacy, round, and adaptive resources after an icon change, then inspect the final APK images to catch stale resources in the generated Android project.

Android 文件关联可在 Windows/JDK 17 环境运行以下检查。脚本首次将带 SHA-256 校验的 Android 7/14 framework 测试 JAR 下载到忽略的 `work/qa`；缓存齐全后可加 `-Offline`。支持 `-ManifestPath` 指向 Gradle 合并后的 XML。测试直接调用 Android `IntentFilter` 和生产接收策略；文件提供者的名称查询与读取结果使用替身，真机权限、文件管理器候选界面和 Activity 冷热启动需单独验证。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-android-intents.ps1
```

On Windows with JDK 17, this script checks file associations using Android 7/14 framework JARs downloaded into ignored `work/qa` with pinned SHA-256 checksums. Add `-Offline` when cached, or `-ManifestPath` to check the merged Gradle manifest. Tests call Android `IntentFilter` and the production admission policy; provider name/read results use test doubles. Device permissions, file-manager chooser UI, and Activity cold/warm launches still require device checks.

## 发布验证 / Release verification

前端测试、Rust 测试和构建分别记录实际命令与结果；构建成功之后，还需验证用户路径。v0.5.0 的检查清单在 [docs/qa-v0.5.0.md](docs/qa-v0.5.0.md)。IndexedDB、系统剪贴板、窗口关闭与 Android 目录授权需要浏览器或原生环境中的实际验证，单元测试覆盖不能代替这些结果。

Record the actual frontend test, Rust test, and build results separately, then exercise the user flows in [docs/qa-v0.5.0.md](docs/qa-v0.5.0.md). IndexedDB, the system clipboard, native window close handling, and Android folder permissions require browser or native runtime checks in addition to unit tests.

发布时同步 `package.json`、锁文件与 Tauri/Rust 版本，并将发布说明提交到 `docs/releases/`。`release/` 已被 Git 忽略，可用于本地临时产物；需要审核的发布说明应保留在版本库中。上传后核对下载文件、版本与校验和，在发布说明中填入实际验证结果和已知限制。

Keep package, lockfile, and Tauri/Rust versions in sync for a release. Commit release notes under `docs/releases/`; the ignored `release/` directory is suitable for temporary local artifacts. After uploading, verify downloads, versions, and checksums, and record actual validation results and known limits in the release notes.

## 提交代码 / Pull requests

- 每个提交尽量只解决一个明确问题。
- 不要提交 `node_modules`、`src-tauri/target`、日志、密钥或本地文档。
- 修改用户可见行为时，同步更新中英文 README 和相关测试。
- 提交前运行前端测试、Rust 测试和生产构建。

- Keep each change focused on one clear problem.
- Do not commit dependencies, build caches, logs, credentials, or personal documents.
- Update both README languages and relevant tests when user-visible behavior changes.
- Run the frontend tests, Rust tests, and production build before submitting.
