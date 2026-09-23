// validate-payment-terms.ts — the GC's payment terms and warranty are asked
// once, stored once, printed from one resolver, and billed to the cent they
// printed.
//
// WHY THIS EXISTS. Every client-facing document used to carry terms nobody
// chose — 25 / 65 / 10 on the PDF and wizard, a 10% deposit on the share link
// and portal proposal, 25 / 25 / 25 / 25 and a one-year warranty on a new
// contract — so a homeowner could be shown three different deposits for one
// job. Direction B ("Ask when it matters") replaces all of them with the GC's
// own answer (profiles.deposit_pct / progress_pct / final_pct /
// warranty_months, 20260917150000). The foundation has ten ways to quietly
// undo that, and this guard pins each:
//
//   (a) PARITY      the migration's CHECKs == the client validators, evaluated
//                   with SQL three-valued logic (a CHECK that yields NULL
//                   PASSES — the bug the explicit `is not null` conjuncts fix);
//                   the projects trigger guards the exact key types/index.ts
//                   declares.
//   (b) VALIDATOR   every accepted split satisfies the CHECK; every refusal
//                   says why.
//   (c) LOADING     a queued terms write keeps the device answer; unrelated
//                   profiles writes do not count as one.
//   (d) RESOLVER    a job's valid record beats the profile; nothing set is
//                   'not_set', never a number.
//   (e) MONEY       the three stages add up to the cent, and deposit / final
//                   are exactly what utils/billingFlowCore bills for them.
//   (f) WARRANTY    period wording, placeholder, and the retired literals.
//   (g) STAMP       replacing a portal's terms needs proof nobody accepted.
//   (h) ASK FLOW    order, one question per step, the founder's copy, toasts
//                   that fit, the California note.
//   (i) CONTEXT     the whole-row settings save never sends the terms; their
//                   own write sends only them; the loader and merges are
//                   ref-based.
//   (j) HOOK/SHEET  the paused action runs in the last press with nothing
//                   async before it; dismiss drops it; the licence field is
//                   inside its rule branch.
//
// Run via: bun run test:payment-terms
// Overridable paths (PT_MIGRATION / PT_CONTEXT / PT_HOOK / PT_SHEET / PT_TYPES)
// so the structural checks can be mutation-tested against a copy.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PaymentMilestone, PaymentSplit, Project } from '../types';
import {
  ACCEPTANCE_UNKNOWN_REASON,
  LEGACY_WARRANTY_TEXT,
  PAYMENT_SPLIT_BOUNDS,
  PAYMENT_STAGE_COPY,
  WARRANTY_MONTHS_BOUNDS,
  WARRANTY_PERIOD_PLACEHOLDER,
  acceptanceSentence,
  acceptanceStateFromRead,
  contractScheduleFromSplit,
  contractWarrantyText,
  hasWarrantyPlaceholder,
  isLegacySeedSchedule,
  isValidStamp,
  milestoneDueText,
  nextProposalStamp,
  paymentStageRows,
  paymentTermsAfterLoad,
  portalsNeedingTerms,
  proposalPaymentLines,
  proposalTermsState,
  resolvePaymentSplit,
  resolveWarrantyMonths,
  retieContractSchedule,
  splitLabel,
  stageAmounts,
  termsColumnsForWrite,
  termsWritesPending,
  pendingWithInFlight,
  validatePaymentSplit,
  validateWarrantyMonths,
  warrantyPeriodPhrase,
  warrantyShortLabel,
  workmanshipWarrantyLine,
} from '../utils/paymentTerms';
import {
  ASK_TERMS_TITLE,
  DEPOSIT_CAP_RULES,
  TERMS_REASON,
  TERMS_FOOTNOTE,
  WARRANTY_FOOTNOTE,
  WARRANTY_REASON,
  TOAST_MAX,
  askStepCopy,
  confirmationFor,
  confirmationForSheet,
  depositCapNote,
  missingQuestions,
  submitAskStep,
  termsLiveLine,
  type AskProfile,
} from '../utils/clientDocumentAsk';
import { milestoneBillability, milestoneBillableAmount } from '../utils/billingFlowCore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG_DIR = join(ROOT, 'supabase/migrations');
const migrationFile = readdirSync(MIG_DIR).find((f) => f.endsWith('_profiles_payment_terms.sql'));
const MIGRATION = process.env.PT_MIGRATION || (migrationFile ? join(MIG_DIR, migrationFile) : '');
const CONTEXT = process.env.PT_CONTEXT || join(ROOT, 'contexts/ProjectContext.tsx');
const HOOK = process.env.PT_HOOK || join(ROOT, 'hooks/useClientDocumentGate.ts');
const SHEET = process.env.PT_SHEET || join(ROOT, 'components/ClientDocumentAskSheet.tsx');
const TYPES = process.env.PT_TYPES || join(ROOT, 'types/index.ts');
const ASK = join(ROOT, 'utils/clientDocumentAsk.ts');

let failures = 0;
let passes = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) { passes++; return; }
  failures++;
  console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
}
const j = (v: unknown) => JSON.stringify(v);
const S = (d: number, p: number, f: number): PaymentSplit => ({ depositPct: d, progressPct: p, finalPct: f });

function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { const e = src.indexOf('\n', i); if (e < 0) break; i = e; continue; }
    if (c === '/' && next === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) break; i = e + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** From the first `open` at/after `from`, the balanced span through its close. */
