// validate-lien-waivers.ts — the statutory forms keep their statutory words,
// and the marketing site describes the signing flow the code actually has.
//
// WHY THIS EXISTS.
//
// utils/lienWaiverEngine.ts used to print, inside its own PDF, that the form it
// had just generated "may render the waiver void or unenforceable" in CA, TX,
// FL, GA and AZ. It was right: those five states write the wording of a lien
// waiver into their codes, and a release that departs from it is the release a
// court throws out. Georgia's own form says so on its face — "THE FAILURE TO
// INCLUDE THIS NOTICE LANGUAGE ON THE FACE OF THE FORM SHALL RENDER THE FORM
// UNENFORCEABLE AND INVALID". So the single most valuable thing a guard can do
// here is make sure that paragraph, and its four siblings in CA/TX/AZ, are
// still on the rendered page.
//
// Meanwhile marketing/features/index.html told contractors that subs "receive
// an email and sign digitally". Nothing sent anything. app/lien-waivers.tsx
// captured subEmail, mailed nobody, and let the GC type the sub's name under
// `role: 'gc'` — a contractor signing his subcontractor's release. So the
// second half of this guard pins the claim to the code: the page may describe
// the request-and-sign loop exactly as long as the loop is there, and the
// moment a piece of it is removed the build goes red instead of the website
// going back to lying.
//
// HOW IT CHECKS. By RENDERING. utils/lienWaiverDocument.ts is a pure module for
// exactly this reason — the checks below call buildLienWaiverHtml and read the
// bytes that go into the PDF, rather than grepping the source for a constant
// and hoping something uses it. A notice constant that exists but is never
// composed into a block would pass a grep and fail a contractor.
//
// Run via: bun run scripts/validate-lien-waivers.ts

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  statutoryFormFor, isStatutoryWaiverState, STATUTORY_WAIVER_STATES,
  STATUTE_TEXT_AS_OF, STATUTE_VERIFY_LINE, GENERIC_FORM_WARNING,
  NOTICE_CA_CONDITIONAL, NOTICE_CA_UNCONDITIONAL,
  NOTICE_TX_UNCONDITIONAL_PROGRESS, NOTICE_TX_UNCONDITIONAL_FINAL,
  NOTICE_AZ_UNCONDITIONAL, NOTICE_GA,
  type WaiverStateCode,
} from '../utils/lienWaiverForms';
import {
  buildLienWaiverHtml, lienWaiverDocContext, lienWaiverFormLabel, lienWaiverFormMeta,
} from '../utils/lienWaiverDocument';
import { statutoryStateName } from '../utils/lienWaiverForms';
import { formatCalendarDay } from '../utils/calendarDate';
import type { LienWaiver, LienWaiverType, CompanyBranding } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

/** Mirror of pdfDesign.escHtml — the notices reach the page escaped. */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

/**
 * The file with its comments stripped — block comments first, then line
 * comments, sparing the `//` in a `https://` URL.
 *
 * Every source-level assertion below is a claim about CODE, and a grep cannot
 * tell a live call from a commented-out one. That is not a hypothetical: during
 * the adversarial review of this wave, commenting out the one
 * `await sharePurchaseOrderPDF(...)` in Job Costing, the one
 * `await requestLienWaiverSignature(...)` in the waivers screen, the one
 * `sendEmail(...)` in the engine, and the `sign_form_meta: formMeta` line each
 * left this guard 220/220 green while the feature underneath was dead. Strip
 * first, then grep — or the guard verifies prose.
 */
function liveCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** The same, for SQL: `--` to end of line. */
function liveSql(src: string): string {
  return src.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
}

const ALL_TYPES: LienWaiverType[] = [
  'conditional_partial', 'unconditional_partial', 'conditional_final', 'unconditional_final',
];

const BRANDING: CompanyBranding = {
  companyName: 'Hallway Homes LLC', contactName: 'O. Majeed', email: 'gc@example.com',
  phone: '555-0100', address: '1 Yard Rd', licenseNumber: 'LIC-1', tagline: '',
};

function waiver(type: LienWaiverType, extra?: Partial<LienWaiver>): LienWaiver {
  return {
    id: 'w1', projectId: 'p1', userId: 'u1',
    waiverType: type,
    subName: 'Volt Electric LLC',
    subEmail: 'volt@example.com',
    // A calendar day, not an instant — this is the day the release runs through.
    throughDate: '2026-08-31',
    // Money OUT of the GC to the sub: a cost, and the consideration for the release.
    paidAmount: 18400,
    status: 'requested',
    notes: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...extra,
  };
}

/** A project whose free-text address resolves to `state`. */
function projectIn(state: string) {
  return {
    name: 'Henderson Remodel',
    location: state ? `124 Main St, Springfield ${state} 12345` : '124 Main St',
    primaryContact: { name: 'Dana Field' },
  };
}

function renderFor(state: string, type: LienWaiverType, extra?: Partial<LienWaiver>): string {
  return buildLienWaiverHtml(waiver(type, extra), BRANDING, lienWaiverDocContext(projectIn(state)));
}

// ─────────────────────────────────────────────────────────────────────
// A. Every statutory form keeps the notice its statute requires
// ─────────────────────────────────────────────────────────────────────
console.log('\nstatutory notices survive onto the rendered page:');

/**
 * The notice each (state, type) must carry, '' where the statute prescribes
 * none for that form. This table IS the requirement — a form losing its notice
 * is the exact defect Georgia's own statute names.
 */
const REQUIRED_NOTICE: Record<WaiverStateCode, Record<LienWaiverType, string>> = {
  CA: {
    conditional_partial: NOTICE_CA_CONDITIONAL,
    unconditional_partial: NOTICE_CA_UNCONDITIONAL,
    conditional_final: NOTICE_CA_CONDITIONAL,
    unconditional_final: NOTICE_CA_UNCONDITIONAL,
  },
  TX: {
    conditional_partial: '',
    unconditional_partial: NOTICE_TX_UNCONDITIONAL_PROGRESS,
    conditional_final: '',
    unconditional_final: NOTICE_TX_UNCONDITIONAL_FINAL,
  },
  AZ: {
    conditional_partial: '',
    unconditional_partial: NOTICE_AZ_UNCONDITIONAL,
    conditional_final: '',
    unconditional_final: NOTICE_AZ_UNCONDITIONAL,
  },
  GA: {
    conditional_partial: NOTICE_GA,
    unconditional_partial: NOTICE_GA,
    conditional_final: NOTICE_GA,
    unconditional_final: NOTICE_GA,
  },
  FL: {
    conditional_partial: '', unconditional_partial: '',
    conditional_final: '', unconditional_final: '',
  },
};

for (const state of STATUTORY_WAIVER_STATES) {
  for (const type of ALL_TYPES) {
    const required = REQUIRED_NOTICE[state][type];
    if (!required) continue;
    const html = renderFor(state, type);
    ok(`${state} ${type} carries its statutory notice`, html.includes(esc(required)),
      'the required all-caps notice is not on the rendered page');
  }
}

// Georgia's is the one the code defends itself. Pinned separately and by its
// operative sentence, so a re-worded NOTICE_GA that drops the consequence still
// fails even though the table above would follow the constant.
const GA_KILL_SENTENCE = 'THE FAILURE TO INCLUDE THIS NOTICE LANGUAGE ON THE FACE OF THE FORM SHALL '
  + 'RENDER THE FORM UNENFORCEABLE AND INVALID AS A WAIVER AND RELEASE UNDER O.C.G.A. CODE SECTION 44-14-366.';
for (const type of ALL_TYPES) {
  ok(`GA ${type} keeps the sentence that makes the notice mandatory`,
    renderFor('GA', type).includes(esc(GA_KILL_SENTENCE)),
    'O.C.G.A. § 44-14-366 invalidates a form that omits this paragraph');
}
ok('the GA notice constant still contains that sentence', NOTICE_GA.includes(GA_KILL_SENTENCE));

// The unconditional notices exist to warn a signer that the form binds them
// whether or not the money arrives. Pinned by that clause, not by the whole
// paragraph, so a reflow cannot quietly drop the warning.
const BINDS_UNPAID = 'EVEN IF YOU HAVE NOT BEEN PAID';
for (const [state, type] of [['CA', 'unconditional_partial'], ['CA', 'unconditional_final'],
  ['TX', 'unconditional_final'], ['AZ', 'unconditional_partial'], ['AZ', 'unconditional_final']] as const) {
  ok(`${state} ${type} warns the signer it binds them unpaid`,
    renderFor(state, type).includes(BINDS_UNPAID));
}
ok('TX unconditional progress carries its own prohibition wording',
  renderFor('TX', 'unconditional_partial').includes('IT IS PROHIBITED FOR A PERSON TO REQUIRE YOU TO SIGN THIS DOCUMENT'));

