/**
 * Spanish Phase 1b, W3 ESTICKET — the pseudo-locale pass ('xx', docs/I18N.md
 * §11) on the field ticket's signing sheet and the crew Language row.
 *
 * In 'xx' every extracted string renders accented and [bracketed]. Any plain
 * ASCII word left on screen was never extracted; any bracket cut off would be
 * a truncation. The only plain text allowed is DATA the test itself passes in
 * (the ticket label, the work summary, the amount, the date) and the two
 * language endonyms (kept as themselves on purpose).
 *
 * English is untouched by this file: setLang('xx') is reset after each test.
 */

import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { setLang } from '@/i18n/core';
import { PSEUDO_OPEN, PSEUDO_CLOSE } from '@/i18n/pseudo';
import { SignatureModal as TicketSignSheet } from '@/app/field-ticket';
import type { CommitResult } from '@/utils/moments/commitResult';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});
jest.mock('@/components/moments/core/useScreenReaderMode', () => ({ useScreenReaderMode: () => true }));
jest.mock('@/utils/moments/haptics', () => ({ momentHaptic: jest.fn(), announce: jest.fn() }));

const mockFlag = { on: true };
jest.mock('@/i18n/flags', () => ({
  get LANGUAGE_PICKER_ENABLED() { return mockFlag.on; },
  AUTO_DETECT_DEVICE: false,
  PSEUDO_LOCALE_IN_DEV: true,
}));

// eslint-disable-next-line import/first
import { CrewLanguageRow } from '@/app/crew';

afterEach(() => { act(() => { setLang('en'); }); });

/** Every rendered Text's joined string. */
function texts(r: ReturnType<typeof render>): string[] {
  return r.UNSAFE_getAllByType(Text)
    .map(n => {
      const c = n.props.children;
      const flat = (Array.isArray(c) ? c : [c]).flat(Infinity);
      return flat.filter(x => typeof x === 'string' || typeof x === 'number').join('');
    })
    .filter(s => /[A-Za-z]/.test(s));
}

/** Plain ASCII words left after removing pseudo segments and allowed data. */
function unextracted(all: string[], allowed: string[]): string[] {
  return all.filter(s => {
    if (s.includes(PSEUDO_OPEN)) {
      // A pseudo string must close its bracket (no truncation) and carry no plain word outside allowed data.
      if (!s.includes(PSEUDO_CLOSE)) return true;
      let rest = s;
      for (const a of allowed) rest = rest.split(a).join('');
      rest = rest.replace(/\[[^\]]*\]/g, '');
      return /[A-Za-z]{2,}/.test(rest);
    }
    return !allowed.some(a => s === a || s.trim() === a);
  });
}

describe('pseudo-locale pass (W3 ESTICKET)', () => {
  it('the field ticket signing sheet: every word extracted, every bracket closed', () => {
    act(() => { setLang('xx'); });
    const r = render(
      <TicketSignSheet
        visible
        amount={1240}
        summary="Broke out footing"
        ticketLabel="FT-12"
        workDate="2026-09-27"
        offline={false}
        onClose={jest.fn()}
        onSign={async (): Promise<CommitResult> => ({ status: 'refused', reason: 'x' })}
        onDone={jest.fn()}
        onLateResult={jest.fn()}
        recordFrom={() => ({ signedAtIso: '2026-09-27T12:00:00.000Z', timeSource: 'device', name: '' })}
      />,
    );
    const all = texts(r);
    expect(all.length).toBeGreaterThan(5);
    // Allowed: the data this test passes in, the ceremony's own date stamp (a
    // date, formatted by the primitive) and the line's "X" mark. "Sign above
    // the line" used to be the one leftover; since 2026-10-02 (LOOSE e) the
    // line reasons go through t() (common.moment.line*), so it is bracketed
    // like everything else on the sheet.
    const PRIMITIVE_LEFTOVERS: string[] = [];
    const left = unextracted(all, ['FT-12', 'Broke out footing', '$1,240.00', 'Sep 27, 2026', 'CM', 'X', ...PRIMITIVE_LEFTOVERS])
      .filter(s => !/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(s));
    expect(left).toEqual([]);
    r.unmount();
  });

  it('the crew Language row: bracketed words, endonyms as themselves', () => {
    act(() => { setLang('xx'); });
    const r = render(<CrewLanguageRow value={null} onChange={jest.fn()} testID="crew-edit-language" />);
    const all = texts(r);
    expect(all).toEqual(expect.arrayContaining(['English', 'Español']));
    expect(unextracted(all, ['English', 'Español'])).toEqual([]);
    r.unmount();
  });
});
