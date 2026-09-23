// The LITE homeowner-portal publisher — one function every caller shares.
//
// WHY THIS FILE EXISTS (audit #23, #44, #122; hotfix #104). The portal reads
// only `portal_snapshots`, and the lite rebuild of that row lived inside a
// debounced effect in app/project-detail.tsx. So a daily report, homeowner
// update, invoice, CO, punch item or photo created anywhere else — Home's
// Daily log card, the Create menu, the invoices screen — reached the client
// only when the GC next happened to open that project. Moving the body here
// lets project-detail AND a provider-level effect (ProjectContext) run the
// same code, with the same rules:
//
//  1. OWNER ONLY. The one portal_snapshots policy is owner-only, so a field or
//     editor seat got an RLS 403 on every push and nothing said so. A
//     collaborator's device skips (outcome 'not_owner'); the server overlays
//     the pieces a collaborator can change — the newest published homeowner
//     update, live invoice money, live CO status — when the portal reads the
//     row (portal_overlay_live, migration 20260919030000).
//  2. NEVER FROM A DEFAULT PROFILE (#104). `settings` is the DEFAULT (no
//     company name, no contact email) until the profile loads; publishing then
//     put "MAGE ID" and a blank mailto on the client's live portal. Skip until
//     loaded, and never let a blank name / contact overwrite a published one.
//  3. A FAILED READ IS NOT "NONE" (#122). fetchActiveContract returned null on
//     a PostgREST error, so one flaky read published a portal with no contract
//     — the homeowner's "Sign contract" card vanished and the proposal came
//     back. Every rich read here reports failure, and ANY failed read skips
//     the push: the row the client already has is better than a wrong one.
//  4. A MISSING SECTION MEANS GONE (#44). The merge used to spread ALL of the
//     previous sections under the fresh build, so a section the lite writer
//     stopped emitting — the last shared CO recalled, a section switched off —
//     kept its old contents, and a recalled change order stayed signable. Only
//     the keys this writer NEVER builds are carried forward, by allowlist.
//  5. ONE RUN PER PROJECT, AND NO NO-OP WRITES. project-detail and the
//     provider can both fire for the same change. A second call while one is
//     in flight is folded into a single re-run with the newest inputs, and an
//     upsert whose snapshot equals the stored one (ignoring its timestamp) is
//     skipped — so the two callers cannot double-publish or churn updated_at.
//
// NOTHING here imports react-native or @/lib/supabase at module scope — the
// validator (scripts/validate-client-portal-lane.ts) runs this file under bun
// with a fake IO. The real IO is built lazily in defaultPortalLiteSyncIO().

import type {
  Project, AppSettings, Invoice, ChangeOrder, DailyFieldReport, PunchItem,
  ProjectPhoto, RFI, Warranty, ProjectContract, SelectionCategory, Permit, SavedAIAPayApp, ClientPortalSettings,
} from '@/types';
import { buildPortalSnapshot, type PortalSnapshot } from '@/utils/portalSnapshot';
import type { CloseoutBinder } from '@/utils/closeoutBinderEngine';
import type { BakedHomePassport } from '@/utils/passport/types';

export type LiteRead<T> = { ok: true; value: T } | { ok: false; error: string };

