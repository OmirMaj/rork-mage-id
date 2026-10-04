/**
 * Code cards, lane CCWIRE — PHONE PROOF for the surfaces the cards wire into.
 *
 *  1. GOLDEN — recorded FIRST, on the untouched files of claude/permit-path
 *     (ee7daf9b), before a line of this lane was written. Each case mounts a
 *     real route inside the real app (the 16-provider stack, the populated
 *     fixture world) at 390 × 844 iOS with useResponsiveLayout mocked to phone
 *     and every <Modal> rendering its content (w6d-z2-phone's mock), and
 *     records w6d-z2-phone's one-line-per-host-node dump as line count + sha256.
 *     Every model answer below is a SAMPLE written for this test (each line
 *     says so); none of it is code text.
 *
 *     (a) Code Check result sheet, two citations, no linked job;
 *     (b) Ask with a prose answer and NO `requirements` (the fallback that must
 *         stay byte-identical);
 *     (c) Plan Review with three saved findings on one sheet;
 *     (d) Inspection Ready sheet with no pinned code cards (must stay
 *         byte-identical: the pinned group renders only when there are pins).
 *
 *     WHAT THE GOLDEN COVERS. These are goldens of the SCREENS. A code card and
 *     a code-card list are lane CCKIT's components, with their own golden
 *     (__tests__/smoke/code-cards.test.tsx), so each one is recorded here as
 *     ONE line carrying its testID (KIT_ROOT below): a change inside a card
 *     moves CCKIT's golden, not these. No node of the untouched screens
 *     matches KIT_ROOT, so (b) and (d) are still the hashes recorded first.
 *
 *     PROVEN DELTAS (dump diffs against the dumps recorded first):
 *       (a) the recall chip and each citation's recall badge are neutral
 *           grey with an info mark (were amber with a warning triangle; same
 *           words, place and size); each citation's header row is a code card
 *           plus a "What the inspector checks" toggle; the hint says "Tap a
 *           card"; the ICC line sits under the viewer buttons (twice); the
 *           closed card sheet's shell is in the result sheet's tree.
 *       (c) the same recall chip tone; the card list above the findings; the
 *           closed card sheet's shell; the "Show each finding’s evidence, and
 *           mark it resolved or dismissed (3)" toggle, with the per-finding
 *           list shut while there are cards. (Fix round 1: that label was
 *           "Show the evidence and status for each finding (3)"; a one-line
 *           dump diff, the only one in the four goldens.)
 *       (b), (d): none. Byte-identical.
 *
 *  2. BEHAVIOUR — the wiring itself (cards, pins, Save, Ask town), asserted
 *     outright in the second describe block.
 *
 * Set CCWIRE_DUMP_DIR to write each dump for a diff.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';
import { PROJECT_ID, ESTIMATE_ID } from '@/__tests__/fixtures/world';
import type { Permit } from '@/types';
import { __setCodePinStoreForTest, makePin } from '@/utils/codeCard/pins';
import { __setCodeSavedStoreForTest } from '@/utils/codeCard/saved';
import type { CodeCardItem } from '@/utils/codeCard/types';

// ── The layout gate (phone) ────────────────────────────────────────────────
let mockWidth = 390;
let mockHeight = 844;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024;
    const isTablet = !isDesktop && mockWidth >= 768;
    return {
      screenSize: isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone',
      isPhone: !isDesktop && !isTablet,
      isTablet,
      isDesktop,
      width: mockWidth,
      height: mockHeight,
      contentMaxWidth: isDesktop ? 1280 : isTablet ? 900 : mockWidth,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
    };
  },
}));

// Every Modal renders its content, open or closed (w6c-field-phone's mock).
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const ReactActual = jest.requireActual('react');
  const { View: RNView, Text: RNText } = jest.requireActual('react-native');
  class Boundary extends ReactActual.Component<{ children?: React.ReactNode }, { threw: boolean }> {
    state = { threw: false };
    static getDerivedStateFromError() { return { threw: true }; }
    componentDidCatch() { /* recorded as a placeholder; identical before and after */ }
    render() {
      return this.state.threw
        ? ReactActual.createElement(RNText, { testID: 'modal-body-threw' }, 'modal-body-threw')
        : this.props.children;
    }
  }
  function Modal(props: Record<string, unknown> & { children?: React.ReactNode }) {
    const { children, visible, transparent, animationType, presentationStyle } = props;
    return ReactActual.createElement(
      RNView,
      {
        testID: 'ccw-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
});

// ── The AI, answered locally (SAMPLE answers; no network) ──────────────────
const mockAiPrompts: string[] = [];
let mockCodeCheckData: unknown = null;
// Lane CARDS2: the drill-in's own answer and Inspection Ready's recall answer,
// only when a test gives one (otherwise both behave exactly as before).
let mockCodeDetailData: unknown = null;
let mockRecallData: unknown = null;
jest.mock('@/utils/mageAI', () => {
  const actual = jest.requireActual('@/utils/mageAI');
  return {
    ...actual,
    mageAISmart: async (prompt: string) => {
      mockAiPrompts.push(prompt);
      const data = mockCodeDetailData && prompt.includes('wants to understand ONE specific code citation in depth') ? mockCodeDetailData : mockCodeCheckData;
      return data
        ? { success: true, data, cached: true }
        : { success: false, error: 'not in this test' };
    },
    mageAI: async (opts: { prompt?: string }) => (
      mockRecallData && String(opts?.prompt ?? '').includes('List what an inspector commonly checks at this inspection')
        ? { success: true, data: mockRecallData, cached: true }
        : actual.mageAI(opts)
    ),
  };
});

let mockAskAnswer: unknown = null;
jest.mock('@/utils/constructionAnswer', () => {
  const actual = jest.requireActual('@/utils/constructionAnswer');
  return {
    ...actual,
    askConstruction: async () => {
      if (!mockAskAnswer) throw new actual.ConstructionAnswerError('server_error', 'not in this test');
      return mockAskAnswer;
    },
  };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
function env(os: 'ios' | 'android', width: number, height: number) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  mockWidth = width;
  mockHeight = height;
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T15:00:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;

let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
  mockAiPrompts.length = 0;
  mockCodeCheckData = null;
  mockCodeDetailData = null;
  mockRecallData = null;
  mockAskAnswer = null;
  // The pin and saved stores are module singletons that hold their state in
  // memory; primeWorld empties the storage under them. A fresh store per test
  // reads THIS test's storage (the app's own tenant wipe resets them the same way).
  __setCodePinStoreForTest(null);
  __setCodeSavedStoreForTest(null);
  allowConsoleErrors();
});
afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
});

// ── What a snapshot records (w6d-z2-phone's dump) ──────────────────────────
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
const KNOWN_IDS = new Set([PROJECT_ID, ESTIMATE_ID]);
const volatile = (s: string) => s
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (m) => (KNOWN_IDS.has(m) ? m : '<uuid>'))
  .replace(/\b\d{13}[a-z0-9]{0,12}\b/g, '<ts-id>');
