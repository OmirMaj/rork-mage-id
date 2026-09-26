/**
 * Plan Set Code Sweep (list-2 lane S) — BEHAVIOUR ONLY, no snapshot.
 *
 * The panel is mounted inside the real app tree (an injected route under
 * app/_layout), so useProjects / useTierAccess / useAuth are the real
 * providers and "Draft RFI to architect" goes through the real addRFI. Only the
 * network edge is faked: supabase.functions.invoke for the index manifest
 * (project-memory-embed), the plan search (project-memory-search) and the plan
 * review (analyze-plan-code), and supabase.rpc for the allowance read. The
 * real planSweep / planSweepRun / planCodeReviewer run on those answers.
 *
 * The Plans route's own golden (w6d-plans-phone) proves the CTA and the
 * closed sheet change nothing on the phone; this file proves the panel works.
 */

import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';
import { useProjects } from '@/contexts/ProjectContext';
import PlanSweepPanel from '@/components/plans/PlanSweepPanel';
import { FORBIDDEN_WORDS, sweepCopy } from '@/utils/plans/planSweep';
import type { PlanSheet } from '@/types';

// Record every router.push the panel makes; /rfi and /punch-list are recorded, not mounted.
const mockPushes: unknown[] = [];
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useRouter: () => {
      const r = actual.useRouter();
      return {
        ...r,
        push: (href: unknown) => {
          mockPushes.push(href);
          const path = typeof href === 'string' ? href : (href as { pathname?: string })?.pathname;
          if (path !== '/rfi' && path !== '/punch-list') r.push(href);
        },
      };
    },
  };
});

const IMG = 'data:image/png;base64,AAAA';
const SHEETS: PlanSheet[] = [
  { id: 'sw1', projectId: PROJECT_ID, name: 'A-101', sheetNumber: 'A-101', imageUri: IMG, createdAt: '2026-09-01T00:00:00Z' },
  { id: 'sw2', projectId: PROJECT_ID, name: 'A-201', sheetNumber: 'A-201', imageUri: IMG, createdAt: '2026-09-01T00:00:00Z' },
  { id: 'sw3', projectId: PROJECT_ID, name: 'S-101', sheetNumber: 'S-101', imageUri: IMG, createdAt: '2026-09-01T00:00:00Z' },
  { id: 'sw4', projectId: PROJECT_ID, name: 'E-101', sheetNumber: 'E-101', imageUri: IMG, createdAt: '2026-09-01T00:00:00Z' },
] as unknown as PlanSheet[];

const SWEEP_FNS = new Set(['project-memory-embed', 'project-memory-search', 'analyze-plan-code']);
const SEARCH_CAP = 'Monthly Project Memory limit reached — try again next month or upgrade.';
const VIOLATING = {
  category: 'egress', codeRef: 'IRC R310.1', citedEdition: 'IRC 2021', section: 'R310.1',
  requirement: 'Window violates R310 egress', observed: 'Bedroom 2 window looks small',
  severity: 'high', confidence: 'med', evidence: 'model_recall',
  question: 'Does the bedroom 2 window meet the egress opening size?', location: { x: 0.2, y: 0.3 },
};

const UNPLACED = { ...VIOLATING, question: 'Is the stair handrail height shown on this sheet?', location: null };

type Scenario = { search: 'ok' | 'cap'; review: 'findings' | 'none' | 'cap-second' | 'mixed' };
let scenario: Scenario = { search: 'ok', review: 'findings' };
let reviewCalls = 0;
const sweepInvokes: string[] = [];
const sweepRpcs: string[] = [];

function refusal(status: number, code: string, error: string) {
  return { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => ({ success: false, error, code }) } } };
}

const spies: jest.SpyInstance[] = [];
function installNetwork() {
  const realInvoke = supabase.functions.invoke;
  const realRpc = supabase.rpc;
  spies.push(jest.spyOn(supabase.functions, 'invoke').mockImplementation((async (fn: string, opts?: { body?: Record<string, unknown> }) => {
    if (!SWEEP_FNS.has(fn)) return realInvoke(fn, opts);
    sweepInvokes.push(fn);
    if (fn === 'project-memory-embed') return { data: { success: true, stale: ['plan-sheet:sw4'] }, error: null };
    if (fn === 'project-memory-search') {
      if (scenario.search === 'cap') return refusal(429, 'cap_reached', SEARCH_CAP);
      return {
        data: {
          success: true,
          matches: [
            { doc_id: 'plan-sheet:sw2', source: 'Plan Sheet', ref: 'A-201', content: 'EGRESS WINDOW AT BEDROOM 2', similarity: 0.8 },
            { doc_id: 'plan-sheet:sw1', source: 'Plan Sheet', ref: 'A-101', content: 'STAIR 1 HANDRAIL', similarity: 0.7 },
          ],
        },
        error: null,
      };
    }
    reviewCalls += 1;
    if (scenario.review === 'cap-second' && reviewCalls >= 2) {
      return refusal(429, 'monthly_cap_reached', 'Monthly plan-review limit reached (10 on pro). Resets on the 1st.');
    }
    const findings = scenario.review === 'none' ? [] : scenario.review === 'mixed' ? [VIOLATING, UNPLACED] : [VIOLATING];
    return { data: { success: true, data: { findings, disclaimer: 'verify' }, usage: { used: 3, cap: 10 } }, error: null };
  }) as never));
  spies.push(jest.spyOn(supabase, 'rpc').mockImplementation(((fn: string, args?: unknown) => {
    if (fn !== 'ai_usage_get') return realRpc(fn, args);
    sweepRpcs.push(fn);
    return Promise.resolve({ data: 2, error: null });
  }) as never));
}

