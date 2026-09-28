/**
 * The signing ceremony (moments / SIGNLINE, spec section 11 smokes).
 *
 *  L1 readiness order (offline, sign, name, consent) is named under the line;
 *     focusing the name changes colour only (an overlay ring, no layout shift).
 *  L2 a homeowner signer ignores a prefilled name.
 *  L3 consent without a version renders no checkbox.
 *  L4 method 'paper' renders null.
 *  L5 confirmed, GC first of 2: the seal carries the ring text built from the
 *     stored record, the count "1 of 2" and no check; then the letter folds and
 *     the sent card reads "Sent to Jane Smith" and the preview's body copy.
 *  L6 closing signer: the check draws and onBinding fires once; chip "Binding".
 *  L7 refused: the reason shows under the line, the pad unlocks, the paths are
 *     unchanged, no seal is mounted.
 *  L8 timeout (a non-idempotent write that never answers): "No answer yet.
 *     Check the contract before trying again." and no seal.
 *  L9 Android: the fold is the cross-fade (no rotateX anywhere).
 *  L10 Reduce Motion: the seal still lands; the success haptic fires once.
 *  L11 legal: a write that answers 'queued' never shows a seal and shows the
 *      refused copy.
 *  L12 HandoffTurn: the hand-off announces; on Android it cross-fades (no
 *      rotateY), on iOS the faces carry rotateY.
 *  L13 the chip never claims a send it cannot know: fold.sent false reads
 *      "Signed · Email not sent" (card "Signed. Email not sent."), no fold
 *      reads "Signed · awaiting countersignature"; the name row prints the
 *      STORED name once sealed; a recordFrom that throws still lands the
 *      confirmed state (verb-only seal, pad locked).
 *  L14 the line skin's GESTURE path (no screen reader): a disabled line keeps
 *      the head's handler off; no pad stroke can START anywhere in the head's
 *      grab area or the line zone [106, padH] (one can above it); a head drag
 *      past the threshold seals; after a refusal the label comes back once the
 *      reason clears on the next touch (Reduce Motion, where values are set),
 *      fading in rather than popping; once the line is disabled (offline), the
 *      readiness step replaces a stale reason.
 *
 * The commit is driven through the screen-reader path (the capsule's one
 * button + Confirm segment), the same state machine the drag feeds.
 */

import React, { useState } from 'react';
import { Animated, Platform, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import { SigningCeremony, type SigningCeremonyProps } from '@/components/moments/signing/SigningCeremony';
import { SealStamp } from '@/components/moments/signing/SealStamp';
import SignaturePad from '@/components/SignaturePad';
import { TwoLegCheck } from '@/components/moments/core/contract';
import { buildSealRingText } from '@/utils/moments/sealText';
import type { CommitResult } from '@/utils/moments/commitResult';
import { momentHaptic, announce } from '@/utils/moments/haptics';
import { HandoffTurn, useHandoffTurn, type HandoffTurnControl } from '@/components/moments/signing/HandoffTurn';
import { PanGestureHandler } from 'react-native-gesture-handler';
import { padHeightFor } from '@/utils/moments/signTimeline';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});
let mockReduced = false;
jest.mock('@/components/ui/motion', () => ({
  ...jest.requireActual('@/components/ui/motion'),
  reducedMotion: () => mockReduced,
  useReducedMotion: () => mockReduced,
}));
let mockSR = true;
jest.mock('@/components/moments/core/useScreenReaderMode', () => ({ useScreenReaderMode: () => mockSR }));
jest.mock('@/utils/moments/haptics', () => ({ momentHaptic: jest.fn(), announce: jest.fn() }));

const ISO = '2026-09-27T18:41:00.000Z';
const INK = ['M10.0,20.0 L40.0,30.0 L80.0,25.0'];
const ID = 'cer';

type Over = Partial<SigningCeremonyProps> & { initialName?: string; consentVersion?: string; consentChecked?: boolean };

