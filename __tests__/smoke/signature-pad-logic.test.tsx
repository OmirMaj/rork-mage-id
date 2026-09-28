/**
 * SignaturePad logic (moments / SIGNLINE, spec section 3).
 *
 *  P1 responder events carrying locationX/Y produce the exact legacy stroke
 *     strings (pageX is deliberately offset, so a pageX path would fail).
 *  P2 a start inside noStartRects adds no stroke (and a move cannot grant it).
 *  P3 locked refuses new strokes and keeps the committed ones; a stroke in
 *     progress when the lock lands is dropped.
 *  P4 onChange fires on each pen-up with all strokes, and [] on clear.
 *  P5 the legacy onSave-only config still shows "Save Signature" and passes the
 *     paths on press; chrome 'none' hides the chrome.
 *  P6 coordinateWidth 300 at width 352 scales x by 300/352; the Svg gets
 *     viewBox "0 0 300 <ch>".
 *  P7 every existing caller configuration renders the same host tree as the
 *     ORIGINAL file (ac528d3b:components/SignaturePad.tsx), styles flattened and
 *     handlers dropped, checked against digests pinned in this file (see
 *     ORIGINAL_DIGESTS). The one intended delta is pointerEvents="none" on the
 *     Svg, asserted on its own.
 *  P8 StrictMode: one release commits exactly one stroke (the old nested
 *     setState updater committed it twice).
 */

import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import Svg from 'react-native-svg';
import SignaturePad from '@/components/SignaturePad';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

/**
 * P7's proof is PORTABLE: each caller configuration's normalized host tree,
 * rendered through the ORIGINAL file (ac528d3b:components/SignaturePad.tsx),
 * is pinned below as a digest. CI (a depth-1 checkout, no history) compares
 * the current file against these digests; nothing outside the repo is read.
 *
 * The digest abstracts THEME colours (any colour string other than the
 * original's four literals becomes "<theme>"), so a palette change does not
 * trip it. A change to Type / Tokens sizes can. To re-prove against the
 * original (the failing diff then prints the fresh digests):
 *   git show ac528d3b:components/SignaturePad.tsx > /tmp/SignaturePad.orig.tsx
 *   SIGNATURE_PAD_ORIG=/tmp/SignaturePad.orig.tsx npx jest __tests__/smoke/signature-pad-logic.test.tsx
 * With SIGNATURE_PAD_ORIG set, P7 ALSO compares the full trees directly
 * (colours included) against the original.
 */
const ORIGINAL_PATH = process.env.SIGNATURE_PAD_ORIG;
const ORIGINAL_DIGESTS: Record<string, string> = {
  'contract.tsx:2185 (empty)': '96e5491c8ae13dd58b65',
  'contract.tsx:2303 (inked)': '77f2f0a3dbbe3b245601',
  'field-ticket.tsx:1847': '96e5491c8ae13dd58b65',
  'client-view.tsx:1933': '96e5491c8ae13dd58b65',
  'company-profile.tsx:755 (inked)': 'd12aad97eb49326bc6d9',
  'company-profile.tsx:755 (none)': 'c7632c208bbd3b9bdd43',
};
/** The original file's hard-coded colour literals (kept verbatim in the digest). */
const LITERAL_COLORS = new Set(['#1a1a1a', '#FAFAFA', '#FFFFFF', 'rgba(0,0,0,0.15)']);
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;
const LITERAL_LC = new Set([...LITERAL_COLORS].map((c) => c.toLowerCase()));
/** react-native-svg hands its hosts PROCESSED colours: { type: 0, payload: ARGB uint32 }. */
function svgColour(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.type !== 0 || typeof o.payload !== 'number' || Object.keys(o).length !== 2) return null;
  const n = o.payload >>> 0;
  const h = (x: number) => x.toString(16).padStart(2, '0');
  const a = (n >>> 24) & 255;
  return `#${h((n >>> 16) & 255)}${h((n >>> 8) & 255)}${h(n & 255)}${a === 255 ? '' : h(a)}`;
}
/** Stable JSON: sorted keys, theme colours abstracted (Svg's processed colours too). */
function stable(v: unknown): string {
  const sc = svgColour(v);
  if (sc) return stable(sc);
  if (typeof v === 'string') return JSON.stringify(COLOR_RE.test(v) && !LITERAL_LC.has(v.toLowerCase()) ? '<theme>' : v);
  if (v == null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}
function digest(tree: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.createHash('sha256').update(stable(tree)).digest('hex').slice(0, 20);
}

/**
 * Optional: the ORIGINAL SignaturePad from a file outside the repo, where jest's
 * resolver cannot find node_modules. Transform it with the repo's own babel
 * config (as if it sat at components/SignaturePad.tsx) and evaluate it with
 * THIS file's require, so it shares React, react-native and the theme mock.
 */
function loadOriginal(file: string): React.ComponentType<Record<string, unknown>> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const babel = require('@babel/core') as typeof import('@babel/core');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const root = path.resolve(__dirname, '..', '..');
  const out = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: path.join(root, 'components', 'SignaturePad.tsx'),
    cwd: root,
    configFile: path.join(root, 'babel.config.js'),
    babelrc: false,
    caller: { name: 'babel-jest', supportsStaticESM: false },
  });
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('require', 'module', 'exports', out!.code!)((id: string) => require(id), mod, mod.exports);
  return mod.exports.default as React.ComponentType<Record<string, unknown>>;
}

