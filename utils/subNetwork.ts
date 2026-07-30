// utils/subNetwork.ts — the sub side of the network.
//
// Every GC on MAGE invites their subs to bid and to bill. Today that invite is
// a dead end for the sub: they click a link, do the GC's paperwork, and walk
// away owning nothing. This engine is what the sub gets to KEEP — their work
// history and standing across EVERY GC who has ever hired them, assembled from
// records they legitimately own, in a form they can hand to a general
// contractor who has never heard of them.
//
// Why it's the growth loop: Procore and Buildertrend never cracked SMB sub
// adoption because they bill the sub for the privilege of doing the GC's data
// entry. Subs are free here, so the sub's incentive flips — a sub with a real
// credential starts telling their OTHER GCs "send it to me through MAGE," and
// the supply side pulls the demand side in.
//
// ── THE BOUNDARY (the whole reason this file is separate) ───────────────────
// A sub sees THEIR OWN data and nothing else. Three hard rules, all asserted
// in scripts/validate-sub-network.ts:
//
//   1. CROSS-SUB. Records are matched to the sub by a normalized identity key
//      (email / phone / license number) — never by company name, because two
//      unrelated shops both called "ABC Electric" would silently merge. A GC
//      ledger with no matching record contributes nothing at all.
//   2. CROSS-GC. Every read is scoped to the ledger it came from: a commitment
//      is only the sub's if its subcontractorId matches a record that GC has on
//      file. Nothing crosses from one GC's ledger into another's rollup beyond
//      the counts the sub personally earned.
//   3. NO GC ECONOMICS. There is not one money field in the output. Not the
//      sub's contract value, not the GC's cost, rate, markup, or margin. What a
//      sub charged GC A is the single most damaging thing to leak to GC B — it
//      would end sub adoption on day one, and it is not needed: jobs, trades,
//      dates, on-time rate and current paper are what a new GC actually reads.
//      findSubDataLeaks() enforces this structurally at the API boundary.
//
// Draft commitments are excluded everywhere. An unsigned draft is the GC's
// private planning — the sub was never told, so it is not their history.
//
// Pure: no React, no network, no clock (caller passes nowMs).

import type { Commitment, Project, PunchItem, Subcontractor } from '@/types';
import { actualWorkingDays } from '@/utils/pace/paceBook';

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;

/** Below these sample counts a headline rate stays null instead of shipping a
 *  credential built on one lucky task. Mirrors utils/subScorecard's floors. */
export const MIN_ONTIME_TASKS = 3;
export const MIN_REVIEWED_PUNCH = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a sub is recognized across GCs. Each GC keeps their own Subcontractor
 * row with their own id, so the join has to happen on something the sub owns.
 * The sub claims their profile with the email a GC invited them at; phone and
 * license number are secondary keys for the GC who typed the address wrong.
 *
 * Deliberately NOT a company-name match — see rule 1 above.
 */
export interface SubIdentity {
  email?: string;
  phone?: string;
  licenseNumber?: string;
}

/**
 * One GC's books, as far as this sub is concerned. In production this arrives
 * from a server-side fan-out across every workspace that has the sub on file;
 * in-app it is a single-element array built from ProjectContext. Either way the
 * engine treats each ledger as a sealed box.
 */
export interface GcLedger {
  gcId: string;
  /** The GC's company name — the sub knows who hired them, so this is theirs. */
  gcName: string;
  subcontractors: Subcontractor[];
  commitments: Commitment[];
  /** Projects for names + schedules. Never read for budget/estimate/cost. */
  projects: Project[];
  punchItems?: PunchItem[];
}

/** A GC the sub works for who is NOT on MAGE yet — typed by the sub, from the
 *  sub's own phone. This is the referral surface; nothing here is derived. */
export interface OffPlatformGc {
  name: string;
  contactName?: string;
  email?: string;
}

