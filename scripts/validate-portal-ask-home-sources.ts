// validate-portal-ask-home-sources.ts — Ask Your Home may read the Home
// Passport and nothing else.
// Run via: bun run scripts/validate-portal-ask-home-sources.ts
//
// WHY: portal-ask-home is reachable with nothing but a client-portal link (no
// JWT, verify_jwt = false). Until Phase 0 (2026-09-23) it allowed the raw
// 'Daily Report' and 'RFI' project-memory sources. utils/projectMemory.ts
// builds those docs from the GC's internal record: `Issues/delays:
// <issuesAndDelays>` (not the published homeowner_summary) and every RFI
// handoff note — and the function never consulted the portal's
// showDailyReports / showRFIs toggles. A forwarded link could ask its way into
// the GC's notes. A homeowner-safe version returns later under a DISTINCT
// source name; the raw names must never come back.
//
// The simplest provable rule: parse the edge function's ALLOWED_SOURCES
// literal and require it to be exactly { 'Home Passport' }. Then bind that rule
// to the reason — every source label the app embeds for contractor-internal
// records (read from the code that embeds them, so a new raw source is covered
// the day it is added) must be absent — and prove the filter is actually
// applied, both in the database (p_sources) and after it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOwnerSharing, ownerSwitchesFromPortal } from '../supabase/functions/portal-ask-home/sharingFilter';
import { buildHomePassport } from '../utils/passport/buildHomePassport';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

