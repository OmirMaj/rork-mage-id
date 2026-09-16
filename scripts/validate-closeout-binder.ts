// validate-closeout-binder.ts — the client binder does not print the GC's
// margin, and it does not throw away the logs it was handed.
//
// WHY THIS EXISTS.
//
// The closeout binder is the PDF the GC hands the owner or the tenant at the
// end of a job, and publishes into the client portal when its status flips to
// `sent`. Its "Trade contacts" table declared its columns as
// Company / Scope / Phone / Email and its row builder emitted, in order:
// vendorName, scope, PHASE, and `fmtMoney(c.amount + (c.changeAmount ?? 0))`.
//
// So the column headed "Phone" printed a construction phase, and the column
// headed "Email" printed every subcontractor's full contract value including
// approved change orders. Subtract that column from the contract sum and the
// client has read the GC's margin line by line — on a fit-out, the single
// number he most needs not to disclose. There is no recall: re-delivering the
// binder locks its content, it does not un-send the copy already downloaded.
//
// TypeScript could not see any of it, because every cell in that table is a
// string. `fmtMoney(...)` and `sub.email` have the same type. That is exactly
// the class of bug a guard has to cover, so this one covers it two ways:
//
//   1. BEHAVIOURALLY, over utils/tradeContacts.ts — the shared resolver that
//      both the binder PDF and the client portal are meant to use. It is a
//      pure module for this reason. We feed it a commitment whose amount is a
//      distinctive number and assert that number appears nowhere in what comes
//      back, and that the phone/email slots carry phone/email.
//
//   2. STRUCTURALLY, over utils/closeoutBinderEngine.ts — because the resolver
//      being clean does not stop a renderer from putting money back in the
//      cell. Every `sectionTable(title, columns, rows, …)` call site must have
//      as many <td> cells in its row builder as it declares columns (a silent
//      column shift is how "Phone" came to hold a phase), and the trade-contact
//      row builder specifically may not touch money at all.
//
// The second half of the same audit: `BuildBinderInput` declared `rfis` and
// `submittals`, the screen filtered both and passed them, and `buildBinderHtml`
// destructured everything EXCEPT those two. The complete design-question and
// shop-drawing record was computed and discarded on every export, while the GC
// re-assembled both logs by hand from two other screens at exactly the moment
// retention was waiting on them. So this guard also pins that they are named
// and actually rendered.
//
// Run via: bun run scripts/validate-closeout-binder.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveTradeContacts } from '../utils/tradeContacts';
import type { Commitment, Subcontractor } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = 'utils/closeoutBinderEngine.ts';
const engineSrc = readFileSync(join(ROOT, ENGINE), 'utf8');

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}

// ───────────────────────────────────────────────────────────────────────────
// Fixtures — one sub we know everything about, one commitment with no sub
// link, one purchase order, one draft.
// ───────────────────────────────────────────────────────────────────────────
const LEAKY_AMOUNT = 88123;      // the sub's contract
const LEAKY_CHANGE = 4077;       // + approved COs; 92200 is the number a client must never see
const base = {
  projectId: 'p1', description: 'Electrical rough-in and finish',
  signedDate: '2026-02-01', createdAt: '2026-02-01', updatedAt: '2026-02-01',
} as const;

const commitments: Commitment[] = [
  { ...base, id: 'c1', number: 'SC-001', type: 'subcontract', status: 'active',
    subcontractorId: 's1', vendorName: 'Volt Bros (typed)', amount: LEAKY_AMOUNT,
    changeAmount: LEAKY_CHANGE, phase: 'Rough-in' },
  { ...base, id: 'c2', number: 'SC-002', type: 'subcontract', status: 'active',
    vendorName: 'Anonymous Drywall', description: 'Drywall', amount: 21000, phase: 'Interiors' },
  { ...base, id: 'c3', number: 'PO-001', type: 'purchase_order', status: 'active',
    vendorName: 'Ferguson', description: 'Fixtures', amount: 9000 },
  { ...base, id: 'c4', number: 'SC-003', type: 'subcontract', status: 'draft',
    subcontractorId: 's1', vendorName: 'Volt Bros', amount: 5000 },
  { ...base, id: 'cX', projectId: 'OTHER', number: 'SC-009', type: 'subcontract',
    status: 'active', subcontractorId: 's1', amount: 1, description: 'Other job' },
];

