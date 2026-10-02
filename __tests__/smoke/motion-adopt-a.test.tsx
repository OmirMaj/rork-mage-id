/**
 * Smoke — lane MOTIONADOPT-A: four screens (+ two SHOULD rows) adopt the motion
 * kit. BEHAVIOUR ONLY, no snapshot (the phone goldens are w6d-x1-phone etc.).
 *
 *   T1 ThinkingStates: every step at once, nothing timed, no travel when reduced.
 *   T2 EstimateLoadingOverlay: ONE shared dot clock while open, none after;
 *      every timing / spring passes the nativeDriver variable.
 *   T3 CopilotShell: the receipt's 3 ticks land on beats 0 / 120 / 240 ms
 *      (reduced: together, no scale); the thinking row never mounts for an
 *      answer under 140 ms and says "Still working on it" at 10 s.
 *   T4 skills check: exactly one live question card at every step (the 160 ms
 *      leave included); the cards behind hold no question; reduced: one layer.
 *   T5 client messages: a loaded thread is still; only the newest message that
 *      arrives while it is open moves.
 *   T6 Gantt jump-to-task draws one line under that bar, gone on drag; Ask your
 *      plans: the thinking row waits 140 ms, the answer card arrives once.
 *
 * `nativeDriver` is mocked to false (a native-driven value never advances in
 * this harness): the sites pass the VARIABLE, so every call must say false.
 */

import React, { Profiler } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, PORTAL_ID } from '@/__tests__/fixtures/world';
import type { PortalMessage, ScheduleTask } from '@/types';

let mockReduced = false;
jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, nativeDriver: false, reducedMotion: () => mockReduced, useReducedMotion: () => mockReduced };
});

// The crane is not this lane's (its SVG loop is allowlisted elsewhere).
jest.mock('@/components/CraneLoader', () => {
  const actual = jest.requireActual('@/components/CraneLoader');
  return { ...actual, CraneSvg: () => null };
});

// ── T3: the Copilot conversation, driven from here ───────────────────────────
type MockStore<T> = { value: T; listeners: Set<() => void> };
const mockConvo: MockStore<Record<string, unknown> | null> & { cap: unknown } = { value: null, listeners: new Set(), cap: null };
const mockConfirm = jest.fn(async () => ({ landed: ['Added Drywall hang (4d)', 'Added Drywall tape (3d)', 'Added Prime and paint (5d)'] }));
jest.mock('@/hooks/useCopilotConversation', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  const noop = () => {};
  return {
    useCopilotConversation: () => {
      const state = useSyncExternalStore(
        (l: () => void) => { mockConvo.listeners.add(l); return () => { mockConvo.listeners.delete(l); }; },
        () => mockConvo.value,
      );
      return { state, cap: mockConvo.cap, start: async () => {}, utterance: noop, answer: noop, skip: noop, confirm: mockConfirm, cancel: noop, patchDraft: noop, backToReview: noop };
    },
  };
});
jest.mock('@/components/VoiceCaptureModal', () => () => null);
jest.mock('@/components/DatePickerModal', () => () => null);

// ── T5: the client thread, driven from here ──────────────────────────────────
const mockThread: MockStore<Record<string, unknown> | null> = { value: null, listeners: new Set() };
jest.mock('@/hooks/usePortalThread', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  return {
    usePortalThread: () => useSyncExternalStore(
      (l: () => void) => { mockThread.listeners.add(l); return () => { mockThread.listeners.delete(l); }; },
      () => mockThread.value,
    ),
  };
});

// ── T4: the topic's tutorial is practised; no certificate yet ────────────────
jest.mock('@/utils/tutorial/progress', () => {
  const actual = jest.requireActual('@/utils/tutorial/progress');
  const snap = { progress: { v: 1, byId: { 'daily-report-voice': { status: 'practised' } }, chips: {} }, loaded: true };
  return { ...actual, useTutorialProgress: () => snap };
});
jest.mock('@/utils/learn/certificateClient', () => {
  const actual = jest.requireActual('@/utils/learn/certificateClient');
  return { ...actual, useMyCertificates: () => ({ data: [], isLoading: false, isError: false }) };
});

