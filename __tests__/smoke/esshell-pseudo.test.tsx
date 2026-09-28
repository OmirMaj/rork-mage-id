/**
 * Spanish Phase 1b, W3 ESSHELL — the pseudo-locale pass ('xx'), mounted in the
 * real app. Every string this lane extracted comes back [bracketed]; plain
 * ASCII left on screen was never extracted. Covers the lineup screen and its
 * per-sub send row (Spanish switched on so the row renders), and Home's TODAY
 * ON SITE rows. Data (names, phones, task titles, dates, numbers) is exempt.
 * Clipping at 390 pt needs a device: listed as a device check.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { world } from '@/__tests__/fixtures/world';
import { toCalendarDayString } from '@/utils/calendarDate';
import { setLang } from '@/i18n/core';
import { pseudoize } from '@/i18n/pseudo';
import type { Project } from '@/types';

jest.mock('@/i18n/flags', () => ({ LANGUAGE_PICKER_ENABLED: true, AUTO_DETECT_DEVICE: false, PSEUDO_LOCALE_IN_DEV: true }));

const TODAY = toCalendarDayString(new Date());
const A = 'sub-px-1';
const P = 'proj-px-1';
const task = (o: Record<string, unknown>) => ({ phase: '', progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o });
const project = {
  ...(world.project as unknown as Record<string, unknown>),
  id: P, name: 'Main St Reno', location: '123 Main St',
  schedule: {
    id: `${P}-s`, name: 'Main schedule', projectId: P, startDate: TODAY, workingDaysPerWeek: 7, bufferDays: 0,
    totalDurationDays: 10, criticalPathDays: 10, laborAlignmentScore: 0, riskItems: [],
    tasks: [
      task({ id: 't-hang', title: 'Hang board', startDay: 1, durationDays: 3, assignedSubId: A }),
      task({ id: 't-clean', title: 'Site clean-up', startDay: 2, durationDays: 1 }),
    ],
  },
} as unknown as Project;
const subs = [{ id: A, companyName: 'Acme Drywall', contactName: '', phone: '(555) 800-0001', email: '', address: '', trade: 'Drywall', licenseNumber: '', licenseExpiry: '', coiExpiry: '', w9OnFile: true, bidHistory: [], assignedProjects: [], notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', preferredLanguage: 'es' }];

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

/** The slice of a test-renderer node this needs. */
interface Node { type: unknown; props: { children?: unknown }; findAll(pred: (n: Node) => boolean): Node[] }

/** Every string child of every host Text under `root`, joined per Text. */
function texts(root: Node): string[] {
  return root.findAll((n: Node) => n.type === 'Text').map((n: Node) => {
    const kids = ([] as unknown[]).concat(n.props.children ?? []);
    return kids.filter(k => typeof k === 'string' || typeof k === 'number').join('');
  }).filter((s: string) => s.trim().length > 0);
}

beforeEach(() => { allowConsoleErrors(); });
afterEach(() => { act(() => { setLang('en'); }); });

describe('pseudo-locale pass (xx)', () => {
  it('the lineup screen: every extracted string is bracketed, only data is plain', async () => {
    await mount(`/tomorrow-lineup?projectId=${P}`);
    // After the mount: the LanguageProvider's hydration settles the language first.
    await act(async () => { setLang('xx'); for (let k = 0; k < 10; k++) await Promise.resolve(); });
    const screenRoot = screen.getByTestId('lineup-screen');
    const DATA = /^(Main St Reno|Acme Drywall|\(555\) 800-0001|Español|English|Hang board|Site clean-up|123 Main St)$/;
    const plain = texts(screenRoot).filter(s => /[A-Za-z]{2,}/.test(s) && !s.includes('[') && !DATA.test(s.trim()));
    expect(plain).toEqual([]);
    // The per-sub send row and the gap sentence are there, bracketed.
    expect(texts(screenRoot)).toContain(pseudoize('Send in:'));
    expect(texts(screenRoot).some(s => s.startsWith('[') && s.includes('Site clean-up'))).toBe(true);
  });

  it("Home's TODAY ON SITE header is bracketed", async () => {
    await mount('/(tabs)/(home)');
    await act(async () => { setLang('xx'); for (let k = 0; k < 10; k++) await Promise.resolve(); });
    const all = texts(screen.UNSAFE_root);
    expect(all.some(s => s.startsWith(pseudoize('TODAY ON SITE')))).toBe(true);
    expect(all.some(s => /^TODAY ON SITE/.test(s))).toBe(false);
    // The phone tab bar (bottom tabs, iOS): its labels are bracketed too.
    expect(all).toContain(pseudoize('Settings'));
    expect(all).toContain(pseudoize('Projects'));
    expect(all).not.toContain('Settings');
  });

});
