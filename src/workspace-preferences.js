export const PREFERENCES_STORAGE_KEY = 'mdeditor.workspace-preferences';

export const DEFAULT_PREFERENCES = Object.freeze({
  fontSize: 16,
  lineHeight: 1.5,
  contentWidth: 1200,
  outlineEnabled: true,
  outlineExpanded: true,
  showTokens: false
});

const FONT_SIZES = [14, 16, 18, 20, 24];
const LINE_HEIGHTS = [1.5, 1.7, 2];
const CONTENT_WIDTHS = [1200, 1600, 2100];

export function normalizePreferences(preferences) {
  const value = preferences && typeof preferences === 'object' ? preferences : {};
  const fontSize = Number(value.fontSize);
  const lineHeight = Number(value.lineHeight);
  const contentWidth = Number(value.contentWidth);
  return {
    fontSize: FONT_SIZES.includes(fontSize) ? fontSize : DEFAULT_PREFERENCES.fontSize,
    lineHeight: LINE_HEIGHTS.includes(lineHeight) ? lineHeight : DEFAULT_PREFERENCES.lineHeight,
    contentWidth: value.contentWidth === 'full' ? 'full'
      : CONTENT_WIDTHS.includes(contentWidth) ? contentWidth : DEFAULT_PREFERENCES.contentWidth,
    outlineEnabled: typeof value.outlineEnabled === 'boolean'
      ? value.outlineEnabled : DEFAULT_PREFERENCES.outlineEnabled,
    outlineExpanded: typeof value.outlineExpanded === 'boolean'
      ? value.outlineExpanded : DEFAULT_PREFERENCES.outlineExpanded,
    showTokens: typeof value.showTokens === 'boolean'
      ? value.showTokens : DEFAULT_PREFERENCES.showTokens
  };
}

export function readPreferences(storage) {
  try {
    const activeStorage = storage === undefined ? globalThis.localStorage : storage;
    return normalizePreferences(JSON.parse(activeStorage?.getItem(PREFERENCES_STORAGE_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences, storage) {
  const normalized = normalizePreferences(preferences);
  try {
    const activeStorage = storage === undefined ? globalThis.localStorage : storage;
    activeStorage?.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Reading and writing remain available if the device denies local storage.
  }
  return normalized;
}

export function applyPreferences(preferences, { root, storage, persist = true } = {}) {
  const normalized = normalizePreferences(preferences);
  const activeRoot = root === undefined ? globalThis.document?.documentElement : root;
  if (activeRoot) {
    activeRoot.style.setProperty('--document-font-size', `${normalized.fontSize}px`);
    activeRoot.style.setProperty('--document-line-height', String(normalized.lineHeight));
    // A percentage resolves against each editor's available space, including its outline.
    activeRoot.style.setProperty('--document-max-width', normalized.contentWidth === 'full'
      ? '100%' : `${normalized.contentWidth}px`);
    activeRoot.style.setProperty('--document-layout-max-width', normalized.contentWidth === 'full'
      ? '100%' : `calc(${normalized.contentWidth}px + 72px)`);
    activeRoot.dataset.outlineEnabled = String(normalized.outlineEnabled);
    activeRoot.dataset.showTokens = String(normalized.showTokens);
  }
  if (persist) savePreferences(normalized, storage);
  return normalized;
}
