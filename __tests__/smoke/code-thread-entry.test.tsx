/**
 * Step 3, lane L4 — the Code Thread's entry points and action buttons,
 * mounted on the real screens (no snapshots).
 *
 *  - the job page shows "Code checks" (codethread-project-card), and a saved
 *    check seeded into mageid_code_checks shows as its row;
 *  - the plan viewer's header carries "Code check this sheet"
 *    (codethread-entry-plan);
 *  - a saved check whose record already holds the punch action shows 'Added'
 *    and no 'Punch item' button (the saved-check sheet hosts the real
 *    CodeThreadActions);
 *  - "Add to Permits" cannot land twice: two confirms in one tick make one
 *    permit and one recorded action, and the button becomes 'Added'.
 */
import { Alert, Dimensions, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID, PORTAL_TOKEN, SMOKE_USER } from '@/__tests__/fixtures/world';
import type { CodeCheckRecord } from '@/utils/codeThread/types';
import * as codeThreadStore from '@/utils/codeThread/store';

let restoreOS: (() => void) | null = null;
function phone() {
  restoreOS?.();
  restoreOS = jest.replaceProperty(Platform, 'OS', 'ios').restore;
  Dimensions.set({
    window: { width: 390, height: 844, scale: 2, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 2, fontScale: 1 },
  });
}

beforeEach(() => {
  jest.useRealTimers();
  allowConsoleErrors();
});
afterEach(() => {
  restoreOS?.();
  restoreOS = null;
  jest.restoreAllMocks();
});

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

const BAG = new URLSearchParams({ projectId: PROJECT_ID, id: PROJECT_ID, estimateId: ESTIMATE_ID, t: PORTAL_TOKEN }).toString();
const CHECK_ID = 'check-l4-1';

function record(over: Partial<CodeCheckRecord> = {}): CodeCheckRecord {
  return {
    id: CHECK_ID,
    projectId: PROJECT_ID,
    createdAt: '2026-09-20T15:00:00.000Z',
    updatedAt: '2026-09-20T15:00:00.000Z',
    source: { kind: 'project' },
    category: 'deck',
    categoryLabel: 'Decks & porches',
    scenario: 'New 12x16 deck off the kitchen',
    address: '1 Main St, Queens, NY',
    answers: [{ questionId: 'q1', question: 'Height above grade?', answer: 'About 4 ft' }],
    followUps: [],
    grounding: {
      authority: 'NYC Department of Buildings',
      codes: '2022 NYC Building Code',
      checkedOn: '2026-09-20',
      grounded: true,
      chipLabel: 'Grounded · NYC DOB · 2022 NYC BC',
      buildingRecordKind: 'not_checked',
      buildingRecordHeadline: null,
      departmentName: null,
      jobDataSent: ['address', 'project type'],
    },
    result: {
      summary: 'Guards are required above 30 inches.\nFooting depth per frost line.',
      applicableCodes: [{ code: 'BC', section: '1015.2', requirement: 'Guards where the drop exceeds 30 in.' }],
      permitsRequired: ['Alteration permit for the deck'],
      inspections: ['Footing inspection'],
      commonViolations: ['Missing guard on the stair landing'],
    },
    disclaimer: 'Verify with the authority having jurisdiction.',
    recallNote: 'Run on Sep 20 against the data then on file.',
    actions: [],
    ...over,
  };
}

async function seedChecks(recs: CodeCheckRecord[]) {
  await AsyncStorage.setItem('mageid_code_checks', JSON.stringify({ [PROJECT_ID]: recs }));
}

async function jobPage(recs: CodeCheckRecord[] = []) {
  phone();
  await primeWorld('populated');
  await seedChecks(recs);
  const tree = await mountRouteChecked(`/project-detail?${BAG}`);
  await pump();
  return tree;
}

