/**
 * Moments Step 0 (lane MOMSTEP0): the primitive follow-ups, rendered.
 *
 *  P1 SlideToConfirm: a legal slide offline shows the site's own offline
 *     sentence (writeOptions.copy.offline); without it the default is
 *     byte-identical ("You're offline. Signing needs a connection.").
 *  P2 SlideToConfirm: a reason-less refusal shows writeOptions.copy.refused
 *     (a whole sentence), never the English frame.
 *  P3 SlideToConfirm: a write that answers after the timeout shows the
 *     site's timeout sentence first, then hands the late confirmed answer to
 *     onLateResult (exactly once) without replaying it on the track.
 *  P4 SigningCeremony: `above` renders, locks with the pad from commit start
 *     until the un-commit, and onCommitStart / onUncommit fire once each.
 *  P5 SigningCeremony: isNeutral -> no seal, no success haptic, the plain
 *     record line reads the result's title, the pad stays locked.
 *  P6 SigningCeremony: onLateResult receives a late confirmed answer.
 *
 * Driven through the screen-reader path (one button + Confirm), the same
 * state machine the drag feeds. ONE `it` on purpose (see the note in
 * __tests__/smoke/moments-signline.test.tsx).
 */

import React, { useState } from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { act, configure, fireEvent, render } from '@testing-library/react-native';
import { SlideToConfirm, type SlideToConfirmProps } from '@/components/moments/SlideToConfirm';
import { SigningCeremony, type SigningCeremonyProps } from '@/components/moments/signing/SigningCeremony';
import { SealStamp } from '@/components/moments/signing/SealStamp';
import SignaturePad from '@/components/SignaturePad';
import type { CommitResult } from '@/utils/moments/commitResult';
import { offlineLegalReason } from '@/utils/moments/commitResult';
import { momentHaptic } from '@/utils/moments/haptics';

configure({ defaultIncludeHiddenElements: true });

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});
jest.mock('@/components/ui/motion', () => ({
  ...jest.requireActual('@/components/ui/motion'),
  reducedMotion: () => false,
  useReducedMotion: () => false,
}));
jest.mock('@/components/moments/core/useScreenReaderMode', () => ({ useScreenReaderMode: () => true }));
jest.mock('@/utils/moments/haptics', () => ({ momentHaptic: jest.fn(), announce: jest.fn() }));

jest.useFakeTimers();

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

const SLIDE_COPY = {
  refused: 'No aprobada. Algo falló de nuestro lado.',
  timeout: 'Todavía sin respuesta. Revisa la OC 4 antes de volver a intentar.',
  legalQueued: 'Not certified. Certifying needs a connection, so nothing was certified.',
  offline: offlineLegalReason('certifying'),
};

function mountSlide(props: Partial<SlideToConfirmProps>) {
  const u = render(
    <SlideToConfirm
      label="Slide to certify · $86,310.00"
      busyLabel="Certifying…"
      srLabel="Certify pay app 6, $86,310.00"
      srConfirm="Confirm certify · $86,310.00"
      writeOptions={{ idempotent: false, copy: SLIDE_COPY }}
      onCommit={async () => ({ status: 'confirmed', title: 'Pay app #6 certified · $86,310.00' })}
      testID="slide"
      {...props}
    />,
  );
  fireEvent(u.getByTestId('slide-track'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 64 } } });
  return u;
}

