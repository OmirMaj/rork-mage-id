// RevenueCat web checkout mount-point.
//
// On web, react-native-purchases delegates to @revenuecat/purchases-js, which
// renders its checkout iframe into an element with id="rcb-ui-root". If that
// element doesn't exist, purchases-js creates a div and appends it to the
// body — but inside Expo's React Native Web shell, the auto-created div ends
// up nested under the app root and gets clipped by the layout container.
// The fix is to mount our own top-level container that floats above the
// app, full-viewport, with a high z-index, so the purchase view renders
// reliably regardless of route or modal stack.
//
// Idempotent: safe to call from app startup and again right before each
// purchase. No-op on native.
import { Platform } from 'react-native';

const MOUNT_ID = 'rcb-ui-root';

export function ensureRCWebMount(): void {
  if (Platform.OS !== 'web') return;
  if (typeof document === 'undefined') return;

  let el = document.getElementById(MOUNT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = MOUNT_ID;
    document.body.appendChild(el);
    console.log('[RCWebMount] Created #rcb-ui-root container');
  }

  // Always re-apply styles in case something else mutated them.
  Object.assign(el.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    width: '100vw',
    height: '100vh',
    zIndex: '9999',
    pointerEvents: 'none', // children re-enable pointer events when checkout is open
  } satisfies Partial<CSSStyleDeclaration>);

  // Children rendered by purchases-js need pointer events enabled.
  // Use a one-time observer to flip pointer-events on once the iframe mounts.
  if (!(el as HTMLElement & { __rcMountWired?: boolean }).__rcMountWired) {
    const observer = new MutationObserver(() => {
      if (el && el.children.length > 0) {
        el.style.pointerEvents = 'auto';
      } else if (el) {
        el.style.pointerEvents = 'none';
      }
    });
    observer.observe(el, { childList: true, subtree: false });
    (el as HTMLElement & { __rcMountWired?: boolean }).__rcMountWired = true;
  }
}