// Comments may legitimately NAME the forbidden sources (the edge function's
// comment explains why they were removed), so every structural check runs on
// comment-stripped code. Line comments only strip when `//` is not inside a
// string — the function has URLs in string literals ("https://…").
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      let inStr: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inStr) {
          if (c === '\\') { i++; continue; }
          if (c === inStr) inStr = null;
        } else if (c === '"' || c === "'" || c === '`') {
          inStr = c;
        } else if (c === '/' && line[i + 1] === '/') {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

const FN = 'supabase/functions/portal-ask-home/index.ts';
const code = stripComments(read(FN));

console.log('\nportal-ask-home: allowed sources');

// ── 1. The allow-list literal ───────────────────────────────────────────────
const decls = code.match(/const\s+ALLOWED_SOURCES\s*=/g) ?? [];
ok('ALLOWED_SOURCES is declared exactly once', decls.length === 1, `found ${decls.length}`);
const lit = /const\s+ALLOWED_SOURCES\s*=\s*new\s+Set\(\s*\[([^\]]*)\]\s*\)\s*;/.exec(code);
ok('ALLOWED_SOURCES is a plain Set of string literals', !!lit);
const body = lit?.[1] ?? '';
const allowed = [...body.matchAll(/(["'`])((?:(?!\1).)*)\1/g)].map((m) => m[2]);
// Anything in the brackets that is not a quoted literal (a spread, an
// identifier, a function call) could smuggle a source past a literal parse.
const residue = body.replace(/(["'`])((?:(?!\1).)*)\1/g, '').replace(/[\s,]/g, '');
ok('the allow-list holds only string literals (no spreads, identifiers or calls)', residue === '',
  `unparsed: ${residue}`);
ok("the allow-list is exactly ['Home Passport']",
  allowed.length === 1 && allowed[0] === 'Home Passport', `got ${JSON.stringify(allowed)}`);

// ── 2. The raw sources, named explicitly ────────────────────────────────────
// Exact, case-insensitive, whitespace-normalised: 'daily report' or 'RFI ' is
// the same raw source to a reader and must fail just the same.
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const allowedNorm = new Set(allowed.map(norm));
for (const raw of ['Daily Report', 'RFI']) {
  ok(`raw '${raw}' is not allowed`, !allowedNorm.has(norm(raw)));
}

// ── 3. Every contractor-internal source the app embeds ──────────────────────
// Read from the code that writes them, not from a list kept here, so a sixth
// raw source added to buildMemoryDocs tomorrow is refused the same day.
const pm = read('utils/projectMemory.ts');
const memSources = [...pm.matchAll(/source:\s*'([^']+)'/g)].map((m) => m[1]);
ok('found the raw project-memory sources in utils/projectMemory.ts (at least RFI + Daily Report)',
  memSources.includes('RFI') && memSources.includes('Daily Report'), `got ${JSON.stringify(memSources)}`);
const planSrc = /export const PLAN_SOURCE = '([^']+)'/.exec(read('utils/plans/planChunk.ts'))?.[1];
ok('found the plan-sheet source label', !!planSrc);
const internal = [...new Set([...memSources, ...(planSrc ? [planSrc] : [])])]
  .filter((s) => s !== 'Home Passport');
for (const s of internal) {
  ok(`contractor-internal source '${s}' is not allowed`, !allowedNorm.has(norm(s)));
}
// And the reason they are internal is still true — if buildMemoryDocs stopped
// embedding raw issues / handoff notes, this validator's premise needs a look,
// not a silent pass.
ok('projectMemory still embeds raw issuesAndDelays under a non-passport source (premise holds)',
  /Issues\/delays: \$\{clean\(d\.issuesAndDelays\)\}/.test(pm));
ok('projectMemory still embeds RFI handoff notes under a non-passport source (premise holds)',
  /r\.handoffs/.test(pm) && /source: 'RFI'/.test(pm));

// ── 4. The filter is applied: in the database, and after it ─────────────────
const rpcCalls = code.match(/\/rest\/v1\/rpc\/match_project_memory/g) ?? [];
ok('exactly one match_project_memory call', rpcCalls.length === 1, `found ${rpcCalls.length}`);
const rpcAt = code.indexOf('/rest/v1/rpc/match_project_memory');
const rpcBlock = rpcAt >= 0 ? code.slice(rpcAt, code.indexOf('});', rpcAt) + 3) : '';
ok('the RPC passes p_sources built from ALLOWED_SOURCES (filtered before the LIMIT)',
  /p_sources:\s*\[\.\.\.ALLOWED_SOURCES\]/.test(rpcBlock));
ok('the post-RPC filter still drops any row outside ALLOWED_SOURCES',
  /\.filter\(\(m\)\s*=>\s*ALLOWED_SOURCES\.has\(m\.source\)\)/.test(code));
// The prompt must be built from the filtered set, never from the raw RPC rows.
ok('the prompt and refs are built from the filtered matches, not allMatches',
  /buildPrompt\(\s*question,\s*matches\.map/.test(code) && /const refs = matches\.map/.test(code)
  && !/buildPrompt\([^)]*allMatches/.test(code));

// ── 5. Behaviour, on the parsed allow-list ──────────────────────────────────
// Replays the function's filter over rows shaped like the ones
// buildMemoryDocs + the closeout binder write.
const rows = [
  { source: 'Home Passport', content: 'Warranty — Trane HVAC, 10 years parts' },
  { source: 'Daily Report', content: 'Issues/delays: sub walked off, owner is slow to pay' },
  { source: 'RFI', content: 'Note: architect wrong again, eat the cost quietly' },
  { source: 'Change Order', content: 'Markup 22%' },
  { source: 'Punch Item', content: 'Drywall crack, backcharge the painter' },
  { source: planSrc ?? 'Plan Sheet', content: 'A-201 notes' },
];
const allowedSet = new Set(allowed);
const kept = rows.filter((r) => allowedSet.has(r.source));
ok('only the passport row survives the filter',
  kept.length === 1 && kept[0].source === 'Home Passport', `kept ${JSON.stringify(kept.map((k) => k.source))}`);
ok('no internal note text survives the filter',
  !kept.some((k) => /Issues\/delays|Note:|Markup|backcharge/.test(k.content)));

// ── 6. The owner-sharing switches, enforced at answer time ──────────────────
// Founder decision 5: a supplier name and a sub's phone/email reach the owner
// only while the GC has that job's switch on. The index is written diff-only
// from the GC's device and never pruned, so a copy indexed while a switch was
// on outlives the switch. The function therefore reads the switch from the
// live projects row and filters every match through sharingFilter. This
// section indexes docs with BOTH switches on, then serves them through the
// function's own filter with the switches as the row says now.
console.log('\nportal-ask-home: owner-sharing switches at answer time');
{
  const SUPPLIER = 'Ferguson Supply Co';
  const PO_VENDOR = 'ABC Lumber Yard';
  const PHONE = '555-777-1234';
  const EMAIL = 'mike@sparky.test';
  const CONTACT = 'Mike Sparks';
  const stamp = { createdAt: '2026-03-01T12:00:00Z', updatedAt: '2026-03-01T12:00:00Z' };
  const passportOn = buildHomePassport({
    project: { id: 'p1', name: 'Kitchen remodel', location: '12 Oak Ln' },
    selections: [{ id: 'cat1', projectId: 'p1', category: 'Faucet', ...stamp,
      options: [{ id: 'o1', productName: 'Kitchen faucet', brand: 'Moen', sku: '7594SRS', supplier: SUPPLIER, unitPrice: 0, isChosen: true, ...stamp }] }] as never,
    warranties: [],
    commitments: [
      { id: 'c-sub', projectId: 'p1', type: 'subcontract', status: 'signed', vendorName: 'Sparky Electric', subcontractorId: 's1', description: 'Electrical', phase: 'Rough-in', amount: 1, ...stamp },
      { id: 'c-po', projectId: 'p1', type: 'purchase_order', status: 'signed', vendorName: PO_VENDOR, description: 'Framing lumber', amount: 1, ...stamp },
    ] as never,
    subcontractors: [{ id: 's1', companyName: 'Sparky Electric', contactName: CONTACT, phone: PHONE, email: EMAIL, trade: 'Electrical' }] as never,
    photos: [], maintenance: [], generatedAt: '2026-05-01T00:00:00Z',
    sharing: { supplierNames: true, tradeContacts: true },
  });
  // Rows exactly as match_project_memory returns them for these docs, plus
  // one doc as the pre-Phase-0 builder indexed it (facts inline).
  const indexed = [
    ...passportOn.docs.map((d) => ({ doc_id: d.docId, source: 'Home Passport', ref: d.ref, content: d.text, similarity: 0.9 })),
    { doc_id: 'passport:trade:legacy', source: 'Home Passport', ref: 'Trade — Sparky Electric', similarity: 0.9,
      content: `Sparky Electric worked on Kitchen remodel. Trade: Electrical. Contact: ${CONTACT}. Phone: ${PHONE}. Email: ${EMAIL}. Contracted Mar 1, 2026` },
    { doc_id: 'passport:finish:legacy', source: 'Home Passport', ref: 'Finish — Faucet', similarity: 0.9,
      content: `Faucet in Kitchen remodel: Kitchen faucet. Brand: Moen. SKU / model: 7594SRS. Supplier: ${SUPPLIER}. Details: brushed` },
  ];
  const all = JSON.stringify(indexed);
  ok('the fixture index really carries every secret (so the checks below can see a leak)',
    [SUPPLIER, PO_VENDOR, PHONE, EMAIL, CONTACT].every((x) => all.includes(x)));

  const served = (cp: unknown) => JSON.stringify(applyOwnerSharing(indexed, ownerSwitchesFromPortal(cp)));
  for (const [label, cp] of [
    ['both switched off', { shareSupplierNames: false, shareTradeContacts: false }],
    ['a portal saved before the switches (no keys)', {}],
    ['no client_portal at all', null],
    ['a string "true" from a hand-edited row', { shareSupplierNames: 'true', shareTradeContacts: 'true' }],
  ] as const) {
    const out = served(cp);
    ok(`${label}: no supplier, PO vendor, contact, phone or email is served`,
      ![SUPPLIER, PO_VENDOR, PHONE, EMAIL, CONTACT].some((x) => out.includes(x)), out);
  }
  const off = applyOwnerSharing(indexed, ownerSwitchesFromPortal({}));
  // Whole docs, not just their labelled lines: a supplier or contact doc is
  // the GC's relationship from its first word ("How to reach …", "… was
  // bought from …"), so the prefix gate drops it outright.
  ok('switched off: no supplier or contact doc is served at all, even scrubbed',
    !off.some((m) => /^passport:(supplier|contact):/.test(m.doc_id)), off.map((m) => m.doc_id).join(', '));
  const supOff = applyOwnerSharing(indexed, ownerSwitchesFromPortal({ shareTradeContacts: true }));
  const conOff = applyOwnerSharing(indexed, ownerSwitchesFromPortal({ shareSupplierNames: true }));
  ok('each prefix follows its own switch',
    !supOff.some((m) => m.doc_id.startsWith('passport:supplier:')) && supOff.some((m) => m.doc_id.startsWith('passport:contact:'))
    && !conOff.some((m) => m.doc_id.startsWith('passport:contact:')) && conOff.some((m) => m.doc_id.startsWith('passport:supplier:')));
  ok('switched off: the brand, model and the trade itself still answer',
    off.some((m) => /Brand: Moen/.test(m.content) && /7594SRS/.test(m.content))
    && off.some((m) => /Sparky Electric worked on/.test(m.content)), JSON.stringify(off));
  ok('switched off: the legacy doc keeps its neighbours around the cut facts',
    off.some((m) => m.doc_id === 'passport:trade:legacy' && /Trade: Electrical\. Contracted Mar 1, 2026$/.test(m.content)),
    JSON.stringify(off.find((m) => m.doc_id === 'passport:trade:legacy')));
  const supOnly = served({ shareSupplierNames: true });
  ok('suppliers on, contacts off: the supplier and PO vendor answer, no phone or email',
    supOnly.includes(SUPPLIER) && supOnly.includes(PO_VENDOR) && !supOnly.includes(PHONE) && !supOnly.includes(EMAIL), supOnly);
  const conOnly = served({ shareTradeContacts: true });
  ok('contacts on, suppliers off: phone and email answer, no supplier or PO vendor',
    conOnly.includes(PHONE) && conOnly.includes(EMAIL) && !conOnly.includes(SUPPLIER) && !conOnly.includes(PO_VENDOR), conOnly);
  const both = served({ shareSupplierNames: true, shareTradeContacts: true });
  ok('both on: everything answers', [SUPPLIER, PO_VENDOR, PHONE, EMAIL, CONTACT].every((x) => both.includes(x)), both);

  // The builder half of the rule: the GC's relationships never ride inside a
  // finish or trade doc, whatever the switches — only in their own docs, which
  // the prefix gate above can drop whole.
  const inline = passportOn.docs.filter((d) => !/^passport:(supplier|contact):/.test(d.docId));
  ok('with both switches on, no finish or trade doc carries a supplier, contact, phone or email',
    !inline.some((d) => [SUPPLIER, PO_VENDOR, PHONE, EMAIL, CONTACT].some((x) => d.text.includes(x) || d.ref.includes(x))),
    JSON.stringify(inline));

  // Wiring: the function reads the switches from the live row and filters
  // before it slices and before the prompt.
  ok('the project lookup selects exactly the two switch keys (never the whole client_portal and its token)',
    /select=id,user_id,type,share_suppliers:client_portal->shareSupplierNames,share_contacts:client_portal->shareTradeContacts&/.test(code));
  ok('the matches go through applyOwnerSharing(…, the live switches) before the slice',
    /const switches = ownerSwitchesFromPortal\(\{\s*shareSupplierNames: proj\.share_suppliers,\s*shareTradeContacts: proj\.share_contacts,\s*\}\);/.test(code)
    && /const matches = applyOwnerSharing\(\s*\(Array\.isArray\(allMatches\)[\s\S]*?switches,\s*\)\.slice\(0, KEEP_MATCHES\);/.test(code));
  ok('the filter is imported from the sibling module this validator executes',
    /import \{ applyOwnerSharing, ownerSwitchesFromPortal \} from "\.\/sharingFilter\.ts";/.test(code));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
