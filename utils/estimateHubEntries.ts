// utils/estimateHubEntries.ts — the Estimate hub's entry list.
//
// Pure data: NO react-native / lucide imports, so scripts/validate-estimate-hub.ts
// can import it under Bun. Icons are referenced by `iconKey` (a string) and
// mapped to lucide components inside the hub SCREEN, keeping this module RN-free.

export type HubGroup = 'create' | 'insights';
export type HubTone = 'accent' | 'success' | 'info' | 'neutral';

export interface HubEntry {
  /** Stable unique id (also the testID suffix). */
  id: string;
  label: string;
  subtitle: string;
  /** Expo-router path. Must resolve to a real screen file (validator enforces). */
  route: string;
  group: HubGroup;
  /** Lucide icon name; the screen maps this to a component. */
  iconKey: string;
  tone: HubTone;
}

export const HUB_ENTRIES: HubEntry[] = [
  // ── Create ──────────────────────────────────────────────────────────────
  { id: 'review',  label: 'Review Estimate', subtitle: 'Metrics, markup & scope for your working estimate',   route: '/(tabs)/estimate/review',  group: 'create',   iconKey: 'PieChart',   tone: 'accent' },
  { id: 'quick',   label: 'Quick Estimate', subtitle: 'Fast ballpark from a few questions — no plans needed', route: '/estimate-wizard',        group: 'create',   iconKey: 'Calculator', tone: 'accent' },
  { id: 'takeoff', label: 'AI Takeoff',     subtitle: 'Upload plans, get LF / SF / EA quantities',            route: '/takeoff',                group: 'create',   iconKey: 'Ruler',      tone: 'accent' },
  { id: 'visual',  label: 'Visual Takeoff', subtitle: 'Trace areas & lines on plans or photos to quantify',   route: '/area-takeoff',           group: 'create',   iconKey: 'Grid',       tone: 'accent' },
  { id: 'full',    label: 'Full Estimator', subtitle: 'Line items, materials, labor, markup & PDF',           route: '/(tabs)/estimate/full',   group: 'create',   iconKey: 'Layers',     tone: 'accent' },
  { id: 'costxray', label: 'Cost X-Ray',    subtitle: 'Price the hidden conditions before you bid',          route: '/cost-xray',              group: 'create',   iconKey: 'ScanSearch', tone: 'accent' },
  // ── Insights ────────────────────────────────────────────────────────────
  { id: 'confidence',  label: 'Estimate Risk',   subtitle: 'Score every line against your cost history',       route: '/estimate-confidence',  group: 'insights', iconKey: 'Gauge',      tone: 'info' },
  { id: 'accuracy',    label: 'Bid vs Actual',   subtitle: 'Per-line variance once the job is done',           route: '/estimate-accuracy',    group: 'insights', iconKey: 'TrendingUp', tone: 'success' },
  { id: 'calibration', label: 'Calibration',     subtitle: 'Cross-job bias correction by category',            route: '/estimate-calibration', group: 'insights', iconKey: 'GitCompare', tone: 'neutral' },
  { id: 'living',      label: 'Living Estimate', subtitle: 'Projected margin at completion, live',             route: '/living-estimate',      group: 'insights', iconKey: 'Activity',   tone: 'neutral' },
];

export const HUB_GROUPS: HubGroup[] = ['create', 'insights'];

export function entriesForGroup(group: HubGroup): HubEntry[] {
  return HUB_ENTRIES.filter(e => e.group === group);
}