export interface SubNetworkInput {
  identity: SubIdentity;
  ledgers: GcLedger[];
  nowMs: number;
  /** Overrides the name pulled from the GCs' records (subs get their own name
   *  wrong on someone else's intake form all the time). */
  displayName?: string;
  offPlatformGcs?: OffPlatformGc[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────────────

export interface SubJob {
  /** `${gcId}::${projectId}` — unique across GCs, since project ids are not. */
  key: string;
  gcId: string;
  gcName: string;
  projectId: string;
  projectName: string;
  trade: string;
  completed: boolean;
  /** Signed date of the earliest commitment the sub holds on this job. */
  startedISO: string | null;
}

export interface SubGcHistory {
  gcId: string;
  gcName: string;
  jobCount: number;
  completedJobCount: number;
  /** Trades this sub performed for this GC, alphabetical. */
  trades: string[];
  firstJobISO: string | null;
  lastJobISO: string | null;
  /** At least one signed commitment still open. */
  activeNow: boolean;
  /** The GC-scoped Subcontractor row ids that matched this sub. Exposed so a
   *  caller (or the validator) can prove a profile only cites its own records. */
  linkedSubRecordIds: string[];
}

export interface SubReliability {
  jobsCompleted: number;
  jobsInProgress: number;
  /** Percent of measured schedule tasks the sub finished within the working
   *  days allotted, measured on the span THEY controlled (as-built start to
   *  as-built finish) — not against a plan date the GC may have blown before
   *  the sub ever got on site. null below MIN_ONTIME_TASKS. */
  onTimePct: number | null;
  onTimeSampleSize: number;
  /** Percent of reviewed punch items that closed without being bounced back
   *  for rework. null below MIN_REVIEWED_PUNCH. */
  punchCleanPct: number | null;
  punchSampleSize: number;
  /** Furthest COI expiry on file with any GC — the sub's own certificate. */
  coiCurrent: boolean;
  coiExpiryISO: string | null;
  coiDaysRemaining: number | null;
  licenseCurrent: boolean;
  licenseExpiryISO: string | null;
  licenseDaysRemaining: number | null;
  w9OnFile: boolean;
}

export interface SubCredential {
  companyName: string;
  trades: string[];
  gcCount: number;
  jobCount: number;
  jobsCompleted: number;
  firstJobISO: string | null;
  lastJobISO: string | null;
  /** First job to last job, one decimal. 0 for a single-job history. */
  activeYears: number;
  /** Only true statements make it in — an empty history yields an empty list
   *  rather than padded filler. */
  highlights: string[];
  /** One paragraph the sub can paste into a text or an email to a new GC. */
  summary: string;
  /** What MAGE is actually vouching for, stated plainly. */
  verifiedLine: string;
}

export interface SubReferral {
  /** What the sub sends a GC who is not on MAGE yet. */
  message: string;
  /** Same ask, trimmed for SMS. */
  shortMessage: string;
  emailSubject: string;
  /** The sub's own off-platform GCs, deduped and minus anyone already here. */
  inviteTargets: OffPlatformGc[];
}

export interface SubNetworkProfile {
  /** The normalized key the profile is anchored to, e.g. `email:sam@ok.com`. */
  identityKey: string;
  companyName: string;
  /** Trades performed, most-performed first. */
  trades: string[];
  gcCount: number;
  jobCount: number;
  /** Most-recent GC first. */
  history: SubGcHistory[];
  /** Most-recent job first. */
  jobs: SubJob[];
  reliability: SubReliability;
  credential: SubCredential;
  referral: SubReferral;
  /** No ledger carried this sub — invited, but nothing linked yet. */
  isEmpty: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity matching
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeEmail(v: string | undefined | null): string {
  return (v ?? '').trim().toLowerCase();
}

/** Digits only, last 10 — so `(415) 555-0100`, `415-555-0100` and
 *  `+1 415 555 0100` all resolve to one sub. Under 10 digits is too weak to
 *  join on and returns '' so it can never match. */
export function normalizePhone(v: string | undefined | null): string {
  const digits = (v ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export function normalizeLicense(v: string | undefined | null): string {
  return (v ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/**
 * Does this GC-scoped Subcontractor row belong to the sub asking?
 *
 * Any ONE strong key is enough (GCs type contact details inconsistently), but
 * every key is normalized first and empty keys never match — an identity with
 * no email must not sweep up every record whose email field is blank.
 */
export function matchesSubIdentity(record: Subcontractor, identity: SubIdentity): boolean {
  const email = normalizeEmail(identity.email);
  if (email && normalizeEmail(record.email) === email) return true;
  const phone = normalizePhone(identity.phone);
  if (phone && normalizePhone(record.phone) === phone) return true;
  const license = normalizeLicense(identity.licenseNumber);
  if (license && normalizeLicense(record.licenseNumber) === license) return true;
  return false;
}

export function subIdentityKey(identity: SubIdentity): string {
  const email = normalizeEmail(identity.email);
  if (email) return `email:${email}`;
  const phone = normalizePhone(identity.phone);
  if (phone) return `phone:${phone}`;
  const license = normalizeLicense(identity.licenseNumber);
  if (license) return `license:${license}`;
  return 'unclaimed';
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseISO(v: string | undefined | null): number | null {
  if (!v) return null;
  const ms = Date.parse(v.length === 10 ? `${v}T12:00:00` : v);
  return Number.isFinite(ms) ? ms : null;
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / DAY_MS);
}

function minISO(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const am = parseISO(a);
  const bm = parseISO(b);
  if (am == null) return b;
  if (bm == null) return a;
  return am <= bm ? a : b;
}

function maxISO(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const am = parseISO(a);
  const bm = parseISO(b);
  if (am == null) return b;
  if (bm == null) return a;
  return am >= bm ? a : b;
}

function yearOf(iso: string | null): string | null {
  const ms = parseISO(iso);
  return ms == null ? null : String(new Date(ms).getUTCFullYear());
}

function monthYear(iso: string | null): string | null {
  const ms = parseISO(iso);
  if (ms == null) return null;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Rank by frequency, then alphabetically so output is deterministic. */
function rankByFrequency(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .map(([k]) => k);
}

// ─────────────────────────────────────────────────────────────────────────────
// The engine
// ─────────────────────────────────────────────────────────────────────────────

interface LedgerScan {
  gcId: string;
  gcName: string;
  matchedIds: Set<string>;
  matchedNames: Set<string>;
  jobs: SubJob[];
  activeNow: boolean;
  onTimeMeasured: number;
  onTimeHits: number;
  punchReviewed: number;
  punchClean: number;
  coiExpiry: string | null;
  licenseExpiry: string | null;
  w9OnFile: boolean;
  companyNames: string[];
}

/**
 * Read ONE ledger for ONE sub. Everything inside is scoped to `ledger` — the
 * function never sees another GC's data, which is what makes rule 2 a
 * structural property rather than a promise.
 */
function scanLedger(ledger: GcLedger, identity: SubIdentity): LedgerScan | null {
  const matched = (ledger.subcontractors ?? []).filter((s) => matchesSubIdentity(s, identity));
  // No record here means this GC has never had the sub on file. Contributing
  // anything at all from this ledger would be a cross-GC leak.
  if (matched.length === 0) return null;

  const matchedIds = new Set(matched.map((s) => s.id));
  const matchedNames = new Set(
    matched.map((s) => (s.companyName ?? '').trim().toLowerCase()).filter((n) => n.length > 0),
  );

  let coiExpiry: string | null = null;
  let licenseExpiry: string | null = null;
  let w9OnFile = false;
  for (const s of matched) {
    coiExpiry = maxISO(coiExpiry, s.coiExpiry || null);
    licenseExpiry = maxISO(licenseExpiry, s.licenseExpiry || null);
    if (s.w9OnFile) w9OnFile = true;
  }

  // ── Signed work. Drafts are the GC's private intent, never the sub's history.
  const signed = (ledger.commitments ?? []).filter(
    (c) => !!c.subcontractorId && matchedIds.has(c.subcontractorId) && c.status !== 'draft',
  );

  const projectById = new Map((ledger.projects ?? []).map((p) => [p.id, p]));
  const tradeById = new Map(matched.map((s) => [s.id, s.trade as string]));

  interface JobAccum {
    projectId: string;
    trade: string;
    allClosed: boolean;
    startedISO: string | null;
    active: boolean;
  }
  const byProject = new Map<string, JobAccum>();
  for (const c of signed) {
    const trade = tradeById.get(c.subcontractorId as string) ?? 'General';
    const started = c.signedDate || c.createdAt || null;
    const existing = byProject.get(c.projectId);
    if (existing) {
      existing.allClosed = existing.allClosed && c.status === 'closed';
      existing.startedISO = minISO(existing.startedISO, started);
      existing.active = existing.active || c.status === 'active';
    } else {
      byProject.set(c.projectId, {
        projectId: c.projectId,
        trade,
        allClosed: c.status === 'closed',
        startedISO: started,
        active: c.status === 'active',
      });
    }
  }

  const jobs: SubJob[] = [];
  let activeNow = false;
  for (const acc of byProject.values()) {
    const project = projectById.get(acc.projectId);
    const projectDone = project?.status === 'completed' || project?.status === 'closed';
    if (acc.active) activeNow = true;
    jobs.push({
      key: `${ledger.gcId}::${acc.projectId}`,
      gcId: ledger.gcId,
      gcName: ledger.gcName,
      projectId: acc.projectId,
      projectName: project?.name ?? 'Project',
      trade: acc.trade,
      completed: acc.allClosed || projectDone,
      startedISO: acc.startedISO,
    });
  }

  // ── On-time: as-built span vs the working days allotted, on tasks assigned
  // to the sub by id. Same eligibility + calendar conversion as the pace book
  // and utils/subScorecard, so the sub-facing number and the GC-facing grade
  // can never disagree about what "a day" means.
  let onTimeMeasured = 0;
  let onTimeHits = 0;
  for (const project of ledger.projects ?? []) {
    const schedule = project?.schedule;
    if (!schedule?.tasks?.length) continue;
    const closures = new Set(schedule.nonWorkingDates ?? []);
    const perWeek = schedule.workingDaysPerWeek ?? 7;
    for (const task of schedule.tasks) {
      if (!task?.assignedSubId || !matchedIds.has(task.assignedSubId)) continue;
      if (task.isMilestone || !(task.durationDays > 0)) continue;
      if (task.status !== 'done') continue;
      if (typeof task.actualStartDay !== 'number' || typeof task.actualEndDay !== 'number') continue;
      if (task.actualEndDay < task.actualStartDay) continue;
      const planned = Math.max(1, Math.round(task.durationDays));
      const actual = actualWorkingDays(
        task.actualStartDay,
        task.actualEndDay,
        perWeek,
        schedule.startDate,
        closures,
      );
      onTimeMeasured++;
      if (actual <= planned) onTimeHits++;
    }
  }

  // ── Punch rework. Attribution is by assignedSubId; the legacy free-text
  // name fallback is allowed ONLY within this ledger AND only on a job where
  // the sub actually holds a commitment, so a same-named shop at the same GC
  // can't be charged to them.
  const jobProjectIds = new Set(jobs.map((j) => j.projectId));
  let punchReviewed = 0;
  let punchClean = 0;
  for (const item of ledger.punchItems ?? []) {
    const mine = item.assignedSubId
      ? matchedIds.has(item.assignedSubId)
      : jobProjectIds.has(item.projectId) &&
        matchedNames.has((item.assignedSub ?? '').trim().toLowerCase());
    if (!mine) continue;
    const bounced = !!(item.rejectionNote ?? '').trim();
    // Reviewed = the GC has ruled on it. Items still open say nothing yet.
    if (item.status !== 'closed' && !bounced) continue;
    punchReviewed++;
    if (!bounced) punchClean++;
  }

  return {
    gcId: ledger.gcId,
    gcName: ledger.gcName,
    matchedIds,
    matchedNames,
    jobs,
    activeNow,
    onTimeMeasured,
    onTimeHits,
    punchReviewed,
    punchClean,
    coiExpiry,
    licenseExpiry,
    w9OnFile,
    companyNames: matched.map((s) => (s.companyName ?? '').trim()).filter((n) => n.length > 0),
  };
}

export function buildSubNetworkProfile(input: SubNetworkInput): SubNetworkProfile {
  const { identity, ledgers, nowMs } = input;

  const scans: LedgerScan[] = [];
  for (const ledger of ledgers ?? []) {
    const scan = scanLedger(ledger, identity);
    if (scan) scans.push(scan);
  }

  const allJobs = scans.flatMap((s) => s.jobs);
  allJobs.sort((a, b) => (parseISO(b.startedISO) ?? 0) - (parseISO(a.startedISO) ?? 0));

  // ── Per-GC history, most recently worked first.
  const history: SubGcHistory[] = scans.map((s) => {
    const tradeSet = new Set(s.jobs.map((j) => j.trade));
    let first: string | null = null;
    let last: string | null = null;
    for (const j of s.jobs) {
      first = minISO(first, j.startedISO);
      last = maxISO(last, j.startedISO);
    }
    return {
      gcId: s.gcId,
      gcName: s.gcName,
      jobCount: s.jobs.length,
      completedJobCount: s.jobs.filter((j) => j.completed).length,
      trades: [...tradeSet].sort((a, b) => a.localeCompare(b)),
      firstJobISO: first,
      lastJobISO: last,
      activeNow: s.activeNow,
      linkedSubRecordIds: [...s.matchedIds].sort((a, b) => a.localeCompare(b)),
    };
  });
  history.sort((a, b) => {
    const diff = (parseISO(b.lastJobISO) ?? 0) - (parseISO(a.lastJobISO) ?? 0);
    return diff !== 0 ? diff : a.gcName.localeCompare(b.gcName);
  });

  // ── Trades, most-performed first (job count, not record count).
  const tradeCounts = new Map<string, number>();
  for (const j of allJobs) tradeCounts.set(j.trade, (tradeCounts.get(j.trade) ?? 0) + 1);
  // A sub with a record but no signed work yet still has a trade on file.
  if (tradeCounts.size === 0) {
    for (const h of history) for (const t of h.trades) tradeCounts.set(t, (tradeCounts.get(t) ?? 0) + 1);
  }
  const trades = rankByFrequency(tradeCounts);

  // ── Reliability rollup.
  const onTimeMeasured = scans.reduce((n, s) => n + s.onTimeMeasured, 0);
  const onTimeHits = scans.reduce((n, s) => n + s.onTimeHits, 0);
  const punchReviewed = scans.reduce((n, s) => n + s.punchReviewed, 0);
  const punchClean = scans.reduce((n, s) => n + s.punchClean, 0);

  let coiExpiryISO: string | null = null;
  let licenseExpiryISO: string | null = null;
  let w9OnFile = false;
  for (const s of scans) {
    coiExpiryISO = maxISO(coiExpiryISO, s.coiExpiry);
    licenseExpiryISO = maxISO(licenseExpiryISO, s.licenseExpiry);
    if (s.w9OnFile) w9OnFile = true;
  }
  const coiMs = parseISO(coiExpiryISO);
  const licenseMs = parseISO(licenseExpiryISO);

  const jobsCompleted = allJobs.filter((j) => j.completed).length;
  const reliability: SubReliability = {
    jobsCompleted,
    jobsInProgress: allJobs.length - jobsCompleted,
    onTimePct: onTimeMeasured >= MIN_ONTIME_TASKS ? Math.round((onTimeHits / onTimeMeasured) * 100) : null,
    onTimeSampleSize: onTimeMeasured,
    punchCleanPct: punchReviewed >= MIN_REVIEWED_PUNCH ? Math.round((punchClean / punchReviewed) * 100) : null,
    punchSampleSize: punchReviewed,
    coiCurrent: coiMs != null && coiMs >= nowMs,
    coiExpiryISO,
    coiDaysRemaining: coiMs == null ? null : daysBetween(nowMs, coiMs),
    licenseCurrent: licenseMs != null && licenseMs >= nowMs,
    licenseExpiryISO,
    licenseDaysRemaining: licenseMs == null ? null : daysBetween(nowMs, licenseMs),
    w9OnFile,
  };

  // ── Identity.
  const nameCounts = new Map<string, number>();
  for (const s of scans) for (const n of s.companyNames) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  const companyName = (input.displayName ?? '').trim() || rankByFrequency(nameCounts)[0] || 'Your company';

  let firstJobISO: string | null = null;
  let lastJobISO: string | null = null;
  for (const j of allJobs) {
    firstJobISO = minISO(firstJobISO, j.startedISO);
    lastJobISO = maxISO(lastJobISO, j.startedISO);
  }
  const firstMs = parseISO(firstJobISO);
  const lastMs = parseISO(lastJobISO);
  const activeYears =
    firstMs != null && lastMs != null && lastMs > firstMs
      ? Math.round(((lastMs - firstMs) / YEAR_MS) * 10) / 10
      : 0;

  const gcCount = history.length;
  const jobCount = allJobs.length;

  const credential = buildCredential({
    companyName,
    trades,
    gcCount,
    jobCount,
    jobsCompleted,
    firstJobISO,
    lastJobISO,
    activeYears,
    reliability,
  });

  return {
    identityKey: subIdentityKey(identity),
    companyName,
    trades,
    gcCount,
    jobCount,
    history,
    jobs: allJobs,
    reliability,
    credential,
    referral: buildReferral(companyName, credential, history, input.offPlatformGcs ?? []),
    isEmpty: scans.length === 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Credential + referral copy
//
// Every sentence below is derived from a count the sub earned. Nothing is
// padded, nothing is estimated, and — by rule 3 — nothing carries a number the
// sub charged anybody.
// ─────────────────────────────────────────────────────────────────────────────

function buildCredential(o: {
  companyName: string;
  trades: string[];
  gcCount: number;
  jobCount: number;
  jobsCompleted: number;
  firstJobISO: string | null;
  lastJobISO: string | null;
  activeYears: number;
  reliability: SubReliability;
}): SubCredential {
  const { companyName, trades, gcCount, jobCount, jobsCompleted, reliability: r } = o;
  const highlights: string[] = [];

  if (jobCount > 0) {
    highlights.push(
      `${plural(jobCount, 'job', 'jobs')} for ${plural(gcCount, 'general contractor', 'general contractors')}`,
    );
  }
  if (jobsCompleted > 0) highlights.push(`${plural(jobsCompleted, 'job', 'jobs')} completed and closed out`);
  if (r.onTimePct != null) {
    highlights.push(
      `${r.onTimePct}% of scheduled work finished inside the days allotted (${plural(r.onTimeSampleSize, 'task', 'tasks')} measured)`,
    );
  }
  if (r.punchCleanPct != null) {
    highlights.push(
      `${r.punchCleanPct}% of punch items closed first time, no rework (${plural(r.punchSampleSize, 'item', 'items')} reviewed)`,
    );
  }
  if (r.coiCurrent && r.coiExpiryISO) highlights.push(`Certificate of insurance current through ${monthYear(r.coiExpiryISO)}`);
  if (r.licenseCurrent && r.licenseExpiryISO) highlights.push(`License current through ${monthYear(r.licenseExpiryISO)}`);
  if (r.w9OnFile) highlights.push('W-9 on file');
  if (trades.length > 0) highlights.push(`Trades performed: ${trades.join(', ')}`);
  const since = yearOf(o.firstJobISO);
  if (since) highlights.push(`Working through MAGE ID since ${since}`);

  const sentences: string[] = [];
  if (jobCount > 0) {
    sentences.push(
      `${companyName} has run ${plural(jobCount, 'job', 'jobs')} for ${plural(gcCount, 'general contractor', 'general contractors')} on MAGE ID` +
        (trades.length > 0 ? `, working ${trades.join(', ').toLowerCase()}` : '') +
        '.',
    );
  } else {
    sentences.push(`${companyName} is set up on MAGE ID and ready to take scope, bid, and bill through it.`);
  }
  if (o.activeYears >= 1) sentences.push(`That record spans ${o.activeYears.toFixed(1)} years of work.`);
  if (jobsCompleted > 0) sentences.push(`${plural(jobsCompleted, 'of those jobs is', 'of those jobs are')} closed out.`);
  if (r.onTimePct != null) {
    sentences.push(`Scheduled work finished inside the days allotted ${r.onTimePct}% of the time.`);
  }
  if (r.punchCleanPct != null) {
    sentences.push(`Punch items closed first time on ${r.punchCleanPct}% of reviewed items.`);
  }
  if (r.coiCurrent) sentences.push('Insurance is current.');

  const verifiedParts: string[] = [];
  if (jobCount > 0) {
    verifiedParts.push(
      `Verified by MAGE ID from ${plural(jobCount, 'job record', 'job records')} across ${plural(gcCount, 'general contractor', 'general contractors')}`,
    );
  } else {
    verifiedParts.push('Verified by MAGE ID — no linked job records yet');
  }

  return {
    companyName,
    trades,
    gcCount,
    jobCount,
    jobsCompleted,
    firstJobISO: o.firstJobISO,
    lastJobISO: o.lastJobISO,
    activeYears: o.activeYears,
    highlights,
    summary: sentences.join(' '),
    // Stated on the card AND in the share text: this is what makes a GC on the
    // other end trust it, and what makes a sub willing to send it at all.
    verifiedLine: `${verifiedParts[0]}. No pricing, rates, or contract values are shared.`,
  };
}

function buildReferral(
  companyName: string,
  credential: SubCredential,
  history: SubGcHistory[],
  offPlatform: OffPlatformGc[],
): SubReferral {
  const known = new Set(history.map((h) => h.gcName.trim().toLowerCase()));
  const seen = new Set<string>();
  const inviteTargets: OffPlatformGc[] = [];
  for (const gc of offPlatform) {
    const key = (gc.name ?? '').trim().toLowerCase();
    if (!key || known.has(key) || seen.has(key)) continue;
    seen.add(key);
    inviteTargets.push({ name: gc.name.trim(), contactName: gc.contactName, email: gc.email });
  }

  const proof =
    credential.jobCount > 0
      ? ` My record on it is public to whoever I send it to: ${plural(credential.jobCount, 'job', 'jobs')} for ${plural(credential.gcCount, 'GC', 'GCs')}` +
        (credential.jobsCompleted > 0 ? `, ${credential.jobsCompleted} closed out` : '') +
        '.'
      : '';

  const message =
    `Hey - a couple of the GCs I work for run their subs through MAGE ID, and it's made my end a lot cleaner. ` +
    `I get my scope and schedule in one place, I submit invoices there, and my COI and license stay current instead of you chasing me for them.${proof} ` +
    `It's free for subs, so there's nothing for me to sign up for twice. ` +
    `If you send me bid invites and invoices through MAGE, everything between us lives in one thread. Want me to send you the link to set it up?`;

  const shortMessage =
    `A few of my GCs run subs through MAGE ID - scope, schedule, invoices and my COI all in one place, free on my end. ` +
    `Want me to send you the link so we can run our jobs through it?`;

  return {
    message,
    shortMessage,
    emailSubject: `${companyName} - running our jobs through MAGE ID`,
    inviteTargets,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The boundary guard
//
// Rule 3 is only real if something checks it. findSubDataLeaks walks a finished
// profile and reports anything that looks like GC economics — a field named for
// money, or money smuggled into a display string. Call it at the API boundary
// before a profile is handed to a sub; scripts/validate-sub-network.ts calls it
// on every fixture.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Word-split a field name so `laborRate`, `labor_rate`, `LaborRate` and
 * `LABOR_RATE` all reduce to `labor rate`. Without this the denylist below
 * silently misses every camelCase field — which is how almost every real field
 * in this codebase is named.
 */
export function fieldWords(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toLowerCase()
    .trim();
}

/** Money words that must never name a field in a sub-facing payload. Matched
 *  against fieldWords(), so it is whole-word by construction. */
export const FORBIDDEN_KEY_PATTERN =
  /\b(cost|costs|margin|margins|markup|markups|profit|profits|price|prices|pricing|rate|rates|amount|amounts|budget|budgets|billed|billing|payment|payments|paid|invoice|invoices|retention|overhead|contingency|revenue|balance|fee|fees|wage|wages|burden|quote|quoted)\b/;

/** True when this field name has no business reaching a subcontractor. */
export function isForbiddenSubField(key: string): boolean {
  return FORBIDDEN_KEY_PATTERN.test(fieldWords(key));
}

/** Money smuggled into a string: a currency symbol on a digit, or spelled out. */
export const MONEY_TEXT_PATTERN = /[$€£]\s*\d|\d[\d,]*\s*(?:dollars|usd)\b/i;

/**
 * Returns a list of violations (empty = safe). Never throws — the caller
 * decides whether to strip, log, or fail closed.
 */
export function findSubDataLeaks(value: unknown, path = 'profile'): string[] {
  const out: string[] = [];
  const walk = (node: unknown, at: string, depth: number): void => {
    if (depth > 12 || node == null) return;
    if (typeof node === 'string') {
      if (MONEY_TEXT_PATTERN.test(node)) out.push(`money in string at ${at}: "${node.slice(0, 60)}"`);
      return;
    }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${at}[${i}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (isForbiddenSubField(key)) out.push(`forbidden field at ${at}.${key}`);
      walk(child, `${at}.${key}`, depth + 1);
    }
  };
  walk(value, path, 0);
  return out;
}

/**
 * Every id a profile was assembled from. A caller can diff this against the
 * records the requesting sub is entitled to and reject the response if it cites
 * anything else — the cross-sub / cross-GC assertion, in production.
 */
export function profileSourceIds(profile: SubNetworkProfile): {
  gcIds: string[];
  subRecordIds: string[];
  projectIds: string[];
} {
  const gcIds = new Set<string>();
  const subRecordIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const h of profile.history) {
    gcIds.add(h.gcId);
    for (const id of h.linkedSubRecordIds) subRecordIds.add(id);
  }
  for (const j of profile.jobs) {
    gcIds.add(j.gcId);
    projectIds.add(j.projectId);
  }
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return { gcIds: sorted(gcIds), subRecordIds: sorted(subRecordIds), projectIds: sorted(projectIds) };
}
