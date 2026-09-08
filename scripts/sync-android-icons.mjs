// Regenerate Android launcher resources from the existing Windows artwork.
// Run: node scripts/sync-android-icons.mjs (after npm install).
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = new URL('../', import.meta.url);
const source = new URL('src-tauri/icons/icon.png', root);
const temporary = new URL('work/android-icons/', root);
const targets = [
  new URL('src-tauri/icons/android/', root),
  new URL('src-tauri/gen/android/app/src/main/res/', root)
];
const densities = [
  ['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]
];
const png = await readFile(source);
await mkdir(temporary, { recursive: true });

// Android masks a 108 dp foreground down to a launcher shape. A centered
// 72 dp copy preserves the cat ears and MD lettering in the 66 dp safe circle.
// The SVG wrappers only resize/mask the PC PNG; they do not redraw its artwork.
const image = `data:image/png;base64,${png.toString('base64')}`;
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108"><image href="${image}" x="18" y="18" width="72" height="72"/></svg>`;
const round = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><clipPath id="round"><circle cx="256" cy="256" r="256"/></clipPath></defs><g clip-path="url(#round)"><circle cx="256" cy="256" r="256" fill="#15191c"/><image href="${image}" width="512" height="512"/></g></svg>`;
await writeFile(new URL('foreground.svg', temporary), foreground);
await writeFile(new URL('round.svg', temporary), round);

async function generate(input, folder, sizes) {
  const output = new URL(`${folder}/`, temporary);
  await execute(process.execPath, [
    fileURLToPath(new URL('node_modules/@tauri-apps/cli/tauri.js', root)),
    'icon', fileURLToPath(input), '--output', fileURLToPath(output), '--png', sizes.join(',')
  ], { cwd: fileURLToPath(root) });
  return output;
}

// Explicit sizes also avoid the CLI's all-platform generator emitting 49 px
// hdpi legacy icons; Android's launcher size for this density is 72 px.
const regularFiles = await generate(source, 'regular', densities.map(([, size]) => size));
const roundFiles = await generate(new URL('round.svg', temporary), 'round', densities.map(([, size]) => size));
const foregroundFiles = await generate(new URL('foreground.svg', temporary), 'foreground', densities.map(([, , size]) => size));
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
const backgroundXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#15191c</color>
</resources>
`;

for (const target of targets) {
  for (const [density, size, foregroundSize] of densities) {
    const directory = new URL(`mipmap-${density}/`, target);
    await mkdir(directory, { recursive: true });
    await copyFile(new URL(`${size}x${size}.png`, regularFiles), new URL('ic_launcher.png', directory));
    await copyFile(new URL(`${size}x${size}.png`, roundFiles), new URL('ic_launcher_round.png', directory));
    await copyFile(new URL(`${foregroundSize}x${foregroundSize}.png`, foregroundFiles), new URL('ic_launcher_foreground.png', directory));
  }
  await mkdir(new URL('mipmap-anydpi-v26/', target), { recursive: true });
  await mkdir(new URL('values/', target), { recursive: true });
  await writeFile(new URL('mipmap-anydpi-v26/ic_launcher.xml', target), adaptiveXml);
  await writeFile(new URL('mipmap-anydpi-v26/ic_launcher_round.xml', target), adaptiveXml);
  await writeFile(new URL('values/ic_launcher_background.xml', target), backgroundXml);
}

console.log('Synced 18 launcher resources in each Android resource directory from src-tauri/icons/icon.png.');
console.log('Windows icons and unrelated Android resources are unchanged.');
