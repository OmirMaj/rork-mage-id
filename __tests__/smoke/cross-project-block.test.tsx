import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { world } from '@/__tests__/fixtures/world';
import type { Project } from '@/types';

// ONE Monday for both screens. Last Planner and /summary read "this week" from
// the same rule — the LOCAL Monday-to-Sunday week of the device
// (utils/calendarDate localWeekStart). Until 2026-10-04 Last Planner took the
// Monday of the UTC date instead, so on a Sunday evening west of Greenwich
// (8 PM to midnight in New York) it was already on next week while /summary
// was still on this one, and this file had to seed each screen with the Monday
// that screen read (75ee6164). Written out here from local components rather
// than imported from the helper under test.
function localMondayISO(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}
const MON = localMondayISO();

function mk(id: string, name: string, tasks: any[], startDate: string = MON): Project {
  return {
    ...(world.project as any),
    id, name,
    schedule: {
      id: `${id}-s`, name: `${name} schedule`, projectId: id,
      startDate, workingDaysPerWeek: 5, bufferDays: 0,
      tasks, totalDurationDays: 10, criticalPathDays: 10, laborAlignmentScore: 0, riskItems: [],
    },
  } as unknown as Project;
}
const task = (o: any) => ({
  title: o.id, phase: 'Drywall', progress: 0, crew: '', dependencies: [], notes: '',
  status: 'not_started', ...o,
});

async function seed(projects: Project[]) {
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(projects));
}