const subs = [
  { id: 's1', companyName: 'Voltaire Electric LLC', contactName: 'Ray Voltaire',
    phone: '(702) 555-0142', email: 'ray@voltaire-electric.com', address: '', trade: 'electrical',
    licenseNumber: 'C-10-88213', w9OnFile: true, bidHistory: [] },
] as unknown as Subcontractor[];

console.log('\ncloseout binder — trade contacts carry contacts, not contract values:');

const rows = resolveTradeContacts(commitments, subs, 'p1');
const serialised = JSON.stringify(rows);

// ── 1. the margin leak, behaviourally ───────────────────────────────────────
ok('no contract amount survives into a trade-contact row',
  !serialised.includes(String(LEAKY_AMOUNT))
  && !serialised.includes(String(LEAKY_AMOUNT + LEAKY_CHANGE))
  && !serialised.includes(String(LEAKY_CHANGE)),
  `resolveTradeContacts leaked a commitment amount into the client-facing row set: ${serialised}`);

ok('a TradeContact has no money-shaped field at all',
  rows.every(r => !Object.keys(r).some(k => /amount|cost|price|total|paid|value/i.test(k))),
  `keys: ${JSON.stringify(Object.keys(rows[0] ?? {}))} — a money field here is a margin disclosure ` +
  `waiting for a renderer to print it.`);

// ── 2. the columns hold what their headers promise ──────────────────────────
const volt = rows.find(r => r.company.startsWith('Voltaire'));
ok('the linked sub resolves to its registered company name',
  volt?.company === 'Voltaire Electric LLC',
  `got ${volt?.company ?? '(no row)'} — the typed vendorName should lose to the sub record.`);
ok('phone holds the phone', volt?.phone === '(702) 555-0142', `got ${String(volt?.phone)}`);
ok('email holds the email', volt?.email === 'ray@voltaire-electric.com', `got ${String(volt?.email)}`);
ok('phase stays in phase and never in phone', volt?.phase === 'Rough-in' && volt?.phone !== 'Rough-in',
  `phase=${String(volt?.phase)} phone=${String(volt?.phone)}`);

// ── 3. an unresolved sub reads as blank, not as some other field ────────────
const anon = rows.find(r => r.company === 'Anonymous Drywall');
ok('a commitment with no linked sub keeps its vendor name', !!anon);
ok('…and leaves phone and email BLANK rather than substituting another field',
  anon?.phone === undefined && anon?.email === undefined && anon?.hasSubRecord === false,
  `got phone=${String(anon?.phone)} email=${String(anon?.email)} — a substituted field is a silent ` +
  `column shift, which is the original bug.`);

// ── 4. scoping ──────────────────────────────────────────────────────────────
ok('purchase orders are excluded', !rows.some(r => r.company === 'Ferguson'),
  'a PO carries no subcontractorId by construction, so it renders a supplier beside three blank cells.');
ok('draft commitments are excluded', rows.length === 2, `got ${rows.length} rows: ${serialised}`);
ok('another project\'s commitments are excluded', !rows.some(r => r.scope === 'Other job'));

// ───────────────────────────────────────────────────────────────────────────
// 5. STRUCTURAL — the renderer cannot put money back in a contact cell, and
//    no table may declare more (or fewer) columns than its rows emit.
// ───────────────────────────────────────────────────────────────────────────
console.log('\ncloseout binder — every table\'s columns match its row builder:');

/** Slice a `const <name> = … .join('')` row-builder block out of the source. */
function rowBuilderBlock(name: string): string | null {
  const start = engineSrc.indexOf(`const ${name} =`);
  if (start < 0) return null;
  const end = engineSrc.indexOf(".join('')", start);
  if (end < 0) return null;
  return engineSrc.slice(start, end);
}

const contactBlock = rowBuilderBlock('subContactRows');
ok('the trade-contact row builder still exists', !!contactBlock,
  `no "const subContactRows =" in ${ENGINE} — rename it and this guard goes blind.`);
