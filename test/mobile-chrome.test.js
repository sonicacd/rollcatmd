import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MOBILE_CHROME_DENSITY,
  createMobileChromeState,
  isMobileChromeCollapsed,
  reduceMobileChrome
} from '../src/mobile-chrome.js';

function createMobileReaderState() {
  return createMobileChromeState({ mobile: true, mode: 'reader' });
}

function scroll(state, scrollTop, reason = 'user') {
  return reduceMobileChrome(state, { type: 'reader-scroll', scrollTop, reason });
}

test('reader chrome collapses at 40px but not before it', () => {
  const expanded = scroll(createMobileReaderState(), 39);
  const compact = scroll(expanded, 40);

  assert.equal(expanded.density, MOBILE_CHROME_DENSITY.EXPANDED);
  assert.equal(isMobileChromeCollapsed(compact), true);
});

test('reader chrome stays compact through the hysteresis range and expands at the top', () => {
  const compact = scroll(createMobileReaderState(), 40);

  assert.equal(isMobileChromeCollapsed(scroll(compact, 5)), true);
  assert.equal(isMobileChromeCollapsed(scroll(compact, 4)), false);
});

test('manual expansion waits for a deliberate 8px scroll before auto-collapsing again', () => {
  const compact = scroll(createMobileReaderState(), 40);
  const manuallyExpanded = reduceMobileChrome(compact, { type: 'toggle' });

  assert.equal(isMobileChromeCollapsed(manuallyExpanded), false);
  assert.equal(isMobileChromeCollapsed(scroll(manuallyExpanded, 47)), false);
  assert.equal(isMobileChromeCollapsed(scroll(manuallyExpanded, 48)), true);
});

test('programmatic scrolling neither changes density nor releases a manual hold', () => {
  const compact = scroll(createMobileReaderState(), 40);
  const manuallyExpanded = reduceMobileChrome(compact, { type: 'toggle' });
  const programmatic = scroll(manuallyExpanded, 200, 'programmatic');

  assert.equal(isMobileChromeCollapsed(programmatic), false);
  assert.equal(programmatic.manualHold, true);
  assert.equal(isMobileChromeCollapsed(scroll(programmatic, 207)), false);
  assert.equal(isMobileChromeCollapsed(scroll(programmatic, 208)), true);
});

test('leaving reader mode restores the controls and disables automatic collapse', () => {
  const compact = scroll(createMobileReaderState(), 40);
  const markdown = reduceMobileChrome(compact, {
    type: 'mode-change',
    mode: 'markdown'
  });

  assert.equal(isMobileChromeCollapsed(markdown), false);
  assert.equal(isMobileChromeCollapsed(scroll(markdown, 500)), false);
});

test('wide layouts allow manual collapse without reacting to reading scroll', () => {
  const desktopReader = createMobileChromeState({ mobile: false, mode: 'reader' });
  const toggled = reduceMobileChrome(desktopReader, { type: 'toggle' });

  assert.equal(isMobileChromeCollapsed(toggled), true);
  assert.equal(isMobileChromeCollapsed(scroll(desktopReader, 500)), false);
  assert.equal(isMobileChromeCollapsed(scroll(toggled, 500)), true);
});

test('editing modes can still be compacted explicitly', () => {
  const wysiwyg = createMobileChromeState({ mobile: true, mode: 'wysiwyg' });
  const compact = reduceMobileChrome(wysiwyg, { type: 'toggle' });

  assert.equal(isMobileChromeCollapsed(compact), true);
  assert.equal(compact.manualHold, true);
});

test('crossing the mobile breakpoint resets compact chrome', () => {
  const compact = scroll(createMobileReaderState(), 40);
  const desktop = reduceMobileChrome(compact, {
    type: 'viewport-change',
    mobile: false
  });
  const mobileAgain = reduceMobileChrome(desktop, {
    type: 'viewport-change',
    mobile: true
  });

  assert.equal(isMobileChromeCollapsed(desktop), false);
  assert.equal(isMobileChromeCollapsed(mobileAgain), false);
});

test('opening a different document resets compact and manual state', () => {
  const compact = scroll(createMobileReaderState(), 40);
  const reset = reduceMobileChrome(compact, {
    type: 'document-change',
    mode: 'wysiwyg'
  });

  assert.equal(reset.density, MOBILE_CHROME_DENSITY.EXPANDED);
  assert.equal(reset.manualHold, false);
  assert.equal(reset.scrollTop, 0);
});

test('invalid and negative scroll positions are normalized to the top', () => {
  const compact = scroll(createMobileReaderState(), 40);

  assert.equal(scroll(compact, Number.NaN).scrollTop, 0);
  assert.equal(isMobileChromeCollapsed(scroll(compact, -10)), false);
});
