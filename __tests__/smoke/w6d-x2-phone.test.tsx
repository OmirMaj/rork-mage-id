/**
 * Wave 6d restore (d6r), lane X2 — PHONE PROOF for the shared sheets (batch B)
 * and the simple remainder screens (batch E).
 *
 * Lane X2 frames every hand-rolled bottom sheet / dialog in its files through
 * useSheetFrame (components/ui/Sheet.tsx): on a desktop browser each becomes a
 * centred card in the content column with the scrim over the sidebar; the
 * scope-only files gain useSheetDialogScope; JobSwitcher and ToolbarActions
 * swap their private dialog-scope constants for useSheetDialogScope. On the
 * iPhone none of that may change a pixel: every frame part is null on a phone,
 * SheetOverlay is a Fragment and SheetScrim returns null there, animationType
 * is the caller's own literal, showHandle is true, and useHotkeys registers
 * nothing off desktop web. This file is the proof.
 *
 * GOLDEN — recorded FIRST, on a pristine archive of the untouched base
 * (6a77feee), before a line of this lane was written, and never regenerated
 * (run with --ci).
 *
 *  • batch B: each component alone at iOS 390, open, light and dark. "Alone"
 *    = injected as a synthetic route inside the real app (so every provider
 *    it reads exists), and ONLY the probe's own subtree is fingerprinted — the
 *    app chrome around it is not part of this golden.
 *  • batch E: each route at iOS 390 with the every-route populated param bag.
 *    The whole tree is fingerprinted, and separately every Modal subtree that
 *    carries one of this lane's sheets (identified by the sheet's own title
 *    text), so a delta in the chrome can be told apart from a delta in a sheet.
 *
 * What a snapshot records (the w6c-field-phone harness): every style FLATTENED,
 * handler props dropped, undefined props dropped, and every <Modal> rendered
 * with its visible / transparent / animationType / presentationStyle recorded
 * on a host View — so a Modal whose animationType becomes `fX.animationType`
 * (the caller's own literal on a phone) must still record exactly what it did.
 * Set X2_DUMP_DIR to write the dumps.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID, PORTAL_TOKEN } from '@/__tests__/fixtures/world';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';
import { setColorTheme } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import type { CostBookEntry } from '@/utils/costDatabase';

// ── The layout gate: a width + a web flag, exactly like the app's hook ──────
let mockWidth = 390;
let mockHeight = 844;
let mockWeb = false;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024 || (mockWeb && mockWidth >= 900);
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

// Every Modal renders its content, open or closed, and records its props.
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
        testID: 'x2-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
function env(os: 'ios' | 'android', width: number, height: number) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  mockWidth = width;
  mockHeight = height;
  mockWeb = false;
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

// Two clocks, both pinned (see w6c-field-phone for why the outer realm's
// Date.now — the one renderRouter's fake timers start from — is pinned too).
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-26T16:00:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
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

// ── What a snapshot records (one line per host node; line count + sha256) ──
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
type JsonNode = { type: string; props: Record<string, unknown>; children: unknown };
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${volatile(String(node))}"`); return; }
  const el = node as JsonNode;
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
  const dir = process.env.X2_DUMP_DIR;
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

/** Every node (depth first) matching `pred`, not descending into a match. */
function findAll(node: unknown, pred: (n: JsonNode) => boolean, out: JsonNode[] = []): JsonNode[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) findAll(n, pred, out); return out; }
  const el = node as JsonNode;
  if (pred(el)) { out.push(el); return out; }
  findAll(el.children, pred, out);
  return out;
}
function texts(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const n of node) texts(n, out); return out; }
  if (typeof node === 'object') texts((node as JsonNode).children, out);
  return out;
}
const isModal = (n: JsonNode) => n.props?.testID === 'x2-modal';
function countModals(json: unknown): number {
  let c = 0;
  const walk = (n: unknown) => {
    if (n == null || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const el = n as JsonNode;
    if (isModal(el)) c++;
    walk(el.children);
  };
  walk(json);
  return c;
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

type Scheme = 'light' | 'dark';
async function prime(scheme: Scheme) {
  env('ios', 390, 844);
  await primeWorld('populated');
  await AsyncStorage.setItem('mageid_theme', scheme);
  // The static Colors mirror is module state the provider updates in an
  // effect, after a component's first styles are built — so without this a
  // light case would inherit the previous dark case's static colours.
  setColorTheme(scheme);
}

// ── Batch B probes (each component alone, open) ────────────────────────────
const noop = () => {};
const TASKS: ScheduleTask[] = [
  { id: 'x2-t1', title: 'Frame walls', phase: 'Framing', durationDays: 5, startDay: 1, progress: 40, crew: 'Framing crew', dependencies: [], notes: '', status: 'in_progress' },
  { id: 'x2-t2', title: 'Hang drywall', phase: 'Finishes', durationDays: 4, startDay: 6, progress: 0, crew: 'Drywall sub', dependencies: ['x2-t1'], notes: '', status: 'not_started' },
] as ScheduleTask[];
const ENTRY = {
  key: 'drywall|sf', trade: 'Drywall', unit: 'SF', sampleCount: 3, jobCount: 3, seededSampleCount: 0,
  provenance: 'earned', earnedBasis: 'paid', personalRate: 2.1, suggestedRate: 2.2, variability: 0.12,
  spreadMeaningful: true, confidence: 'high', samples: [],
} as unknown as CostBookEntry;

/* eslint-disable @typescript-eslint/no-require-imports, react/display-name */
function probeFor(name: string): () => React.ReactElement {
  switch (name) {
    case 'CSIDivisionPicker': {
      const { CSIDivisionPicker } = require('@/components/CSIDivisionPicker');
      return () => <CSIDivisionPicker value="09" onChange={noop} suggestFromText="pour concrete footings" />;
    }
    case 'DemoSeedPickerModal': {
      const { DemoSeedPickerModal } = require('@/components/DemoSeedPickerModal');
      return () => <DemoSeedPickerModal visible onClose={noop} onPick={noop} showMedium />;
    }
    case 'FeatureExplainerSheet': {
      const { FeatureExplainerSheet } = require('@/components/FeatureExplainerSheet');
      return () => (
        <FeatureExplainerSheet
          visible
          onClose={noop}
          term="Lien Waiver"
          definition="A signed release of lien rights for the amount paid."
          whenToUse={['Before releasing a progress payment', 'At closeout']}
          videoUrl="https://mageid.app/v/lien"
          tourStepKey="lien.intro"
          onOpenTour={noop}
        />
      );
    }
    case 'HelpFab': {
      const { HelpFab } = require('@/components/HelpFab');
      return () => <HelpFab onOpenTutorials={noop} />;
    }
    case 'RateProvenanceChip': {
      const { RateProvenanceChip } = require('@/components/estimate/RateProvenanceChip');
      return () => <RateProvenanceChip entry={ENTRY} />;
    }
    case 'ToolsSheet': {
      const { ToolsSheet } = require('@/components/summary/ToolsSheet');
      return () => <ToolsSheet visible onClose={noop} onNavigate={noop} />;
    }
    case 'QuickUpdateClarifier': {
      const QuickUpdateClarifier = require('@/components/QuickUpdateClarifier').default;
      return () => (
        <QuickUpdateClarifier
          visible
          tasks={TASKS}
          projectName="Henderson Kitchen"
          candidateTaskIds={['x2-t2']}
          initialAction="update_progress"
          initialValue={50}
          initialQuery="drywall"
          onClose={noop}
          onSubmit={noop}
        />
      );
    }
    case 'VoiceCommandModal': {
      const VoiceCommandModal = require('@/components/VoiceCommandModal').default;
      return () => (
        <VoiceCommandModal
          visible
          onClose={noop}
          tasks={TASKS}
          projectName="Henderson Kitchen"
          projectId={PROJECT_ID}
          updateFunctions={{ handleProgressUpdate: noop }}
          activeTodayTask={null}
        />
      );
    }
    case 'PunchPhotoViewer': {
      const PunchPhotoViewer = require('@/components/punch/PunchPhotoViewer').default;
      return () => <PunchPhotoViewer visible uri="https://example.com/punch.jpg" markup={[]} caption="Drywall seam, unit 4B" onClose={noop} />;
    }
    case 'ToolbarActions': {
      const { ToolbarActions } = require('@/components/desktop/ToolbarActions');
      return () => (
        <ToolbarActions
          testID="x2-toolbar"
          breadcrumbs={[{ label: 'Reports' }, { label: 'WIP' }]}
          actions={[
            { key: 'print', label: 'Print', onPress: noop },
            { key: 'csv', label: 'Export CSV', onPress: noop },
            { key: 'share', label: 'Share', onPress: noop, disabled: true, disabledReason: 'Nothing to share yet' },
            { key: 'refresh', label: 'Refresh', onPress: noop },
            { key: 'delete', label: 'Delete', onPress: noop, destructive: true },
          ]}
        />
      );
    }
    case 'JobSwitcher': {
      const { JobSwitcher } = require('@/components/desktop/JobSwitcher');
      return () => <JobSwitcher />;
    }
    default:
      throw new Error(`no probe for ${name}`);
  }
}
/* eslint-enable @typescript-eslint/no-require-imports, react/display-name */

const BATCH_B = [
  'CSIDivisionPicker', 'DemoSeedPickerModal', 'FeatureExplainerSheet', 'HelpFab', 'RateProvenanceChip',
  'ToolsSheet', 'QuickUpdateClarifier', 'VoiceCommandModal', 'PunchPhotoViewer', 'ToolbarActions', 'JobSwitcher',
];

// ── Batch E routes (the every-route populated param bag) ───────────────────
const BAG = new URLSearchParams({ projectId: PROJECT_ID, id: PROJECT_ID, estimateId: ESTIMATE_ID, t: PORTAL_TOKEN }).toString();
/** The fixture world has no equipment, so /equipment-detail with the bag alone
 *  renders "Equipment not found" and never mounts its Log Usage Modal. The
 *  host case seeds one machine (the local cache the equipment query falls
 *  back to when the server has none) and opens it by id. */
const EQUIP_ID = 'x2-equip-1';
async function seedEquipment() {
  await AsyncStorage.setItem('mageid_equipment', JSON.stringify([{
    id: EQUIP_ID, name: 'CAT 305 mini excavator', type: 'owned', category: 'excavation', make: 'CAT', model: '305',
    dailyRate: 450, currentProjectId: PROJECT_ID, maintenanceSchedule: [], utilizationLog: [], status: 'in_use',
    createdAt: '2026-06-01T12:00:00.000Z',
  }]));
}
/** Each route, the title text of every sheet this lane frames there, and an
 *  optional seed + extra query for a host whose Modal mounts conditionally. */
const BATCH_E: [string, string, string[], (() => Promise<void>)?, string?][] = [
  ['discover/bids', '/discover/bids', ['Sort by', 'Set-aside type']],
  ['materials/lumber', '/materials/lumber', ['Set Price Alert']],
  ['equipment-detail', '/equipment-detail', ['Log Usage']],
  ['equipment-detail (seeded machine)', '/equipment-detail', ['Log Usage'], seedEquipment, `equipmentId=${EQUIP_ID}`],
  ['get-verified', '/get-verified', ['Issuing state']],
  ['qbo-review', '/qbo-review', ['File this cost to…']],
  ['lead-detail', '/lead-detail', ['Why did this one go cold?']],
  ['company-profile', '/company-profile', ['Which state licenses you?', 'Draw Your Signature']],
  ['building-access', '/building-access', ['Book a slot']],
  ['plan-intelligence', '/plan-intelligence', ['Save room']],
];

describe('lane X2 — the phone is unchanged (golden)', () => {
  jest.setTimeout(240000);

  describe('batch B — each sheet alone, iOS 390, open', () => {
    for (const name of BATCH_B) {
      for (const scheme of ['light', 'dark'] as Scheme[]) {
        it(`${name}, ${scheme}`, async () => {
          await prime(scheme);
          const Probe = probeFor(name);
          const tree = await mountRouteChecked('/x2-probe', () => <View testID="x2-probe"><Probe /></View>);
          await pump();
          const [probe] = findAll(tree.toJSON(), (n) => n.props?.testID === 'x2-probe');
          expect(probe).toBeTruthy();
          const fp = fingerprint(`B ${name} ${scheme}`, probe);
          expect({ ...fp, modalCount: countModals(probe) }).toMatchSnapshot();
        });
      }
    }
  });

  describe('batch E — each route, iOS 390, populated bag', () => {
    for (const [name, route, titles, seed, extra] of BATCH_E) {
      it(name, async () => {
        await prime('light');
        await seed?.();
        const tree = await mountRouteChecked(`${route}?${BAG}${extra ? `&${extra}` : ''}`);
        await pump();
        const json = tree.toJSON();
        const whole = fingerprint(`E ${name}`, json);
        // Every Modal holding one of this lane's sheets, by its title text.
        const modals = findAll(json, isModal);
        const sheets = titles.map((title) => {
          const hit = modals.find((m) => texts(m).some((s) => s.includes(title)));
          return { title, found: !!hit, ...(hit ? fingerprint(`E ${name} sheet ${title}`, hit) : {}) };
        });
        expect({ whole, modalCount: countModals(json), sheets }).toMatchSnapshot();
      });
    }
  });
});
