// validate-wip-provenance.ts — a WIP figure that leaves this app must say where
// it came from.
//
// WHY THIS EXISTS. Every input on the WIP schedule is the end of a fallback
// chain — deriveOriginalContract alone has seven branches — and the GC had no
// way to learn that the $1,400,000 "contract value" his surety was reading came
// from a GMP cap he typed once during project setup. "Where did that number
// come from" is the underwriter's FIRST question, and until the provenance work
// (audit 2026-09-07, "Worth doing" #26) the answer existed only in the branch
// order of a TypeScript function.
//
// scripts/validate-wip-parity.ts already pins that the derive functions and
// their …WithSource siblings agree, and that every WipSource carries a
// plain-English label. This guard pins the half that reaches a banker:
//
//   1. Every branch that can be RETURNED by a derive function is a labelled
//      source. A branch added tomorrow without a source string fails here —
//      including the shape TypeScript cannot see, a `return { value }` with no
//      source key at all.
//   2. The CSV carries a Source column beside every derived figure, and those
//      cells hold the label rather than the enum name.
//   3. The PDF carries the footnote block, per project, plus the cost-to-date
//      caveat the list row on screen has always shown and the exports dropped.
//   4. A snapshot locked before provenance shipped SAYS it has none, rather
//      than having a plausible branch invented for it.
//   5. app/wip-report.tsx actually attaches sources to the rows it snapshots.
//      A correct exporter fed rows with no provenance prints "not recorded"
//      forever, which is exactly as useless as the original defect.
//
// MUTATION-TESTED, because this repo has shipped guards that were green and
// broken. Each of these was applied to a copy of the real file and this guard
// was confirmed to FAIL: an unlabelled branch added to deriveOriginalContract-
// WithSource; a branch returning a source literal with no entry in the label
// table; the Source columns removed from CSV_COLUMNS; the footnote block
// removed from buildWipHtml.
//
// Run via: bun run scripts/validate-wip-provenance.ts

