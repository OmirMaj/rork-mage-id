/**
 * Smoke — the owner's Demo Job builder (lane DEMOJOB): components/demoJob/DemoJobScreen,
 * hooks/useDemoJobCopy, utils/demoJob/writer.
 *
 * No network and no real context: the screen is handed a stand-in app
 * (__tests__/fixtures/demoJobFakeApp) whose add functions behave like the real
 * ones (most build on the list as of the last render). The pure rules (the
 * numbers, the schedule, the liability rules, removal) are run under bun by
 * scripts/validate-demo-job.ts; this file proves what the SCREEN does.
 *
 *   1  nothing in the account: the plain sentence, one Create button, no Remove
 *   2  Create writes the whole job and shows each area's count ("Daily Reports: 30 of 30")
 *   3  while a job exists there is no Create button (one demo at a time)
 *   4  a job cut off part way opens as "Finish Creating" or "Remove", and finishing adds no duplicate
 *   5  offline: said on the screen, the rest is written, the online-only parts are named
 *   6  one failed area is reported in plain words and the rest continues
 *   7  Remove asks first, then deletes everything, and Create comes back with a new id
 *   8  a removal the app refuses is said, and nothing is deleted
 *   9  before the app has read its project list: still checking, no button, nothing written
 *  10  two taps on Create in one frame make one job
 *  11  a job that only has the demo's name is not the builder's: not counted, not offered for removal
 *  12  the confirmation names every job it will delete, and how many
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DemoJobScreen } from '@/components/demoJob/DemoJobScreen';
import { useDemoJobCopy } from '@/hooks/useDemoJobCopy';
import { buildDemoJob } from '@/utils/demoJob/build';
import { createDemoJob } from '@/utils/demoJob/writer';
import { fakeRecordCount, makeFakeApp, type FakeApp } from '../fixtures/demoJobFakeApp';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const value = { colors: { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') }, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});

jest.mock('@/contexts/LanguageContext', () => {
  const t = (_key: string, english: string, vars?: Record<string, unknown>) => english.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name]));
  const value = { t, language: 'en' };
  return { useT: () => value };
});

const USER = 'user-0001';
const TODAY = '2026-10-09';
let nextId = 0;
const newProjectId = () => `00000000-0000-4000-8000-${String((nextId += 1)).padStart(12, '0')}`;

function Harness({ app, offline = false, ready = true, onOpenJob = () => {} }: { app: FakeApp; offline?: boolean; ready?: boolean; onOpenJob?: (id: string) => void }) {
  const copy = useDemoJobCopy();
  return (
    <DemoJobScreen
      ports={app.ports}
      copy={copy}
      userId={USER}
      contractorName="Example Builder"
      today={TODAY}
      newProjectId={newProjectId}
      offline={offline}
      ready={ready}
      topInset={0}
      onBack={() => {}}
      onOpenJob={onOpenJob}
      startDateOf={(id) => (app.lists.projects.find((p) => p.id === id) as { schedule?: { startDate?: string } } | undefined)?.schedule?.startDate ?? null}
    />
  );
}

/** Let the screen's async work (status read, the writer's loop) run to the end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    if (!screen.queryByText('Checking for a demo job.') && !screen.queryByText('Creating the demo job. Keep this screen open.') && !screen.queryByText('Removing the demo job.')) return;
  }
}

async function mount(app: FakeApp, props: { offline?: boolean; ready?: boolean; onOpenJob?: (id: string) => void } = {}) {
  render(<Harness app={app} {...props} />);
  await settle();
}

const press = async (testID: string) => {
  fireEvent.press(screen.getByTestId(testID));
  await settle();
};

beforeEach(() => { nextId = 0; });

describe('the Demo Job builder', () => {
  it('1  with no demo job: says what it does, offers Create, nothing to remove', async () => {
    const app = makeFakeApp();
    await mount(app);
    expect(screen.getByTestId('demo-job-intro').props.children).toBe('This creates a made-up job in your account so you can try every screen. Nothing is sent to anyone. Remove it any time.');
    expect(screen.getByTestId('demo-job-state').props.children).toBe('There is no demo job in your account.');
    expect(screen.getByTestId('demo-job-create')).toBeTruthy();
    expect(screen.queryByTestId('demo-job-remove')).toBeNull();
    expect(screen.queryByTestId('demo-job-finish')).toBeNull();
    expect(screen.queryByTestId('demo-job-areas')).toBeNull();
    expect(app.adds()).toBe(0);
  });

  it('2 and 3  Create writes the whole job once, shows the counts, and leaves no Create button', async () => {
    const app = makeFakeApp();
    const opened: string[] = [];
    await mount(app, { onOpenJob: (id) => opened.push(id) });
    await press('demo-job-create');
    expect(screen.getByTestId('demo-job-state').props.children).toBe('The demo job is in your account.');
    expect(app.lists.projects).toHaveLength(1);
    expect((app.lists.projects[0] as { name: string }).name).toBe('Sample — Demo: Harbor Point Mixed-Use');
    expect(screen.getByTestId('demo-job-area-project').props.children).toBe('Schedule Tasks: 120 of 120');
    expect(screen.getByTestId('demo-job-area-dailyReports').props.children).toBe('Daily Reports: 30 of 30');
    expect(screen.getByTestId('demo-job-area-payApps').props.children).toBe('Pay Applications: 9 of 9');
    expect(screen.getByTestId('demo-job-area-changeOrders').props.children).toBe('Change Orders: 10 of 10');
    expect(screen.getByTestId('demo-job-area-model').props.children).toBe('Living Model: 1 of 1');
    expect(app.models.size).toBe(1);
    expect(app.lists.safetyIncidents).toHaveLength(0);
    expect(screen.queryByTestId('demo-job-create')).toBeNull();
    expect(screen.queryByTestId('demo-job-finish')).toBeNull();
    expect(screen.getByTestId('demo-job-remove')).toBeTruthy();
    fireEvent.press(screen.getByTestId('demo-job-open'));
    expect(opened).toEqual([app.lists.projects[0].id]);
    // Nothing but the app's own add functions, the three engines, the two assets and the model store was called.
    expect([...new Set(app.log)].sort()).toEqual([
      'addAIAPayApp', 'addCOI', 'addChangeOrders', 'addCommitment', 'addContact', 'addCrewMember', 'addDailyReport', 'addDelayEvent', 'addDelivery',
      'addEquipment', 'addFieldTicket', 'addHazard', 'addInvoice', 'addManualEntry', 'addOACMeeting', 'addPermit', 'addProject', 'addProjectPhoto',
      'addPunchItems', 'addRFIs', 'addReservation', 'addSubcontractor', 'addSubmittals', 'addToolboxTalk', 'addWarranty', 'ensurePlan', 'saveContract',
      'saveJobModel', 'saveLienWaiver', 'saveSelection', 'setBuildingAccess',
    ]);
  });

  it('4  a job cut off part way opens as Finish Creating or Remove, and finishing adds no duplicate', async () => {
    const app = makeFakeApp();
    const job = buildDemoJob({ userId: USER, projectId: newProjectId(), today: TODAY, contractorName: 'Example Builder' });
    app.set({ stopAfterAdds: 60 });
    await createDemoJob(job, app.ports, () => {}).catch(() => undefined);
    app.set({ stopAfterAdds: null });
    const whole = makeFakeApp();
    await createDemoJob(job, whole.ports, () => {});

    await mount(app);
    expect(screen.getByTestId('demo-job-state').props.children).toBe('A demo job was started and is not finished. Finish creating it or remove it.');
    expect(screen.queryByTestId('demo-job-create')).toBeNull();
    expect(screen.getByTestId('demo-job-finish')).toBeTruthy();
    expect(screen.getByTestId('demo-job-remove')).toBeTruthy();
    expect(screen.getByTestId('demo-job-area-dailyReports').props.children).toBe('Daily Reports: 0 of 30');
    await press('demo-job-finish');
    expect(screen.getByTestId('demo-job-state').props.children).toBe('The demo job is in your account.');
    expect(app.lists.projects).toHaveLength(1);
    expect(app.lists.projects[0].id).toBe(job.project.id);
    expect(fakeRecordCount(app)).toBe(fakeRecordCount(whole));
  });

  it('5  offline: the screen says so, the job is written, the online-only parts are named', async () => {
    const app = makeFakeApp();
    app.set({ online: false });
    await mount(app, { offline: true });
    expect(screen.getByTestId('demo-job-offline')).toBeTruthy();
    await press('demo-job-create');
    expect(app.lists.dailyReports).toHaveLength(30);
    expect(app.engineRows.lienWaivers.size).toBe(0);
    expect(screen.getByTestId('demo-job-state').props.children).toBe('A demo job was started and is not finished. Finish creating it or remove it.');
    for (const key of ['lienWaivers', 'contract', 'selections', 'planSheet']) expect(screen.getByTestId(`demo-job-failed-${key}`)).toBeTruthy();
    expect(screen.queryByTestId('demo-job-failed-dailyReports')).toBeNull();
    app.set({ online: true });
    await press('demo-job-finish');
    expect(screen.getByTestId('demo-job-state').props.children).toBe('The demo job is in your account.');
    expect(app.engineRows.lienWaivers.size).toBe(6);
  });

  it('6  one failed area is reported in plain words and the rest continues', async () => {
    const app = makeFakeApp();
    app.set({ photoUri: null });
    await mount(app);
    await press('demo-job-create');
    const line = screen.getByTestId('demo-job-failed-photos').props.children as string;
    expect(line).toContain('Not Written');
    expect(line).toContain('sample photo could not be read');
    expect(app.lists.projectPhotos).toHaveLength(0);
    expect(app.models.size).toBe(1);
    expect(screen.getByTestId('demo-job-area-photos').props.children).toBe('Photos: 0 of 4');
    expect(screen.getByTestId('demo-job-finish')).toBeTruthy();
  });

  it('7  Remove asks first, deletes everything, and a new job gets a new id', async () => {
    const app = makeFakeApp();
    app.lists.subcontractors.push({ id: 'his-own-sub' });
    await mount(app);
    await press('demo-job-create');
    const firstId = app.lists.projects[0].id;
    fireEvent.press(screen.getByTestId('demo-job-remove'));
    // Asking is not removing, and the question names the job and the count.
    expect(screen.getByTestId('demo-job-remove-names').props.children).toBe('Remove 1 demo job and everything created with it? The job is Sample — Demo: Harbor Point Mixed-Use. This cannot be undone.');
    expect(app.lists.projects).toHaveLength(1);
    fireEvent.press(screen.getByTestId('demo-job-remove-cancel'));
    expect(app.lists.projects).toHaveLength(1);
    fireEvent.press(screen.getByTestId('demo-job-remove'));
    await press('demo-job-remove-confirm');
    expect(fakeRecordCount(app)).toBe(1);
    expect(app.lists.subcontractors).toEqual([{ id: 'his-own-sub' }]);
    expect(app.models.size).toBe(0);
    expect(screen.getByTestId('demo-job-message').props.children).toBe('The demo job was removed.');
    expect(screen.getByTestId('demo-job-state').props.children).toBe('There is no demo job in your account.');
    await press('demo-job-create');
    expect(app.lists.projects).toHaveLength(1);
    expect(app.lists.projects[0].id).not.toBe(firstId);
  });

  it('8  a removal the app refuses is said, and nothing is deleted', async () => {
    const app = makeFakeApp();
    await mount(app);
    await press('demo-job-create');
    app.lists.safetyIncidents.push({ id: 'incident-1', projectId: app.lists.projects[0].id });
    const before = fakeRecordCount(app);
    fireEvent.press(screen.getByTestId('demo-job-remove'));
    await press('demo-job-remove-confirm');
    expect(fakeRecordCount(app)).toBe(before);
    expect(app.serverDeletes).toHaveLength(0);
    // The app's own delete was handed the id and no count, so it is the one that asks.
    expect(app.deleteCalls).toEqual([{ id: app.lists.projects[0].id, opts: undefined }]);
    expect(screen.getByTestId('demo-job-message').props.children).toBe('The demo job was not removed. This job has a safety incident on it. Those records are kept.');
    expect(screen.getByTestId('demo-job-remove')).toBeTruthy();
  });

  it('9  before the app has read its project list: still checking, no button, nothing written', async () => {
    const app = makeFakeApp();
    app.set({ ready: false });
    await mount(app, { ready: false });
    expect(screen.getByTestId('demo-job-state').props.children).toBe('Checking for a demo job.');
    expect(screen.queryByTestId('demo-job-create')).toBeNull();
    expect(screen.queryByTestId('demo-job-finish')).toBeNull();
    expect(screen.queryByTestId('demo-job-remove')).toBeNull();
    expect(app.adds()).toBe(0);
  });

  it('10  two taps on Create in one frame make one job', async () => {
    const whole = makeFakeApp();
    const job = buildDemoJob({ userId: USER, projectId: newProjectId(), today: TODAY, contractorName: 'Example Builder' });
    await createDemoJob(job, whole.ports, () => {});
    const app = makeFakeApp();
    await mount(app);
    const button = screen.getByTestId('demo-job-create');
    // Both presses land before the screen draws again, so both see the same enabled button.
    act(() => { fireEvent.press(button); fireEvent.press(button); });
    await settle();
    expect(app.lists.projects).toHaveLength(1);
    expect(app.log.filter((l) => l === 'addProject')).toHaveLength(1);
    expect(app.adds()).toBe(whole.adds());
    expect(fakeRecordCount(app)).toBe(fakeRecordCount(whole));
  });

  it('11  a job that only has the demo name is not the builder\'s: not counted, not offered for removal', async () => {
    const app = makeFakeApp();
    app.lists.projects.push({ id: 'hand-named', name: 'Sample — Demo: Harbor Point Mixed-Use' });
    await mount(app);
    expect(screen.getByTestId('demo-job-state').props.children).toBe('There is no demo job in your account.');
    expect(screen.queryByTestId('demo-job-remove')).toBeNull();
    await press('demo-job-create');
    expect(app.lists.projects).toHaveLength(2);
    fireEvent.press(screen.getByTestId('demo-job-remove'));
    await press('demo-job-remove-confirm');
    expect(app.lists.projects).toEqual([{ id: 'hand-named', name: 'Sample — Demo: Harbor Point Mixed-Use' }]);
    expect(app.deleteCalls.map((c) => c.id)).not.toContain('hand-named');
  });

  it('12  the confirmation names every job it will delete, and how many', async () => {
    const app = makeFakeApp();
    await mount(app);
    await press('demo-job-create');
    // A second stamped job (made on another device before this one synced).
    app.lists.projects.push({ id: 'second-demo', name: 'Sample — Demo: Harbor Point Mixed-Use', leadSource: 'mage_demo_job' });
    const firstId = app.lists.projects.find((p) => p.id !== 'second-demo')!.id;
    fireEvent.press(screen.getByTestId('demo-job-remove'));
    expect(screen.getByTestId('demo-job-remove-names').props.children).toBe('Remove 2 demo jobs and everything created with them? The jobs are Sample — Demo: Harbor Point Mixed-Use, Sample — Demo: Harbor Point Mixed-Use. This cannot be undone.');
    await press('demo-job-remove-confirm');
    expect(app.lists.projects).toHaveLength(0);
    expect(app.deleteCalls.map((c) => c.id).sort()).toEqual([firstId, 'second-demo'].sort());
  });
});
