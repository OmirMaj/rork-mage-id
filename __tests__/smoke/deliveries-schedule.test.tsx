/**
 * Smoke — Deliveries That Follow The Schedule (lane DELIVERIES-1): the three
 * screens the founder was shown (design-previews/deliveries/deliveries-flow.png),
 * mounted in the real app tree with the feature's gate OPEN (the flag is a
 * getter on the mocked module; the fixture's contractor is not an owner
 * account, so the flag is what opens it).
 *
 *   1. THE TASK         "Deliveries for This Task": each delivery with the day
 *                       it is needed, the supplier's date and who said it, the
 *                       order by date; "No Date Yet"; Add a Delivery for This Task.
 *   2. THE SCHEDULE MOVES  the flag on the Deliveries screen, its sheet, and
 *                       "Keep the Supplier Date" (one write on the DELIVERY;
 *                       the schedule is byte for byte what it was).
 *   3. THE SUPPLIER SLIPS  the job effect "If Nothing Else Changes", from the
 *                       schedule's own preview; on Schedule Pro the proposal is
 *                       DRAWN and is applied only by a press.
 *
 * And the hard rules, as behaviour:
 *   - nothing here writes the project's schedule;
 *   - nothing here calls a server function (no message, no notification);
 *   - "Write a Message to the Yard" opens a DRAFT with no recipient;
 *   - a saved delivery has no needed-by field;
 *   - with the gate open and the table WITHOUT the columns (the migration not
 *     applied) the Deliveries screen is the screen from before the lane;
 *   - with the gate closed the three doors draw nothing.
 *
 * The golden of the flag-off screen lives in deliveries-schedule-golden.test.tsx.
 */

import React from 'react';
import { Dimensions, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, act } from 'expo-router/testing-library';
import { cleanup } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID, SMOKE_USER, world } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';
import type { ScheduleTask } from '@/types';
import type { Delivery } from '@/utils/deliverySchedule';
import type { SchedulePreviewOverlay } from '@/utils/schedulePreviewOverlay';
import { TaskDeliveriesSection, DeliveryProposalBanner } from '@/components/deliveries/DeliveriesFollow';
import { DELIVERY_COLUMNS_SEEN_KEY } from '@/hooks/useDeliveriesFollowSchedule';
import { GOLDEN_DELIVERIES, SCREEN_IDS, smallestHolding, type Json } from '@/__tests__/helpers/deliveriesGolden';

let mockFlagOn = true;
jest.mock('@/constants/featureFlags', () => {
  const mod = { ...jest.requireActual('@/constants/featureFlags') };
  Object.defineProperty(mod, 'DELIVERIES_FOLLOW_SCHEDULE_ENABLED', { enumerable: true, get: () => mockFlagOn });
  return mod;
});

// Noon local on Wed Oct 14, 2026.
const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime();

const T = (id: string, title: string, durationDays: number, deps: string[] = []): ScheduleTask => ({
  id, title, phase: 'Build', durationDays, startDay: 1, progress: 0, crew: '', dependencies: deps, notes: '', status: 'not_started',
} as ScheduleTask);
/** The house in the picture: Window Install starts Wed Nov 18. Site Prep (14 days) puts Yard Framing on Fri Oct 30... see below. */
const TASKS: ScheduleTask[] = [
  T('F', 'Framing', 12),
  T('W', 'Window Install', 4, ['F']),
  T('T', 'Exterior Trim', 5, ['W']),
  T('S', 'Siding', 5, ['T']),
  T('I', 'Interior Finishes', 20, ['F']),
  T('X', 'Final Inspection', 1, ['S', 'I']),
];
const SCHEDULE = {
  id: 'sched-1', name: 'Harlow', projectId: PROJECT_ID, startDate: '2026-11-02', workingDaysPerWeek: 5, bufferDays: 0, tasks: TASKS,
  totalDurationDays: 33, criticalPathDays: 33, laborAlignmentScore: 0, riskItems: [],
};
const base = { projectId: PROJECT_ID, createdAt: '2026-10-01T16:00:00.000Z', updatedAt: '2026-10-01T16:00:00.000Z', status: 'scheduled' as const };
const said = (date: string, previousDate: string, at: string) => ({ date, previousDate, at, source: 'supplier_said' as const, note: 'by phone', by: SMOKE_USER.id, byName: SMOKE_USER.name });

