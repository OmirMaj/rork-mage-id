/**
 * Smoke — "Your First Job", the interactive starter path on Home (lane FIRSTJOB).
 *
 * THE PROMISES THIS PROVES, on the mounted card with the real rules, the real
 * signals hook and the real store (only the contexts, the network and the
 * device storage are stood in for):
 *   S1 a new contractor is asked the one question; answering it shows the
 *      path with that answer's step first and exactly one step open;
 *   S2 mid-path: done steps come from the account's data, the ring and the
 *      line say where he is, a locked step names its plan before the tap,
 *      "Show Me First" is there only where a tutorial exists;
 *   S3 a tap never marks a step done; coming back with the work done does
 *      (the line says what is next, the event says in or out of order);
 *   S4 Skip, Hide (one small row that reopens) and Remove (for good);
 *   S5 the finish state shows once, then the card is gone;
 *   S6 a property owner sees nothing, an invited field seat and a switched-off
 *      flag get the old card, an established account never sees it.
 *
 * The pure rules have their own direct tests with planted mutations in
 * scripts/validate-first-job-path.ts.
 */

import React from 'react';
import { act, cleanupAsync, fireEvent, render } from '@testing-library/react-native';

let mockReduced = false;
jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, nativeDriver: false, reducedMotion: () => mockReduced, useReducedMotion: () => mockReduced, layoutNext: () => {} };
});

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});

const mockPush = jest.fn();
let mockFocused = true;
const mockFocusListeners = new Set<() => void>();
jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, back: () => {}, replace: () => {} }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      const focused = R.useSyncExternalStore(
        (l: () => void) => { mockFocusListeners.add(l); return () => { mockFocusListeners.delete(l); }; },
        () => mockFocused,
      );
      R.useEffect(() => (focused ? cb() : undefined), [cb, focused]);
    },
  };
});

type MockProject = {
  id: string; name: string; ownerUserId?: string; myRole?: string; updatedAt?: string;
  estimate: null | { materials: unknown[] }; linkedEstimate?: { items: unknown[] } | null;
  schedule?: { tasks: unknown[] } | null;
};
let mockCtx: {
  projects: MockProject[]; userRole: string | null; settings: { branding?: { companyName?: string } } | null;
  dailyReports: { projectId: string }[];
  projectsLoaded: boolean; settingsLoaded: boolean; invoicesLoaded: boolean; dailyReportsLoaded: boolean;
};
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => mockCtx }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
let mockTier: 'free' | 'pro' = 'pro';
jest.mock('@/contexts/SubscriptionContext', () => ({ useSubscription: () => ({ tier: mockTier }) }));
let mockSeeds: unknown[] = [];
jest.mock('@/hooks/useCostSeeds', () => ({ useCostSeeds: () => ({ seeds: mockSeeds, isLoading: false }) }));
let mockContracts: { data: string[] | undefined; isError: boolean; isFetching: boolean } = { data: [], isError: false, isFetching: false };
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ ...mockContracts, refetch: async () => {} }) }));
jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) } },
}));
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => { mockStore.set(k, v); },
    removeItem: async (k: string) => { mockStore.delete(k); },
  },
}));
jest.mock('@/utils/tutorial/progress', () => ({ useTutorialProgress: () => ({ progress: { byId: {}, chips: {}, active: null, lastChipDay: null } }) }));
const mockStartTutorial = jest.fn(async () => true);
jest.mock('@/utils/tutorial/store', () => ({ startTutorial: (...a: unknown[]) => mockStartTutorial(...(a as [])) }));
const mockTrack = jest.fn();
jest.mock('@/utils/analytics', () => {
  const actual = jest.requireActual('@/utils/analytics');
  return { ...actual, track: (...a: unknown[]) => mockTrack(...a) };
});
jest.mock('@/utils/aiRateLimiter', () => ({ getFreeTrialsRemaining: async () => 2 }));
let mockFlag = true;
jest.mock('@/constants/featureFlags', () => {
  const actual = jest.requireActual('@/constants/featureFlags');
  // defineProperty, not an object-literal getter: the transform copies a
  // literal getter's value once, at mock time, before mockFlag is set.
  const mod = { ...actual };
  Object.defineProperty(mod, 'FIRST_JOB_PATH_ENABLED', { enumerable: true, get: () => mockFlag });
  return mod;
});
jest.mock('expo-haptics', () => ({
  selectionAsync: async () => {}, impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 'light' },
}));