// ── T6: plans access + the plan search ───────────────────────────────────────
jest.mock('@/hooks/useProjectAccess', () => {
  const actual = jest.requireActual('@/hooks/useProjectAccess');
  return { ...actual, useProjectAccess: () => ({ canAccess: () => true, role: 'owner' }) };
});
let mockAskResolve: ((v: unknown) => void) | null = null;
jest.mock('@/utils/plans/askYourPlans', () => {
  const actual = jest.requireActual('@/utils/plans/askYourPlans');
  return { ...actual, askPlans: () => new Promise((res) => { mockAskResolve = res; }) };
});

// eslint-disable-next-line import/first
import ThinkingStates from '@/components/ThinkingStates';
// eslint-disable-next-line import/first
import EstimateLoadingOverlay from '@/components/EstimateLoadingOverlay';
// eslint-disable-next-line import/first
import CopilotShell from '@/components/copilot/CopilotShell';
// eslint-disable-next-line import/first
import InteractiveGantt, { type InteractiveGanttHandle } from '@/components/schedule/InteractiveGantt';
// eslint-disable-next-line import/first
import AskPlansPanel from '@/components/plans/AskPlansPanel';
// eslint-disable-next-line import/first
import { dotClockStats, resetBudget } from '@/components/motion/kit';
// eslint-disable-next-line import/first
import { getCapability } from '@/utils/copilot/registry';
// eslint-disable-next-line import/first
import { initialCopilotState } from '@/utils/copilot/turnReducer';
// eslint-disable-next-line import/first
import { runCpm } from '@/utils/cpm';
// eslint-disable-next-line import/first
import { QUIZ_BANKS } from '@/utils/learn/quizBank';

// ── helpers ──────────────────────────────────────────────────────────────────
type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
type ReactTestInstance = ReturnType<typeof screen.getByTestId>;
const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;
function nodes(json: unknown, out: Node[] = []): Node[] {
  if (!json || typeof json !== 'object') return out;
  if (Array.isArray(json)) { json.forEach((j) => nodes(j, out)); return out; }
  const n = json as Node;
  out.push(n);
  (n.children ?? []).forEach((c) => nodes(c, out));
  return out;
}
/** Nodes a person can see: a subtree at opacity 0 is skipped (StackPush keeps
 *  its finished leaving card mounted at opacity 0 until the next change). */
function visibleNodes(json: unknown, out: Node[] = []): Node[] {
  if (!json || typeof json !== 'object') return out;
  if (Array.isArray(json)) { json.forEach((j) => visibleNodes(j, out)); return out; }
  const n = json as Node;
  if (flat(n.props.style).opacity === 0) return out;
  out.push(n);
  (n.children ?? []).forEach((c) => visibleNodes(c, out));
  return out;
}
const textOf = (n: Node | string): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''));
const hasTransform = (s: Record<string, unknown>) => Array.isArray(s.transform) && (s.transform as unknown[]).length > 0;
const carriesMotion = (style: unknown) => { const s = flat(style); return 'opacity' in s || hasTransform(s); };
const advance = (ms: number) => { for (let left = ms; left > 0; left -= 16) act(() => { jest.advanceTimersByTime(Math.min(16, left)); }); };
async function flush(): Promise<void> {
  await act(async () => { for (let k = 0; k < 20; k++) await Promise.resolve(); });
}

/** The nearest host View above `inst` whose flattened style passes `test`. */
type Inst = { type: unknown; props: Record<string, unknown>; parent: Inst | null };
function hostAbove(inst: Inst, test: (s: Record<string, unknown>) => boolean): Inst {
  let n: Inst | null = inst;
  while (n) {
    if (n.type === 'View' && test(flat(n.props.style))) return n;
    n = n.parent;
  }
  throw new Error('no matching host View above the node');
}

type Cfg = { useNativeDriver?: boolean; delay?: number };
let calls: { kind: string; cfg: Cfg }[] = [];
let delays: number[] = [];
let spies: jest.SpyInstance[] = [];
function spyAnimated() {
  const t = Animated.timing; const s = Animated.spring; const d = Animated.delay;
  spies = [
    jest.spyOn(Animated, 'timing').mockImplementation(((v: Animated.Value, c: Cfg) => { calls.push({ kind: 'timing', cfg: c }); return t(v, c as never); }) as never),
    jest.spyOn(Animated, 'spring').mockImplementation(((v: Animated.Value, c: Cfg) => { calls.push({ kind: 'spring', cfg: c }); return s(v, c as never); }) as never),
    jest.spyOn(Animated, 'delay').mockImplementation(((ms: number) => { delays.push(ms); return d(ms); }) as never),
  ];
}

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider><View>{children}</View></ThemeProvider></SafeAreaProvider>
);

beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = false;
  calls = []; delays = [];
  resetBudget();
  spyAnimated();
});
afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  cleanup();
});

jest.setTimeout(120000);

// ── T1 ───────────────────────────────────────────────────────────────────────
describe('T1 ThinkingStates: every step at once, nothing timed', () => {
  const STEPS = ['Reading your scope…', 'Pricing from your history…', 'Checking local rates…', 'Writing the estimate…'];

  it('renders all 4 steps at once and nothing re-renders on a timer', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    let commits = 0;
    const r = render(
      // showDots={false}: the dots' own loop (the kit's shared clock) re-renders
      // Animated nodes every frame under the JS driver; the STEPS must not.
      <Wrap><Profiler id="ts" onRender={() => { commits += 1; }}><ThinkingStates steps={STEPS} active showDots={false} /></Profiler></Wrap>,
    );
    for (const s of STEPS) expect(r.getByText(s)).toBeTruthy();
    expect(new Set(STEPS).size).toBe(STEPS.length); // keys = the text: unique
    advance(1000); // the entrance (≤ 465 ms) is over
    const after = commits;
    advance(9000);
    for (const s of STEPS) expect(r.getByText(s)).toBeTruthy();
    expect(commits).toBe(after);
    expect(setIntervalSpy.mock.calls.length).toBe(0);
    setIntervalSpy.mockRestore();
  });

  it('with its dots: one shared clock', () => {
    const before = dotClockStats().count;
    const d = render(<Wrap><ThinkingStates steps={STEPS} active /></Wrap>);
    expect(d.getByTestId('thinking-states-dots', { includeHiddenElements: true })).toBeTruthy();
    expect(dotClockStats().count - before).toBe(1);
  });

  it('Reduce Motion: no transform on any row', () => {
    mockReduced = true;
    const r = render(<Wrap><ThinkingStates steps={STEPS} active /></Wrap>);
    const all = nodes(r.toJSON());
    expect(all.filter((n) => hasTransform(flat(n.props.style)))).toHaveLength(0);
    for (const s of STEPS) expect(r.getByText(s)).toBeTruthy();
  });
});

// ── T2 ───────────────────────────────────────────────────────────────────────
describe('T2 EstimateLoadingOverlay: one shared dot clock', () => {
  it('holds one clock while open, none after; every call passes nativeDriver', () => {
    const before = dotClockStats().count;
    const r = render(<Wrap><EstimateLoadingOverlay visible thinkingSteps={['Reading scope', 'Pricing labor']} /></Wrap>);
    expect(dotClockStats().count - before).toBe(1);
    expect(r.getByTestId('estimate-loading-dots', { includeHiddenElements: true })).toBeTruthy();
    expect(r.queryByTestId('thinking-states-dots', { includeHiddenElements: true })).toBeNull(); // showDots={false}
    expect(r.getByText('Reading scope')).toBeTruthy();
    expect(r.getByText('Pricing labor')).toBeTruthy();
    advance(4500); // one fun-fact fade
    r.rerender(<Wrap><EstimateLoadingOverlay visible={false} thinkingSteps={['Reading scope', 'Pricing labor']} /></Wrap>);
    expect(dotClockStats().count - before).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.cfg.useNativeDriver !== false)).toEqual([]);
  });
});

// ── T3 ───────────────────────────────────────────────────────────────────────
function setConvo(patch: Record<string, unknown>) {
  mockConvo.value = { ...(mockConvo.value ?? {}), ...patch };
  act(() => { mockConvo.listeners.forEach((l) => l()); });
}
function CopilotHost() {
  return <CopilotShell capabilityId="scheduleEdit" ctx={{ project: null, projectId: PROJECT_ID, ctx: {} } as never} onDone={() => {}} />;
}

