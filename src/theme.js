export const THEME_STORAGE_KEY = 'mdeditor.theme';
export const DEFAULT_THEME = 'eye';
export const AVAILABLE_THEMES = Object.freeze(['black', 'white', 'eye']);

export function normalizeTheme(theme, fallback = DEFAULT_THEME) {
  return AVAILABLE_THEMES.includes(theme) ? theme : fallback;
}

export function readStoredTheme(storage) {
  try {
    const activeStorage = storage === undefined ? globalThis.localStorage : storage;
    return normalizeTheme(activeStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function storeTheme(theme, storage) {
  const normalizedTheme = normalizeTheme(theme);

  try {
    const activeStorage = storage === undefined ? globalThis.localStorage : storage;
    activeStorage?.setItem(THEME_STORAGE_KEY, normalizedTheme);
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(theme, {
  root,
  storage,
  persist = true
} = {}) {
  const normalizedTheme = normalizeTheme(theme);
  const activeRoot = root === undefined ? globalThis.document?.documentElement : root;

  if (activeRoot) {
    activeRoot.dataset.theme = normalizedTheme;
    activeRoot.style.colorScheme = normalizedTheme === 'black' ? 'dark' : 'light';
  }

  if (persist) {
    storeTheme(normalizedTheme, storage);
  }

  return normalizedTheme;
}