function small(v: unknown): string | null {
  try {
    const j = JSON.stringify(v);
    return j !== undefined && j.length <= 600 ? volatile(j) : null;
  } catch { return null; }
}
/** A code card or a code-card list (lane CCKIT's components): one line each. */
const KIT_ROOT = /^(code-check-card-\d+|[a-z-]+-card-list)$/;
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${volatile(String(node))}"`); return; }
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const tid = el.props?.testID;
  if (typeof tid === 'string' && KIT_ROOT.test(tid)) { out.push(`${pad}<code-card-kit testID=${JSON.stringify(tid)}>`); return; }
  const parts: string[] = [];
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function' || k === 'children' || k === 'screenId') continue;
    if (/style$/i.test(k) && v != null && typeof v === 'object') { parts.push(`${k}=${small(flat(v)) ?? '<big>'}`); continue; }
    if (typeof v === 'string') { parts.push(`${k}=${JSON.stringify(volatile(v))}`); continue; }
    if (typeof v !== 'object' || v === null) { parts.push(`${k}=${String(v)}`); continue; }
    parts.push(`${k}=${small(v) ?? '<obj>'}`);
  }
  out.push(`${pad}<${el.type} ${parts.join(' ')}>`);
  dumpLines(el.children, depth + 1, out);
}
function fingerprint(name: string, json: unknown): { lines: number; sha256: string } {
  json = stripSanctioned(json);
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
  const dir = process.env.CCWIRE_DUMP_DIR;
  if (dir) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${name.replace(/[^a-z0-9]+/gi, '_')}.txt`, text);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  return { lines: out.length, sha256 };
}

/** The first node in a renderer JSON tree whose testID is `id`. */
function findById(node: unknown, id: string): unknown {
  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const hit = findById(n, id); if (hit) return hit; }
    return null;
  }
  const el = node as { props?: { testID?: unknown }; children?: unknown };
  if (el.props?.testID === id) return node;
  return findById(el.children, id);
}

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

async function phoneRoute(url: string, before?: () => Promise<void>) {
  env('ios', 390, 844);
  await primeWorld('populated');
  if (before) await before();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

// ── Fixtures (every model line is a SAMPLE written for this test) ──────────
const SAMPLE_CODE_CHECK = {
  summary: 'Sample summary: a raised deck needs guards and a stair handrail.',
  applicableCodes: [
    // The verdict is what makes a citation a card (the wire always carries one;
    // a row without it renders as the plain line: see the behaviour block).
    { code: '2025 RCNYS', section: 'R312.1', requirement: 'Sample: guards on open sides of a raised deck.', verdict: 'required' },
    { code: '2025 RCNYS', section: '', requirement: 'Sample: a handrail on the deck stair.', verdict: 'required' },
  ],
  permitsRequired: ['Sample: building permit'],
  inspections: ['Sample: final inspection'],
  commonViolations: ['Sample: guard too low'],
  disclaimer: '',
  followUps: [],
};

const SAMPLE_ASK = {
  answer: 'Sample answer: guards and a stair handrail are needed. Confirm with your building department.',
  citations: [{ label: 'Sample source', kind: 'web', url: 'https://example.com/sample' }],
  consulted: [],
  verified: false,
  disclaimer: null,
  usedAI: true,
};

const SHEET_ID = 'ccw-sheet-a2';
type SeedFinding = Record<string, unknown>;
async function seedPlanReview(findings?: SeedFinding[]) {
  const sheets = [{
    id: SHEET_ID, projectId: PROJECT_ID, name: 'Deck plan', sheetNumber: 'A-2',
    imageUri: 'data:image/png;base64,iVBORw0KGgo=', createdAt: '2026-09-01T12:00:00.000Z',
  }];
  await AsyncStorage.setItem('mageid_plan_sheets', JSON.stringify(sheets));
  const review = {
    id: 'ccw-review-1', projectId: PROJECT_ID, planSheetId: SHEET_ID, reviewedAt: '2026-09-02T12:00:00.000Z',
    findings: findings ?? [
      { id: 'ccw-f1', category: 'guards', codeRef: 'RCNYS 2025 R312.1.3', citedEdition: 'RCNYS 2025', section: 'R312.1.3', evidence: 'model_recall', requirement: 'Sample: baluster spacing.', observed: 'Sample: drawn 4½ in. apart', severity: 'high', confidence: 'high', status: 'open' },
      { id: 'ccw-f2', category: 'stairs', codeRef: 'RCNYS 2025 R311.7.8', citedEdition: 'RCNYS 2025', section: 'R311.7.8', evidence: 'model_recall', requirement: 'Sample: stair handrail.', observed: 'Sample: no handrail drawn', severity: 'med', confidence: 'low', status: 'open' },
      { id: 'ccw-f3', category: 'other', codeRef: 'IRC/IBC (general)', requirement: 'Sample: ledger attachment.', observed: '', severity: 'low', confidence: 'med', status: 'resolved' },
    ],
  };
  await AsyncStorage.setItem('mageid_plan_reviews', JSON.stringify([review]));
}

const READY_ID = 'permit-ready-ccw';
function goldenDayPlus(n: number): string {
  const g = new OuterDate(GOLDEN_CLOCK);
  const d = new OuterDate(g.getFullYear(), g.getMonth(), g.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
async function seedInspection() {
  const raw = JSON.parse((await AsyncStorage.getItem('mageid_permits')) ?? '[]');
  const list: Permit[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  const ready: Permit = {
    id: READY_ID,
    projectId: PROJECT_ID,
    projectName: 'Fixture job',
    type: 'building',
    permitNumber: 'BLD-26-01234',
    jurisdiction: 'City of Portland Bureau of Development Services',
    status: 'inspection_scheduled',
    phase: 'Final inspection',
    appliedDate: goldenDayPlus(-30),
    inspectionDate: goldenDayPlus(2),
    fee: 250,
  };
  const next = [...list.filter((p) => p.id !== READY_ID), ready];
  await AsyncStorage.setItem('mageid_permits', JSON.stringify(Array.isArray(raw) ? next : { ...raw, data: next }));
}

async function runCodeCheck(sample: unknown = SAMPLE_CODE_CHECK, place: { city: string; state: string } = { city: 'Massapequa', state: 'NY' }) {
  mockCodeCheckData = sample;
  const tree = await phoneRoute('/construction-ai', async () => {
    await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
  });
  await act(async () => { fireEvent.changeText(screen.getByTestId('code-check-city'), place.city); });
  await act(async () => { fireEvent.changeText(screen.getByTestId('code-check-state'), place.state); });
  await act(async () => { fireEvent.changeText(screen.getByTestId('code-check-scenario'), 'Sample: a raised deck 34 in. above grade with a stair.'); });
  await pump(2);
  await act(async () => { fireEvent.press(screen.getByTestId('code-check-run')); });
  await pump(8);
  return tree;
}

async function runAsk() {
  mockAskAnswer = SAMPLE_ASK;
  const tree = await phoneRoute('/construction-ai?mode=ask', async () => {
    await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
  });
  await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), 'Sample: what does a raised deck need?'); });
  await pump(2);
  await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
  await pump(6);
  return tree;
}

async function openPlanReview(findings?: SeedFinding[]) {
  const tree = await phoneRoute('/construction-ai', async () => {
    await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    await seedPlanReview(findings);
  });
  await act(async () => { fireEvent.press(screen.getByTestId('mode-toggle-plan')); });
  await pump(2);
  await act(async () => { fireEvent.press(screen.getByTestId(`plan-project-${PROJECT_ID}`)); });
  await pump(2);
  await act(async () => { fireEvent.press(screen.getByTestId(`plan-sheet-${SHEET_ID}`)); });
  await pump(4);
  return tree;
}

async function openInspectionReady() {
  const tree = await phoneRoute(`/project-detail?id=${PROJECT_ID}`, async () => {
    await AsyncStorage.setItem('mageid_subscription_tier', 'free');
    await seedInspection();
  });
  const rows = screen.getAllByText('Get ready for Final inspection');
  await act(async () => { fireEvent.press(rows[0]); });
  await pump(4);
  return tree;
}

// ── 1. GOLDEN, phone ───────────────────────────────────────────────────────
describe('CCWIRE golden — recorded on the untouched files (390 × 844 iOS)', () => {
  jest.setTimeout(150000);

  it('(a) Code Check result sheet, two citations, no linked job', async () => {
    const tree = await runCodeCheck();
    const sheet = findById(tree.toJSON(), 'code-check-close');
    expect(sheet).toBeTruthy();
    expect(screen.getAllByText('Sample: guards on open sides of a raised deck.').length).toBeGreaterThan(0);
    expect(fingerprint('a-code-check-result', tree.toJSON())).toMatchSnapshot();
  });

  it('(b) Ask, prose answer, no requirements (the fallback)', async () => {
    const tree = await runAsk();
    expect(screen.getByTestId('construction-ask-result')).toBeTruthy();
    expect(fingerprint('b-ask-prose', tree.toJSON())).toMatchSnapshot();
  });

  it('(c) Plan Review, three saved findings on one sheet', async () => {
    const tree = await openPlanReview();
    expect(screen.getByTestId('plan-review-recall-chip')).toBeTruthy();
    expect(fingerprint('c-plan-review', tree.toJSON())).toMatchSnapshot();
  });

  it('(d) Inspection Ready sheet, no pinned code cards', async () => {
    const tree = await openInspectionReady();
    const sheet = findById(tree.toJSON(), 'inspection-ready-sheet');
    expect(sheet).toBeTruthy();
    expect(fingerprint('d-inspection-ready', sheet)).toMatchSnapshot();
  });
});

// ── 2. BEHAVIOUR — the wiring ──────────────────────────────────────────────
const SAMPLE_REQUIREMENTS = [
  {
    id: 'guards', verdict: 'required', summary: 'Sample: guards on every open side of the deck.',
    why: 'Sample: your deck is 34 in. above grade.', section: 'R312.1', citedEdition: '2025 RCNYS', stage: 'final',
    trigger: { value: 30, unit: 'in', comparison: '>' }, jobValue: { value: 34, unit: 'in', source: 'job', sourceLabel: 'from your question' },
    trade: 'framing', whatToBuild: ['Sample: a guard on every open side.'],
  },
  { id: 'echo', verdict: 'required', summary: 'Guards shall be provided on open sides.', section: 'R312.1', stage: 'final' },
  { id: 'stair', verdict: 'limit', summary: 'Sample: stair handrail, top of rail in the allowed range.', section: 'R311.7.8', stage: 'final' },
];

async function pinsStored(): Promise<Record<string, Array<{ stage: string; item: { id: string; summary: string } }>>> {
  return JSON.parse((await AsyncStorage.getItem('mageid_code_pins_v1')) ?? '{}');
}
async function savedStored(): Promise<Record<string, Array<{ item: { id: string; summary: string } }>>> {
  return JSON.parse((await AsyncStorage.getItem('mageid_code_saved_v1')) ?? '{}');
}
/** The FIRST Ask card's button (`checklist`, `open`, …); ids are content hashes. */
function cardButton(key: string) {
  const all = screen.getAllByTestId(new RegExp(`^code-card-ask-[0-9a-z]+-${key}$`));
  return all[0];
}

describe('CCWIRE behaviour — cards, pins, Save, Ask town', () => {
  jest.setTimeout(150000);

  it('Ask: requirements become cards under one jurisdiction block; an echoing item never shows', async () => {
    mockAskAnswer = { ...SAMPLE_ASK, requirements: SAMPLE_REQUIREMENTS };
    await phoneRoute('/construction-ai?mode=ask', async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    });
    await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), 'Sample: what does a raised deck need?'); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
    await pump(6);
    expect(screen.getByTestId('construction-ask-code-cards')).toBeTruthy();
    expect(screen.getAllByTestId('construction-ask-jurisdiction')).toHaveLength(1);
    expect(screen.getAllByText('Sample: guards on every open side of the deck.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Guards shall be provided on open sides.')).toBeNull();
    // The prose answer still leads.
    expect(screen.getAllByText(SAMPLE_ASK.answer).length).toBeGreaterThan(0);
    // No job linked: Checklist says why when tapped, and pins nothing.
    // Ids come from the content ("req-1" repeats on every answer; a pin keyed
    // on it would land on the next answer's first card).
    expect(screen.queryByTestId('code-card-guards-checklist')).toBeNull();
    await act(async () => { fireEvent.press(cardButton('checklist')); });
    expect(screen.getAllByText(/Link a project first/).length).toBeGreaterThan(0);
    expect(await pinsStored()).toEqual({});
    // Save, from the opened card, is blocked the same way and keeps nothing.
    await act(async () => { fireEvent.press(cardButton('open')); });
    await pump(4);
    const saveRows = screen.getAllByTestId(/^construction-ask-cards-sheet-ask-[0-9a-z]+-save$/);
    await act(async () => { fireEvent.press(saveRows[0]); });
    await pump(2);
    expect(screen.getAllByText(/Link a project first, so this is kept with that project\./).length).toBeGreaterThan(0);
    expect(await savedStored()).toEqual({});
    expect(screen.queryByTestId('construction-ask-saved')).toBeNull();
  });

  it('Code Check: a citation with a verdict is a card, one without is the plain line; the ladder and the drill-in stay with both', async () => {
    await runCodeCheck({
      ...SAMPLE_CODE_CHECK,
      applicableCodes: [
        ...SAMPLE_CODE_CHECK.applicableCodes,
        // No verdict (an answer from before the code cards): never a default "Required".
        { code: '2025 RCNYS', section: 'R507.9', requirement: 'Sample: an older row with no verdict.' },
        { code: '2025 RCNYS', section: 'R311.7', requirement: 'Sample: stair riser height in the allowed range.', verdict: 'limit' },
      ],
    });
    expect(screen.getByTestId('code-check-card-0')).toBeTruthy();
    expect(screen.getByTestId('code-check-card-1')).toBeTruthy();
    expect(screen.queryByTestId('code-check-card-2')).toBeNull();
    expect(screen.getByTestId('code-check-plain-2')).toBeTruthy();
    expect(screen.getAllByText('Sample: an older row with no verdict.').length).toBeGreaterThan(0);
    expect(screen.getByTestId('code-check-card-3')).toBeTruthy();
    expect(screen.queryByTestId('code-check-plain-0')).toBeNull();
    expect(screen.getByTestId('code-check-rung-0')).toBeTruthy();
    expect(screen.getByTestId('code-check-rung-2')).toBeTruthy();
    expect(screen.getByTestId('code-detail-toggle-0')).toBeTruthy();
    expect(screen.getByTestId('code-detail-toggle-2')).toBeTruthy();
    // The verdict on each card is the model's own.
    expect(screen.getByTestId('code-check-card-0-verdict').props.accessibilityLabel).toBe('Verdict: Required');
    expect(screen.getByTestId('code-check-card-3-verdict').props.accessibilityLabel).toBe('Verdict: Limit');
    // The prompt carried the no-verbatim sentence.
    expect(mockAiPrompts.some((p) => p.includes('Write every requirement in your own words. Never quote or reproduce the text of any model code (ICC, NFPA) word for word.'))).toBe(true);
    // The ICC line sits beside the viewer buttons.
    expect(screen.getAllByText("Opens ICC's free public viewer. MAGE ID is not affiliated with or endorsed by ICC.").length).toBeGreaterThan(0);
    // No job: Ask town says why.
    await act(async () => { fireEvent.press(screen.getByTestId('code-check-card-0-ask')); });
    expect(screen.getAllByText(/Link a project first/).length).toBeGreaterThan(0);
  });

  it('Plan Review: findings become status-grouped cards; the details list opens on tap', async () => {
    await openPlanReview();
    expect(screen.getByTestId('plan-review-card-list')).toBeTruthy();
    expect(screen.queryByTestId('plan-review-rung-ccw-f1')).toBeNull();
    // The toggle says this is where a finding is marked resolved.
    expect(screen.getAllByText(/Show each finding\u2019s evidence, and mark it resolved or dismissed \(3\)/).length).toBe(1);
    await act(async () => { fireEvent.press(screen.getByTestId('plan-review-details-toggle')); });
    await pump(2);
    expect(screen.getByTestId('plan-review-rung-ccw-f1')).toBeTruthy();
  });

  it('Ask on a linked project: Checklist pins the card on its inspection, and the card says where it landed', async () => {
    mockAskAnswer = { ...SAMPLE_ASK, requirements: SAMPLE_REQUIREMENTS };
    await phoneRoute(`/construction-ai?mode=ask&projectId=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    });
    await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), 'Sample: what does a raised deck need?'); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
    await pump(6);
    await act(async () => { fireEvent.press(cardButton('checklist')); });
    await pump(4);
    const pins = await pinsStored();
    expect(pins[PROJECT_ID]?.map((p) => [p.item.summary, p.stage])).toEqual([['Sample: guards on every open side of the deck.', 'final']]);
    expect(pins[PROJECT_ID]?.[0].item.id).toMatch(/^ask-[0-9a-z]+$/);
    // The card now says where it landed.
    expect(screen.getAllByText('On Final checklist').length).toBeGreaterThan(0);
    // …and the pin can be SEEN and TAKEN OFF right here, at any time (Inspection
    // Ready shows it only in the 3 days before that inspection).
    const id = pins[PROJECT_ID]![0].item.id;
    expect(screen.getByTestId('construction-ask-pinned')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-pinned-toggle')); });
    await pump(2);
    expect(screen.getByTestId(`construction-ask-pinned-${id}`)).toBeTruthy();
    expect(screen.getAllByText('Each one shows in Inspection Ready 3 days before that inspection. Kept on this device. Confirm with your building department.').length).toBe(1);
    await act(async () => { fireEvent.press(screen.getByTestId(`construction-ask-pinned-remove-${id}`)); });
    await pump(4);
    expect(await pinsStored()).toEqual({});
    expect(screen.queryByTestId('construction-ask-pinned')).toBeNull();
    expect(screen.queryByText('On Final checklist')).toBeNull();
  });

  // ONE app tree per test: a second route mounted in the same test leaves the
  // router's test harness unable to mount the next one. So the pin is seeded
  // the way the store writes it (makePin + the store's own key), and read back
  // by a fresh store, which is also what a relaunch of the app does.
  it('Inspection Ready: a pinned card shows under its inspection with its note, and Unpin takes it off', async () => {
    const SAMPLE_PINNED: CodeCardItem = {
      id: 'ask-samplepin', verdict: 'required', summary: 'Sample: guards on every open side of the deck.',
      section: 'R312.1', citedEdition: '2025 RCNYS', evidence: null, stage: 'final', stageIsGuess: true,
    };
    const SAMPLE_OTHER: CodeCardItem = {
      id: 'ask-sampleframing', verdict: 'required', summary: 'Sample: joist hangers at the ledger.',
      section: 'R507.6', evidence: null, stage: 'framing', stageIsGuess: true,
    };
    await phoneRoute(`/project-detail?id=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'free');
      await seedInspection();
      await AsyncStorage.setItem('mageid_code_pins_v1', JSON.stringify({
        [PROJECT_ID]: [
          makePin(PROJECT_ID, SAMPLE_PINNED, '2026-09-20T12:00:00.000Z'),
          makePin(PROJECT_ID, SAMPLE_OTHER, '2026-09-20T12:01:00.000Z'),
        ],
      }));
    });
    const rows = screen.getAllByText('Get ready for Final inspection');
    await act(async () => { fireEvent.press(rows[0]); });
    await pump(4);
    // The final's pin is there, under its fixed note; the framing pin is not on a final.
    expect(screen.getByTestId('inspection-prep-pinned')).toBeTruthy();
    expect(screen.getAllByText('Pinned from code cards').length).toBe(1);
    expect(screen.getAllByText('Sample: guards on every open side of the deck.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Sample: joist hangers at the ledger.')).toBeNull();
    expect(screen.getAllByText('Pinned from code cards. In MAGE\u2019s words; section from AI recall unless marked. Confirm with your building department.').length).toBe(1);
    // Unpin: off the sheet and out of the store; the other stage's pin stays.
    const unpin = screen.getAllByTestId(/^inspection-prep-unpin-/);
    expect(unpin).toHaveLength(1);
    await act(async () => { fireEvent.press(unpin[0]); });
    await pump(4);
    expect(screen.queryByTestId('inspection-prep-pinned')).toBeNull();
    expect((await pinsStored())[PROJECT_ID]?.map((p) => p.item.id)).toEqual(['ask-sampleframing']);
  });

  it('Ask on a linked project: Save lands in a list he can open and remove from', async () => {
    mockAskAnswer = { ...SAMPLE_ASK, requirements: SAMPLE_REQUIREMENTS };
    await phoneRoute(`/construction-ai?mode=ask&projectId=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    });
    // Nothing saved yet: no list.
    expect(screen.queryByTestId('construction-ask-saved')).toBeNull();
    await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), 'Sample: what does a raised deck need?'); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
    await pump(6);
    // Open the first card, then Save from the opened card.
    await act(async () => { fireEvent.press(cardButton('open')); });
    await pump(4);
    const saveRows = screen.getAllByTestId(/^construction-ask-cards-sheet-ask-[0-9a-z]+-save$/);
    await act(async () => { fireEvent.press(saveRows[0]); });
    await pump(4);
    const saved = await savedStored();
    expect(saved[PROJECT_ID]?.map((c) => c.item.summary)).toEqual(['Sample: guards on every open side of the deck.']);
    // The Save row now says where to find it, and the list is there.
    expect(screen.getAllByText(/Find it in Ask, under Saved code cards/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('construction-ask-saved')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-saved-toggle')); });
    await pump(2);
    const id = saved[PROJECT_ID][0].item.id;
    expect(screen.getByTestId(`construction-ask-saved-${id}`)).toBeTruthy();
    expect(screen.getAllByText('Kept on this device. In MAGE\u2019s words; section from AI recall unless marked. Confirm with your building department.').length).toBe(1);
    // Remove takes it out of the store and the list goes away.
    await act(async () => { fireEvent.press(screen.getByTestId(`construction-ask-saved-remove-${id}`)); });
    await pump(4);
    expect(await savedStored()).toEqual({});
    expect(screen.queryByTestId('construction-ask-saved')).toBeNull();
  });

  it('a re-measure stays with the card (reopened, it shows that number; Save keeps the number on screen), and a limit draws a tape only when its own line says the side', async () => {
    mockAskAnswer = {
      ...SAMPLE_ASK,
      requirements: [
        SAMPLE_REQUIREMENTS[0],
        // "at least 36 in." with the sign the WRONG way (<): MAGE must not compute anything from it.
        {
          id: 'low', verdict: 'limit', summary: 'Sample: guard has to be at least 36 in. high.', section: 'R312.1.2', citedEdition: '2025 RCNYS', stage: 'final',
          trigger: { value: 36, unit: 'in', comparison: '<' }, jobValue: { value: 34, unit: 'in', source: 'job', sourceLabel: 'your question' },
        },
        // "at most 7.75 in." with the sign its words mean (<=): the 8 in. riser is outside it.
        {
          id: 'riser', verdict: 'limit', summary: 'Sample: risers can be at most 7.75 in. tall.', section: 'R311.7.5.1', citedEdition: '2025 RCNYS', stage: 'final',
          trigger: { value: 7.75, unit: 'in', comparison: '<=' }, jobValue: { value: 8, unit: 'in', source: 'job', sourceLabel: 'your question' },
        },
      ],
    };
    await phoneRoute(`/construction-ai?mode=ask&projectId=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    });
    await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), 'Sample: what does a raised deck need?'); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
    await pump(6);
    const openButtons = () => screen.getAllByTestId(/^code-card-ask-[0-9a-z]+-open$/);
    const inSheet = (key: string) => screen.queryAllByTestId(new RegExp(`^construction-ask-cards-sheet-ask-[0-9a-z]+-${key}$`));
    const textOf = (node: { props: { children?: unknown } }) => [node.props.children].flat(Infinity).join('');
    const closeSheet = async () => { await act(async () => { fireEvent.press(inSheet('close')[0]); }); await pump(4); };
    expect(openButtons()).toHaveLength(3);

    // 1. Re-measure the first card: 34 in. → 36 in., close, reopen.
    await act(async () => { fireEvent.press(openButtons()[0]); });
    await pump(4);
    expect(textOf(inSheet('value')[0])).toBe('34');
    await act(async () => { fireEvent.press(inSheet('inc')[0]); });
    await act(async () => { fireEvent.press(inSheet('inc')[0]); });
    await pump(2);
    expect(textOf(inSheet('value')[0])).toBe('36');
    await closeSheet();
    expect(inSheet('value')).toHaveLength(0);
    await act(async () => { fireEvent.press(openButtons()[0]); });
    await pump(4);
    // The reopened card shows the number he measured, not the AI's first one…
    expect(textOf(inSheet('value')[0])).toBe('36');
    // …and Save keeps exactly that number.
    await act(async () => { fireEvent.press(inSheet('save')[0]); });
    await pump(4);
    const kept = (await savedStored())[PROJECT_ID] as unknown as { item: { summary: string }; jobValue?: { value: number; source: string } }[];
    expect(kept.map((c) => c.item.summary)).toEqual(['Sample: guards on every open side of the deck.']);
    expect(kept[0].jobValue).toEqual(expect.objectContaining({ value: 36, source: 'measured' }));
    await closeSheet();

    // 2. The limit whose sign points the wrong way: no tape, no − / +, and the
    //    text for a sub says nothing MAGE computed.
    await act(async () => { fireEvent.press(openButtons()[1]); });
    await pump(4);
    expect(screen.getAllByText('Sample: guard has to be at least 36 in. high.').length).toBeGreaterThan(0);
    expect(inSheet('tape')).toHaveLength(0);
    expect(inSheet('inc')).toHaveLength(0);
    expect(inSheet('equation')).toHaveLength(0);
    const wrongWay = textOf(inSheet('share-text')[0]);
    expect(wrongWay).toContain('Sample: guard has to be at least 36 in. high.');
    expect(wrongWay).not.toMatch(/Job: |Result:|within the limit/);
    await closeSheet();

    // 3. The limit whose sign is the one its words mean: the tape is drawn and
    //    the 8 in. riser reads OUTSIDE the limit.
    await act(async () => { fireEvent.press(openButtons()[2]); });
    await pump(4);
    expect(inSheet('tape').length).toBeGreaterThan(0);
    expect(textOf(inSheet('value')[0])).toBe('8');
    expect(textOf(inSheet('share-text')[0])).toContain('Result: outside the limit.');
    expect(textOf(inSheet('share-text')[0])).not.toContain('within the limit');
  });

  // THE RE-MEASURE BELONGS TO ONE CARD AS IT WAS SHOWN (integration round 3).
  // A card's id is made from its words, so the same line on a later answer has
  // the same id. Both cases below are the integration critic's, on the real
  // Ask screen: two answers in one mounted screen, the hook never remounted.
  it('a LATER answer never inherits an earlier answer’s re-measure: the same line with another job number shows its own number, on the list card, the opened card, the text to a sub and Save', async () => {
    const deck = (height: number) => ({
      id: 'req-1', verdict: 'required', summary: 'Sample: a guard is needed once the deck is more than 30 in. up.', section: 'R312.1.1', citedEdition: '2025 RCNYS', stage: 'final',
      trigger: { value: 30, unit: 'in', comparison: '>' }, jobValue: { value: height, unit: 'in', source: 'job', sourceLabel: 'your question' },
    });
    mockAskAnswer = { ...SAMPLE_ASK, requirements: [deck(34)] };
    await phoneRoute(`/construction-ai?mode=ask&projectId=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    });
    const ask = async (q: string) => {
      await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), q); });
      await pump(2);
      await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
      await pump(6);
    };
    const inSheet = (key: string) => screen.queryAllByTestId(new RegExp(`^construction-ask-cards-sheet-ask-[0-9a-z]+-${key}$`));
    const onCard = (key: string) => screen.queryAllByTestId(new RegExp(`^code-card-ask-[0-9a-z]+-${key}$`));
    const textOf = (node: { props: { children?: unknown } }) => [node.props.children].flat(Infinity).join('');
    const closeSheet = async () => { await act(async () => { fireEvent.press(inSheet('close')[0]); }); await pump(4); };

    // Answer 1: a 34 in. deck. He steps it down to 29 in.: NOT REQUIRED, on the
    // opened card and on the list card.
    await ask('Sample: my deck is 34 in. up. Does it need a guard?');
    const firstId = onCard('open')[0].props.testID as string;
    expect(onCard('verdict')[0].props.accessibilityLabel).toBe('Verdict: Required');
    await act(async () => { fireEvent.press(onCard('open')[0]); });
    await pump(4);
    for (let i = 0; i < 5; i++) await act(async () => { fireEvent.press(inSheet('dec')[0]); });
    await pump(2);
    expect(textOf(inSheet('value')[0])).toBe('29');
    expect(textOf(inSheet('share-text')[0])).toContain('Job: 29 in. (measured on site).');
    await closeSheet();
    expect(onCard('verdict')[0].props.accessibilityLabel).toBe('Verdict: Not required');

    // Answer 2: another deck, 40 in. up. The server words the requirement the
    // same way, so the card has the SAME id; its own number is 40 in.
    mockAskAnswer = { ...SAMPLE_ASK, requirements: [deck(40)] };
    await ask('Sample: the other deck is 40 in. up. Does it need a guard?');
    expect(onCard('open')).toHaveLength(1);
    expect(onCard('open')[0].props.testID).toBe(firstId);
    // The list card: REQUIRED, from its own 40 in.
    expect(onCard('verdict')[0].props.accessibilityLabel).toBe('Verdict: Required');
    expect(onCard('tape').length).toBeGreaterThan(0);
    // The opened card: 40, required, and the text to a sub says 40 in., never 29.
    await act(async () => { fireEvent.press(onCard('open')[0]); });
    await pump(4);
    expect(textOf(inSheet('value')[0])).toBe('40');
    expect(inSheet('verdict')[0].props.accessibilityLabel).toBe('Verdict: Required');
    const text = textOf(inSheet('share-text')[0]);
    expect(text).toContain('Job: 40 in. (your question).');
    expect(text).toContain('Result: required.');
    expect(text).not.toMatch(/29 in\.|measured on site|not required/);
    // Save keeps the number on screen: the card's own 40 in., no re-measure.
    await act(async () => { fireEvent.press(inSheet('save')[0]); });
    await pump(4);
    const kept = (await savedStored())[PROJECT_ID] as unknown as { item: { jobValue?: { value: number } }; jobValue?: { value: number } }[];
    expect(kept).toHaveLength(1);
    expect(kept[0].item.jobValue).toEqual(expect.objectContaining({ value: 40 }));
    expect(kept[0].jobValue).toBeUndefined();
  });

  it('a wrong-sign limit on a LATER answer draws no tape even after he re-measured the same line: no number, no "within the limit", on the list card, the opened card, the text to a sub or the saved card', async () => {
    const guard = (comparison: string, value: number) => ({
      id: 'req-1', verdict: 'limit', summary: 'Sample: guard has to be at least 36 in. high.', section: 'R312.1.2', citedEdition: '2025 RCNYS', stage: 'final',
      trigger: { value: 36, unit: 'in', comparison }, jobValue: { value, unit: 'in', source: 'job', sourceLabel: 'your question' },
    });
    mockAskAnswer = { ...SAMPLE_ASK, requirements: [guard('>=', 34)] };
    await phoneRoute(`/construction-ai?mode=ask&projectId=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    });
    const ask = async (q: string) => {
      await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), q); });
      await pump(2);
      await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
      await pump(6);
    };
    const inSheet = (key: string) => screen.queryAllByTestId(new RegExp(`^construction-ask-cards-sheet-ask-[0-9a-z]+-${key}$`));
    const onCard = (key: string) => screen.queryAllByTestId(new RegExp(`^code-card-ask-[0-9a-z]+-${key}$`));
    const textOf = (node: { props: { children?: unknown } }) => [node.props.children].flat(Infinity).join('');
    const closeSheet = async () => { await act(async () => { fireEvent.press(inSheet('close')[0]); }); await pump(4); };

    // Answer 1: the sign its words mean (>=). He steps the 34 in. guard to 37 in.
    await ask('Sample: my guard is 34 in. high. Is that OK?');
    const firstId = onCard('open')[0].props.testID as string;
    await act(async () => { fireEvent.press(onCard('open')[0]); });
    await pump(4);
    expect(inSheet('tape').length).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) await act(async () => { fireEvent.press(inSheet('inc')[0]); });
    await pump(2);
    expect(textOf(inSheet('value')[0])).toBe('37');
    expect(textOf(inSheet('share-text')[0])).toContain('Result: within the limit.');
    await closeSheet();

    // Answer 2: the same line, the sign the WRONG way (<). Nothing confirms that
    // sign, so the card carries no trigger and no number; the old re-measure of
    // this card id must not bring a number back.
    mockAskAnswer = { ...SAMPLE_ASK, requirements: [guard('<', 33)] };
    await ask('Sample: the other guard is 33 in. high. Is that OK?');
    expect(onCard('open')).toHaveLength(1);
    expect(onCard('open')[0].props.testID).toBe(firstId);
    expect(onCard('tape')).toHaveLength(0);
    await act(async () => { fireEvent.press(onCard('open')[0]); });
    await pump(4);
    expect(inSheet('tape')).toHaveLength(0);
    expect(inSheet('inc')).toHaveLength(0);
    expect(inSheet('value')).toHaveLength(0);
    expect(inSheet('equation')).toHaveLength(0);
    const text = textOf(inSheet('share-text')[0]);
    expect(text).toContain('Sample: guard has to be at least 36 in. high.');
    expect(text).not.toMatch(/Job: |Result:|Limit (?:below|above|at)|within the limit|measured on site/);
    await act(async () => { fireEvent.press(inSheet('save')[0]); });
    await pump(4);
    const kept = (await savedStored())[PROJECT_ID] as unknown as { item: { trigger?: unknown; jobValue?: unknown }; jobValue?: unknown }[];
    expect(kept).toHaveLength(1);
    expect(kept[0].jobValue).toBeUndefined();
    expect(kept[0].item.jobValue).toBeUndefined();
    expect(kept[0].item.trigger).toBeUndefined();
  });

  it('a pinned card is unpinned from the card itself: the opened card’s Checklist row pins, then says a tap takes it off, and the tap does', async () => {
    mockAskAnswer = { ...SAMPLE_ASK, requirements: SAMPLE_REQUIREMENTS };
    await phoneRoute(`/construction-ai?mode=ask&projectId=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    });
    await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), 'Sample: what does a raised deck need?'); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
    await pump(6);
    const inSheet = (key: string) => screen.queryAllByTestId(new RegExp(`^construction-ask-cards-sheet-ask-[0-9a-z]+-${key}$`));
    await act(async () => { fireEvent.press(cardButton('open')); });
    await pump(4);
    await act(async () => { fireEvent.press(inSheet('checklist')[0]); });
    await pump(4);
    expect((await pinsStored())[PROJECT_ID]?.map((p) => p.item.summary)).toEqual(['Sample: guards on every open side of the deck.']);
    expect(screen.getAllByText('On Final checklist. Tap to take it off.').length).toBe(1);
    // The same row, tapped again: the pin comes off, here, without leaving the card.
    await act(async () => { fireEvent.press(inSheet('checklist')[0]); });
    await pump(4);
    expect(await pinsStored()).toEqual({});
    expect(screen.queryByText('On Final checklist. Tap to take it off.')).toBeNull();
  });

  // THE WITHHOLD RULE, RENDERED (integration round 4). The gate must hide a
  // line that reads like code text everywhere it could print, and must NOT
  // hide an honest drawing line because it carries an inch mark.
  const CODE_TEXT = 'Guards shall be provided where the walking surface is more than 30 inches above grade.';
  const HID = 'MAGE hid this line because it read like code text. Use Official text to read the section.';
  it('Plan Review: a finding with inch marks shows its words on the card and in the list; a code-text finding shows the notice in both and its words nowhere', async () => {
    const RISER = 'Riser ≤ 7-3/4", tread ≥ 10".';
    await openPlanReview([
      { id: 'ccw-i1', category: 'stairs', codeRef: 'RCNYS 2025 R311.7.5', citedEdition: 'RCNYS 2025', section: 'R311.7.5', evidence: 'model_recall', requirement: RISER, observed: 'Riser scales 8" on the section.', severity: 'high', confidence: 'high', status: 'open' },
      { id: 'ccw-i2', category: 'guards', codeRef: 'RCNYS 2025 R312.1.1', citedEdition: 'RCNYS 2025', section: 'R312.1.1', evidence: 'model_recall', requirement: CODE_TEXT, observed: 'The note reads "PROVIDE GUARD".', severity: 'high', confidence: 'high', status: 'open' },
    ]);
    await act(async () => { fireEvent.press(screen.getByTestId('plan-review-details-toggle')); });
    await pump(2);
    // The inch-mark finding: its own words, on the card row AND in the list, with what the drawing shows.
    expect(screen.getAllByText(RISER).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Observed: Riser scales 8" on the section.').length).toBe(1);
    // The code-text finding: the notice on the card row AND in the list; the words and the quoted note nowhere.
    expect(screen.getAllByText(HID).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/shall be provided/)).toBeNull();
    expect(screen.queryByText(/PROVIDE GUARD/)).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/shall be provided|PROVIDE GUARD/);
  });

  it('Code Check: a line with an inch mark is shown as written (card and plain row); a code-text line is the notice on both, and its words are nowhere on the result', async () => {
    await runCodeCheck({
      ...SAMPLE_CODE_CHECK,
      applicableCodes: [
        { code: '2025 RCNYS', section: 'R312.1.2', requirement: 'Guard has to be at least 36" high.', verdict: 'limit' },
        { code: '2025 RCNYS', section: 'R311.7.5', requirement: 'Riser at most 7-3/4" on the deck stair.' },
        { code: '2025 RCNYS', section: 'R312.1.1', requirement: CODE_TEXT, verdict: 'required' },
        { code: '2025 RCNYS', section: 'R312.1.3', requirement: 'The code says "guards are required".' },
      ],
    });
    expect(screen.getByTestId('code-check-card-0')).toBeTruthy();
    expect(screen.getAllByText('Guard has to be at least 36" high.').length).toBeGreaterThan(0);
    expect(screen.getByTestId('code-check-plain-1')).toBeTruthy();
    expect(screen.getAllByText('Riser at most 7-3/4" on the deck stair.').length).toBe(1);
    expect(screen.getByTestId('code-check-card-2')).toBeTruthy();
    expect(screen.getByTestId('code-check-plain-3')).toBeTruthy();
    expect(screen.getAllByText(HID).length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/shall be provided|guards are required/);
  });

  // THE "SAVED" AND "ON … CHECKLIST" MARKS BELONG TO THE CARD AS SHOWN. The
  // critic's case on the real Ask screen: two answers word the requirement the
  // same way (same card id), with another verdict and another job number.
  it('a LATER answer with the same line is not marked Saved or On checklist from the earlier card; Save keeps what is on screen, and a − / + step after a save turns the mark off again', async () => {
    const deck = (height: number) => ({
      id: 'req-1', verdict: height > 30 ? 'required' : 'not_required', summary: 'Sample: a guard is needed once the deck is more than 30 in. up.', section: 'R312.1.1', citedEdition: '2025 RCNYS', stage: 'final',
      trigger: { value: 30, unit: 'in', comparison: '>' }, jobValue: { value: height, unit: 'in', source: 'job', sourceLabel: 'your question' },
    });
    mockAskAnswer = { ...SAMPLE_ASK, requirements: [deck(34)] };
    await phoneRoute(`/construction-ai?mode=ask&projectId=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    });
    const ask = async (q: string) => {
      await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), q); });
      await pump(2);
      await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
      await pump(6);
    };
    const inSheet = (key: string) => screen.queryAllByTestId(new RegExp(`^construction-ask-cards-sheet-ask-[0-9a-z]+-${key}$`));
    const onCard = (key: string) => screen.queryAllByTestId(new RegExp(`^code-card-ask-[0-9a-z]+-${key}$`));
    const done = (node: { props: { accessibilityState?: { checked?: boolean } } }) => node.props.accessibilityState?.checked === true;
    type Kept = { item: { verdict: string; jobValue?: { value: number } }; jobValue?: { value: number } };
    const savedNow = async () => ((await savedStored())[PROJECT_ID] ?? []) as unknown as Kept[];

    // Answer 1: REQUIRED at 34 in. He pins it and saves it from the opened card.
    await ask('Sample: my deck is 34 in. up. Does it need a guard?');
    const firstId = onCard('open')[0].props.testID as string;
    await act(async () => { fireEvent.press(onCard('open')[0]); });
    await pump(4);
    await act(async () => { fireEvent.press(inSheet('checklist')[0]); });
    await pump(2);
    await act(async () => { fireEvent.press(inSheet('save')[0]); });
    await pump(4);
    expect(done(inSheet('save')[0])).toBe(true);
    expect(done(inSheet('checklist')[0])).toBe(true);
    expect((await savedNow()).map((c) => [c.item.verdict, c.item.jobValue?.value, c.jobValue?.value])).toEqual([['required', 34, undefined]]);
    // A step after the save: the number on screen (33) is no longer the saved one, so Save is ready again…
    await act(async () => { fireEvent.press(inSheet('dec')[0]); });
    await pump(2);
    expect(done(inSheet('save')[0])).toBe(false);
    // …and saving keeps the number on screen, in place of the earlier copy.
    await act(async () => { fireEvent.press(inSheet('save')[0]); });
    await pump(4);
    expect(done(inSheet('save')[0])).toBe(true);
    expect((await savedNow()).map((c) => [c.item.jobValue?.value, c.jobValue?.value])).toEqual([[34, 33]]);
    await act(async () => { fireEvent.press(inSheet('close')[0]); });
    await pump(4);

    // Answer 2: the same line, NOT REQUIRED at 28 in. Same card id.
    mockAskAnswer = { ...SAMPLE_ASK, requirements: [deck(28)] };
    await ask('Sample: the other deck is 28 in. up. Does it need a guard?');
    expect(onCard('open')).toHaveLength(1);
    expect(onCard('open')[0].props.testID).toBe(firstId);
    expect(onCard('verdict')[0].props.accessibilityLabel).toBe('Verdict: Not required');
    // The list card's Checklist button does not claim the earlier pin.
    expect(screen.queryByText('On Final checklist')).toBeNull();
    await act(async () => { fireEvent.press(onCard('open')[0]); });
    await pump(4);
    expect(done(inSheet('save')[0])).toBe(false);
    expect(done(inSheet('checklist')[0])).toBe(false);
    expect(screen.queryByText(/Find it in Ask, under Saved code cards/)).toBeNull();
    expect(screen.queryByText('On Final checklist. Tap to take it off.')).toBeNull();
    // Save now stores THIS card (one saved card per line on a job: it replaces the earlier copy).
    await act(async () => { fireEvent.press(inSheet('save')[0]); });
    await pump(4);
    expect(done(inSheet('save')[0])).toBe(true);
    expect((await savedNow()).map((c) => [c.item.verdict, c.item.jobValue?.value, c.jobValue?.value])).toEqual([['not_required', 28, undefined]]);
  });

  it('unpinning the LAST pinned card from its own opened card leaves that card open until he closes it, and a later pin never reopens it by itself', async () => {
    mockAskAnswer = { ...SAMPLE_ASK, requirements: SAMPLE_REQUIREMENTS };
    await phoneRoute(`/construction-ai?mode=ask&projectId=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    });
    await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), 'Sample: what does a raised deck need?'); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
    await pump(6);
    // The saved lists' opened card (the body renders only while a card is open).
    const keptSheet = () => screen.queryAllByTestId(/^construction-ask-saved-cards-sheet-ask-[0-9a-z]+$/);
    const inKept = (key: string) => screen.queryAllByTestId(new RegExp(`^construction-ask-saved-cards-sheet-ask-[0-9a-z]+-${key}$`));
    await act(async () => { fireEvent.press(cardButton('checklist')); });
    await pump(4);
    const id = (await pinsStored())[PROJECT_ID]![0].item.id;
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-pinned-toggle')); });
    await pump(2);
    expect(keptSheet()).toHaveLength(0);
    // Open the pinned card from the pinned list, and unpin it from its own Checklist row.
    await act(async () => { fireEvent.press(screen.getByTestId(`code-row-${id}`)); });
    await pump(4);
    expect(keptSheet()).toHaveLength(1);
    await act(async () => { fireEvent.press(inKept('checklist')[0]); });
    await pump(4);
    expect(await pinsStored()).toEqual({});
    // The list is gone (it was the last pin), but the card he is looking at stays until he closes it.
    expect(screen.queryByTestId('construction-ask-pinned')).toBeNull();
    expect(keptSheet()).toHaveLength(1);
    await act(async () => { fireEvent.press(inKept('close')[0]); });
    await pump(4);
    expect(keptSheet()).toHaveLength(0);
    // He pins from the answer's list card again: the pin lands, and no sheet opens by itself.
    await act(async () => { fireEvent.press(cardButton('checklist')); });
    await pump(4);
    expect((await pinsStored())[PROJECT_ID]).toHaveLength(1);
    expect(screen.getByTestId('construction-ask-pinned')).toBeTruthy();
    expect(keptSheet()).toHaveLength(0);
  });

  it('a stage he picked on the opened card is not labelled "AI guess" afterwards: on the list card and when the card is opened again', async () => {
    mockAskAnswer = { ...SAMPLE_ASK, requirements: [SAMPLE_REQUIREMENTS[0]] };
    await phoneRoute(`/construction-ai?mode=ask&projectId=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    });
    await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), 'Sample: what does a raised deck need?'); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
    await pump(6);
    const inSheet = (key: string) => screen.queryAllByTestId(new RegExp(`^construction-ask-cards-sheet-ask-[0-9a-z]+-${key}$`));
    expect(screen.getAllByText('Final inspection · AI guess').length).toBeGreaterThan(0);
    await act(async () => { fireEvent.press(cardButton('open')); });
    await pump(4);
    await act(async () => { fireEvent.press(inSheet('stage')[0]); });
    await act(async () => { fireEvent.press(inSheet('stage-framing')[0]); });
    await pump(2);
    await act(async () => { fireEvent.press(inSheet('close')[0]); });
    await pump(4);
    // The list card: his stage, with no "AI guess" beside it.
    expect(screen.queryByText(/AI guess/)).toBeNull();
    expect(screen.getAllByText('Framing inspection').length).toBeGreaterThan(0);
    // Reopened: still his, still not a guess.
    await act(async () => { fireEvent.press(cardButton('open')); });
    await pump(4);
    expect(screen.queryByText(/AI guess/)).toBeNull();
    expect(inSheet('stage')[0].props.accessibilityLabel).toBe('Framing inspection. Change the inspection.');
  });

  it('a second answer never inherits the first answer\u2019s pin (ids come from the content)', async () => {
    mockAskAnswer = { ...SAMPLE_ASK, requirements: [{ ...SAMPLE_REQUIREMENTS[0], id: 'req-1' }] };
    await phoneRoute(`/construction-ai?mode=ask&projectId=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    });
    await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), 'Sample: what does a raised deck need?'); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
    await pump(6);
    await act(async () => { fireEvent.press(cardButton('checklist')); });
    await pump(4);
    expect(screen.getAllByText('On Final checklist').length).toBeGreaterThan(0);
    // Another question, another requirement that the server also calls req-1.
    mockAskAnswer = { ...SAMPLE_ASK, requirements: [{ ...SAMPLE_REQUIREMENTS[2], id: 'req-1' }] };
    await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), 'Sample: what about the stair handrail?'); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
    await pump(6);
    expect(screen.getAllByText('Sample: stair handrail, top of rail in the allowed range.').length).toBeGreaterThan(0);
    expect(screen.queryByText('On Final checklist')).toBeNull();
    const pins = await pinsStored();
    expect(pins[PROJECT_ID]?.map((p) => p.item.summary)).toEqual(['Sample: guards on every open side of the deck.']);
  });
});

