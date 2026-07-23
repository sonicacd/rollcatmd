import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readProjectFile(relativePath) {
  return readFile(new URL(relativePath, new URL('../', import.meta.url)), 'utf8');
}

test('pins and loads DOMPurify 3.4.12 as an application dependency', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const packageLock = JSON.parse(await readProjectFile('package-lock.json'));
  const { default: DOMPurify } = await import('dompurify');

  assert.equal(packageJson.dependencies?.dompurify, '3.4.12');
  assert.equal(packageJson.overrides?.dompurify, '3.4.12');
  assert.equal(packageJson.scripts?.postinstall, 'patch-package');
  assert.equal(packageLock.packages?.['node_modules/dompurify']?.version, '3.4.12');
  assert.equal(DOMPurify.version, '3.4.12');
});

for (const bundleName of ['index.js', 'indexViewer.js']) {
  test(`Toast UI ${bundleName} uses the application DOMPurify instance`, async () => {
    const source = await readFile(
      new URL(`node_modules/@toast-ui/editor/dist/esm/${bundleName}`, new URL('../', import.meta.url)),
      'utf8'
    );

    assert.match(source, /^import DOMPurify from 'dompurify';$/m);
    assert.match(source, /^var purify = DOMPurify;$/m);
    assert.doesNotMatch(source, /^var purify = createDOMPurify\(\);$/m);
  });
}

test('the persisted patch covers both Toast UI ESM entry points', async () => {
  const patch = await readProjectFile('patches/@toast-ui+editor+3.2.2.patch');

  for (const bundleName of ['index.js', 'indexViewer.js']) {
    assert.match(
      patch,
      new RegExp(
        `diff --git a/node_modules/@toast-ui/editor/dist/esm/${bundleName.replace('.', '\\.')} ` +
          `b/node_modules/@toast-ui/editor/dist/esm/${bundleName.replace('.', '\\.')}`
      )
    );
  }

  assert.equal((patch.match(/^\+import DOMPurify from 'dompurify';$/gm) || []).length, 2);
  assert.equal((patch.match(/^\+var purify = DOMPurify;$/gm) || []).length, 2);
  assert.equal((patch.match(/^-var purify = createDOMPurify\(\);$/gm) || []).length, 2);
});