async function slideConfirm(u: ReturnType<typeof render>) {
  await act(async () => {
    fireEvent(u.getByTestId('slide-rail'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  });
  await advance(300);
  fireEvent.press(u.getByTestId('slide-confirm'));
}

const ID = 'cer';
const ISO = '2026-09-27T18:41:00.000Z';

function Ceremony(o: Partial<SigningCeremonyProps>) {
  const [name, setName] = useState('Pat Rivera');
  const [paths, setPaths] = useState<string[]>(['M10.0,20.0 L40.0,30.0 L80.0,25.0']);
  const props: SigningCeremonyProps = {
    signer: 'authorizer',
    mode: 'drawn',
    method: 'drawn',
    parties: 1,
    signedBefore: 0,
    sealVerb: 'SIGNED ON SITE',
    top: { title: 'Field ticket FT-12', rows: [{ label: 'Total', value: '$1,240.00', mono: true }] },
    name: { value: name, onChange: setName, label: 'Full legal name', minLength: 2 },
    role: "Owner's rep",
    paths,
    onPathsChange: setPaths,
    copy: { label: 'Slide along the line to sign · $1,240.00', srLabel: 'Sign FT-12', srConfirm: 'Confirm sign FT-12', sealedAnnounce: 'FT-12 signed' },
    write: async () => ({ status: 'confirmed', title: 'FT-12 signed · $1,240.00' }),
    writeOptions: { idempotent: false, copy: { refused: 'Not signed. Something went wrong on our side. The signature is kept.', timeout: 'No answer yet. Check FT-12 before trying again.', legalQueued: 'Not signed. Signing needs a connection, so nothing was signed.' } },
    recordFrom: () => ({ signedAtIso: ISO, timeSource: 'device', name: 'Pat Rivera' }),
    testID: ID,
    ...o,
  } as SigningCeremonyProps;
  props.name = { ...props.name, value: name };
  props.paths = paths;
  return <SigningCeremony {...props} />;
}

const layout = (w: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: w, height: 56 } } });
function mountCeremony(el: React.ReactElement) {
  const r = render(el);
  act(() => {
    fireEvent(r.getByTestId(`${ID}-card`), 'layout', layout(352));
    fireEvent(r.getByTestId(`${ID}-under`), 'layout', layout(352));
  });
  // A non-GC signer's name is never prefilled: the signer types it.
  fireEvent.changeText(r.getByTestId(`${ID}-name`), 'Pat Rivera');
  return r;
}
async function sign(r: ReturnType<typeof render>) {
  fireEvent.press(r.getByTestId(`${ID}-sr`));
  await advance(300);
  fireEvent.press(r.getByTestId(`${ID}-sr-confirm`));
}
const aboveEvents = (r: ReturnType<typeof render>) => r.getByTestId(`${ID}-above`).props.pointerEvents;

