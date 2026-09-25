// utils/logs/logRoutes.ts — which surface /rfi, /submittal, /change-order and
// /invoice show (wave 6c, lane G).
//
// WHY. The wave-6b sidebar's THIS JOB rows (and the job page's tiles) link to
// these four routes with only `?projectId=`, and on the founder's 1512 px
// MacBook each one opened a BLANK NEW FORM: there was no RFI or submittal list
// on desktop at all. On desktop WEB a bare projectId now opens the LOG (every
// record on the job in a sortable table), a record id opens that record BESIDE
// the log, and anything that asks to create still opens the form.
//
// The phone never gets here: the first rule returns 'phone', and each screen
// then runs exactly today's code.
//
// PURE: no react-native, no contexts — scripts/validate-g-logs.ts executes it
// under bun.

export type LogKind = 'rfi' | 'submittal' | 'changeOrder' | 'invoice';

export type LogRouteMode = 'phone' | 'form' | 'log' | 'split';

/** The route's own record param — the one the split writes and reads. */
export const RECORD_PARAM: Readonly<Record<LogKind, string>> = {
  rfi: 'rfiId',
  submittal: 'submittalId',
  changeOrder: 'coId',
  invoice: 'invoiceId',
};

/** The route each kind lives on (expo-router pathname). */
export const LOG_PATHNAME = {
  rfi: '/rfi',
  submittal: '/submittal',
  changeOrder: '/change-order',
  invoice: '/invoice',
} as const;

/** What the log calls one record ("New RFI", "Export CSV of submittals"). */
export const LOG_NOUN: Readonly<Record<LogKind, { one: string; many: string }>> = {
  rfi: { one: 'RFI', many: 'RFIs' },
  submittal: { one: 'submittal', many: 'Submittals' },
  changeOrder: { one: 'change order', many: 'Change orders' },
  invoice: { one: 'invoice', many: 'Invoices' },
};

/**
 * Params that mean "make a new one". Every kind: `new` and any key starting
 * with `prefill` (photo-annotator's prefillPhotoId, the daily report's
 * prefillDescription, the copilot's prefill*). Invoice also: the ways a bill
 * is started from somewhere else — the quick/progress `type` (the tutorial's
 * /invoice?projectId&type=progress), a contract milestone, a deposit.
 */
export const CREATE_SIGNALS: Readonly<Record<LogKind, readonly string[]>> = {
  rfi: ['new'],
  submittal: ['new'],
  changeOrder: ['new'],
  invoice: ['new', 'type', 'milestoneId', 'contractId', 'contractTerms', 'milestoneTrigger', 'depositNoRetainage'],
};

export type RouteParams = Readonly<Record<string, string | readonly string[] | null | undefined>>;

/** A param counts when it carries a non-empty value. */
export function paramPresent(v: string | readonly string[] | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.length > 0;
  return v.some((x) => typeof x === 'string' && x.length > 0);
}

/** The first value of a param, or null. */
export function paramValue(v: string | readonly string[] | null | undefined): string | null {
  if (typeof v === 'string') return v.length > 0 ? v : null;
  if (Array.isArray(v)) {
    const first = v.find((x) => typeof x === 'string' && x.length > 0);
    return first ?? null;
  }
  return null;
}

/** Does the link ask to create a record? */
export function hasCreateSignal(kind: LogKind, params: RouteParams): boolean {
  for (const key of Object.keys(params)) {
    if (!paramPresent(params[key])) continue;
    if (key.startsWith('prefill')) return true;
    if (CREATE_SIGNALS[kind].includes(key)) return true;
  }
  return false;
}

/**
 * The surface for this link.
 *
 *   !desktopWeb      → 'phone'  (the screen runs its code EXACTLY as today)
 *   a create signal  → 'form'   (create beats a record id: the invoice send's
 *                               router.setParams({invoiceId}) on a new=1 form
 *                               must never flip it into the split and remount
 *                               the form mid-send)
 *   a record id      → 'split'  (the record beside the log)
 *   a known project  → 'log'
 *   otherwise        → 'form'   (today's ToolProjectPicker path; after a web
 *                               pick, ?projectId is written and the screen
 *                               re-renders as 'log')
 */