function Harness(o: Over) {
  const [name, setName] = useState(o.initialName ?? 'Omir Majeed');
  const [checked, setChecked] = useState(o.consentChecked ?? false);
  const [paths, setPaths] = useState<string[]>(o.paths ?? INK);
  const props: SigningCeremonyProps = {
    signer: 'gc',
    mode: 'drawn',
    method: 'drawn',
    parties: 2,
    signedBefore: 0,
    sealVerb: 'SIGNED',
    top: { title: 'Construction contract', subtitle: 'Kitchen remodel · 14 Elm Street', rows: [{ label: 'Contract total', value: '$48,200.00', mono: true }] },
    name: { value: name, onChange: (v) => { setName(v); o.name?.onChange(v); }, label: 'Your full legal name', minLength: 2 },
    role: 'Contractor',
    paths,
    onPathsChange: (p) => { setPaths(p); o.onPathsChange?.(p); },
    copy: {
      label: 'Slide along the line to sign and send',
      srLabel: 'Sign and send the contract',
      srConfirm: 'Confirm sign and send',
      sealedAnnounce: 'Signed. Sending to Jane Smith',
      sentAnnounce: 'Contract signed and sent to Jane Smith',
    },
    write: async () => ({ status: 'confirmed', title: 'Signed' }),
    writeOptions: { idempotent: false, subject: 'the contract', verb: 'signed' },
    recordFrom: () => ({ signedAtIso: ISO, timeSource: 'device', name: 'Omir Majeed' }),
    testID: ID,
    ...o,
    consent: o.consentVersion !== undefined
      ? { version: o.consentVersion, text: 'I agree to sign electronically.', linkLabel: 'Read the disclosure', checked, onChange: setChecked }
      : o.consent,
  } as SigningCeremonyProps;
  // keep controlled values from the harness state
  props.name = { ...props.name, value: name };
  props.paths = paths;
  return <SigningCeremony {...props} />;
}

const layout = (w: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: w, height: 56 } } });
async function flush(ms: number, step = 50) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => {
      jest.advanceTimersByTime(step);
    });
  }
}
function mountLaidOut(el: React.ReactElement) {
  const r = render(el);
  act(() => {
    fireEvent(r.getByTestId(`${ID}-card`), 'layout', layout(352));
    fireEvent(r.getByTestId(`${ID}-under`), 'layout', layout(352));
  });
  return r;
}
async function slideToSign(r: ReturnType<typeof render>) {
  fireEvent.press(r.getByTestId(`${ID}-sr`));
  await flush(300);
  fireEvent.press(r.getByTestId(`${ID}-sr-confirm`));
}
const labelText = (r: ReturnType<typeof render>) => {
  const n = r.getByTestId(`${ID}-label`);
  return ([] as unknown[]).concat(n.props.children).join('');
};
const val = (v: unknown) => (v as { __getValue: () => number }).__getValue();
function transforms(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => transforms(n, out)); return out; }
  const el = node as { props?: Record<string, unknown>; children?: unknown[] };
  const st = el.props?.style ? (StyleSheet.flatten(el.props.style as StyleProp<ViewStyle>) as Record<string, unknown>) : null;
  if (st?.transform) out.push(JSON.stringify(st.transform));
  (el.children ?? []).forEach((c) => transforms(c, out));
  return out;
}


let turnCtl: HandoffTurnControl | null = null;
function Turn() {
  const c = useHandoffTurn();
  turnCtl = c;
  return (
    <HandoffTurn
      control={c}
      front={<Text>Hand the phone to Jane Smith</Text>}
      back={<Text>Jane, review and sign</Text>}
      testID="turn"
    />
  );
}