function Harness() {
  const { getProject, getRFIsForProject, getPunchItemsForProject, drawingPins } = useProjects();
  const [show, setShow] = useState(false);
  const project = getProject(PROJECT_ID);
  if (!project) return <Text>loading</Text>;
  const rfis = getRFIsForProject(PROJECT_ID).map(r => ({ ball: r.ballInCourt, to: r.assignedTo, status: r.status, q: r.question, n: r.number }));
  const punches = getPunchItemsForProject(PROJECT_ID).filter(p => p.description.startsWith('Check on '));
  const pins = drawingPins.filter(d => d.projectId === PROJECT_ID && d.kind === 'punch');
  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity testID="probe-show" onPress={() => setShow(true)}><Text>show</Text></TouchableOpacity>
      <Text testID="probe-rfis">{JSON.stringify(rfis)}</Text>
      <Text testID="probe-punches">{JSON.stringify(punches)}</Text>
      <Text testID="probe-pins">{JSON.stringify(pins)}</Text>
      {show ? <PlanSweepPanel project={project} sheets={SHEETS} onUpgrade={() => {}} onClose={() => {}} /> : null}
    </View>
  );
}

function allText(): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const c = (n as { children?: unknown }).children;
    if (c) walk(c);
  };
  walk(screen.toJSON());
  return out.join(' ');
}

async function mountPanel(tier: 'free' | 'pro') {
  await AsyncStorage.setItem('mageid_subscription_tier', tier);
  await mountRouteChecked('/plansweep-harness', Harness);
  await settle();
  installNetwork();
  sweepInvokes.length = 0; sweepRpcs.length = 0;
  await act(async () => { fireEvent.press(screen.getByTestId('probe-show')); });
  await settle();
}

async function press(id: string) {
  await act(async () => { fireEvent.press(screen.getByTestId(id)); });
  await settle();
}

beforeEach(async () => {
  allowConsoleErrors();
  while (spies.length) spies.pop()!.mockRestore();
  mockPushes.length = 0;
  reviewCalls = 0;
  scenario = { search: 'ok', review: 'findings' };
  await primeWorld('populated');
});

test('(1) mounting the panel makes no network call — no search, no review, no allowance read', async () => {
  await mountPanel('pro');
  expect(screen.getByTestId('plansweep-panel')).toBeTruthy();
  expect(sweepInvokes).toEqual([]);
  expect(sweepRpcs).toEqual([]);
  expect(screen.getByTestId('plansweep-recall-chip')).toBeTruthy();
  expect(allText()).toContain(sweepCopy.recallLine);
});

test('(2) free tier: blocked, with the reason, and the button spends nothing', async () => {
  await mountPanel('free');
  expect(screen.getByTestId('plansweep-blocked')).toBeTruthy();
  expect(allText()).toContain(sweepCopy.freeBlocked);
  expect(screen.queryByTestId('plansweep-find')).toBeNull();
  await press('plansweep-find-disabled');
  expect(sweepInvokes).toEqual([]);
});

test('(3) stage A picks the sheets, lists the unindexed one as NOT reviewed, and spends no plan review', async () => {
  await mountPanel('pro');
  await press('plansweep-find');
  expect(sweepInvokes).toContain('project-memory-search');
  expect(sweepInvokes).not.toContain('analyze-plan-code');
  expect(screen.getByTestId('plansweep-chosen-sw2')).toBeTruthy();
  expect(screen.getByTestId('plansweep-chosen-sw1')).toBeTruthy();
  expect(screen.getByTestId('plansweep-not-reviewed-sw4')).toBeTruthy();
  expect(allText()).toContain(sweepCopy.whyNotIndexed);
  expect(screen.getByTestId('plansweep-not-reviewed-sw3')).toBeTruthy();
  // The review button states its cost: 2 sheets of the 8 left (cap 10 − 2 used).
  expect(allText()).toContain(sweepCopy.reviewButton(2, 8));
});

