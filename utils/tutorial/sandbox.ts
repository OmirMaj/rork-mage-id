// utils/tutorial/sandbox.ts — make sure the tutorial's sample job exists and
// carries what the tutorial needs, BEFORE step 1. The effectful half of
// utils/tutorial/sandboxCore.ts.
//
// SAMPLES ARE REAL SYNCED ROWS, AND THAT IS THE POINT. The tutorial's DFR
// draft, punch item and invoice #3 are written through the real save paths
// onto "Sample — Sarah's Place" and are deleted with it. Nothing here fakes a
// row in memory, and nothing here ever writes to a REAL job:
//   • the sandbox is picked by sandboxCore.pickSandboxProject — the newest
//     project HE owns named exactly the sample name (byte-exact 'Sample — '
//     prefix, U+2014). A project renamed out of the prefix, another
//     contractor's job, or the GC's job a field seat was invited to never
//     qualifies; for those a fresh sample is seeded in his own account;
//   • every top-up below is idempotent and only ever ADDS what is missing.
//
// TOP-UPS (per the def's `needs`):
//   estimateLines  The small seed now carries 8 LinkedEstimateItems for the
//                  same $422,400 (utils/demoSeed). An OLDER sample has none —
//                  its progress invoice would bill $0 — so it is patched on
//                  through updateProject. Only linked_estimate changes, which
//                  is a JSON column with no CHECK on it: nothing that touches
//                  project_financials' CHECK ranges (a CHECK refusal is
//                  terminal in the offline queue, and would strand the edit).
//   plan           The bundled A-101 sheet (assets/tutorial) goes through the
//                  REAL utils/addFloorPlan once the sample row has synced, so
//                  it is a durable sheet with a storagePath exactly like his
//                  own plans; reused on replay. 8 s budget in total. Offline,
//                  unsynced or failed → samplePlan:false, and the machine
//                  auto-skips the pin steps (skipIf 'noSamplePlan') while the
//                  camera step says the plan didn't load.
//   schedule       Wave A2 (the Residential Build example) — not built here.
// No sample subs are seeded: the punch tutorial never assigns one, so no sub
// is notified and his real sub directory is never polluted.

import { Platform } from 'react-native';
import type { PlanSheet, Project } from '@/types';
import type { WriteOutcome } from '@/utils/offlineQueue';
import { seedDemoProject } from '@/utils/demoSeed';
import { generateUUID } from '@/utils/generateId';
import { addFloorPlan, type FloorPlanActions, type FloorPlanImage } from '@/utils/addFloorPlan';
import { pickSandboxProject } from './sandboxCore';
import { SAMPLE_PLAN, SAMPLE_RETAINAGE, sampleLinkedEstimate } from './fixtures';
import { isRecordedRetainageRate } from '@/utils/retainageSource';
import { SANDBOX_PROJECT_NAME } from './defs';
import type { BootFlags, SandboxNeed } from './types';

// Static requires: Metro bundles these into the JS update, so they ship OTA.
const SAMPLE_PLAN_MODULE: number = require('../../assets/tutorial/sample-plan-a101.png');
const SAMPLE_PHOTO_MODULE: number = require('../../assets/tutorial/sample-outlet.jpg');

/** The plan budget from the spec: past it the pin steps are skipped, not waited on. */
export const SAMPLE_PLAN_BUDGET_MS = 8_000;

/** The ProjectContext actions a sandbox needs. addProject resolves with how
 *  the job's create write ended, which the plan upload waits on. */
export interface SandboxActions extends FloorPlanActions {
  addProject: (p: Project) => Promise<WriteOutcome> | unknown;
  addInvoice: Parameters<typeof seedDemoProject>[0]['addInvoice'];
  addDailyReport: Parameters<typeof seedDemoProject>[0]['addDailyReport'];
  addPunchItem: Parameters<typeof seedDemoProject>[0]['addPunchItem'];
  addProjectPhoto: Parameters<typeof seedDemoProject>[0]['addProjectPhoto'];
  addRFI: Parameters<typeof seedDemoProject>[0]['addRFI'];
  addChangeOrder: Parameters<typeof seedDemoProject>[0]['addChangeOrder'];
  updateProject: (id: string, updates: Partial<Project>) => void;
}

