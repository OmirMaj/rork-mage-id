/**
 * Code cards, lane CCWIRE — PHONE PROOF for the Plan Set Code Sweep panel
 * (components/plans/PlanSweepPanel.tsx), the multi-sheet plan code check.
 *
 *  1. GOLDEN — recorded FIRST, on the untouched panel of claude/permit-path
 *     (ee7daf9b), before this lane edited it. The panel is mounted inside the
 *     real app tree (plan-sweep.test.tsx's harness: an injected route under
 *     app/_layout, the real providers, only the network edge faked) and its
 *     subtree is recorded as line count + sha256 of w6d-z2-phone's
 *     one-line-per-host-node dump.
 *     Every model line below is a SAMPLE written for this test (each says so);
 *     none of it is code text.
 *
 *     (s1) the panel as it mounts (nothing run);
 *     (s2) after "Find the sheets" (before any review is spent);
 *     (s3) after the review, two findings per sheet, the OLD server shape
 *          (no status, no stage, no lookRight);
 *     (s4) after a review that raised nothing.
 *
 *  2. BEHAVIOUR — the code cards on the sweep (status groups, "looks right"
 *     rows, pins), asserted outright in the second describe block.
 *
 * Set CCWIRE_DUMP_DIR to write each dump for a diff.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';
import { useProjects } from '@/contexts/ProjectContext';
import PlanSweepPanel from '@/components/plans/PlanSweepPanel';
import { FORBIDDEN_WORDS } from '@/utils/plans/planSweep';
import type { PlanSheet } from '@/types';

const IMG = 'data:image/png;base64,AAAA';
const SHEETS: PlanSheet[] = [
  { id: 'cs1', projectId: PROJECT_ID, name: 'A-101', sheetNumber: 'A-101', imageUri: IMG, createdAt: '2026-09-01T00:00:00Z' },
  { id: 'cs2', projectId: PROJECT_ID, name: 'A-201', sheetNumber: 'A-201', imageUri: IMG, createdAt: '2026-09-01T00:00:00Z' },
] as unknown as PlanSheet[];

const SWEEP_FNS = new Set(['project-memory-embed', 'project-memory-search', 'analyze-plan-code']);

// SAMPLE rows (old server shape: no status, no stage).
const SAMPLE_GUARD = {
  category: 'guards', codeRef: 'RCNYS 2025 R312.1.3', citedEdition: 'RCNYS 2025', section: 'R312.1.3',
  requirement: 'Sample: baluster spacing on the deck guard.', observed: 'Sample: drawn 4½ in. apart',
  severity: 'high', confidence: 'med', evidence: 'model_recall',
  question: 'Sample: what is the baluster spacing on the deck guard?', location: { x: 0.2, y: 0.3 },
};
const SAMPLE_STAIR = {
  category: 'stairs', codeRef: 'RCNYS 2025 R311.7.8', citedEdition: 'RCNYS 2025', section: 'R311.7.8',
  requirement: 'Sample: stair handrail height.', observed: 'Sample: no handrail height noted',
  severity: 'med', confidence: 'low', evidence: 'model_recall',
  question: 'Sample: is the stair handrail height shown on this sheet?', location: null,
};
// SAMPLE rows (code-card server shape: status + stage on findings, lookRight rows).
const SAMPLE_OK = {
  category: 'stairs', codeRef: 'RCNYS 2025 R311.7.5', citedEdition: 'RCNYS 2025', section: 'R311.7.5',
  requirement: 'Sample: stair riser height.', observed: 'Sample: risers drawn 7½ in.',
  severity: 'low', confidence: 'med', evidence: 'model_recall', question: null, location: null,
  status: 'ok', stage: 'framing', stageIsGuess: true,
};

type Review = 'old' | 'none' | 'cards';
let review: Review = 'old';
const reviewBodies: Array<Record<string, unknown>> = [];

const spies: jest.SpyInstance[] = [];
function installNetwork() {
  const realInvoke = supabase.functions.invoke;
  const realRpc = supabase.rpc;
  spies.push(jest.spyOn(supabase.functions, 'invoke').mockImplementation((async (fn: string, opts?: { body?: Record<string, unknown> }) => {
    if (!SWEEP_FNS.has(fn)) return realInvoke(fn, opts);
    if (fn === 'project-memory-embed') return { data: { success: true, stale: [] }, error: null };
    if (fn === 'project-memory-search') {
      return {
        data: {
          success: true,
          matches: [
            { doc_id: 'plan-sheet:cs2', source: 'Plan Sheet', ref: 'A-201', content: 'SAMPLE: DECK GUARD DETAIL', similarity: 0.8 },
            { doc_id: 'plan-sheet:cs1', source: 'Plan Sheet', ref: 'A-101', content: 'SAMPLE: STAIR 1 HANDRAIL', similarity: 0.7 },
          ],
        },
        error: null,
      };
    }
    reviewBodies.push(opts?.body ?? {});
    if (review === 'none') return { data: { success: true, data: { findings: [], disclaimer: 'verify' } }, error: null };
    if (review === 'cards') {
      return {
        data: {
          success: true,
          data: {
            findings: [
              { ...SAMPLE_GUARD, status: 'fix', stage: 'final', stageIsGuess: true },
              { ...SAMPLE_STAIR, status: 'ask', stage: null, stageIsGuess: true },
            ],
            lookRight: [SAMPLE_OK],
            disclaimer: 'verify',
          },
        },
        error: null,
      };
    }
    return { data: { success: true, data: { findings: [SAMPLE_GUARD, SAMPLE_STAIR], disclaimer: 'verify' } }, error: null };
  }) as never));
  spies.push(jest.spyOn(supabase, 'rpc').mockImplementation(((fn: string, args?: unknown) => {
    if (fn !== 'ai_usage_get') return realRpc(fn, args);
    return Promise.resolve({ data: 2, error: null });
  }) as never));
}

function Harness() {
  const { getProject, getRFIsForProject } = useProjects();
  const [show, setShow] = useState(false);
  const project = getProject(PROJECT_ID);
  if (!project) return <Text>loading</Text>;
  const rfis = getRFIsForProject(PROJECT_ID).map((r) => r.question);
  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity testID="probe-show" onPress={() => setShow(true)}><Text>show</Text></TouchableOpacity>
      <Text testID="probe-rfis">{JSON.stringify(rfis)}</Text>
      {show ? <PlanSweepPanel project={project} sheets={SHEETS} onUpgrade={() => {}} onClose={() => {}} /> : null}
    </View>
  );
}

async function mountPanel() {
  await AsyncStorage.setItem('mageid_subscription_tier', 'pro');
  const tree = await mountRouteChecked('/code-card-sweep-harness', Harness);
  await settle();
  installNetwork();
  await act(async () => { fireEvent.press(screen.getByTestId('probe-show')); });
  await settle();
  return tree;
}
async function press(id: string) {
  await act(async () => { fireEvent.press(screen.getByTestId(id)); });
  await settle();
}

beforeEach(async () => {
  allowConsoleErrors();
  while (spies.length) spies.pop()!.mockRestore();
  review = 'old';
  reviewBodies.length = 0;
  await primeWorld('populated');
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
// No sanctioned strip here: the panel's own testIDs (plansweep-*) are on that
// list, and this golden is OF the panel.
function fingerprint(name: string, json: unknown): { lines: number; sha256: string } {
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
  expect(out.length).toBeGreaterThan(10);
  return { lines: out.length, sha256 };
}
const panelOf = (tree: { toJSON: () => unknown }) => {
  const panel = findById(tree.toJSON(), 'plansweep-panel');
  expect(panel).toBeTruthy();
  return panel;
};

// ── 1. GOLDEN ──────────────────────────────────────────────────────────────
describe('CCWIRE sweep golden — recorded on the untouched panel', () => {
  jest.setTimeout(150000);

  it('(s1) the panel as it mounts', async () => {
    const tree = await mountPanel();
    expect(fingerprint('s1-sweep-idle', panelOf(tree))).toMatchSnapshot();
  });

  it('(s2) after Find the sheets, before any review', async () => {
    const tree = await mountPanel();
    await press('plansweep-find');
    expect(screen.getByTestId('plansweep-chosen-cs2')).toBeTruthy();
    expect(fingerprint('s2-sweep-found', panelOf(tree))).toMatchSnapshot();
  });

  it('(s3) after the review, two findings per sheet (old server shape)', async () => {
    const tree = await mountPanel();
    await press('plansweep-find');
    await press('plansweep-review');
    expect(screen.getByTestId('plansweep-finding-cs2#0')).toBeTruthy();
    expect(fingerprint('s3-sweep-reviewed', panelOf(tree))).toMatchSnapshot();
  });

  it('(s4) after a review that raised nothing', async () => {
    review = 'none';
    const tree = await mountPanel();
    await press('plansweep-find');
    await press('plansweep-review');
    expect(screen.getByTestId('plansweep-none-cs2')).toBeTruthy();
    expect(fingerprint('s4-sweep-none', panelOf(tree))).toMatchSnapshot();
  });
});

// ── 2. BEHAVIOUR — the code cards on the sweep ─────────────────────────────
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
async function pinsStored(): Promise<Record<string, Array<{ stage: string; item: { id: string; summary: string; status?: string } }>>> {
  return JSON.parse((await AsyncStorage.getItem('mageid_code_pins_v1')) ?? '{}');
}

describe('CCWIRE sweep behaviour — status groups, look-right rows, pins', () => {
  jest.setTimeout(150000);

  it('old server shape: every finding is a card that needs an answer; the per-sheet findings stay', async () => {
    await mountPanel();
    // Nothing reviewed yet: no card list.
    expect(screen.queryByTestId('plansweep-card-list')).toBeNull();
    await press('plansweep-find');
    expect(screen.queryByTestId('plansweep-card-list')).toBeNull();
    await press('plansweep-review');
    expect(screen.getByTestId('plansweep-card-list')).toBeTruthy();
    const text = allText();
    // Two sheets × two findings, none marked fix by the server: all "needs an answer".
    expect(text).toContain('Result · 4 to look at');
    expect(text).toContain('Nothing to fix on the drawing.');
    expect(text).toContain('4 need an answer first.');
    expect(text).not.toMatch(/look right on the drawing/);
    // The per-sheet findings, with their RFI and punch actions, are still there.
    expect(screen.getByTestId('plansweep-finding-cs2#0')).toBeTruthy();
    expect(screen.getByTestId('plansweep-draft-cs2#0')).toBeTruthy();
    expect(screen.getByTestId('plansweep-punch-cs2#1')).toBeTruthy();
    expect(FORBIDDEN_WORDS.test(text)).toBe(false);
  });

  it('code-card server shape: Fix / Needs an answer / Look right; a look-right row never gets an RFI or a punch', async () => {
    review = 'cards';
    await mountPanel();
    await press('plansweep-find');
    await press('plansweep-review');
    const text = allText();
    // Two sheets, each: 1 fix, 1 ask, 1 look-right.
    expect(text).toContain('2 things to fix before you submit.');
    expect(text).toContain('2 need an answer first. 2 look right on the drawing.');
    expect(text).toContain('Sample: stair riser height.');
    expect(text).toContain('Sample: risers drawn 7½ in.');
    expect(text).toContain('Send 2 fixes + 2 questions to architect');
    // Look-right rows are cards only: the per-sheet list has the two findings and no third row.
    expect(screen.getByTestId('plansweep-finding-cs2#1')).toBeTruthy();
    expect(screen.queryByTestId('plansweep-finding-cs2#2')).toBeNull();
    expect(screen.queryByTestId('plansweep-draft-cs2#2')).toBeNull();
    expect(screen.queryByTestId('plansweep-punch-cs2#2')).toBeNull();
    expect(text).not.toMatch(/\b(passed|compliant|approved)\b/i);
    expect(FORBIDDEN_WORDS.test(text)).toBe(false);
    // No RFI was drafted by rendering anything.
    expect(JSON.parse(String(screen.getByTestId('probe-rfis').props.children))).toEqual(
      JSON.parse(String(screen.getByTestId('probe-rfis').props.children)).filter((q: string) => !/riser/.test(q)),
    );
  });

  it('Add all pins every card to the project, each on its own stage, and the button says so', async () => {
    review = 'cards';
    await mountPanel();
    await press('plansweep-find');
    await press('plansweep-review');
    expect(await pinsStored()).toEqual({});
    await press('plansweep-card-list-bulk-checklists');
    const pins = (await pinsStored())[PROJECT_ID] ?? [];
    expect(pins).toHaveLength(6);
    // The fix rows carry the server's stage guess; a row with no stage has none.
    expect(pins.filter((p) => p.item.status === 'fix').every((p) => p.stage === 'final')).toBe(true);
    expect(pins.filter((p) => p.item.status === 'ask').every((p) => p.stage === 'other')).toBe(true);
    expect(pins.filter((p) => p.item.status === 'ok').every((p) => p.stage === 'framing')).toBe(true);
    expect(pins.every((p) => /^sweep-[0-9a-z]+$/.test(p.item.id))).toBe(true);
    expect(allText()).toContain('On the inspection checklists');
  });
});