/** The legacy builder, verbatim from the original file. */
const legacy = (pts: [number, number][]) =>
  pts.map(([x, y], i) => (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`)).join('');

let ts = 1;
/** A responder event: locationX/Y canvas-relative, pageX/Y offset by 500. */
function ev(x: number, y: number) {
  ts += 1;
  const t = {
    touchActive: true,
    startPageX: x + 500, startPageY: y + 500, startTimeStamp: ts,
    currentPageX: x + 500, currentPageY: y + 500, currentTimeStamp: ts,
    previousPageX: x + 500, previousPageY: y + 500, previousTimeStamp: ts,
  };
  return {
    nativeEvent: { locationX: x, locationY: y, pageX: x + 500, pageY: y + 500, identifier: 0, timestamp: ts, touches: [], changedTouches: [] },
    touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: ts, touchBank: [t] },
  };
}

type Handlers = Record<string, (e: unknown) => unknown>;
/** Draw one stroke through the canvas's responder props. Returns whether it was granted. */
function stroke(canvas: { props: Handlers }, pts: [number, number][]): boolean {
  const [x0, y0] = pts[0];
  const start = ev(x0, y0);
  if (!canvas.props.onStartShouldSetResponder(start)) return false;
  act(() => { canvas.props.onResponderGrant(start); });
  for (const [x, y] of pts.slice(1)) act(() => { canvas.props.onResponderMove(ev(x, y)); });
  act(() => { canvas.props.onResponderRelease(ev(pts[pts.length - 1][0], pts[pts.length - 1][1])); });
  return true;
}

/** An ink path (legacy one-decimal format), not a Lucide icon path. */
const isInk = (n: { props: Record<string, unknown> }) => typeof n.props.d === 'string' && /^M-?\d+\.\d,-?\d+\.\d/.test(n.props.d as string);

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
function norm(node: unknown, dropSvgPointerEvents: boolean): unknown {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((n) => norm(n, dropSvgPointerEvents));
  const el = node as Node;
  const props: Record<string, unknown> = {};
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function') continue;
    if (dropSvgPointerEvents && k === 'pointerEvents' && /^RNSVG/.test(el.type)) continue;
    props[k] = /style$/i.test(k) ? StyleSheet.flatten(v as StyleProp<ViewStyle>) : v;
  }
  return { type: el.type, props, children: el.children ? el.children.map((c) => norm(c, dropSvgPointerEvents)) : null };
}
function findAll(node: unknown, pred: (n: Node) => boolean, out: Node[] = []): Node[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out; }
  const el = node as Node;
  if (pred(el)) out.push(el);
  (el.children ?? []).forEach((c) => findAll(c, pred, out));
  return out;
}

describe('SignaturePad logic', () => {
  const stepP1 = () => { // P1 locationX/Y produce the exact legacy strings
    const onChange = jest.fn();
    const r = render(<SignaturePad testID="pad" onChange={onChange} />);
    const canvas = r.getByTestId('pad') as unknown as { props: Handlers };
    const a: [number, number][] = [[10.04, 20.06], [15.55, 25.449], [30, 40.25], [-3.26, 180.44]];
    expect(stroke(canvas, a)).toBe(true);
    const b: [number, number][] = [[100.05, 50]];
    expect(stroke(canvas, b)).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith([legacy(a), legacy(b)]);
    // A one-point stroke is just "Mx,y"; negative / out-of-canvas points are kept, never clamped.
    expect(onChange.mock.calls[1][0][1]).toBe(`M${(100.05).toFixed(1)},50.0`);
    expect(onChange.mock.calls[1][0][0]).toContain(' L-3.3,180.4');
    r.unmount();
  };

  const stepP2 = () => { // P2 a start inside noStartRects adds no stroke; a move cannot grant it
    const onChange = jest.fn();
    const r = render(<SignaturePad testID="pad" onChange={onChange} noStartRects={[{ x: 0, y: 114, width: 300, height: 36 }]} />);
    const canvas = r.getByTestId('pad') as unknown as { props: Handlers };
    expect(stroke(canvas, [[40, 120], [60, 60]])).toBe(false);
    expect(canvas.props.onMoveShouldSetResponder(ev(60, 60))).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    // Above the zone it starts, and it may continue INTO the zone.
    expect(stroke(canvas, [[40, 60], [60, 130]])).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith([legacy([[40, 60], [60, 130]])]);
    r.unmount();
  };

  const stepP3 = () => { // P3 locked refuses new strokes and keeps the committed ones
    const onChange = jest.fn();
    const r = render(<SignaturePad testID="pad" onChange={onChange} />);
    let canvas = r.getByTestId('pad') as unknown as { props: Handlers };
    const a: [number, number][] = [[10, 10], [20, 20]];
    stroke(canvas, a);
    r.rerender(<SignaturePad testID="pad" onChange={onChange} locked />);
    canvas = r.getByTestId('pad') as unknown as { props: Handlers };
    expect(stroke(canvas, [[50, 50], [60, 60]])).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    // The committed stroke is still drawn.
    const paths = findAll(r.toJSON(), isInk);
    expect(paths.map((p) => p.props.d)).toEqual([legacy(a)]);

    // A stroke in progress when the lock lands is dropped, never committed.
    r.rerender(<SignaturePad testID="pad" onChange={onChange} />);
    canvas = r.getByTestId('pad') as unknown as { props: Handlers };
    const s = ev(70, 70);
    expect(canvas.props.onStartShouldSetResponder(s)).toBe(true);
    act(() => { canvas.props.onResponderGrant(s); });
    act(() => { canvas.props.onResponderMove(ev(80, 80)); });
    r.rerender(<SignaturePad testID="pad" onChange={onChange} locked />);
    canvas = r.getByTestId('pad') as unknown as { props: Handlers };
    act(() => { canvas.props.onResponderRelease(ev(80, 80)); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(findAll(r.toJSON(), isInk).map((p) => p.props.d)).toEqual([legacy(a)]);
    r.unmount();
  };

  const stepP4 = () => { // P4 onChange on every pen-up with all strokes; [] on clear; first pen down once; terminate commits
    const onChange = jest.fn();
    const onFirst = jest.fn();
    const onClear = jest.fn();
    const r = render(<SignaturePad testID="pad" onChange={onChange} onFirstPenDown={onFirst} onClear={onClear} />);
    const canvas = r.getByTestId('pad') as unknown as { props: Handlers };
    const a: [number, number][] = [[1, 2], [3, 4]];
    const b: [number, number][] = [[5, 6], [7, 8]];
    stroke(canvas, a);
    expect(onChange).toHaveBeenLastCalledWith([legacy(a)]);
    stroke(canvas, b);
    expect(onChange).toHaveBeenLastCalledWith([legacy(a), legacy(b)]);
    expect(onFirst).toHaveBeenCalledTimes(1);
    // While drawing, a parent cannot take the gesture; a terminate commits.
    const s = ev(9, 9);
    act(() => { canvas.props.onResponderGrant(s); });
    expect(canvas.props.onResponderTerminationRequest(ev(9, 9))).toBe(false);
    act(() => { canvas.props.onResponderMove(ev(10, 11)); });
    act(() => { canvas.props.onResponderTerminate(ev(10, 11)); });
    expect(onChange).toHaveBeenLastCalledWith([legacy(a), legacy(b), legacy([[9, 9], [10, 11]])]);
    // Clear (chrome shows the Clear button when onChange is given; Save is hidden).
    expect(r.queryByText('Save Signature')).toBeNull();
    fireEvent.press(r.getByText('Clear'));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(onClear).toHaveBeenCalledTimes(1);
    r.unmount();
  };

  const stepP5 = () => { // P5 legacy onSave config shows Save and passes paths; chrome none hides chrome
    const onSave = jest.fn();
    const r = render(<SignaturePad testID="pad" onSave={onSave} onClear={() => {}} height={150} />);
    expect(r.getByText('Save Signature')).toBeTruthy();
    expect(r.getByText('Sign here')).toBeTruthy();
    const canvas = r.getByTestId('pad') as unknown as { props: Handlers };
    const a: [number, number][] = [[12.34, 56.78], [90.12, 34.56]];
    stroke(canvas, a);
    expect(r.queryByText('Sign here')).toBeNull();
    fireEvent.press(r.getByText('Save Signature'));
    expect(onSave).toHaveBeenCalledWith([legacy(a)]);
    r.unmount();

    const bare = render(<SignaturePad testID="pad" chrome="none" onChange={() => {}} />);
    expect(bare.queryByText('Save Signature')).toBeNull();
    expect(bare.queryByText('Clear')).toBeNull();
    expect(bare.queryByText('Sign here')).toBeNull();
    const cs = StyleSheet.flatten((bare.getByTestId('pad') as unknown as { props: { style: StyleProp<ViewStyle> } }).props.style) as Record<string, unknown>;
    expect(cs.borderWidth).toBe(0);
    expect(cs.backgroundColor).toBe('transparent');
    bare.unmount();
  };

  const stepP6 = () => { // P6 coordinate space scales the stored points and sets the viewBox
    const onChange = jest.fn();
    const ch = 176 * (300 / 352);
    const r = render(
      <SignaturePad testID="pad" onChange={onChange} width={352} height={176} coordinateWidth={300} coordinateHeight={ch} strokeWidth={1.6} />,
    );
    const canvas = r.getByTestId('pad') as unknown as { props: Handlers };
    stroke(canvas, [[35.2, 17.6], [352, 176]]);
    expect(onChange).toHaveBeenLastCalledWith([legacy([[35.2 * (300 / 352), 17.6 * (ch / 176)], [300, ch]])]);
    expect(onChange.mock.calls[0][0][0]).toBe('M30.0,15.0 L300.0,150.0');
    // The ink canvas (the Clear button's Lucide icon is an Svg too).
    const svg = r.UNSAFE_getAllByType(Svg).find((n) => n.props.width === 352)!;
    expect(svg.props.viewBox).toBe(`0 0 300 ${ch}`);
    expect(svg.props.pointerEvents).toBe('none');
    r.unmount();
  };

  const stepP7 = () => { // P7 every existing caller renders the same host tree as the original file
    const Original = ORIGINAL_PATH ? loadOriginal(ORIGINAL_PATH) : null;
    const printed: Record<string, string> = {};
    const currentDigests: Record<string, string> = {};
    const noop = () => {};
    const inked = ['M10.0,20.0 L30.0,40.0', 'M50.0,60.0'];
    const configs: [string, Record<string, unknown>][] = [
      ['contract.tsx:2185 (empty)', { initialPaths: [], onSave: noop, onClear: noop, height: 150 }],
      ['contract.tsx:2303 (inked)', { initialPaths: inked, onSave: noop, onClear: noop, height: 150 }],
      ['field-ticket.tsx:1847', { initialPaths: [], onSave: noop, onClear: noop, height: 150 }],
      ['client-view.tsx:1933', { width: 300, height: 150, onSave: noop, onClear: noop }],
      ['company-profile.tsx:755 (inked)', { initialPaths: inked, onSave: noop, onClear: noop, width: 310, height: 160 }],
      ['company-profile.tsx:755 (none)', { initialPaths: undefined, onSave: noop, onClear: noop, width: 340, height: 160 }],
    ];
    for (const [label, props] of configs) {
      const a = render(<SignaturePad {...(props as object)} />);
      const current = norm(a.toJSON(), true);
      if (Original) {
        const b = render(<Original {...props} />);
        const original = norm(b.toJSON(), false);
        expect(current).toEqual(original);
        printed[label] = digest(original);
        b.unmount();
      }
      currentDigests[label] = digest(current);
      // The one intended delta: the Svg never takes the touch.
      const svgHosts = findAll(a.toJSON(), (n) => /^RNSVG/.test(n.type) && 'pointerEvents' in n.props);
      expect(svgHosts.length).toBeGreaterThan(0);
      expect(svgHosts.every((n) => n.props.pointerEvents === 'none')).toBe(true);
      a.unmount();
    }
    // With the original at hand, its digests must be the pinned ones (the diff prints fresh ones).
    if (Original) expect(printed).toEqual(ORIGINAL_DIGESTS);
    // Portable: every current tree matches the ORIGINAL's pinned digest.
    expect(currentDigests).toEqual(ORIGINAL_DIGESTS);
  };

  const stepP8 = () => { // P8 StrictMode: one release commits exactly one stroke
    const onChange = jest.fn();
    const r = render(
      <React.StrictMode>
        <SignaturePad testID="pad" onChange={onChange} />
      </React.StrictMode>,
    );
    const canvas = r.getByTestId('pad') as unknown as { props: Handlers };
    stroke(canvas, [[5, 5], [6, 7]]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(findAll(r.toJSON(), isInk)).toHaveLength(1);
    r.unmount();
  };

  // ONE test on purpose (see __tests__/smoke/glide-dots.test.tsx): in this harness a
  // second `it` that renders after the first one's cleanup never commits its first
  // render. Inside one test, with each tree unmounted explicitly, every render commits.
  it('P1-P8 locationX strokes, no-start zone, lock, onChange, legacy chrome, coordinate space, original tree, StrictMode', () => {
    stepP1();
    stepP2();
    stepP3();
    stepP4();
    stepP5();
    stepP6();
    stepP7();
    stepP8();
  });
});