/** What the sandbox reads. A GETTER on purpose: the seed writes, then the
 *  plan step reads the list again seconds later — a captured array would be
 *  the render from before the seed (see utils/addFloorPlan's header). */
export interface SandboxWorld {
  projects: readonly Project[];
  planSheets: readonly PlanSheet[];
  userId: string | null | undefined;
}

export interface SandboxDeps {
  getWorld: () => SandboxWorld;
  getActions: () => SandboxActions;
  /** Clock seam for the validator; defaults to Date.now. */
  now?: () => number;
  /** Override for the plan budget (validator). */
  planBudgetMs?: number;
}

export type EnsureSampleResult =
  | { ok: true; sandboxProjectId: string; seeded: boolean; flags: Pick<BootFlags, 'samplePlan'>; planReason?: string }
  | { ok: false; reason: 'seed_failed'; detail?: string };

// What resolving the sandbox produced: the job, and (for a fresh seed) how
// its create write ended, which the plan upload waits on.
type Resolved =
  | { ok: true; sandboxProjectId: string; seeded: boolean; existing: Project | null; createOutcome: Promise<WriteOutcome | undefined> | null }
  | { ok: false; reason: 'seed_failed'; detail?: string };

// ONLY the resolve-or-seed step is shared between concurrent starts: two starts
// in one frame (a double tap on "Show me") must not seed two samples. The
// top-ups are NOT shared — they are each caller's own `needs`. Sharing the
// whole boot handed a punch-walk start (needs 'plan') the answer of a daily-
// report boot already in flight (needs nothing): samplePlan true, no plan
// uploaded. Every top-up below is idempotent and deduped on its own.
let resolving: Promise<Resolved> | null = null;

// The sample this session just seeded. The new project reaches React state
// (and so getWorld) a render AFTER the seed resolves, and `resolving` is
// already cleared by then: a start in that gap would find no sample and seed a
// second one. Trusted only briefly and only for the same user — past that the
// world is the truth (he may have deleted it).
let recentSeed: { userId: string | null | undefined; id: string; at: number; createOutcome: Promise<WriteOutcome | undefined> | null } | null = null;
const RECENT_SEED_MS = 10_000;

// Estimate patches issued this session, by sample id. updateProject lands in
// React state a render later, so a second start in the same frame still reads
// the old sample and would patch it twice (a second estimate id).
const estimatePatched = new Set<string>();

/**
 * Resolve (or seed) "Sample — Sarah's Place" and top it up for `needs`.
 * Never throws: a failed seed comes back as { ok: false } and the host exits
 * the run with 'boot_failed'.
 */
export async function ensureTutorialSample(needs: readonly SandboxNeed[], deps: SandboxDeps): Promise<EnsureSampleResult> {
  if (!resolving) resolving = resolveSandbox(deps).finally(() => { resolving = null; });
  const r = await resolving;
  if (!r.ok) return r;
  const { sandboxProjectId, seeded, existing, createOutcome } = r;

  if (needs.includes('estimateLines') && existing) {
    patchEstimateLines(existing, deps);
    patchRetainage(existing, deps);
  }

  let samplePlan = true;
  let planReason: string | undefined;
  if (needs.includes('plan')) {
    const plan = await ensureTutorialPlan(sandboxProjectId, { ...deps, createOutcome });
    samplePlan = plan.ok;
    planReason = plan.ok ? undefined : plan.reason;
  }
  return { ok: true, sandboxProjectId, seeded, flags: { samplePlan }, ...(planReason ? { planReason } : {}) };
}

