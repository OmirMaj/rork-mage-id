// ============================================================================
// utils/paletteRows.ts — the pure half of the desktop Cmd+K command palette
// (wave 6d restore, lane K2).
//
// components/search/CommandPalette.tsx draws what this file decides: which
// lanes show, in what order, with which labels, and where the highlighted row
// moves on an arrow key. Everything that can be WRONG about the palette lives
// here so scripts/validate-feature-search.ts (the "d6r K2 — palette" section)
// can prove it under bun. Value imports are pure modules only
// (utils/featureRegistry); every React / React Native module is a type-only
// import, which bun erases.
//
// WHY A PALETTE AND NOT THE OLD SHEET. On a 1512 px laptop Cmd+K covered the
// whole window with a phone sheet, Enter opened only the top feature, and it
// knew nothing about jobs or creating things. A GC who types 'rfi' while he is
// in Henderson wants "New RFI · Henderson" first, and Enter to open the form.
// ============================================================================

import { searchFeatures, type FeatureEntry, type FeatureHit, type FeatureId } from '@/utils/featureRegistry';
import type { SubscriptionTier } from '@/types';

// ── Types ────────────────────────────────────────────────────────────────────

export type PaletteLane =
  | 'job-actions' | 'recent-jobs' | 'brain'
  | 'projects' | 'actions' | 'ask' | 'features' | 'records' | 'recent-searches';

export type BrainAction = 'ask' | 'voice' | 'help' | 'shortcuts';

/** The CreateMenu option fields the palette reads (CreateMenu's CreateOption
 *  satisfies it structurally). */
export interface PaletteCreateOption {
  label: string;
  subtitle: string;
  href: string;
  keywords?: readonly string[];
  scoped?: boolean;
}

export interface PaletteJob { id: string; name: string }

/** A feature row: a search hit, or a POPULAR entry dressed as one. */
export interface PaletteFeatureHit { entry: FeatureEntry; locked: boolean; requiredTier: string }

/** A record (entity search result) row — its ref and its label. */
export interface PaletteRecord { ref: { kind: string; id: string }; label?: string }

/** What running a row does. CommandPalette switches on `kind`. */
export type PaletteRef<O, H, R> =
  | { kind: 'project'; id: string }
  /** Create `option` for `projectId` (null: the option is not job-scoped). */
  | { kind: 'create'; option: O; projectId: string | null }
  /** A job-scoped option with no job to scope it to: start a project first. */
  | { kind: 'needs-project'; option: O }
  | { kind: 'ask'; seed: string }
  | { kind: 'feature'; hit: H }
  | { kind: 'record'; result: R }
  | { kind: 'brain'; action: BrainAction }
  | { kind: 'recent-search'; query: string };

