/**
 * Spanish Phase 1b, W3 ESTICKET — a crew member's language (app/crew.tsx
 * CrewLanguageRow), proven with the flag ON and OFF.
 *
 * LANGUAGE_PICKER_ENABLED is false in i18n/flags.ts until the bilingual
 * review, so every golden runs with it off. Here the flag module is mocked
 * both ways (a getter the tests flip) to prove what it gates:
 *   - OFF: the row renders NOTHING (the crew goldens stay byte-identical).
 *   - ON:  "Language" with Not set / English / Español; a tap hands the
 *          choice up ('es', 'en', or null for Not set); the hint says what
 *          it is for.
 *   - ON in Spanish: the label, Not set and the hint are Spanish; the two
 *          endonyms stay as themselves (English / Español) in every language.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { setLang } from '@/i18n/core';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

// The flag is read where it is used (babel's import interop reads the
// module property at call time), so a getter flips it per test without a
// second React (jest.isolateModules would load one).
const mockFlag = { on: false };
jest.mock('@/i18n/flags', () => ({
  get LANGUAGE_PICKER_ENABLED() { return mockFlag.on; },
  AUTO_DETECT_DEVICE: false,
  PSEUDO_LOCALE_IN_DEV: true,
}));

// eslint-disable-next-line import/first
import { CrewLanguageRow as Row } from '@/app/crew';

function loadRow(flagOn: boolean): typeof Row {
  mockFlag.on = flagOn;
  return Row;
}

afterEach(() => { setLang('en'); });

describe('crew member language row (W3 ESTICKET)', () => {
  it('flag OFF: renders nothing', () => {
    const Row = loadRow(false);
    const r = render(<Row value="es" onChange={jest.fn()} testID="crew-edit-language" />);
    expect(r.toJSON()).toBeNull();
    expect(r.queryByTestId('crew-edit-language')).toBeNull();
    expect(r.queryByText('Language')).toBeNull();
    r.unmount();
  });

  it('flag ON: Not set / English / Español, and a tap hands the choice up', () => {
    const Row = loadRow(true);
    const onChange = jest.fn();
    const r = render(<Row value={null} onChange={onChange} testID="crew-edit-language" />);
    expect(r.getByTestId('crew-edit-language')).toBeTruthy();
    expect(r.getByText('Language')).toBeTruthy();
    expect(r.getByText('Not set')).toBeTruthy();
    expect(r.getByText('English')).toBeTruthy();
    expect(r.getByText('Español')).toBeTruthy();
    expect(r.getByText('Used for texts and invites we send them.')).toBeTruthy();
    // Not set is the selected chip for a NULL language (never guessed).
    expect(r.getByTestId('crew-edit-language-none').props.accessibilityState).toMatchObject({ selected: true });
    expect(r.getByTestId('crew-edit-language-es').props.accessibilityState).toMatchObject({ selected: false });
    fireEvent.press(r.getByTestId('crew-edit-language-es'));
    expect(onChange).toHaveBeenLastCalledWith('es');
    fireEvent.press(r.getByTestId('crew-edit-language-en'));
    expect(onChange).toHaveBeenLastCalledWith('en');
    fireEvent.press(r.getByTestId('crew-edit-language-none'));
    expect(onChange).toHaveBeenLastCalledWith(null);
    r.unmount();
  });

  it('flag ON, app in Spanish: Spanish words, endonyms unchanged', () => {
    const Row = loadRow(true);
    setLang('es');
    const r = render(<Row value="es" onChange={jest.fn()} testID="crew-edit-language" />);
    expect(r.getByText('Idioma')).toBeTruthy();
    expect(r.getByText('Sin definir')).toBeTruthy();
    expect(r.getByText('Se usa para los mensajes e invitaciones que le enviamos.')).toBeTruthy();
    expect(r.getByText('English')).toBeTruthy();
    expect(r.getByText('Español')).toBeTruthy();
    expect(r.getByTestId('crew-edit-language-es').props.accessibilityState).toMatchObject({ selected: true });
    r.unmount();
  });
});
