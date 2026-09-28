/**
 * Wave-next W2, lane ESTOOLS — the moments primitives' own words in the
 * pseudo-locale. The slide's Cancel segment and the signing ceremony's chip,
 * placeholder and Clear come back bracketed (i18n/pseudo.ts) when the display
 * language is 'xx'; the caller's own props (label, srConfirm, names) are the
 * caller's, not checked here. English is covered, unchanged, by the
 * moments-capsule and moments-signline smokes.
 */
import React, { useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, configure, fireEvent, render } from '@testing-library/react-native';
import { SlideToConfirm } from '@/components/moments/SlideToConfirm';
import { SigningCeremony, type SigningCeremonyProps } from '@/components/moments/signing/SigningCeremony';
import { pseudoize } from '@/i18n/pseudo';
import { setLang } from '@/i18n/core';

configure({ defaultIncludeHiddenElements: true });

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});
jest.mock('react-native-gesture-handler', () => {
  const State = { UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5 };
  function PanGestureHandler(props: { children: React.ReactNode }) { return props.children; }
  return { __esModule: true, State, PanGestureHandler };
});
jest.mock('@/utils/moments/haptics', () => ({ momentHaptic: jest.fn(), announce: jest.fn() }));

jest.useFakeTimers();

async function advance(ms: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}

function Ceremony() {
  const [name, setName] = useState('Omir Majeed');
  const [paths, setPaths] = useState<string[]>([]);
  const props: SigningCeremonyProps = {
    signer: 'gc', mode: 'drawn', method: 'drawn', parties: 2, signedBefore: 0, sealVerb: 'SIGNED',
    top: { title: 'Construction contract', subtitle: 'Kitchen remodel', rows: [] },
    name: { value: name, onChange: setName, label: 'Your full legal name', minLength: 2 },
    role: 'Contractor', paths, onPathsChange: setPaths,
    copy: { label: 'Slide along the line to sign and send', srLabel: 'Sign and send the contract', srConfirm: 'Confirm sign and send', sealedAnnounce: 'Signed', sentAnnounce: 'Signed and sent' },
    write: async () => ({ status: 'confirmed', title: 'Signed' }),
    writeOptions: { idempotent: false },
    recordFrom: () => ({ signedAtIso: '2026-09-27T18:41:00.000Z', timeSource: 'device', name: 'Omir Majeed' }),
    testID: 'cer',
  } as SigningCeremonyProps;
  return <SigningCeremony {...props} />;
}

describe('ESTOOLS — moments primitives in the pseudo-locale', () => {
  afterEach(() => { setLang('en'); });

  it('the slide\'s Cancel segment is bracketed', async () => {
    (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockImplementation(() => Promise.resolve(true));
    setLang('xx');
    const u = render(
      <SlideToConfirm label="Slide to approve · +$4,200.00" busyLabel="Approving…" srLabel="Approve" srConfirm="Confirm approve"
        writeOptions={{ idempotent: false }} testID="slide" onCommit={async () => ({ status: 'confirmed', title: 'Approved' })} />,
    );
    fireEvent(u.getByTestId('slide-track'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 64 } } });
    await advance(10);
    await act(async () => { fireEvent(u.getByTestId('slide-rail'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } }); });
    await advance(300);
    expect(u.getByTestId('slide-cancel').props.accessibilityLabel).toBe(pseudoize('Cancel'));
    expect(u.getAllByText(pseudoize('Cancel')).length).toBeGreaterThan(0);
    expect(u.queryByText('Cancel')).toBeNull();
  });

  it('the ceremony\'s chip, placeholder and busy line are bracketed', async () => {
    (AccessibilityInfo.isScreenReaderEnabled as jest.Mock).mockImplementation(() => Promise.resolve(false));
    setLang('xx');
    const u = render(<Ceremony />);
    await advance(10);
    expect(u.getAllByText(pseudoize('Awaiting your signature')).length).toBeGreaterThan(0);
    expect(u.getAllByText(pseudoize('Sign here')).length).toBeGreaterThan(0);
    expect(u.getAllByText(pseudoize('Signing…')).length).toBeGreaterThan(0);
    for (const plain of ['Awaiting your signature', 'Sign here', 'Signing…']) expect(u.queryByText(plain)).toBeNull();
  });
});
