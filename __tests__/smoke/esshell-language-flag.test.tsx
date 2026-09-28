/**
 * Spanish Phase 1b, W3 ESSHELL — each sub's lineup text in the SUB's language,
 * proven with Spanish switched ON.
 *
 * LANGUAGE_PICKER_ENABLED is false in i18n/flags.ts until the bilingual review,
 * so every golden runs with it off and shows none of this. Here the flag module
 * is mocked ON to prove what the flag gates:
 *   - /tomorrow-lineup: a sub marked Spanish gets usted Spanish, a sub with no
 *     language gets the English it always got; the per-row "Send in" override
 *     redrafts that sub's text; "Save for this sub" appears only when the
 *     override differs from the record, and writes the record; Send opens
 *     Messages with the Spanish body (still "Se abrió…", never "Sent").
 *   - /subs: the editor's Language row (English / Español endonyms, Not set)
 *     saves preferredLanguage on the sub.
 * The app itself stays in English (the device user's language is not the
 * sub's).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { world } from '@/__tests__/fixtures/world';
import { toCalendarDayString } from '@/utils/calendarDate';
import type { Project } from '@/types';

jest.mock('@/i18n/flags', () => ({ LANGUAGE_PICKER_ENABLED: true, AUTO_DETECT_DEVICE: false, PSEUDO_LOCALE_IN_DEV: true }));

const mockShare = jest.fn(async (_opts: { message: string }) => 'shared' as const);
jest.mock('@/utils/shareText', () => ({
  shareText: (opts: { message: string }) => mockShare(opts),
  canShare: () => true,
}));

const TODAY = toCalendarDayString(new Date());
const A = 'sub-es-1';
const B = 'sub-es-2';
const P = 'proj-es-1';

const task = (o: Record<string, unknown>) => ({ phase: '', progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o });
const project = {
  ...(world.project as unknown as Record<string, unknown>),
  id: P, name: 'Main St Reno', location: '123 Main St',
  schedule: {
    id: `${P}-s`, name: 'Main schedule', projectId: P, startDate: TODAY, workingDaysPerWeek: 7, bufferDays: 0,
    totalDurationDays: 10, criticalPathDays: 10, laborAlignmentScore: 0, riskItems: [],
    tasks: [
      task({ id: 't-hang', title: 'Hang board', startDay: 2, durationDays: 1, assignedSubId: A }),
      task({ id: 't-rough', title: 'Electrical rough', startDay: 2, durationDays: 1, assignedSubId: B }),
    ],
  },
} as unknown as Project;
const baseSub = { contactName: '', email: '', address: '', licenseNumber: '', licenseExpiry: '', coiExpiry: '', w9OnFile: true, bidHistory: [], assignedProjects: [], notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const subs = [
  { ...baseSub, id: A, companyName: 'Acme Drywall', phone: '(555) 800-0001', trade: 'Drywall', preferredLanguage: 'es' },
  { ...baseSub, id: B, companyName: 'Bolt Electric', phone: '(555) 800-0002', trade: 'Electrical' },
];

async function mount(url: string) {
  await primeWorld('empty');
  await AsyncStorage.setItem('mageid_projects', JSON.stringify([project]));
  await AsyncStorage.setItem('mageid_subcontractors', JSON.stringify(subs));
  const tree = await mountRouteChecked(url);
  for (let i = 0; i < 4; i++) {
    await act(async () => { try { jest.advanceTimersByTime(300); } catch { /* real timers */ } for (let k = 0; k < 20; k++) await Promise.resolve(); });
  }
  return tree;
}
const flush = async () => { await act(async () => { for (let k = 0; k < 20; k++) await Promise.resolve(); }); };
const draft = (id: string) => screen.getByTestId(`lineup-draft-${id}`).props.value as string;
const storedSub = async (id: string) => (JSON.parse((await AsyncStorage.getItem('mageid_subcontractors')) ?? '[]') as { id: string; preferredLanguage?: string | null }[]).find(s => s.id === id);