/** Screen 1: the windows, one working day before the day they are needed; the tape with no date. */
const WINDOWS: Delivery = {
  ...base, id: 'dddddddd-0000-4000-8000-0000000000a1', description: '14 Windows', supplier: 'Northside Glass', poNumber: '1042',
  expectedDate: '2026-11-12', window: '7 to 11 AM', taskId: 'W', bufferDays: 3, leadTimeDays: 42, orderedOn: '2026-09-28', promisedDate: '2026-11-12',
  taskStartSeen: '2026-11-18', dateHistory: [said('2026-11-12', '', '2026-10-06T16:00:00.000Z')],
};
const TAPE: Delivery = {
  ...base, id: 'dddddddd-0000-4000-8000-0000000000a2', description: 'Flashing Tape and Sealant', supplier: 'Harbor Building Supply',
  expectedDate: '', taskId: 'W', bufferDays: 3, taskStartSeen: '2026-11-18',
};
/** Screen 2: Framing was seen starting Wed Oct 21 and is drawn on Mon Nov 2: it slid 8 working days. The lumber is dated Mon Oct 19. */
const LUMBER: Delivery = {
  ...base, id: 'dddddddd-0000-4000-8000-0000000000a3', description: 'Framing Lumber Package', supplier: 'Kessler Lumber Yard',
  expectedDate: '2026-10-19', taskId: 'F', bufferDays: 3, taskStartSeen: '2026-10-21', dateHistory: [{ date: '2026-10-19', previousDate: '', at: '2026-10-02T16:00:00.000Z', source: 'typed', by: SMOKE_USER.id }],
};
/** Screen 3: the windows now Tue Dec 1; they were Thu Nov 12. */
const WINDOWS_LATE: Delivery = {
  ...WINDOWS, expectedDate: '2026-12-01', window: undefined, orderedOn: '2026-09-28',
  dateHistory: [said('2026-11-12', '', '2026-10-06T16:00:00.000Z'), said('2026-12-01', '2026-11-12', '2026-10-09T16:00:00.000Z')],
};

const ids = (n: unknown, out: string[] = []): string[] => {
  if (Array.isArray(n)) { n.forEach((c) => ids(c, out)); return out; }
  if (!n || typeof n !== 'object') return out;
  const node = n as { props?: { testID?: unknown }; children?: unknown[] | null };
  if (typeof node.props?.testID === 'string') out.push(node.props.testID);
  (node.children ?? []).forEach((c) => ids(c, out));
  return out;
};
const textOf = (n: unknown): string => {
  if (typeof n === 'string') return n;
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (!n || typeof n !== 'object') return '';
  return ((n as { children?: unknown[] | null }).children ?? []).map(textOf).join('');
};

function phone() { Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1 } }); }
function desk() { Dimensions.set({ window: { width: 1512, height: 945, scale: 2, fontScale: 1 }, screen: { width: 1512, height: 945, scale: 2, fontScale: 1 } }); }

async function seed(deliveries: Delivery[], opts: { schedule?: boolean; tier?: string } = {}) {
  await primeWorld('populated');
  if (opts.schedule !== false) await AsyncStorage.setItem('mageid_projects', JSON.stringify([{ ...world.project, schedule: SCHEDULE }]));
  if (opts.tier) await AsyncStorage.setItem('mageid_subscription_tier', opts.tier);
  await AsyncStorage.setItem('mageid_deliveries', JSON.stringify(deliveries));
}
const storedSchedule = async () => JSON.stringify((JSON.parse((await AsyncStorage.getItem('mageid_projects')) ?? '[]') as { schedule?: unknown }[])[0]?.schedule ?? null);
const storedDeliveries = async () => JSON.parse((await AsyncStorage.getItem('mageid_deliveries')) ?? '[]') as Record<string, unknown>[];