// ─────────────────────────────────────────────────────────────────────
// B. Every statutory form says which statute, as of when, and to verify
// ─────────────────────────────────────────────────────────────────────
console.log('\nstatutory provenance is on the document:');

ok('the "text as of" date is a real ISO day', /^\d{4}-\d{2}-\d{2}$/.test(STATUTE_TEXT_AS_OF));
ok('the verify line tells the reader to confirm with counsel',
  /attorney|counsel/i.test(STATUTE_VERIFY_LINE) && /amend/i.test(STATUTE_VERIFY_LINE));

for (const state of STATUTORY_WAIVER_STATES) {
  for (const type of ALL_TYPES) {
    const form = statutoryFormFor(state, type, {
      claimantName: '', customerName: '', ownerName: '', jobLocation: '', jobDescription: '',
      projectName: '', throughDate: '', amount: 0, checkMaker: '', checkPayee: '',
    });
    if (!form) { ok(`${state} ${type} resolves to a statutory form`, false); continue; }
    const html = renderFor(state, type);
    ok(`${state} ${type} prints its citation, date and verify line`,
      html.includes(esc(form.citation))
      && html.includes(esc(STATUTE_TEXT_AS_OF))
      && html.includes(esc(STATUTE_VERIFY_LINE)),
      `citation=${html.includes(esc(form.citation))} asOf=${html.includes(esc(STATUTE_TEXT_AS_OF))} verify=${html.includes(esc(STATUTE_VERIFY_LINE))}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// C. The general-form warning goes where it is true, and nowhere else
// ─────────────────────────────────────────────────────────────────────
console.log('\nthe general-form warning lands only where it is true:');

const WARNING_STATES = 'California, Texas, Florida, Georgia and Arizona';
ok('the warning still names all five statutory states', GENERIC_FORM_WARNING.includes(WARNING_STATES));

for (const state of ['NY', 'CO', 'WA']) {
  const html = renderFor(state, 'unconditional_partial');
  ok(`${state} prints the general form WITH the warning`, html.includes(esc(GENERIC_FORM_WARNING)),
    'a non-statutory state must still be told the five states need their own form');
}
for (const state of STATUTORY_WAIVER_STATES) {
  const html = renderFor(state, 'unconditional_partial');
  ok(`${state} does NOT print the warning`, !html.includes(esc(GENERIC_FORM_WARNING)),
    'the whole point of the statutory page is that it IS that state\'s form; the old warning would be false on it');
}

// ─────────────────────────────────────────────────────────────────────
// D. A form is only ever served for the state it belongs to
// ─────────────────────────────────────────────────────────────────────
console.log('\nform selection cannot land a job on another state\'s form:');

ok('an unresolvable address yields no statutory form',
  statutoryFormFor('', 'unconditional_partial', {
    claimantName: '', customerName: '', ownerName: '', jobLocation: '', jobDescription: '',
    projectName: '', throughDate: '', amount: 0, checkMaker: '', checkPayee: '',
  }) === null);
ok('a non-statutory state yields no statutory form', !isStatutoryWaiverState('NY'));
ok('a lowercase code still resolves', isStatutoryWaiverState('ca'));

// A project's STRUCTURED state is a plain `string` and nothing in the app
// constrains it to a two-letter code. Only the free-text branch of
// jobsiteAddressForProject runs its answer through normalizeState, so a
// structured "California" reached isStatutoryWaiverState — which merely trims
// and upper-cases — as "CALIFORNIA", matched nothing, and printed the GENERAL
// form on a California job. Nothing on the document says so; that is what makes
// it worth a check. Driven through lienWaiverDocContext, the resolver the
// screen actually calls, rather than through normalizeState directly.
for (const [written, code, citation] of [
  ['California', 'CA', 'Cal. Civ. Code'], ['texas', 'TX', 'Tex. Prop. Code'],
  ['  fl  ', 'FL', 'Fla. Stat.'], ['Georgia', 'GA', 'O.C.G.A.'], ['Arizona', 'AZ', 'A.R.S.'],
] as const) {
  const ctx = lienWaiverDocContext({
    name: 'P', location: null,
    structuredAddress: { street: '1 A St', city: 'Town', state: written, zip: '00000' },
  });
  const html = buildLienWaiverHtml(waiver('conditional_partial'), BRANDING, ctx);
  ok(`a structured state written "${written}" still gets ${code}'s statutory form`,
    ctx.jobsiteState === code && html.includes(esc(citation))
    && !html.includes(esc(GENERIC_FORM_WARNING)),
    `resolved to "${ctx.jobsiteState}"`);
}
// …and an unrecognisable one lands on the general form, never on a guess.
{
  const ctx = lienWaiverDocContext({
    name: 'P', location: null,
    structuredAddress: { street: '1 A St', city: 'Town', state: 'Ontario', zip: '' },
  });
  ok('an unrecognisable state falls back to the general form',
    ctx.jobsiteState === ''
    && buildLienWaiverHtml(waiver('conditional_partial'), BRANDING, ctx).includes(esc(GENERIC_FORM_WARNING)),
    `resolved to "${ctx.jobsiteState}"`);
}

const CITATION_OF: Record<WaiverStateCode, RegExp> = {
  CA: /Cal\. Civ\. Code/, TX: /Tex\. Prop\. Code/, FL: /Fla\. Stat\./,
  GA: /O\.C\.G\.A\./, AZ: /A\.R\.S\./,
};
for (const state of STATUTORY_WAIVER_STATES) {
  const label = lienWaiverFormLabel(waiver('unconditional_partial'), lienWaiverDocContext(projectIn(state)));
  const others = STATUTORY_WAIVER_STATES.filter(s => s !== state);
  ok(`${state} shows its own citation and no other state's`,
    CITATION_OF[state].test(label) && others.every(o => !CITATION_OF[o].test(label)),
    `label was "${label}"`);
}
ok('a job with no resolvable state is labelled General form',
  lienWaiverFormLabel(waiver('unconditional_partial'), lienWaiverDocContext({ name: 'X', location: '' })) === 'General form');

// ─────────────────────────────────────────────────────────────────────
// E. The document never presents a GC's record as the sub's signature
// ─────────────────────────────────────────────────────────────────────
console.log('\nwho signed is stated truthfully:');

const gcRecorded = renderFor('NY', 'unconditional_partial', {
  subSignature: { name: 'Volt Electric LLC', role: 'gc', signedAt: '2026-09-01T12:00:00.000Z' },
});
ok('a GC-recorded paper waiver is not labelled as the sub signing',
  !gcRecorded.includes('Signed by the subcontractor'),
  'this is the exact misstatement the audit found: the GC typed the sub\'s name and the PDF called it the sub\'s signature');
ok('a GC-recorded paper waiver says it is a record of a paper original',
  /Recorded by the contractor from a signed paper original/.test(gcRecorded)
  // Apostrophe-agnostic on purpose. This is STATIC copy in a template literal,
  // not user data, so it reaches the page as a raw `'` — and asserting one
  // particular encoding tests the escaper rather than the claim. Both forms
  // accepted so routing this copy through an escaper later cannot break a
  // check about what the document SAYS.
  && /not the subcontractor(?:&#0*39;|&apos;|['\u2019])s signature/.test(gcRecorded),
  'the disclaimer that this is the GC\'s record and NOT the sub\'s signature is the whole point of the branch');

const subSigned = renderFor('NY', 'unconditional_partial', {
  subSignature: { name: 'Volt Electric LLC', role: 'sub', signedAt: '2026-09-01T12:00:00.000Z' },
});
ok('a sub-signed waiver IS labelled as the sub signing',
  subSigned.includes('Signed by the subcontractor')
  && !/Recorded by the contractor/.test(subSigned));

// Comment-stripped: see liveCode. A commented-out call is not a wired screen.
const screen = liveCode(read('app/lien-waivers.tsx'));
ok('the GC screen never writes role: \'sub\'', !/role:\s*'sub'/.test(screen),
  'only the token-gated signing page may record the subcontractor as the signer');
ok('the GC screen labels the paper path as a paper record',
  // Anchored to the BUTTON and to the PROMPT. A bare /Record paper waiver/ also
  // matched the sentence inside the not-provisioned alert, so renaming the
  // button back to "Mark signed" — the exact misstatement this wave removed —
  // still passed.
  /actionSecondaryText}>Record paper waiver</.test(screen)
  && /showPrompt\(\s*\n?\s*'Record a paper waiver'/.test(screen)
  && !/>Mark signed</.test(screen),
  'the button and its prompt must both say what is being recorded');

// ─────────────────────────────────────────────────────────────────────
// F. The request → sign loop actually exists in code
// ─────────────────────────────────────────────────────────────────────
console.log('\nthe request-and-sign loop is wired end to end:');

const engine = liveCode(read('utils/lienWaiverEngine.ts'));
const signPagePath = 'marketing/lien-waiver/index.html';
const signPageExists = existsSync(join(ROOT, signPagePath));
ok('the signing page exists', signPageExists, `${signPagePath} is missing`);
const signPage = signPageExists ? read(signPagePath) : '';

function constantIn(src: string, name: string): string {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*'([^']+)'`));
  return m ? m[1] : '';
}
const FETCH_RPC = constantIn(engine, 'LIEN_WAIVER_FETCH_RPC');
const SIGN_RPC = constantIn(engine, 'LIEN_WAIVER_SIGN_RPC');
ok('the engine names both RPCs', !!FETCH_RPC && !!SIGN_RPC,
  `fetch="${FETCH_RPC}" sign="${SIGN_RPC}"`);