/* eslint-disable import/first */
import { FirstJobPath } from '@/components/FirstJobPath';
import type { OnboardingChecklistProps } from '@/components/OnboardingChecklist';
import { resetBudget } from '@/components/motion/kit';
import { firstJobSentKey, firstJobStateKey, serializeStored, EMPTY_STORED, type FirstJobStored } from '@/utils/firstJobPath';
import { markEstimateSent } from '@/utils/firstJobStore';
/* eslint-enable import/first */

const advance = (ms: number) => { for (let left = ms; left > 0; left -= 16) act(() => { jest.advanceTimersByTime(Math.min(16, left)); }); };
const flush = async () => { await act(async () => { for (let k = 0; k < 12; k++) await Promise.resolve(); }); };

const BASE: OnboardingChecklistProps = {
  companyInfoDone: false, projectCount: 0, estimateCount: 0, stripeConnected: false, invoiceCount: 0, triedWowFeature: false,
};
const REAL_JOB: MockProject = { id: 'p1', name: 'Kitchen', ownerUserId: 'u1', updatedAt: '2026-10-01T00:00:00Z', estimate: null };
const save = (s: Partial<FirstJobStored>) => mockStore.set(firstJobStateKey('u1'), serializeStored({ ...EMPTY_STORED, ...s }));
const saved = (): FirstJobStored => JSON.parse(mockStore.get(firstJobStateKey('u1')) ?? 'null');

async function mount(p: Partial<OnboardingChecklistProps> = {}) {
  const r = render(<FirstJobPath {...BASE} {...p} />);
  await flush();
  advance(400);
  return r;
}
/** The card is memoised on its props; a changed prop makes it read the stood-in contexts again. */
let bump = false;
async function again(r: ReturnType<typeof render>, p: Partial<OnboardingChecklistProps> = {}) {
  bump = !bump;
  r.rerender(<FirstJobPath {...BASE} {...p} stripeCheckFailed={bump} />);
  await flush();
  advance(400);
}
const eventsNamed = (name: string) => mockTrack.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = false;
  mockFocused = true;
  mockFlag = true;
  mockTier = 'pro';
  mockSeeds = [];
  mockContracts = { data: [], isError: false, isFetching: false };
  mockStore.clear();
  mockPush.mockClear();
  mockTrack.mockClear();
  mockStartTutorial.mockClear();
  mockCtx = {
    projects: [], userRole: 'contractor', settings: { branding: { companyName: '' } }, dailyReports: [],
    projectsLoaded: true, settingsLoaded: true, invoicesLoaded: true, dailyReportsLoaded: true,
  };
  resetBudget();
});
afterEach(async () => {
  await cleanupAsync();
  jest.useRealTimers();
});

