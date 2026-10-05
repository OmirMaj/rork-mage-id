import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { world } from '@/__tests__/fixtures/world';
import type { Project } from '@/types';

function mondayISO(): string {
  const d = new Date();
  const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(ms).getUTCDay();
  const shift = dow === 0 ? -6 : 1 - dow;
  return new Date(ms + shift * 86400000).toISOString().slice(0, 10);
}
const MON = mondayISO();

// Two screens, two definitions of "this week". Last Planner keys its week on
// the UTC Monday (utils/lastPlanner toMonday — mondayISO above mirrors it);
// the /summary strip keys on the LOCAL Monday (utils/summaryBriefing
// computeWeekLoad). West of Greenwich the two are different weeks from Sunday
// evening until local midnight, so each block seeds the Monday its own screen
// reads — one shared Monday made the /summary case fail in that window.
function localMondayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
const MON_LOCAL = localMondayISO();

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
      mk('p1', 'Henderson', [task({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' })], MON_LOCAL),
      mk('p2', 'Ridgeline Job', [task({ id: 't2', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' })], MON_LOCAL),
    ]);
    await mountRouteChecked('/summary');
    expect(screen.getByText('Double-booked')).toBeTruthy();
    expect(screen.getByText(/Henderson \+ Ridgeline Job/)).toBeTruthy();
  });

  it('negative control: one project shows no Double-booked block', async () => {
    await seed([mk('p1', 'Henderson', [task({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' })], MON_LOCAL)]);
    await mountRouteChecked('/summary');
    expect(screen.queryByText('Double-booked')).toBeNull();
  });
});
