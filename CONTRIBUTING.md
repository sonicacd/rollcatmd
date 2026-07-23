# 参与滚猫md开发 / Contributing to rollcat-md

感谢你愿意参与滚猫md。提交问题或代码前，请先确认现有 issue 中没有相同内容，并尽量提供可复现步骤、Windows 版本和示例 Markdown 文件的最小版本。

Thank you for contributing to rollcat-md. Before opening an issue or pull request, check for existing reports and provide reproducible steps, your Windows version, and a minimal Markdown sample when relevant.

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

## 提交代码 / Pull requests

- 每个提交尽量只解决一个明确问题。
- 不要提交 `node_modules`、`src-tauri/target`、日志、密钥或本地文档。
- 修改用户可见行为时，同步更新中英文 README 和相关测试。
- 提交前运行前端测试、Rust 测试和生产构建。

- Keep each change focused on one clear problem.
- Do not commit dependencies, build caches, logs, credentials, or personal documents.
- Update both README languages and relevant tests when user-visible behavior changes.
- Run the frontend tests, Rust tests, and production build before submitting.
