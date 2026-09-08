// Windows defaults are finalized in the system UI. Registration only adds
// this executable as a candidate and can be repeated after moving the app.
export function initializeWindowsIntegration({ document, nativeRuntime, platform, invoke, setStatus }) {
  if (!nativeRuntime || !/^win/i.test(platform || '')) return;

  for (const element of document.querySelectorAll('[data-windows-integration]')) element.hidden = false;
  const registerButton = document.getElementById('registerOpenWithButton');
  const defaultButton = document.getElementById('defaultMarkdownButton');
  let pending = false;

  async function run(openDefaults) {
    if (pending) return;
    pending = true;
    registerButton.disabled = defaultButton.disabled = true;
    setStatus(openDefaults ? '正在打开 Windows 默认应用设置，请将 .md 选择为“滚猫md”…' : '正在添加到右键“打开方式”…');
    try {
      await invoke(openDefaults ? 'open_windows_default_apps' : 'register_windows_file_associations');
      setStatus(openDefaults
        ? '已打开默认应用设置；请选择 .md → 滚猫md，并确认默认应用。'
        : '已添加到右键“打开方式”，可选择“滚猫md”打开文档。');
    } catch (error) {
      setStatus(`${openDefaults ? '打开默认应用设置' : '添加打开方式'}失败：${error?.message || error}`);
    } finally {
      pending = false;
      registerButton.disabled = defaultButton.disabled = false;
    }
  }

  registerButton.addEventListener('click', () => run(false));
  defaultButton.addEventListener('click', () => run(true));
}