describe('T3 CopilotShell: the receipt ticks on real beats; the calm thinking row', () => {
  beforeEach(async () => {
    allowConsoleErrors();
    await primeWorld('populated');
    const base = getCapability('scheduleEdit')!;
    mockConvo.cap = {
      ...base,
      renderReview: ({ confirm }: { confirm: () => void }) => (
        <TouchableOpacity testID="t3-apply" onPress={confirm}><Text>Apply</Text></TouchableOpacity>
      ),
    };
    mockConvo.value = { ...initialCopilotState('scheduleEdit', {}), phase: 'listening' };
    mockConfirm.mockClear();
  });

  async function toReceipt() {
    await mountRouteChecked('/ma-copilot', CopilotHost);
    setConvo({ phase: 'review' });
    delays = [];
    await act(async () => { fireEvent.press(screen.getByTestId('t3-apply')); });
    await flush();
    setConvo({ phase: 'done' });
    const card = screen.getByTestId('copilot-landed');
    const ticks: ReactTestInstance[] = card.findAll((n: ReactTestInstance) => {
      if (n.type !== 'View') return false;
      const s = flat(n.props.style);
      return s.width === 18 && s.height === 18;
    });
    return { ticks };
  }

  it('3 landed lines → 3 ticks, check springs at 0 / 120 / 240 ms', async () => {
    const { ticks } = await toReceipt();
    expect(screen.getByText('Added Drywall tape (3d)')).toBeTruthy();
    // The receipt's own beats (the kit's Animated.delay before each snap spring).
    expect(ticks).toHaveLength(3);
    expect(delays.slice(-3)).toEqual([0, 120, 240]);
    expect(ticks.every((t) => hasTransform(flat(t.props.style)))).toBe(true);
  });

  it('Reduce Motion: ticks together, no scale', async () => {
    mockReduced = true;
    const { ticks } = await toReceipt();
    expect(ticks).toHaveLength(3);
    expect(delays).toEqual([]);
    expect(ticks.some((t) => hasTransform(flat(t.props.style)))).toBe(false);
  });

  it('a thinking turn answered in < 140 ms never mounts the row; at 10 s it says so', async () => {
    await mountRouteChecked('/ma-copilot', CopilotHost);
    setConvo({ phase: 'thinking' });
    advance(100);
    expect(screen.queryByTestId('copilot-thinking')).toBeNull();
    setConvo({ phase: 'listening' });
    advance(400);
    expect(screen.queryByTestId('copilot-thinking')).toBeNull();
    setConvo({ phase: 'thinking' });
    advance(200);
    expect(screen.getByTestId('copilot-thinking')).toBeTruthy();
    expect(screen.getByText('Reading your numbers…')).toBeTruthy();
    advance(10000);
    expect(screen.getByText('Still working on it')).toBeTruthy();
  });
});

// ── T4 ───────────────────────────────────────────────────────────────────────
const BANK = QUIZ_BANKS['daily-report-voice'];
const QUESTION_TEXTS = BANK.questions.map((q) => q.en);
const questionTextsOnScreen = () => {
  const all = visibleNodes(screen.toJSON()).filter((n) => n.type === 'Text').map(textOf);
  return QUESTION_TEXTS.filter((q) => all.includes(q));
};
const behindLayers = () => visibleNodes(screen.toJSON()).filter((n) =>
  n.props.accessibilityElementsHidden === true && n.props.importantForAccessibility === 'no-hide-descendants'
  && flat(n.props.style).position === 'absolute' && n.props.pointerEvents === 'none');

