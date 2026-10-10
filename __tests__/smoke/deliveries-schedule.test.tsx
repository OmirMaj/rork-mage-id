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
import { markColumnsMissing, setColumnsAnswer } from '@/utils/deliveries/columnsGate';
import { deliveryHold, proposedTasks } from '@/utils/deliveries/jobEffect';
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
  // What the device knows about the table's columns is kept in memory for the session: each test starts not knowing.
  setColumnsAnswer('unknown');
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
    const tree = await mountRouteChecked('/dfs-task-probe', () => <TaskDeliveriesSection taskId="W" projectId={PROJECT_ID} />, { now: NOW });
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
    const tree = await mountRouteChecked('/dfs-task-probe', () => <TaskDeliveriesSection taskId="W" projectId={PROJECT_ID} />, { now: NOW });
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
    const tree = await mountRouteChecked('/dfs-task-probe', () => <TaskDeliveriesSection taskId="W" projectId={PROJECT_ID} />, { now: NOW });
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
    // A position, not a verdict: where the supplier date sits against the day it is needed.
    expect(textOf(row)).toContain('Framing slid 8 working days. The supplier date for Framing Lumber Package is now 7 working days before the day it is needed.');
    // What MAGE ID did, not what anyone else may have.
    expect(textOf(row)).toContain('MAGE ID has sent nothing.');
    expect(textOf(row)).not.toMatch(/early|has been sent/);
    await act(async () => { fireEvent.press(row); });
    await settle();
    expect(textOf(tree.getByTestId('dfs-flag-moved'))).toContain('The start was Oct 21. It is now Nov 2. MAGE ID has sent nothing.');
    expect(textOf(tree.getByTestId('dfs-moved-needed-was').props.children)).toBe('Oct 16');
    expect(textOf(tree.getByTestId('dfs-moved-needed-value').props.children)).toBe('Wed, Oct 28');
    // The delivery's one row on the list behind, and the same card on the sheet in front: the same words on both.
    expect(tree.getAllByTestId(`dfs-supplier-${LUMBER.id}-basis`).map((n) => textOf(n.props.children))).toEqual(Array(2).fill('Typed by you, Oct 2. No word on who gave it.'));
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
    // Window Install: was Nov 18. The earliest start that raises no flag for Dec 1 with a
    // buffer of 3 is three worked days after it: Fri Dec 4.
    expect(textOf(tree.getByTestId('dfs-effect-start-was').props.children)).toBe('Nov 18');
    expect(textOf(tree.getByTestId('dfs-effect-start-value').props.children)).toBe('Fri, Dec 4 at the earliest');
    expect(textOf(tree.getByTestId('dfs-effect-start-basis').props.children)).toBe('The earliest start that puts the supplier date on or before the day it is needed.');
    // Finish: Wed Dec 16 to Thu Dec 24, 6 working days.
    expect(textOf(tree.getByTestId('dfs-effect-finish-was').props.children)).toBe('Wed, Dec 16');
    expect(textOf(tree.getByTestId('dfs-effect-finish-value').props.children)).toBe('Thu, Dec 24');
    expect(textOf(tree.getByTestId('dfs-effect-finish-basis').props.children)).toBe('6 working days later. Worked out from your schedule.');
    expect(textOf(tree.getByTestId('dfs-effect-slides-value').props.children)).toBe('3');
    expect(textOf(tree.getByTestId('dfs-effect-slides-basis').props.children)).toBe('Exterior Trim, Siding, Final Inspection.');
    expect(textOf(tree.getByTestId('dfs-bar-W'))).toContain('12 working days later');
    expect(textOf(tree.getByTestId('dfs-bar-X'))).toContain('6 working days later');
    expect(textOf(tree.getByTestId('dfs-preview-only'))).toBe('A preview only. Your schedule does not move until you apply it.');
    expect(tree.getAllByTestId(`dfs-supplier-${WINDOWS_LATE.id}-extra`).map((n) => textOf(n.props.children))).toEqual(['Was Nov 12.', 'Was Nov 12.']);
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

  /**
   * A stand-in for Schedule Pro: its own task list (with one level of Undo), its
   * own preview slot (a real state setter, as setPendingPreview is) and its own
   * commit, which takes the source label for its change log.
   */
  function makeHost(startTasks: ScheduleTask[] = TASKS) {
    const log: { label: string; tasks: ScheduleTask[] }[] = [];
    const slot: { now: SchedulePreviewOverlay | null; set: React.Dispatch<React.SetStateAction<SchedulePreviewOverlay | null>> | null } = { now: null, set: null };
    const undo: { run: (() => void) | null } = { run: null };
    const Host = ({ show = true, refuse }: { show?: boolean; refuse?: string }) => {
      const [tasks, setTasks] = React.useState<ScheduleTask[]>(startTasks);
      const [preview, setPreview] = React.useState<SchedulePreviewOverlay | null>(null);
      const past = React.useRef<ScheduleTask[][]>([]);
      slot.now = preview;
      slot.set = setPreview;
      undo.run = () => { const prev = past.current.pop(); if (prev) setTasks(prev); };
      const commit = (producer: (prev: ScheduleTask[]) => ScheduleTask[], source: string): string | void => {
        if (refuse) return refuse;
        const next = producer(tasks);
        past.current.push(tasks);
        log.push({ label: source, tasks: next });
        setTasks(next);
      };
      return show ? <DeliveryProposalBanner projectId={PROJECT_ID} deliveryId={WINDOWS_LATE.id} schedule={SCHEDULE} tasks={tasks} onPreview={setPreview} commit={commit} /> : null;
    };
    return { Host, log, slot, undo };
  }

  it('Schedule Pro: the proposal is drawn on the schedule\'s own preview; Apply runs the schedule\'s own commit on a press, logged as the person\'s; Undo clears the Applied line', async () => {
    desk();
    await seed([WINDOWS_LATE]);
    const { Host, log, slot, undo } = makeHost();
    const tree = await mountRouteChecked('/dfs-banner-probe', () => <Host />, { now: NOW });
    await settle();
    expect(textOf(tree.getByTestId('dfs-proposal'))).toContain('Window Install would start no earlier than Fri, Dec 4. That is the earliest start that puts the supplier date for 14 Windows on or before the day it is needed.');
    expect(textOf(tree.getByTestId('dfs-proposal'))).toContain('A preview only. Your schedule does not move until you apply it.');
    // Drawn: the schedule's own overlay, finish +8 calendar days, four bars moved.
    expect(slot.now?.finishDeltaDays).toBe(8);
    expect(slot.now?.moved.map((m) => m.id).sort()).toEqual(['S', 'T', 'W', 'X']);
    // Not applied: nothing has been committed by opening the screen.
    expect(log).toHaveLength(0);
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-proposal-apply')); });
    await settle();
    expect(log).toHaveLength(1);
    // The change log reads a person's own Apply, not an AI edit.
    expect(log[0].label).toBe('Applied from a delivery');
    // The anchor says which delivery it came from.
    expect(log[0].tasks.find((t) => t.id === 'W')).toMatchObject({ anchorType: 'start-no-earlier', anchorDate: '2026-12-04', anchorFromDeliveryId: WINDOWS_LATE.id });
    expect(log[0].tasks.filter((t, i) => t !== TASKS[i])).toHaveLength(1);
    expect(textOf(tree.getByTestId('dfs-proposal-applied'))).toBe('Applied to the schedule. Undo takes it back.');
    expect(slot.now).toBeNull();
    // Undo on the schedule: the hold is gone, so the line that says it was applied goes too.
    await act(async () => { undo.run?.(); });
    await settle();
    expect(tree.queryByTestId('dfs-proposal-applied')).toBeNull();
    expect(tree.getByTestId('dfs-proposal')).toBeTruthy();
    expect(log).toHaveLength(1);
  });

  it('Schedule Pro: a seat that may not save is told so, and nothing is marked applied', async () => {
    desk();
    await seed([WINDOWS_LATE]);
    const { Host, log } = makeHost();
    const tree = await mountRouteChecked('/dfs-banner-probe', () => <Host refuse="Not saved: you have view-only access to this project." />, { now: NOW });
    await settle();
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-proposal-apply')); });
    await settle();
    expect(log).toHaveLength(0);
    expect(textOf(tree.getByTestId('dfs-proposal-refused'))).toContain('view-only access');
    expect(tree.queryByTestId('dfs-proposal-applied')).toBeNull();
  });

  it('Schedule Pro: the preview slot is shared. The banner takes back its own overlay and leaves another one alone', async () => {
    desk();
    await seed([WINDOWS_LATE]);
    const { Host, slot } = makeHost();
    const tree = await mountRouteChecked('/dfs-banner-probe', () => <Host />, { now: NOW });
    await settle();
    const own = slot.now;
    expect(own).not.toBeNull();
    // Discard with its own overlay in the slot: taken back.
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-proposal-discard')); });
    await settle();
    expect(slot.now).toBeNull();
    expect(tree.queryByTestId('dfs-proposal')).toBeNull();
    cleanup();

    // The Change tab's review puts ITS proposal in the slot while the banner is up; then the banner goes.
    await seed([WINDOWS_LATE]);
    const second = makeHost();
    const tree2 = await mountRouteChecked('/dfs-banner-probe', () => <second.Host />, { now: NOW });
    await settle();
    const theirs = { ...(second.slot.now as SchedulePreviewOverlay), finishDeltaDays: 99 };
    await act(async () => { second.slot.set?.(theirs); });
    await act(async () => { fireEvent.press(tree2.getByTestId('dfs-proposal-discard')); });
    await settle();
    expect(second.slot.now).toBe(theirs);
  });

  it('Schedule Pro: a hold applied from this delivery, and a supplier date that has since improved: Remove the Hold is a press, logged, and Undo brings the offer back', async () => {
    desk();
    // The windows were Dec 1 and the proposal was applied (held to Fri Dec 4). The supplier now says Wed Nov 25.
    const improved: Delivery = { ...WINDOWS_LATE, expectedDate: '2026-11-25', dateHistory: [...(WINDOWS_LATE.dateHistory ?? []), said('2026-11-25', '2026-12-01', '2026-10-12T16:00:00.000Z')] };
    await seed([improved]);
    const held = proposedTasks(TASKS, 'W', '2026-12-04', improved.id);
    const { Host, log, slot, undo } = makeHost(held);
    const tree = await mountRouteChecked('/dfs-banner-probe', () => <Host />, { now: NOW });
    await settle();
    // Offered, not done: opening the screen removed nothing.
    expect(textOf(tree.getByTestId('dfs-hold-banner'))).toContain('Window Install is held to start no earlier than Fri, Dec 4. That hold was applied from this delivery.');
    expect(textOf(tree.getByTestId('dfs-hold-banner'))).toContain('The supplier date is now Wed, Nov 25. With your buffer, that allows a start as early as Mon, Nov 30.');
    expect(log).toHaveLength(0);
    expect(slot.now?.finishDeltaDays).toBe(-8);
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-hold-remove')); });
    await settle();
    expect(log).toHaveLength(1);
    expect(log[0].label).toBe('Hold removed from a delivery');
    expect(deliveryHold(log[0].tasks, improved.id)).toBeNull();
    expect(log[0].tasks.find((t) => t.id === 'W')).not.toHaveProperty('anchorType');
    expect(log[0].tasks.filter((t, i) => t !== held[i])).toHaveLength(1);
    expect(textOf(tree.getByTestId('dfs-hold-removed'))).toBe('The hold is removed. Undo takes it back.');
    await act(async () => { undo.run?.(); });
    await settle();
    expect(tree.queryByTestId('dfs-hold-removed')).toBeNull();
    expect(tree.getByTestId('dfs-hold-banner')).toBeTruthy();
  });

  it('Schedule Pro: with the gate closed there is no banner, no preview and no commit', async () => {
    desk();
    mockFlagOn = false;
    await seed([WINDOWS_LATE]);
    const { Host, log, slot } = makeHost();
    const tree = await mountRouteChecked('/dfs-banner-probe', () => <Host />, { now: NOW });
    await settle();
    expect(ids(tree.toJSON()).filter((id) => id.startsWith('dfs-'))).toEqual([]);
    expect(slot.now).toBeNull();
    expect(log).toHaveLength(0);
  });
});