async function resolveSandbox(deps: SandboxDeps): Promise<Resolved> {
  const name = SANDBOX_PROJECT_NAME['sarahs-place'];
  const world = deps.getWorld();
  const existing = pickSandboxProject(world.projects, world.userId, name);
  const now = (deps.now ?? Date.now)();

  let sandboxProjectId: string;
  let createOutcome: Promise<WriteOutcome | undefined> | null = null;
  let seeded = false;
  if (existing) {
    sandboxProjectId = existing.id;
  } else if (recentSeed && recentSeed.userId === world.userId && now - recentSeed.at < RECENT_SEED_MS) {
    // Seeded a moment ago, not rendered yet: the same sample, not a second.
    return { ok: true, sandboxProjectId: recentSeed.id, seeded: false, existing: null, createOutcome: recentSeed.createOutcome };
  } else {
    try {
      const actions = deps.getActions();
      // Wrap addProject to keep the create write's outcome: the plan upload
      // needs the project row to exist server-side (storage + FK), and the
      // seed itself only returns the id.
      const { projectId } = await seedDemoProject({
        addProject: (p: Project) => {
          const out = actions.addProject(p);
          createOutcome = isPromise(out) ? (out as Promise<WriteOutcome>).catch((): WriteOutcome => 'failed') : null;
        },
        addInvoice: actions.addInvoice,
        addDailyReport: actions.addDailyReport,
        addPunchItem: actions.addPunchItem,
        addProjectPhoto: actions.addProjectPhoto,
        addRFI: actions.addRFI,
        addChangeOrder: actions.addChangeOrder,
        flavor: 'small',
      });
      sandboxProjectId = projectId;
      seeded = true;
      recentSeed = { userId: world.userId, id: projectId, at: now, createOutcome };
    } catch (err) {
      console.warn('[tutorial] sample seed failed', err);
      return { ok: false, reason: 'seed_failed', detail: err instanceof Error ? err.message : undefined };
    }
  }
  return { ok: true, sandboxProjectId, seeded, existing, createOutcome };
}

function isPromise(v: unknown): v is Promise<unknown> {
  return !!v && typeof (v as { then?: unknown }).then === 'function';
}

/** True when `p` has no priced lines to bill from. */
export function needsEstimateLines(p: Pick<Project, 'linkedEstimate'>): boolean {
  return !p.linkedEstimate || !Array.isArray(p.linkedEstimate.items) || p.linkedEstimate.items.length === 0;
}

/** Older samples predate the seeded lines: patch them on. Never overwrites
 *  an estimate that has lines (he may have edited the sample's). */
function patchEstimateLines(p: Project, deps: SandboxDeps): void {
  if (!needsEstimateLines(p) || estimatePatched.has(p.id)) return;
  estimatePatched.add(p.id);
  const at = new Date((deps.now ?? Date.now)()).toISOString();
  deps.getActions().updateProject(p.id, { linkedEstimate: sampleLinkedEstimate(generateUUID(), at) });
}

// Retainage patches issued this session (same double-start reason as above).
const retainagePatched = new Set<string>();

/** True when the invoice screen would ASK for retainage on `p` on mount: no
 *  rate on the job. (The seed's invoices carry none, and a sample has no pay
 *  apps, so the project term is the only layer that can answer.) */
export function needsRetainage(p: Pick<Project, 'retainagePercent'>): boolean {
  return !isRecordedRetainageRate(p.retainagePercent);
}

/** Older samples (and a "Not sure" answer on one) have no retainage term, so
 *  the invoice tutorial opened on the "Retainage on this job" ask and its
 *  coach was hidden behind it. Record the sample's term. 0 is inside the
 *  project_financials 0–100 CHECK (a CHECK refusal is terminal in the queue).
 *  Never overwrites a rate he recorded. */
function patchRetainage(p: Project, deps: SandboxDeps): void {
  if (!needsRetainage(p) || retainagePatched.has(p.id)) return;
  retainagePatched.add(p.id);
  deps.getActions().updateProject(p.id, { ...SAMPLE_RETAINAGE });
}

