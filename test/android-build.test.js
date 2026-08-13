import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const androidConfig = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.android.conf.json', import.meta.url), 'utf8')
);
const capabilities = JSON.parse(
  readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8')
);
const cargoToml = readFileSync(
  new URL('../src-tauri/Cargo.toml', import.meta.url),
  'utf8'
);
const rustLibrary = readFileSync(
  new URL('../src-tauri/src/lib.rs', import.meta.url),
  'utf8'
);
const rustBinary = readFileSync(
  new URL('../src-tauri/src/main.rs', import.meta.url),
  'utf8'
);
const pageHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rendererSource = readFileSync(
  new URL('../src/renderer.js', import.meta.url),
  'utf8'
);
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.mjs', import.meta.url), 'utf8');

test('defines a valid Android identity and APK build command', () => {
  assert.match(androidConfig.identifier, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i);
  assert.equal(androidConfig.bundle.active, true);
  assert.match(packageJson.scripts['dist:android'], /tauri android build .*--apk/);
  assert.match(packageJson.scripts['dist:android'], /--target aarch64/);
});

test('registers Markdown and text files with Android', () => {
  const associations = androidConfig.bundle.fileAssociations;
  assert.deepEqual(
    associations.map(({ mimeType }) => mimeType),
    ['text/markdown', 'text/plain']
  );
  assert.ok(associations.every(({ androidIntentActionFilters }) =>
    androidIntentActionFilters.includes('view')
  ));
});

test('uses the Tauri mobile library entry point', () => {
  assert.match(cargoToml, /\[lib\][\s\S]*?crate-type\s*=\s*\["staticlib", "cdylib", "rlib"\]/);
  assert.match(rustLibrary, /#\[cfg_attr\(mobile, tauri::mobile_entry_point\)\]/);
  assert.match(rustLibrary, /pub fn run\(\)/);
  assert.match(rustBinary, /rollcat_md_lib::run\(\)/);
});

test('allows URI-backed document writes without broad storage permission', () => {
  assert.ok(capabilities.permissions.includes('fs:allow-read-file'));
  assert.ok(capabilities.permissions.includes('fs:allow-write-file'));
  assert.doesNotMatch(JSON.stringify(androidConfig), /MANAGE_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/);
});

test('ships adaptive Android launcher icons', () => {
  for (const relativePath of [
    '../src-tauri/icons/android/mipmap-anydpi-v26/ic_launcher.xml',
    '../src-tauri/icons/android/mipmap-mdpi/ic_launcher.png',
    '../src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher_foreground.png'
  ]) {
    assert.equal(existsSync(new URL(relativePath, import.meta.url)), true, relativePath);
  }
});

test('mobile layout accounts for safe areas, dynamic viewport, and touch targets', () => {
  assert.match(pageHtml, /viewport-fit=cover/);
  assert.match(pageHtml, /id="mobileDocumentName"/);
  assert.match(pageHtml, /id="mobileChromeToggle"[\s\S]*?aria-expanded="true"/);
  assert.match(styles, /height:\s*100dvh/);
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.toolbar \.tool-button,[\s\S]*?min-height:\s*44px/);
  assert.match(
    styles,
    /\.toastui-editor-md-container\.toastui-editor-md-vertical-style > \.toastui-editor\.md-mode[\s\S]*?width:\s*100% !important/
  );
  assert.match(
    styles,
    /\.toastui-editor-md-container\.toastui-editor-md-vertical-style > \.toastui-editor-md-preview[\s\S]*?display:\s*none !important/
  );
  assert.match(
    styles,
    /html\.mobile-chrome-collapsed \.mode-switch[\s\S]*?visibility:\s*hidden/
  );
  assert.match(
    styles,
    /\.toastui-editor-defaultUI-toolbar button\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/
  );
  assert.match(
    styles,
    /\.toastui-editor-defaultUI-toolbar button\.toastui-editor-toolbar-icons\s*\{[\s\S]*?padding:\s*6px;[\s\S]*?background-clip:\s*content-box;[\s\S]*?background-origin:\s*content-box;/
  );
  assert.match(
    styles,
    /html\.mobile-chrome-collapsed #editor \.toastui-editor-toolbar\s*\{[\s\S]*?display:\s*none;/
  );
  assert.match(
    styles,
    /html\.mobile-chrome-collapsed #editor \.toastui-editor-main\s*\{[\s\S]*?height:\s*100%;/
  );
  assert.match(
    rendererSource,
    /const mobileChromeRegions = \[[\s\S]*?editorFormattingToolbar[\s\S]*?\];/
  );
});

test('Vite exposes the dev server only when Tauri supplies a mobile host', () => {
  assert.match(viteConfig, /process\.env\.TAURI_DEV_HOST/);
  assert.match(viteConfig, /hmr:\s*mobileDevHost/);
});