export function logRouteMode(
  kind: LogKind,
  params: RouteParams,
  opts: { desktopWeb: boolean; projectKnown: boolean },
): LogRouteMode {
  if (!opts.desktopWeb) return 'phone';
  if (hasCreateSignal(kind, params)) return 'form';
  if (paramPresent(params[RECORD_PARAM[kind]])) return 'split';
  if (opts.projectKnown) return 'log';
  return 'form';
}

/** Two-digit pad. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** A filename-safe slug of the job name ('' → 'project'). */
export function fileSlug(name: string | null | undefined): string {
  const s = (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return s || 'project';
}

const CSV_STEM: Readonly<Record<LogKind, string>> = {
  rfi: 'rfis',
  submittal: 'submittals',
  changeOrder: 'change-orders',
  invoice: 'invoices',
};

/** `henderson-kitchen-rfis-2026-09-25.csv` — the LOCAL calendar day. */
export function logCsvFileName(kind: LogKind, projectName: string | null | undefined, date: Date): string {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date(0);
  const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return `${fileSlug(projectName)}-${CSV_STEM[kind]}-${day}.csv`;
}

/** The record id a same-route href names, or null (another route, or none). */
export function recordIdFromHref(kind: LogKind, href: unknown): string | null {
  if (href === null || href === undefined) return null;
  if (typeof href === 'string') {
    const q = href.indexOf('?');
    const path = (q >= 0 ? href.slice(0, q) : href).replace(/\/+$/, '') || '/';
    if (path !== LOG_PATHNAME[kind]) return null;
    if (q < 0) return null;
    const search = href.slice(q + 1).split('#')[0];
    for (const part of search.split('&')) {
      const eq = part.indexOf('=');
      const k = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
      if (k !== RECORD_PARAM[kind]) continue;
      const v = eq >= 0 ? decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' ')) : '';
      return v || null;
    }
    return null;
  }
  if (typeof href === 'object') {
    const h = href as { pathname?: unknown; params?: Record<string, unknown> };
    if (typeof h.pathname !== 'string') return null;
    const path = h.pathname.replace(/\/+$/, '') || '/';
    if (path !== LOG_PATHNAME[kind]) return null;
    const v = h.params?.[RECORD_PARAM[kind]];
    return typeof v === 'string' && v ? v : null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cell labels shared by the four logs
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The LOCAL calendar day a value names — a bare 'YYYY-MM-DD' is that day, an
 *  instant is the local day it fell on — as [y, m (0-11), d], or null. */
export function logDayParts(value: string | null | undefined): [number, number, number] | null {
  if (!value) return null;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (bare) {
    const y = Number(bare[1]);
    const m = Number(bare[2]) - 1;
    const d = Number(bare[3]);
    const dt = new Date(y, m, d);
    return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d ? [y, m, d] : null;
  }
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return null;
  return [dt.getFullYear(), dt.getMonth(), dt.getDate()];
}

/** 'Aug 30' this year, 'Aug 30, 2025' another year; null ('—') when unknown. */
export function logDayLabel(value: string | null | undefined, now: Date): string | null {
  const p = logDayParts(value);
  if (!p) return null;
  const base = `${MONTHS[p[1]]} ${p[2]}`;
  return p[0] === now.getFullYear() ? base : `${base}, ${p[0]}`;
}

/** Sortable 'YYYY-MM-DD' of a value, or null (unknown sorts last). */
export function logDayKey(value: string | null | undefined): string | null {
  const p = logDayParts(value);
  if (!p) return null;
  return `${p[0]}-${pad2(p[1] + 1)}-${pad2(p[2])}`;
}

/** '$1,234.50' / '-$1,234.50'; null when not a number. `signed` adds '+'. */
export function logMoney(n: number | null | undefined, signed = false): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n < 0) return `-$${abs}`;
  return `${signed && n > 0 ? '+' : ''}$${abs}`;
}

/** 'RFI-002' / 'CO-014' / 'INV-003' / 'SUB-007'. */
export function logNumberLabel(prefix: string, n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}