describe('T4 skills check: the topic card opens into stacked question cards', () => {
  beforeEach(async () => {
    allowConsoleErrors();
    await primeWorld('populated');
  });

  it('exactly one live question card at every step, the leave included; behind cards hold no question', async () => {
    await mountRouteChecked('/skills-check?topic=daily-report-voice');
    expect(screen.getByTestId('skills-check-intro')).toBeTruthy();
    expect(screen.getByTestId('skills-check-stack')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('skills-check-start')); });
    const seen = new Set<string>();
    for (let step = 0; step < 3; step++) {
      expect(screen.getAllByTestId('skills-check-question', { includeHiddenElements: true })).toHaveLength(1);
      expect(screen.getByText(`Question ${step + 1} of ${QUESTION_TEXTS.length}`)).toBeTruthy();
      advance(400);
      // At rest: only the front card's question; the 2 cards behind are shells.
      const front = questionTextsOnScreen();
      expect(front).toHaveLength(1);
      seen.add(front[0]);
      // No question still to come is in the tree at all, hidden layers included.
      const everywhere = nodes(screen.toJSON()).filter((n) => n.type === 'Text').map(textOf);
      expect(QUESTION_TEXTS.filter((q) => !seen.has(q) && everywhere.includes(q))).toEqual([]);
      expect(behindLayers().length).toBe(2);
      const first = screen.getAllByTestId(/^skills-check-choice-/)[0];
      await act(async () => { fireEvent.press(first); });
      expect(screen.getAllByTestId('skills-check-question', { includeHiddenElements: true })).toHaveLength(1);
      await act(async () => { fireEvent.press(screen.getByTestId('skills-check-next')); });
      // The 160 ms leave: the old card is a decorative copy (no testID).
      advance(80);
      expect(screen.getAllByTestId('skills-check-question', { includeHiddenElements: true })).toHaveLength(1);
      expect(screen.getAllByTestId('skills-check-progress', { includeHiddenElements: true })).toHaveLength(1);
      advance(400);
      expect(screen.getAllByTestId('skills-check-question', { includeHiddenElements: true })).toHaveLength(1);
    }
  });

  it('Reduce Motion: a single flat card, no layers behind', async () => {
    mockReduced = true;
    await mountRouteChecked('/skills-check?topic=daily-report-voice');
    await act(async () => { fireEvent.press(screen.getByTestId('skills-check-start')); });
    advance(400);
    expect(screen.getAllByTestId('skills-check-question', { includeHiddenElements: true })).toHaveLength(1);
    expect(behindLayers()).toHaveLength(0);
  });
});

// ── T5 ───────────────────────────────────────────────────────────────────────
const msg = (id: string, authorType: 'gc' | 'client', body: string, minute: number): PortalMessage => ({
  id, projectId: PROJECT_ID, portalId: PORTAL_ID, authorType, authorName: authorType === 'gc' ? 'Ace GC' : 'Meredith',
  body, createdAt: new Date(Date.UTC(2026, 9, 2, 13, minute)).toISOString(), readByGc: true, readByClient: true, attachments: [],
});
const HISTORY = Array.from({ length: 30 }, (_, k) => msg(`h${String(k).padStart(2, '0')}-0000-4000-8000-000000000000`, k % 2 ? 'client' : 'gc', `History message ${k}`, k));
function setThread(patch: Record<string, unknown>) {
  mockThread.value = { ...(mockThread.value ?? {}), ...patch };
  act(() => { mockThread.listeners.forEach((l) => l()); });
}
const isRow = (s: Record<string, unknown>) => s.flexDirection === 'row' && s.width === '100%';
const rowMoves = (body: string) => carriesMotion(hostAbove(screen.getByText(body) as unknown as Inst, isRow).props.style);

describe('T5 client messages: history still, only the newest moves', () => {
  beforeEach(async () => {
    allowConsoleErrors();
    await primeWorld('populated');
    mockThread.value = {
      messages: HISTORY, unreadFromClient: [], coApprovals: [], sendMessage: jest.fn(async () => 'synced'), sendClientMessage: jest.fn(),
      markRead: jest.fn(), isSending: false, isSendingClient: false, refetchMessages: jest.fn(async () => ({})),
      refetchApprovals: jest.fn(async () => ({})), outbox: [], queuedIds: new Set<string>(), sendWithAttachments: jest.fn(async () => {}),
      retryOutbox: jest.fn(async () => {}), removeOutbox: jest.fn(async () => {}), loaded: true,
    };
  });

  it('30 loaded messages sit still; a send moves only that bubble; 3 replies move only the newest', async () => {
    await mountRouteChecked(`/client-messages?id=${PROJECT_ID}`);
    for (const m of HISTORY) expect(rowMoves(m.body)).toBe(false);

    const sent = msg('s0000000-0000-4000-8000-000000000001', 'gc', 'Just sent', 40);
    setThread({ messages: [...HISTORY, sent] });
    expect(rowMoves('Just sent')).toBe(true);
    for (const m of HISTORY) expect(rowMoves(m.body)).toBe(false);

    advance(2000);
    const replies = ['A', 'B', 'C'].map((x, k) => msg(`r000000${k}-0000-4000-8000-000000000000`, 'client', `Reply ${x}`, 45 + k));
    setThread({ messages: [...HISTORY, sent, ...replies] });
    expect(rowMoves('Reply C')).toBe(true);
    expect(rowMoves('Reply A')).toBe(false);
    expect(rowMoves('Reply B')).toBe(false);
    expect(rowMoves('Just sent')).toBe(false);
    for (const m of HISTORY) expect(rowMoves(m.body)).toBe(false);
  });

  it('nothing is live until the thread has loaded once', async () => {
    setThread({ loaded: false, messages: [] });
    await mountRouteChecked(`/client-messages?id=${PROJECT_ID}`);
    setThread({ messages: HISTORY.slice(0, 5) }); // the first fetch lands (still not "loaded")
    for (const m of HISTORY.slice(0, 5)) expect(rowMoves(m.body)).toBe(false);
    setThread({ loaded: true, messages: HISTORY.slice(0, 6) }); // the seed commit: history
    for (const m of HISTORY.slice(0, 6)) expect(rowMoves(m.body)).toBe(false);
  });
});