/** The sample sheet already on `projectId`, durable (in Storage) and current. */
export function findSamplePlanSheet(sheets: readonly PlanSheet[], projectId: string): PlanSheet | null {
  return sheets.find(s =>
    s.projectId === projectId &&
    s.sheetNumber === SAMPLE_PLAN.sheetNumber &&
    s.name === SAMPLE_PLAN.name &&
    !s.superseded &&
    !!s.storagePath,
  ) ?? null;
}

export type EnsurePlanResult = { ok: true; sheetId: string; reused: boolean } | { ok: false; reason: string };

// Plan uploads still running, by sample id. A budget miss does NOT cancel an
// upload (it finishes and the sheet is reused next run) — but until it lands
// the sheet has no storagePath, so findSamplePlanSheet cannot see it, and a
// replay started meanwhile would upload a SECOND A-101 onto the sample. A
// later call joins the running upload instead (against its own budget).
const planUploads = new Map<string, Promise<EnsurePlanResult>>();

/**
 * Put the bundled A-101 plan on the sample through the real addFloorPlan, or
 * reuse the one a previous run put there. Resolves within the budget either
 * way. A budget miss while an upload is still in flight is NOT cancelled:
 * that upload finishes, and the sheet is reused on the next run.
 */
export async function ensureTutorialPlan(
  sampleId: string,
  deps: SandboxDeps & { createOutcome?: Promise<WriteOutcome | undefined> | null },
): Promise<EnsurePlanResult> {
  const reuse = findSamplePlanSheet(deps.getWorld().planSheets, sampleId);
  if (reuse) return { ok: true, sheetId: reuse.id, reused: true };

  const budget = deps.planBudgetMs ?? SAMPLE_PLAN_BUDGET_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<EnsurePlanResult>(resolve => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'The sample plan took too long to load.' }), budget);
  });
  const running = planUploads.get(sampleId);
  const work = running ?? startPlanUpload(sampleId, deps);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function startPlanUpload(
  sampleId: string,
  deps: SandboxDeps & { createOutcome?: Promise<WriteOutcome | undefined> | null },
): Promise<EnsurePlanResult> {
  const work = (async (): Promise<EnsurePlanResult> => {
    // A freshly seeded job must be on the server before a sheet can hang off
    // it. 'queued' (offline) and 'failed' mean it is not: skip the pin.
    if (deps.createOutcome) {
      const outcome = await deps.createOutcome;
      if (outcome !== 'synced') return { ok: false, reason: "You're offline, so the sample plan didn't load." };
    }
    const image = await bundledImage(SAMPLE_PLAN_MODULE, {
      fileName: 'sample-plan-a101.png',
      mimeType: 'image/png',
      width: SAMPLE_PLAN.imageSize.w,
      height: SAMPLE_PLAN.imageSize.h,
    });
    if (!image) return { ok: false, reason: "The sample plan couldn't be read on this device." };
    const res = await addFloorPlan(
      { projectId: sampleId, image, name: SAMPLE_PLAN.name, sheetNumber: SAMPLE_PLAN.sheetNumber },
      // A getter: the actions are read when the sheet is written, after the upload.
      () => deps.getActions(),
    );
    return res.ok ? { ok: true, sheetId: res.sheet.id, reused: false } : { ok: false, reason: res.reason };
  })().catch((err: unknown): EnsurePlanResult => ({ ok: false, reason: err instanceof Error ? err.message : 'The sample plan failed to load.' }));
  planUploads.set(sampleId, work);
  // Forget it once it settles: a landed sheet is found by findSamplePlanSheet
  // from then on, and a failed one may be retried by the next run.
  void work.finally(() => { if (planUploads.get(sampleId) === work) planUploads.delete(sampleId); });
  return work;
}

// ── Bundled images as files the real pipelines accept ───────────────────────

