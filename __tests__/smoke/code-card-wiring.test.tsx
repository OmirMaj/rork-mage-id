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
 *  2. BEHAVIOUR — the wiring itself (cards, pins, Save, Ask town), asserted
 *     outright in the second describe block.
 *
 * Set CCWIRE_DUMP_DIR to write each dump for a diff.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';
import { PROJECT_ID, ESTIMATE_ID } from '@/__tests__/fixtures/world';
import type { Permit } from '@/types';

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
jest.mock('@/utils/mageAI', () => {
  const actual = jest.requireActual('@/utils/mageAI');
  return {
    ...actual,
    mageAISmart: async (prompt: string) => {
      mockAiPrompts.push(prompt);
      return mockCodeCheckData
        ? { success: true, data: mockCodeCheckData, cached: true }
        : { success: false, error: 'not in this test' };
    },
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
  mockAskAnswer = null;
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
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${volatile(String(node))}"`); return; }
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
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
    { code: '2025 RCNYS', section: 'R312.1', requirement: 'Sample: guards on open sides of a raised deck.' },
    { code: '2025 RCNYS', section: '', requirement: 'Sample: a handrail on the deck stair.' },
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
async function seedPlanReview() {
  const sheets = [{
    id: SHEET_ID, projectId: PROJECT_ID, name: 'Deck plan', sheetNumber: 'A-2',
    imageUri: 'data:image/png;base64,iVBORw0KGgo=', createdAt: '2026-09-01T12:00:00.000Z',
  }];
  await AsyncStorage.setItem('mageid_plan_sheets', JSON.stringify(sheets));
  const review = {
    id: 'ccw-review-1', projectId: PROJECT_ID, planSheetId: SHEET_ID, reviewedAt: '2026-09-02T12:00:00.000Z',
    findings: [
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

async function runCodeCheck() {
  mockCodeCheckData = SAMPLE_CODE_CHECK;
  const tree = await phoneRoute('/construction-ai', async () => {
    await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
  });
  await act(async () => { fireEvent.changeText(screen.getByTestId('code-check-city'), 'Massapequa'); });
  await act(async () => { fireEvent.changeText(screen.getByTestId('code-check-state'), 'NY'); });
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

async function openPlanReview() {
  const tree = await phoneRoute('/construction-ai', async () => {
    await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
    await seedPlanReview();
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

async function pinsStored(): Promise<Record<string, Array<{ stage: string; item: { id: string } }>>> {
  return JSON.parse((await AsyncStorage.getItem('mageid_code_pins_v1')) ?? '{}');
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
    await act(async () => { fireEvent.press(screen.getByTestId('code-card-guards-checklist')); });
    expect(screen.getAllByText(/Link a job first/).length).toBeGreaterThan(0);
    expect(await pinsStored()).toEqual({});
  });

  it('Code Check: every citation is a card, the ladder and the drill-in stay with it', async () => {
    await runCodeCheck();
    expect(screen.getByTestId('code-check-card-0')).toBeTruthy();
    expect(screen.getByTestId('code-check-card-1')).toBeTruthy();
    expect(screen.getByTestId('code-check-rung-0')).toBeTruthy();
    expect(screen.getByTestId('code-detail-toggle-0')).toBeTruthy();
    // The prompt carried the no-verbatim sentence.
    expect(mockAiPrompts.some((p) => p.includes('Write every requirement in your own words. Never quote or reproduce the text of any model code (ICC, NFPA) word for word.'))).toBe(true);
    // The ICC line sits beside the viewer buttons.
    expect(screen.getAllByText("Opens ICC's free public viewer. MAGE ID is not affiliated with or endorsed by ICC.").length).toBeGreaterThan(0);
    // No job: Ask town says why.
    await act(async () => { fireEvent.press(screen.getByTestId('code-check-card-0-ask')); });
    expect(screen.getAllByText(/Link a job first/).length).toBeGreaterThan(0);
  });

  it('Plan Review: findings become status-grouped cards; the details list opens on tap', async () => {
    await openPlanReview();
    expect(screen.getByTestId('plan-review-card-list')).toBeTruthy();
    expect(screen.queryByTestId('plan-review-rung-ccw-f1')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('plan-review-details-toggle')); });
    await pump(2);
    expect(screen.getByTestId('plan-review-rung-ccw-f1')).toBeTruthy();
  });
  it('Ask on a linked job: Checklist pins the card, and Inspection Ready shows it under the final', async () => {
    mockAskAnswer = { ...SAMPLE_ASK, requirements: SAMPLE_REQUIREMENTS };
    await phoneRoute(`/construction-ai?mode=ask&projectId=${PROJECT_ID}`, async () => {
      await AsyncStorage.setItem('mageid_subscription_tier', 'enterprise');
      await seedInspection();
    });
    await act(async () => { fireEvent.changeText(screen.getByTestId('construction-ask-input'), 'Sample: what does a raised deck need?'); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByTestId('construction-ask-run')); });
    await pump(6);
    await act(async () => { fireEvent.press(screen.getByTestId('code-card-guards-checklist')); });
    await pump(4);
    const pins = await pinsStored();
    expect(pins[PROJECT_ID]?.map((p) => [p.item.id, p.stage])).toEqual([['guards', 'final']]);
    // The card now says where it landed.
    expect(screen.getAllByText('On Final checklist').length).toBeGreaterThan(0);

    // Inspection Ready on the same job, for its booked final.
    await mountRouteChecked(`/project-detail?id=${PROJECT_ID}`);
    await pump(4);
    const rows = screen.getAllByText('Get ready for Final inspection');
    await act(async () => { fireEvent.press(rows[0]); });
    await pump(4);
    expect(screen.getByTestId('inspection-prep-pinned')).toBeTruthy();
    expect(screen.getAllByText('Sample: guards on every open side of the deck.').length).toBeGreaterThan(0);
  });
});