ok('the engine sends the waiver to the sub\'s own email address',
  /export async function requestLienWaiverSignature/.test(engine)
  && /waiver\.subEmail/.test(engine)
  && /sendEmail\(/.test(engine),
  'subEmail was captured and never used — that is the defect');
ok('the engine mints a per-waiver token and refuses a token-less link',
  /mintSignToken/.test(engine) && /if \(!id \|\| !t\) return null;/.test(engine));
ok('the engine seals the document the sub will sign',
  /sign_document_html/.test(engine) && /buildLienWaiverSignableHtml/.test(engine),
  'the signature has to attach to specific bytes, not to a form regenerated later');
ok('a composer-only send is not reported as sent',
  /if \(!result\.success\) return \{ outcome: 'email_failed'/.test(engine));

ok('the signing page reads the access token from ?t=', /\?t=|get\('t'\)/.test(signPage));
ok('the signing page calls both RPCs by the engine\'s names',
  !!FETCH_RPC && signPage.includes(FETCH_RPC) && !!SIGN_RPC && signPage.includes(SIGN_RPC),
  'the page and the app must agree on the RPC contract');
ok('the signing page posts a signer name and signature strokes',
  /p_signer_name/.test(signPage) && /p_signature_paths/.test(signPage) && /p_consent_accepted/.test(signPage));
ok('the signing page renders the sealed document rather than rebuilding the form',
  /document_html/.test(signPage) && /srcdoc/.test(signPage),
  'a second copy of the statutory wording in JavaScript would drift, and a drifted statutory form is void');

// A second copy of the statutory text on the page is the drift this guard is
// most afraid of, so it is checked rather than trusted.
for (const [name, notice] of [['CA', NOTICE_CA_UNCONDITIONAL], ['GA', NOTICE_GA],
  ['TX', NOTICE_TX_UNCONDITIONAL_FINAL], ['AZ', NOTICE_AZ_UNCONDITIONAL]] as const) {
  ok(`the signing page carries no second copy of the ${name} statutory notice`,
    !signPage.includes(notice.slice(0, 60)));
}

// The write that stores the token is CHECKED before a single email goes out.
//
// A PostgREST update that matches no row answers 204 with `error: null` —
// byte-identical to a successful one. Without a `.select()` the engine mailed
// the sub a link whose token the server had never stored and told the GC it was
// sent; the sub then opened it and read "this link no longer works", which is
// the one sentence on that page that was not true. Pinned to all four pieces:
// the two filters that re-ask the stale client's questions of the row itself,
// the select that makes the result observable, and the branch that refuses to
// report a send when nothing was written.
for (const [what, pattern] of [
  ['re-checks signed_at on the row, not on the screen\'s stale copy', /\.is\('signed_at', null\)/],
  ['re-checks voided on the row', /\.neq\('status', 'voided'\)/],
  ['reads back the row it claims to have updated', /\.select\('id'\)\s*\n?\s*\.maybeSingle\(\)/],
  ['refuses to report a send when no row was written', /if \(!stored\) \{/],
] as const) {
  ok(`the signing request ${what}`, pattern.test(engine),
    'an unchecked update reports "sent" for a link the server never stored');
}
// …and the no-row branch has to end somewhere other than 'sent'. A `!stored`
// guard that fell through would satisfy the grep above and change nothing.
{
  const branch = engine.slice(engine.indexOf('if (!stored) {'), engine.indexOf('const companyName'));
  ok('the no-row branch returns a refusal for each reason it can distinguish',
    /outcome: 'already_signed'/.test(branch) && /outcome: 'voided'/.test(branch)
    && /outcome: 'failed'/.test(branch) && !/outcome: 'sent'/.test(branch),
    branch.slice(0, 200));
}

// A refusal has to name a remedy the product actually has. `subEmail` is
// settable only in the New Waiver modal and a saved waiver has no edit screen
// anywhere in this app, so "fix it on the waiver and try again" sent the GC
// looking for a form that does not exist — their only real route was to delete
// the waiver and retype it. The branch now asks for the address and saves it.
ok('a waiver with no usable email is offered a way to add one, not sent to a screen that does not exist',
  /const saveEmailThenRequest = useCallback/.test(screen)
  && /saveLienWaiver\(\{ \.\.\.w, id: w\.id, subEmail: email \}\)/.test(screen)
  && /showPrompt\(\s*\n\s*w\.subEmail \? 'That address will not send'/.test(screen)
  && !/Fix it on the waiver/.test(screen),
  'the only way to reach subEmail is the New Waiver modal');

ok('the GC screen wires the request action to a press',
  // The CALL, not the name: the name is also in this file's header comment and
  // in the import line, and both survived the call being ripped out.
  /await requestLienWaiverSignature\(/.test(screen)
  && /onPress=\{onRequestSignature\}/.test(screen)
  && /Request signature/.test(screen));

// BOTH files, not one. Netlify processes netlify.toml first and it ends in a
// `/*` → /404.html catch-all, so a rewrite that lives in only one of the two is
// a 404 waiting on whichever file wins — the lesson netlify.toml's own
// bid-invite comment records. The emailed link addresses the directory and so
// survives losing both, but a path-form link in a sub's inbox does not.
const redirects = read('marketing/_redirects');
ok('/lien-waiver/* routes to the signing page in _redirects',
  /^\/lien-waiver\/\*\s+\/lien-waiver\/index\.html\s+200/m.test(redirects),
  'without the rule the catch-all serves a 404 to every sub we email');
const netlifyToml = read('marketing/netlify.toml');
ok('/lien-waiver/* is in netlify.toml as well',
  /from\s*=\s*"\/lien-waiver\/\*"\s*\n\s*to\s*=\s*"\/lien-waiver\/index\.html"/.test(netlifyToml),
  'netlify.toml is processed FIRST and its /* catch-all is a 404');

// ─────────────────────────────────────────────────────────────────────
// F2. The sealed form identity reaches the sub
//
// `sign_form_meta` is the one column in this feature that nothing would notice
// going wrong: the page falls back to a bare "Lien waiver" with no citation,
// and the document underneath still looks right. The build agent shipped the
// column, the RPC that reads it and the page that renders it — and no writer.
// So this section pins the WHOLE chain: the keys TypeScript writes, the keys
// the SQL reads, and the names the page prints, all three compared to each
// other rather than each to a copy of itself.
// ─────────────────────────────────────────────────────────────────────
console.log('\nthe sealed form identity survives from TypeScript to the sub:');

const MIGRATION = 'supabase/migrations/20260908120200_lien_waiver_signing.sql';
// liveSql: the keys this section extracts must come from the RPC bodies, not
// from the `--` comment block above them that also names all three.
const migration = existsSync(join(ROOT, MIGRATION)) ? liveSql(read(MIGRATION)) : '';
ok('the signing migration is in the tree', !!migration, `${MIGRATION} is missing`);

// What the SQL actually pulls out of the column, read off the migration rather
// than restated here — a literal list would be the second copy that drifts.
const sqlMetaKeys = [...new Set(
  [...migration.matchAll(/sign_form_meta->>'([a-z_]+)'/g)].map(m => m[1]),
)].sort();
ok('the RPC reads three fields out of sign_form_meta', sqlMetaKeys.length === 3,
  `read: ${sqlMetaKeys.join(', ')}`);

// The keys the app writes come from CALLING the function, not from grepping it.
const metaCA = lienWaiverFormMeta(waiver('unconditional_partial'), BRANDING, lienWaiverDocContext(projectIn('CA')));
const tsMetaKeys = Object.keys(metaCA).sort();
ok('the keys TypeScript seals are exactly the keys the SQL reads',
  tsMetaKeys.length === sqlMetaKeys.length && tsMetaKeys.every((k, i) => k === sqlMetaKeys[i]),
  `typescript: ${tsMetaKeys.join(', ')} | sql: ${sqlMetaKeys.join(', ')}`);

// …and the page prints all three. A field the page never reads is a citation
// nobody sees.
for (const key of sqlMetaKeys) {
  ok(`the signing page renders ${key}`, signPage.includes(`w.${key}`),
    'the RPC serves it and nothing displays it');
}

// The writer itself. `sign_document_html` without `sign_form_meta` is the state
// this wave was killed in.
ok('requestLienWaiverSignature seals sign_form_meta beside the document',
  /sign_form_meta:\s*formMeta/.test(engine) && /lienWaiverFormMeta\(/.test(engine),
  'the sub sees a bare "Lien waiver" with no citation on a document whose whole point is the citation');
ok('a database missing sign_form_meta is reported as not-provisioned, not as a bug',
  /sign_form_meta/.test(engine.slice(engine.indexOf('missingColumn'))) || /sign_form_meta[^\n]*\n[^\n]*missingColumn/.test(engine)
  || /missingColumn[\s\S]{0,300}sign_form_meta/.test(engine));

ok('a statutory job seals its citation and state', metaCA.statute_citation === 'Cal. Civ. Code § 8134'
  && metaCA.state_name === 'California' && metaCA.waiver_title.length > 0,
  JSON.stringify(metaCA));
const metaNY = lienWaiverFormMeta(waiver('unconditional_partial'), BRANDING, lienWaiverDocContext(projectIn('NY')));
ok('a general-form job seals a blank citation rather than a false one',
  metaNY.statute_citation === '' && metaNY.state_name === '' && metaNY.waiver_title.length > 0,
  JSON.stringify(metaNY));
// The page keys its "<state> statutory form · <citation>" eyebrow off the
// citation, so a blank citation must NOT come with a state name or a general
// form would announce itself as a statutory one.
ok('the page only claims a statutory form when there is a citation',
  /w\.statute_citation\s*\n?\s*\?/.test(signPage) || /if \(w\.statute_citation/.test(signPage),
  'the eyebrow has to be conditional on the citation, not on the state');

// Every `w.<field>` the page reads must be something the RPC returns, or it is
// a permanently blank line on a legal document.
const rpcReturn = new Set(
  [...migration.matchAll(/'([a-z_]+)',\s*(?:coalesce\(|v_w\.|v_proj|v_company|true)/g)].map(m => m[1]),
);
const pageFields = [...new Set([...signPage.matchAll(/\bw\.([a-z_]+)/g)].map(m => m[1]))]
  // `w` is also the `window` alias in the minified favicon URI and in
  // `window.*`; only the record fields matter here.
  .filter(f => !['add', 'device', 'location', 'open', 'w'].includes(f));
const unserved = pageFields.filter(f => !rpcReturn.has(f));
ok('every waiver field the page prints is one the RPC returns', unserved.length === 0,
  `not returned: ${unserved.join(', ')} | rpc returns: ${[...rpcReturn].join(', ')}`);

// ─────────────────────────────────────────────────────────────────────
// F3. The signature the sub draws reaches the PDF the GC prints
//
// The RPC declares `p_signature_paths text` and stores it with
// jsonb_build_object, so `sub_signature.signaturePaths` holds a STRING even
// though ContractSignature types it `string[]`. The renderer called `.map` on
// it and threw "signaturePaths.map is not a function" — taking down the PDF for
// exactly the waivers that had been signed.
// ─────────────────────────────────────────────────────────────────────
console.log('\nthe sub\'s drawn signature survives onto the printed waiver:');

ok('the page posts the strokes as text, matching the RPC\'s `text` parameter',
  /p_signature_paths:\s*JSON\.stringify\(paths\)/.test(signPage),
  'the RPC takes text; handing PostgREST a raw array leaves the stored encoding to chance');

const asJsonString = renderFor('NY', 'unconditional_partial', {
  subSignature: {
    name: 'Jordan Reyes', role: 'sub', signedAt: '2026-09-01T12:00:00.000Z',
    // The exact shape the RPC stores — a JSON array inside a JSON string.
    signaturePaths: '["M12.5 7.1 L20 30","M20 30 L40 55"]' as unknown as string[],
  },
});
ok('strokes stored as a JSON string are drawn, not thrown on',
  (asJsonString.match(/<path d=/g) ?? []).length === 2,
  'this threw TypeError before the fix and no signed waiver could be exported');
const asArray = renderFor('NY', 'unconditional_partial', {
  subSignature: {
    name: 'Jordan Reyes', role: 'sub', signedAt: '2026-09-01T12:00:00.000Z',
    signaturePaths: ['M0 0 L10 10'],
  },
});
ok('strokes stored as a real array still draw', (asArray.match(/<path d=/g) ?? []).length === 1);
for (const junk of ['', '   ', 'not json', '[', '[1,2,3]', '{"a":1}']) {
  const html = renderFor('NY', 'unconditional_partial', {
    subSignature: {
      name: 'Jordan Reyes', role: 'sub', signedAt: '2026-09-01T12:00:00.000Z',
      signaturePaths: junk as unknown as string[],
    },
  });
  ok(`a malformed stroke value (${JSON.stringify(junk)}) still prints the signature block`,
    html.includes('Jordan Reyes') && html.includes('Signed by the subcontractor'),
    'a bad strokes value must cost the drawing, never the document');
}

// ─────────────────────────────────────────────────────────────────────
// F4. Dates on the document are calendar days, and states have names
// ─────────────────────────────────────────────────────────────────────
console.log('\ncalendar days do not move and state names are not "undefined":');

// Pinned by EQUALITY against formatCalendarDay rather than by "the right day
// appears", because the wrong helper (fmtDate) renders the same day in half the
// world's timezones — a guard that only checks the day number is green on a CI
// box in UTC and red for the contractor in Los Angeles. fmtDate's long-month
// format never matches this, in any zone.
const THROUGH = '2026-08-31';
const dayCell = renderFor('NY', 'unconditional_partial').match(/Through Date<\/td>\s*<td[^>]*>([^<]*)</);
ok('the through date is rendered by formatCalendarDay, not by new Date()',
  !!dayCell && dayCell[1] === formatCalendarDay(THROUGH),
  `cell was "${dayCell ? dayCell[1] : '(not found)'}", expected "${formatCalendarDay(THROUGH)}"`);
ok('the through date on the document keeps the record\'s own day number',
  !!dayCell && dayCell[1].includes('31'),
  'UTC-midnight parsing printed the day BEFORE anywhere west of Greenwich');

// The amount appears TWICE on a statutory page — once in the statute's own
// blank and once in our facts table — and fmtMoney rounds to whole dollars by
// default. A release for $18,400.50 printed "$18,400.50" in § 8132's Amount of
// Check row and "$18,401" three inches below it: one release, two amounts, the
// rounded one higher than the claimant was actually paid. Checked by rendering
// a figure with cents in it, because a fixture with a round number cannot tell
// the two formatters apart — the exact blindness that let this ship.
{
  const CENTS = 18400.5;
  const html = renderFor('CA', 'conditional_partial', { paidAmount: CENTS });
  const statutoryBlank = (html.match(/Amount of Check<\/td>\s*<td[^>]*>([^<]*)</) ?? ['', ''])[1].trim();
  const factsRow = (html.match(/Payment Amount<\/td>\s*<td[^>]*>([^<]*)</) ?? ['', ''])[1].trim();
  ok('the statutory blank and our own facts row state the SAME amount',
    statutoryBlank === factsRow && factsRow === '$18,400.50',
    `statute="${statutoryBlank}" facts="${factsRow}"`);
}
ok('the email tells the sub the amount to the cent, like the document does',
  /fmtMoney\(waiver\.paidAmount, \{ decimals: 2 \}\)/.test(engine),
  'fmtMoney rounds by default; a rounded figure in the email disagrees with the waiver');

ok('a lowercase state code still gets a state NAME',
  statutoryStateName('ca') === 'California' && statutoryStateName(' tx ') === 'Texas',
  'isStatutoryWaiverState accepts "ca"; a bare Record lookup on it rendered "This jobsite is in undefined."');
ok('an unknown state code never renders as "undefined"',
  statutoryStateName('ZZ') === 'ZZ' && statutoryStateName('') === '' && statutoryStateName(undefined) === '');

// ─────────────────────────────────────────────────────────────────────
// F5. The signing page's own promises
// ─────────────────────────────────────────────────────────────────────
console.log('\nthe signing page tells the sub what actually happened:');

for (const [what, pattern] of [
  ['a link with no ?t=', /This link is incomplete/],
  // Pinned by the SENTENCE, not by the error constant: `lien_waiver_denied`
  // also appears in the submit handler and in a comment, so deleting the load
  // branch left a grep for the constant still passing.
  ['a revoked or replaced token on load', /This link no longer works/],
  ['the revoked-token error code by name', /indexOf\('lien_waiver_denied'\)/],
  ['a database without the migration', /Signing is not switched on yet/],
  ['a waiver that is already signed', /already signed/i],
  ['a waiver the GC voided', /voided/i],
  ['no connection', /could not reach the server/i],
  ['a submit that did not go through', /nothing has been signed/i],
  ['an unticked consent box', /lien_waiver_consent_required/],
  ['a blocked pop-up on the download', /blocked the new window/i],
] as const) {
  ok(`the page handles ${what}`, pattern.test(signPage),
    'a state with no sentence of its own is a sub emailing the GC instead of signing');
}
ok('a failure looks like one, not like a page still loading',
  /classList\.remove\('bad', 'warn', 'ok'\)/.test(signPage) && /\.card\.bad/.test(signPage));
ok('the page does not claim the contractor was emailed the signed copy',
  !/contractor has been sent/i.test(signPage),
  'nothing mails the GC; the signature lands on the waiver and they see it in the app');

// The consent version is stamped into every stored signature. Two copies of it
// exist by necessity (a static page cannot import TypeScript), so they are
// compared rather than trusted.
const enginePageConsent = constantIn(engine, 'LIEN_WAIVER_CONSENT_VERSION');
const pageConsent = (signPage.match(/var CONSENT_VERSION\s*=\s*'([^']+)'/) ?? [])[1] ?? '';
ok('the page and the app stamp the SAME consent version',
  !!enginePageConsent && enginePageConsent === pageConsent,
  `engine="${enginePageConsent}" page="${pageConsent}"`);

// A signed release is finished. Re-requesting mints a new token, seals a new
// document over the signed one and resets the status.
ok('the engine refuses to re-request a waiver that is already signed',
  /already_signed/.test(engine) && /waiver\.signedAt \|\| waiver\.subSignature/.test(engine));

// ─────────────────────────────────────────────────────────────────────
// F6. The signing page, RUN
//
// Everything above about the page is a grep, and a grep cannot tell a live
// branch from a dead one. Deleting the load handler's revoked-token branch left
// both its sentence and its error constant sitting in the file, and every
// presence check went on passing — the same shape of hole this repo has shipped
// before. So the page's script is executed here against a stub DOM and a stub
// Supabase, and what the subcontractor would actually READ is asserted.
//
// The shim is deliberately tiny. It is not a browser; it is enough of one to
// prove which sentence lands on screen for a given answer from the server.
// ─────────────────────────────────────────────────────────────────────
console.log('\nthe signing page, executed against a stubbed server:');

const pageScript = (signPage.match(/<script>\n([\s\S]*?)\n<\/script>/) ?? [])[1] ?? '';
ok('the page\'s script can be extracted and run', pageScript.length > 500);
ok('the signing form and the done card start hidden in the markup',
  startsHidden('signing') && startsHidden('done'),
  'without the attribute every sub sees "your waiver is signed" before they have signed anything');

interface StubEl {
  hidden: boolean; textContent: string; innerHTML: string; value: string; checked: boolean;
  disabled: boolean; style: Record<string, string>; width: number; height: number; clientWidth: number;
  classes: Set<string>; attrs: Record<string, string>; listeners: Record<string, ((e?: unknown) => void)[]>;
  classList: { add: (...c: string[]) => void; remove: (...c: string[]) => void; contains: (c: string) => boolean };
  setAttribute: (k: string, v: string) => void; getAttribute: (k: string) => string | undefined;
  addEventListener: (t: string, f: (e?: unknown) => void) => void;
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
  getContext: () => Record<string, unknown>;
  fire: (t: string) => void;
}

/** Which containers the MARKUP starts hidden. Read off the page rather than
 *  assumed, so dropping the `hidden` attribute from #done — which would flash
 *  the "your waiver is signed" card at every sub before they had signed
 *  anything — shows up here as a failure rather than as a shim that agrees. */
function startsHidden(id: string): boolean {
  return new RegExp(`id="${id}"[^>]*\\shidden`).test(signPage);
}

function stubEl(id: string): StubEl {
  const el = {
    hidden: startsHidden(id), textContent: '', innerHTML: '', value: '', checked: false, disabled: false,
    style: {} as Record<string, string>, width: 0, height: 0, clientWidth: 320,
    classes: new Set<string>(), attrs: {} as Record<string, string>,
    listeners: {} as Record<string, ((e?: unknown) => void)[]>,
    classList: {
      add: (...c: string[]) => c.forEach(x => el.classes.add(x)),
      remove: (...c: string[]) => c.forEach(x => el.classes.delete(x)),
      contains: (c: string) => el.classes.has(c),
    },
    setAttribute: (k: string, v: string) => { el.attrs[k] = v; },
    getAttribute: (k: string) => el.attrs[k],
    addEventListener: (t: string, f: (e?: unknown) => void) => { (el.listeners[t] ??= []).push(f); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 170 }),
    getContext: () => ({
      scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {},
      lineWidth: 0, lineCap: '', lineJoin: '', strokeStyle: '',
    }),
    fire: (t: string) => (el.listeners[t] ?? []).forEach(f => f({ preventDefault() {}, touches: null, clientX: 10, clientY: 10 })),
  };
  return el as StubEl;
}

type ServerAnswer = { status: number; body: unknown };
function runPage(
  pathname: string, search: string,
  answer: (payload: Record<string, unknown>) => ServerAnswer,
  opts?: { blockPopup?: boolean },
) {
  const els = new Map<string, StubEl>();
  const get = (id: string) => { if (!els.has(id)) els.set(id, stubEl(id)); return els.get(id)!; };
  const posted: Record<string, unknown>[] = [];
  // What the "open a copy" button writes into the new window, and whether the
  // browser let it have one. `blockPopup` reproduces a pop-up blocker, which is
  // the branch that used to fail silently and leave the sub with no copy.
  const written: string[] = [];
  const popup = opts?.blockPopup ? null : {
    document: { write: (h: string) => { written.push(h); }, close() {} },
    print() {},
  };
  const sandbox: Record<string, unknown> = {
    window: {
      location: { pathname, search }, addEventListener() {}, devicePixelRatio: 1,
      open: () => popup, URLSearchParams,
    },
    document: { getElementById: get },
    navigator: { userAgent: 'validator/1.0' },
    fetch: (_url: string, init: { body: string }) => {
      const payload = JSON.parse(init.body) as Record<string, unknown>;
      posted.push(payload);
      const a = answer(payload);
      return Promise.resolve({
        ok: a.status >= 200 && a.status < 300, status: a.status,
        text: () => Promise.resolve(JSON.stringify(a.body)),
      });
    },
    URLSearchParams, JSON, Math, Date, isFinite, Number, String, RegExp, Array, Object,
    console: { log() {}, warn() {}, error() {} }, setTimeout, parseFloat, isNaN,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(pageScript, sandbox);
  return { get, posted, written };
}

const TOKEN = 'x'.repeat(64);
const LOADED = {
  ok: true, id: 'w1', status: 'requested', signed_at: null, sub_name: 'Volt Electric LLC',
  paid_amount: 18400, through_date: '2026-08-31', waiver_type: 'unconditional_partial',
  project_name: 'Henderson Remodel', company_name: 'Hallway Homes LLC',
  waiver_title: 'UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT',
  statute_citation: 'Cal. Civ. Code § 8134', state_name: 'California',
  document_html: '<html><body>SEALED BYTES</body></html>',
};
const settle = () => new Promise<void>(r => setTimeout(r, 0));

// Each scenario names the sentence the sub must end up reading, and the tint the
// card must be wearing. A branch that is present but unreachable fails here.
const LOAD_CASES: { name: string; path: string; search: string; answer: ServerAnswer; title: RegExp; tint: string; mustSay: RegExp }[] = [
  {
    name: 'a link with the token stripped off', path: '/lien-waiver/w1', search: '',
    answer: { status: 200, body: LOADED }, title: /incomplete/i, tint: 'warn',
    mustSay: /resend|email again/i,
  },
  {
    name: 'a revoked or replaced token', path: '/lien-waiver/w1', search: `?t=${TOKEN}`,
    answer: { status: 400, body: { code: 'P0001', message: 'lien_waiver_denied', details: null, hint: null } },
    title: /no longer works/i, tint: 'bad', mustSay: /resend|most recent email/i,
  },
  {
    name: 'the RPCs not deployed yet', path: '/lien-waiver/w1', search: `?t=${TOKEN}`,
    answer: { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } },
    title: /not switched on/i, tint: 'warn', mustSay: /PDF/,
  },
  {
    name: 'the server falling over', path: '/lien-waiver/w1', search: `?t=${TOKEN}`,
    answer: { status: 500, body: { message: 'boom' } },
    title: /could not open/i, tint: 'bad', mustSay: /reload|resend/i,
  },
  {
    name: 'a waiver already signed', path: '/lien-waiver/w1', search: `?t=${TOKEN}`,
    answer: { status: 200, body: { ...LOADED, status: 'signed', signed_at: '2026-09-01T12:00:00.000Z' } },
    title: /already signed/i, tint: 'ok', mustSay: /nothing more to do/i,
  },
  {
    name: 'a waiver the GC voided', path: '/lien-waiver/w1', search: `?t=${TOKEN}`,
    answer: { status: 200, body: { ...LOADED, status: 'voided' } },
    title: /voided/i, tint: 'warn', mustSay: /nothing to sign/i,
  },
];

for (const c of LOAD_CASES) {
  const r = runPage(c.path, c.search, () => c.answer);
  await settle();
  const title = r.get('state-title').textContent;
  const body = r.get('state-body').textContent;
  ok(`${c.name} lands on its own sentence`,
    c.title.test(title) && c.mustSay.test(body) && r.get('signing').hidden === true,
    `title="${title}" body="${body}"`);
  ok(`${c.name} is tinted "${c.tint}", not left looking like a page still loading`,
    r.get('state-card').classList.contains(c.tint),
    `classes: ${[...r.get('state-card').classes].join(',') || '(none)'}`);
}

// The happy path: the SEALED bytes in the frame, the sealed identity in the
// chrome, the calendar day unmoved, and the button refusing to enable until the
// sub has actually done all three things.
{
  const r = runPage('/lien-waiver/w1', `?t=${TOKEN}`, () => ({ status: 200, body: LOADED }));
  await settle();
  ok('the frame is handed the sealed bytes, not a rebuilt form',
    r.get('doc-frame').getAttribute('srcdoc') === LOADED.document_html);
  ok('the sealed form identity is what the sub reads at the top of the page',
    r.get('form-eyebrow').textContent === 'California statutory form · Cal. Civ. Code § 8134'
    && r.get('doc-title').textContent === LOADED.waiver_title,
    `eyebrow="${r.get('form-eyebrow').textContent}" title="${r.get('doc-title').textContent}"`);
  ok('the through date on the page is the record\'s own calendar day',
    r.get('facts').innerHTML.includes(formatCalendarDay(LOADED.through_date)),
    r.get('facts').innerHTML);
  ok('signing is disabled until name + strokes + consent are all present',
    r.get('submit').disabled === true && /tick the consent box/i.test(r.get('submit-note').textContent));

  r.get('pad').fire('mousedown'); r.get('pad').fire('mousemove'); r.get('pad').fire('touchend');
  r.get('signer-name').value = 'Jordan Reyes'; r.get('signer-name').fire('input');
  ok('a signature and a name alone are not enough — consent is required',
    r.get('submit').disabled === true);
  r.get('consent').checked = true; r.get('consent').fire('change');
  ok('with all three the button enables', r.get('submit').disabled === false);
}

// The eyebrow is keyed off the CITATION, never the state name. A general-form
// job seals both blank (checked above), so the only way a state can arrive
// without a citation is a hand-written or half-migrated row — and on that row
// the line must not claim a statutory form, nor render as a bare " · ".
for (const [name, seal, expect] of [
  ['a sealed statutory form', { statute_citation: 'Cal. Civ. Code § 8134', state_name: 'California' },
    'California statutory form · Cal. Civ. Code § 8134'],
  ['a citation with no state name', { statute_citation: 'Cal. Civ. Code § 8134', state_name: '' },
    'Statutory form · Cal. Civ. Code § 8134'],
  ['a state name with no citation', { statute_citation: '', state_name: 'California' },
    'General-form lien waiver'],
  ['neither', { statute_citation: '', state_name: '' }, 'General-form lien waiver'],
] as const) {
  const r = runPage('/lien-waiver/', `?w=w1&t=${TOKEN}`, () => ({ status: 200, body: { ...LOADED, ...seal } }));
  await settle();
  const line = r.get('form-eyebrow').textContent;
  ok(`the eyebrow for ${name} reads "${expect}"`, line === expect, `read "${line}"`);
}

// The submit half: what is posted, and what each refusal tells the signer.
const SUBMIT_CASES: { name: string; message: string; note: RegExp }[] = [
  { name: 'an unticked consent box refused server-side', message: 'lien_waiver_consent_required', note: /tick the box/i },
  { name: 'an empty signer name refused server-side', message: 'lien_waiver_signer_required', note: /full legal name/i },
  { name: 'a link replaced while the sub was reading', message: 'lien_waiver_denied', note: /most recent email/i },
  { name: 'anything else going wrong', message: 'some other failure', note: /try again/i },
];
for (const c of SUBMIT_CASES) {
  const r = runPage('/lien-waiver/w1', `?t=${TOKEN}`, (payload) =>
    payload.p_signer_name === undefined
      ? { status: 200, body: LOADED }
      : { status: 400, body: { code: 'P0001', message: c.message } });
  await settle();
  r.get('pad').fire('mousedown'); r.get('pad').fire('mousemove'); r.get('pad').fire('touchend');
  r.get('signer-name').value = 'Jordan Reyes'; r.get('signer-name').fire('input');
  r.get('consent').checked = true; r.get('consent').fire('change');
  r.get('submit').fire('click');
  await settle();
  ok(`${c.name} tells the signer what to do about it`, c.note.test(r.get('submit-note').textContent),
    `note was "${r.get('submit-note').textContent}"`);
  ok(`${c.name} leaves the button pressable and says nothing was signed`,
    r.get('submit').disabled === false && r.get('done').hidden === true
    && /nothing has been signed/i.test(r.get('submit-note').textContent));
}

{
  const r = runPage('/lien-waiver/w1', `?t=${TOKEN}`, (payload) =>
    payload.p_signer_name === undefined
      ? { status: 200, body: LOADED }
      : { status: 200, body: { ok: true, already_signed: false, signed_at: '2026-09-02T09:00:00.000Z' } });
  await settle();
  r.get('pad').fire('mousedown'); r.get('pad').fire('mousemove'); r.get('pad').fire('touchend');
  r.get('signer-name').value = 'Jordan Reyes'; r.get('signer-name').fire('input');
  r.get('consent').checked = true; r.get('consent').fire('change');
  r.get('submit').fire('click');
  await settle();
  const submitted = r.posted[r.posted.length - 1];
  ok('the strokes are posted as text, the type the RPC declares',
    typeof submitted.p_signature_paths === 'string'
    && Array.isArray(JSON.parse(submitted.p_signature_paths as string)),
    `typeof=${typeof submitted.p_signature_paths}`);
  ok('the consent record, version and acceptance all go with the signature',
    submitted.p_consent_accepted === true
    && typeof submitted.p_consent_record === 'string'
    && (submitted.p_consent_record as string).includes('E-SIGN')
    && submitted.p_consent_version === pageConsentVersion(),
    JSON.stringify({ v: submitted.p_consent_version }));
  ok('the token — not just the id — is what the page sends',
    submitted.p_access_token === TOKEN && submitted.p_waiver_id === 'w1');
  ok('a successful signature swaps the form for the done card',
    r.get('done').hidden === false && r.get('signing').hidden === true
    && /can see it on this job/i.test(r.get('done-body').textContent),
    r.get('done-body').textContent);
  ok('the done card does not tell the sub the contractor was emailed',
    !/sent|emailed/i.test(r.get('done-body').textContent + ' ' + r.get('done-note').textContent),
    'nothing mails the GC — the signature lands on the waiver and they see it in the app');

  // The copy the signer keeps. E-SIGN's whole bargain is that the signer can
  // retain the record, and the SEALED bytes were composed before the signature
  // existed — so a bare copy of them is indistinguishable from the unsigned
  // document that arrived by email.
  r.get('download').fire('click');
  const copy = r.written.join('');
  ok('the saved copy contains the sealed document', copy.includes('SEALED BYTES'), copy.slice(0, 200));
  ok('the saved copy attests to the signature that was just made',
    /Signed electronically/.test(copy) && copy.includes('Jordan Reyes')
    && copy.includes(pageConsentVersion()),
    'the sub keeps a copy that cannot be told from the unsigned one they were sent');
}

// A blocked pop-up must say so on screen. Grepping for the sentence passed even
// when the branch was unreachable, so it is driven here instead.
{
  const r = runPage('/lien-waiver/w1', `?t=${TOKEN}`, (payload) =>
    payload.p_signer_name === undefined
      ? { status: 200, body: LOADED }
      : { status: 200, body: { ok: true, already_signed: false, signed_at: '2026-09-02T09:00:00.000Z' } },
    { blockPopup: true });
  await settle();
  r.get('pad').fire('mousedown'); r.get('pad').fire('mousemove'); r.get('pad').fire('touchend');
  r.get('signer-name').value = 'Jordan Reyes'; r.get('signer-name').fire('input');
  r.get('consent').checked = true; r.get('consent').fire('change');
  r.get('submit').fire('click');
  await settle();
  r.get('download').fire('click');
  ok('a blocked pop-up tells the sub what to do instead of failing silently',
    /blocked the new window/i.test(r.get('done-note').textContent)
    && /screenshot|allow pop-ups/i.test(r.get('done-note').textContent),
    r.get('done-note').textContent);
}

function pageConsentVersion(): string {
  return (signPage.match(/var CONSENT_VERSION\s*=\s*'([^']+)'/) ?? [])[1] ?? '';
}

// ─────────────────────────────────────────────────────────────────────
// F7. The four defects the adversarial review of this wave found
//
// None of these had a check. Each was live in the build that was killed, and
// each is invisible on a screen: the document still prints, the guard was still
// green, and only the sub or a court would ever notice.
// ─────────────────────────────────────────────────────────────────────
console.log('\nthe review\'s own findings stay fixed:');

// 1. THE PROPERTY DESCRIPTION. jobsiteAddressForProject only PARSES a free-text
// location, so "124 Main St, Springfield CA 90210" comes back with city and
// state and NO street. Printing the parse dropped the house number off the one
// line a Florida § 713.20 release uses to identify the property.
const freeTextCtx = lienWaiverDocContext({ name: 'Henderson Remodel', location: '124 Main St, Springfield CA 90210' });
ok('a free-text jobsite address keeps its street on the document',
  freeTextCtx.projectAddress === '124 Main St, Springfield CA 90210',
  `address was "${freeTextCtx.projectAddress}" — the parse drops the street`);
// Rendered from that same context, so the two halves cannot drift: the address
// the resolver produces is the address the § 8132 blank prints.
const freeTextHtml = buildLienWaiverHtml(waiver('conditional_partial'), BRANDING, freeTextCtx);
const freeTextBlank = (freeTextHtml.match(/Job Location<\/td>\s*<td[^>]*>([^<]*)</) ?? ['', ''])[1];
ok('and the street reaches the statutory Job Location blank',
  // Both halves: the blank agrees with the resolver AND the street survives.
  // Comparing them to each other alone would pass while both lost the street.
  freeTextBlank === freeTextCtx.projectAddress && freeTextBlank.includes('124 Main St'),
  `blank read "${(freeTextHtml.match(/Job Location<\/td>\s*<td[^>]*>([^<]*)</) ?? ['', '(not found)'])[1]}" — a lien release that does not identify the property is the document's whole job, undone`);
// …while a structured address, which DOES carry a street, still wins over the
// stale free-text field it replaced.
const structuredCtx = lienWaiverDocContext({
  name: 'X', location: 'stale free text nobody updated',
  structuredAddress: { street: '9 Elm St', city: 'Buffalo', state: 'NY', zip: '14201' },
});
ok('a structured address still beats the free-text field',
  structuredCtx.projectAddress === '9 Elm St, Buffalo, NY 14201' && structuredCtx.jobsiteState === 'NY',
  JSON.stringify(structuredCtx));

// 2. THE SIGNATURE THE GC'S OWN SAVE USED TO ERASE. Every caller of
// saveLienWaiver spreads the copy the screen loaded, and that copy goes stale
// the moment the sub signs remotely. `sub_signature: w.subSignature ?? null`
// meant Void or Mark received on a stale card wrote null over the real
// signature.
for (const col of ['sub_signature', 'signed_at', 'signed_pdf_url'] as const) {
  ok(`saveLienWaiver never coerces ${col} to null`,
    !new RegExp(`${col}:\\s*w\\.\\w+\\s*\\?\\?\\s*null`).test(engine),
    'a stale client copy would erase a signature the sub really gave');
}
ok('saveLienWaiver writes the signature columns only when it has them',
  /\.\.\.\(w\.subSignature !== undefined \? \{ sub_signature: w\.subSignature \} : \{\}\)/.test(engine));

// 3. THE LINK'S OWN URL. marketing/netlify.toml ends in a `/*` → /404.html
// catch-all and is processed BEFORE marketing/_redirects, which is why every
// path-segment page in this product is listed in both files. /lien-waiver is in
// _redirects only, so a /lien-waiver/<id> link 404s for every sub.
const signBase = constantIn(engine, 'LIEN_WAIVER_SIGN_BASE_URL');
ok('the signing link addresses the page as a directory',
  /\/lien-waiver\/$/.test(signBase), `base was "${signBase}"`);
ok('the waiver id rides in the query string, not in the path',
  /\?w=\$\{encodeURIComponent\(id\)\}&t=\$\{encodeURIComponent\(t\)\}/.test(engine),
  'a path-segment id depends on a redirect rule netlify.toml does not carry');
// …and the page is RUN against that exact link, built from the engine's own
// base constant. A grep on either side can pass while the other half stops
// agreeing; this fails unless the URL the GC's app mails actually opens.
{
  const emailed = new URL(`${signBase || 'https://mageid.app/lien-waiver/'}?w=w1&t=${TOKEN}`);
  const r = runPage(emailed.pathname, emailed.search, () => ({ status: 200, body: LOADED }));
  await settle();
  ok('the link the engine builds opens the document on the page',
    r.get('signing').hidden === false
    && r.get('doc-frame').getAttribute('srcdoc') === LOADED.document_html,
    `pathname="${emailed.pathname}" search="${emailed.search}"`);
  ok('the id it read from ?w= is the id it asks the server for',
    r.posted.length > 0 && r.posted[0].p_waiver_id === 'w1' && r.posted[0].p_access_token === TOKEN,
    JSON.stringify(r.posted[0] ?? null));
}
// The older /lien-waiver/<id>?t= shape keeps working, so a link already in a
// sub's inbox does not die the day this changes.
{
  const r = runPage('/lien-waiver/w1', `?t=${TOKEN}`, () => ({ status: 200, body: LOADED }));
  await settle();
  ok('a path-form link already in an inbox still opens',
    r.get('signing').hidden === false && r.posted[0]?.p_waiver_id === 'w1');
}

// 4. THE TITLE THE SUB TYPES. The page asks for it and the RPC stores it; the
// document printed the name alone, so a release came back with no statement of
// the authority it was signed under.
const titled = renderFor('NY', 'unconditional_partial', {
  subSignature: {
    name: 'Jordan Reyes', role: 'sub', signedAt: '2026-09-01T12:00:00.000Z',
    // As `lien_waiver_submit_signature` stores it. ContractSignature does not
    // declare `title`, which is exactly why the renderer has to read it
    // structurally rather than through the type.
    ...({ title: 'Managing Member' } as object),
  } as never,
});
ok('the title the sub typed is printed with their signature', titled.includes('Managing Member'),
  'collected, stored, and thrown away is the same defect as subEmail was');
ok('a signature with no title prints no empty separator',
  !/· <\/div>|·\s*<\/div>/.test(renderFor('NY', 'unconditional_partial', {
    subSignature: { name: 'Jordan Reyes', role: 'sub', signedAt: '2026-09-01T12:00:00.000Z' },
  })));
ok('the page collects a title to print', /id="signer-title"/.test(signPage) && /p_signer_title/.test(signPage));

// 5. THE SCOPE OF THE RELEASE. Texas asks for it four times — "to the
// following extent: ____ (job description)" — and Georgia's form opens on
// "employed by ___ to furnish ____ (describe materials and/or labor)". That
// blank IS the extent of the waiver. LienWaiverDocContext declared the field
// and the forms threaded it, and the screen called lienWaiverDocContext(project)
// with no extras — so every Texas release this product printed described its
// own scope as a line of underscores.
//
// Which forms carry the blank is DERIVED from the rendered page, not listed
// here: California, Florida and Arizona prescribe no such blank (their
// § 8132/§ 713.20/§ 33-1008 forms identify the work by location and payment
// instead), and a hardcoded list would either demand one of them invent a blank
// the statute does not have, or quietly stop covering a form that gains one.
const JOB_DESC = 'Electrical rough-in, 1st floor';
const BLANK_MARKERS = ['(job description)', '(describe materials and/or labor)'];
let formsWithScopeBlank = 0;
for (const state of STATUTORY_WAIVER_STATES) {
  for (const type of ALL_TYPES) {
    const ctx = { ...lienWaiverDocContext(projectIn(state)), jobDescription: JOB_DESC };
    const html = buildLienWaiverHtml(waiver(type), BRANDING, ctx);
    if (!BLANK_MARKERS.some(m => html.includes(esc(m)))) continue;
    formsWithScopeBlank++;
    ok(`${state} ${type} prints the job description into its scope blank`,
      html.includes(esc(JOB_DESC)),
      'the statutory blank for the released scope went out as underscores');
  }
}
// A fixture that exercises nothing passes everything. Texas contributes four
// forms and Georgia two, so anything under six means the loop above stopped
// finding the blank it is meant to be testing.
ok('the scope-blank check actually reached the forms that have one',
  formsWithScopeBlank >= 6, `only ${formsWithScopeBlank} rendered forms carried a scope blank`);
ok('the screen fills that blank from the commitment the waiver was collected against',
  /jobDescription:\s*\(projectCommitments\.find\(/.test(screen)
  && /lienWaiverDocContext\(project, \{/.test(screen)
  && /docCtxFor\(w\)/.test(screen),
  'declared, threaded through every form, and supplied by nobody is the same defect as subEmail was');
// Never invented: a waiver with no linked commitment leaves the blank blank.
ok('an unlinked waiver leaves the scope blank rather than guessing at one',
  /\?\.description \?\? ''\)\.trim\(\)/.test(screen));

// 5. NO DOCUMENT EVER PRINTS THE WORD "undefined". The cheapest possible check
// for the whole class of bug this repo keeps shipping — a Record lookup that
// misses, an optional field interpolated raw — and it covers every form.
for (const state of [...STATUTORY_WAIVER_STATES, 'NY', '']) {
  for (const type of ALL_TYPES) {
    ok(`${state || 'no state'} ${type} prints no "undefined" anywhere`,
      !renderFor(state, type).includes('undefined'));
  }
}

// 6. A FINAL statutory release is not bounded by a day. CA §§ 8136/8138 and the
// final forms in TX, AZ, FL and GA print no through date; our own facts table
// used to add one under them, which is an argument that the release stopped
// there. The general form keeps it — its paragraphs refer to it by name.
for (const state of STATUTORY_WAIVER_STATES) {
  ok(`${state} final forms print no through date of ours`,
    !/Through Date/.test(renderFor(state, 'unconditional_final'))
    && !/Through Date/.test(renderFor(state, 'conditional_final')));
}
ok('a statutory PROGRESS form still shows the through date it releases against',
  /Through Date/.test(renderFor('CA', 'conditional_partial')));
ok('the general form keeps its through date row', /Through Date/.test(renderFor('NY', 'unconditional_final')),
  'the general form\'s own paragraphs say "through the Through Date stated above"');

// 7. A VOIDED waiver cannot be re-sent. The request writes `status:
// 'requested'`, and the signing page decides whether to show a Sign button off
// exactly that status — so re-sending un-voids a cancelled release and invites
// the sub to sign it.
ok('the engine refuses to request a signature on a voided waiver',
  /waiver\.status === 'voided'\) return \{ outcome: 'voided' \}/.test(engine),
  'the update sets status back to \'requested\', which un-voids it');
ok('the screen has a sentence for a voided waiver',
  /result\.outcome === 'voided'/.test(screen) && /voided/i.test(screen));

// ─────────────────────────────────────────────────────────────────────
// G. The marketing site describes the flow the code has
// ─────────────────────────────────────────────────────────────────────
console.log('\nmarketing claims match the code:');

function publicPages(dir = 'marketing', out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir))) {
    if (e === 'dist' || e === 'screenshots' || e === 'app-store-screenshots'
      || e === 'node_modules' || e.startsWith('.')) continue;
    const rel = `${dir}/${e}`;
    if (statSync(join(ROOT, rel)).isDirectory()) publicPages(rel, out);
    else if (rel.endsWith('.html')) out.push(rel);
  }
  return out;
}
const pages = publicPages();

// The retired sentence. It described a flow that did not exist for as long as
// the feature shipped; it must never come back on any page.
const RETIRED = /request from a sub\s*→\s*they receive an email and sign digitally/i;
const stillRetired = pages.filter(p => RETIRED.test(read(p)));
ok('no page still carries the old "request from a sub → email → sign" sentence',
  stillRetired.length === 0, stillRetired.join(', '));

const features = read('marketing/features/index.html');

// The page is REQUIRED to describe the loop, because the loop is what the
// product does. A page that says nothing is as wrong as one that overclaims,
// just quieter.
const claimsLoop = /Request signature/.test(features)
  && /email/i.test(features)
  && /sign/i.test(features);
ok('the features page describes the request-and-sign loop', claimsLoop);

// …and it may only describe it while every piece is present. This is the link
// between the two halves of this guard: rip out the send, the page, the RPC
// names or the button, and the claim fails here.
const loopIntact = /export async function requestLienWaiverSignature/.test(engine)
  && /waiver\.subEmail/.test(engine)
  && /sendEmail\(/.test(engine)
  && signPageExists
  && !!FETCH_RPC && signPage.includes(FETCH_RPC)
  && !!SIGN_RPC && signPage.includes(SIGN_RPC)
  && /requestLienWaiverSignature/.test(screen);
ok('the claim is backed by the code that implements it', !claimsLoop || loopIntact,
  'the features page claims subs are emailed a link and sign it; part of that flow is missing from the code');

// The page also names the statutory states. If the code ever stops supporting
// one the page must not keep selling it — and, the direction that used to slip
// through, the page must not name one the code has no form for.
//
// The candidate list is ALL FIFTY states, not the five. Filtering by the five
// supported names could only ever detect a state going missing; adding "Nevada"
// to the sentence passed, because a scan that only looks for names it already
// approves of cannot see a name it does not know.
const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
] as const;
const NAME_OF: Record<WaiverStateCode, string> = {
  CA: 'California', TX: 'Texas', FL: 'Florida', GA: 'Georgia', AZ: 'Arizona',
};
const supported = STATUTORY_WAIVER_STATES.map(s => NAME_OF[s]);

// Scoped to the sentence that makes the claim. The rest of the page may mention
// a state for other reasons (a testimonial, an office address) without that
// being a promise about statutory waiver forms.
const waiverClaim = (features.match(/Jobs in [^<]*statutory waiver form[^<]*/) ?? [''])[0];
ok('the features page states which jobs get a statutory form', waiverClaim.length > 0,
  'the page must say which states are covered, or a GC in Georgia has no way to know');
const statesClaimed: string[] = US_STATES.filter(n => waiverClaim.includes(n));
const overclaimed = statesClaimed.filter(n => !supported.includes(n));
const unsold = supported.filter(n => !statesClaimed.includes(n));
ok('the states the page names are exactly the states the code supports',
  overclaimed.length === 0 && unsold.length === 0,
  `page names but code cannot print: ${overclaimed.join(', ') || 'none'} | code prints but page omits: ${unsold.join(', ') || 'none'}`);

ok('the sub-portal bullet no longer calls waiver signing "coming soon"',
  !/Coming soon:<\/em>\s*self-serve lien waivers/i.test(features),
  'subs can sign a waiver today, by emailed link');

// ─────────────────────────────────────────────────────────────────────
// H. The purchase order (audit item 13)
//
// It ships in the same wave and has no guard of its own, because
// utils/purchaseOrderPdf.ts imports react-native, expo-print and expo-sharing
// and bun cannot parse those — the same wall that made lienWaiverDocument.ts a
// separate pure module. Until the PO is split the same way (see the handover
// note in the review), these are source-level checks: weaker than rendering,
// but they pin the two regressions that were actually there and the wiring that
// makes the generator a feature rather than dead code.
// ─────────────────────────────────────────────────────────────────────
console.log('\nthe purchase order is wired, priced at cost, and dated in calendar days:');

const po = liveCode(read('utils/purchaseOrderPdf.ts'));

// A generator nothing calls is not a feature. Pinned to the CALL, not the name.
const jobCosting = liveCode(read('app/job-costing.tsx'));
ok('a screen actually issues the purchase order',
  /await sharePurchaseOrderPDF\(/.test(jobCosting)
  && /onPress=\{\(\) => \{ void handleIssuePO\(c\); \}\}/.test(jobCosting),
  'the PO generator with no caller is the shape this wave was killed in');
ok('the issue action is offered on purchase-order commitments',
  /c\.type === 'purchase_order' &&/.test(jobCosting));

// Both dates on the order are calendar days. fmtDate reads them as UTC
// midnight, which printed "Issued August 30" for a PO signed on the 31st and
// moved every Required-by a day earlier — the line a vendor books a truck off.
ok('the order formats its dates as calendar days, never through fmtDate',
  !/\bfmtDate\s*\(/.test(po) && /formatCalendarDay/.test(po),
  'signedDate and Delivery.expectedDate are both bare YYYY-MM-DD');

// COST, never revenue. `lineTotal` on an estimate item carries the GC's markup;
// putting it on a vendor's order hands them the margin.
ok('order lines are priced at cost, not at the marked-up sell figure',
  /it\.usesBulk && it\.bulkPrice > 0 \? it\.bulkPrice : it\.unitPrice/.test(po)
  && !/\bit\.lineTotal\b/.test(po),
  'the vendor is owed the cost, and lineTotal is the client-facing number');
ok('the order total is jobCostEngine\'s commitmentValue, not a second formula',
  /commitmentValue\(commitment\)/.test(po),
  'a PO whose total disagrees with the Job Costing line it came from is an argument waiting to happen');
ok('the order states its tax treatment rather than inventing a tax row',
  /exclusive of sales tax/i.test(po) && /Not itemised/.test(po),
  'a Commitment has no tax field; a computed tax row would not match what the GC signed for');

// ─────────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? '✓' : '✗'} validate-lien-waivers: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
