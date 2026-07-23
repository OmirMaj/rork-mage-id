// validate-home-passport.ts — unit tests for the Home Passport engine.
// Run via: bun run scripts/validate-home-passport.ts
//
// Mirrors validate-schedule-colors.ts: bun executes TS natively; the module
// under test is pure (type-only imports of domain types, no RN dependencies).

import { buildHomePassport, MAX_DOC_CHARS, MAX_FAQ_INPUTS, type BuildHomePassportInput } from '../utils/passport/buildHomePassport';
import type {
  SelectionCategory, SelectionOption, Warranty, Commitment, Subcontractor, ProjectPhoto,
} from '../types';
import type { MaintenanceItem } from '../utils/closeoutBinderEngine';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}
function expectTrue(name: string, got: boolean) { expect(name, got, true); }

// ── Fixtures ────────────────────────────────────────────────────────

const PROJECT = { id: 'proj-1', name: 'Henderson Remodel', location: '12 Oak St' };
const GENERATED_AT = '2026-07-23T12:00:00.000Z';

function mkOption(over: Partial<SelectionOption>): SelectionOption {
  return {
    id: 'opt-1', categoryId: 'cat-1', source: 'gc_added',
    productName: 'Duration Home Interior', brand: 'Sherwin-Williams', sku: 'SW-7008',
    description: 'Matte, scrubbable', unitPrice: 62, unit: 'gal', quantity: 5, total: 310,
    supplier: 'SW Store #204', highlights: ['One-coat coverage'], isChosen: true,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...over,
  };
}
function mkSelection(over: Partial<SelectionCategory>): SelectionCategory {
  return {
    id: 'cat-1', projectId: 'proj-1', userId: 'u1', category: 'Kitchen Paint',
    styleBrief: 'warm neutral', budget: 400, status: 'chosen', notes: '', displayOrder: 0,
    createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-02T00:00:00.000Z',
    options: [mkOption({})],
    ...over,
  };
}
function mkWarranty(over: Partial<Warranty>): Warranty {
  return {
    id: 'war-1', projectId: 'proj-1', projectName: 'Henderson Remodel',
    title: 'Trane HVAC', category: 'hvac', provider: 'Trane',
    startDate: '2026-05-01', durationMonths: 120, endDate: '2036-05-01',
    coverageDetails: 'Compressor and parts', exclusions: 'Filters',
    status: 'active', claims: [],
    createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
    ...over,
  };
}
function mkCommitment(over: Partial<Commitment>): Commitment {
  return {
    id: 'com-1', projectId: 'proj-1', number: 'SC-001', type: 'subcontract',
    subcontractorId: 'sub-1', description: 'Full electrical rough-in and trim',
    amount: 18000, signedDate: '2026-02-10', phase: 'Rough-in', csiDivision: '26',
    status: 'active',
    createdAt: '2026-02-10T00:00:00.000Z', updatedAt: '2026-02-10T00:00:00.000Z',
    ...over,
  };
}
function mkSub(over: Partial<Subcontractor>): Subcontractor {
  return {
    id: 'sub-1', companyName: 'Volt Bros Electric', contactName: 'Ray Ortiz',
    phone: '555-0100', email: 'ray@voltbros.com', address: '9 Amp Way',
    trade: 'Electrical', licenseNumber: 'E-1234', licenseExpiry: '2027-01-01',
    coiExpiry: '2027-01-01', w9OnFile: true, bidHistory: [], assignedProjects: [],
    notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}
function mkPhoto(over: Partial<ProjectPhoto>): ProjectPhoto {
  return {
    id: 'ph-1', projectId: 'proj-1', uri: 'https://cdn.example/ph-1.jpg',
    timestamp: '2026-03-12T15:00:00.000Z', tag: 'Kitchen west wall',
    createdAt: '2026-03-12T15:00:00.000Z',
    ...over,
  };
}
const MAINT: MaintenanceItem[] = [
  { id: 'm1', task: 'HVAC filter replacement', frequency: 'Quarterly', nextDate: '2026-10-01', notes: 'MERV 11+' },
];

function fullInput(): BuildHomePassportInput {
  return {
    project: PROJECT,
    selections: [mkSelection({})],
    warranties: [mkWarranty({})],
    commitments: [mkCommitment({})],
    subcontractors: [mkSub({})],
    photos: [mkPhoto({})],
    maintenance: MAINT,
    generatedAt: GENERATED_AT,
  };
}

console.log('\nbuildHomePassport validation:');

// ── Empty-input totality ──
const empty = buildHomePassport({
  project: PROJECT, selections: [], warranties: [], commitments: [],
  subcontractors: [], photos: [], maintenance: [], generatedAt: GENERATED_AT,
});
expect('empty input → no docs', empty.docs.length, 0);
expect('empty input → no FAQ inputs', empty.faqInputs.length, 0);
expect('empty input → zero summary counts',
  [empty.summary.finishes, empty.summary.warranties, empty.summary.trades,
   empty.summary.maintenanceItems, empty.summary.photos, empty.summary.docCount],
  [0, 0, 0, 0, 0, 0]);
expect('empty input → generatedAt passthrough', empty.summary.generatedAt, GENERATED_AT);

// ── Full assembly: one doc per kind ──
const full = buildHomePassport(fullInput());
const byKind = (k: string) => full.docs.filter(d => d.kind === k);
expect('full input → 5 docs (one per kind)', full.docs.length, 5);
expect('one doc of each kind',
  ['finish', 'warranty', 'trade', 'maintenance', 'photo'].map(k => byKind(k).length),
  [1, 1, 1, 1, 1]);

// ── Finish doc ──
const finish = byKind('finish')[0];
expect('finish docId from category id', finish.docId, 'passport:finish:cat-1');
expect('finish ref names the category', finish.ref, 'Finish — Kitchen Paint');
expectTrue('finish text carries brand', finish.text.includes('Sherwin-Williams'));
expectTrue('finish text carries SKU', finish.text.includes('SW-7008'));
expectTrue('finish text carries supplier', finish.text.includes('SW Store #204'));
const noChoice = buildHomePassport({
  ...fullInput(),
  selections: [mkSelection({ options: [mkOption({ isChosen: false })] })],
});
expect('unchosen selection → no finish doc', noChoice.docs.filter(d => d.kind === 'finish').length, 0);

// ── Warranty doc ──
const warr = byKind('warranty')[0];
expect('warranty docId from warranty id', warr.docId, 'passport:warranty:war-1');
expect('warranty ref', warr.ref, 'Warranty — Trane HVAC');
expectTrue('warranty text carries provider', warr.text.includes('Trane'));
expectTrue('warranty text carries end date', warr.text.includes('May 1, 2036'));
expectTrue('warranty text carries duration', warr.text.includes('120 months'));
expectTrue('warranty text carries coverage', warr.text.includes('Compressor and parts'));
const otherProjWarranty = buildHomePassport({
  ...fullInput(),
  warranties: [mkWarranty({ id: 'war-2', projectId: 'proj-OTHER' })],
});
expect('other-project warranty excluded', otherProjWarranty.docs.filter(d => d.kind === 'warranty').length, 0);

// ── Trade doc — commitment enriched with sub contact ──
const trade = byKind('trade')[0];
expect('trade docId from commitment id', trade.docId, 'passport:trade:com-1');
expect('trade ref names the sub company', trade.ref, 'Trade — Volt Bros Electric');
expectTrue('trade text carries the trade', trade.text.includes('Electrical'));
expectTrue('trade text carries phone', trade.text.includes('555-0100'));
expectTrue('trade text carries email', trade.text.includes('ray@voltbros.com'));
expectTrue('trade text carries scope', trade.text.includes('Full electrical rough-in'));
const noSub = buildHomePassport({
  ...fullInput(),
  commitments: [mkCommitment({ id: 'com-2', subcontractorId: undefined, vendorName: 'ACME Plumbing' })],
});
expect('vendorName fallback when no sub match',
  noSub.docs.filter(d => d.kind === 'trade')[0]?.ref, 'Trade — ACME Plumbing');
const draftOnly = buildHomePassport({
  ...fullInput(),
  commitments: [mkCommitment({ status: 'draft' })],
});
expect('draft commitment excluded', draftOnly.docs.filter(d => d.kind === 'trade').length, 0);
const otherProjCommit = buildHomePassport({
  ...fullInput(),
  commitments: [mkCommitment({ projectId: 'proj-OTHER' })],
});
expect('other-project commitment excluded', otherProjCommit.docs.filter(d => d.kind === 'trade').length, 0);

// ── Maintenance doc ──
const maint = byKind('maintenance')[0];
expect('maintenance docId from item id', maint.docId, 'passport:maintenance:m1');
expectTrue('maintenance text carries frequency', maint.text.includes('Quarterly'));
expectTrue('maintenance text carries notes', maint.text.includes('MERV 11+'));

// ── Photo doc ──
const photo = byKind('photo')[0];
expect('photo docId from photo id', photo.docId, 'passport:photo:ph-1');
expectTrue('photo ref carries caption', photo.ref.includes('Kitchen west wall'));
expectTrue('photo ref carries date', photo.ref.includes('Mar 12, 2026'));
const draftPhoto = buildHomePassport({
  ...fullInput(),
  photos: [mkPhoto({ portalState: { status: 'draft' } as unknown as ProjectPhoto['portalState'] })],
});
expect('unsent (draft) photo excluded', draftPhoto.docs.filter(d => d.kind === 'photo').length, 0);
const otherProjPhoto = buildHomePassport({
  ...fullInput(),
  photos: [mkPhoto({ projectId: 'proj-OTHER' })],
});
expect('other-project photo excluded', otherProjPhoto.docs.filter(d => d.kind === 'photo').length, 0);

// ── 4000-char clamp ──
const longText = buildHomePassport({
  ...fullInput(),
  warranties: [mkWarranty({ coverageDetails: 'x'.repeat(10000) })],
});
const clamped = longText.docs.filter(d => d.kind === 'warranty')[0];
expectTrue('doc text clamped to MAX_DOC_CHARS', clamped.text.length <= MAX_DOC_CHARS);
expect('MAX_DOC_CHARS is the spec 4000', MAX_DOC_CHARS, 4000);

// ── docId stability across re-generation ──
const runA = buildHomePassport(fullInput());
const runB = buildHomePassport(fullInput());
expect('re-generation yields identical docIds',
  runA.docs.map(d => d.docId), runB.docs.map(d => d.docId));

// ── FAQ inputs ──
expect('full input → the full FAQ catalog (capped)', full.faqInputs.length, MAX_FAQ_INPUTS);
expectTrue('every FAQ question is non-empty', full.faqInputs.every(f => f.question.trim().length > 0));
expectTrue('FAQ ids are unique', new Set(full.faqInputs.map(f => f.id)).size === full.faqInputs.length);
const maintOnly = buildHomePassport({
  project: PROJECT, selections: [], warranties: [], commitments: [],
  subcontractors: [], photos: [], maintenance: MAINT, generatedAt: GENERATED_AT,
});
expect('maintenance-only input → only maintenance FAQs',
  maintOnly.faqInputs.map(f => f.id), ['faq-maint-schedule', 'faq-maint-seasonal']);

// ── Summary counts ──
expect('summary counts match docs',
  [full.summary.finishes, full.summary.warranties, full.summary.trades,
   full.summary.maintenanceItems, full.summary.photos, full.summary.docCount],
  [1, 1, 1, 1, 1, 5]);
expect('summary.generatedAt passthrough', full.summary.generatedAt, GENERATED_AT);

// ── askHomePrompt ───────────────────────────────────────────────────

console.log('\nbuildAskHomePrompt validation:');

import { buildAskHomePrompt, ASK_HOME_NOT_FOUND } from '../utils/passport/askHomePrompt';

const promptDocs = [
  { ref: 'Warranty — Trane HVAC', content: 'Warranty for Trane HVAC. Coverage ends May 1, 2036' },
  { ref: 'Trade — Volt Bros Electric', content: 'Volt Bros Electric worked on Henderson Remodel. Phone: 555-0100' },
];
const p1 = buildAskHomePrompt('When does the HVAC warranty end?', promptDocs);
expectTrue('prompt contains the question', p1.includes('When does the HVAC warranty end?'));
expectTrue('prompt contains every ref as a citation label',
  p1.includes('[Warranty — Trane HVAC]') && p1.includes('[Trade — Volt Bros Electric]'));
expectTrue('prompt contains the ONLY-grounding rule', p1.includes('ONLY the home records'));
expectTrue('prompt embeds the exact not-found line', p1.includes(ASK_HOME_NOT_FOUND));
expectTrue('prompt forbids invention', p1.toLowerCase().includes('never invent'));
expectTrue('records precede the question', p1.indexOf('HOME RECORDS:') < p1.indexOf('HOMEOWNER QUESTION:'));

const p2 = buildAskHomePrompt('anything', []);
expectTrue('empty docs → still instructs not-found', p2.includes(ASK_HOME_NOT_FOUND));
expectTrue('empty docs → explicit no-records marker', p2.includes('(no records found for this question)'));
expectTrue('question is trimmed', buildAskHomePrompt('  hi  ', []).endsWith('HOMEOWNER QUESTION: hi'));

// ── portal-ask-home ↔ askHomePrompt sync ────────────────────────────
// Edge functions can't import app code, so portal-ask-home carries a copy of
// the grounding prompt. These checks pin the copy to the canonical version.

console.log('\nportal-ask-home sync validation:');

// fileURLToPath + join, matching validate-app-slop.ts — import.meta.dir is
// Bun-only (tsc rejects it) and the repo path contains a space.
const edgeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../supabase/functions/portal-ask-home/index.ts'),
  'utf8',
);
expectTrue('edge fn embeds the exact not-found line', edgeSrc.includes(ASK_HOME_NOT_FOUND));
expectTrue('edge fn keeps the ONLY-grounding rule', edgeSrc.includes('ONLY the home records'));
expectTrue('edge fn never logs the access token', !/console\.(log|warn|error)\([^)]*accessToken/i.test(edgeSrc));
expectTrue('edge fn uses constant-time token compare', edgeSrc.includes('constantTimeEqual'));
expectTrue('edge fn enforces the 20/day portal cap', edgeSrc.includes('PORTAL_DAILY_LIMIT = 20'));
expectTrue('edge fn filters to homeowner-safe sources', edgeSrc.includes('ALLOWED_SOURCES'));

// ── summary ─────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