let invoke: jest.SpyInstance;
let rpc: jest.SpyInstance;
let openURL: jest.SpyInstance;
beforeEach(() => {
  mockFlagOn = true;
  phone();
  invoke = jest.spyOn(supabase.functions, 'invoke');
  rpc = jest.spyOn(supabase, 'rpc');
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
});
afterEach(() => {
  // Nothing sends a message, raises a notification or asks a server to change a schedule or a delivery.
  for (const call of invoke.mock.calls) expect(String(call[0])).not.toMatch(/notify|mail|sms|push|message|schedule|deliver/i);
  for (const call of rpc.mock.calls) expect(String(call[0])).not.toMatch(/notify|mail|sms|push|message|schedule|deliver/i);
  cleanup();
  jest.restoreAllMocks();
});

describe('1. The task: Deliveries for This Task', () => {
  it('shows each delivery with the day it is needed, the supplier date and who said it, and the order by date', async () => {
    await seed([WINDOWS, TAPE]);
    const tree = await mountRouteChecked('/dfs-task-probe', () => <TaskDeliveriesSection taskId="W" />, { now: NOW });
    await settle();
    expect(tree.getByText('Deliveries for This Task')).toBeTruthy();
    // Needed on Site By: Wed Nov 18, back 3 working days (Tue 17, Mon 16, Fri 13).
    expect(textOf(tree.getByTestId(`dfs-needed-${WINDOWS.id}-value`).props.children)).toBe('Fri, Nov 13');
    expect(textOf(tree.getByTestId(`dfs-needed-${WINDOWS.id}-basis`).props.children)).toBe('3 working days before Window Install starts.');
    expect(textOf(tree.getByTestId(`dfs-supplier-${WINDOWS.id}-value`).props.children)).toBe('Thu, Nov 12, 7 to 11 AM');
    expect(textOf(tree.getByTestId(`dfs-supplier-${WINDOWS.id}-basis`).props.children)).toBe('Supplier said so by phone. Typed by you, Oct 6.');
    // Order By: 6 weeks (42 days) back from Fri Nov 13.
    expect(textOf(tree.getByTestId(`dfs-order-${WINDOWS.id}-value`).props.children)).toBe('Fri, Oct 2');
    expect(textOf(tree.getByTestId(`dfs-order-${WINDOWS.id}-basis`).props.children)).toBe('Counted back the 6 week lead time typed on this delivery.');
    expect(textOf(tree.getByTestId(`dfs-order-${WINDOWS.id}-extra`).props.children)).toBe('Marked ordered Sep 28.');
    expect(textOf(tree.getByTestId(`dfs-chip-${WINDOWS.id}`))).toBe('1 working day before');
    // "No date yet" is shown as such, and is never a "before" chip.
    expect(textOf(tree.getByTestId(`dfs-chip-${TAPE.id}`))).toBe('No Date Yet');
    expect(textOf(tree.getByTestId(`dfs-supplier-${TAPE.id}-value`).props.children)).toBe('Not Given');
    expect(textOf(tree.getByTestId(`dfs-supplier-${TAPE.id}-basis`).props.children)).toBe('Nobody has told MAGE ID a date.');
    expect(textOf(tree.getByTestId(`dfs-needed-${TAPE.id}-value`).props.children)).toBe('Fri, Nov 13');
    expect(tree.getByText('Add a Delivery for This Task')).toBeTruthy();
    expect(tree.getByText('The supplier date is the supplier\'s word, not a promise from MAGE ID.')).toBeTruthy();
    // Every date row on the screen carries the line that says where it came from.
    const all = ids(tree.toJSON());
    const rows = all.filter((id) => /^dfs-(needed|supplier|order)-[0-9a-f-]+$/.test(id));
    expect(rows.length).toBe(5);
    for (const row of rows) expect(textOf(tree.getByTestId(`${row}-basis`).props.children).length).toBeGreaterThan(10);
  });

  it('adds a delivery for the task with no supplier date: saved as "No date yet", with no needed-by field, and the schedule untouched', async () => {
    await seed([]);
    const before = await storedSchedule();
    const tree = await mountRouteChecked('/dfs-task-probe', () => <TaskDeliveriesSection taskId="W" />, { now: NOW });
    await settle();
    expect(tree.getByText('No deliveries are linked to this task.')).toBeTruthy();
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-task-add')); });
    await settle();
    await act(async () => {
      fireEvent.changeText(tree.getByTestId('dfs-what'), 'Flashing Tape and Sealant');
      fireEvent.changeText(tree.getByTestId('dfs-supplier'), 'Harbor Building Supply');
    });
    // The form shows the date it works out, with its working, before anything is saved.
    expect(textOf(tree.getByTestId('dfs-edit-needed-value').props.children)).toBe('Mon, Nov 16');
    expect(textOf(tree.getByTestId('dfs-edit-needed-basis').props.children)).toBe('2 working days before Window Install starts.');
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-buffer-more')); });
    expect(textOf(tree.getByTestId('dfs-edit-needed-value').props.children)).toBe('Fri, Nov 13');
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-edit-save')); });
    await settle();
    const saved = await storedDeliveries();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ description: 'Flashing Tape and Sealant', supplier: 'Harbor Building Supply', expectedDate: '', taskId: 'W', bufferDays: 3, taskStartSeen: '2026-11-18', status: 'scheduled' });
    // Needed On Site By is never stored: no key of the saved delivery names it.
    expect(Object.keys(saved[0]).filter((k) => /needed|orderBy/i.test(k))).toEqual([]);
    expect(await storedSchedule()).toBe(before);
    expect(textOf(tree.getByTestId(`dfs-chip-${saved[0].id as string}`))).toBe('No Date Yet');
  });

  it('draws nothing when the gate is closed', async () => {
    mockFlagOn = false;
    await seed([WINDOWS, TAPE]);
    const tree = await mountRouteChecked('/dfs-task-probe', () => <TaskDeliveriesSection taskId="W" />, { now: NOW });
    await settle();
    expect(ids(tree.toJSON()).filter((id) => id.startsWith('dfs-'))).toEqual([]);
  });
});