beforeEach(() => { mockShare.mockClear(); allowConsoleErrors(); });

describe('Spanish switched on: the lineup goes out in each sub\'s language', () => {
  it('a Spanish sub gets usted Spanish, a sub with no language gets the same English, the app stays English', async () => {
    await mount(`/tomorrow-lineup?projectId=${P}`);
    const es = draft(A);
    expect(es.startsWith('Acme Drywall: mañana (')).toBe(true);
    expect(es).toContain('Hang board');
    expect(es.endsWith('Responda para confirmar que estará ahí.')).toBe(true);
    expect(es).not.toMatch(/\b\d{1,2}\/\d{1,2}\b/);
    const en = draft(B);
    expect(en.startsWith('Bolt Electric: tomorrow (')).toBe(true);
    expect(en.endsWith("Reply to confirm you'll be there.")).toBe(true);
    // The screen's own words stay in the device user's language.
    expect(screen.getAllByText(/Tomorrow's lineup/).length).toBeGreaterThan(0);
  });

  it('the "Send in" override redrafts one sub; "Save for this sub" shows only when it differs, and writes the record', async () => {
    await mount(`/tomorrow-lineup?projectId=${P}`);
    expect(screen.getByTestId(`lineup-lang-${A}`)).toBeTruthy();
    expect(screen.queryByTestId(`lineup-lang-save-${A}`)).toBeNull();

    await act(async () => { fireEvent.press(screen.getByTestId(`lineup-lang-${A}-en`)); });
    expect(draft(A).endsWith("Reply to confirm you'll be there.")).toBe(true);
    // The override does not touch the record by itself.
    expect((await storedSub(A))?.preferredLanguage).toBe('es');
    expect(screen.getByTestId(`lineup-lang-save-${A}`)).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByTestId(`lineup-lang-${B}-es`)); });
    expect(draft(B).endsWith('Responda para confirmar que estará ahí.')).toBe(true);

    await act(async () => { fireEvent.press(screen.getByTestId(`lineup-lang-save-${A}`)); });
    await flush();
    expect((await storedSub(A))?.preferredLanguage).toBe('en');
    expect(screen.queryByTestId(`lineup-lang-save-${A}`)).toBeNull();
  });

  it('Send opens Messages with the Spanish body; the row says it opened, never that it was sent', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Linking } = require('react-native') as typeof import('react-native');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      await mount(`/tomorrow-lineup?projectId=${P}`);
      const body = draft(A);
      await act(async () => { fireEvent.press(screen.getByTestId(`lineup-send-${A}`)); });
      expect(openURL).toHaveBeenCalledTimes(1);
      const url = String(openURL.mock.calls[0][0]);
      expect(decodeURIComponent(url.slice(url.indexOf('body=') + 5))).toBe(body);
      expect(screen.getByTestId(`lineup-status-${A}`).props.children).toBe('Opened in Messages');
    } finally {
      openURL.mockRestore();
    }
  });
});

describe('Spanish switched on: the sub editor\'s Language row', () => {
  it('saves the chosen language on a new sub; "Not set" is the default', async () => {
    await mount('/subs');
    await act(async () => { fireEvent.press(screen.getByTestId('add-sub')); });
    await flush();
    expect(screen.getByTestId('sub-language-row')).toBeTruthy();
    expect(screen.getByText('Used for texts we send them.')).toBeTruthy();
    expect(screen.getByTestId('sub-language-unset').props.accessibilityState).toEqual({ selected: true });
    fireEvent.changeText(screen.getByTestId('sub-company-input'), 'Cruz Tile');
    await act(async () => { fireEvent.press(screen.getByTestId('sub-language-es')); });
    await act(async () => { fireEvent.press(screen.getByTestId('save-sub')); });
    await flush();
    const all = JSON.parse((await AsyncStorage.getItem('mageid_subcontractors')) ?? '[]') as { companyName: string; preferredLanguage?: string | null }[];
    expect(all.find(s => s.companyName === 'Cruz Tile')?.preferredLanguage).toBe('es');
  });
});