/** Everything the sync touches outside memory. Injected so it can be run. */
export interface PortalLiteSyncIO {
  loadContract(projectId: string): Promise<LiteRead<ProjectContract | null>>;
  loadSelections(projectId: string): Promise<LiteRead<SelectionCategory[]>>;
  loadCloseoutBinder(projectId: string): Promise<LiteRead<CloseoutBinder | null>>;
  /** Device-local; a missing passport is carried from the published row (see mergeLiteSnapshot). */
  loadPassport(projectId: string): Promise<BakedHomePassport | null>;
  /** The row as published now. ok+null = no row yet. */
  readPublished(portalId: string): Promise<LiteRead<PortalSnapshot | null>>;
  upsert(row: { portal_id: string; project_id: string; snapshot: Record<string, unknown>; updated_at: string }): Promise<{ error: string | null }>;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export interface PortalLiteSyncInput {
  project: Project | undefined;
  /** The signed-in user. The sync publishes only for the project's owner. */
  userId: string | null | undefined;
  settings: AppSettings | undefined;
  settingsLoaded: boolean;
  // Tenant-wide or project-scoped — the sync filters to the project itself.
  invoices: Invoice[];
  changeOrders: ChangeOrder[];
  dailyReports: DailyFieldReport[];
  punchItems: PunchItem[];
  photos: ProjectPhoto[];
  rfis: RFI[];
  warranties: Warranty[];
  /** The Documents section is permits + sent warranties. Without the permits
   *  every lite push rebuilt Documents with the permit rows missing (review
   *  round 1): they must be built fresh here, never carried, because a
   *  carried Documents section would keep a recalled warranty on the portal. */
  permits: Permit[];
  /** The project's AIA pay apps (#15). PRESENT = the caller holds the list
   *  (server-read like the rest), so the section is built FRESH from it — a
   *  pay app sent to the client appears, a recalled one leaves. ABSENT = the
   *  caller has no AIA list, so the published section is carried as before
   *  (a caller that cannot see the list must never publish it as "none"). */
  aiaPayApps?: SavedAIAPayApp[];
}

export type LiteSyncOutcome =
  | 'published'
  | 'unchanged'
  | 'not_owner'
  | 'portal_off'
  | 'settings_not_loaded'
  | 'read_failed'
  | 'write_failed'
  | 'coalesced';

/** Is this device the project's owner? A cache predating ownerUserId is owned
 *  exactly when it carries no collaborator role (A-1 stamps every creation). */
export function isPortalOwner(
  project: Pick<Project, 'ownerUserId' | 'myRole'>,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (project.ownerUserId) return project.ownerUserId === userId;
  return !project.myRole;
}

/**
 * #18: do the switches on screen differ from what is SAVED (and so live)?
 * Compared over what handleSave writes — the section and gate switches, the
 * passcode, the language, the welcome text, the recap, auto-share and the
 * invite list. The token, the portal id, the link lifetime (Generate saves
 * it) and the proposal keys (saved as you toggle) are not "unsaved changes".
 * A portal never saved counts as unsaved only once there is something in it.
 */
const SAVE_ONLY_KEYS = [
  'showSchedule', 'showBudgetSummary', 'showInvoices', 'showChangeOrders', 'showPhotos',
  'showDailyReports', 'showPunchList', 'showRFIs', 'showDocuments',
  'requirePasscode', 'passcode', 'welcomeMessage', 'clientCanSetBudget', 'coApprovalEnabled',
  'homeownerLanguage', 'weeklyDigest', 'autoShare',
] as const;
export function portalSettingsDiffer(local: ClientPortalSettings, saved: ClientPortalSettings | undefined | null): boolean {
  if (!saved?.enabled) return (local.invites ?? []).length > 0;
  const norm = (v: unknown) => JSON.stringify(v ?? null);
  for (const k of SAVE_ONLY_KEYS) {
    const a = k === 'weeklyDigest' ? !!local.weeklyDigest?.enabled : local[k];
    const b = k === 'weeklyDigest' ? !!saved.weeklyDigest?.enabled : saved[k];
    // Missing and default-false / empty are the same setting.
    if (norm(a || null) !== norm(b || null)) return true;
  }
  const ids = (xs: ClientPortalSettings['invites']) => (xs ?? []).map(i => `${i.id}:${i.email ?? ''}`).sort().join('|');
  return ids(local.invites) !== ids(saved.invites);
}

type PortalOpenBook = PortalSnapshot['openBook'];

/**
 * The open-book / GMP block the LITE writer may carry forward from the last
 * RICH snapshot (it builds none itself — it passes no commitments). Nothing
 * while the job is not open-book / GMP: the portal renders any block it finds.
 * And the contract TERMS are re-stamped from the project as it is now — the
 * portal titles the block from `mode` and prints the cap and fee, so carrying
 * the old ones kept telling the homeowner "GMP, $480,000 cap" after the GC
 * switched the job to open book or edited the cap (integration round 3). The
 * cost figures stay as last published (with their asOf); they are the rich
 * writer's to refresh. Moved here from app/project-detail.tsx unchanged.
 */
export function carriedOpenBook(
  prev: PortalOpenBook | undefined,
  project: Pick<Project, 'contractMode' | 'gmpCap' | 'contractorFeePercent' | 'contractorFeeAmount'>,
): PortalOpenBook | undefined {
  const mode = project.contractMode;
  if (mode !== 'gmp' && mode !== 'open_book') return undefined;
  if (!prev) return undefined;
  return {
    ...prev,
    mode,
    gmpCap: project.gmpCap,
    feePercent: project.contractorFeePercent,
    feeAmount: project.contractorFeeAmount,
  };
}

/**
 * The `sections` keys the lite writer may not build, so a missing one means
 * "not mine", not "gone" (#44). aiaPayApps: carried ONLY when the caller did
 * not pass the AIA list (#15 — a caller that has it builds the section fresh,
 * see `aiaBuiltFresh` in mergeLiteSnapshot). Every other section comes from
 * the fresh build, so a recalled CO, a section switched off, or the last
 * shared photo deleted leaves the portal on this push. (messages and openBook
 * are top-level and carried separately.)
 */
export const LITE_CARRIED_SECTIONS = ['aiaPayApps'] as const;

/** A carried section is still subject to its switch: the builder publishes
 *  aiaPayApps only under showInvoices, so once he turns invoices off the pay
 *  apps (and their Pay link) leave on the next lite push too. */
function carriedSectionIsOn(key: typeof LITE_CARRIED_SECTIONS[number], portal: Project['clientPortal']): boolean {
  switch (key) {
    case 'aiaPayApps': return portal?.showInvoices === true;
  }
}

/**
 * The non-destructive merge of a fresh LITE build onto the published row.
 * Pure — scripts/validate-client-portal-lane.ts runs it.
 */
export function mergeLiteSnapshot(
  snap: PortalSnapshot,
  prev: PortalSnapshot | null | undefined,
  project: Pick<Project, 'contractMode' | 'gmpCap' | 'contractorFeePercent' | 'contractorFeeAmount' | 'clientPortal'>,
  opts: { hasCompanyName: boolean; hasPassport: boolean; aiaBuiltFresh?: boolean },
): PortalSnapshot {
  if (!prev || typeof prev !== 'object' || !prev.sections) return snap;
  const carried: Record<string, unknown> = {};
  const prevSections = prev.sections as Record<string, unknown>;
  for (const key of LITE_CARRIED_SECTIONS) {
    // #15: the AIA list was passed, so the fresh build is authoritative — an
    // absent section there means "none shared", and carrying the old one
    // would keep a recalled pay app (and its Pay link) on the portal.
    if (key === 'aiaPayApps' && opts.aiaBuiltFresh) continue;
    if (prevSections[key] !== undefined && carriedSectionIsOn(key, project.clientPortal)) carried[key] = prevSections[key];
  }
  // The closeout block's trade contacts come from commitments, which this
  // writer never has (it passes `commitments: []`), and the Home Passport is
  // baked on ONE device — the GC's phone may hold it while his laptop does
  // not. Carry both from the published block rather than blank them, but
  // only while the fresh build still publishes a closeout at all.
  let closeout = snap.closeout;
  if (closeout && prev.closeout) {
    closeout = {
      ...closeout,
      tradeContacts: closeout.tradeContacts?.length ? closeout.tradeContacts : prev.closeout.tradeContacts,
      ...(opts.hasPassport ? {} : { passport: prev.closeout.passport, faq: prev.closeout.faq }),
    };
  }
  return {
    ...snap,
    // Messages come from the rich writer; this one pushes none.
    messages: prev.messages?.length ? prev.messages : snap.messages,
    // openBook is TOP-LEVEL, not under `sections`: this writer passes
    // `commitments: []`, so the builder omits it and merely opening the
    // project blanked the open-book / GMP breakdown client-portal-setup had
    // published. Carried — but ONLY while the job is still open-book / GMP.
    openBook: snap.openBook ?? carriedOpenBook(prev.openBook, project),
    closeout,
    sections: { ...carried, ...snap.sections } as PortalSnapshot['sections'],
    // #104: a blank company name or contact on THIS build never overwrites
    // the one the portal already shows — the client keeps a real name and a
    // working "email your contractor" link. The builder falls back to
    // "MAGE ID" for a missing name, so "blank" is read off the profile.
    company: snap.company?.name && opts.hasCompanyName ? snap.company : (prev.company ?? snap.company),
    submitBudget: snap.submitBudget && prev.submitBudget
      ? { ...snap.submitBudget, contactEmail: snap.submitBudget.contactEmail || prev.submitBudget.contactEmail, contactName: snap.submitBudget.contactName || prev.submitBudget.contactName }
      : snap.submitBudget,
    portalApi: snap.portalApi && prev.portalApi
      ? { ...snap.portalApi, contactEmail: snap.portalApi.contactEmail || prev.portalApi.contactEmail, contactName: snap.portalApi.contactName || prev.portalApi.contactName }
      : snap.portalApi,
  };
}

/** Key-order-independent JSON, for "is this the row already published?".
 *  jsonb hands keys back sorted, so a plain stringify never compares equal. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** Equal apart from the build timestamp? */
export function sameSnapshot(a: PortalSnapshot | null | undefined, b: PortalSnapshot | null | undefined): boolean {
  if (!a || !b) return false;
  const strip = (s: PortalSnapshot) => ({ ...s, snapshotAt: undefined });
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

/**
 * Build the lite snapshot and publish it if it changed. Returns what happened;
 * never throws. See the file header for the five rules.
 */
async function runOnce(input: PortalLiteSyncInput, io: PortalLiteSyncIO): Promise<LiteSyncOutcome> {
  const { project, settings } = input;
  if (!project) return 'portal_off';
  const portal = project.clientPortal;
  if (!portal?.enabled || !portal.portalId) return 'portal_off';
  if (!isPortalOwner(project, input.userId)) return 'not_owner';
  // Never publish from a profile that has not loaded (#104).
  if (!input.settingsLoaded) return 'settings_not_loaded';

  const pid = project.id;
  const mine = <T extends { projectId?: string }>(xs: T[]) => (xs ?? []).filter(x => x.projectId === pid);

  const [contract, selections, closeoutBinder, homePassport, published] = await Promise.all([
    io.loadContract(pid),
    io.loadSelections(pid),
    io.loadCloseoutBinder(pid),
    io.loadPassport(pid).catch(() => null),
    io.readPublished(portal.portalId),
  ]);
  // #122: a failed read is not "none". Skip the push; the client keeps the
  // portal they already have, and the next change or open retries.
  if (!contract.ok || !selections.ok || !closeoutBinder.ok || !published.ok) return 'read_failed';

  const snap = buildPortalSnapshot({
    project,
    portal,
    settings,
    invoices: mine(input.invoices),
    changeOrders: mine(input.changeOrders),
    dailyReports: mine(input.dailyReports),
    punchItems: mine(input.punchItems),
    photos: mine(input.photos),
    rfis: mine(input.rfis),
    warranties: mine(input.warranties),
    permits: mine(input.permits),
    contract: contract.value ?? undefined,
    selections: selections.value,
    closeoutBinder: closeoutBinder.value ?? undefined,
    homePassport: homePassport ?? undefined,
    // #15: built fresh when the caller passed the AIA list; otherwise carried
    // from the published row (see merge).
    aiaPayApps: input.aiaPayApps ? mine(input.aiaPayApps) : [],
    commitments: [],
    messages: [],
    supabaseUrl: io.supabaseUrl,
    supabaseAnonKey: io.supabaseAnonKey,
    contactEmail: settings?.branding?.email,
    contactName: settings?.branding?.contactName ?? settings?.branding?.companyName,
  });

  const prev = published.value;
  const snapshotToWrite = mergeLiteSnapshot(snap, prev, project, {
    hasCompanyName: !!settings?.branding?.companyName?.trim(),
    hasPassport: !!homePassport,
    aiaBuiltFresh: Array.isArray(input.aiaPayApps),
  });
  if (sameSnapshot(snapshotToWrite, prev)) return 'unchanged';

  // DO NOT add expires_at / link_duration_days to this payload. The link's
  // lifetime is owned solely by app/client-portal-setup.tsx, where the GC
  // chooses it; PostgREST writes only the columns present, so omitting them
  // leaves the chosen expiry — including NULL, "never expires" — untouched.
  const { error } = await io.upsert({
    portal_id: portal.portalId,
    project_id: pid,
    snapshot: snapshotToWrite as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.warn('[portal-lite-sync] publish failed:', error);
    return 'write_failed';
  }
  return 'published';
}

// One run in flight per project; a call during it is folded into ONE re-run
// with the newest inputs (rule 5). Module state on purpose: project-detail and
// the provider are different components, and the rule is per project.
const inFlight = new Map<string, { run: Promise<LiteSyncOutcome>; next: PortalLiteSyncInput | null }>();

export async function syncPortalSnapshotLite(
  projectId: string,
  input: PortalLiteSyncInput,
  io?: PortalLiteSyncIO,
): Promise<LiteSyncOutcome> {
  const slot = inFlight.get(projectId);
  if (slot) {
    slot.next = input;
    return 'coalesced';
  }
  const resolvedIo = io ?? defaultPortalLiteSyncIO();
  if (!resolvedIo) return 'portal_off';
  const entry: { run: Promise<LiteSyncOutcome>; next: PortalLiteSyncInput | null } = { run: Promise.resolve('portal_off'), next: null };
  inFlight.set(projectId, entry);
  entry.run = (async () => {
    let current: PortalLiteSyncInput | null = input;
    let outcome: LiteSyncOutcome = 'portal_off';
    try {
      while (current) {
        entry.next = null;
        try {
          outcome = await runOnce(current, resolvedIo);
        } catch (err) {
          console.warn('[portal-lite-sync] threw:', err);
          outcome = 'write_failed';
        }
        current = entry.next;
      }
    } finally {
      inFlight.delete(projectId);
    }
    return outcome;
  })();
  return entry.run;
}

// ── The real IO, built lazily (see the header) ──────────────────────────────

type SupabaseModule = typeof import('@/lib/supabase');
type ContractModule = typeof import('@/utils/contractEngine');
type SelectionsModule = typeof import('@/utils/selectionsEngine');
type CloseoutModule = typeof import('@/utils/closeoutBinderEngine');
type PassportModule = typeof import('@/utils/passport/passportStore');

let cachedIo: PortalLiteSyncIO | null | undefined;

/** Count rows so an EMPTY result from a loader that swallows errors can be
 *  told apart from a failed read: rows exist + loader says none = failed. */
async function countRows(sb: SupabaseModule, table: string, projectId: string): Promise<number | null> {
  try {
    const { count, error } = await sb.supabase.from(table).select('id', { count: 'exact', head: true }).eq('project_id', projectId);
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

async function countOptions(sb: SupabaseModule, categoryIds: string[]): Promise<number | null> {
  try {
    const { count, error } = await sb.supabase.from('selection_options').select('id', { count: 'exact', head: true }).in('category_id', categoryIds);
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

/**
 * The selections read, failure-aware. fetchSelectionsForProject swallows its
 * errors, so failure is detected by counting: categories exist but none came
 * back = failed; and — because it also swallows a selection_options error and
 * hands back categories with NO options — fewer options returned than the
 * table holds for those categories = failed too. Otherwise the closeout block
 * would publish with every chosen finish missing (#122's class, review round
 * 1). Deps injected so scripts/validate-client-portal-lane.ts can run it.
 */
export async function readSelectionsChecked(deps: {
  countCategories(): Promise<number | null>;
  fetchSelections(): Promise<SelectionCategory[]>;
  countOptions(categoryIds: string[]): Promise<number | null>;
}): Promise<LiteRead<SelectionCategory[]>> {
  const n = await deps.countCategories();
  if (n == null) return { ok: false, error: 'selections count failed' };
  if (n === 0) return { ok: true, value: [] };
  const rows = await deps.fetchSelections().catch(() => null);
  if (!rows || rows.length === 0) return { ok: false, error: 'selections read failed' };
  const inTable = await deps.countOptions(rows.map(r => r.id));
  if (inTable == null) return { ok: false, error: 'selection options count failed' };
  const returned = rows.reduce((sum, r) => sum + (r.options?.length ?? 0), 0);
  return returned >= inTable ? { ok: true, value: rows } : { ok: false, error: 'selection options read failed' };
}

export function defaultPortalLiteSyncIO(): PortalLiteSyncIO | null {
  if (cachedIo !== undefined) return cachedIo;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const sb = require('@/lib/supabase') as SupabaseModule;
    const contracts = require('@/utils/contractEngine') as ContractModule;
    const selectionsEngine = require('@/utils/selectionsEngine') as SelectionsModule;
    const closeout = require('@/utils/closeoutBinderEngine') as CloseoutModule;
    const passport = require('@/utils/passport/passportStore') as PassportModule;
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (!sb.isSupabaseConfigured) { cachedIo = null; return null; }
    cachedIo = {
      async loadContract(projectId) {
        const r = await contracts.loadActiveContract(projectId);
        return r.ok ? { ok: true, value: r.contract } : { ok: false, error: r.error };
      },
      loadSelections: (projectId) => readSelectionsChecked({
        countCategories: () => countRows(sb, 'selection_categories', projectId),
        fetchSelections: () => selectionsEngine.fetchSelectionsForProject(projectId),
        countOptions: (ids) => countOptions(sb, ids),
      }),
      async loadCloseoutBinder(projectId) {
        const n = await countRows(sb, 'closeout_binders', projectId);
        if (n == null) return { ok: false, error: 'closeout count failed' };
        if (n === 0) return { ok: true, value: null };
        const b = await closeout.fetchCloseoutBinder(projectId).catch(() => null);
        return b ? { ok: true, value: b } : { ok: false, error: 'closeout read failed' };
      },
      loadPassport: (projectId) => passport.loadBakedPassport(projectId),
      async readPublished(portalId) {
        try {
          const { data, error } = await sb.supabase.from('portal_snapshots').select('snapshot').eq('portal_id', portalId).maybeSingle();
          if (error) return { ok: false, error: error.message };
          return { ok: true, value: (data?.snapshot as PortalSnapshot | undefined) ?? null };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      async upsert(row) {
        try {
          const { error } = await sb.supabase.from('portal_snapshots').upsert(row, { onConflict: 'portal_id' });
          return { error: error ? error.message : null };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
      supabaseUrl: sb.SUPABASE_URL,
      supabaseAnonKey: sb.SUPABASE_ANON_KEY,
    };
    return cachedIo;
  } catch {
    cachedIo = null;
    return null;
  }
}