describe('2. The schedule moves: the app shows it and asks. It does not act.', () => {
  it('the flag on the Deliveries screen, the sheet, a draft with no recipient, and Keep the Supplier Date', async () => {
    await seed([LUMBER]);
    const before = await storedSchedule();
    const tree = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    expect(textOf(tree.getByTestId('dfs-to-review'))).toBe('1 to review');
    // Framing was seen on Wed Oct 21 and is drawn on Mon Nov 2: 8 working days (22, 23, 26, 27, 28, 29, 30, Nov 2).
    // Needed (buffer 3) is now Wed Oct 28; the yard's Mon Oct 19 is 7 working days before it (20, 21, 22, 23, 26, 27, 28).
    const row = tree.getByTestId(`dfs-flagrow-schedule_moved-${LUMBER.id}`);
    expect(textOf(row)).toContain('Framing slid 8 working days. Framing Lumber Package is now 7 working days early.');
    expect(textOf(row)).toContain('Nothing has been sent to the supplier.');
    await act(async () => { fireEvent.press(row); });
    await settle();
    expect(textOf(tree.getByTestId('dfs-flag-moved'))).toContain('The start was Oct 21. It is now Nov 2. Nothing has been sent to the supplier.');
    expect(textOf(tree.getByTestId('dfs-moved-needed-was').props.children)).toBe('Oct 16');
    expect(textOf(tree.getByTestId('dfs-moved-needed-value').props.children)).toBe('Wed, Oct 28');
    expect(textOf(tree.getByTestId(`dfs-supplier-${LUMBER.id}-basis`).props.children)).toBe('Typed by you, Oct 2. No word on who gave it.');
    expect(tree.getByText('Write a Message opens a draft for you to read and send yourself. MAGE ID sends nothing to a supplier.')).toBeTruthy();
    // On the block behind and on the sheet in front.
    expect(tree.getAllByText('MAGE ID shows what the dates say. It can miss things. Check with your supplier.').length).toBe(2);

    // The draft: the phone's own mail app, no recipient, facts only.
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-write-message')); });
    await settle();
    expect(openURL).toHaveBeenCalledTimes(1);
    const url = String(openURL.mock.calls[0][0]);
    expect(url.startsWith('mailto:?subject=')).toBe(true);
    const body = decodeURIComponent(url.split('&body=')[1]);
    expect(body).toContain('This is about our order: Framing Lumber Package.');
    expect(body).toContain('The delivery date we have from you is Mon, Oct 19.');
    expect(body).toContain('We needed it on site by Fri, Oct 16. We now need it on site by Wed, Oct 28.');
    expect(body).toContain('Can you hold it and deliver on Wed, Oct 28 or just before?');
    expect(body).not.toMatch(/Harlow|Meredith|\$|Rex St/);

    // "I have looked": one write, on the delivery. The schedule is what it was.
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-keep-date')); });
    await settle();
    const saved = await storedDeliveries();
    expect(saved[0]).toMatchObject({ id: LUMBER.id, taskStartSeen: '2026-11-02', expectedDate: '2026-10-19' });
    expect(Object.keys(saved[0]).filter((k) => /needed|orderBy/i.test(k))).toEqual([]);
    expect(await storedSchedule()).toBe(before);
    expect(tree.queryByTestId('dfs-to-review')).toBeNull();
    expect(tree.queryByTestId(`dfs-flagrow-schedule_moved-${LUMBER.id}`)).toBeNull();
  });
});

