export const MOBILE_CHROME_DENSITY = Object.freeze({
  EXPANDED: 'expanded',
  COMPACT: 'compact'
});

export const MOBILE_CHROME_COLLAPSE_SCROLL_TOP = 40;
export const MOBILE_CHROME_EXPAND_SCROLL_TOP = 4;
export const MOBILE_CHROME_MANUAL_RELEASE_DISTANCE = 8;

function normalizeScrollTop(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function createMobileChromeState({ mobile = false, mode = 'wysiwyg' } = {}) {
  return {
    mobile: Boolean(mobile),
    mode,
    density: MOBILE_CHROME_DENSITY.EXPANDED,
    scrollTop: 0,
    manualHold: false,
    manualAnchorTop: 0
  };
}

export function isMobileChromeCollapsed(state) {
  return state.density === MOBILE_CHROME_DENSITY.COMPACT;
}

export function reduceMobileChrome(state, event) {
  const current = state || createMobileChromeState();

  switch (event?.type) {
    case 'viewport-change':
      return createMobileChromeState({
        mobile: Boolean(event.mobile),
        mode: current.mode
      });

    case 'mode-change':
      return createMobileChromeState({
        mobile: current.mobile,
        mode: event.mode || 'wysiwyg'
      });

    case 'document-change':
      return createMobileChromeState({
        mobile: current.mobile,
        mode: event.mode || current.mode
      });

    case 'toggle': {
      return {
        ...current,
        density: isMobileChromeCollapsed(current)
          ? MOBILE_CHROME_DENSITY.EXPANDED
          : MOBILE_CHROME_DENSITY.COMPACT,
        manualHold: true,
        manualAnchorTop: current.scrollTop
      };
    }

    case 'reader-scroll': {
      const scrollTop = normalizeScrollTop(event.scrollTop);

      if (!current.mobile || current.mode !== 'reader') {
        return { ...current, scrollTop };
      }

      if (event.reason === 'programmatic') {
        return {
          ...current,
          scrollTop,
          manualAnchorTop: current.manualHold ? scrollTop : current.manualAnchorTop
        };
      }

      const manualDistance = Math.abs(scrollTop - current.manualAnchorTop);
      if (current.manualHold && manualDistance < MOBILE_CHROME_MANUAL_RELEASE_DISTANCE) {
        return { ...current, scrollTop };
      }

      let density = current.density;
      if (scrollTop <= MOBILE_CHROME_EXPAND_SCROLL_TOP) {
        density = MOBILE_CHROME_DENSITY.EXPANDED;
      } else if (scrollTop >= MOBILE_CHROME_COLLAPSE_SCROLL_TOP) {
        density = MOBILE_CHROME_DENSITY.COMPACT;
      }

      return {
        ...current,
        density,
        scrollTop,
        manualHold: false,
        manualAnchorTop: scrollTop
      };
    }

    default:
      return current;
  }
}