describe('S1 the opening question', () => {
  it('a new contractor is asked once, with the four answers and "Not Sure"', async () => {
    const r = await mount();
    expect(r.getByTestId('first-job-question')).toBeTruthy();
    expect(r.getByText('What Do You Want To Do First?')).toBeTruthy();
    for (const a of ['price', 'schedule', 'bill', 'site', 'unsure']) expect(r.getByTestId(`first-job-answer-${a}`)).toBeTruthy();
    expect(r.getByText('Not Sure. Show Me The Usual Order')).toBeTruthy();
    expect(r.getByTestId('first-job-ring-text').props.children).toBe('0 of 7');
    expect(r.queryByTestId('first-job-path')).toBeNull();
  });

  it('answering shows the path: that answer\'s step first, all seven there, one open', async () => {
    const r = await mount();
    fireEvent.press(r.getByTestId('first-job-answer-bill'));
    await flush();
    expect(r.queryByTestId('first-job-question')).toBeNull();
    const ids = ['invoice', 'company', 'prices', 'estimate', 'send', 'schedule', 'daily'];
    for (const id of ids) expect(r.getByTestId(`first-job-step-${id}`)).toBeTruthy();
    expect(ids.filter((id) => r.queryByTestId(`first-job-step-${id}-body`))).toEqual(['invoice']);
    expect(saved().answer).toBe('bill');
    expect(eventsNamed('first_job_question_answered')).toEqual([{ answer: 'bill' }]);
    // Stripe is a side note under the invoice step, never a step.
    expect(r.getByTestId('first-job-stripe-note')).toBeTruthy();
    expect(r.queryByTestId('first-job-step-stripe')).toBeNull();
    // No project yet: the invoice step sends him to create one, and says so.
    expect(r.getByText('Create The Project First')).toBeTruthy();
    fireEvent.press(r.getByTestId('first-job-step-invoice-go'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/', params: { openCreate: '1' } });
  });
});

describe('S2 mid-path', () => {
  it('done comes from the data; the ring, the line and the stage pills follow', async () => {
    save({ answer: 'unsure' });
    mockCtx.settings = { branding: { companyName: 'Acme Build' } };
    mockSeeds = [{ id: 'seed-framing-sf' }];
    const r = await mount();
    expect(r.getByTestId('first-job-node-company-done')).toBeTruthy();
    expect(r.getByTestId('first-job-node-prices-done')).toBeTruthy();
    expect(r.getByTestId('first-job-node-estimate-todo')).toBeTruthy();
    expect(r.getByTestId('first-job-ring-text').props.children).toBe('2 of 7');
    expect(r.getByTestId('first-job-line').props.children).toBe('Next: Price Your First Job');
    expect(r.getByTestId('first-job-step-estimate-body')).toBeTruthy();
    expect(r.queryByTestId('first-job-step-send-body')).toBeNull();
    expect(r.getByTestId('first-job-stage-win-now')).toBeTruthy();
    expect(r.getByTestId('first-job-stage-plan-later')).toBeTruthy();
    // The AI step says who drafts and who checks.
    expect(r.getByText(/MAGE drafts this with AI, and you check every line/)).toBeTruthy();
    // A tutorial exists for pricing a job.
    expect(r.getByTestId('first-job-step-estimate-show-me')).toBeTruthy();
    fireEvent.press(r.getByTestId('first-job-step-estimate-show-me'));
    expect(mockStartTutorial).toHaveBeenCalledWith('estimate-first', { entry: 'checklist' });
    expect(r.getByTestId('first-job-node-estimate-todo')).toBeTruthy();
  });

  it('a free plan sees the lock and the plan name before the tap; no tutorial, no button', async () => {
    mockTier = 'free';
    save({ answer: 'unsure' });
    mockCtx.settings = { branding: { companyName: 'Acme Build' } };
    const r = await mount();
    // Collapsed rows already carry it.
    expect(r.getByTestId('first-job-step-invoice-plan')).toBeTruthy();
    expect(r.getByTestId('first-job-step-prices-plan')).toBeTruthy();
    expect(r.queryByTestId('first-job-step-daily-plan')).toBeNull();
    // Add Your Prices is open: the note names the plan, and there is no tutorial for it.
    expect(r.getByTestId('first-job-step-prices-body')).toBeTruthy();
    expect(r.getByText('This opens with the Pro plan. The button shows you the plans first.')).toBeTruthy();
    expect(r.queryByTestId('first-job-step-prices-show-me')).toBeNull();
    // The estimate step shows the free count that is left.
    fireEvent.press(r.getByTestId('first-job-step-estimate-head'));
    await flush();
    expect(r.getByText('2 free AI estimates left. After that it needs the Pro plan.')).toBeTruthy();
    expect(r.queryByTestId('first-job-step-prices-body')).toBeNull();
  });

  it('a paid plan sees no lock anywhere', async () => {
    save({ answer: 'unsure' });
    const r = await mount();
    for (const id of ['prices', 'estimate', 'send', 'invoice']) expect(r.queryByTestId(`first-job-step-${id}-plan`)).toBeNull();
  });
});

describe('S3 done only from real data', () => {
  it('a tap on the button goes to the real screen and marks nothing', async () => {
    save({ answer: 'unsure' });
    const r = await mount();
    fireEvent.press(r.getByTestId('first-job-step-company-go'));
    expect(mockPush).toHaveBeenCalledWith('/company-profile');
    await again(r);
    expect(r.getByTestId('first-job-node-company-todo')).toBeTruthy();
    expect(r.getByTestId('first-job-ring-text').props.children).toBe('0 of 7');
    expect(eventsNamed('first_job_step_done')).toHaveLength(0);
  });

  it('coming back with the work done ticks it, opens the next step and says what is next', async () => {
    save({ answer: 'unsure' });
    const r = await mount();
    mockCtx = { ...mockCtx, settings: { branding: { companyName: 'Acme Build' } } };
    await again(r);
    expect(r.getByTestId('first-job-node-company-done')).toBeTruthy();
    expect(r.getByTestId('first-job-step-prices-body')).toBeTruthy();
    expect(r.getByTestId('first-job-line').props.children).toBe('Done: Add Your Company Name. Next: Add Your Prices');
    expect(eventsNamed('first_job_step_done')).toEqual([{ step: 'company', position: 1, out_of_order: false, done_count: 1 }]);
  });

  it('a step done ahead of the others is fine, and is recorded as out of order', async () => {
    save({ answer: 'unsure' });
    mockCtx = { ...mockCtx, projects: [REAL_JOB] };
    const r = await mount({ projectCount: 1 });
    mockCtx = { ...mockCtx, dailyReports: [{ projectId: 'p1' }] };
    await again(r, { projectCount: 1 });
    expect(r.getByTestId('first-job-node-daily-done')).toBeTruthy();
    expect(eventsNamed('first_job_step_done')).toEqual([{ step: 'daily', position: 6, out_of_order: true, done_count: 1 }]);
    // The path still opens the first step that is left.
    expect(r.getByTestId('first-job-step-company-body')).toBeTruthy();
  });

  it('a sample job, and a job shared by another contractor, tick nothing', async () => {
    save({ answer: 'unsure' });
    mockCtx = {
      ...mockCtx,
      projects: [
        { id: 's1', name: "Sample — Sarah's Place", ownerUserId: 'u1', estimate: { materials: [1] }, schedule: { tasks: [1] } },
        { id: 'g1', name: 'Their Job', ownerUserId: 'someone-else', myRole: 'editor', estimate: { materials: [1] }, schedule: { tasks: [1] } },
      ],
      dailyReports: [{ projectId: 's1' }, { projectId: 'g1' }],
    };
    const r = await mount();
    expect(r.getByTestId('first-job-ring-text').props.children).toBe('0 of 7');
    expect(r.getByTestId('first-job-node-schedule-todo')).toBeTruthy();
    expect(r.getByTestId('first-job-node-daily-todo')).toBeTruthy();
  });

  it('"sent" needs a real mark: a proposal out of draft, or the mark a share writes', async () => {
    save({ answer: 'unsure' });
    mockCtx = { ...mockCtx, projects: [{ ...REAL_JOB, estimate: { materials: [1] } }] };
    const r = await mount({ projectCount: 1, estimateCount: 1 });
    expect(r.getByTestId('first-job-node-send-todo')).toBeTruthy();
    // A share on a sample job writes nothing.
    await act(async () => { await markEstimateSent("Sample — Sarah's Place"); });
    expect(mockStore.has(firstJobSentKey('u1'))).toBe(false);
    // A real share does, and Home sees it.
    await act(async () => { await markEstimateSent('Kitchen'); });
    await again(r, { projectCount: 1, estimateCount: 1 });
    expect(mockStore.has(firstJobSentKey('u1'))).toBe(true);
    expect(r.getByTestId('first-job-node-send-done')).toBeTruthy();
  });

  it('a proposal read that failed says "Checking", not done and not undone', async () => {
    save({ answer: 'unsure' });
    mockContracts = { data: undefined, isError: true, isFetching: false };
    mockCtx = { ...mockCtx, projects: [{ ...REAL_JOB, estimate: { materials: [1] } }] };
    const r = await mount({ projectCount: 1, estimateCount: 1 });
    expect(r.getByTestId('first-job-node-send-todo')).toBeTruthy();
    expect(r.getByTestId('first-job-step-send-checking')).toBeTruthy();
    mockContracts = { data: ['p1'], isError: false, isFetching: false };
    await again(r, { projectCount: 1, estimateCount: 1 });
    expect(r.getByTestId('first-job-node-send-done')).toBeTruthy();
    // It loaded done; it is not something he just did.
    expect(eventsNamed('first_job_step_done')).toHaveLength(0);
  });
});

describe('S4 Skip, Hide, Remove', () => {
  it('Skip moves on without marking done, and a tap brings the step back', async () => {
    save({ answer: 'unsure' });
    const r = await mount();
    fireEvent.press(r.getByTestId('first-job-step-company-skip'));
    await flush();
    expect(r.getByTestId('first-job-node-company-skipped')).toBeTruthy();
    expect(r.getByTestId('first-job-step-company-skipped')).toBeTruthy();
    expect(r.getByTestId('first-job-step-prices-body')).toBeTruthy();
    expect(r.getByTestId('first-job-ring-text').props.children).toBe('0 of 7');
    expect(r.getByTestId('first-job-line').props.children).toBe('Skipped. Next: Add Your Prices');
    expect(saved().skipped).toEqual(['company']);
    expect(eventsNamed('first_job_step_skipped')).toEqual([{ step: 'company', position: 1 }]);
    fireEvent.press(r.getByTestId('first-job-step-company-head'));
    await flush();
    expect(saved().skipped).toEqual([]);
    expect(r.getByTestId('first-job-step-company-body')).toBeTruthy();
  });

  it('Hide shrinks it to one small row that reopens it', async () => {
    save({ answer: 'unsure' });
    mockCtx.settings = { branding: { companyName: 'Acme Build' } };
    mockSeeds = [{ id: 'a' }];
    const r = await mount({ estimateCount: 1, projectCount: 1 });
    fireEvent.press(r.getByTestId('first-job-hide'));
    await flush();
    expect(r.queryByTestId('first-job-card')).toBeNull();
    expect(r.getByText('Your First Job: 3 Of 7 Done')).toBeTruthy();
    expect(saved().hidden).toBe(true);
    fireEvent.press(r.getByTestId('first-job-hidden-row'));
    await flush();
    expect(r.getByTestId('first-job-path')).toBeTruthy();
    expect(saved().hidden).toBe(false);
    expect(eventsNamed('first_job_hidden')).toEqual([{ done_count: 3 }]);
    expect(eventsNamed('first_job_reopened')).toEqual([{ done_count: 3 }]);
  });

  it('a hidden card stays one row on the next visit', async () => {
    save({ answer: 'price', hidden: true });
    const r = await mount();
    expect(r.getByTestId('first-job-hidden-row')).toBeTruthy();
    expect(r.getByText('Your First Job: 0 Of 7 Done')).toBeTruthy();
    expect(r.queryByTestId('first-job-card')).toBeNull();
  });

  it('Remove asks once, then the card is gone for good', async () => {
    save({ answer: 'unsure' });
    const r = await mount();
    fireEvent.press(r.getByTestId('first-job-more'));
    fireEvent.press(r.getByTestId('first-job-remove'));
    expect(r.getByText('Remove this card for good?')).toBeTruthy();
    expect(saved().removed).toBe(false);
    fireEvent.press(r.getByTestId('first-job-remove-confirm'));
    await flush();
    expect(r.toJSON()).toBeNull();
    expect(saved().removed).toBe(true);
    expect(eventsNamed('first_job_removed')).toEqual([{ done_count: 0 }]);
    await cleanupAsync();
    const next = await mount();
    expect(next.toJSON()).toBeNull();
  });
});

describe('S5 the finish state', () => {
  const allDone = () => {
    mockCtx = {
      ...mockCtx,
      settings: { branding: { companyName: 'Acme Build' } },
      projects: [{ ...REAL_JOB, estimate: { materials: [1] }, schedule: { tasks: [1] } }],
      dailyReports: [{ projectId: 'p1' }],
    };
    mockSeeds = [{ id: 'a' }];
    mockContracts = { data: ['p1'], isError: false, isFetching: false };
  };

  it('shows once with the five stages, each a link, then goes away', async () => {
    save({ answer: 'unsure' });
    allDone();
    const r = await mount({ projectCount: 1, estimateCount: 1, invoiceCount: 1 });
    expect(r.getByTestId('first-job-finish')).toBeTruthy();
    expect(r.getByText('You Ran A Whole Job')).toBeTruthy();
    for (const s of ['win', 'plan', 'build', 'paid', 'close']) expect(r.getByTestId(`first-job-finish-stage-${s}`)).toBeTruthy();
    for (const name of ['Win It', 'Plan It', 'Build It', 'Get Paid', 'Close It']) expect(r.getByText(name)).toBeTruthy();
    fireEvent.press(r.getByTestId('first-job-finish-stage-paid'));
    expect(mockPush).toHaveBeenCalledWith('/payments');
    expect(saved().finishShown).toBe(true);
    expect(eventsNamed('first_job_finished')).toEqual([{ done_count: 7, skipped_count: 0 }]);
    // It stays for this visit.
    await again(r, { projectCount: 1, estimateCount: 1, invoiceCount: 1 });
    expect(r.getByTestId('first-job-finish')).toBeTruthy();
    // The next visit: gone.
    await cleanupAsync();
    const next = await mount({ projectCount: 1, estimateCount: 1, invoiceCount: 1 });
    expect(next.toJSON()).toBeNull();
    expect(eventsNamed('first_job_finished')).toHaveLength(1);
  });

  it('done or skipped is enough to finish', async () => {
    save({ answer: 'unsure', skipped: ['invoice'] });
    allDone();
    const r = await mount({ projectCount: 1, estimateCount: 1, invoiceCount: 0 });
    expect(r.getByTestId('first-job-finish')).toBeTruthy();
    expect(eventsNamed('first_job_finished')).toEqual([{ done_count: 6, skipped_count: 1 }]);
    fireEvent.press(r.getByTestId('first-job-finish-done'));
    expect(r.toJSON()).toBeNull();
  });
});

describe('S6 who sees it', () => {
  it('a property owner and a property manager see nothing', async () => {
    for (const role of ['client', 'property_manager']) {
      mockCtx = { ...mockCtx, userRole: role };
      const r = await mount();
      expect(r.toJSON()).toBeNull();
      await cleanupAsync();
    }
  });

  it('an invited field seat keeps the old card, with no contractor path', async () => {
    mockCtx = { ...mockCtx, projects: [{ id: 'g1', name: 'Their Job', ownerUserId: 'gc', myRole: 'field', estimate: null }] };
    const r = await mount();
    expect(r.queryByTestId('first-job-card')).toBeNull();
    expect(r.queryByTestId('first-job-question')).toBeNull();
    expect(r.getByTestId('onboarding-checklist-dismiss')).toBeTruthy();
  });

  it('flag off: the old card renders, for a contractor too', async () => {
    mockFlag = false;
    const r = await mount();
    expect(r.queryByTestId('first-job-card')).toBeNull();
    expect(r.getByTestId('onboarding-checklist-dismiss')).toBeTruthy();
    expect(r.getByTestId('onboarding-checklist-project')).toBeTruthy();
    expect(r.getByTestId('onboarding-checklist-stripe')).toBeTruthy();
  });

  it('an established account that never answered is not shown the card', async () => {
    mockCtx = {
      ...mockCtx,
      settings: { branding: { companyName: 'Acme Build' } },
      projects: [{ ...REAL_JOB, estimate: { materials: [1] }, schedule: { tasks: [1] } }],
      dailyReports: [{ projectId: 'p1' }],
    };
    mockSeeds = [{ id: 'a' }];
    const r = await mount({ projectCount: 1, estimateCount: 1 });
    expect(r.toJSON()).toBeNull();
  });

  it('someone who closed the old card gets the one small row, not a new full card', async () => {
    mockStore.set('mageid_onboarding_checklist_dismissed_v2', '1');
    const r = await mount();
    expect(r.getByTestId('first-job-hidden-row')).toBeTruthy();
    expect(r.queryByTestId('first-job-question')).toBeNull();
  });

  it('Reduce Motion: the same card, nothing travelling', async () => {
    mockReduced = true;
    save({ answer: 'unsure' });
    const r = await mount();
    mockCtx = { ...mockCtx, settings: { branding: { companyName: 'Acme Build' } } };
    await again(r);
    expect(r.getByTestId('first-job-node-company-done')).toBeTruthy();
    expect(r.getByTestId('first-job-step-prices-body')).toBeTruthy();
  });
});
