/**
 * List-3 lane FB — "Backcharge the sub" from a punch item. BEHAVIOUR ONLY, no
 * snapshot (the punch-list goldens prove the rest of the screen did not move:
 * the entry lives in the edit sheet under a sanctioned backcharge- root, and
 * the backcharge sheet is mounted only while one is being recorded).
 *
 *  - owner seat, item assigned to a known sub → the button is enabled; tapping
 *    it closes the edit sheet and opens BackchargeSheet with the reason and
 *    the punch photo filled in, the amount EMPTY and Save blocked with its own
 *    reason until an amount is typed; saving records a device-local backcharge
 *    tied to the punch item and says nothing was sent;
 *  - an unassigned item → the button is disabled, with the assign-first reason;
 *  - a field seat → disabled with the costs sentence, even on an assigned item.
 *    The smoke world has no collaborator plumbing, so the seat is set by
 *    replacing useProjectRoleState's role in this file only (the owner cases
 *    use the real resolution: the job's ownerUserId is the signed-in user).
 */
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, SMOKE_USER } from '@/__tests__/fixtures/world';
import {
  BACKCHARGES_KEY, BACKCHARGE_NEEDS_SUB, BACKCHARGE_SEAT_FIELD, parseBackcharges,
} from '@/utils/backcharges';

let mockSeat: 'field' | null | undefined;
jest.mock('@/hooks/useProjectRole', () => {
  const actual = jest.requireActual('@/hooks/useProjectRole');
  return {
    ...actual,
    useProjectRoleState: (projectId: string | undefined) => {
      const real = actual.useProjectRoleState(projectId);
      return mockSeat === undefined ? real : { ...real, role: mockSeat };
    },
  };
});

const PHOTO = 'https://x.test/punch-1.jpg';
const SUBS = [
  {
    id: 'sub-vega', companyName: 'Vega Painting', contactName: 'Ana Vega', phone: '', email: '', address: '',
    trade: 'Painting', licenseNumber: '', w9OnFile: false, bidHistory: [], assignedProjects: [PROJECT_ID], notes: '',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

async function rewrite<T extends { id: string }>(key: string, fn: (row: T) => T) {
  const raw = JSON.parse((await AsyncStorage.getItem(key))!);
  const list = (Array.isArray(raw) ? raw : raw.data) as T[];
  const next = list.map(fn);
  await AsyncStorage.setItem(key, JSON.stringify(Array.isArray(raw) ? next : { ...raw, data: next }));
}

async function openEdit(itemId: string) {
  await mountRouteChecked(`/punch-list?projectId=${PROJECT_ID}`);
  await pump();
  await settle();
  await act(async () => { fireEvent.press(screen.getByTestId(`punch-item-${itemId}`)); });
  await pump();
}

const disabled = (id: string) => !!screen.getByTestId(id).props.accessibilityState?.disabled;

describe('Backcharge the sub, from a punch item', () => {
  jest.setTimeout(120000);

  beforeEach(async () => {
    allowConsoleErrors();
    mockSeat = undefined;
    await primeWorld('populated');
    // He owns the job (the real role path answers 'owner'); punch-1 is on
    // Vega Painting with a photo, punch-2 is on nobody.
    await rewrite<{ id: string; ownerUserId?: string }>('mageid_projects', p => (p.id === PROJECT_ID ? { ...p, ownerUserId: SMOKE_USER.id } : p));
    await rewrite<{ id: string; assignedSub?: string; photoUri?: string }>('mageid_punch_items', p => (
      p.id === 'punch-1' ? { ...p, photoUri: PHOTO } : p.id === 'punch-2' ? { ...p, assignedSub: '' } : p
    ));
    await AsyncStorage.setItem('mageid_subcontractors', JSON.stringify(SUBS));
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it('owner, assigned item: enabled; the sheet opens with the reason and photo, no amount, Save blocked until typed', async () => {
    const alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openEdit('punch-1');
    expect(screen.getByTestId('backcharge-from-punch')).toBeTruthy();
    expect(screen.getByText('Backcharge the Sub')).toBeTruthy();
    expect(disabled('backcharge-from-punch-button')).toBe(false);
    expect(screen.queryByTestId('backcharge-from-punch-why')).toBeNull();
    expect(screen.queryByTestId('backcharge-sheet')).toBeNull();

    await act(async () => { fireEvent.press(screen.getByTestId('backcharge-from-punch-button')); });
    await pump();

    // The edit sheet closed first, and the backcharge sheet opens only AFTER that
    // (a deferred hand-off: iOS refuses a modal over a dismissing modal).
    expect(screen.queryByTestId('backcharge-from-punch')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('backcharge-sheet')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByTestId('backcharge-reason').props.value)
      .toBe('Punch item: Touch-up paint at dining room return — roller lap marks in raking light. (Dining room)');
    expect(screen.getByText('From the punch item’s photo.')).toBeTruthy();
    expect(screen.getByTestId('backcharge-amount').props.value).toBe('');
    expect(disabled('backcharge-save')).toBe(true);
    expect(screen.getAllByText(/Type the amount\./).length).toBeGreaterThan(0);

    await act(async () => { fireEvent.changeText(screen.getByTestId('backcharge-amount'), '350'); });
    await pump(2);
    expect(disabled('backcharge-save')).toBe(false);
    await act(async () => { fireEvent.press(screen.getByTestId('backcharge-save')); });
    await pump();

    const saved = parseBackcharges(await AsyncStorage.getItem(BACKCHARGES_KEY));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(expect.objectContaining({
      subId: 'sub-vega', amountCents: 35000, basis: 'typed', photoUri: PHOTO, photoId: null, punchItemId: 'punch-1', status: 'open',
    }));
    expect(screen.queryByTestId('backcharge-sheet')).toBeNull();
    expect(alerts).toHaveBeenCalledWith(
      'Backcharge Saved',
      'It comes off Vega Painting’s next bill only when you apply it on their sub page. Nothing was sent.',
      undefined,
      undefined,
    );
  });

  it('an unassigned item: disabled, with the assign-first reason', async () => {
    await openEdit('punch-2');
    expect(screen.getByTestId('backcharge-from-punch')).toBeTruthy();
    expect(disabled('backcharge-from-punch-button')).toBe(true);
    expect(screen.getByTestId('backcharge-from-punch-why').props.children).toBe(BACKCHARGE_NEEDS_SUB);
    await act(async () => { fireEvent.press(screen.getByTestId('backcharge-from-punch-button')); });
    await pump(2);
    expect(screen.queryByTestId('backcharge-sheet')).toBeNull();
  });

  it('a field seat: disabled with the costs sentence, even on an assigned item', async () => {
    mockSeat = 'field';
    await openEdit('punch-1');
    expect(disabled('backcharge-from-punch-button')).toBe(true);
    expect(screen.getByTestId('backcharge-from-punch-why').props.children).toBe(BACKCHARGE_SEAT_FIELD);
    await act(async () => { fireEvent.press(screen.getByTestId('backcharge-from-punch-button')); });
    await pump(2);
    expect(screen.queryByTestId('backcharge-sheet')).toBeNull();
  });
});
