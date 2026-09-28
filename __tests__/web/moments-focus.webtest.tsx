/**
 * Web — the Commit Capsule's focus ring: ONE ring, and only for KEYBOARD focus
 * (moments wave; the integration critic's major and its hidden-head minor).
 *
 * react-native-web renders the capsule head as a native <button>. Chrome and
 * Edge focus a button on a MOUSE press, and the app's global
 * `[role='button']:focus-visible` outline lands on the head too. The approved
 * preview (morph.html) rings the head on :focus-visible only, with the browser
 * outline off, so:
 *
 *  1. A mouse press that focuses the head (as Chrome does) draws no ring, and
 *     the head carries an INLINE outline:none, the only thing that beats the
 *     global focus-visible rule, so the browser outline never draws either.
 *  2. Tab focus draws exactly one ring (ours).
 *  3. The ring follows the driver while focused, as :focus-visible does: a
 *     mouse press drops it, a key brings it back; blur clears it.
 *  4. The line skin's hidden head (not ready: no ink, no name, offline) is no
 *     tab stop: tabindex -1, disabled, aria-hidden. Ready again, it is a normal
 *     focusable button and Tab rings it.
 *
 * jsdom does not move focus on a mouse press, so each press is the browser's
 * own order: pointerdown and mousedown dispatched on the head, then focus().
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/moments-focus.webtest.tsx
 */

import React, { act, useMemo } from 'react';
import { View } from 'react-native';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { SlideToConfirm } from '@/components/moments/SlideToConfirm';
import { useCommitCapsule } from '@/components/moments/core/useCommitCapsule';
import { SignatureLine } from '@/components/moments/signing/SignatureLine';
import { momentColors } from '@/utils/moments/colors';
import type { CommitResult } from '@/utils/moments/commitResult';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real gesture handler is mounted (it is what sits on the head in the web
// app); its pointerdown captures the pointer, which jsdom does not implement.
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
for (const k of ['setPointerCapture', 'releasePointerCapture']) if (typeof proto[k] !== 'function') proto[k] = () => {};
if (typeof proto.hasPointerCapture !== 'function') proto.hasPointerCapture = () => false;

const confirmed = async (): Promise<CommitResult> => ({ status: 'confirmed', title: 'Approved' });

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<ThemeProvider>{node}</ThemeProvider>));
  return {
    host,
    rerender: (next: React.ReactNode) => act(() => root.render(<ThemeProvider>{next}</ThemeProvider>)),
    done: () => { act(() => root.unmount()); host.remove(); },
  };
}

/** jsdom has no ResizeObserver: hand RN-web's onLayout handler the rail's size. */
function layOut(el: Element | null, width: number, height: number) {
  const fn = (el as unknown as { __reactLayoutHandler?: (e: unknown) => void } | null)?.__reactLayoutHandler;
  expect(typeof fn).toBe('function');
  act(() => fn!({ nativeEvent: { layout: { x: 0, y: 0, width, height, left: 0, top: 0 } }, timeStamp: 0 }));
}

function fire(target: EventTarget, type: string, init: KeyboardEventInit | MouseEventInit = {}) {
  const Ctor = type.startsWith('key') ? KeyboardEvent : MouseEvent;
  act(() => { target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init })); });
}

/** The browser's order for a mouse press on a <button> in Chrome and Edge. */
function mousePress(el: HTMLElement) {
  fire(el, 'pointerdown');
  fire(el, 'mousedown');
  act(() => el.focus());
  fire(el, 'mouseup');
}

/** Tab onto `el`: the keydown reaches the document first, then focus moves. */
function tabTo(el: HTMLElement) {
  fire(document.activeElement ?? document.body, 'keydown', { key: 'Tab' });
  act(() => el.focus());
}

const rings = (host: HTMLElement, id: string) => host.querySelectorAll(`[data-testid="${id}-focus-ring"]`).length;

function Slide() {
  return (
    <View style={{ width: 358 }}>
      <SlideToConfirm
        label="Slide to approve · +$4,200.00"
        busyLabel="Approving…"
        srLabel="Approve, $4,200.00"
        srConfirm="Confirm approve · +$4,200.00"
        writeOptions={{ idempotent: false, subject: 'CO #4', verb: 'approved' }}
        onCommit={confirmed}
        testID="slide"
      />
    </View>
  );
}

