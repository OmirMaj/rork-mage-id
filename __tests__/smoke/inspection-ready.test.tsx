/**
 * Inspection Ready (step 2, lane L3) — BEHAVIOUR ONLY, no snapshot.
 *
 * The golden fixture job (Portland, OR) has no inspection in the next three
 * days, so every existing phone golden renders nothing new. This file adds
 * two permits to the populated world and drives the real job page:
 *
 *   - a permit on the fixture job, booked for Rough electrical two days after
 *     the golden day, with the jurisdiction spelled out in full;
 *   - a permit on ANOTHER job with the same authority, carrying a failed
 *     history row whose inspector note must come back verbatim.
 *
 * On the FREE tier (the recall group is Pro): the card shows "Get ready for
 * Rough electrical", the sheet shows the verbatim note, the fixed disclaimer
 * and the Pro line, and Fail + notes + Save files a failed row with those
 * notes on the permit history.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { PREP_DISCLAIMER } from '@/utils/inspectionPrep';
import { RECALL_NEEDS_PRO } from '@/components/inspectionPrep/InspectionReadySheet';
import { decodePermitInspectionNotes, encodePermitInspectionNotes } from '@/utils/permitInspectionHistory';
import type { Permit } from '@/types';

const AUTH = 'City of Portland Bureau of Development Services';
const NOTE = 'Missing bonding jumper at water heater';
const FAIL_NOTE = 'No AFCI on bedroom circuits';

// The golden day, pinned in BOTH realms the way the phone goldens pin it:
// renderRouter's fake timers start from the OUTER realm's Date.now.
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T15:00:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;

/** The golden day + n, as a LOCAL calendar day. */
function goldenDayPlus(n: number): string {
  const g = new OuterDate(GOLDEN_CLOCK);
  const d = new OuterDate(g.getFullYear(), g.getMonth(), g.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const READY_ID = 'permit-ready-l3';
const HISTORY_ID = 'permit-history-l3';

async function seedPermits() {
  const raw = JSON.parse((await AsyncStorage.getItem('mageid_permits')) ?? '[]');
  const list: Permit[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  const ready: Permit = {
    id: READY_ID,
    projectId: PROJECT_ID,
    projectName: 'Fixture job',
    type: 'electrical',
    permitNumber: 'ELE-26-09999',
    jurisdiction: AUTH,
    status: 'inspection_scheduled',
    phase: 'Rough electrical',
    appliedDate: goldenDayPlus(-30),
    inspectionDate: goldenDayPlus(2),
    fee: 250,
  };
  const history: Permit = {
    id: HISTORY_ID,
    projectId: '99999999-9999-4999-8999-999999999999',
    projectName: 'Maple St',
    type: 'electrical',
    permitNumber: 'ELE-25-01111',
    jurisdiction: AUTH,
    status: 'inspection_passed',
    appliedDate: goldenDayPlus(-200),
    inspectionDate: goldenDayPlus(-150),
    inspectionNotes: encodePermitInspectionNotes('', [{
      id: 'row-failed-1',
      name: 'Rough electrical',
      scheduledFor: goldenDayPlus(-160),
      result: 'failed',
      notes: NOTE,
      recordedAt: '2026-04-18T15:00:00.000Z',
    }]),
    fee: 250,
  };
  const next = [...list.filter((p) => p.id !== READY_ID && p.id !== HISTORY_ID), ready, history];
  await AsyncStorage.setItem('mageid_permits', JSON.stringify(Array.isArray(raw) ? next : { ...raw, data: next }));
}

async function storedPermit(id: string): Promise<Permit | undefined> {
  const raw = JSON.parse((await AsyncStorage.getItem('mageid_permits')) ?? '[]');
  const list: Permit[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  return list.find((p) => p.id === id);
}

beforeEach(async () => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
  allowConsoleErrors();
  await primeWorld('populated');
  // The free tier: groups 1-2 and Pass/Fail must work with no AI at all.
  await AsyncStorage.setItem('mageid_subscription_tier', 'free');
  await seedPermits();
});

afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
});

test('the job page offers Inspection Ready, quotes his inspector, and files a Fail on the permit', async () => {
  await mountRouteChecked(`/project-detail?id=${PROJECT_ID}`);
  await settle();

  const rows = screen.getAllByText('Get ready for Rough electrical');
  expect(rows.length).toBeGreaterThan(0);

  await act(async () => { fireEvent.press(rows[0]); });
  await settle();

  // The verbatim inspector note, inside the quote line the facts module built.
  expect(screen.getAllByText(new RegExp(`"${NOTE}"`)).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/From your inspection record · /).length).toBeGreaterThan(0);
  // The fixed disclaimer — a constant, not model text.
  expect(screen.getByTestId('inspection-prep-disclaimer').props.children).toBe(PREP_DISCLAIMER);
  // Free tier: the recall group says it needs Pro.
  expect(screen.getByText(RECALL_NEEDS_PRO)).toBeTruthy();

  // Fail + what the inspector wrote + Save.
  await act(async () => { fireEvent.press(screen.getByTestId('inspection-prep-fail')); });
  await act(async () => { fireEvent.changeText(screen.getByTestId('inspection-prep-notes'), FAIL_NOTE); });
  await act(async () => { fireEvent.press(screen.getByTestId('inspection-prep-save')); });
  await settle();

  expect(screen.getByTestId('inspection-prep-saved').props.children)
    .toMatch(/^Saved to the ELE-26-09999 permit history\. Next time City of Portland Bureau of Development Services inspects your work, this note leads the list\.$/);

  const saved = await storedPermit(READY_ID);
  expect(saved?.status).toBe('inspection_failed');
  const rowsAfter = decodePermitInspectionNotes(saved?.inspectionNotes).inspections;
  const failed = rowsAfter.find((r) => r.result === 'failed' && r.scheduledFor === goldenDayPlus(2));
  expect(failed?.notes).toBe(FAIL_NOTE);
  expect(failed?.name).toBe('Rough electrical');
  // The other job's history is untouched.
  const other = await storedPermit(HISTORY_ID);
  expect(decodePermitInspectionNotes(other?.inspectionNotes).inspections[0]?.notes).toBe(NOTE);
});
