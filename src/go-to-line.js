export function countTextLines(text) {
  let lines = 1;
  let offset = -1;

  while ((offset = text.indexOf('\n', offset + 1)) !== -1) {
    lines += 1;
  }

  return lines;
}

export function parseLineNumber(value, totalLines) {
  const maximum = Math.max(1, Math.trunc(Number(totalLines) || 1));
  const input = String(value ?? '').trim();

  if (!/^\d+$/.test(input)) {
    return { valid: false, reason: 'integer', maximum };
  }

  const line = Number(input);

  if (!Number.isSafeInteger(line)) {
    return { valid: false, reason: 'integer', maximum };
  }

  if (line < 1 || line > maximum) {
    return { valid: false, reason: 'range', maximum };
  }

  return { valid: true, line, maximum };
}