import {
  computeWipRow, computeWipPortfolio,
  describeWipRowSources, wipSourceLabel,
  WIP_SOURCE_LABELS, WIP_COST_OVERRIDE_LABELS,
  WIP_SOURCE_UNRECORDED, WIP_SOURCE_UNRECOGNIZED, WIP_COST_TO_DATE_CAVEAT,
  type WipCostToDateSource,
  type WipSnapshotRowWithSources, type WipPeriodWithSources,
} from '../utils/wip';
import { wipPeriodToCSV, buildWipHtml } from '../utils/wipExport';
import type { WipRowInput } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath + join because the repo path contains a space.
// This guard runs under bun (package.json `test:wip-provenance`), which owns
// the transpiler used in section 6 to run a TypeScript function lifted out of a
// component. Declared locally because the repo installs no @types/bun.
declare const Bun: {
  Transpiler: new (opts: { loader: string }) => { transformSync(code: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split('/')), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

// One top-level function's whole declaration, so an assertion about one derive
// function cannot accidentally be satisfied by its neighbour. Brace-counting
// from the declaration does NOT work here: these signatures carry braces of
// their own (`opts?: { approvedChangeOrders?: number }`, `WipDerived & {
// committed: number }`), and a counter starting there closes on the parameter
// type and hands back a signature with no body — every assertion below it then
// passes on an empty string, which is precisely the green-and-broken guard this
// repo keeps shipping. These are module-level functions, so the closing brace
// is the first `}` in column 0.
function bodyOf(file: string, marker: string): string {
  const at = file.indexOf(marker);
  if (at < 0) return '';
  const end = file.indexOf('\n}\n', at);
  return end < 0 ? file.slice(at) : file.slice(at, end + 2);
}

/** Every object literal that is `return`ed from a body, as raw text. */
function returnedLiterals(body: string): string[] {
  const out: string[] = [];
  const re = /return\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    let depth = 0;
    for (let i = m.index; i < body.length; i++) {
      const c = body[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { out.push(body.slice(m.index, i + 1)); break; } }
    }
  }
  return out;
}

/**
 * A file with its comment lines removed. Prose about the bug is not the bug —
 * the "never a direct upsert" assertion below fired on the comment that says
 * exactly that (the same trap scripts/validate-calendar-date.ts documents).
 */
function withoutComments(file: string): string {
  return file.split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

const WIP_SRC = read('utils/wip.ts');
const EXPORT_SRC = read('utils/wipExport.ts');
const SCREEN_SRC = read('app/wip-report.tsx');

const SOURCED_FNS = [
  'export function deriveOriginalContractWithSource(',
  'export function suggestCostToDateWithSource(',
  'export function deriveEstimatedCostWithSource(',
];

// ── 1. Every branch that can be returned is a labelled source ──────────────
console.log('\nevery branch of a WIP derive chain names itself:');
{
  const declared = new Set(Object.keys(WIP_SOURCE_LABELS));

  // The union in the source text, not just the label table — so widening one
  // without the other is caught here rather than only by tsc.
  const unionText = WIP_SRC.slice(
    WIP_SRC.indexOf('export type WipSource ='),
    WIP_SRC.indexOf(';', WIP_SRC.indexOf('export type WipSource =')),
  );
  const unionMembers = [...unionText.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  ok('the WipSource union was found in utils/wip.ts', unionMembers.length > 0);
  ok('every WipSource the type declares has a label',
    unionMembers.filter(m => !declared.has(m)).length === 0,
    `unlabelled: ${unionMembers.filter(m => !declared.has(m)).join(', ')}`);
  ok('…and the label table declares no source the type does not',
    [...declared].filter(k => !unionMembers.includes(k)).length === 0,
    `orphan labels: ${[...declared].filter(k => !unionMembers.includes(k)).join(', ')}`);

  for (const marker of SOURCED_FNS) {
    const label = marker.slice('export function '.length, -1);
    const body = bodyOf(WIP_SRC, marker);
    ok(`${label}: the body was found (every assertion below is scoped to it)`, body.length > 200);

    // Covers `source: 'x'`, `source = 'x'` and `let source: WipSource = 'x'`.
    const emitted = [...body.matchAll(/source(?:\s*:\s*WipSource)?\s*[:=]\s*'([a-z_]+)'/g)].map(m => m[1]);
    ok(`${label}: emits at least one named source`, emitted.length > 0);
    const unlabelled = emitted.filter(s => !declared.has(s));
    ok(`${label}: every source literal it can return is labelled`,
      unlabelled.length === 0,
      `no WIP_SOURCE_LABELS entry for: ${[...new Set(unlabelled)].join(', ')}`);

    // The shape tsc cannot see in a scratch copy: a new branch that returns a
    // bare `{ value }`. A figure with no provenance is the whole defect.
    const naked = returnedLiterals(body).filter(lit => !/\bsource\b/.test(lit));
    ok(`${label}: no returned figure omits its source`,
      naked.length === 0,
      naked.map(l => l.replace(/\s+/g, ' ').slice(0, 90)).join(' | '));
  }

  // The two provenances cost-to-date can carry that no derive chain returns:
  // the GC's own typed figure, and whether the server has it yet.
  ok('a typed cost-to-date has a label for both synced and not-yet-synced',
    Object.keys(WIP_COST_OVERRIDE_LABELS).length === 2
    && /not yet synced/i.test(WIP_COST_OVERRIDE_LABELS.entered_on_this_device)
    && /synced/i.test(WIP_COST_OVERRIDE_LABELS.entered_and_synced));
  ok('wipSourceLabel answers for a derived source and for a typed one',
    wipSourceLabel('gmp_cap') === WIP_SOURCE_LABELS.gmp_cap
    && wipSourceLabel('entered_and_synced') === WIP_COST_OVERRIDE_LABELS.entered_and_synced);
  ok('no label is a placeholder or an enum name repeated back',
    [...Object.values(WIP_SOURCE_LABELS), ...Object.values(WIP_COST_OVERRIDE_LABELS)]
      .filter(l => !l || l.length < 12 || /^[a-z_]+$/.test(l)).length === 0);

  // wipSourceLabel is a LOOKUP over rows read back off disk. Snapshot rows come
  // out of AsyncStorage and out of the wip_periods jsonb with a cast and no
  // validation (contexts/WipContext.tsx:55), so the key it is handed is not
  // guaranteed to be a member of either table — a renamed WipSource is enough.
  // It was written with `in`, which walks the prototype chain: an unrecognised
  // key printed the word "undefined" beside a $1.4M contract, and the key
  // 'constructor' printed `function Object() { [native code] }`. Both in the
  // Source column of the page a surety reads.
  const strays: WipCostToDateSource[] =
    ['gmp_ceiling', 'constructor', 'toString', 'hasOwnProperty', '__proto__', ''] as unknown as WipCostToDateSource[];
  for (const stray of strays) {
    const label = wipSourceLabel(stray);
    ok(`wipSourceLabel('${String(stray)}') answers with a sentence, not a stringified miss`,
      typeof label === 'string'
      && label === WIP_SOURCE_UNRECOGNIZED
      && !/undefined|native code|\[object/i.test(label),
      String(label));
  }
  ok('the unrecognised-source sentence admits it rather than inventing a branch',
    WIP_SOURCE_UNRECOGNIZED.length > 20
    && String(WIP_SOURCE_UNRECOGNIZED) !== String(WIP_SOURCE_UNRECORDED)
    && /recognise|recognize/i.test(WIP_SOURCE_UNRECOGNIZED));
}

// ── Fixtures: one row with provenance, one from before it existed ──────────
const input: WipRowInput = {
  originalContract: 1_400_000,   // REVENUE
  approvedChangeOrders: 100_000, // REVENUE
  totalEstimatedCost: 1_120_000, // COST
  costToDate: 340_000,           // COST incurred
  billedToDate: 500_000,
};
const sourced: WipSnapshotRowWithSources = {
  projectId: 'p-henderson', projectName: 'Henderson, LLC',
  input, output: computeWipRow(input),
  sources: {
    originalContract: 'gmp_cap',
    totalEstimatedCost: 'estimate_base_total',
    costToDate: 'entered_and_synced',
  },
};
// A period locked before provenance shipped. Its rows have no `sources`.
const legacy: WipSnapshotRowWithSources = {
  projectId: 'p-ridgeline', projectName: 'Ridgeline', input, output: computeWipRow(input),
};
const period: WipPeriodWithSources = {
  id: 'per-1', periodEndDate: '2026-09-08', createdAt: '2026-09-08T00:00:00.000Z',
  rows: [sourced, legacy], portfolioTotals: computeWipPortfolio([sourced, legacy]),
};

// ── 2. The CSV carries a source beside every derived figure ────────────────
console.log('\nthe CSV a CPA pastes into Excel says where each figure came from:');
{
  const csv = wipPeriodToCSV(period);
  const lines = csv.split('\n');
  const header = lines[0].split(',');
  const sourceCols = header.filter(h => /Source$/.test(h));

  const described = describeWipRowSources(sourced);
  ok('there is one Source column for every derived figure describeWipRowSources explains',
    sourceCols.length === Object.keys(described).length,
    `${sourceCols.length} Source columns vs ${Object.keys(described).length} described figures`);
  ok('the Source columns name the figures they explain',
    ['Revised Contract Source', 'Total Est Cost Source', 'Cost to Date Source']
      .every(c => header.includes(c)),
    header.join(' | '));
  // A Source column that is not beside its figure is a column a CPA reads
  // against the wrong number.
  for (const [figure, source] of [
    ['Revised Contract', 'Revised Contract Source'],
    ['Total Est Cost', 'Total Est Cost Source'],
    ['Cost to Date', 'Cost to Date Source'],
  ]) {
    ok(`"${source}" sits immediately after "${figure}"`,
      header.indexOf(source) === header.indexOf(figure) + 1);
  }

  // Cells, parsed properly — the labels contain commas.
  const cells = (line: string): string[] => {
    const out: string[] = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };

  const dataRow = cells(lines[1]);
  ok('the data row has exactly as many cells as the header', dataRow.length === header.length,
    `${dataRow.length} cells vs ${header.length} columns`);
  ok('the contract cell says GMP cap, in words, not "gmp_cap"',
    dataRow[header.indexOf('Revised Contract Source')] === described.originalContract
    && /GMP cap/i.test(described.originalContract)
    && !/gmp_cap/.test(described.originalContract));
  ok('…and it accounts for the approved change orders folded into the revised contract',
    /approved change orders/i.test(dataRow[header.indexOf('Revised Contract Source')]));
  ok('the cost-budget cell carries its own branch',
    dataRow[header.indexOf('Total Est Cost Source')] === described.totalEstimatedCost
    && /base total/i.test(described.totalEstimatedCost));
  ok('the cost-to-date cell says the GC typed it and that it has synced',
    dataRow[header.indexOf('Cost to Date Source')] === described.costToDate
    && /entered/i.test(described.costToDate) && /synced/i.test(described.costToDate));

  // The automatic figure is a LOWER BOUND, and the exports used to drop that.
  ok('the automatic cost-to-date label still says self-performed labor is missing',
    /self-performed labor/i.test(WIP_SOURCE_LABELS.commitments_and_receipts)
    && /lower bound/i.test(WIP_SOURCE_LABELS.commitments_and_receipts));

  const legacyRow = cells(lines[2]);
  ok('a row from before provenance shipped says "not recorded" rather than guessing',
    legacyRow[header.indexOf('Revised Contract Source')] === WIP_SOURCE_UNRECORDED
    && legacyRow[header.indexOf('Cost to Date Source')] === WIP_SOURCE_UNRECORDED);

  ok('the TOTAL line is still the last line', lines[lines.length - 1].startsWith('TOTAL'));
  ok('…and claims no single provenance for a portfolio sum',
    cells(lines[lines.length - 1])[header.indexOf('Revised Contract Source')] === '');
}

// ── 2b. The two shapes a real snapshot arrives in that the fixtures above
//        do not cover: a DEDUCTIVE change order, and a `sources` member this
//        build has no label for. Both reach the export unvalidated. ─────────
console.log('\nthe export survives the rows that actually come off disk:');
{
  // A deductive CO is ordinary — the owner cuts scope after signing — and the
  // approved total on that job is NEGATIVE.
  const deductiveInput: WipRowInput = {
    originalContract: 1_400_000,    // REVENUE
    approvedChangeOrders: -30_000,  // REVENUE, removed by the owner
    totalEstimatedCost: 1_120_000,  // COST
    costToDate: 340_000,            // COST incurred
    billedToDate: 500_000,
  };
  const deductive: WipSnapshotRowWithSources = {
    projectId: 'p-deduct', projectName: 'Owner cut the millwork',
    input: deductiveInput, output: computeWipRow(deductiveInput),
    sources: {
      originalContract: 'gmp_cap',
      totalEstimatedCost: 'estimate_base_total',
      costToDate: 'commitments_and_receipts',
    },
  };
  const deductLine = describeWipRowSources(deductive).originalContract;
  ok('a deductive change order reads "less $30,000", not "plus $-30,000"',
    /less \$30,000/.test(deductLine) && !/\$-/.test(deductLine) && !/plus/.test(deductLine),
    deductLine);
  ok('…and a job with no change orders still says nothing about them',
    !/change orders/i.test(describeWipRowSources({
      ...deductive, input: { ...deductiveInput, approvedChangeOrders: 0 },
    }).originalContract));

  // The row a rename produces: `sources` present, but naming a branch this
  // build cannot label.
  const stale = {
    projectId: 'p-stale', projectName: 'Locked last March',
    input, output: computeWipRow(input),
    sources: { originalContract: 'gmp_ceiling', totalEstimatedCost: 'estimate_base_total', costToDate: 'commitments_and_receipts' },
  } as unknown as WipSnapshotRowWithSources;

  const adversarial: WipPeriodWithSources = {
    id: 'per-2', periodEndDate: '2026-09-08', createdAt: '2026-09-08T00:00:00.000Z',
    rows: [deductive, stale, { ...deductive, projectId: 'p-quote', projectName: 'Smith, "Bud" & Sons' }],
    portfolioTotals: computeWipPortfolio([deductive, stale, deductive]),
  };
  const csv = wipPeriodToCSV(adversarial);
  const html = buildWipHtml(adversarial, 'MAGE Construction');
  ok('no cell in the CSV is the word "undefined"', !/undefined/.test(csv), csv.slice(0, 200));
  ok('no line in the PDF is the word "undefined"', !/undefined/.test(html));
  ok('neither export leaks a stringified function into a Source cell',
    !/native code/.test(csv) && !/native code/.test(html));
  // Width is read off this CSV's own header, never a literal: a guard that
  // hardcodes the column count stops noticing when the header and the rows
  // change together in the wrong direction.
  const width = (l: string): number => {
    let q = false, n = 1;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === '"') { if (l[i + 1] === '"') i++; else q = false; } }
      else if (c === '"') q = true;
      else if (c === ',') n++;
    }
    return n;
  };
  const csvLines = csv.split('\n');
  ok('a project name carrying a comma and a quote still yields a row as wide as the header',
    csvLines.every(l => width(l) === width(csvLines[0])),
    csvLines.map(l => width(l)).join(','));
}

// ── 3. The PDF carries the footnote block ──────────────────────────────────
console.log('\nthe PDF a GC hands his surety carries the footnotes:');
{
  const html = buildWipHtml(period, 'MAGE Construction');
  const described = describeWipRowSources(sourced);
  ok('there is a footnote block, headed so a banker knows what it answers',
    /Where these figures come from/i.test(html));
  ok('it names the project each footnote belongs to',
    html.includes('Henderson, LLC') && html.includes('Ridgeline'));
  for (const [figure, text] of Object.entries(described)) {
    ok(`the footnote prints the ${figure} source`,
      html.includes(text.replace(/&/g, '&amp;')),
      text);
  }
  ok('the cost-to-date caveat the PDF used to drop is on the page',
    html.includes(WIP_COST_TO_DATE_CAVEAT.replace(/&/g, '&amp;'))
    && /lower bound/i.test(WIP_COST_TO_DATE_CAVEAT));
  ok('a row with no provenance says so on the PDF too',
    html.includes(WIP_SOURCE_UNRECORDED));
  // buildWipHtml is what shareWipPeriodPdf renders — a footnote helper nobody
  // calls is not a disclosure.
  ok('buildWipHtml actually renders the footnote helper',
    /\$\{footnotesHtml\(period\)\}/.test(EXPORT_SRC));
}

// ── 4. The screen puts provenance ON the snapshot ──────────────────────────
console.log('\nthe WIP screen records provenance on the rows it freezes:');
{
  ok('liveRows are typed as rows that carry sources',
    /const liveRows: WipSnapshotRowWithSources\[\]/.test(SCREEN_SRC));
  ok('…and every snapshot row is built with its sources attached',
    /output: computeWipRow\(input\), sources \}/.test(SCREEN_SRC));
  ok('the figure and its source come out of ONE call, so they cannot drift',
    /const \{ input, sources \} = buildRow\(p\)/.test(SCREEN_SRC));
  ok('a typed cost-to-date is recorded as typed, and says whether it has synced',
    /'entered_and_synced'/.test(SCREEN_SRC) && /'entered_on_this_device'/.test(SCREEN_SRC));
  ok('the override is written through the offline queue, never a direct upsert',
    /supabaseWrite\(WIP_COST_OVERRIDES_TABLE, 'upsert'/.test(SCREEN_SRC)
    && !/supabase\s*\.\s*from\([^)]*\)\s*\.\s*upsert/.test(withoutComments(SCREEN_SRC)));
  ok('…and the server is read back on load, so the phone stops showing a stale floor',
    /\.from\(WIP_COST_OVERRIDES_TABLE\)/.test(SCREEN_SRC)
    && /\.select\('project_id, cost_to_date, cleared, updated_at'\)/.test(SCREEN_SRC),
    'the read must carry `cleared` — without it the OTHER device\'s clear is invisible and this load restores the override the GC took off');
}