// ── 3. CARDS2 — AI prose passes the own-words gate ─────────────────────────
//
// Three places printed AI text about a model code with only the prompt's rule
// in the way: the Code Check summary, the drill-in answer and Inspection
// Ready's recall list. Each now goes through the kit's gate in prose mode:
// a sentence that reads like code text never prints, the rest stays, and the
// surface says so once with the cards' own notice and the section number.
// Every line here is a SAMPLE; the code-shaped ones are made up for the test.
describe('CARDS2 — the summary, the drill-in and the recall list print MAGE\u2019s own words only', () => {
  jest.setTimeout(150000);
  // CARDS3: a paragraph or a list has no Official text button, so a prose
  // surface carries its own notice, and points at the free viewer only where
  // the viewer links are rendered right under it.
  const NOTICE = 'MAGE hid wording here because it read like code text.';
  const VIEWER = "Read the code in the publisher's free viewer, below.";

  it('Code Check summary: a code-shaped sentence is replaced by the notice with its section, once; the rest of the paragraph stays', async () => {
    await runCodeCheck({
      ...SAMPLE_CODE_CHECK,
      summary: 'Sample summary: a raised deck needs guards. R312.1 "Sample title" says sample guards shall be provided. Sample again: sample height not less than a sample figure. Sample: plan on a final inspection.',
    });
    expect(screen.getAllByText(`Sample summary: a raised deck needs guards. ${NOTICE} Section: R312.1. Sample: plan on a final inspection.`)).toHaveLength(1);
    expect(screen.queryAllByText(/shall be provided|not less than|Sample title/)).toHaveLength(0);
    // (The cards keep their own Official text button; no NOTICE names it.)
    expect(screen.queryAllByText(/Use Official text/)).toHaveLength(0);
    // Massapequa, NY resolves to an edition, so the result has viewer links:
    // the viewer line prints under the paragraph WITH the links it points at.
    expect(screen.getByTestId('code-check-summary-withheld').props.children).toBe(VIEWER);
    expect(within(screen.getByTestId('code-check-summary-withheld-viewer')).getAllByRole('link').length).toBeGreaterThan(0);
    // The cards under it are untouched.
    expect(screen.getByTestId('code-check-card-0')).toBeTruthy();
  });

  it('Code Check summary: a long paragraph in plain words prints whole (prose has no word cap)', async () => {
    const long = `Sample summary: ${'this is an ordinary long sample sentence about the job that keeps going in plain words '.repeat(5)}and then it ends. Sample: plan on a final inspection.`;
    await runCodeCheck({ ...SAMPLE_CODE_CHECK, summary: long });
    expect(screen.getAllByText(long)).toHaveLength(1);
    expect(screen.queryAllByText(new RegExp(NOTICE.slice(0, 40)))).toHaveLength(0);
  });

  it('Code Check drill-in: code-shaped sentences and bullets never print; the notice shows once with the row\u2019s section', async () => {
    mockCodeDetailData = {
      plainEnglish: 'Sample: a guard goes on every open side. Sample guards shall be not less than a sample height. Sample: keep the gaps tight.',
      appliesBecause: 'Sample: the deck is 34 in. above grade.',
      inspectorChecks: ['Sample: guard height at the low side', 'R312.1 "Sample title" on every open side'],
      commonFailures: ['Exception: sample decks under a sample height.'],
      ruleOfThumb: 'Sample: measure from the walking surface.',
    };
    await runCodeCheck();
    await act(async () => { fireEvent.press(screen.getByTestId('code-detail-toggle-0')); });
    await pump(6);
    expect(screen.getAllByText('Sample: a guard goes on every open side. Sample: keep the gaps tight.')).toHaveLength(1);
    expect(screen.getAllByText('Sample: the deck is 34 in. above grade.')).toHaveLength(1);
    expect(screen.getAllByText('\u2022 Sample: guard height at the low side')).toHaveLength(1);
    expect(screen.getAllByText('Sample: measure from the walking surface.')).toHaveLength(1);
    expect(screen.queryAllByText(/shall be not less than|Sample title|Exception:/)).toHaveLength(0);
    // The only failure bullet was withheld, so its heading has nothing under it and is not shown.
    expect(screen.queryAllByText('How jobs fail it')).toHaveLength(0);
    expect(screen.getByTestId('code-detail-withheld-0').props.children).toBe(`${NOTICE} Section: 2025 RCNYS R312.1. ${VIEWER}`);
    expect(within(screen.getByTestId('code-detail-withheld-0-viewer')).getAllByRole('link').length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(`^${NOTICE.replace(/\./g, '\\.')}`))).toHaveLength(1);
    expect(screen.queryAllByText(/Use Official text/)).toHaveLength(0);
  });

  it('Code Check drill-in: an answer in plain words prints as written, with no notice', async () => {
    mockCodeDetailData = {
      plainEnglish: 'Sample: a guard goes on every open side of the deck.',
      appliesBecause: 'Sample: the deck is 34 in. above grade.',
      inspectorChecks: ['Sample: guard height at the low side'],
      commonFailures: ['Sample: guard left off the stair side'],
      ruleOfThumb: '',
    };
    await runCodeCheck();
    await act(async () => { fireEvent.press(screen.getByTestId('code-detail-toggle-0')); });
    await pump(6);
    expect(screen.getAllByText('Sample: a guard goes on every open side of the deck.')).toHaveLength(1);
    expect(screen.getAllByText('\u2022 Sample: guard left off the stair side')).toHaveLength(1);
    expect(screen.getAllByText('How jobs fail it')).toHaveLength(1);
    expect(screen.queryByTestId('code-detail-withheld-0')).toBeNull();
  });

  it('Inspection Ready recall: a code-shaped line is never a checklist row; the group says so once, and plain lines stay', async () => {
    mockRecallData = {
      items: [
        { text: 'Sample: guard on every open side', codeRef: '', confidence: 'high', why: 'Sample: the deck is raised' },
        { text: 'Sample guards shall be provided on sample open sides.', codeRef: 'R312.1.1', confidence: 'high', why: 'Sample reason' },
        { text: 'Sample: check the baluster spacing. Sample openings shall not pass a sample sphere.', codeRef: '', confidence: 'med', why: 'Sample: balusters are in scope' },
        { text: 'Sample: handrail on the stair', codeRef: '', confidence: 'low', why: 'The label reads "sample".' },
      ],
      followUps: [
        { question: 'Sample: any stairs with four or more risers?', options: ['Yes', 'No', 'Not sure'] },
        { question: 'Sample: is it installed in accordance with the listing?', options: ['Yes', 'No'] },
      ],
    };
    await phoneRoute(`/project-detail?id=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
      await seedInspection();
    });
    const rows = screen.getAllByText('Get ready for Final inspection');
    await act(async () => { fireEvent.press(rows[0]); });
    await pump(8);
    expect(screen.getAllByText('Sample: guard on every open side')).toHaveLength(1);
    expect(screen.getAllByText('Sample: check the baluster spacing.')).toHaveLength(1);
    expect(screen.getAllByText('Sample: handrail on the stair')).toHaveLength(1);
    expect(screen.getAllByText('Sample: any stairs with four or more risers?')).toHaveLength(1);
    expect(screen.queryAllByText(/shall be provided|shall not pass|in accordance with|The label reads/)).toHaveLength(0);
    const box = screen.getByTestId('inspection-prep-recall-withheld');
    const said = within(box).getAllByText(new RegExp(`^${NOTICE.replace(/\./g, '\\.')}`));
    expect(said).toHaveLength(1);
    // The notice points at the viewer exactly when viewer buttons are in the
    // same box, and never names the card's Official text button.
    const noticeText = String(said[0].props.children);
    const viewerButtons = within(box).queryAllByRole('link');
    expect(noticeText.endsWith(VIEWER)).toBe(viewerButtons.length > 0);
    expect(/viewer|below|button|link/i.test(noticeText)).toBe(viewerButtons.length > 0);
    expect(within(box).queryAllByText(/Official text/)).toHaveLength(0);
    expect(screen.getAllByText(new RegExp(`^${NOTICE.replace(/\./g, '\\.')}`))).toHaveLength(1);
    expect(screen.queryAllByText('Nothing to add beyond the lists above.')).toHaveLength(0);
  });

  it('Inspection Ready recall: a list in plain words shows no notice', async () => {
    mockRecallData = {
      items: [{ text: 'Sample: guard on every open side', codeRef: '', confidence: 'high', why: 'Sample: the deck is raised' }],
      followUps: [],
    };
    await phoneRoute(`/project-detail?id=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
      await seedInspection();
    });
    const rows = screen.getAllByText('Get ready for Final inspection');
    await act(async () => { fireEvent.press(rows[0]); });
    await pump(8);
    expect(screen.getAllByText('Sample: guard on every open side')).toHaveLength(1);
    expect(screen.queryByTestId('inspection-prep-recall-withheld')).toBeNull();
  });
});