// ── T6 ───────────────────────────────────────────────────────────────────────
const mk = (id: string, title: string, startDay: number, durationDays: number, deps: string[] = []): ScheduleTask => ({
  id, title, phase: 'P', durationDays, startDay, progress: 0, crew: '', dependencies: deps, notes: '', status: 'not_started',
} as ScheduleTask);
const TASKS = [mk('t1', 'Framing', 1, 5), mk('t2', 'Rough-in', 6, 2, ['t1']), mk('t3', 'Drywall', 8, 4, ['t2']), mk('t4', 'Paint', 12, 3, ['t3'])];

describe('T6 (shipped) Gantt jump-to-task and Ask your plans', () => {
  it('scrollToTask draws one line under that bar; a drag takes it away', () => {
    const ref = React.createRef<InteractiveGanttHandle>();
    const cpm = runCpm(TASKS, {});
    const r = render(
      <Wrap>
        <InteractiveGantt tasks={TASKS} cpm={cpm} projectStartDate={new Date(2026, 8, 1)} onEdit={() => {}} mode="phone" controllerRef={ref} />
      </Wrap>,
    );
    expect(r.queryAllByTestId(/^gantt-push-rule-/)).toHaveLength(0);
    act(() => { ref.current?.scrollToTask('t3'); });
    expect(r.queryAllByTestId(/^gantt-push-rule-/)).toHaveLength(1);
    const rule = r.getByTestId('gantt-push-rule-t3');
    const s = flat(rule.props.style);
    expect(s.height).toBe(2);
    expect(hasTransform(s)).toBe(true); // scaleX, drawing from the left
    const vScroll = r.UNSAFE_getAllByType(ScrollView).find((n) => typeof n.props.onScrollBeginDrag === 'function');
    expect(vScroll).toBeTruthy();
    act(() => { (vScroll!.props.onScrollBeginDrag as () => void)(); });
    expect(r.queryAllByTestId(/^gantt-push-rule-/)).toHaveLength(0);
  });

  describe('Ask your plans', () => {
    beforeEach(async () => {
      allowConsoleErrors();
      await primeWorld('populated');
      mockAskResolve = null;
    });

    it('busy → the thinking row after 140 ms; the answer card arrives once', async () => {
      await mountRouteChecked('/ma-plans', () => <AskPlansPanel projectId={PROJECT_ID} sheets={[]} />);
      fireEvent.changeText(screen.getByPlaceholderText('Ask your plans'), 'Where is the panel?');
      await act(async () => { fireEvent.press(screen.getByLabelText('Ask')); });
      advance(100);
      expect(screen.queryByTestId('ask-plans-thinking')).toBeNull();
      advance(80);
      expect(screen.getByTestId('ask-plans-thinking')).toBeTruthy();
      expect(mockAskResolve).toBeTruthy();
      await act(async () => {
        mockAskResolve!({ answer: 'On sheet E-101.', citations: [], noneFound: false, weakGrounding: false, searchFailed: null, answerFailed: null, staleDropped: 0 });
      });
      await flush();
      const card = () => hostAbove(screen.getByText('On sheet E-101.') as unknown as Inst, (st) => st.padding === 12 && st.gap === 10);
      expect(carriesMotion(card().props.style)).toBe(true);
      advance(1000);
      fireEvent.changeText(screen.getByPlaceholderText('Ask your plans'), 'And the meter?'); // a re-render
      expect(carriesMotion(card().props.style)).toBe(false);
    });
  });
});