describe('The review fixes, as behaviour', () => {
  /** A delivery from before the lane: a date, and no record of who gave it. */
  const OLD: Delivery = { ...base, id: 'dddddddd-0000-4000-8000-0000000000b1', description: 'Roof Trusses', supplier: 'Kessler Lumber Yard', expectedDate: '2026-10-16' };

  it('opening a delivery from before the lane to link a task and pressing Save records nothing about its date', async () => {
    await seed([OLD]);
    const tree = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    // An unlinked, dated delivery keeps its old row, with a button to its dates.
    await act(async () => { fireEvent.press(tree.getByTestId(`dfs-dates-${OLD.id}`)); });
    await settle();
    expect(textOf(tree.getByTestId(`dfs-supplier-${OLD.id}-basis`).props.children)).toBe('Typed Oct 1. No record of who gave it.');
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-edit-dates')); });
    await settle();
    // Neither source is picked, and the form says what the record says.
    expect(tree.getByTestId('dfs-source-supplier_said').props.accessibilityState).toEqual({ selected: false });
    expect(tree.getByTestId('dfs-source-typed').props.accessibilityState).toEqual({ selected: false });
    expect(textOf(tree.getByTestId('dfs-source-unrecorded'))).toBe('Typed Oct 1. No record of who gave it.');
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-task-pick')); });
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-task-W')); });
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-edit-save')); });
    await settle();
    const saved = (await storedDeliveries())[0];
    expect(saved).toMatchObject({ id: OLD.id, taskId: 'W', expectedDate: '2026-10-16', taskStartSeen: '2026-11-18' });
    // No history entry, so nothing claims the supplier said a date nobody recorded; and no promise locked on it.
    expect(saved.dateHistory).toBeUndefined();
    expect(saved.promisedDate).toBeUndefined();
  });

  it('the promise comes from the supplier\'s word, and a labelled correction is recorded with who made it', async () => {
    await seed([{ ...OLD, taskId: 'W', bufferDays: 3, taskStartSeen: '2026-11-18' }]);
    const tree = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    await act(async () => { fireEvent.press(tree.getByTestId(`dfs-card-open-${OLD.id}`)); });
    await settle();
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-edit-dates')); });
    await settle();
    // No promise yet: the form says the scorecard counts from the supplier date.
    expect(textOf(tree.getByTestId('dfs-edit-scored-value').props.children)).toBe('No Date');
    expect(textOf(tree.getByTestId('dfs-edit-scored-basis').props.children)).toBe('No date is recorded. The supplier scorecard counts from the supplier date.');
    // The person says the supplier gave this date: that, and only that, makes it the promise.
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-source-supplier_said')); });
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-edit-save')); });
    await settle();
    const saved = (await storedDeliveries())[0] as unknown as Delivery;
    expect(saved.promisedDate).toBe('2026-10-16');
    expect(saved.dateHistory).toHaveLength(1);
    expect(saved.dateHistory?.[0]).toMatchObject({ date: '2026-10-16', previousDate: '2026-10-16', source: 'supplier_said', by: SMOKE_USER.id });
  });

  it('a job started from another keeps its task ids: the task sheet shows and saves to the job it was handed', async () => {
    const OTHER = 'pppppppp-0000-4000-8000-0000000000c2';
    await primeWorld('populated');
    await AsyncStorage.setItem('mageid_projects', JSON.stringify([
      { ...world.project, schedule: SCHEDULE },
      { ...world.project, id: OTHER, name: 'Second Job', schedule: { ...SCHEDULE, id: 'sched-2', projectId: OTHER } },
    ]));
    await AsyncStorage.setItem('mageid_deliveries', JSON.stringify([WINDOWS, { ...TAPE, projectId: OTHER }]));
    const tree = await mountRouteChecked('/dfs-task-probe', () => <TaskDeliveriesSection taskId="W" projectId={OTHER} />, { now: NOW });
    await settle();
    // The second job's own delivery, and not the first job's windows (same task id "W" on both).
    expect(tree.getByTestId(`dfs-card-${TAPE.id}`)).toBeTruthy();
    expect(tree.queryByTestId(`dfs-card-${WINDOWS.id}`)).toBeNull();
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-task-add')); });
    await settle();
    await act(async () => {
      fireEvent.changeText(tree.getByTestId('dfs-what'), 'Door Hardware');
      fireEvent.changeText(tree.getByTestId('dfs-supplier'), 'Harbor Building Supply');
    });
    await act(async () => { fireEvent.press(tree.getByTestId('dfs-edit-save')); });
    await settle();
    const added = (await storedDeliveries()).find((d) => d.description === 'Door Hardware');
    expect(added).toMatchObject({ projectId: OTHER, taskId: 'W' });
  });

  it('one row, not two: a linked delivery is drawn once, in the block, with Confirm and Received on its card', async () => {
    // Linked and late by the old list's reckoning (Oct 10 is before today, Oct 14), and an unlinked dated one.
    const LINKED: Delivery = { ...LUMBER, expectedDate: '2026-10-10', taskStartSeen: '2026-11-02' };
    await seed([LINKED, OLD]);
    const tree = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    const all = ids(tree.toJSON());
    expect(all.filter((id) => id === `dfs-card-${LINKED.id}`)).toHaveLength(1);
    // Not also in the old Late rows.
    expect(all).not.toContain(`receive-${LINKED.id}`);
    expect(all).not.toContain(`confirm-${LINKED.id}`);
    expect(tree.queryByText('1 late')).toBeNull();
    // The unlinked one keeps its old row and is not in the block.
    expect(all).toContain(`receive-${OLD.id}`);
    expect(all).not.toContain(`dfs-card-${OLD.id}`);
    // The card's Confirm is the screen's own confirm.
    await act(async () => { fireEvent.press(tree.getByTestId(`dfs-confirm-${LINKED.id}`)); });
    await settle();
    expect((await storedDeliveries()).find((d) => d.id === LINKED.id)).toMatchObject({ status: 'confirmed' });
    expect(tree.queryByTestId(`dfs-confirm-${LINKED.id}`)).toBeNull();
    // And its Received opens the screen's own receiving sheet.
    await act(async () => { fireEvent.press(tree.getByTestId(`dfs-receive-${LINKED.id}`)); });
    await settle();
    expect(tree.getByText('Receive Delivery')).toBeTruthy();
  });

  it('"No Date Yet" is not a dead end: with the feature closed the base list still shows it, with Received and no Confirm', async () => {
    mockFlagOn = false;
    await seed([TAPE, OLD]);
    const tree = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    const all = ids(tree.toJSON());
    expect(all.filter((id) => id.startsWith('dfs-'))).toEqual([]);
    expect(textOf(tree.getByTestId('deliveries-no-date-title'))).toBe('No Date Yet');
    expect(all).toContain(`receive-${TAPE.id}`);
    expect(all).not.toContain(`confirm-${TAPE.id}`);
    await act(async () => { fireEvent.press(tree.getByTestId(`receive-${TAPE.id}`)); });
    await settle();
    expect(tree.getByText('Receive Delivery')).toBeTruthy();
  });

  it('a write that proves the columns are gone closes the feature at once and has the table asked again', async () => {
    // Linked, and due inside the screen's 7-day window (Fri Oct 16), so it has a place in the old rows too.
    const DUE: Delivery = { ...WINDOWS, expectedDate: '2026-10-16', dateHistory: [said('2026-10-16', '', '2026-10-06T16:00:00.000Z')], promisedDate: '2026-10-16' };
    await seed([DUE]);
    const tree = await mountRouteChecked(`/deliveries?projectId=${PROJECT_ID}`, { now: NOW });
    await settle();
    expect(tree.getByTestId('dfs-block')).toBeTruthy();
    // One row: in the block, not in the old rows.
    expect(ids(tree.toJSON())).not.toContain(`receive-${DUE.id}`);
    // From here the table answers "that column does not exist".
    type Builder = Record<string, (...a: unknown[]) => unknown>;
    const client = supabase as unknown as { from: (table?: string) => Builder };
    const realFrom = client.from;
    let asked = 0;
    jest.spyOn(client, 'from').mockImplementation((table?: string) => {
      const builder = realFrom(table);
      if (table !== 'deliveries') return builder;
      return new Proxy(builder, {
        get(target, prop) {
          if (prop === 'select') {
            return (cols?: string) => (typeof cols === 'string' && cols.includes('task_id')
              ? { limit: async () => { asked++; return { data: null, error: { code: '42703', message: 'column deliveries.task_id does not exist' } }; } }
              : target.select(cols));
          }
          return target[prop as string];
        },
      });
    });
    // What the sync queue does when a delivery write comes back PGRST204 for one of the seven columns.
    await act(async () => { await AsyncStorage.removeItem(DELIVERY_COLUMNS_SEEN_KEY); markColumnsMissing(); });
    await settle();
    expect(tree.queryByTestId('dfs-block')).toBeNull();
    expect(asked).toBeGreaterThan(0);
    expect(await AsyncStorage.getItem(DELIVERY_COLUMNS_SEEN_KEY)).toBeNull();
    // The linked delivery is back in the screen's own rows: nothing is hidden with the feature closed.
    expect(ids(tree.toJSON())).toContain(`receive-${DUE.id}`);
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