describe('moments Step 0 primitives', () => {
  it('P1-P6 offline sentence, whole-sentence refusal, late results, above slot, commit callbacks, neutral resolve', async () => {
    (AccessibilityInfo.isScreenReaderEnabled as jest.Mock | undefined)?.mockImplementation?.(() => Promise.resolve(true));
    const haptic = momentHaptic as jest.Mock;

    // ── P1 the site's offline sentence; the default unchanged ──
    {
      const u = mountSlide({ writeOptions: { idempotent: false, legal: true, copy: SLIDE_COPY }, offline: true });
      await advance(10);
      expect(u.getByTestId('slide-label').props.children).toBe("You're offline. Certifying needs a connection.");
      u.unmount();
      const d = mountSlide({ writeOptions: { idempotent: false, legal: true }, offline: true });
      await advance(10);
      expect(d.getByTestId('slide-label').props.children).toBe("You're offline. Signing needs a connection.");
      d.unmount();
    }

    // ── P2 a reason-less refusal speaks the site's whole sentence ──
    {
      const u = mountSlide({ onCommit: async () => ({ status: 'refused' } as unknown as CommitResult) });
      await advance(10);
      await slideConfirm(u);
      await advance(3000);
      expect(u.getByTestId('slide-reason').props.children).toBe(SLIDE_COPY.refused);
      u.unmount();
    }

    // ── P3 timeout sentence, then the late confirmed answer to onLateResult once ──
    {
      let answer!: (r: CommitResult) => void;
      const late = jest.fn();
      const u = mountSlide({
        writeOptions: { idempotent: false, copy: SLIDE_COPY, timeoutMs: 1000 },
        onCommit: () => new Promise<CommitResult>((res) => { answer = res; }),
        onLateResult: late,
      });
      await advance(10);
      await slideConfirm(u);
      await advance(2500);
      expect(u.getByTestId('slide-reason').props.children).toBe(SLIDE_COPY.timeout);
      expect(late).not.toHaveBeenCalled();
      await act(async () => { answer({ status: 'confirmed', title: 'Pay app #6 certified · $86,310.00' }); });
      await advance(50);
      expect(late).toHaveBeenCalledTimes(1);
      expect(late.mock.calls[0][0]).toMatchObject({ status: 'confirmed', title: 'Pay app #6 certified · $86,310.00' });
      expect(u.queryByTestId('slide-result')?.props.children).not.toBe('Pay app #6 certified · $86,310.00');
      u.unmount();
    }

    // ── P4 above locks with the pad; onCommitStart / onUncommit fire once each ──
    {
      const start = jest.fn();
      const uncommit = jest.fn();
      const r = mountCeremony(
        <Ceremony
          above={<Text testID="role-chips">Owner&apos;s rep</Text>}
          onCommitStart={start}
          onUncommit={uncommit}
          write={async () => ({ status: 'refused', reason: 'Not signed. Something went wrong on our side. The signature is kept.' })}
        />,
      );
      await advance(10);
      expect(r.getByTestId('role-chips')).toBeTruthy();
      expect(aboveEvents(r)).toBe('auto');
      await sign(r);
      await advance(20);
      expect(start).toHaveBeenCalledTimes(1);
      expect(aboveEvents(r)).toBe('none');
      await advance(3000);
      expect(uncommit).toHaveBeenCalledTimes(1);
      expect(uncommit.mock.calls[0][0]).toMatchObject({ status: 'refused' });
      expect(aboveEvents(r)).toBe('auto');
      expect(r.UNSAFE_queryAllByType(SealStamp)).toHaveLength(0);
      r.unmount();
    }

    // ── P5 isNeutral: no seal, no success haptic, a plain record line ──
    {
      haptic.mockClear();
      const r = mountCeremony(
        <Ceremony
          write={async () => ({ status: 'confirmed', title: 'Already signed on the portal. Nothing was changed.' })}
          isNeutral={(res) => res.title.startsWith('Already signed')}
        />,
      );
      await advance(10);
      await sign(r);
      await advance(3000);
      expect(r.UNSAFE_queryAllByType(SealStamp)).toHaveLength(0);
      expect(r.getByTestId(`${ID}-neutral`).props.children).toBe('Already signed on the portal. Nothing was changed.');
      expect(r.queryByTestId(`${ID}-record`)).toBeNull();
      expect(haptic.mock.calls.filter((c) => c[0] === 'success')).toHaveLength(0);
      expect(r.UNSAFE_getByType(SignaturePad).props.locked).toBe(true);
      r.unmount();
      // …and the same answer without isNeutral seals as before.
      const s = mountCeremony(<Ceremony write={async () => ({ status: 'confirmed', title: 'FT-12 signed · $1,240.00' })} />);
      await advance(10);
      await sign(s);
      await advance(3000);
      expect(s.UNSAFE_queryAllByType(SealStamp)).toHaveLength(1);
      expect(s.queryByTestId(`${ID}-neutral`)).toBeNull();
      s.unmount();
    }

    // ── P6 the ceremony hands a late confirmed answer to onLateResult ──
    {
      let answer!: (r: CommitResult) => void;
      const late = jest.fn();
      const r = mountCeremony(
        <Ceremony
          writeOptions={{ idempotent: false, timeoutMs: 1000, copy: { refused: 'Not signed. Something went wrong on our side. The signature is kept.', timeout: 'No answer yet. Check FT-12 before trying again.', legalQueued: 'Not signed. Signing needs a connection, so nothing was signed.' } }}
          write={() => new Promise<CommitResult>((res) => { answer = res; })}
          onLateResult={late}
        />,
      );
      await advance(10);
      await sign(r);
      await advance(2500);
      expect(r.UNSAFE_queryAllByType(SealStamp)).toHaveLength(0);
      await act(async () => { answer({ status: 'confirmed', title: 'FT-12 signed · $1,240.00' }); });
      await advance(50);
      expect(late).toHaveBeenCalledTimes(1);
      expect(r.UNSAFE_queryAllByType(SealStamp)).toHaveLength(0);
      r.unmount();
    }
  });
});
