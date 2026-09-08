import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeWindowsIntegration } from '../src/windows-integration.js';

class MenuElement extends EventTarget {
  hidden = true;
  disabled = false;

  // Dispatch explicitly so the pending guard is tested even when a caller
  // sends a synthetic event to a disabled button.
  press() { this.dispatchEvent(new Event('click')); }
}

function fixture({ nativeRuntime = true, platform = 'Windows', invoke = async () => {} } = {}) {
  const register = new MenuElement();
  const defaults = new MenuElement();
  const elements = [new MenuElement(), new MenuElement(), register, defaults];
  const statuses = [];
  const calls = [];
  const document = {
    querySelectorAll: () => elements,
    getElementById: (id) => ({ registerOpenWithButton: register, defaultMarkdownButton: defaults })[id]
  };
  initializeWindowsIntegration({
    document, nativeRuntime, platform,
    invoke(command) { calls.push(command); return invoke(command); },
    setStatus: (status) => statuses.push(status)
  });
  return { register, defaults, elements, statuses, calls };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

test('integration stays hidden and inactive in web and non-Windows runtimes', async () => {
  for (const environment of [
    { nativeRuntime: false, platform: 'Windows' },
    { nativeRuntime: true, platform: 'Android' },
    { nativeRuntime: true, platform: 'Linux armv8l' },
    { nativeRuntime: true, platform: 'MacIntel' },
    { nativeRuntime: true, platform: '' }
  ]) {
    const ui = fixture(environment);
    ui.register.press(); ui.defaults.press();
    await settled();
    assert.ok(ui.elements.every((element) => element.hidden), JSON.stringify(environment));
    assert.deepEqual(ui.calls, []);
    assert.deepEqual(ui.statuses, []);
  }
});

test('both Windows platform identifiers reveal the whole menu section', () => {
  for (const platform of ['Windows', 'Win32']) {
    const ui = fixture({ platform });
    assert.ok(ui.elements.every((element) => !element.hidden));
    assert.equal(ui.register.disabled, false);
    assert.equal(ui.defaults.disabled, false);
    assert.deepEqual(ui.calls, []);
  }
});

test('registering a candidate blocks competing clicks and reports only the completed registration', async () => {
  const pending = deferred();
  const ui = fixture({ invoke: () => pending.promise });
  ui.register.press();
  assert.equal(ui.register.disabled, true);
  assert.equal(ui.defaults.disabled, true);
  assert.deepEqual(ui.calls, ['register_windows_file_associations']);
  assert.deepEqual(ui.statuses, ['正在添加到右键“打开方式”…']);

  ui.register.press(); ui.defaults.press();
  assert.deepEqual(ui.calls, ['register_windows_file_associations']);
  pending.resolve();
  await settled();
  assert.equal(ui.register.disabled, false);
  assert.equal(ui.defaults.disabled, false);
  assert.equal(ui.statuses.at(-1), '已添加到右键“打开方式”，可选择“滚猫md”打开文档。');
});

test('opening default settings keeps the final default choice in the user instructions', async () => {
  const pending = deferred();
  const ui = fixture({ invoke: () => pending.promise });
  ui.defaults.press();
  assert.deepEqual(ui.calls, ['open_windows_default_apps']);
  assert.deepEqual(ui.statuses, ['正在打开 Windows 默认应用设置，请将 .md 选择为“滚猫md”…']);
  ui.register.press(); ui.defaults.press();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.register.disabled, true);
  assert.equal(ui.defaults.disabled, true);
  pending.resolve();
  await settled();
  assert.equal(ui.statuses.at(-1), '已打开默认应用设置；请选择 .md → 滚猫md，并确认默认应用。');
  assert.equal(ui.register.disabled, false);
  assert.equal(ui.defaults.disabled, false);
});

test('native Error and string failures restore both actions and allow a successful retry', async () => {
  for (const action of ['register', 'defaults']) {
    for (const error of [new Error('权限测试失败'), '路径测试失败']) {
      const pending = deferred();
      let first = true;
      const ui = fixture({ invoke: () => { if (first) { first = false; return pending.promise; } } });
      ui[action].press();
      pending.reject(error);
      await settled();
      const prefix = action === 'register' ? '添加打开方式' : '打开默认应用设置';
      assert.equal(ui.statuses.at(-1), `${prefix}失败：${error.message || error}`);
      assert.equal(ui.register.disabled, false);
      assert.equal(ui.defaults.disabled, false);

      ui[action].press();
      await settled();
      assert.equal(ui.calls.length, 2);
      assert.equal(ui.register.disabled, false);
      assert.equal(ui.defaults.disabled, false);
      assert.ok(ui.statuses.at(-1).startsWith('已'));
    }
  }
});

test('a synchronous invoke failure also releases the shared action lock', async () => {
  let first = true;
  const ui = fixture({ invoke: () => { if (first) { first = false; throw new Error('IPC unavailable'); } } });
  ui.defaults.press();
  assert.equal(ui.statuses.at(-1), '打开默认应用设置失败：IPC unavailable');
  assert.equal(ui.defaults.disabled, false);
  ui.register.press();
  await settled();
  assert.deepEqual(ui.calls, ['open_windows_default_apps', 'register_windows_file_associations']);
  assert.equal(ui.statuses.at(-1), '已添加到右键“打开方式”，可选择“滚猫md”打开文档。');
});
