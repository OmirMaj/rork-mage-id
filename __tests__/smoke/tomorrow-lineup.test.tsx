/**
 * List-2 lane I — Tomorrow's lineup, mounted in the real app.
 *
 * A job whose schedule starts today on a 7-day week, so the next working day
 * is always tomorrow (schedule day 2). Seeds two subs with work, one task with
 * no sub, a delivery on Acme's subcontract, a confirmed freight-elevator slot
 * and a scheduled inspection. Checks the per-sub messages, the gaps block, and
 * that Send reaches the share sheet only when pressed. The golden (recorded on
 * the first run) is each message and the gaps, with the day phrase masked.
 * Also checks the door on /last-planner.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { world } from '@/__tests__/fixtures/world';
import { encodePermitInspectionNotes } from '@/utils/permitInspectionHistory';
import { toCalendarDayString, addCalendarDays } from '@/utils/calendarDate';
import type { Project } from '@/types';

const mockShare = jest.fn(async (_opts: { message: string }) => 'shared' as const);
jest.mock('@/utils/shareText', () => ({
  shareText: (opts: { message: string }) => mockShare(opts),
  canShare: () => true,
}));

const today = new Date();
const TODAY = toCalendarDayString(today);
const TOMORROW = toCalendarDayString(addCalendarDays(new Date(today.getFullYear(), today.getMonth(), today.getDate()), 1));
const A = 'sub-lu-1';
const B = 'sub-lu-2';
const P = 'proj-lu-1';

const task = (o: Record<string, unknown>) => ({ phase: '', progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o });
const project = {
  ...(world.project as unknown as Record<string, unknown>),
  id: P, name: 'Main St Reno', location: '123 Main St',
  schedule: {
    id: `${P}-s`, name: 'Main schedule', projectId: P, startDate: TODAY, workingDaysPerWeek: 7, bufferDays: 0,
    totalDurationDays: 10, criticalPathDays: 10, laborAlignmentScore: 0, riskItems: [],
    tasks: [
      task({ id: 't-hang', title: 'Hang board', phase: '2nd fl', startDay: 1, durationDays: 3, assignedSubId: A }),
      task({ id: 't-rough', title: 'Electrical rough', startDay: 2, durationDays: 1, assignedSubId: B }),
      task({ id: 't-clean', title: 'Site clean-up', startDay: 2, durationDays: 1 }),
      task({ id: 't-done', title: 'Demo', startDay: 1, durationDays: 3, status: 'done', assignedSubId: B }),
    ],
  },
} as unknown as Project;
const subs = [
  { id: A, companyName: 'Acme Drywall', contactName: '', phone: '(555) 800-0001', email: '', address: '', trade: 'Drywall', licenseNumber: '', licenseExpiry: '', coiExpiry: '', w9OnFile: true, bidHistory: [], assignedProjects: [], notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: B, companyName: 'Bolt Electric', contactName: '', phone: '', email: '', address: '', trade: 'Electrical', licenseNumber: '', licenseExpiry: '', coiExpiry: '', w9OnFile: false, bidHistory: [], assignedProjects: [], notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
];
const commitments = [
  { id: 'k-lu-1', projectId: P, number: 'SC-1', type: 'subcontract', subcontractorId: A, description: 'Drywall', amount: 10000, signedDate: TODAY, status: 'executed', createdAt: TODAY, updatedAt: TODAY },
];
const deliveries = [
  { id: 'd-lu-1', projectId: P, description: 'Board', supplier: 'ABC Supply', commitmentId: 'k-lu-1', expectedDate: TOMORROW, window: '08:00-09:00', status: 'confirmed', createdAt: TODAY, updatedAt: TODAY },
];
const reservations = [
  { id: 'r-lu-1', projectId: P, kind: 'freight_elevator', date: TOMORROW, window: '07:00-09:00', status: 'confirmed', confirmationRef: 'BK-7', createdAt: TODAY, updatedAt: TODAY },
];
const permits = [
  {
    id: 'pm-lu-1', projectId: P, projectName: 'Main St Reno', type: 'plumbing', jurisdiction: 'NYC DOB', status: 'approved',
    appliedDate: TODAY, fee: 0,
    inspectionNotes: encodePermitInspectionNotes('', [{ id: 'i-lu-1', name: 'Plumbing rough', scheduledFor: TOMORROW, result: 'scheduled', recordedAt: `${TODAY}T12:00:00.000Z` }]),
  },
];

async function mount(url: string) {
  await primeWorld('empty');
  await AsyncStorage.setItem('mageid_projects', JSON.stringify([project]));
  await AsyncStorage.setItem('mageid_subcontractors', JSON.stringify(subs));
  await AsyncStorage.setItem('mageid_commitments', JSON.stringify(commitments));
  await AsyncStorage.setItem('mageid_deliveries', JSON.stringify(deliveries));
  await AsyncStorage.setItem('mageid_access_reservations', JSON.stringify(reservations));
  await AsyncStorage.setItem('mageid_permits', JSON.stringify(permits));
  const tree = await mountRouteChecked(url);
  for (let i = 0; i < 4; i++) {
    await act(async () => { try { jest.advanceTimersByTime(300); } catch { /* real timers */ } for (let k = 0; k < 20; k++) await Promise.resolve(); });
  }
  return tree;
}