describe('SigningCeremony', () => {
  // ONE test on purpose (see __tests__/smoke/glide-dots.test.tsx): in this
  // harness a second `it` that renders after the first one's cleanup never
  // commits its first render. Every tree is unmounted explicitly.
  it('L1-L13 readiness, name, consent, paper, seal, binding, refused, timeout, android, reduce motion, queued, hand-off turn, honest chip', async () => {
    jest.useFakeTimers();
    const haptic = momentHaptic as jest.Mock;
    const timing = jest.spyOn(Animated, 'timing');
    const drivenTo = (v: unknown, to: number) => timing.mock.calls.some((c) => c[0] === v && (c[1] as { toValue: number }).toValue === to);

    // ── L1 readiness order; the X stays ──
    {
      const r = mountLaidOut(<Harness offline paths={[]} initialName="" consentVersion="contract-gc-esign-1" />);
      expect(labelText(r)).toBe("You're offline. Signing needs a connection.");
      expect(r.getByText('X', { includeHiddenElements: true })).toBeTruthy();
      r.rerender(<Harness paths={[]} initialName="" consentVersion="contract-gc-esign-1" />);
      expect(labelText(r)).toBe('Sign above the line');
      r.unmount();
      const r2 = mountLaidOut(<Harness initialName="" consentVersion="contract-gc-esign-1" />);
      expect(labelText(r2)).toBe('Type your full legal name');
      // Focusing the name changes colour only: the box keeps its 1 pt border and
      // every layout property, and the accent ring is an overlay (no shift).
      const boxAtRest = StyleSheet.flatten(r2.getByTestId(`${ID}-name-box`).props.style) as Record<string, unknown>;
      expect(r2.queryByTestId(`${ID}-name-ring`)).toBeNull();
      fireEvent(r2.getByTestId(`${ID}-name`), 'focus');
      expect(StyleSheet.flatten(r2.getByTestId(`${ID}-name-box`).props.style)).toEqual(boxAtRest);
      expect(boxAtRest.borderWidth).toBe(1);
      const ring = StyleSheet.flatten(r2.getByTestId(`${ID}-name-ring`).props.style) as Record<string, unknown>;
      expect(ring.position).toBe('absolute');
      expect(ring.borderWidth).toBe(1.5);
      fireEvent(r2.getByTestId(`${ID}-name`), 'blur');
      expect(r2.queryByTestId(`${ID}-name-ring`)).toBeNull();
      fireEvent.changeText(r2.getByTestId(`${ID}-name`), 'Omir Majeed');
      expect(labelText(r2)).toBe('Check the consent box');
      fireEvent.press(r2.getByTestId(`${ID}-consent`));
      expect(labelText(r2)).toBe('Slide along the line to sign and send');
      expect(r2.getByText('X', { includeHiddenElements: true })).toBeTruthy();
      r2.unmount();
    }

    // ── L2 a homeowner signer ignores a prefilled name ──
    {
      const onName = jest.fn();
      const r = mountLaidOut(
        <Harness signer="homeowner" role="Homeowner" initialName="Jane Smith" name={{ value: '', onChange: onName, label: 'Full legal name', minLength: 2 }} />,
      );
      expect(r.getByTestId(`${ID}-name`).props.value).toBe('');
      expect(onName).toHaveBeenCalledWith('');
      expect(labelText(r)).toBe('Type your full legal name');
      r.unmount();
    }

    // ── L3 consent without a version: no checkbox ──
    {
      const r = mountLaidOut(<Harness consentVersion="   " />);
      expect(r.queryByTestId(`${ID}-consent`)).toBeNull();
      expect(r.queryByRole('checkbox')).toBeNull();
      r.unmount();
      const withVersion = mountLaidOut(<Harness consentVersion="contract-gc-esign-1" />);
      expect(withVersion.getByRole('checkbox')).toBeTruthy();
      withVersion.unmount();
    }

    // ── L4 paper renders null ──
    {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const r = render(<Harness method={'paper' as unknown as SigningCeremonyProps['method']} />);
      expect(r.toJSON()).toBeNull();
      warn.mockRestore();
      r.unmount();
    }

    // ── L5 confirmed, GC first of 2: seal text from the record, "1 of 2", no check, then the fold ──
    {
      haptic.mockClear();
      const r = mountLaidOut(<Harness fold={{ to: 'Jane Smith', email: 'jane.smith@example.com' }} />);
      expect(r.UNSAFE_queryAllByType(SealStamp)).toHaveLength(0);
      expect(r.queryByText('Sent to Jane Smith')).toBeNull();
      await slideToSign(r);
      expect(r.UNSAFE_getByType(SignaturePad).props.locked).toBe(true);
      expect(r.UNSAFE_queryAllByType(SealStamp)).toHaveLength(0);
      await flush(1700);
      const seal = r.UNSAFE_getByType(SealStamp);
      expect(seal.props.ringText).toBe(buildSealRingText({ verb: 'SIGNED', method: 'drawn', signedAtIso: ISO }));
      expect(seal.props.ringText).not.toMatch(/MAGE ID/);
      expect(r.getByText('1 of 2', { includeHiddenElements: true })).toBeTruthy();
      // Native-driven values do not tick under jest: prove the check legs were
      // never DRIVEN (no timing to 1 on either leg of the seal's check).
      const checks = seal.findAllByType(TwoLegCheck);
      expect(checks.every((c: { props: Record<string, unknown> }) => val(c.props.short) === 0 && val(c.props.long) === 0)).toBe(true);
      expect(checks.some((c: { props: Record<string, unknown> }) => drivenTo(c.props.short, 1) || drivenTo(c.props.long, 1))).toBe(false);
      expect(haptic.mock.calls.filter((c) => c[0] === 'success')).toHaveLength(1);
      expect(r.getByTestId(`${ID}-record`)).toBeTruthy();
      await flush(2200);
      expect(r.getByText('Sent to Jane Smith')).toBeTruthy();
      // The approved preview's copy, without guessing the signer's pronoun.
      expect(r.getByText('They counter-sign from their portal link. The contract is binding when they sign.')).toBeTruthy();
      expect(r.queryByTestId(`${ID}-name`)).toBeNull();
      const card = StyleSheet.flatten(r.getByTestId(`${ID}-card`).props.style) as Record<string, unknown>;
      expect(card.height).toBe(208);
      expect(r.getByText('Sent · awaiting Jane Smith')).toBeTruthy();
      r.unmount();
      await flush(200);
    }

    // ── L6 closing signer: check drawn, onBinding once, chip "Binding" ──
    {
      const onBinding = jest.fn();
      const r = mountLaidOut(<Harness signer="homeowner" role="Homeowner" method="in_person" signedBefore={1} initialName="" onBinding={onBinding} />);
      fireEvent.changeText(r.getByTestId(`${ID}-name`), 'Jane Smith');
      await slideToSign(r);
      await flush(2000);
      const seal = r.UNSAFE_getByType(SealStamp);
      expect(seal.props.ringText.startsWith('SIGNED IN PERSON · ')).toBe(true);
      const drawn = seal.findAllByType(TwoLegCheck).some((c: { props: Record<string, unknown> }) => drivenTo(c.props.short, 1) && drivenTo(c.props.long, 1));
      expect(drawn).toBe(true);
      expect(onBinding).toHaveBeenCalledTimes(1);
      expect(r.getByText('Binding')).toBeTruthy();
      r.unmount();
      await flush(200);
    }

    // ── L7 refused: reason under the line, pad unlocked, paths kept, no seal ──
    {
      const onPaths = jest.fn();
      const reason = 'Not recorded. This contract changed on another device.';
      const r = mountLaidOut(<Harness onPathsChange={onPaths} write={async () => ({ status: 'refused', reason }) as CommitResult} />);
      await slideToSign(r);
      await flush(2000);
      expect(r.getByText(reason)).toBeTruthy();
      expect(r.UNSAFE_getByType(SignaturePad).props.locked).toBe(false);
      expect(onPaths).not.toHaveBeenCalled();
      expect(r.UNSAFE_getByType(SignaturePad).props.initialPaths).toEqual(INK);
      expect(r.UNSAFE_queryAllByType(SealStamp)).toHaveLength(0);
      r.unmount();
      await flush(200);
    }

    // ── L8 timeout: a non-idempotent write that never answers ──
    {
      const r = mountLaidOut(<Harness write={() => new Promise<CommitResult>(() => {})} />);
      await slideToSign(r);
      await flush(21500, 250);
      expect(r.getByText('No answer yet. Check the contract before trying again.')).toBeTruthy();
      expect(r.queryByText(/nothing was saved/i)).toBeNull();
      expect(r.UNSAFE_queryAllByType(SealStamp)).toHaveLength(0);
      expect(r.UNSAFE_getByType(SignaturePad).props.locked).toBe(false);
      r.unmount();
      await flush(200);
    }

    // ── L9 Android: the fold is the cross-fade (no rotateX anywhere) ──
    {
      const restore = jest.replaceProperty(Platform, 'OS', 'android');
      const r = mountLaidOut(<Harness fold={{ to: 'Jane Smith', email: 'jane.smith@example.com' }} />);
      await slideToSign(r);
      await flush(4000);
      expect(r.getByText('Sent to Jane Smith')).toBeTruthy();
      const all = transforms(r.toJSON());
      expect(all.some((t) => /rotateX/.test(t))).toBe(false);
      r.unmount();
      restore.restore();
      await flush(200);
    }

    // ── L10 Reduce Motion: the seal still lands, success haptic once ──
    {
      mockReduced = true;
      haptic.mockClear();
      const r = mountLaidOut(<Harness parties={1} sealVerb="SIGNED ON SITE" />);
      await slideToSign(r);
      await flush(2000);
      expect(r.UNSAFE_getAllByType(SealStamp)).toHaveLength(1);
      expect(r.getByTestId(`${ID}-record`)).toBeTruthy();
      expect(haptic.mock.calls.filter((c) => c[0] === 'success')).toHaveLength(1);
      expect(r.getByText('Locked')).toBeTruthy();
      r.unmount();
      mockReduced = false;
      await flush(200);
    }

    // ── L11 legal: a 'queued' answer never seals and shows the refused copy ──
    {
      const r = mountLaidOut(<Harness write={async () => ({ status: 'queued' }) as CommitResult} />);
      await slideToSign(r);
      await flush(2000);
      expect(r.getByText('Not signed. Signing needs a connection, so nothing was signed.')).toBeTruthy();
      expect(r.UNSAFE_queryAllByType(SealStamp)).toHaveLength(0);
      r.unmount();
      await flush(200);
    }

    // ── L13 honest chip, stored name, a recordFrom that throws ──
    {
      // Email failed after the signature stored: never "Sent".
      const a = mountLaidOut(<Harness fold={{ to: 'Jane Smith', email: 'jane.smith@example.com', sent: false }} />);
      await slideToSign(a);
      await flush(4000);
      expect(a.getByText('Signed. Email not sent.')).toBeTruthy();
      expect(a.getByText('Share the link instead.')).toBeTruthy();
      expect(a.getByText('Signed · Email not sent')).toBeTruthy();
      expect(a.queryByText(/^Sent/)).toBeNull();
      a.unmount();
      await flush(200);

      // No fold (signed in person before the hand-off): nothing claims a send.
      const b = mountLaidOut(<Harness />);
      await slideToSign(b);
      await flush(2500);
      expect(b.getByText('Signed · awaiting countersignature')).toBeTruthy();
      expect(b.queryByText(/^Sent/)).toBeNull();
      b.unmount();
      await flush(200);

      // The name row prints the STORED name once sealed, not the live field.
      const c = mountLaidOut(
        <Harness parties={1} recordFrom={() => ({ signedAtIso: ISO, timeSource: 'device', name: 'Omir A. Majeed' })} />,
      );
      expect(c.getByText('Omir Majeed · Contractor')).toBeTruthy();
      await slideToSign(c);
      await flush(2000);
      expect(c.getByText('Omir A. Majeed · Contractor')).toBeTruthy();
      expect(c.queryByText('Omir Majeed · Contractor')).toBeNull();
      c.unmount();
      await flush(200);

      // A recordFrom that throws still lands on the confirmed state: verb-only seal, locked pad, typed name kept.
      const d = mountLaidOut(
        <Harness parties={1} recordFrom={() => { throw new Error('malformed record'); }} />,
      );
      await slideToSign(d);
      await flush(2000);
      const seal = d.UNSAFE_getByType(SealStamp);
      expect(seal.props.ringText).toBe('SIGNED · ');
      expect(d.getByTestId(`${ID}-record`)).toBeTruthy();
      expect(d.UNSAFE_getByType(SignaturePad).props.locked).toBe(true);
      expect(d.getByText('Omir Majeed · Contractor')).toBeTruthy();
      expect(d.getByText('Locked')).toBeTruthy();
      d.unmount();
      await flush(200);
    }

    // ── L12 HandoffTurn: iOS turns with rotateY; Android cross-fades ──
    {
      (announce as jest.Mock).mockClear();
      const r = render(<Turn />);
      expect(transforms(r.toJSON()).some((t) => /rotateY/.test(t))).toBe(true);
      await act(async () => { void turnCtl!.turn('back', 'Ready for Jane Smith to sign'); });
      await flush(700);
      expect(announce).toHaveBeenCalledWith('Ready for Jane Smith to sign');
      expect(turnCtl!.side).toBe('back');
      r.unmount();
      const restore = jest.replaceProperty(Platform, 'OS', 'android');
      const a = render(<Turn />);
      expect(transforms(a.toJSON()).some((t) => /rotateY/.test(t))).toBe(false);
      await act(async () => { void turnCtl!.turn('back'); });
      await flush(300);
      expect(turnCtl!.side).toBe('back');
      expect(transforms(a.toJSON()).some((t) => /rotateY/.test(t))).toBe(false);
      a.unmount();
      restore.restore();
    }

    // ── L14 line skin, gesture path (no screen reader) ──
    {
      mockSR = false;
      const head = (r: ReturnType<typeof render>) => r.UNSAFE_getByType(PanGestureHandler).props as {
        enabled: boolean; hitSlop: number; onHandlerStateChange: (e: unknown) => void;
      };
      // Disabled (no ink yet): the head is hidden and its handler is off; no SR button.
      const d = mountLaidOut(<Harness paths={[]} />);
      expect(head(d).enabled).toBe(false);
      expect(d.queryByTestId(`${ID}-sr`)).toBeNull();
      d.unmount();

      const r = mountLaidOut(<Harness parties={1} />);
      expect(head(r).enabled).toBe(true);
      expect(head(r).hitSlop).toBe(12);
      // The pad: nothing that could reach the line zone (110) or the head's
      // grab area (118 - 12 = 106) may start a stroke; above it, a stroke may.
      const pad = r.getByTestId(`${ID}-pad`);
      const starts = (x: number, y: number) =>
        pad.props.onStartShouldSetResponder({ nativeEvent: { locationX: x, locationY: y, touches: [], changedTouches: [] } }) as boolean;
      const padH = padHeightFor(352);
      const startable: string[] = [];
      for (let y = 106; y <= padH; y += 1) for (const x of [0, 8, 40, 176, 344, 352]) if (starts(x, y)) startable.push(`${x},${y}`);
      expect(startable).toEqual([]);
      expect(starts(40, 60)).toBe(true);
      expect(starts(40, 105)).toBe(true);
      // A head flick (T = 352 - 40 - 40 = 272; 200 pt at 2000 pt/s projects past T) commits and seals.
      act(() => { head(r).onHandlerStateChange({ nativeEvent: { state: 2 } }); });
      act(() => { head(r).onHandlerStateChange({ nativeEvent: { state: 5, translationX: 200, velocityX: 2000 } }); });
      await flush(2500);
      expect(r.UNSAFE_getAllByType(SealStamp)).toHaveLength(1);
      expect(r.UNSAFE_getByType(SignaturePad).props.locked).toBe(true);
      r.unmount();
      await flush(200);

      // Refused, then the next touch clears the reason: the label is back (not stuck at 0).
      mockReduced = true;
      const reason = 'Not recorded. This contract changed on another device.';
      const f = mountLaidOut(<Harness write={async () => ({ status: 'refused', reason }) as CommitResult} />);
      act(() => { head(f).onHandlerStateChange({ nativeEvent: { state: 2 } }); });
      act(() => { head(f).onHandlerStateChange({ nativeEvent: { state: 5, translationX: 200, velocityX: 2000 } }); });
      await flush(2500);
      expect(f.getByText(reason)).toBeTruthy();
      expect(f.queryByTestId(`${ID}-label`)).toBeNull();
      act(() => { head(f).onHandlerStateChange({ nativeEvent: { state: 2 } }); });
      act(() => { head(f).onHandlerStateChange({ nativeEvent: { state: 5, translationX: 0, velocityX: 0 } }); });
      // Reduce Motion: just after the reason's 140 ms fade-out the label is back, whole.
      await flush(150);
      expect(f.queryByText(reason)).toBeNull();
      expect(labelText(f)).toBe('Slide along the line to sign and send');
      const shown = StyleSheet.flatten(f.getByTestId(`${ID}-label`).props.style) as Record<string, unknown>;
      expect(Number(shown.opacity)).toBeGreaterThan(0.9);
      f.unmount();
      await flush(200);

      // Full motion: when the reason clears, the label fades IN from 0 over
      // reasonIn (200 ms); it does not pop in at full opacity. Native-driven
      // tweens do not advance under jest, so the label reads 0 here and the
      // tween to 1 is what is pinned (on the suite's call-through timing spy).
      mockReduced = false;
      const m = mountLaidOut(<Harness write={async () => ({ status: 'refused', reason }) as CommitResult} />);
      act(() => { head(m).onHandlerStateChange({ nativeEvent: { state: 2 } }); });
      act(() => { head(m).onHandlerStateChange({ nativeEvent: { state: 5, translationX: 200, velocityX: 2000 } }); });
      await flush(2500);
      expect(m.getByText(reason)).toBeTruthy();
      const before = timing.mock.calls.length;
      act(() => { head(m).onHandlerStateChange({ nativeEvent: { state: 2 } }); });
      act(() => { head(m).onHandlerStateChange({ nativeEvent: { state: 5, translationX: 0, velocityX: 0 } }); });
      await flush(150);
      expect(m.queryByText(reason)).toBeNull();
      expect(labelText(m)).toBe('Slide along the line to sign and send');
      const mShown = StyleSheet.flatten(m.getByTestId(`${ID}-label`).props.style) as Record<string, unknown>;
      expect(Number(mShown.opacity)).toBe(0);
      const fadeIn = timing.mock.calls.slice(before).filter((c) => {
        const cfg = c[1] as { toValue: number; duration: number };
        return cfg.toValue === 1 && cfg.duration === 200 && (c[0] as unknown as { __getValue: () => number }).__getValue() === 0;
      });
      expect(fadeIn).toHaveLength(1);
      m.unmount();
      mockReduced = true;
      await flush(200);

      // A stale failure reason never hides the readiness step: refused, then the
      // line goes offline, so the slot reads the offline step, not the old reason.
      const refusedWrite = async () => ({ status: 'refused', reason }) as CommitResult;
      const o = mountLaidOut(<Harness write={refusedWrite} />);
      act(() => { head(o).onHandlerStateChange({ nativeEvent: { state: 2 } }); });
      act(() => { head(o).onHandlerStateChange({ nativeEvent: { state: 5, translationX: 200, velocityX: 2000 } }); });
      await flush(2500);
      expect(o.getByText(reason)).toBeTruthy();
      o.rerender(<Harness write={refusedWrite} offline />);
      await flush(100);
      expect(o.queryByText(reason)).toBeNull();
      expect(labelText(o)).toBe("You're offline. Signing needs a connection.");
      o.unmount();
      mockReduced = false;
      mockSR = true;
      await flush(200);
    }

    // The Animated import keeps the value helper honest across versions.
    expect(typeof Animated.Value).toBe('function');
    jest.useRealTimers();
  });
});