describe('CARDS3 — the Code Check lists, the prose notice and the glued inch mark', () => {
  jest.setTimeout(150000);
  const NOTICE = 'MAGE hid wording here because it read like code text.';
  const VIEWER = "Read the code in the publisher's free viewer, below.";
  const CODE_SHAPED = /shall be pulled|Sample title|not less than|Exception:|in accordance with/;

  const LISTS_SAMPLE = {
    ...SAMPLE_CODE_CHECK,
    permitsRequired: ['Sample: building permit', 'Per R105.1 "Sample title", a sample permit shall be pulled.', 'Sample: electrical permit', 'Exception: sample sheds.'],
    inspections: ['Sample: footing inspection', 'Sample: final inspection'],
    commonViolations: ['Sample guards shall be not less than a sample height.'],
    followUps: [
      { id: 'q1', question: 'Sample: any stairs with four or more risers?', options: ['Yes', 'No'] },
      { id: 'q2', question: 'Sample: is it built in accordance with R312.1?', options: ['Yes', 'No'] },
    ],
  };

  it('Code Check lists: a code-shaped permit, violation or question never prints; each list says so once, where the hidden line was, with the viewer under it', async () => {
    await runCodeCheck(LISTS_SAMPLE);
    for (const k of ['permits', 'inspections', 'violations']) {
      await act(async () => { fireEvent.press(screen.getByTestId(`code-check-accordion-${k}`)); });
      await pump(2);
      if (k === 'permits') {
        // Two of four lines were hidden: the two plain ones print, the notice
        // prints ONCE (not once per hidden line), with the section it named.
        expect(screen.getAllByText('\u2022 Sample: building permit')).toHaveLength(1);
        expect(screen.getAllByText('\u2022 Sample: electrical permit')).toHaveLength(1);
        expect(screen.getAllByTestId('code-check-permits-withheld')).toHaveLength(1);
        expect(screen.getByTestId('code-check-permits-withheld').props.children).toBe(`${NOTICE} Section: R105.1. ${VIEWER}`);
        expect(within(screen.getByTestId('code-check-permits-withheld-viewer')).getAllByRole('link').length).toBeGreaterThan(0);
      }
      if (k === 'inspections') {
        // A list in plain words is untouched and carries no notice.
        expect(screen.getAllByText('\u2022 Sample: footing inspection')).toHaveLength(1);
        expect(screen.getAllByText('\u2022 Sample: final inspection')).toHaveLength(1);
        expect(screen.queryByTestId('code-check-inspections-withheld')).toBeNull();
      }
      if (k === 'violations') {
        // Every line was hidden: the section still opens and says so.
        expect(screen.getByTestId('code-check-violations-withheld').props.children).toBe(`${NOTICE} ${VIEWER}`);
      }
      expect(screen.queryAllByText(CODE_SHAPED)).toHaveLength(0);
    }
    // The follow-ups: the plain question is asked, the code-shaped one is not,
    // and the questions say so once.
    expect(screen.getAllByText('Sample: any stairs with four or more risers?')).toHaveLength(1);
    expect(screen.queryByTestId('codethread-answer-q2-Yes')).toBeNull();
    expect(screen.getAllByTestId('codethread-followups-withheld')).toHaveLength(1);
    expect(screen.getByTestId('codethread-followups-withheld').props.children).toBe(`${NOTICE} Section: R312.1. ${VIEWER}`);
    expect(screen.queryAllByText(CODE_SHAPED)).toHaveLength(0);
    expect(screen.queryAllByText(/Use Official text/)).toHaveLength(0);
  });

  it('with no viewer link on the result (the jurisdiction is not known) every prose notice names no button, no link and no viewer', async () => {
    mockCodeDetailData = {
      plainEnglish: 'Sample: a guard goes on every open side. Sample guards shall be not less than a sample height.',
      appliesBecause: 'Sample: the deck is 34 in. above grade.',
      inspectorChecks: ['Sample: guard height at the low side'],
      commonFailures: [],
      ruleOfThumb: '',
    };
    await runCodeCheck({
      ...LISTS_SAMPLE,
      summary: 'Sample summary: a raised deck needs guards. R312.1 "Sample title" says sample guards shall be provided. Sample: plan on a final inspection.',
    }, { city: 'Sampletown', state: 'ZZ' });
    // No edition, so the result renders no viewer buttons at all.
    expect(screen.queryByTestId('code-check-viewer-links-result')).toBeNull();
    expect(screen.getAllByText(`Sample summary: a raised deck needs guards. ${NOTICE} Section: R312.1. Sample: plan on a final inspection.`)).toHaveLength(1);
    expect(screen.queryByTestId('code-check-summary-withheld')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('code-detail-toggle-0')); });
    await pump(6);
    // (Read the drill-in's notice before opening Permits: one section is open at a time.)
    const drillSaid = String(screen.getByTestId('code-detail-withheld-0').props.children);
    expect(screen.queryByTestId('code-detail-withheld-0-viewer')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('code-check-accordion-permits')); });
    await pump(2);
    const said = [
      drillSaid,
      String(screen.getByTestId('code-check-permits-withheld').props.children),
      String(screen.getByTestId('codethread-followups-withheld').props.children),
    ];
    for (const text of said) {
      expect(text.startsWith(NOTICE)).toBe(true);
      expect(/viewer|below|button|link|Official text|tap/i.test(text)).toBe(false);
    }
    expect(said[1]).toBe(`${NOTICE} Section: R105.1.`);
    expect(screen.queryAllByText(VIEWER)).toHaveLength(0);
    expect(screen.queryAllByText(/Use Official text/)).toHaveLength(0);
    for (const id of ['code-check-permits-withheld-viewer', 'codethread-followups-withheld-viewer']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('an inch mark glued to an abbreviation (12"o.c.) no longer hides the rest of the paragraph or a list line', async () => {
    const summary = 'Sample summary: set the sample joists at 12"o.c. along the beam. Sample: the guard is 36"min at the stair. Sample: plan on a final inspection.';
    await runCodeCheck({ ...SAMPLE_CODE_CHECK, summary, permitsRequired: ['Sample: deck permit for joists at 16"O.C.'] });
    expect(screen.getAllByText(summary)).toHaveLength(1);
    await act(async () => { fireEvent.press(screen.getByTestId('code-check-accordion-permits')); });
    await pump(2);
    expect(screen.getAllByText('\u2022 Sample: deck permit for joists at 16"O.C.')).toHaveLength(1);
    expect(screen.queryAllByText(new RegExp(NOTICE.slice(0, 30)))).toHaveLength(0);
    expect(screen.queryByTestId('code-check-summary-withheld')).toBeNull();
    expect(screen.queryByTestId('code-check-permits-withheld')).toBeNull();
  });
});