if (contactBlock) {
  const money = /fmtMoney|\.amount\b|changeAmount|paidToDate|contractTotal/.exec(contactBlock);
  ok('the trade-contact row builder touches no money whatsoever',
    !money,
    `${ENGINE} builds a client-facing "Trade contacts" row using ${money?.[0]}. That table is handed to ` +
    `the owner; a contract value in it lets them read the GC's margin line by line, and a delivered PDF ` +
    `cannot be recalled. Sub contract values belong on the buyout and job-cost screens.`);
  ok('the trade-contact row builder goes through the shared resolver',
    /tradeContacts\.map\(/.test(contactBlock),
    `${ENGINE} must render resolveTradeContacts() output. Reading Commitment fields directly is what ` +
    `produced a "Phone" column full of construction phases and an "Email" column full of dollars, and ` +
    `it also decouples this table from the client portal's copy of it.`);
}

// Every sectionTable(title, [columns], rowsVar, …) must line up with its rows.
const callRe = /sectionTable\(\s*'([^']*)',\s*\[([^\]]*)\],\s*(\w+),/g;
let m: RegExpExecArray | null;
let tablesChecked = 0;
while ((m = callRe.exec(engineSrc)) !== null) {
  const [, title, colsRaw, rowsVar] = m;
  const columns = colsRaw.split(',').map(s => s.trim()).filter(Boolean).length;
  const block = rowBuilderBlock(rowsVar);
  if (!block) { ok(`"${title}" — row builder ${rowsVar} found`, false, 'variable not found in the file'); continue; }
  const cells = (block.match(/<td\b/g) ?? []).length;
  tablesChecked++;
  ok(`"${title}" declares ${columns} columns and emits ${cells} cells`, columns === cells,
    `${ENGINE}: the "${title}" table headers and its ${rowsVar} builder are out of step. A mismatch here ` +
    `does not fail typecheck — every cell is a string — it just silently shifts a column, which is how ` +
    `contract amounts came to print under a header reading "Email".`);
}
ok('found every sectionTable call site', tablesChecked >= 7,
  `only ${tablesChecked} tables matched the call regex — if the helper was renamed or reformatted this ` +
  `guard is checking nothing.`);

// ───────────────────────────────────────────────────────────────────────────
// 6. The logs the binder was handed are actually rendered.
// ───────────────────────────────────────────────────────────────────────────
console.log('\ncloseout binder — the RFI and submittal logs are not discarded:');

// [^{}]* rather than [\s\S]*? on purpose: the lazy form starts matching at the
// FIRST `const {` in the file (an unrelated Supabase destructure) and swallows
// everything down to `= input;`, so the body it hands back is most of the
// module and every name below "appears in the destructure".
const destructure = /const\s*\{([^{}]*)\}\s*=\s*input;/.exec(engineSrc);
ok('buildBinderHtml destructures its input', !!destructure);
// Strip the comments out of the destructure body FIRST. The block explains
// this very bug in prose, and the words "rfis" and "submittals" inside that
// comment made the check pass over a destructure that had dropped them both —
// a guard that reads its own explanation and calls it evidence.
const destructuredNames = (destructure?.[1] ?? '').replace(/\/\/[^\n]*/g, '');
for (const field of ['rfis', 'submittals', 'subcontractors']) {
  ok(`"${field}" is named in the destructure`,
    !!destructure && new RegExp(`\\b${field}\\b`).test(destructuredNames),
    `BuildBinderInput declares ${field} and the screen filters and passes it. Not naming it here is how ` +
    `the whole ${field} record was computed and thrown away on every export.`);
}
ok('an RFI log section is rendered', /sectionTable\('RFI log'/.test(engineSrc));
ok('a submittal log section is rendered', /sectionTable\('Submittal log'/.test(engineSrc));
ok('both logs are skipped when empty rather than printing bare headers',
  /\$\{rfiRows \? sectionTable/.test(engineSrc) && /\$\{submittalRows \? sectionTable/.test(engineSrc),
  'An empty table with a header reads as a broken feature; "no RFIs on this job" is a normal outcome.');

// A blank contact cell must say WHY it is blank — the repo's honesty rule.
ok('blank contact cells are explained, not left to be read as a bug',
  /missingContactCount/.test(engineSrc) && /no phone or email on file/.test(engineSrc),
  `${ENGINE} must print a line under the trade-contacts table saying how many trades have no contact ` +
  `captured. An unexplained empty cell reads as a data error instead of an honest gap.`);

console.log('');
if (fail > 0) {
  console.error(`✗ validate-closeout-binder: ${fail} failure(s), ${pass} passed.\n`);
  process.exit(1);
}
console.log(`✓ validate-closeout-binder: ${pass} checks passed.\n`);