// ── 5. The typed figure can be taken back off ──────────────────────────────
//
// A cost-to-date override is the only number on this schedule the GC sets
// himself, and the first version of the sync shipped it as a one-way door:
// there was no control that removed one, and the two things a person actually
// does — wipe the box, or retype the app's own figure — were both recorded as
// "entered by you". Worse, `Number('')` is 0, so wiping the box wrote a $0
// COST override: on a 30%-complete job that reads as 0% complete, $0 earned
// revenue and a $500,000 overbilling, and the sync then carried that $0 to the
// GC's other device.
console.log('\nan override the GC typed can be taken back off:');
{
  const commit = bodyOf(SCREEN_SRC, 'const commitDrillCost = useCallback(');
  ok('commitDrillCost was found (every assertion below is scoped to it)', commit.length > 300);
  ok('an empty or unparseable box is not read as $0 of incurred cost',
    !/Number\.isFinite\(typed\)\s*\?\s*typed\s*:\s*0/.test(commit)
    && /emptied/.test(commit)
    && /if \(!emptied && !Number\.isFinite\(typed\)\) return;/.test(commit));
  ok('clearing the box, or retyping the automatic figure, removes the override',
    /emptied \|\| Math\.round\(typed\) === Math\.round\(auto\.value\)/.test(commit)
    && /cleared: true/.test(commit));
  ok('…and opening the sheet on a project with no override still records nothing',
    /if \(!override\) return;/.test(commit));
  ok('a removal is a dated tombstone, not a delete the next read-through undoes',
    /updatedAt: new Date\(\)\.toISOString\(\)/.test(commit));

  // A tombstone that is READ as a figure puts the rejected number back on a
  // bank-facing schedule. A tombstone that never LEAVES THE DEVICE is the same
  // failure one step out: the row stays server-side and the GC's other device
  // restores the number he just took off.
  ok('a tombstone is never read as a cost-to-date',
    /function overrideInForce\(/.test(SCREEN_SRC)
    && /const override = overrideInForce\(costOverrides, project\.id\)/.test(SCREEN_SRC)
    && !/const override = costOverrides\[project\.id\]/.test(SCREEN_SRC));
  // This assertion was INVERTED until 2026-09-10. It pinned `if (entry.cleared)
  // return;` — the first design, where a clear could not leave the device
  // because utils/offlineQueue.ts deletes by `id` only and this table is keyed
  // (user_id, project_id). Migration 20260908120100 added a `cleared` column,
  // so the clear now travels on the upsert path that already works, and the
  // guard has to assert the sync rather than forbid it.
  ok('a clear SYNCS, so the other device cannot restore the rejected number',
    /cleared: entry\.cleared === true/.test(bodyOf(SCREEN_SRC, 'const pushOverride = useCallback('))
    && !/if \(entry\.cleared\) return;/.test(SCREEN_SRC),
    'the tombstone must reach the server as `cleared: true`, not be swallowed before the write');
  ok('…and a clear made offline is backfilled like any other pending write',
    /if \(!entry\.synced\) backfill\.push/.test(SCREEN_SRC),
    '`synced` is what gates the backfill — gating on `cleared` too would strand an offline clear forever');
  ok('…and the server\'s own `cleared` is carried into the merged entry',
    /cleared: raw\.cleared === true/.test(SCREEN_SRC),
    'a server row that is a tombstone must merge as a tombstone, not as a live override');
  ok('the drill-in tells the GC how to get back to the automatic figure',
    /Clear this box to go back to the app/.test(SCREEN_SRC));

  // The read-through put every cached override BEHIND the server round-trip,
  // so until it answered — never, on a hung connection — the schedule showed
  // the subs+materials lower bound and Save period would have frozen it. That
  // is this wave's own failure, narrowed to the seconds after the screen opens.
  const cachePaint = SCREEN_SRC.indexOf('if (Object.keys(merged).length > 0) setCostOverrides(merged);');
  const serverRead = SCREEN_SRC.indexOf(`.from(WIP_COST_OVERRIDES_TABLE)`);
  ok('the cached overrides are painted BEFORE the server is asked, not after',
    cachePaint > 0 && serverRead > 0 && cachePaint < serverRead);
  ok('…and the load does not flat-replace a figure typed while it was in flight',
    /setCostOverrides\(\(typedWhileLoading\) => \{/.test(SCREEN_SRC)
    && /Date\.parse\(entry\.updatedAt\) > Date\.parse\(loaded\.updatedAt\)/.test(SCREEN_SRC));
}

// ── 6. Saved estimate versions do not share a name ─────────────────────────
//
// This rides in the WIP guard because the same wave owns both files and a new
// validator script needs a package.json entry (see the handoff note). The
// defect is the same class as the one above: a name that is derived from a
// COUNT rather than from what is on the list. components/EstimateComparison
// keeps ten versions and evicts the oldest, so once the list is full the count
// sticks at ten and every save from the eleventh on is called "V11" — two rows
// with one name, and a GC comparing "V11" to the quote he emailed cannot tell
// which he is reading. Deleting a version does it sooner.
console.log('\nsaved estimate versions get distinct names:');
{
  const CMP_SRC = read('components/EstimateComparison.tsx');
  ok('the next version number is not the list length',
    !/V\$\{savedVersions\.length \+ 1\}/.test(CMP_SRC));
  ok('…it is taken from the highest number already on the list',
    /function nextVersionNumber\(/.test(CMP_SRC)
    && /highest = Math\.max\(highest, Number\(m\[1\]\)\)/.test(CMP_SRC)
    && /name: `V\$\{nextVersionNumber\(savedVersions\)\}/.test(CMP_SRC));
  ok('the eviction warning names the OLDEST version, which is last in a newest-first list',
    /const dropped = evicted\[evicted\.length - 1\]/.test(CMP_SRC));

  // The naming rule itself, run rather than read. Re-implemented from the
  // source text so a rewrite that keeps the rule passes and one that quietly
  // reverts to a count does not.
  const m = /function nextVersionNumber\([\s\S]*?\n}/.exec(CMP_SRC);
  let nextVersionNumber: ((s: { name: string }[]) => number) | null = null;
  try {
    if (m) {
      // The declaration carries TypeScript annotations, so it is transpiled
      // before it is run. A failure here FAILS the assertion below — it is not
      // reported as a note and skipped, which is how this repo has shipped
      // guards that were green and testing nothing.
      const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${m[0]}\nexport { nextVersionNumber };`);
      nextVersionNumber = new Function(`${js.replace(/export\s*\{[^}]*\};?/g, '')}; return nextVersionNumber;`)() as (s: { name: string }[]) => number;
    }
  } catch (err) {
    console.log('      extraction failed:', err instanceof Error ? err.message : String(err));
  }
  ok('nextVersionNumber was extracted from the component and runs',
    typeof nextVersionNumber === 'function');
  if (nextVersionNumber) {
    const named = (ns: number[]) => ns.map(n => ({ name: `V${n} — Sep 8` }));
    // Newest-first, ten deep, and the eleventh save has already evicted V1.
    const full = named([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    ok('a full list whose oldest was already evicted yields V12, not a second V11',
      nextVersionNumber(full) === 12, String(nextVersionNumber(full)));
    ok('deleting a version in the middle does not reuse the name still on the list',
      nextVersionNumber(named([3, 1])) === 4, String(nextVersionNumber(named([3, 1]))));
    ok('an empty list starts at V1', nextVersionNumber([]) === 1);
    ok('hand-renamed versions still get a number no row on the list is wearing',
      nextVersionNumber([{ name: 'Bid to Henderson' }, { name: 'V2 — Sep 1' }]) === 3);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