describe('3. The supplier slips: what it does to the job, before anything changes', () => {
  it('the job effect, from the schedule\'s own preview, labelled "If Nothing Else Changes"', async () => {
    await seed([WINDOWS_LATE]);
    const before = await storedSchedule();
    const tree = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    const row = tree.getByTestId(`dfs-flagrow-supplier_after_needed-${WINDOWS_LATE.id}`);
    expect(textOf(row)).toContain('14 Windows: the supplier date is Tue, Dec 1. It is needed by Fri, Nov 13.');
    await act(async () => { fireEvent.press(row); });
    await settle();
    expect(textOf(tree.getByTestId('dfs-flag-after'))).toContain('Supplier said so by phone. Typed by you, Oct 9.');
    expect(tree.getByText('If Nothing Else Changes')).toBeTruthy();
    // Window Install: was Nov 18, Wed Dec 2 at the earliest.
    expect(textOf(tree.getByTestId('dfs-effect-start-was').props.children)).toBe('Nov 18');
    expect(textOf(tree.getByTestId('dfs-effect-start-value').props.children)).toBe('Wed, Dec 2 at the earliest');
    expect(textOf(tree.getByTestId('dfs-effect-start-basis').props.children)).toBe('The first working day after the supplier date. No buffer left.');
    // Finish: Wed Dec 16 to Tue Dec 22, 4 working days.
    expect(textOf(tree.getByTestId('dfs-effect-finish-was').props.children)).toBe('Wed, Dec 16');
    expect(textOf(tree.getByTestId('dfs-effect-finish-value').props.children)).toBe('Tue, Dec 22');
    expect(textOf(tree.getByTestId('dfs-effect-finish-basis').props.children)).toBe('4 working days later. Worked out from your schedule.');
    expect(textOf(tree.getByTestId('dfs-effect-slides-value').props.children)).toBe('3');
    expect(textOf(tree.getByTestId('dfs-effect-slides-basis').props.children)).toBe('Exterior Trim, Siding, Final Inspection.');
    expect(textOf(tree.getByTestId('dfs-bar-W'))).toContain('10 working days later');
    expect(textOf(tree.getByTestId('dfs-bar-X'))).toContain('4 working days later');
    expect(textOf(tree.getByTestId('dfs-preview-only'))).toBe('A preview only. Your schedule does not move until you apply it.');
    expect(textOf(tree.getByTestId(`dfs-supplier-${WINDOWS_LATE.id}-extra`).props.children)).toBe('Was Nov 12.');
    // A phone cannot draw it on the schedule: it says where, and offers no button that would land on a dead end.
    expect(tree.queryByTestId('dfs-see-schedule')).toBeNull();
    expect(tree.getByTestId('dfs-wider')).toBeTruthy();
    // Looking moved nothing.
    expect(await storedSchedule()).toBe(before);
    expect((await storedDeliveries())[0]).toMatchObject({ expectedDate: '2026-12-01', promisedDate: '2026-11-12' });
  });

  it('on the Free plan the flag shows and the job effect does not', async () => {
    await seed([WINDOWS_LATE], { tier: 'free' });
    const tree = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    await act(async () => { fireEvent.press(tree.getByTestId(`dfs-flagrow-supplier_after_needed-${WINDOWS_LATE.id}`)); });
    await settle();
    expect(tree.getByTestId('dfs-flag-after')).toBeTruthy();
    expect(tree.getByText('What this does to the job is on the Pro plan.')).toBeTruthy();
    expect(tree.queryByTestId('dfs-effect')).toBeNull();
    expect(tree.queryByTestId('dfs-preview-only')).toBeNull();
  });

  it('Schedule Pro: the proposal is handed to the schedule\'s own preview, and the schedule\'s own commit runs only on a press', async () => {
    desk();
    await seed([WINDOWS_LATE]);
    const previews: (SchedulePreviewOverlay | null)[] = [];
    const commits: ScheduleTask[][] = [];
    const commit = (producer: (prev: ScheduleTask[]) => ScheduleTask[]) => { commits.push(producer(TASKS)); };
    const Probe = () => (
      <DeliveryProposalBanner projectId={PROJECT_ID} deliveryId={WINDOWS_LATE.id} schedule={SCHEDULE} tasks={TASKS} onPreview={(o) => { previews.push(o); }} commit={commit} />
    );
    const tree = await mountRouteChecked('/dfs-banner-probe', Probe, { now: NOW });
    await settle();
    expect(textOf(tree.getByTestId('dfs-proposal'))).toContain('Window Install would start no earlier than Wed, Dec 2, the first working day after the supplier date for 14 Windows.');
    expect(textOf(tree.getByTestId('dfs-proposal'))).toContain('A preview only. Your schedule does not move until you apply it.');
    // Drawn: the schedule's own overlay, finish +6 calendar days, four bars moved.
    const shown = previews.filter(Boolean) as SchedulePreviewOverlay[];
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[shown.length - 1].finishDeltaDays).toBe(6);
    expect(shown[shown.length - 1].moved.map((m) => m.id).sort()).toEqual(['S', 'T', 'W', 'X']);
    // Not applied: nothing has been committed by opening the screen.
    expect(commits).toHaveLength(0);
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-proposal-apply')); });
    await settle();
    expect(commits).toHaveLength(1);
    expect(commits[0].find((t) => t.id === 'W')).toMatchObject({ anchorType: 'start-no-earlier', anchorDate: '2026-12-02' });
    expect(commits[0].filter((t, i) => t !== TASKS[i])).toHaveLength(1);
    expect(tree.getByTestId('dfs-proposal-applied')).toBeTruthy();
    expect(previews[previews.length - 1]).toBeNull();
  });

  it('Schedule Pro: Discard takes the preview back and commits nothing; with the gate closed there is no banner and no preview', async () => {
    desk();
    await seed([WINDOWS_LATE]);
    const previews: (SchedulePreviewOverlay | null)[] = [];
    const commit = jest.fn();
    const Probe = () => (
      <DeliveryProposalBanner projectId={PROJECT_ID} deliveryId={WINDOWS_LATE.id} schedule={SCHEDULE} tasks={TASKS} onPreview={(o) => { previews.push(o); }} commit={commit} />
    );
    const tree = await mountRouteChecked('/dfs-banner-probe', Probe, { now: NOW });
    await settle();
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-proposal-discard')); });
    await settle();
    expect(commit).not.toHaveBeenCalled();
    expect(previews[previews.length - 1]).toBeNull();
    expect(tree.queryByTestId('dfs-proposal')).toBeNull();
    cleanup();

    mockFlagOn = false;
    await seed([WINDOWS_LATE]);
    const closed: (SchedulePreviewOverlay | null)[] = [];
    const Probe2 = () => (
      <DeliveryProposalBanner projectId={PROJECT_ID} deliveryId={WINDOWS_LATE.id} schedule={SCHEDULE} tasks={TASKS} onPreview={(o) => { closed.push(o); }} commit={commit} />
    );
    const tree2 = await mountRouteChecked('/dfs-banner-probe', Probe2, { now: NOW });
    await settle();
    expect(ids(tree2.toJSON()).filter((id) => id.startsWith('dfs-'))).toEqual([]);
    expect(closed).toEqual([]);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('Before the migration is applied', () => {
  it('gate open, the table without the columns: the Deliveries screen is the screen from before the lane, and nothing is queued', async () => {
    // The flag-off screen, as the golden file records it.
    mockFlagOn = false;
    await seed(GOLDEN_DELIVERIES, { schedule: false });
    const off = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    const offScreen = JSON.stringify(smallestHolding(off.toJSON() as Json, SCREEN_IDS));
    cleanup();

    // The gate open, and the table answers "that column does not exist".
    mockFlagOn = true;
    await seed(GOLDEN_DELIVERIES, { schedule: false });
    // The jest client (the mock in __tests__/mocks/supabase.ts) takes any table name.
    type Builder = Record<string, (...a: unknown[]) => unknown>;
    const client = supabase as unknown as { from: (table?: string) => Builder };
    const realFrom = client.from;
    jest.spyOn(client, 'from').mockImplementation((table?: string) => {
      const builder = realFrom(table);
      if (table !== 'deliveries') return builder;
      return new Proxy(builder, {
        get(target, prop) {
          if (prop === 'select') {
            return (cols?: string) => (typeof cols === 'string' && cols.includes('task_id')
              ? { limit: async () => ({ data: null, error: { code: '42703', message: 'column deliveries.task_id does not exist' } }) }
              : target.select(cols));
          }
          return target[prop as string];
        },
      });
    });
    const on = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    expect(ids(on.toJSON()).filter((id) => id.startsWith('dfs-'))).toEqual([]);
    expect(JSON.stringify(smallestHolding(on.toJSON() as Json, SCREEN_IDS))).toBe(offScreen);
    // The plus button opens the OLD form, which writes the old columns only.
    await act(async () => { fireEvent.press(on.getByLabelText('Add Delivery')); });
    await settle();
    expect(on.queryByTestId('dfs-edit-sheet')).toBeNull();
    expect(on.getByTestId('delivery-save')).toBeTruthy();
    // The device did not record that it has seen the columns, and nothing waits in the queue.
    expect(await AsyncStorage.getItem(DELIVERY_COLUMNS_SEEN_KEY)).toBeNull();
    const queued = JSON.parse((await AsyncStorage.getItem('mageid_offline_queue')) ?? '[]') as { table?: string }[];
    expect(queued.filter((m) => m.table === 'deliveries')).toEqual([]);
  });

  it('gate open, the columns there: the plus button opens the form with the task link', async () => {
    await seed([]);
    const tree = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    expect(tree.getByTestId('dfs-block')).toBeTruthy();
    await act(async () => { fireEvent.press(tree.getByLabelText('Add Delivery')); });
    await settle();
    expect(tree.getByTestId('dfs-edit-sheet')).toBeTruthy();
    expect(tree.queryByTestId('delivery-save')).toBeNull();
    expect(await AsyncStorage.getItem(DELIVERY_COLUMNS_SEEN_KEY)).toBe('1');
  });
});