describe('cross-project double-booking on /last-planner', () => {
  beforeEach(async () => { await primeWorld('empty'); });

  it('is NOT hidden behind the paywall for the smoke fixture user', async () => {
    await seed([mk('p1', 'Henderson', [task({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' })])]);
    await mountRouteChecked('/last-planner?projectId=p1');
    expect(screen.queryByText(/Upgrade|Unlock|Paywall/i)).toBeNull();
    expect(screen.queryAllByText(/Lookahead|This week/i).length).toBeGreaterThan(0);
  });

  it('blocks the FIRST commit and names the other job and day', async () => {
    await seed([
      mk('p1', 'Henderson', [task({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall', title: 'Hang drywall' })]),
      mk('p2', 'Ridgeline Job', [task({ id: 't2', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall', title: 'Patch' })]),
    ]);
    await mountRouteChecked('/last-planner?projectId=p1');
    await act(async () => { fireEvent.press(screen.getByText('This week')); });

    expect(screen.getByText(/A crew is booked on two projects this week/)).toBeTruthy();
    const box = screen.getAllByRole('checkbox')[0];
    expect(box.props.accessibilityState.checked).toBe(false);
    await act(async () => { fireEvent.press(box); });
    expect(screen.getAllByRole('checkbox')[0].props.accessibilityState.checked).toBe(false);
    expect(screen.getByText(/Ace Drywall is already committed to Ridgeline Job on/)).toBeTruthy();
    const anyway = screen.getByText('Commit anyway');
    await act(async () => { fireEvent.press(anyway); });
    await waitFor(() => expect(screen.getAllByRole('checkbox')[0].props.accessibilityState.checked).toBe(true));
  });

  it('blocks the SECOND task on the same job too (the non-representative one)', async () => {
    await seed([
      mk('p1', 'Henderson', [
        task({ id: 'z-hang', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall', title: 'Hang drywall' }),
        task({ id: 'a-tape', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall', title: 'Tape drywall' }),
      ]),
      mk('p2', 'Ridgeline Job', [task({ id: 't2', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall', title: 'Patch' })]),
    ]);
    await mountRouteChecked('/last-planner?projectId=p1');
    await act(async () => { fireEvent.press(screen.getByText('This week')); });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBe(2);
    for (const b of boxes) {
      await act(async () => { fireEvent.press(b); });
    }
    // Neither committed; both refused.
    for (const b of screen.getAllByRole('checkbox')) {
      expect(b.props.accessibilityState.checked).toBe(false);
    }
    expect(screen.getAllByText('Commit anyway').length).toBe(2);
  });

  it('negative control: one project commits normally', async () => {
    await seed([mk('p1', 'Henderson', [task({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' })])]);
    await mountRouteChecked('/last-planner?projectId=p1');
    await act(async () => { fireEvent.press(screen.getByText('This week')); });
    expect(screen.queryByText(/A crew is booked on two projects this week/)).toBeNull();
    const box = screen.getAllByRole('checkbox')[0];
    await act(async () => { fireEvent.press(box); });
    await waitFor(() => expect(screen.getAllByRole('checkbox')[0].props.accessibilityState.checked).toBe(true));
    expect(screen.queryByText('Commit anyway')).toBeNull();
  });
});

describe('cross-project double-booking on /summary', () => {
  beforeEach(async () => { await primeWorld('empty'); });

  it('names the crew and both jobs in the week strip', async () => {
    await seed([
      mk('p1', 'Henderson', [task({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' })]),
      mk('p2', 'Ridgeline Job', [task({ id: 't2', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' })]),
    ]);
    await mountRouteChecked('/summary');
    expect(screen.getByText('Double-booked')).toBeTruthy();
    expect(screen.getByText(/Henderson \+ Ridgeline Job/)).toBeTruthy();
  });

  it('negative control: one project shows no Double-booked block', async () => {
    await seed([mk('p1', 'Henderson', [task({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' })])]);
    await mountRouteChecked('/summary');
    expect(screen.queryByText('Double-booked')).toBeNull();
  });
});

// The same six facts at the clocks where the two screens used to part. Local
// wall time: jest cannot change zone inside a run, and the ship gate pins
// TZ=America/New_York, where Sunday 21:00 is Monday 01:00 UTC — the hour this
// suite went red on an untouched main. (Monday 00:30 is the same trap east of
// Greenwich; scripts/validate-calendar-date.ts runs the rule itself under New
// York, Denver, UTC and Tokyo.) Every fixture is dated from ONE Monday.
const CLOCKS: [string, number, string, RegExp, RegExp][] = [
  // label, instant, this week's Monday, the week label, the clash day
  ['Sunday 21:00', new Date(2026, 9, 4, 21, 0, 0).getTime(), '2026-09-28', /Sep 28 – Oct 4/, /on Mon, Sep 28/],
  ['Sunday 23:59', new Date(2026, 9, 4, 23, 59, 0).getTime(), '2026-09-28', /Sep 28 – Oct 4/, /on Mon, Sep 28/],
  ['Monday 00:30', new Date(2026, 9, 5, 0, 30, 0).getTime(), '2026-10-05', /Oct 5 – Oct 11/, /on Mon, Oct 5/],
  ['Wednesday noon', new Date(2026, 9, 7, 12, 0, 0).getTime(), '2026-10-05', /Oct 5 – Oct 11/, /on Mon, Oct 5/],
];

describe.each(CLOCKS)('Last Planner and /summary are on the same week at %s', (_label, now, monday, weekLabel, clashDay) => {
  beforeEach(async () => { await primeWorld('empty'); });

  const twoJobs = (startDate: string) => [
    mk('p1', 'Henderson', [task({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall', title: 'Hang drywall' })], startDate),
    mk('p2', 'Ridgeline Job', [task({ id: 't2', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall', title: 'Patch' })], startDate),
  ];

  it('the test and the app agree which Monday it is', () => {
    expect(localMondayISO(now)).toBe(monday);
  });

  it('Last Planner opens on that week and blocks the double-booked commit', async () => {
    await seed(twoJobs(monday));
    await mountRouteChecked('/last-planner?projectId=p1', { now });
    await act(async () => { fireEvent.press(screen.getByText('This week')); });
    expect(screen.getAllByText(weekLabel).length).toBeGreaterThan(0);
    expect(screen.getByText(/A crew is booked on two projects this week/)).toBeTruthy();
    const box = screen.getAllByRole('checkbox')[0];
    await act(async () => { fireEvent.press(box); });
    expect(screen.getAllByRole('checkbox')[0].props.accessibilityState.checked).toBe(false);
    expect(screen.getByText(/Ace Drywall is already committed to Ridgeline Job on/)).toBeTruthy();
    expect(screen.getByText(clashDay)).toBeTruthy();
  });

  it('/summary shows the same clash in its week strip', async () => {
    await seed(twoJobs(monday));
    await mountRouteChecked('/summary', { now });
    expect(screen.getByText('Double-booked')).toBeTruthy();
    expect(screen.getByText(/Henderson \+ Ridgeline Job/)).toBeTruthy();
  });

  // The other direction: the same seed, one week later, is "this week" on
  // NEITHER screen. (On the UTC rule Last Planner showed it on Sunday evening.)
  const weekAfter = () => {
    const d = new Date(`${monday}T12:00:00`);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  };

  it('work dated the week AFTER is not this week on Last Planner', async () => {
    await seed(twoJobs(weekAfter()));
    await mountRouteChecked('/last-planner?projectId=p1', { now });
    await act(async () => { fireEvent.press(screen.getByText('This week')); });
    expect(screen.getAllByText(weekLabel).length).toBeGreaterThan(0);
    expect(screen.queryByText(/A crew is booked on two projects this week/)).toBeNull();
  });

  it('…and not this week on /summary either', async () => {
    await seed(twoJobs(weekAfter()));
    await mountRouteChecked('/summary', { now });
    expect(screen.queryByText('Double-booked')).toBeNull();
  });
});