/**
 * The sample punch photo, as the same shape a camera shot has. The punch walk's
 * 'Use sample photo' chip runs the camera's own continuation with it (draft
 * photo, then the pin step), so it is uploaded, pinned and saved exactly like
 * his own photo — without a camera-permission prompt mid-tour, and on the
 * simulator. null when the asset can't be read here (the chip then hides).
 */
export function samplePhotoImage(): Promise<FloorPlanImage | null> {
  return bundledImage(SAMPLE_PHOTO_MODULE, { fileName: 'sample-outlet.jpg', mimeType: 'image/jpeg', width: 960, height: 720 });
}

interface BundledMeta { fileName: string; mimeType: string; width: number; height: number }

/**
 * A bundled asset → a uri that readFileBytes and the upload queues accept:
 *   native  RN core's Image.resolveAssetSource. A dev-server http:// uri is
 *           downloaded into the cache; an embedded / OTA-update file:// is
 *           copied there, readable by expo-file-system. An Android release
 *           build hands back a resource NAME, not a uri: expo-asset then
 *           downloads the module to a local file first. Anything still not a
 *           uri → null.
 *   web     the asset's URL fetched into a blob: URL — the shape an image
 *           picker hands back there, so the photo/plan pipelines treat it as a
 *           picked file and upload it, rather than storing the app's own
 *           (per-deploy, hashed) asset URL as if it were durable.
 */
async function bundledImage(mod: number, meta: BundledMeta): Promise<FloorPlanImage | null> {
  try {
    const uri = Platform.OS === 'web' ? await webBlobUri(mod) : await nativeFileUri(mod, meta.fileName);
    if (!uri) return null;
    return { uri, width: meta.width, height: meta.height, mimeType: meta.mimeType, fileName: meta.fileName };
  } catch (err) {
    console.warn('[tutorial] bundled image unavailable', meta.fileName, err);
    return null;
  }
}

async function nativeFileUri(mod: number, fileName: string): Promise<string | null> {
  // Required lazily: this file is also loaded by the bun validator with these
  // modules stubbed, and on web neither is needed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Image } = require('react-native') as typeof import('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  const src = Image.resolveAssetSource(mod);
  const dir = FileSystem.cacheDirectory;
  let from = src?.uri ?? '';
  if (!dir) return null;
  if (from && !/^(https?|file):/i.test(from)) {
    // expo-asset is not in package.json: it rides on expo's own dependency
    // (expo 54 → expo-asset ~12.0.13, hoisted and already natively linked),
    // so this adds no native change. Declaring it is on the orchestrator's
    // package.json join list.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Asset } = require('expo-asset') as typeof import('expo-asset');
    const asset = await Asset.fromModule(mod).downloadAsync();
    from = asset.localUri ?? '';
  }
  if (!from) return null;
  // The cache name carries a hash of the source uri, and every source here
  // names its content (the dev server's ?hash=, an OTA update's asset file,
  // expo-asset's ExponentAsset-<hash> file): an OTA that changes the bundled
  // plan or photo gets a new cache file instead of the old bytes forever.
  const to = `${dir}tutorial-${hashString(from)}-${fileName}`;
  const info = await FileSystem.getInfoAsync(to);
  if (info.exists) return to;
  if (/^https?:/i.test(from)) {
    const res = await FileSystem.downloadAsync(from, to);
    return res.status >= 200 && res.status < 300 ? to : null;
  }
  if (/^file:/i.test(from)) {
    await FileSystem.copyAsync({ from, to });
    return to;
  }
  return null;
}

/** djb2 → base36: short, stable, dependency-free. Not security, only identity. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function webBlobUri(mod: number): Promise<string | null> {
  // expo-asset resolves a bundled module to its served URL on web (RN-web's
  // Image has no resolveAssetSource). Pure JS there; no native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Asset } = require('expo-asset') as typeof import('expo-asset');
  const url = Asset.fromModule(mod).uri;
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}