const mask = (s: string) => s.replace(/tomorrow \([^)]*\)|on [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}/g, '<day>');

// The shared expo-notifications mock (__tests__/setup/edge-mocks.js) has no
// WEEKLY trigger type and no getAllScheduledNotificationsAsync; add them here
// for this file only (the shared setup is not edited).
type NotifMock = Record<string, jest.Mock> & { SchedulableTriggerInputTypes: Record<string, string> };
const N = jest.requireMock('expo-notifications') as NotifMock;
let osPermission = 'undetermined';
let promptAnswer = 'granted';

beforeEach(() => {
  mockShare.mockClear(); allowConsoleErrors();
  N.SchedulableTriggerInputTypes.WEEKLY = 'weekly';
  N.getAllScheduledNotificationsAsync = jest.fn(async () => []);
  osPermission = 'undetermined'; promptAnswer = 'granted';
  N.getPermissionsAsync.mockImplementation(async () => ({ status: osPermission, granted: osPermission === 'granted' }));
  N.requestPermissionsAsync.mockImplementation(async () => { osPermission = promptAnswer; return { status: promptAnswer, granted: promptAnswer === 'granted' }; });
});

const flush = async () => { await act(async () => { for (let k = 0; k < 20; k++) await Promise.resolve(); }); };


describe("tomorrow's lineup", () => {
  jest.setTimeout(120000);

  it('one message per sub, from the records (golden)', async () => {
    await mount(`/tomorrow-lineup?projectId=${P}`);
    const a = screen.getByTestId(`lineup-draft-${A}`).props.value as string;
    const b = screen.getByTestId(`lineup-draft-${B}`).props.value as string;
    expect(a).toContain('Hang board (2nd fl)');
    expect(a).toContain('freight elevator booked 07:00-09:00, ref BK-7');
    expect(a).toContain('Board from ABC Supply, window 08:00-09:00');
    expect(a).toContain('Plumbing rough inspection — time not set');
    expect(b).toContain('Electrical rough');
    expect(b).not.toContain('Board from ABC Supply');
    expect(b).not.toContain('Demo');
    expect(screen.getByText(/No phone or email on file/)).toBeTruthy();
    expect(screen.getByTestId('lineup-gaps')).toBeTruthy();
    expect(screen.getByText(/1 task tomorrow has no sub assigned — it's not in any message: Site clean-up\./)).toBeTruthy();
    expect(mockShare).not.toHaveBeenCalled();
    expect({ a: mask(a), b: mask(b) }).toMatchSnapshot();
  });

  it('Send reaches the share sheet only when pressed, with his edits', async () => {
    await mount(`/tomorrow-lineup?projectId=${P}`);
    expect(mockShare).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId(`lineup-draft-${A}`), 'Edited lineup text');
    expect(mockShare).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId(`lineup-send-${A}`)); });
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare.mock.calls[0][0].message).toBe('Edited lineup text');
  });

  it('the 3 pm reminder: on schedules five weekly reminders, asking permission only then', async () => {
    await mount(`/tomorrow-lineup?projectId=${P}`);
    expect(screen.getByText(/It can’t see your schedule, so it rings even when tomorrow is empty\. Nothing is sent to your subs/)).toBeTruthy();
    const sw = screen.getByTestId('lineup-reminder-switch');
    expect(sw.props.value).toBe(false);
    expect(sw.props.accessibilityLabel).toBe('Remind me at 3 pm on weekdays');
    N.requestPermissionsAsync.mockClear();
    N.scheduleNotificationAsync.mockClear();
    await act(async () => { fireEvent(sw, 'valueChange', true); });
    await flush();
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(5);
    const reqs = N.scheduleNotificationAsync.mock.calls.map(c => c[0] as { identifier: string; content: { data: unknown }; trigger: { type: string; weekday: number; hour: number; minute: number } });
    expect(reqs.map(r => r.trigger.type)).toEqual(['weekly', 'weekly', 'weekly', 'weekly', 'weekly']);
    expect(reqs.map(r => r.trigger.weekday)).toEqual([2, 3, 4, 5, 6]);
    expect(reqs.every(r => r.trigger.hour === 15 && r.trigger.minute === 0)).toBe(true);
    expect(reqs.every(r => JSON.stringify(r.content.data) === '{"kind":"tomorrow_lineup"}')).toBe(true);
    expect(screen.getByTestId('lineup-reminder-switch').props.value).toBe(true);
    expect(mockShare).not.toHaveBeenCalled();

    N.cancelScheduledNotificationAsync.mockClear();
    N.scheduleNotificationAsync.mockClear();
    await act(async () => { fireEvent(screen.getByTestId('lineup-reminder-switch'), 'valueChange', false); });
    await flush();
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(5);
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('lineup-reminder-switch').props.value).toBe(false);
  });

  it('the 3 pm reminder: permission denied says so and stays off', async () => {
    promptAnswer = 'denied';
    await mount(`/tomorrow-lineup?projectId=${P}`);
    N.scheduleNotificationAsync.mockClear();
    await act(async () => { fireEvent(screen.getByTestId('lineup-reminder-switch'), 'valueChange', true); });
    await flush();
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Notifications are off for MAGE ID. Turn them on in Settings to get this reminder.')).toBeTruthy();
    expect(screen.getByTestId('lineup-reminder-switch').props.value).toBe(false);
  });

  it('the 3 pm reminder: reads on from the OS schedule, and says so when it cannot read it', async () => {
    N.getAllScheduledNotificationsAsync = jest.fn(async () => [2, 3, 4, 5, 6].map(w => ({ identifier: `mageid-lineup-reminder-${w}` })));
    await mount(`/tomorrow-lineup?projectId=${P}`);
    expect(screen.getByTestId('lineup-reminder-switch').props.value).toBe(true);
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('the 3 pm reminder: an unreadable schedule reads off with a sentence', async () => {
    N.getAllScheduledNotificationsAsync = jest.fn(async () => { throw new Error('nope'); });
    await mount(`/tomorrow-lineup?projectId=${P}`);
    expect(screen.getByTestId('lineup-reminder-switch').props.value).toBe(false);
    expect(screen.getByText('Couldn’t check whether the reminder is on.')).toBeTruthy();
  });

  it('/last-planner carries the door to the lineup', async () => {
    await mount(`/last-planner?projectId=${P}`);
    expect(screen.getByTestId('lineup-link')).toBeTruthy();
    expect(screen.getByText("Tomorrow's lineup — a ready-to-send text per sub")).toBeTruthy();
  });
});
