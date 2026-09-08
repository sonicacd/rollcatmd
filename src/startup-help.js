export const STARTUP_HELP_STORAGE_KEY = 'rollcat-md.hide-startup-help';

export function isStartupHelpHidden(storage) {
  try {
    const activeStorage = storage === undefined ? globalThis.localStorage : storage;
    return activeStorage?.getItem(STARTUP_HELP_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function storeStartupHelpHidden(hidden, storage) {
  try {
    const activeStorage = storage === undefined ? globalThis.localStorage : storage;
    if (!activeStorage) return false;
    activeStorage.setItem(STARTUP_HELP_STORAGE_KEY, hidden ? 'true' : 'false');
    return true;
  } catch {
    return false;
  }
}
