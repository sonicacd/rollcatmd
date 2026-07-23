export const APPLICATION_TITLE = '滚猫md';

export function formatWindowTitle(displayName, isDirty = false) {
  const safeDisplayName = displayName || '未命名.md';
  return `${APPLICATION_TITLE} — ${safeDisplayName}${isDirty ? ' *' : ''}`;
}