describe('L4 — the job page shows Code checks', () => {
  jest.setTimeout(120000);

  it('renders the card with no saved checks, saying where they would live', async () => {
    await jobPage();
    const card = screen.getByTestId('codethread-project-card');
    expect(within(card).getByText('Code checks')).toBeTruthy();
    expect(within(card).getByText(/^No saved checks yet\./)).toBeTruthy();
    expect(within(card).getByText('Saved on this device until you sign out.')).toBeTruthy();
  });

  it('a seeded saved check shows its date · category · jurisdiction · edition and its first summary line', async () => {
    await jobPage([record()]);
    const card = screen.getByTestId('codethread-project-card');
    expect(within(card).getByText('Sep 20, 2026 · Decks & porches · NYC Department of Buildings · 2022 NYC Building Code')).toBeTruthy();
    expect(within(card).getByText('Guards are required above 30 inches.')).toBeTruthy();
  });

  it('a done punch action shows Added and no second Punch item button', async () => {
    await jobPage([record({
      actions: [{ kind: 'punch', section: 'violations', index: 0, createdId: 'punch-x', at: '2026-09-21T12:00:00.000Z' }],
    })]);
    fireEvent.press(screen.getByTestId(`codethread-check-row-${CHECK_ID}`));
    await pump(3);
    const sheet = screen.getByTestId('codethread-saved-sheet');
    expect(within(sheet).getByText('Verify with the authority having jurisdiction.')).toBeTruthy();
    const actions = within(sheet).getByTestId('codethread-actions-violations-0');
    expect(within(actions).getByText('Added to the punch list (internal)')).toBeTruthy();
    expect(within(actions).queryByText('Punch item')).toBeNull();
    // The RFI keeps its own done state: still offered.
    expect(within(actions).getByText('Ask the architect (RFI)')).toBeTruthy();
  });

  it('"Add to Permits" cannot land twice', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const recordSpy = jest.spyOn(codeThreadStore, 'recordCodeThreadAction');
    await jobPage([record()]);
    fireEvent.press(screen.getByTestId(`codethread-check-row-${CHECK_ID}`));
    await pump(3);
    const actions = screen.getByTestId('codethread-actions-permits-0');
    fireEvent.press(within(actions).getByText('Add to Permits'));
    const call = alert.mock.calls.find((c) => c[0] === 'Add to Permits');
    expect(call?.[1]).toBe('Add this permit to your tracker? It starts as Applied in the tracker. Update the status and date when you actually file.');
    const add = (call?.[2] ?? []).find((b) => b.text === 'Add');
    // Two confirms in the same tick: the busy guard lets one through.
    await act(async () => { add?.onPress?.(); add?.onPress?.(); });
    await pump(3);
    expect(within(screen.getByTestId('codethread-actions-permits-0')).getByText('Added to your permit tracker')).toBeTruthy();
    expect(within(screen.getByTestId('codethread-actions-permits-0')).queryByText('Add to Permits')).toBeNull();
    // One add, one recorded action (the store dedups on disk, so count the calls).
    expect(recordSpy.mock.calls.filter((c) => c[2].kind === 'permit')).toHaveLength(1);
    const permits = JSON.parse((await AsyncStorage.getItem('mageid_permits')) ?? '[]') as { notes?: string }[];
    expect(permits.filter((p) => (p.notes ?? '').startsWith('Alteration permit for the deck'))).toHaveLength(1);
    const stored = JSON.parse((await AsyncStorage.getItem('mageid_code_checks')) ?? '{}') as Record<string, CodeCheckRecord[]>;
    expect(stored[PROJECT_ID][0].actions.filter((a) => a.kind === 'permit')).toHaveLength(1);
  });

  it('a second queued confirm (web AlertHost) cannot add a second permit after the first finishes', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const recordSpy = jest.spyOn(codeThreadStore, 'recordCodeThreadAction');
    await jobPage([record()]);
    fireEvent.press(screen.getByTestId(`codethread-check-row-${CHECK_ID}`));
    await pump(3);
    // Two presses before any re-render: two confirms queued, both holding the same stale closure.
    const btn = within(screen.getByTestId('codethread-actions-permits-0')).getByText('Add to Permits');
    fireEvent.press(btn);
    fireEvent.press(btn);
    const adds = alert.mock.calls
      .filter((c) => c[0] === 'Add to Permits')
      .map((c) => (c[2] ?? []).find((b) => b.text === 'Add'));
    expect(adds).toHaveLength(2);
    await act(async () => { adds[0]?.onPress?.(); });
    await pump(3);
    // The first add has fully finished (busy cleared) before the second confirm runs.
    await act(async () => { adds[1]?.onPress?.(); });
    await pump(3);
    expect(recordSpy.mock.calls.filter((c) => c[2].kind === 'permit')).toHaveLength(1);
    const permits = JSON.parse((await AsyncStorage.getItem('mageid_permits')) ?? '[]') as { notes?: string }[];
    expect(permits.filter((p) => (p.notes ?? '').startsWith('Alteration permit for the deck'))).toHaveLength(1);
  });
});

describe('L4 — the plan viewer offers "Code check this sheet"', () => {
  jest.setTimeout(120000);

  it('renders the header entry', async () => {
    phone();
    await primeWorld('populated');
    const SHEET = 'sheet-l4-a101';
    await AsyncStorage.setItem('mageid_plan_sheets', JSON.stringify([{
      id: SHEET, projectId: PROJECT_ID, userId: SMOKE_USER.id, width: 2400, height: 1800,
      name: 'Floor Plan — Level 1', sheetNumber: 'A-101', imageUri: 'https://plans.example.test/a101.png',
      createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z',
    }]));
    await mountRouteChecked(`/plan-viewer?sheetId=${SHEET}`);
    await pump();
    const entry = screen.getByTestId('codethread-entry-plan');
    expect(entry.props.accessibilityLabel ?? entry.parent?.props.accessibilityLabel).toBe('Code check this sheet');
  });
});