export interface PaletteRow<O = PaletteCreateOption, H = PaletteFeatureHit, R = PaletteRecord> {
  key: string;
  lane: PaletteLane;
  label: string;
  sublabel?: string;
  ref: PaletteRef<O, H, R>;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Most rows in the Projects and the Actions lanes. */
export const PALETTE_LANE_MAX = 5;
/** MRU jobs a job-scoped action fans out to when no job is active. */
export const PALETTE_MRU_FANOUT = 3;
/** The Ask row appears once the trimmed query is at least this long. */
export const PALETTE_ASK_MIN_CHARS = 3;

/** The empty-query 'Actions for {job}' lane, in this order. Each names a
 *  CreateMenu option by its label (validate-feature-search proves each one
 *  exists in CreateMenu's OPTIONS and is job-scoped). */
export const JOB_QUICK_ACTION_LABELS: readonly string[] = ['Daily Report', 'RFI', 'Change Order', 'Invoice', 'Punch Item'];

/** The five project logs that open their create form over the log on desktop
 *  web when pushed with `new=1` (contract D6; CreateMenu's LIST_FIRST_HREFS —
 *  the validator parses that literal and proves the two sets equal). */
export const LOG_CREATE_HREFS: ReadonlySet<string> = new Set(['/rfi', '/submittal', '/change-order', '/invoice', '/daily-report']);

/** HONEST ACTION LABELS (K2.12, contract D6). A palette Actions row reads
 *  'New <label>' ONLY when its destination really opens a create form on
 *  arrival: the five logs above (desktop web + a known job + new=1), the home
 *  create modal (?openCreate=1), the two wizards, Quick Quote and the progress
 *  bill. Every other row — Lead (the leads board), Selection, Permit, Sub COI…
 *  — keeps CreateMenu's label and subtitle verbatim, because 'New Lead' would
 *  promise a form and deliver a list. */
export const FORM_ON_ARRIVAL_HREFS: ReadonlySet<string> = new Set([
  ...LOG_CREATE_HREFS,
  '/?openCreate=1', '/estimate-wizard', '/schedule-wizard?scratch=1', '/quick-quote', '/bill-from-estimate',
]);

/** A property manager's feature set: the `feature:` keys of DesktopSidebar's
 *  PM_NAV_ITEMS (validate-feature-search parses the sidebar and proves this
 *  set equal to them). A PM is not a homeowner: he must never be offered the
 *  homeowner's RFP flow (my-rfps, post-rfp). */
export const PM_FEATURE_IDS: ReadonlySet<FeatureId> = new Set<FeatureId>(['projects', 'contacts', 'notifications', 'settings']);
/** The same set, keyed by plain string for FeatureEntry.id lookups (no cast). */
const PM_FEATURE_ID_LOOKUP: ReadonlySet<string> = new Set<string>(PM_FEATURE_IDS);

/** searchFeatures' default result count (utils/featureRegistry). */
const FEATURE_RESULTS = 8;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** CreateMenu's filter rule: the trimmed, lower-cased query is a substring of
 *  the label, the subtitle or any keyword. An empty query keeps everything.
 *  (validate-feature-search evaluates CreateMenu's own filter body from its
 *  source and proves the two agree.) */
export function filterCreateOptions<O extends PaletteCreateOption>(options: readonly O[], query: string): O[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter(o => {
    if (o.label.toLowerCase().includes(q)) return true;
    if (o.subtitle.toLowerCase().includes(q)) return true;
    if (o.keywords?.some(k => k.toLowerCase().includes(q))) return true;
    return false;
  });
}

/** The label an Actions row shows (K2.12). `jobKnown` is true when the row is
 *  scoped to a real job (an active job, or one of the MRU fan-out rows). */
export function paletteActionLabel(opt: PaletteCreateOption, jobKnown: boolean): string {
  if (!FORM_ON_ARRIVAL_HREFS.has(opt.href)) return opt.label;
  if (opt.scoped && !jobKnown) return opt.label;
  return `New ${opt.label}`;
}

export type PaletteRole = string | null | undefined;

/** Feature search for a role (K2.1b).
 *   - contractor roles: searchFeatures(query, tier, { persona: 'contractor' }) — today's call;
 *   - 'client': persona 'client' — today's call;
 *   - 'property_manager': the contractor search, filtered to entries shared with
 *     everyone (persona 'all') or on the PM's own sidebar (PM_FEATURE_IDS),
 *     capped at the default result count. Never a homeowner RFP entry. */
export function featureHitsForRole(query: string, tier: SubscriptionTier, role: PaletteRole): FeatureHit[] {
  if (role === 'client') return searchFeatures(query, tier, { persona: 'client' });
  if (role === 'property_manager') {
    return searchFeatures(query, tier, { persona: 'contractor', maxResults: 50 })
      .filter(h => h.entry.persona === 'all' || PM_FEATURE_ID_LOOKUP.has(h.entry.id))
      .slice(0, FEATURE_RESULTS);
  }
  return searchFeatures(query, tier, { persona: 'contractor' });
}

/** The empty-query Go to lane's ids for a role: a PM gets his own set (in
 *  PM_NAV_ITEMS order), a client and a contractor today's POPULAR lists. */
export function popularIdsForRole(
  role: PaletteRole,
  popular: readonly string[],
  popularClient: readonly string[],
): readonly string[] {
  if (role === 'property_manager') return [...PM_FEATURE_IDS];
  if (role === 'client') return popularClient;
  return popular;
}

/** Arrow-key movement over n rows. Wraps both ways, like JobSwitcher. */
export function movePaletteSelection(i: number, delta: number, n: number): number {
  if (n <= 0) return 0;
  return (((i + delta) % n) + n) % n;
}

/** A lane's heading. */
export function paletteLaneLabel(lane: PaletteLane, jobName?: string | null): string {
  switch (lane) {
    case 'job-actions': return jobName ? `Actions for ${jobName}` : 'Actions';
    case 'recent-jobs': return 'Recent jobs';
    case 'brain': return 'MAGE Brain';
    case 'projects': return 'Projects';
    case 'actions': return 'Actions';
    case 'ask': return 'Ask';
    case 'features': return 'Go to';
    case 'records': return 'Records';
    case 'recent-searches': return 'Recent searches';
  }
}

export const BRAIN_ROWS: readonly { action: BrainAction; label: string; sublabel?: string }[] = [
  { action: 'ask', label: 'Ask MAGE anything', sublabel: 'Opens beside the page' },
  { action: 'voice', label: 'Voice capture', sublabel: 'Speak a log, a punch item, an update' },
  { action: 'help', label: 'Help & tips' },
  { action: 'shortcuts', label: 'Keyboard shortcuts' },
];

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface BuildPaletteInput<O extends PaletteCreateOption, H extends PaletteFeatureHit, R extends PaletteRecord> {
  query: string;
  /** Client or property manager: no Projects / Actions lanes, no job lanes. */
  minimal: boolean;
  /** The active job, or null. */
  activeJob: PaletteJob | null;
  /** Eligible jobs, most recently used first (jobSwitcherList with an empty
   *  query). Empty means there is no job to scope a create to. */
  recentJobs: readonly PaletteJob[];
  /** jobSwitcherList(projects, recentProjectIds, query). */
  projectHits: readonly PaletteJob[];
  /** Every CreateMenu option (the palette filters them by the query here). */
  createOptions: readonly O[];
  /** Query: the role's feature hits. Empty query: the POPULAR entries. */
  featureHits: readonly H[];
  /** Entity search results, already in display order (debounced upstream). */
  records: readonly R[];
  recentSearches: readonly string[];
}

/** Every palette row, in lane order.
 *  Query:  Projects (≤5) · Actions (≤5) · Ask (≥3 chars) · Go to · Records (last).
 *  Empty:  Actions for {job} (active job only) · Recent jobs (≤5) · MAGE Brain · Go to · Recent searches.
 *  Records come last so their late, debounced arrival never moves the
 *  highlighted row. */
export function buildPaletteRows<O extends PaletteCreateOption, H extends PaletteFeatureHit, R extends PaletteRecord>(
  input: BuildPaletteInput<O, H, R>,
): PaletteRow<O, H, R>[] {
  const { query, minimal, activeJob, recentJobs, projectHits, createOptions, featureHits, records, recentSearches } = input;
  const q = query.trim();
  const rows: PaletteRow<O, H, R>[] = [];

  if (q.length === 0) {
    if (!minimal && activeJob) {
      for (const label of JOB_QUICK_ACTION_LABELS) {
        const option = createOptions.find(o => o.label === label);
        if (!option) continue;
        rows.push({
          key: `job-action:${label}`,
          lane: 'job-actions',
          label: paletteActionLabel(option, true),
          sublabel: option.subtitle,
          ref: { kind: 'create', option, projectId: activeJob.id },
        });
      }
    }
    if (!minimal) {
      for (const job of recentJobs.slice(0, PALETTE_LANE_MAX)) {
        rows.push({ key: `recent-job:${job.id}`, lane: 'recent-jobs', label: job.name, ref: { kind: 'project', id: job.id } });
      }
    }
    for (const b of BRAIN_ROWS) {
      rows.push({ key: `brain:${b.action}`, lane: 'brain', label: b.label, sublabel: b.sublabel, ref: { kind: 'brain', action: b.action } });
    }
    for (const hit of featureHits) {
      rows.push({ key: `feature:${hit.entry.id}`, lane: 'features', label: hit.entry.title, ref: { kind: 'feature', hit } });
    }
    for (const s of recentSearches) {
      rows.push({ key: `recent-search:${s}`, lane: 'recent-searches', label: s, ref: { kind: 'recent-search', query: s } });
    }
    return rows;
  }

  if (!minimal) {
    for (const job of projectHits.slice(0, PALETTE_LANE_MAX)) {
      rows.push({ key: `project:${job.id}`, lane: 'projects', label: job.name, ref: { kind: 'project', id: job.id } });
    }

    const actions: PaletteRow<O, H, R>[] = [];
    for (const option of filterCreateOptions(createOptions, q)) {
      if (actions.length >= PALETTE_LANE_MAX) break;
      if (!option.scoped) {
        actions.push({
          key: `action:${option.label}`,
          lane: 'actions',
          label: paletteActionLabel(option, false),
          sublabel: option.subtitle,
          ref: { kind: 'create', option, projectId: null },
        });
      } else if (activeJob) {
        actions.push({
          key: `action:${option.label}:${activeJob.id}`,
          lane: 'actions',
          label: paletteActionLabel(option, true),
          sublabel: activeJob.name,
          ref: { kind: 'create', option, projectId: activeJob.id },
        });
      } else if (recentJobs.length > 0) {
        for (const job of recentJobs.slice(0, PALETTE_MRU_FANOUT)) {
          if (actions.length >= PALETTE_LANE_MAX) break;
          actions.push({
            key: `action:${option.label}:${job.id}`,
            lane: 'actions',
            label: paletteActionLabel(option, true),
            sublabel: job.name,
            ref: { kind: 'create', option, projectId: job.id },
          });
        }
      } else {
        actions.push({
          key: `action:${option.label}:no-job`,
          lane: 'actions',
          label: paletteActionLabel(option, false),
          sublabel: 'Create a project first',
          ref: { kind: 'needs-project', option },
        });
      }
    }
    rows.push(...actions);
  }

  if (q.length >= PALETTE_ASK_MIN_CHARS) {
    rows.push({ key: 'ask', lane: 'ask', label: `Ask MAGE: “${q}”`, ref: { kind: 'ask', seed: q } });
  }

  for (const hit of featureHits) {
    rows.push({ key: `feature:${hit.entry.id}`, lane: 'features', label: hit.entry.title, ref: { kind: 'feature', hit } });
  }

  // A job already listed in Projects is not listed again as a record.
  const listedJobs = new Set(minimal ? [] : projectHits.slice(0, PALETTE_LANE_MAX).map(j => j.id));
  for (const result of records) {
    if (result.ref.kind === 'project' && listedJobs.has(result.ref.id)) continue;
    rows.push({ key: `record:${result.ref.kind}:${result.ref.id}`, lane: 'records', label: result.label ?? '', ref: { kind: 'record', result } });
  }
  return rows;
}

/** Dress POPULAR entries as feature hits (the empty-query Go to lane). */
export function popularHits(
  entries: readonly FeatureEntry[],
  locked: (e: FeatureEntry) => boolean,
  requiredTier: (e: FeatureEntry) => PaletteFeatureHit['requiredTier'],
): PaletteFeatureHit[] {
  return entries.map(entry => ({ entry, locked: locked(entry), requiredTier: requiredTier(entry) }));
}