test('(4) stage B: questions with the recall label, no verdict word; Draft RFI makes an unsent draft, Open goes to /rfi', async () => {
  await mountPanel('pro');
  await press('plansweep-find');
  await press('plansweep-review');
  expect(reviewCalls).toBe(2);
  const text = allText();
  expect(text).toContain(VIOLATING.question);
  expect(text).toContain(sweepCopy.requirementLabel);
  expect(text).not.toMatch(/violates/i);
  expect(FORBIDDEN_WORDS.test(text)).toBe(false);
  expect(text).toContain('R310');

  const key = 'sw2#0';
  await press(`plansweep-draft-${key}`);
  const rfis = JSON.parse(String(screen.getByTestId('probe-rfis').props.children)) as { ball: string; to: string; status: string; q: string; n: number }[];
  const drafted = rfis.find(r => /model's recall/.test(r.q));
  expect(drafted).toBeTruthy();
  expect(drafted!.ball).toBe('gc');
  expect(drafted!.to).toBe('');
  expect(drafted!.status).toBe('open');
  expect(FORBIDDEN_WORDS.test(drafted!.q)).toBe(false);
  expect(allText()).toContain(sweepCopy.drafted(drafted!.n));
  await press(`plansweep-open-rfi-${key}`);
  expect(mockPushes).toContainEqual(expect.objectContaining({ pathname: '/rfi' }));
});

test('(5) monthly_cap_reached mid-run: the rest are listed as NOT reviewed, with why', async () => {
  scenario = { search: 'ok', review: 'cap-second' };
  await mountPanel('pro');
  await press('plansweep-find');
  await press('plansweep-review');
  expect(reviewCalls).toBe(2);
  expect(screen.getByTestId('plansweep-not-reviewed-sw1')).toBeTruthy();
  expect(allText()).toContain(sweepCopy.monthlyLimit);
});

test('(6) a search cap_reached shows the function\'s own sentence', async () => {
  scenario = { search: 'cap', review: 'findings' };
  await mountPanel('pro');
  await press('plansweep-find');
  expect(screen.getByTestId('plansweep-search-stopped')).toBeTruthy();
  expect(allText()).toContain(SEARCH_CAP);
  expect(allText()).not.toMatch(/search failed/i);
  expect(sweepInvokes).not.toContain('analyze-plan-code');
});

test('(7) zero findings: the scoped "No questions raised" sentence, never a pass', async () => {
  scenario = { search: 'ok', review: 'none' };
  await mountPanel('pro');
  await press('plansweep-find');
  await press('plansweep-review');
  expect(allText()).toContain(sweepCopy.noFindings('A-201'));
  expect(allText()).not.toMatch(/\b(passed|compliant)\b/i);
});

test('(8) Add punch item: pinned only where the AI placed it, unassigned, once per finding; the note says approximate', async () => {
  scenario = { search: 'ok', review: 'mixed' };
  await mountPanel('pro');
  await press('plansweep-find');
  await press('plansweep-review');
  expect(screen.getByTestId('plansweep-approx-note')).toBeTruthy();
  expect(allText()).toContain(sweepCopy.approxNote);
  type P = { id: string; description: string; location: string; assignedSub: string; status: string; listType?: string; planSheetId?: string; pinX?: number; pinY?: number };
  type D = { planSheetId: string; x: number; y: number; kind: string; linkedPunchItemId?: string };
  const punches = () => JSON.parse(String(screen.getByTestId('probe-punches').props.children)) as P[];
  const pins = () => JSON.parse(String(screen.getByTestId('probe-pins').props.children)) as D[];
  expect(punches()).toEqual([]);
  const pinsBefore = pins().length;

  // A finding WITH a location → a punch item on that spot, and a linked pin.
  await press('plansweep-punch-sw2#0');
  const placed = punches();
  expect(placed).toHaveLength(1);
  expect(placed[0]).toEqual(expect.objectContaining({ planSheetId: 'sw2', pinX: 0.2, pinY: 0.3, assignedSub: '', status: 'open', listType: 'punch' }));
  expect(placed[0].location).toMatch(/approximate/);
  expect(FORBIDDEN_WORDS.test(placed[0].description)).toBe(false);
  const newPins = pins().slice(pinsBefore);
  expect(newPins).toHaveLength(1);
  expect(newPins[0]).toEqual(expect.objectContaining({ planSheetId: 'sw2', x: 0.2, y: 0.3, kind: 'punch', linkedPunchItemId: placed[0].id }));
  expect(allText()).toContain(sweepCopy.punchAddedPinned.replace(/\s*Open punch list$/, ''));

  // A second tap does nothing: the button is gone, still one item, one pin.
  expect(screen.queryByTestId('plansweep-punch-sw2#0')).toBeNull();
  expect(punches()).toHaveLength(1);

  // A finding WITHOUT a location → a punch item with no pin fields and NO pin.
  await press('plansweep-punch-sw2#1');
  const all = punches();
  expect(all).toHaveLength(2);
  const unplaced = all.find(p => p.id !== placed[0].id)!;
  expect(unplaced.planSheetId).toBeUndefined();
  expect(unplaced.pinX).toBeUndefined();
  expect(unplaced.pinY).toBeUndefined();
  expect(unplaced.location).toBe('A-201');
  expect(pins().slice(pinsBefore)).toHaveLength(1);
  expect(allText()).toContain(sweepCopy.punchAddedNoPin.replace(/\s*Open punch list$/, ''));

  // The RFI action is unchanged beside it, and "Open punch list" goes there.
  expect(screen.getByTestId('plansweep-draft-sw2#0')).toBeTruthy();
  await press('plansweep-open-punch-sw2#0');
  expect(mockPushes).toContainEqual(expect.objectContaining({ pathname: '/punch-list', params: { projectId: PROJECT_ID } }));
});