describe('Commit Capsule focus ring (react-native-web)', () => {
  afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  it('a mouse press focuses the head and draws no ring; the browser outline is off inline', () => {
    const m = mount(<Slide />);
    layOut(m.host.querySelector('[data-testid="slide-track"]'), 358, 64);
    const head = m.host.querySelector('[data-testid="slide-head"]') as HTMLElement;
    expect(head).not.toBeNull();
    expect(head.tagName).toBe('BUTTON');
    expect(head.getAttribute('role')).toBe('button');

    mousePress(head);
    expect(document.activeElement).toBe(head);
    expect(rings(m.host, 'slide')).toBe(0);
    // Inline, so it beats `[role='button']:focus-visible { outline: 2px solid }`.
    expect(head.style.outlineStyle).toBe('none');
    expect(head.style.outlineWidth).toBe('0px');
    m.done();
  });

  it('Tab focus draws exactly one ring, and it follows the driver like :focus-visible', () => {
    const m = mount(<Slide />);
    layOut(m.host.querySelector('[data-testid="slide-track"]'), 358, 64);
    const head = m.host.querySelector('[data-testid="slide-head"]') as HTMLElement;

    tabTo(head);
    expect(document.activeElement).toBe(head);
    expect(rings(m.host, 'slide')).toBe(1);
    // The only other ring a keyboard user could see is the global outline,
    // which the inline style switches off: one ring, not two.
    expect(head.style.outlineStyle).toBe('none');

    // A mouse press on the focused head drops the ring (the drag never shows it).
    fire(head, 'pointerdown');
    expect(rings(m.host, 'slide')).toBe(0);
    // A key while it is focused brings it back (Escape: no hold starts).
    fire(head, 'keydown', { key: 'Escape' });
    expect(rings(m.host, 'slide')).toBe(1);
    // Cmd/Ctrl/Alt combos are not the keyboard driving the page.
    fire(head, 'pointerdown');
    fire(head, 'keydown', { key: 'c', metaKey: true });
    expect(rings(m.host, 'slide')).toBe(0);

    fire(head, 'keydown', { key: 'Escape' });
    expect(rings(m.host, 'slide')).toBe(1);
    act(() => head.blur());
    expect(rings(m.host, 'slide')).toBe(0);
    m.done();
  });

  it("the line skin's hidden head is no tab stop; ready again, Tab rings it", () => {
    function Line({ ready }: { ready: boolean }) {
      const { colors, resolved } = useTheme();
      const mc = useMemo(() => momentColors(colors, resolved), [colors, resolved]);
      const readiness = ready ? null : 'Sign above the line';
      const capsule = useCommitCapsule({
        skin: 'line',
        tone: 'brand',
        hideWhenDisabled: true,
        copy: { label: 'Slide along the line to sign', busyLabel: 'Signing…', srLabel: 'Sign the contract', srConfirm: 'Confirm signing the contract' },
        disabledReason: readiness,
        write: confirmed,
        writeOptions: { idempotent: false, legal: true, subject: 'the contract', verb: 'signed' },
      });
      const common = { capsule, colors: mc, resolved, label: 'Slide along the line to sign', srConfirm: 'Confirm signing the contract', readiness, testID: 'line' };
      return (
        <View style={{ width: 352, height: 200 }}>
          <SignatureLine {...common} layer="under" />
          <SignatureLine {...common} layer="over" />
        </View>
      );
    }

    const m = mount(<Line ready={false} />);
    layOut(m.host.querySelector('[data-testid="line-under"]'), 352, 56);
    let head = m.host.querySelector('[data-testid="line-head"]') as HTMLElement;
    expect(head).not.toBeNull();
    expect(head.getAttribute('tabindex')).toBe('-1');
    expect(head.getAttribute('aria-disabled')).toBe('true');
    expect(head.hasAttribute('disabled')).toBe(true);
    expect(head.getAttribute('aria-hidden')).toBe('true');
    // No focus handlers ride a hidden head, so even a forced focus rings nothing
    // (jsdom, unlike a browser, lets a disabled button take a programmatic focus).
    tabTo(head);
    expect(rings(m.host, 'line')).toBe(0);
    act(() => head.blur());

    m.rerender(<Line ready />);
    head = m.host.querySelector('[data-testid="line-head"]') as HTMLElement;
    expect(head.getAttribute('tabindex')).toBeNull();
    expect(head.hasAttribute('disabled')).toBe(false);
    expect(head.getAttribute('aria-hidden')).toBeNull();
    tabTo(head);
    expect(document.activeElement).toBe(head);
    expect(rings(m.host, 'line')).toBe(1);

    // Going not-ready while focused takes the ring away with the tab stop.
    m.rerender(<Line ready={false} />);
    expect(rings(m.host, 'line')).toBe(0);
    m.done();
  });
});