function balanced(src: string, from: number, open = '{', close = '}'): string {
  const start = src.indexOf(open, from);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '\'' || c === '"' || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

/** Body of `const name = …(… => { … })`, from the arrow's brace. */
function arrowBody(src: string, name: string): string {
  const decl = src.indexOf(`const ${name} = `);
  if (decl < 0) return '';
  // The body arrow, not one inside a parameter type (`then: (a) => void`).
  const m = /=>\s*\{/.exec(src.slice(decl));
  return m ? balanced(src, decl + m.index) : '';
}

// ═══ (a) MIGRATION PARITY ═══════════════════════════════════════════════════
console.log('\npayment terms — (a) migration parity');
check('migration *_profiles_payment_terms.sql exists', !!MIGRATION);
const sqlRaw = MIGRATION ? readFileSync(MIGRATION, 'utf8') : '';
const sql = sqlRaw.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const COLS = ['deposit_pct', 'progress_pct', 'final_pct', 'warranty_months'];
for (const col of COLS) {
  const m = sql.match(new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${col}\\s+([^,;\\n]+)`, 'i'));
  check(`${col}: added idempotently on public.profiles`, !!m && /alter\s+table\s+public\.profiles/i.test(sql));
  check(`${col}: smallint with no DEFAULT`, !!m && /^smallint\s*$/i.test(m[1].trim()), m?.[1]);
}
check('no DEFAULT anywhere in the migration (NULL means never asked)', !/\bdefault\b/i.test(sql));

// ── A three-valued-logic evaluator for the CHECK grammar the migration uses:
//    or / and / parentheses / `x is [not] null` / `x between a and b` /
//    `a + b + c = n` / comparisons. A CHECK passes unless it evaluates FALSE.
type TV = boolean | null;
type Val = number | null;
type Env = Record<string, Val>;
function tokenize(expr: string): string[] {
  return expr.match(/<=|>=|<>|!=|[()+=<>]|[A-Za-z_][A-Za-z0-9_]*|\d+/g) ?? [];
}
function compileCheck(expr: string): ((env: Env) => TV) | null {
  const toks = tokenize(expr);
  let pos = 0;
  const peek = () => (toks[pos] ?? '').toLowerCase();
  const eat = (t?: string) => {
    const tok = toks[pos];
    if (t && (tok ?? '').toLowerCase() !== t) throw new Error(`expected ${t} got ${tok}`);
    pos++; return tok;
  };
  type Num = (e: Env) => Val;
  type Bool = (e: Env) => TV;
  const term = (): Num => {
    const tok = eat();
    if (/^\d+$/.test(tok)) { const n = Number(tok); return () => n; }
    if (tok.toLowerCase() === 'null') return () => null;
    if (/^[A-Za-z_]/.test(tok)) return (e) => (tok in e ? e[tok] : (() => { throw new Error(`unknown column ${tok}`); })());
    throw new Error(`bad term ${tok}`);
  };
  const sum = (): Num => {
    let left = term();
    while (peek() === '+') {
      eat('+');
      const l = left, r = term();
      left = (e) => { const a = l(e), b = r(e); return a == null || b == null ? null : a + b; };
    }
    return left;
  };
  const not3 = (v: TV): TV => (v == null ? null : !v);
  const and3 = (a: TV, b: TV): TV => (a === false || b === false ? false : a == null || b == null ? null : true);
  const or3 = (a: TV, b: TV): TV => (a === true || b === true ? true : a == null || b == null ? null : false);
  let orExpr: () => Bool;
  const pred = (): Bool => {
    if (peek() === 'not') { eat('not'); const inner = pred(); return (e) => not3(inner(e)); }
    if (peek() === '(') { eat('('); const inner = orExpr(); eat(')'); return inner; }
    const left = sum();
    const op = peek();
    if (op === 'is') {
      eat('is');
      const neg = peek() === 'not'; if (neg) eat('not');
      eat('null');
      return (e) => (left(e) == null) !== neg;
    }
    if (op === 'between') {
      eat('between'); const lo = sum(); eat('and'); const hi = sum();
      return (e) => {
        const v = left(e), a = lo(e), b = hi(e);
        if (v == null || a == null || b == null) return null;
        return v >= a && v <= b;
      };
    }
    const cmp = eat();
    const right = sum();
    return (e) => {
      const a = left(e), b = right(e);
      if (a == null || b == null) return null;
      switch (cmp) {
        case '=': return a === b;
        case '<>': case '!=': return a !== b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
        default: throw new Error(`bad operator ${cmp}`);
      }
    };
  };
  const andExpr = (): Bool => {
    let left = pred();
    while (peek() === 'and') { eat('and'); const l = left, r = pred(); left = (e) => and3(l(e), r(e)); }
    return left;
  };
  orExpr = (): Bool => {
    let left = andExpr();
    while (peek() === 'or') { eat('or'); const l = left, r = andExpr(); left = (e) => or3(l(e), r(e)); }
    return left;
  };
  try {
    const fn = orExpr();
    if (pos !== toks.length) return null;
    return fn;
  } catch {
    return null;
  }
}
function checkBody(name: string): string {
  const i = sql.search(new RegExp(`add\\s+constraint\\s+${name}\\s+check\\s*\\(`, 'i'));
  if (i < 0) return '';
  const span = balanced(sql, sql.indexOf('check', i), '(', ')');
  return span.slice(1, -1);
}
const passesCheck = (fn: (e: Env) => TV, env: Env) => fn(env) !== false;

const splitCheck = compileCheck(checkBody('profiles_payment_split_check'));
check('profiles_payment_split_check parses', !!splitCheck, checkBody('profiles_payment_split_check').slice(0, 120));
const splitBody = checkBody('profiles_payment_split_check');
for (const col of ['deposit_pct', 'progress_pct', 'final_pct']) {
  check(`split CHECK carries the explicit "${col} is not null" conjunct`, new RegExp(`\\b${col}\\s+is\\s+not\\s+null`, 'i').test(splitBody));
}
if (splitCheck) {
  let mismatch = '';
  const lo = PAYMENT_SPLIT_BOUNDS.min - 2, hi = PAYMENT_SPLIT_BOUNDS.max + 2;
  outer: for (let d = lo; d <= hi; d++) {
    for (let p = lo; p <= hi; p++) {
      for (const f of [PAYMENT_SPLIT_BOUNDS.sum - d - p - 1, PAYMENT_SPLIT_BOUNDS.sum - d - p, PAYMENT_SPLIT_BOUNDS.sum - d - p + 1, lo, hi]) {
        const sqlOk = passesCheck(splitCheck, { deposit_pct: d, progress_pct: p, final_pct: f });
        const tsOk = validatePaymentSplit({ deposit: d, progress: p, final: f }).ok;
        if (sqlOk !== tsOk) { mismatch = `${d}/${p}/${f}: CHECK ${sqlOk} vs validator ${tsOk}`; break outer; }
      }
    }
  }
  check('CHECK (3VL) accepts exactly the splits validatePaymentSplit accepts, bounds included', mismatch === '', mismatch);
  let partialPassed = '';
  for (let mask = 1; mask < 7; mask++) {
    const env: Env = {
      deposit_pct: mask & 1 ? null : 25,
      progress_pct: mask & 2 ? null : 65,
      final_pct: mask & 4 ? null : 10,
    };
    if (splitCheck(env) !== false) partialPassed += ` ${j(env)}`;
  }
  check('CHECK evaluates FALSE (not NULL) for every partial-null split', partialPassed === '', partialPassed);
  check('CHECK accepts the all-null (never asked) row', passesCheck(splitCheck, { deposit_pct: null, progress_pct: null, final_pct: null }));
}

const warrantyCheck = compileCheck(checkBody('profiles_warranty_months_check'));
check('profiles_warranty_months_check parses', !!warrantyCheck);
if (warrantyCheck) {
  let mismatch = '';
  for (let m = WARRANTY_MONTHS_BOUNDS.min - 3; m <= WARRANTY_MONTHS_BOUNDS.max + 3; m++) {
    const sqlOk = passesCheck(warrantyCheck, { warranty_months: m });
    if (sqlOk !== validateWarrantyMonths(m).ok) { mismatch = `${m}`; break; }
  }
  check('warranty CHECK == validateWarrantyMonths (1..120)', mismatch === '', mismatch);
  check('warranty CHECK accepts NULL', passesCheck(warrantyCheck, { warranty_months: null }));
}

const typesSrc = readFileSync(TYPES, 'utf8');
const portalDecl = balanced(typesSrc, typesSrc.indexOf('export interface ClientPortalSettings'));
const stampKey = portalDecl.match(/\b(proposalPaymentTerms)\?\s*:\s*ProposalPaymentTerms\b/)?.[1] ?? '';
check('types/index.ts declares ClientPortalSettings.proposalPaymentTerms', stampKey === 'proposalPaymentTerms');
const trigFn = sql.match(/create\s+or\s+replace\s+function\s+public\.projects_keep_proposal_payment_terms\(\)[\s\S]*?\$fn\$;/i)?.[0] ?? '';
check('trigger function defined with a pinned search_path', /set\s+search_path/i.test(trigFn));
check(`trigger guards on the ABSENCE of '${stampKey}' in the incoming blob`,
  !!stampKey && new RegExp(`not\\s*\\(\\s*new\\.client_portal\\s*\\?\\s*'${stampKey}'\\s*\\)`, 'i').test(trigFn));
check('trigger restores from old.client_portal only when the stored stamp is an object',
  !!stampKey && new RegExp(`jsonb_typeof\\(\\s*old\\.client_portal\\s*->\\s*'${stampKey}'\\s*\\)\\s*=\\s*'object'`, 'i').test(trigFn));
check('trigger is BEFORE UPDATE on public.projects', /create\s+trigger\s+projects_keep_proposal_payment_terms\s+before\s+update\s+on\s+public\.projects/i.test(sql));
check('trigger function EXECUTE revoked', /revoke\s+execute\s+on\s+function\s+public\.projects_keep_proposal_payment_terms\(\)\s+from\s+public,\s*anon,\s*authenticated/i.test(sql));
check("notify pgrst, 'reload schema'", /notify\s+pgrst\s*,\s*'reload schema'/i.test(sql));
check('header: NULL passes a CHECK', /PASSES when it evaluates to NULL/i.test(sqlRaw));
check('header: apply before the web merge and the OTA', /APPLY BEFORE THE WEB MERGE AND THE OTA/i.test(sqlRaw));
check('header: a CHECK violation is terminal', /CHECK VIOLATION IS TERMINAL/i.test(sqlRaw));

// ═══ (b) VALIDATOR SWEEP ════════════════════════════════════════════════════
console.log('payment terms — (b) validator sweep');
const acceptCases: [unknown, unknown, unknown, PaymentSplit][] = [
  ['25', '65', '10', S(25, 65, 10)], [' 25 ', '65 ', ' 10', S(25, 65, 10)], ['25%', '65 %', '10%', S(25, 65, 10)],
  [0, 100, 0, S(0, 100, 0)], [100, 0, 0, S(100, 0, 0)], ['0', '0', '100', S(0, 0, 100)],
];
for (const [d, p, f, want] of acceptCases) {
  const v = validatePaymentSplit({ deposit: d as string, progress: p as string, final: f as string });
  check(`accepts ${j([d, p, f])}`, v.ok && j(v.split) === j(want), j(v));
}
const refuseCases: unknown[][] = [
  ['', '65', '10'], ['2.5', '87.5', '10'], ['-1', '91', '10'], ['101', '0', '-1'], ['99', '0', '0'], ['100', '1', '0'],
  [NaN, 90, 10], [2.5, 87.5, 10], ['abc', '90', '10'], [null, 90, 10], [undefined, 90, 10], ['25', '65', '5'],
];
for (const [d, p, f] of refuseCases) {
  const v = validatePaymentSplit({ deposit: d as string, progress: p as string, final: f as string });
  check(`refuses ${j([d, p, f])} with a reason`, !v.ok && typeof v.reason === 'string' && v.reason.length > 0, j(v));
}
{
  const v = validatePaymentSplit({ deposit: '25', progress: '55', final: '10' });
  check('sum refusal names the total', !v.ok && v.reason === 'Adds up to 90% — deposit, progress and final need to total 100%.', j(v));
}
if (splitCheck) {
  let bad = '';
  const raws = ['', ' ', '0', '5', '10', '25', '33', '34', '50', '65', '99', '100', '101', '-1', '2.5', '25%', 'x', 25, 2.5, NaN, -3];
  for (const d of raws) for (const p of raws) for (const f of raws) {
    const v = validatePaymentSplit({ deposit: d, progress: p, final: f });
    if (v.ok && !passesCheck(splitCheck, { deposit_pct: v.split.depositPct, progress_pct: v.split.progressPct, final_pct: v.split.finalPct })) { bad = j([d, p, f]); break; }
    if (!v.ok && !v.reason) { bad = `no reason ${j([d, p, f])}`; break; }
  }
  check('every ok split passes the CHECK model; every refusal has a reason', bad === '', bad);
}
for (const m of [0, 121, -1, 1.5, NaN, '', '12.0', 'x']) {
  const v = validateWarrantyMonths(m as number);
  check(`warranty refuses ${j(m)} with a reason`, !v.ok && !!v.reason, j(v));
}
for (const m of [1, '12', ' 24 ', 120]) check(`warranty accepts ${j(m)}`, validateWarrantyMonths(m).ok);
check('termsColumnsForWrite refuses a split the CHECK would reject', 'refused' in termsColumnsForWrite({ split: S(25, 65, 5) }));
check('termsColumnsForWrite refuses warranty 0', 'refused' in termsColumnsForWrite({ warrantyMonths: 0 }));
{
  const c = termsColumnsForWrite({ split: S(30, 60, 10), warrantyMonths: 24 });
  check('termsColumnsForWrite maps to exactly the four columns',
    !('refused' in c) && j(c) === j({ split: { deposit_pct: 30, progress_pct: 60, final_pct: 10 }, warranty: { warranty_months: 24 } }), j(c));
}

// ═══ (c) LOADING ════════════════════════════════════════════════════════════
console.log('payment terms — (c) loading');
const U = 'user-1';
const q = (data: Record<string, unknown>, extra: Partial<{ table: string; operation: string }> = {}) =>
  ({ table: 'profiles', operation: 'update', data: { id: U, ...data }, ...extra });
check('queued onboarding_complete / user_role writes are NOT pending terms',
  j(termsWritesPending([q({ onboarding_complete: true }), q({ user_role: 'gc' }), q({ company_name: 'X', tax_rate: 0 })], U)) === j({ split: false, warranty: false }));
check('queued split write is pending (split only)', j(termsWritesPending([q({ deposit_pct: 25, progress_pct: 65, final_pct: 10 })], U)) === j({ split: true, warranty: false }));
check('queued warranty write is pending (warranty only)', j(termsWritesPending([q({ warranty_months: 24 })], U)) === j({ split: false, warranty: true }));
check("another user's queued write does not count", j(termsWritesPending([{ ...q({ deposit_pct: 25 }), data: { id: 'other', deposit_pct: 25 } }], U)) === j({ split: false, warranty: false }));
check('a non-profiles table does not count', j(termsWritesPending([q({ deposit_pct: 25 }, { table: 'projects' })], U)) === j({ split: false, warranty: false }));

const cached = { paymentSplit: S(30, 60, 10), warrantyMonths: 24 };
const fullRow = { id: U, deposit_pct: 25, progress_pct: 65, final_pct: 10, warranty_months: 12 };
const nullRow = { id: U, deposit_pct: null, progress_pct: null, final_pct: null, warranty_months: null };
const preMigrationRow = { id: U, company_name: 'X' };
const noPending = { split: false, warranty: false };
const matrix: { label: string; row: Record<string, unknown>; cached: unknown; pending: { split: boolean; warranty: boolean }; want: unknown }[] = [
  { label: 'columns present, nothing pending → server', row: fullRow, cached, pending: noPending, want: { paymentSplit: S(25, 65, 10), warrantyMonths: 12 } },
  { label: 'columns present with NULL, nothing pending → cleared (never asked)', row: nullRow, cached, pending: noPending, want: {} },
  { label: 'columns absent (pre-migration) → cached kept', row: preMigrationRow, cached, pending: noPending, want: cached },
  { label: 'split pending → cached split, server warranty', row: fullRow, cached, pending: { split: true, warranty: false }, want: { paymentSplit: S(30, 60, 10), warrantyMonths: 12 } },
  { label: 'warranty pending → server split, cached warranty', row: fullRow, cached, pending: { split: false, warranty: true }, want: { paymentSplit: S(25, 65, 10), warrantyMonths: 24 } },
  { label: 'both pending → cached', row: fullRow, cached, pending: { split: true, warranty: true }, want: cached },
  { label: 'invalid server values → absent', row: { id: U, deposit_pct: 25, progress_pct: 65, final_pct: 5, warranty_months: 0 }, cached, pending: noPending, want: {} },
  { label: 'columns absent + invalid cache → absent', row: preMigrationRow, cached: { paymentSplit: S(50, 50, 50), warrantyMonths: 500 }, pending: noPending, want: {} },
  { label: 'columns absent + no cache → absent', row: preMigrationRow, cached: null, pending: noPending, want: {} },
  { label: 'pending + invalid cache → absent (never trusts a bad cache)', row: fullRow, cached: { paymentSplit: { depositPct: '25' } }, pending: { split: true, warranty: true }, want: {} },
];
for (const m of matrix) {
  const got = paymentTermsAfterLoad({ row: m.row, cached: m.cached as never, pending: m.pending });
  check(`load: ${m.label}`, j(got) === j(m.want), `${j(got)} vs ${j(m.want)}`);
}

// ═══ (d) RESOLVER ═══════════════════════════════════════════════════════════
console.log('payment terms — (d) resolver');
check('valid record beats the profile', j(resolvePaymentSplit({ record: S(10, 80, 10), settings: { paymentSplit: S(25, 65, 10) } })) === j({ split: S(10, 80, 10), source: 'record' }));
check('invalid record is ignored', j(resolvePaymentSplit({ record: S(10, 80, 20), settings: { paymentSplit: S(25, 65, 10) } })) === j({ split: S(25, 65, 10), source: 'profile' }));
check('nothing set → not_set (never a number)', j(resolvePaymentSplit({ settings: {} })) === j({ split: null, source: 'not_set' }));
check('invalid profile → not_set', resolvePaymentSplit({ settings: { paymentSplit: S(1, 1, 1) } }).source === 'not_set');
check('resolveWarrantyMonths: absent → null, invalid → null, valid → months',
  resolveWarrantyMonths({}) === null && resolveWarrantyMonths({ warrantyMonths: 0 }) === null && resolveWarrantyMonths({ warrantyMonths: 18 }) === 18);
check('splitLabel', splitLabel(S(25, 65, 10)) === '25 / 65 / 10');

// ═══ (e) MONEY ══════════════════════════════════════════════════════════════
console.log('payment terms — (e) money');
{
  const totals = [0, 0.01, 0.99, 1, 1.01, 99.99, 100.01, 1234.565, 33333.33, 400000, 9999999.99, 1e7];
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 400; i++) totals.push(Math.round(rand() * 1e9) / 100);
  const splits: PaymentSplit[] = [];
  for (let d = 0; d <= 100; d += 5) for (let f = 0; f <= 100 - d; f += 5) splits.push(S(d, 100 - d - f, f));
  splits.push(S(33, 34, 33), S(1, 98, 1), S(7, 81, 12), S(50, 0, 50), S(0, 1, 99));
  let sumBad = '', depBad = '', finBad = '', rowsBad = '', schedBad = '', retieBad = '';
  for (const t of totals) {
    for (const sp of splits) {
      const a = stageAmounts(t, sp);
      const cents = Math.round(a.deposit * 100) + Math.round(a.progress * 100) + Math.round(a.final * 100);
      if (!sumBad && (cents !== Math.round(t * 100) || a.progress < 0 || a.final < 0 || a.deposit < 0)) sumBad = `${t} ${splitLabel(sp)} ${j(a)}`;
      if (!depBad && t > 0 && sp.depositPct > 0 && a.deposit !== milestoneBillableAmount({ percent: sp.depositPct, amount: 0 } as never, t)) depBad = `${t} ${splitLabel(sp)} ${a.deposit}`;
      // Proposal rows only: at 0% progress the printed final carries the
      // remainder, which a percent row could not bill — contracts write that
      // row amount-only (checked on the schedule below, with no exemption).
      if (!finBad && t >= 1 && sp.finalPct > 0 && sp.progressPct > 0 && a.final !== milestoneBillableAmount({ percent: sp.finalPct, amount: 0 } as never, t)) finBad = `${t} ${splitLabel(sp)} ${a.final}`;
      const rows = paymentStageRows(t, sp);
      if (!rowsBad && (rows[0]?.key !== 'deposit'
        || (sp.depositPct === 0 && (rows[0].detail !== PAYMENT_STAGE_COPY.depositNone || rows[0].amount !== 0))
        || rows.some((r) => r.key !== 'deposit' && r.pct === 0))) rowsBad = `${t} ${splitLabel(sp)} ${j(rows)}`;
      if (t > 0) {
        const sched = contractScheduleFromSplit(t, sp, () => 'id');
        const prog = sched.find((m) => m.label === PAYMENT_STAGE_COPY.progress.label);
        const schedCents = sched.reduce((s, m) => s + Math.round((m.amount ?? 0) * 100), 0);
        // Every row billed as a lump (everything but on_invoice) bills EXACTLY
        // the cents it prints, for every split and total — including 0%
        // progress and sub-dollar totals.
        const printedNeqBilled = (rows: PaymentMilestone[], v: number) => rows.find((m) => m.trigger !== 'on_invoice'
          && Math.round((m.amount ?? 0) * 100) !== Math.round(milestoneBillableAmount(m, v) * 100));
        // Billing the lumps one after another never hits the contract ceiling.
        // Only for cent-exact values: a contract value is money typed in cents,
        // and 1234.565 is in the sweep to test stageAmounts' rounding, not a
        // contract anyone can sign.
        const ceilingRefusal = (rows: PaymentMilestone[], v: number) => {
          if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return null;
          let billed = 0;
          for (const m of rows.filter((r) => r.trigger !== 'on_invoice')) {
            const r = milestoneBillability({ milestone: m, contractValue: v, contractStatus: 'signed', linkedInvoiceIds: [], contractBilledToDate: billed } as never);
            if (!r.billable && r.reason !== 'zero_amount') return `${m.label}: ${r.reason}`;
            billed += r.amount;
          }
          return null;
        };
        // percent on every row, except the final when it carries the
        // remainder: always at 0% progress, otherwise only when its printed
        // cents differ from what the percent would bill.
        const pctRule = sched.every((m) => {
          if (m.trigger !== 'on_final') return m.percent != null && m.percent > 0;
          if (sp.progressPct === 0) return m.percent == null;
          const pctBills = milestoneBillableAmount({ percent: sp.finalPct, amount: 0 } as never, t);
          return m.amount === pctBills ? m.percent === sp.finalPct : m.percent == null;
        });
        if (!schedBad && (
          schedCents !== Math.round(t * 100)
          || !pctRule
          || sched.some((m) => m.status !== 'pending')
          || (sp.progressPct > 0 && prog?.trigger !== 'on_invoice')
          || printedNeqBilled(sched, t)
          || ceilingRefusal(sched, t)
        )) schedBad = `${t} ${splitLabel(sp)} ${j(sched)} ${ceilingRefusal(sched, t) ?? ''}`;
        if (!retieBad) {
          const v2 = Math.round(t * 1.37 * 100) / 100;
          const re = retieContractSchedule(v2, sched);
          const reCents = re.reduce((s, m) => s + Math.round((m.amount ?? 0) * 100), 0);
          if (reCents !== Math.round(v2 * 100) || printedNeqBilled(re, v2) || ceilingRefusal(re, v2)) retieBad = `${t}→${v2} ${splitLabel(sp)} ${j(re)}`;
        }
      }
    }
  }
  check('stageAmounts adds up to cents(total), never negative', sumBad === '', sumBad);
  check('deposit == milestoneBillableAmount for a percent row at the same value', depBad === '', depBad);
  check('final == milestoneBillableAmount (progress > 0)', finBad === '', finBad);
  check("deposit row always present; 0% deposit prints 'No deposit' at $0; 0% progress/final omitted", rowsBad === '', rowsBad);
  check('contractScheduleFromSplit foots; percent on every row but a remainder-carrying final; progress is on_invoice; every lump bills what it prints and never trips the ceiling', schedBad === '', schedBad);
  check('retieContractSchedule keeps footing after a value change, and every lump still bills what it prints', retieBad === '', retieBad);
}
{
  // The reviewer's cases, by hand: 0% progress used to bill a cent over the
  // printed final, and after the deposit the final was refused as fully billed.
  const cases: [number, PaymentSplit, number, number][] = [
    [100.01, S(50, 0, 50), 50.01, 50.00],
    [12345.67, S(50, 0, 50), 6172.84, 6172.83],
    [250000.05, S(10, 0, 90), 25000.01, 225000.04],
  ];
  for (const [v, sp, dep, fin] of cases) {
    const sched = contractScheduleFromSplit(v, sp, () => 'id');
    const d = sched.find((m) => m.trigger === 'on_signing');
    const f = sched.find((m) => m.trigger === 'on_final');
    const fBill = f ? milestoneBillability({ milestone: f, contractValue: v, contractStatus: 'signed', linkedInvoiceIds: [], contractBilledToDate: dep } as never) : null;
    check(`$${v} at ${splitLabel(sp)}: deposit bills $${dep}, final prints and bills $${fin}, billable after the deposit`,
      !!d && !!f && d.amount === dep && milestoneBillableAmount(d, v) === dep && f.amount === fin && milestoneBillableAmount(f, v) === fin
      && f.percent == null && !!fBill?.billable, j({ sched, fBill }));
  }
  const re = retieContractSchedule(200.03, contractScheduleFromSplit(100.01, S(50, 0, 50), () => 'id'));
  check('retie re-ties the amount-only final to the balance',
    re.length === 2 && re[0].amount === milestoneBillableAmount(re[0], 200.03) && re[1].percent == null
    && Math.round((re[0].amount ?? 0) * 100) + Math.round((re[1].amount ?? 0) * 100) === 20003, j(re));
  // An all-percent schedule saved before this change (percent on the final
  // too): re-tying gives the final the remainder, so it must drop the percent.
  const legacyPct = retieContractSchedule(100.01, [
    { id: 'a', label: 'Deposit', trigger: 'on_signing', percent: 50, amount: 50, status: 'pending' },
    { id: 'b', label: 'Final payment', trigger: 'on_final', percent: 50, amount: 50, status: 'pending' },
  ]);
  check('retie of an all-percent deposit + final: the remainder final bills exactly what it prints',
    legacyPct[1].percent == null && legacyPct[1].amount === milestoneBillableAmount(legacyPct[1], 100.01)
    && Math.round((legacyPct[0].amount ?? 0) * 100) + Math.round((legacyPct[1].amount ?? 0) * 100) === 10001, j(legacyPct));
  const typedDeposit = retieContractSchedule(1000, [
    { id: 'a', label: 'Deposit', trigger: 'on_signing', amount: 300, status: 'pending' },
    { id: 'b', label: 'Final payment', trigger: 'on_final', amount: 700, status: 'pending' },
  ]);
  check('retie leaves an all-typed schedule untouched', typedDeposit[0].amount === 300 && typedDeposit[1].amount === 700, j(typedDeposit));
}
{
  const fixed: PaymentMilestone[] = [
    { id: 'a', label: 'Deposit', trigger: 'on_signing', amount: 5000, status: 'pending' },
    { id: 'b', label: 'Progress payments', trigger: 'on_invoice', percent: 90, amount: 1, status: 'pending' },
  ];
  const re = retieContractSchedule(100000, fixed);
  check('retie leaves a typed fixed amount untouched', re[0].amount === 5000 && re[1].amount === 90000, j(re));
}
check("proposal lines: 'Due on signing · 25%' and a 0% deposit reads 'No deposit'",
  proposalPaymentLines(400000, S(25, 65, 10))[0].detail === 'Due on signing · 25%'
  && proposalPaymentLines(400000, S(0, 90, 10))[0].detail === 'No deposit'
  && j(proposalPaymentLines(400000, S(25, 65, 10)).map((l) => l.amount)) === j([100000, 260000, 40000]));
check('milestoneDueText for signing / invoice / final',
  milestoneDueText({ trigger: 'on_signing' }) === 'Due on signing'
  && milestoneDueText({ trigger: 'on_invoice' }) === 'Billed as work is completed'
  && milestoneDueText({ trigger: 'on_final' }) === 'Due at substantial completion');
check('acceptanceSentence mentions a deposit only when there is one',
  /deposit received/.test(acceptanceSentence(S(25, 65, 10))) && !/deposit/.test(acceptanceSentence(S(0, 90, 10))) && !/deposit/.test(acceptanceSentence(null)));

// ═══ (f) WARRANTY ═══════════════════════════════════════════════════════════
console.log('payment terms — (f) warranty');
check('warrantyPeriodPhrase examples',
  warrantyPeriodPhrase(12) === 'one (1) year' && warrantyPeriodPhrase(18) === 'eighteen (18) months'
  && warrantyPeriodPhrase(120) === 'ten (10) years' && warrantyPeriodPhrase(24) === 'two (2) years'
  && warrantyPeriodPhrase(1) === 'one (1) month' && warrantyPeriodPhrase(119) === 'one hundred nineteen (119) months',
  [12, 18, 120, 24, 1, 119].map(warrantyPeriodPhrase).join(' | '));
{
  let bad = '';
  for (let m = 1; m <= 120; m++) {
    const phrase = warrantyPeriodPhrase(m);
    const pm = phrase.match(/^[a-z][a-z -]* \((\d+)\) (year|month)(s?)$/);
    const sm = warrantyShortLabel(m).match(/^(\d+) (year|month)(s?)$/);
    const ok = !!pm && !!sm
      && Number(pm[1]) * (pm[2] === 'year' ? 12 : 1) === m
      && Number(sm[1]) * (sm[2] === 'year' ? 12 : 1) === m
      && (pm[3] === 's') === (Number(pm[1]) !== 1)
      && (sm[3] === 's') === (Number(sm[1]) !== 1);
    if (!ok) { bad = `${m}: ${phrase} / ${warrantyShortLabel(m)}`; break; }
  }
  check('phrase and short label are exact for every month 1..120', bad === '', bad);
}
// The literals contractEngine seeded before Direction B, frozen here so the
// legacy detectors keep matching them after contractEngine drops them.
const OLD_WARRANTY = `
The Contractor warrants the workmanship of the project for one (1) year from the date of substantial completion. Defects in workmanship reported in writing during the warranty period will be corrected at no additional cost.

Materials and appliances are covered by their respective manufacturer warranties, which pass through to the Owner. The Contractor will provide warranty documentation in the closeout binder.

This warranty does not cover damage from normal wear and tear, neglect, abuse, modifications by others, or acts of God.
`.trim();
const OLD_SEED: PaymentMilestone[] = [
  { id: '1', label: 'Deposit (signing)', trigger: 'on_signing', amount: 25000, percent: 25, status: 'pending' },
  { id: '2', label: 'Rough-in / framing complete', trigger: 'on_milestone', triggerMilestone: 'Rough-in / framing complete', amount: 25000, percent: 25, status: 'pending' },
  { id: '3', label: 'Finishes complete', trigger: 'on_milestone', triggerMilestone: 'Finishes complete', amount: 25000, percent: 25, status: 'pending' },
  { id: '4', label: 'Substantial completion', trigger: 'on_final', amount: 25000, percent: 25, status: 'pending' },
];
check('LEGACY_WARRANTY_TEXT equals the old paragraph exactly', LEGACY_WARRANTY_TEXT === OLD_WARRANTY);
check('isLegacySeedSchedule matches the old 4×25 seed', isLegacySeedSchedule(OLD_SEED));
check('isLegacySeedSchedule rejects a GC-edited seed and a split schedule',
  !isLegacySeedSchedule(OLD_SEED.map((m, i) => (i === 0 ? { ...m, percent: 30 } : m)))
  && !isLegacySeedSchedule(contractScheduleFromSplit(100000, S(25, 65, 10), () => 'x'))
  && !isLegacySeedSchedule(OLD_SEED.slice(0, 3)));
check('contractWarrantyText(null) prints the visible placeholder', hasWarrantyPlaceholder(contractWarrantyText(null)) && contractWarrantyText(null).includes(WARRANTY_PERIOD_PLACEHOLDER));
check('contractWarrantyText(12) reproduces the old paragraph; 24 says two (2) years',
  contractWarrantyText(12) === OLD_WARRANTY && contractWarrantyText(24).includes('for two (2) years from the date') && !hasWarrantyPlaceholder(contractWarrantyText(24)));
check('workmanshipWarrantyLine: period only from his answer',
  workmanshipWarrantyLine(24) === 'Workmanship warranty (2 years)' && workmanshipWarrantyLine(null) === 'Workmanship warranty' && workmanshipWarrantyLine(0) === 'Workmanship warranty');

// ═══ (g) STAMP ══════════════════════════════════════════════════════════════
console.log('payment terms — (g) stamp');
const NOW = '2026-09-17T12:00:00.000Z';
const OLD_STAMP = { ...S(25, 65, 10), confirmedAt: '2026-09-01T00:00:00.000Z' };
for (const acceptance of ['none', 'accepted', 'unknown'] as const) {
  const r = nextProposalStamp({ existing: undefined, split: S(30, 60, 10), acceptance, nowIso: NOW });
  check(`first stamp allowed when acceptance=${acceptance}`, 'stamp' in r && r.stamp.confirmedAt === NOW && r.stamp.depositPct === 30, j(r));
  const same = nextProposalStamp({ existing: OLD_STAMP, split: S(25, 65, 10), acceptance, nowIso: NOW });
  check(`identical split keeps confirmedAt (acceptance=${acceptance})`, 'stamp' in same && same.stamp.confirmedAt === OLD_STAMP.confirmedAt, j(same));
}
{
  const r = nextProposalStamp({ existing: OLD_STAMP, split: S(30, 60, 10), acceptance: 'none', nowIso: NOW });
  check('replacement allowed when acceptance=none', 'stamp' in r && r.stamp.depositPct === 30 && r.stamp.confirmedAt === NOW, j(r));
  const acc = nextProposalStamp({ existing: OLD_STAMP, split: S(30, 60, 10), acceptance: 'accepted', nowIso: NOW });
  check('replacement REFUSED when accepted, with a reason', 'refused' in acc && acc.refused.includes('25 / 65 / 10'), j(acc));
  const unk = nextProposalStamp({ existing: OLD_STAMP, split: S(30, 60, 10), acceptance: 'unknown', nowIso: NOW });
  check('replacement REFUSED when unknown', 'refused' in unk && unk.refused === ACCEPTANCE_UNKNOWN_REASON, j(unk));
  const inv = nextProposalStamp({ existing: { ...OLD_STAMP, finalPct: 20 }, split: S(30, 60, 10), acceptance: 'accepted', nowIso: NOW });
  check('an invalid existing stamp counts as no stamp (first stamp)', 'stamp' in inv, j(inv));
}
check('acceptanceStateFromRead: PGRST205 / 42P01 / missing-table message → none',
  acceptanceStateFromRead({ data: null, error: { code: 'PGRST205', message: 'x' } }) === 'none'
  && acceptanceStateFromRead({ data: null, error: { code: '42P01', message: 'x' } }) === 'none'
  && acceptanceStateFromRead({ data: null, error: { message: "Could not find the table 'public.proposal_approvals' in the schema cache" } }) === 'none');
check('acceptanceStateFromRead: relation-does-not-exist message without a code → none',
  acceptanceStateFromRead({ data: null, error: { message: 'relation "public.proposal_approvals" does not exist' } }) === 'none');
check('acceptanceStateFromRead: a missing COLUMN or function (table exists) → unknown',
  acceptanceStateFromRead({ data: null, error: { code: '42703', message: 'column proposal_approvals.decision does not exist' } }) === 'unknown'
  && acceptanceStateFromRead({ data: null, error: { code: '42883', message: 'function foo() does not exist' } }) === 'unknown'
  && acceptanceStateFromRead({ data: null, error: { message: 'column proposal_approvals.decision does not exist' } }) === 'unknown');
check('acceptanceStateFromRead: any other error → unknown',
  acceptanceStateFromRead({ data: null, error: { code: '500', message: 'timeout' } }) === 'unknown'
  && acceptanceStateFromRead({ data: [], error: { code: 'PGRST301', message: 'JWT expired' } }) === 'unknown');
check('acceptanceStateFromRead: rows → accepted; none → none',
  acceptanceStateFromRead({ data: [{ decision: 'accepted' }], error: null }) === 'accepted'
  && acceptanceStateFromRead({ data: [], error: null }) === 'none');
check('isValidStamp needs confirmedAt', isValidStamp(OLD_STAMP) && !isValidStamp(S(25, 65, 10)) && !isValidStamp({ ...OLD_STAMP, confirmedAt: '' }));
{
  const portal = { enabled: true, portalId: 'p', proposalApprovalEnabled: true } as never as NonNullable<Project['clientPortal']>;
  const st = (extra: object, profileSplit: PaymentSplit | null, acceptance: 'none' | 'accepted' | 'unknown') =>
    proposalTermsState({ portal: { ...portal, ...extra }, profileSplit, acceptance });
  check('state: off when proposal switched off', st({ proposalApprovalEnabled: false }, S(25, 65, 10), 'none').state === 'off');
  check('state: unconfirmed → use-profile / ask',
    j(st({}, S(25, 65, 10), 'none')) === j({ state: 'unconfirmed', action: 'use-profile', profileSplit: S(25, 65, 10) })
    && j(st({}, null, 'none')) === j({ state: 'unconfirmed', action: 'ask' }));
  check('state: current', st({ proposalPaymentTerms: OLD_STAMP }, S(25, 65, 10), 'none').state === 'current');
  const differs = st({ proposalPaymentTerms: OLD_STAMP }, S(30, 60, 10), 'none');
  check('state: differs → use-current when none', differs.state === 'differs' && differs.action === 'use-current', j(differs));
  const blocked = st({ proposalPaymentTerms: OLD_STAMP }, S(30, 60, 10), 'unknown');
  check('state: differs → blocked when unknown', blocked.state === 'differs' && blocked.action === 'blocked', j(blocked));
  check('state: locked when accepted', st({ proposalPaymentTerms: OLD_STAMP }, S(30, 60, 10), 'accepted').state === 'locked');
}
{
  const mk = (id: string, owner: string, cp: object | undefined) => ({ id, ownerUserId: owner, clientPortal: cp }) as never as Project;
  const on = { enabled: true, portalId: 'p', proposalApprovalEnabled: true };
  const list = portalsNeedingTerms([
    mk('a', U, on), mk('b', U, { ...on, proposalPaymentTerms: OLD_STAMP }), mk('c', 'someone-else', on),
    mk('d', U, { ...on, enabled: false }), mk('e', U, { ...on, proposalApprovalEnabled: false }), mk('f', U, undefined),
    mk('g', U, { ...on, proposalPaymentTerms: { ...OLD_STAMP, finalPct: 50 } }),
  ], U).map((p) => p.id);
  check('portalsNeedingTerms: owned, on, proposal on, no valid stamp', j(list) === j(['a', 'g']), j(list));
}

// ═══ (h) ASK FLOW ═══════════════════════════════════════════════════════════
console.log('payment terms — (h) ask flow');
const blankProfile: AskProfile = {
  branding: { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' },
  location: 'United States',
};
const fullProfile: AskProfile = {
  branding: { ...blankProfile.branding, companyName: 'Ortiz Builders' },
  location: 'United States', paymentSplit: S(25, 65, 10), warrantyMonths: 24,
};
check('order: identity, terms, warranty', j(missingQuestions({ identity: true, terms: true, warranty: true }, blankProfile)) === j(['identity', 'terms', 'warranty']));
check('answered profile asks nothing', j(missingQuestions({ identity: true, terms: true, warranty: true }, fullProfile)) === j([]));
check('a valid job record answers terms; an invalid one does not',
  j(missingQuestions({ terms: true, record: S(10, 80, 10) }, blankProfile)) === j([])
  && j(missingQuestions({ terms: true, record: S(10, 80, 20) }, blankProfile)) === j(['terms']));
check('identity only when the bid gate blocks', j(missingQuestions({ identity: true }, { ...blankProfile, branding: fullProfile.branding })) === j([]));
{
  const titles = (['identity', 'terms', 'warranty'] as const).map((qq, i) => askStepCopy(qq, 'contract', { stepIndex: i, stepCount: 3, justThisJob: true }));
  check('one question per step: distinct titles, step labels 1..3 of 3',
    new Set(titles.map((t) => t.title)).size === 3 && j(titles.map((t) => t.stepLabel)) === j(['1 of 3', '2 of 3', '3 of 3']));
  check('identity button reads Next until the last step', titles[0].primaryLabel === 'Next'
    && askStepCopy('identity', 'proposal_pdf', { stepIndex: 0, stepCount: 1 }).primaryLabel === 'Save and send');
  check("contract offers 'Just this contract' / 'Just this proposal'", titles[1].secondaryLabel === 'Just this contract'
    && askStepCopy('terms', 'contract', { stepIndex: 0, stepCount: 1, justThisJob: true, documentNoun: 'proposal' }).secondaryLabel === 'Just this proposal');
  // A proposal-kind contract row must not explain itself as a construction
  // agreement over a "Just this proposal" button.
  {
    const prop = askStepCopy('terms', 'contract', { stepIndex: 0, stepCount: 1, justThisJob: true, documentNoun: 'proposal' }).reason;
    const con = askStepCopy('terms', 'contract', { stepIndex: 0, stepCount: 1, justThisJob: true, documentNoun: 'contract' }).reason;
    check('the contract-purpose terms reason follows the document noun',
      /proposal/i.test(prop) && !/construction agreement/i.test(prop) && /construction agreement/i.test(con));
  }
  check('portal / edit never offer a per-job answer',
    !askStepCopy('terms', 'portal_proposal', { stepIndex: 0, stepCount: 1 }).secondaryLabel
    && !askStepCopy('terms', 'edit', { stepIndex: 0, stepCount: 1, justThisJob: true }).secondaryLabel
    && askStepCopy('terms', 'edit', { stepIndex: 0, stepCount: 1 }).primaryLabel === 'Save');
}
check(`terms title is exactly '${ASK_TERMS_TITLE}'`, ASK_TERMS_TITLE === 'What deposit do you take?'
  && (['proposal_pdf', 'proposal_link', 'portal_proposal', 'contract', 'edit'] as const).every((p) => askStepCopy('terms', p, { stepIndex: 0, stepCount: 1 }).title === 'What deposit do you take?'));
{
  const texts = [...Object.values(TERMS_REASON), ...Object.values(WARRANTY_REASON), TERMS_FOOTNOTE, WARRANTY_FOOTNOTE];
  const bad = texts.filter((t) => /used to|would otherwise|\d\s*%|\bpercent\b/i.test(t));
  check("no reason says 'used to', 'would otherwise', or quotes a percent", bad.length === 0, bad.join(' | '));
  check('every purpose has a non-empty reason', (['proposal_pdf', 'proposal_link', 'portal_proposal', 'contract', 'edit'] as const).every((p) => TERMS_REASON[p].length > 0));
}
{
  let longest = '';
  let founderWrong = '';
  const splits: PaymentSplit[] = [];
  for (let d = 0; d <= 100; d++) for (let f = 0; f <= 100 - d; f++) splits.push(S(d, 100 - d - f, f));
  const consider = (s: string) => { if (s.length > longest.length) longest = s; };
  for (const noun of ['contract', 'proposal'] as const) {
    for (const scope of ['profile', 'this_job'] as const) {
      consider(confirmationFor({ question: 'identity', scope, firstTime: true, unconfirmedPortalCount: 0, documentNoun: noun }));
      for (const firstTime of [true, false]) {
        for (const count of [0, 1, 7]) {
          for (const sp of splits) {
            const s = confirmationFor({ question: 'terms', scope, firstTime, split: sp, unconfirmedPortalCount: count, documentNoun: noun });
            consider(s);
            const founder = /now all say/.test(s);
            if (founder !== (scope === 'profile' && firstTime && count === 0)) founderWrong = `${s} (count ${count}, first ${firstTime}, ${scope})`;
          }
          for (let m = 1; m <= 120; m++) consider(confirmationFor({ question: 'warranty', scope, firstTime, months: m, unconfirmedPortalCount: count, documentNoun: noun }));
        }
      }
    }
  }
  check(`every confirmation fits the ${TOAST_MAX}-character toast`, longest.length <= TOAST_MAX, `${longest.length}: ${longest}`);
  // A whole sheet (terms + warranty, the contract flow).
  let sheetLongest = '';
  let sheetWrong = '';
  const sheetSplits = [S(25, 65, 10), S(33, 34, 33), S(100, 0, 0), S(0, 100, 0)];
  for (const noun of ['contract', 'proposal'] as const) {
    for (const tScope of ['profile', 'this_job'] as const) {
      for (const wScope of ['profile', 'this_job'] as const) {
        for (const tFirst of [true, false]) {
          for (const wFirst of [true, false]) {
            for (const count of [0, 3]) {
              for (const sp of sheetSplits) {
                for (let m = 1; m <= 120; m++) {
                  const msg = confirmationForSheet({
                    terms: { scope: tScope, firstTime: tFirst, split: sp, unconfirmedPortalCount: count },
                    warranty: { scope: wScope, firstTime: wFirst, months: m },
                  }, noun);
                  if (msg.length > sheetLongest.length) sheetLongest = msg;
                  const both = tScope === 'this_job' && wScope === 'this_job';
                  const saysOnly = /only/.test(msg);
                  const namesWarranty = /warranty/i.test(msg);
                  const namesSplit = msg.includes(splitLabel(sp));
                  // Truth: "only" appears iff something was this_job; a saved
                  // warranty is named; a saved split is named; a changed answer
                  // (not first time) says sent ones keep theirs when both saved.
                  if (saysOnly !== (tScope === 'this_job' || wScope === 'this_job')
                    || (wScope === 'profile' && !namesWarranty)
                    || (tScope === 'profile' && !namesSplit)
                    || (!both && tScope === 'profile' && wScope === 'profile' && (!tFirst || !wFirst) && !/sent ones keep theirs/.test(msg))
                    || (tScope === 'profile' && wScope === 'profile' && /now all say/.test(msg))) {
                    sheetWrong = `${msg} (terms ${tScope}/${tFirst}, warranty ${wScope}/${wFirst})`;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  check(`every whole-sheet confirmation fits the ${TOAST_MAX}-character toast`, sheetLongest.length <= TOAST_MAX, `${sheetLongest.length}: ${sheetLongest}`);
  check('a whole-sheet toast names what was saved and says "only" exactly when something was per-job', sheetWrong === '', sheetWrong);
  const single = confirmationForSheet({ terms: { scope: 'profile', firstTime: true, split: S(25, 65, 10), unconfirmedPortalCount: 0 } }, 'contract');
  check('one answered question reads exactly as confirmationFor (founder copy on a first answer)',
    single === confirmationFor({ question: 'terms', scope: 'profile', firstTime: true, split: S(25, 65, 10), unconfirmedPortalCount: 0, documentNoun: 'contract' })
    && /now all say 25 \/ 65 \/ 10/.test(single)
    && confirmationForSheet({ warranty: { scope: 'profile', firstTime: true, months: 24 } }, 'contract') === 'Saved — new contracts warrant your work for 2 years'
    && confirmationForSheet({ identity: true }, 'proposal') === 'Saved to your company profile', single);
  check("the founder's 'now all say' toast only when no portal is left without terms", founderWrong === '', founderWrong);
}
{
  const st = { stepIndex: 0, stepCount: 2, profile: blankProfile, answers: {} };
  const thisJob = submitAskStep(st, { question: 'terms', deposit: '25', progress: '65', final: '10', scope: 'this_job' });
  check('this_job answer carries no save effect', 'effects' in thisJob && thisJob.effects.length === 0 && !thisJob.done, j(thisJob));
  const prof = submitAskStep({ ...st, stepIndex: 1 }, { question: 'terms', deposit: '25', progress: '65', final: '10', scope: 'profile' });
  check('profile answer saves terms and finishes on the last step', 'effects' in prof && j(prof.effects) === j(['save_terms']) && prof.done, j(prof));
  const hint = submitAskStep(st, { question: 'terms', deposit: '25', progress: '55', final: '10', scope: 'profile' });
  check('an invalid split is a hint, never a save', 'hint' in hint && hint.hint.startsWith('Adds up to 90%'), j(hint));
  const idHint = submitAskStep(st, { question: 'identity', companyName: '  ', licenseNumber: '' });
  check('identity still blank → the gate reason as hint', 'hint' in idHint && idHint.hint.length > 0, j(idHint));
  const w = submitAskStep({ ...st, stepIndex: 1 }, { question: 'warranty', months: '24', scope: 'this_job' });
  check('warranty this_job has no save effect', 'effects' in w && w.effects.length === 0 && w.answers.warrantyMonths === 24, j(w));
}
check('live line: dollars on this job', termsLiveLine({ deposit: '25', progress: '65', final: '10' }, 400000).text
  === 'On this $400,000 job: $100,000 deposit · $260,000 progress · $40,000 final');
check('live line: silent while all three are empty', termsLiveLine({ deposit: '', progress: '', final: '' }, 400000).kind === 'empty');
// California down-payment note (founder decision 2026-09-17: a note, never a block).
{
  const ca = DEPOSIT_CAP_RULES.find((r) => r.state === 'CA');
  check('CA rule is dated 2026-09-17 with its statute URL and citation',
    !!ca && ca.checkedOn === '2026-09-17'
    && ca.sourceUrl === 'https://california.public.law/codes/business_and_professions_code_section_7159.5'
    && /7159\.5\(a\)\(3\)/.test(ca.citation) && ca.capDollars === 1000 && ca.capPercent === 10);
  const b = blankProfile.branding;
  const licCA = { ...b, licenseState: 'CA' };
  check('note when the licensing state is CA (no job)', !!depositCapNote({ branding: licCA, location: 'United States' }));
  check('note from the address when no licence state', !!depositCapNote({ branding: { ...b, address: '12 Oak St, Pasadena, CA 91101' }, location: 'United States' }));
  check('note from the market when neither', !!depositCapNote({ branding: b, location: 'Los Angeles, CA' }));
  check('an explicit AZ licence outranks a CA address', depositCapNote({ branding: { ...b, licenseState: 'AZ', address: '12 Oak St, Pasadena, CA 91101' }, location: 'Los Angeles, CA' }) === null);
  check('no note outside CA', depositCapNote({ branding: { ...b, licenseState: 'TX' }, location: 'United States' }) === null);
  check('no note on a commercial job', depositCapNote({ branding: licCA, location: '', projectType: 'commercial', total: 400000 }) === null);
  check('residential job names its dollar cap: $1,000 on $400,000; $500 on $5,000',
    /\$1,000 or 10%/.test(depositCapNote({ branding: licCA, location: '', projectType: 'remodel', total: 400000 })?.text ?? '')
    && /On this \$400,000 job that is \$1,000\./.test(depositCapNote({ branding: licCA, location: '', projectType: 'remodel', total: 400000 })?.text ?? '')
    && /On this \$5,000 job that is \$500\./.test(depositCapNote({ branding: licCA, location: '', total: 5000 })?.text ?? ''));
  check('without a total the note states the rule, no job amount', !/On this/.test(depositCapNote({ branding: licCA, location: '' })?.text ?? 'On this'));
}

// ═══ (i) PROJECTCONTEXT STRUCTURE ═══════════════════════════════════════════
console.log('payment terms — (i) ProjectContext structure');
const ctx = stripComments(readFileSync(CONTEXT, 'utf8'));
const termColRe = /\b(deposit_pct|progress_pct|final_pct|warranty_months)\b/;
const saveMutDecl = ctx.indexOf('const saveSettingsMutation = useMutation(');
const saveMut = saveMutDecl >= 0 ? balanced(ctx, saveMutDecl, '(', ')') : '';
check('saveSettingsMutation found', saveMut.length > 0);
check('the whole-row settings save never sends a terms column', saveMut.length > 0 && !termColRe.test(saveMut), saveMut.match(termColRe)?.[0]);
check('saveSettingsMutation saves the device copy from settingsRef.current', /saveLocal\(SETTINGS_KEY,\s*settingsRef\.current\)/.test(saveMut));
check('saveSettingsMutation onSuccess caches settingsRef.current', /setQueryData\(\['settings',\s*userId\],\s*settingsRef\.current\)/.test(saveMut)
  || /const latest = settingsRef\.current;[\s\S]{0,120}setQueryData\(\['settings',\s*userId\],\s*latest\)/.test(saveMut));

const savePT = arrowBody(ctx, 'savePaymentTerms');
check('savePaymentTerms found', savePT.length > 0);
check('savePaymentTerms validates through termsColumnsForWrite and refuses before writing',
  /termsColumnsForWrite\(input\)/.test(savePT) && savePT.indexOf("'refused' in cols") >= 0
  && savePT.indexOf("'refused' in cols") < savePT.indexOf('supabaseWrite('));
{
  const writes = [...savePT.matchAll(/supabaseWrite\(\s*'profiles'\s*,\s*'update'\s*,\s*/g)].map((m) => balanced(savePT, (m.index ?? 0) + m[0].length));
  const keysOf = (lit: string) => [...lit.slice(1, -1).split(',')].map((kv) => kv.split(':')[0].trim()).filter(Boolean).sort();
  const shapes = writes.map(keysOf).map((k) => k.join(','));
  check('savePaymentTerms issues exactly two profiles updates: id+split columns, id+warranty_months',
    writes.length === 2
    && shapes.includes(['deposit_pct', 'final_pct', 'id', 'progress_pct'].join(','))
    && shapes.includes(['id', 'warranty_months'].join(',')), j(shapes));
  check('savePaymentTerms writes carry no spread (nothing else can ride along)', writes.every((w) => !w.includes('...')), j(writes));
}
check('savePaymentTerms merges onto settingsRef.current and commits', /\.\.\.settingsRef\.current/.test(savePT) && /commitSettingsState\(next\)/.test(savePT));

const loader = balanced(ctx, ctx.indexOf('const settingsQuery = useQuery('), '(', ')');
// Integration round 3 (wave 4): the queue, THEN this session's Not-saved
// profile lines (a refused terms save is still his answer).
check('the settings loader calls termsWritesPending(getOfflineQueue() + Not-saved profile lines) and spreads paymentTermsAfterLoad',
  /const termsQueue = await getOfflineQueue\(\);\s*const termsPending = pendingWithInFlight\(termsWritesPending\(\[\.\.\.termsQueue, \.\.\.await unsavedAsQueueEntries\('profiles'\)\], userId\)/.test(loader) && /\.\.\.paymentTermsAfterLoad\(/.test(loader)
  && /loadLocal<AppSettings \| null>\(SETTINGS_KEY/.test(loader));
// supabaseWrite tries the network before it queues, so the queue alone cannot
// see a terms write that is still out: a refetch in that window would let the
// pre-answer row win and ask him again.
check('the loader also counts a terms write in flight at read start / at return, or started during the read',
  /const termsEpochAtRead = termsWriteEpochRef\.current;\s*const termsInFlightAtRead = termsWritesInFlightRef\.current;(?:\s*const \w+ = settings\w+Ref\.current;){0,2}\s*const \{ data, error \} = await supabase\.from\('profiles'\)/.test(loader)
  && /const termsInFlight = termsInFlightAtRead > 0\s*\|\| termsWritesInFlightRef\.current > 0\s*\|\| termsWriteEpochRef\.current !== termsEpochAtRead;/.test(loader)
  && /const termsPending = pendingWithInFlight\(termsWritesPending\(\[\.\.\.termsQueue, \.\.\.await unsavedAsQueueEntries\('profiles'\)\], userId\), termsInFlight\);/.test(loader));
// The previous shape `termsWritesPending(...) || inFlight` type-checked and
// never read inFlight (an object is always truthy). Forbid any `||` fold onto
// the pending object, and pin the helper's BEHAVIOUR, not just its call site.
check('the loader never folds in-flight onto the pending object with ||',
  !/termsWritesPending\([^;]*\)\s*\|\|/.test(loader) && !/pendingWithInFlight\([^;]*\)\s*\|\|/.test(loader));
check('empty queue + a write in flight → both groups pending',
  j(pendingWithInFlight(termsWritesPending([], U), true)) === j({ split: true, warranty: true }));
check('empty queue + nothing in flight → nothing pending (the server answer can win)',
  j(pendingWithInFlight(termsWritesPending([], U), false)) === j({ split: false, warranty: false }));
check('queued split + nothing in flight → split only',
  j(pendingWithInFlight({ split: true, warranty: false }, false)) === j({ split: true, warranty: false }));
{
  // End to end through paymentTermsAfterLoad: the race the reviewer described.
  const cached = { paymentSplit: { depositPct: 25, progressPct: 65, finalPct: 10 }, warrantyMonths: 24 };
  const staleRow = { deposit_pct: null, progress_pct: null, final_pct: null, warranty_months: null };
  const kept = paymentTermsAfterLoad({ row: staleRow, cached, pending: pendingWithInFlight(termsWritesPending([], U), true) });
  check('a refetch returning the pre-answer row while the write is in flight keeps his answer',
    j(kept) === j(cached), j(kept));
}
check('savePaymentTerms tracks both writes (epoch + in-flight, released when the write settles)',
  // …and, as it settles, runs the re-read a raced load owed (review round 2
  // of the settings-load lane — a terms-only race never ran it before).
  /termsWriteEpochRef\.current \+= 1;\s*termsWritesInFlightRef\.current \+= 1;\s*void write\.finally\(\(\) => \{\s*termsWritesInFlightRef\.current -= 1;\s*void runOwedSettingsReread\(writeUserId\);\s*\}\);/.test(savePT)
  && (savePT.match(/track\(supabaseWrite\(/g) ?? []).length === 2 && !/void supabaseWrite\(/.test(savePT));
const defaults = balanced(ctx, ctx.indexOf('const DEFAULT_SETTINGS'));
check('DEFAULT_SETTINGS has neither paymentSplit nor warrantyMonths', defaults.length > 0 && !/paymentSplit|warrantyMonths/.test(defaults));
const upd = arrowBody(ctx, 'updateSettings');
check('updateSettings merges onto settingsRef.current', /\{\s*\.\.\.settingsRef\.current,\s*\.\.\.updates\s*\}/.test(upd) && !/\.\.\.settings\b(?!Ref)/.test(upd));
check('setSettings is called only inside commitSettingsState', (ctx.match(/\bsetSettings\(/g) ?? []).length === 1
  && /const commitSettingsState = useCallback\(\(next: AppSettings\) => \{\s*settingsRef\.current = next;\s*setSettings\(next\);/.test(ctx));
check('savePaymentTerms is on CoreDataValue and in the coreData memo (value + deps)',
  /savePaymentTerms: \(input: \{ split\?: PaymentSplit; warrantyMonths\?: number \}\) => boolean;/.test(ctx)
  && (balanced(ctx, ctx.indexOf('const coreData = useMemo<CoreDataValue>('), '(', ')').match(/\bsavePaymentTerms\b/g) ?? []).length === 2);

// ═══ (j) HOOK AND SHEET STRUCTURE ═══════════════════════════════════════════
console.log('payment terms — (j) hook and sheet structure');
const hook = stripComments(readFileSync(HOOK, 'utf8'));
const submit = arrowBody(hook, 'submit');
check('submit handler found and not async', submit.length > 0 && !/const submit = useCallback\(\s*async/.test(hook));
{
  const latchAt = submit.indexOf('latchRef.current = ask.stepIndex;');
  const thenAt = submit.indexOf('then(answersFrom(');
  const between = latchAt >= 0 && thenAt > latchAt ? submit.slice(latchAt, thenAt) : '';
  check('latch set on the step being pressed, before any save, then then(answers) in the same press',
    latchAt >= 0 && thenAt > latchAt
    && latchAt < submit.indexOf('updateSettings(') && latchAt < submit.indexOf('savePaymentTerms(')
    && submit.indexOf("if ('hint' in res) { setHint(res.hint); return; }") < latchAt);
  check('nothing async between the latch and then(…) — no await / setTimeout / InteractionManager / requestAnimationFrame / Promise',
    between.length > 0 && !/\bawait\b|setTimeout|InteractionManager|requestAnimationFrame|\.then\(|Promise/.test(between), between.slice(0, 200));
  check('no await anywhere in the submit handler', !/\bawait\b/.test(submit));
  check('a second press on the SAME step is a no-op (latch checked first) — intermediate steps included',
    /^\s*\(scope: AskScope\) => \{\s*if \(!ask \|\| latchRef\.current === ask\.stepIndex\) return;/.test(submit)
      || /^\{\s*if \(!ask \|\| latchRef\.current === ask\.stepIndex\) return;/.test(submit), submit.slice(0, 120));
  // A refused save must release the latch, or he could never press again.
  const failReturns = [...submit.matchAll(/if \(!savePaymentTerms\([^)]*\)\)\s*\{([\s\S]*?)return;/g)].map((m) => m[1]);
  check('a refused save releases the latch before returning', failReturns.length === 2 && failReturns.every((b) => /latchRef\.current = null;/.test(b)), j(failReturns));
  // Toast facts come from the step that answered, not the settings closure
  // at the last press.
  const lastBlock = submit.slice(submit.indexOf('if (!res.done)'));
  check('each step records its own toast facts (scope, first time, portal count) before advancing',
    /factsRef\.current = \{ \.\.\.factsRef\.current, terms: \{ scope, firstTime: !hadSplit, split: res\.answers\.split, unconfirmedPortalCount \} \}/.test(submit)
    && /factsRef\.current = \{ \.\.\.factsRef\.current, warranty: \{ scope, firstTime: !hadWarranty, months: res\.answers\.warrantyMonths \} \}/.test(submit)
    && submit.indexOf('factsRef.current = { ...factsRef.current, terms') < submit.indexOf('if (!res.done)'));
  check('the last-press toast is built from the step facts only — no hadSplit / hadWarranty / settings / confirmationFor( there',
    /nailIt\(confirmationForSheet\(facts, noun\)\)/.test(lastBlock)
    && !/hadSplit|hadWarranty|settings\.|confirmationFor\(|unconfirmedPortalCount/.test(lastBlock), lastBlock.slice(0, 300));
}
{
  const saveTermsBranch = submit.slice(submit.indexOf("effect === 'save_terms'"), submit.indexOf("effect === 'save_warranty'"));
  check('the terms save only happens inside the save_terms effect branch', (submit.match(/savePaymentTerms\(/g) ?? []).length === 2 && /savePaymentTerms\(\{ split:/.test(saveTermsBranch));
  check('first answer stamps owned portals via nextProposalStamp + updateProject (no network read)',
    /if \(!hadSplit\)/.test(saveTermsBranch) && /portalsNeedingTerms\(projects, userId\)/.test(saveTermsBranch)
    && /nextProposalStamp\(/.test(saveTermsBranch) && /updateProject\(p\.id, \{ clientPortal: \{ \.\.\.p\.clientPortal, proposalPaymentTerms: next\.stamp \} \}\)/.test(saveTermsBranch)
    && !/fetchProposalAcceptanceState|await/.test(saveTermsBranch));
}
const dismissBody = arrowBody(hook, 'dismiss');
check('dismiss nulls the parked callback', /thenRef\.current = null/.test(dismissBody));
const runBody = arrowBody(hook, 'run');
check('run: nothing missing → then() synchronously, returns ran', /if \(questions\.length === 0\) \{\s*then\(/.test(runBody) && /return 'ran'/.test(runBody) && !/\bawait\b/.test(runBody));
{
  const calls = [...hook.matchAll(/bidIdentityGap\(([^;]*?)\)/g)].map((m) => m[1]);
  check('every bidIdentityGap call in the hook passes settings.location',
    calls.length > 0 && calls.every((a) => /,\s*settings\.location\s*$/.test(a)), calls.join(' | '));
  const askSrc = stripComments(readFileSync(ASK, 'utf8'));
  const askCalls = [...askSrc.matchAll(/bidIdentityGap\(([^;]*?)\)/g)].map((m) => m[1]);
  check('every bidIdentityGap call in clientDocumentAsk passes the profile location',
    askCalls.length > 0 && askCalls.every((a) => /,\s*(state\.)?profile\.location\s*$/.test(a)), askCalls.join(' | '));
}
const sheet = stripComments(readFileSync(SHEET, 'utf8'));
{
  const lic = sheet.indexOf('testID="ask-identity-licence"');
  const branch = sheet.lastIndexOf('identityGap?.rule ?', lic);
  const closeBetween = branch >= 0 ? sheet.slice(branch, lic) : '';
  check('the licence field sits inside the licence-rule branch', lic > 0 && branch > 0 && !/\)\s*:\s*null\s*\}/.test(closeBetween));
  check('the sheet is dismissible (onRequestClose + close button)', /onRequestClose=\{onClose\}/.test(sheet) && /onPress=\{onClose\}[\s\S]{0,300}testID="ask-close"/.test(sheet));
  check('the sheet renders the reason', /testID="ask-reason">\{copy\.reason\}/.test(sheet));
  {
    // iOS: a continuation that presents native UI must wait for the slide-out.
    const runArgs = balanced(hook, hook.indexOf('const run = useCallback('), '(', ')');
    const dismissArgs = balanced(hook, hook.indexOf('const dismiss = useCallback('), '(', ')');
    const lastPress = submit.slice(submit.indexOf('const then = thenRef.current;'));
    check('run takes opts.afterDismiss: runs it at once when no sheet opens, else holds it',
      /opts\?: \{ afterDismiss\?: \(\) => void \}/.test(runArgs)
      && /then\(answersFrom\(needs, \{\}\) as AnswersFor<N>\);\s*opts\?\.afterDismiss\?\.\(\);\s*return 'ran';/.test(runArgs)
      && /afterDismissRef\.current = opts\?\.afterDismiss \?\? null;/.test(runArgs), runArgs.slice(0, 200));
    check('dismiss drops afterDismiss along with then', /thenRef\.current = null;\s*afterDismissRef\.current = null;/.test(dismissArgs));
    check('the last press runs afterDismiss after then: deferred to onDismiss on iOS, immediately elsewhere',
      /if \(then\) then\(answersFrom\(needs, res\.answers\)\);\s*if \(afterDismiss\) \{\s*if \(Platform\.OS === 'ios'\) pendingDismissRef\.current = afterDismiss;\s*else afterDismiss\(\);\s*\}/.test(lastPress));
    check('the sheet props carry onDismiss, which runs the pending continuation once',
      /onClose: dismiss,\s*onDismiss,/.test(hook)
      && /const onDismiss = useCallback\(\(\) => \{\s*const next = pendingDismissRef\.current;\s*pendingDismissRef\.current = null;\s*if \(next\) next\(\);/.test(hook));
  }
  check('the Modal stays mounted and closes through visible (no early return null), forwarding onDismiss',
    /<Modal visible=\{live\}[^>]*onDismiss=\{props\.onDismiss\}/.test(sheet) && !/return null;/.test(sheet.slice(0, sheet.indexOf('<Modal'))));
  for (const id of ['ask-step-title', 'ask-hint', 'ask-identity-company', 'ask-terms-deposit', 'ask-terms-progress', 'ask-terms-final', 'ask-terms-dollars', 'ask-warranty-months', 'ask-primary', 'ask-secondary', 'ask-close']) {
    check(`testID ${id}`, sheet.includes(`"${id}"`));
  }
  const placeholders = [...sheet.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]);
  check('no placeholder carries a digit (percent and month fields start empty)', placeholders.every((p) => !/\d/.test(p)), j(placeholders));
  check('KeyboardAvoidingView pads on iOS', /behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/.test(sheet));
  check('built from @/components/ui Button and Card', /import \{ Button, Card \} from '@\/components\/ui'/.test(sheet));
  check("no fontWeight '800'", !/fontWeight:\s*'800'/.test(sheet));
}

// ── (k) the first-answer auto-stamp keeps every portal's stamp on the device ──
// The hook stamps each old portal with updateProject in a loop, in one press.
// updateProject used to derive its list from the render-time `projects`, so
// every call started from the same list and only the last project kept its
// stamp locally (the server was right, the phone was not).
{
  console.log('\n(k) repeated updateProject calls in one press compose');
  const ctx = stripComments(readFileSync(join(ROOT, 'contexts/ProjectContext.tsx'), 'utf8'));
  const at = ctx.indexOf('const updateProject = useCallback(');
  const body = at >= 0 ? balanced(ctx, ctx.indexOf('{', at)) : '';
  check('updateProject starts from projectsRef.current', /const base = projectsRef\.current;/.test(body) && /base\.map\(/.test(body));
  check('…commits projectsRef.current before setProjects', /projectsRef\.current = updated;\s*setProjects\(updated\)/.test(body));
  check('…never maps the render-time `projects`', !/\bprojects\.map\(/.test(body) && !/\bprojects\.find\(/.test(body));
  check('projectsRef follows state', /useEffect\(\(\) => \{ projectsRef\.current = projects; \}, \[projects\]\);/.test(ctx));
  const hook = stripComments(readFileSync(join(ROOT, 'hooks/useClientDocumentGate.ts'), 'utf8'));
  check('the auto-stamp still goes through updateProject (so the ref fix covers it)', /for \(const p of needing\)[\s\S]{0,400}updateProject\(p\.id/.test(hook));
}

// (k) Nothing asks or writes before the profile has loaded — and "loaded" means
// a server row or a real device copy, never the DEFAULT a failed read fell back
// to (post-ship finding 13; the rest is in validate-settings-load-guard.ts).
// Settings start as
// DEFAULT_SETTINGS and the profiles read waits on the network; a gate pressed
// in that window re-asked a GC who had already answered, savePaymentTerms
// saved DEFAULT branding into the device cache, and the identity step's
// updateSettings sent DEFAULT contact/address/licence over his profiles row.
console.log('payment terms — (k) no ask / no write before settings load');
{
  const ctx = stripComments(readFileSync(join(ROOT, 'contexts/ProjectContext.tsx'), 'utf8'));
  const hook = stripComments(readFileSync(join(ROOT, 'hooks/useClientDocumentGate.ts'), 'utf8'));
  const runAt = hook.indexOf('const run = useCallback(');
  const runSrc = hook.slice(runAt, hook.indexOf('const edit = useCallback(', runAt));
  check('run refuses with a visible reason before settings load — ahead of missingQuestions',
    /if \(!settingsLoaded\) \{\s*refuseUntilLoaded\(\);\s*return 'waiting';\s*\}/.test(runSrc)
      && runSrc.indexOf('!settingsLoaded') < runSrc.indexOf('missingQuestions('), runSrc.slice(0, 400));
  const editAt = hook.indexOf('const edit = useCallback(');
  const editSrc = hook.slice(editAt, hook.indexOf('const dismiss = useCallback(', editAt));
  check('edit refuses the same way before pre-filling from settings',
    /if \(!settingsLoaded\) \{\s*refuseUntilLoaded\(\);\s*return;\s*\}/.test(editSrc)
      && editSrc.indexOf('!settingsLoaded') < editSrc.indexOf('resolvePaymentSplit('));
  // Finding 105: the refusal is a way out, not a dead end — it names a failed
  // read as a failure and always offers Retry (the only thing on native that
  // re-reads settings).
  const refuseAt = hook.indexOf('const refuseUntilLoaded = useCallback(');
  const refuseSrc = refuseAt >= 0 ? balanced(hook, refuseAt, '(', ')') : '';
  check('the refusal picks its copy from profileGateNotice (failed read / unreachable vs loading) and offers Retry → retryRemoteReads',
    /profileGateNotice\(\{ failed: settingsLoadFailed \|\| sourceFailed \}\)/.test(refuseSrc)
      && /\{ text: 'Retry', onPress: retryRemoteReads \}/.test(refuseSrc)
      && /showAlert\(notice\.title, notice\.message,/.test(refuseSrc), refuseSrc.slice(0, 300));
  check('the hook reads settingsLoaded / settingsLoadFailed / retryRemoteReads from useCoreData',
    /const \{ settings, settingsLoaded, settingsLoadFailed, sourceFailed, retryRemoteReads,[^}]*\} = useCoreData\(\);/.test(hook));
  check('CoreData exposes settingsLoaded, keyed to this account',
    /const settingsLoaded = settingsLoadedFor === settingsOwnerKey;/.test(ctx) && /\n\s*settingsLoaded,\n/.test(ctx));
  // Finding 13: the data effect used to mark ANY query data loaded — including
  // the DEFAULT_SETTINGS a failed read fell back to. It now marks only a
  // result the loader built and tagged (a row, a real device copy, DEFAULT for
  // a local-only session — never for "no row", which is an anon-key read), and the loader never resolves a
  // failed read with DEFAULT (validate-settings-load-guard executes that rule).
  check('the data effect marks loaded only on a result the loader tagged; the device copy marks it too',
    /const builtAt = settingsDataSeqRef\.current\.get\(data\);\s*if \(builtAt === undefined\) return;[\s\S]{0,200}commitSettingsState\(data\);\s*\}\s*markSettingsLoaded\(settingsOwnerKey\);/.test(ctx)
      && /if \(cancelled \|\| !cached \|\| settingsLoadedForRef\.current === key\) return;\s*commitSettingsState\(\{ \.\.\.DEFAULT_SETTINGS, \.\.\.cached \}\);\s*markSettingsLoaded\(key\);/.test(ctx));
  const loaderSrc = balanced(ctx, ctx.indexOf('const settingsQuery = useQuery('), '(', ')');
  check('a failed profiles read never resolves with DEFAULT_SETTINGS (it goes through settingsReadFallback, which throws)',
    !/loadLocal<AppSettings>\(SETTINGS_KEY,\s*DEFAULT_SETTINGS\)/.test(loaderSrc)
      && /const fallback = settingsReadFallback\(\{/.test(loaderSrc)
      && /if \('fail' in fallback\) \{[\s\S]*?throw new Error\(fallback\.fail\);/.test(loaderSrc));
  const ptAt = ctx.indexOf('const savePaymentTerms = useCallback(');
  const ptSrc = ctx.slice(ptAt, ctx.indexOf('const addCollaborator', ptAt));
  check('savePaymentTerms refuses before the load, before it builds or saves `next`',
    /if \(settingsLoadedForRef\.current !== settingsOwnerKey\) return false;/.test(ptSrc)
      && ptSrc.indexOf('settingsLoadedForRef.current !== settingsOwnerKey') < ptSrc.indexOf('saveLocal(SETTINGS_KEY'));
  const usAt = ctx.indexOf('const updateSettings = useCallback(');
  const usSrc = ctx.slice(usAt, ctx.indexOf('const savePaymentTerms = useCallback(', usAt));
  // Finding 14: the held change is only the fields he changed, merged one
  // level deep — never a DEFAULT-based `branding` snapshot replacing his row's.
  check('updateSettings holds a pre-load change (only what it changes) instead of writing a DEFAULT-based row',
    /if \(settingsLoadedForRef\.current !== settingsOwnerKey\) \{\s*const held = heldSettingsPatch\(settingsRef\.current, updates\);\s*pendingSettingsUpdatesRef\.current = mergeHeldPatches\(pendingSettingsUpdatesRef\.current, held\);[\s\S]{0,120}return;\s*\}/.test(usSrc)
      && usSrc.indexOf('pendingSettingsUpdatesRef') < usSrc.indexOf('saveSettingsMutation.mutate(updated)'));
  check('…and writes it merged (one level deep) onto the loaded row once it lands',
    /if \(!settingsLoaded \|\| !pending\) return;[\s\S]{0,120}const merged = applyHeldSettings\(settingsRef\.current, pending\);\s*commitSettingsState\(merged\);\s*settingsWriteSeqRef\.current \+= 1;\s*settingsRowWritesInFlightRef\.current \+= 1;\s*saveSettingsMutation\.mutate\(merged\);/.test(usSrc));
}

console.log(`\nvalidate-payment-terms: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
