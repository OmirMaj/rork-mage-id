// scripts/validate-proof-pack.ts — the Pay Period Record (Big Bets, Bet 3,
// Phase 1, lane PROOFPACK; "proof pack" is the internal name only): the pure
// core, the document, the fingerprint, the gate and the wording, each as a RULE
// with planted mutations it must catch.
//
// The feature is DARK (constants/featureFlags.ts PROOF_PACK_ENABLED = false)
// with an owner preview. What these rules hold:
//
//   S1  every strength class is reached by the record the rule names, and by
//       no weaker or stronger record
//   T1  LABEL TRUTH: a label above Recorded needs a fact read from the server
//       when the document is made, and the figures printed are the server's or
//       equal to them. An amount changed after signing, a pay link with no lock
//       stamp, a local copy that differs from the seal, an approval the
//       contractor's account wrote: each downgrades, and says why
//   T2  DISCLOSURE: left-out counts under each class and by kind, what the
//       fingerprint does not show, the check code note, the signer sentence,
//       Not on file never $0.00, the exact privacy wording, coordinates out
//       unless switched on
//   N1  the Notice to Recipients, word for word, on page one and in the footer
//       of every page, English and Spanish
//   A1  the name a reader sees is Pay Period Record, everywhere
//   S2  a photo is never above Recorded, whatever it carries
//   S3  the period: the pay application's own dates, else the day after the
//       prior one, else open; an invoice never claims a period of its own
//   M1  the pay figures are the pay document's own, in whole cents, and the
//       printed money equals them
//   L1  a record reaches a schedule of values line only through a schedule
//       task or a change order number, and a line with neither says so
//   O1  left-out records are removed, counted and disclosed on page one
//   G1  gaps print as gaps: empty sections, unread sources, the open items
//       that are always owed
//   D1  every printed record carries its strength label, and the counts on
//       page one equal the package's
//   W1  the two "what this is and is not" sentences, in both languages, on
//       the first page and on the review screen
//   W2  no forbidden claim word and no lender promise, English and Spanish,
//       in the copy tables, the catalogs and the printed document
//   W3  house style: Title Case labels, no dash as punctuation, no "and"
//       sign, no "e.g.", no arrows, "AIA-style" never the bare name
//   W4  every screen key has Spanish with the right source hash
//   P1  no worker's name, phone, ID, pay rate, email or IP address reaches the
//       package or the document
//   P2  nothing is sent to a model, and the only thing sent anywhere is the
//       fingerprint record (eight named fields, no amount, name or address)
//   F1  the fingerprint is stable for the same data, blind to key order, and
//       changes when any included record changes
//   F2  the check code is the server's rule, and re-opening a package tells
//       match from changed from not on file from not checked
//   F3  the migration: server clock, derived code, owner only, immutable, no
//       column for money or a name; and nothing applies it
//   F4  the signature provenance migration is written, not applied, never
//       upgrades an existing row, and its markers are the ones the app reads
//   E1  flag off and not the owner means no entry point; the flag is read in
//       one file; only the owner seat gets past
//   E2  the core is pure: no React, no storage, no network, no clock
//   K1  storage keys are owned
//
// The modules are EXECUTED under bun; react-native / expo / supabase are
// stubbed because utils/proofPack/store.ts imports them.
//
// Run: bun run scripts/validate-proof-pack.ts
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_STORAGE_PREFIXES } from '../utils/localCacheKeys';
import { sourceHash } from '../i18n/hash';
import { EN as EN_REAL } from '../i18n/catalog/en/office.proof-pack.generated';
import { ES_OFFICE_PROOF_PACK as ES_REAL } from '../i18n/catalog/es/office/proofPack';
import { SURFACES } from '../i18n/surfaces';
import { isTitleCase } from './copy-title-case';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/.*$/gm, '$1');

// ── stubs ────────────────────────────────────────────────────────────────────
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-proof-pack must run under bun (needs Bun.plugin to stub native modules)\n');
  process.exit(1);
}
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
Bun.plugin({
  name: 'proof-pack-stubs',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default } }, loader: 'object' }));
    build.module('expo-print', () => ({ exports: {}, loader: 'object' }));
    build.module('expo-sharing', () => ({ exports: {}, loader: 'object' }));
    build.module('expo-crypto', () => ({ exports: { CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, CryptoEncoding: { HEX: 'hex' }, digestStringAsync: async (_a: string, t: string) => createHash('sha256').update(t).digest('hex') }, loader: 'object' }));
    build.module('expo-file-system/legacy', () => ({ exports: {}, loader: 'object' }));
    build.module('@react-native-async-storage/async-storage', () => ({ exports: { default: { getItem: async () => null, setItem: async () => {} } }, loader: 'object' }));
    build.module('@/lib/supabase', () => ({ exports: { supabase: {}, isSupabaseConfigured: false }, loader: 'object' }));
    build.module('@/utils/offlineQueue', () => ({
      exports: { supabaseRpcOnline: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return { status: 'failed' }; } },
      loader: 'object',
    }));
  },
});

const CORE = await import('../utils/proofPack/core');
const FP = await import('../utils/proofPack/fingerprint');
const HTML = await import('../utils/proofPack/html');
const DOC = await import('../utils/proofPack/docCopy');
const ALLOWED = await import('../utils/proofPack/allowed');
const STORE = await import('../utils/proofPack/store');
const OWNER = await import('../utils/owner');
const AIA = await import('../utils/aiaBilling');
type Input = import('../utils/proofPack/core').ProofPackInput;
type Pack = import('../utils/proofPack/core').ProofPack;
type Item = import('../utils/proofPack/core').ProofItem;
type Strength = import('../utils/proofPack/core').ProofStrength;
type DocCopy = import('../utils/proofPack/docCopy').ProofDocCopy;

const sha = async (t: string): Promise<string> => createHash('sha256').update(t).digest('hex');

// ── the world a rule looks at (a mutation hands it an edited copy) ──────────
const CORE_FILES = ['utils/proofPack/core.ts', 'utils/proofPack/fingerprint.ts', 'utils/proofPack/html.ts', 'utils/proofPack/docCopy.ts'] as const;
const IO_FILES = ['utils/proofPack/store.ts', 'utils/proofPack/share.ts'] as const;
const UI_FILES = [
  'components/proofPack/ProofPackEntryRow.tsx', 'components/proofPack/ProofPackReview.tsx', 'components/proofPack/styles.ts',
  'hooks/useProofPackCopy.ts', 'app/proof-pack.tsx',
] as const;
const GATE = 'utils/proofPack/allowed.ts';
const FLAG_FILE = 'constants/featureFlags.ts';
const MIGRATION = 'supabase/migrations/20261009120000_proof_packs.sql';
const MIGRATION_SIG = 'supabase/migrations/20261010090000_signature_provenance.sql';
const SCREENS = ['app/aia-pay-app.tsx', 'app/invoice.tsx'] as const;
const FEATURE_FILES: readonly string[] = [...CORE_FILES, ...IO_FILES, ...UI_FILES, GATE];
const READ_FILES: readonly string[] = [...FEATURE_FILES, FLAG_FILE, MIGRATION, MIGRATION_SIG, ...SCREENS, 'app/_layout.tsx', 'package.json', '.github/workflows/ship-gate.yml'];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(join(ROOT, dir))) return out;
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

interface Mods {
  buildProofPack: typeof CORE.buildProofPack;
  photoStrength: typeof CORE.photoStrength;
  changeOrderStrength: typeof CORE.changeOrderStrength;
  lienWaiverStrength: typeof CORE.lienWaiverStrength;
  punchItemStrength: typeof CORE.punchItemStrength;
  payAppStrength: typeof CORE.payAppStrength;
  invoiceStrength: typeof CORE.invoiceStrength;
  fieldTicketStrength: typeof CORE.fieldTicketStrength;
  payAppPeriod: typeof CORE.payAppPeriod;
  invoicePeriod: typeof CORE.invoicePeriod;
  buildHtml: typeof HTML.buildProofPackHtml;
  canonicalText: typeof FP.proofPackCanonicalText;
  checkCodeOf: typeof FP.checkCodeOf;
  compareFingerprint: typeof FP.compareFingerprint;
  recordArgs: typeof STORE.fingerprintRecordArgs;
  fileTitle: typeof HTML.proofPackFileTitle;
  reduceCo: typeof STORE.reduceCoApprovalRow;
  reducePayApp: typeof STORE.reducePayAppRow;
  reduceSeal: typeof STORE.reducePunchSealRow;
  reduceTicket: typeof STORE.reduceFieldTicketRow;
  allowedWith: typeof ALLOWED.proofPackAllowedWith;
  seatAllowed: typeof ALLOWED.proofPackSeatAllowed;
  doc: Record<'en' | 'es', DocCopy>;
  keyPrefix: string;
}
interface World {
  F: Record<string, string>;
  /** Every other source file (for "the flag is read nowhere else"). */
  far: Record<string, string>;
  M: Mods;
  EN: Record<string, unknown>;
  ES: Record<string, { s: unknown; src: string }>;
}

const F: Record<string, string> = {};
for (const f of READ_FILES) F[f] = read(f);
const far: Record<string, string> = {};
for (const dir of ['app', 'components', 'utils', 'hooks', 'contexts', 'lib']) {
  for (const f of walk(dir)) if (!(f in F)) far[f] = read(f);
}

const REAL: World = {
  F, far,
  M: {
    buildProofPack: CORE.buildProofPack,
    photoStrength: CORE.photoStrength,
    changeOrderStrength: CORE.changeOrderStrength,
    lienWaiverStrength: CORE.lienWaiverStrength,
    punchItemStrength: CORE.punchItemStrength,
    payAppStrength: CORE.payAppStrength,
    invoiceStrength: CORE.invoiceStrength,
    fieldTicketStrength: CORE.fieldTicketStrength,
    payAppPeriod: CORE.payAppPeriod,
    invoicePeriod: CORE.invoicePeriod,
    buildHtml: HTML.buildProofPackHtml,
    canonicalText: FP.proofPackCanonicalText,
    checkCodeOf: FP.checkCodeOf,
    compareFingerprint: FP.compareFingerprint,
    recordArgs: STORE.fingerprintRecordArgs,
    fileTitle: HTML.proofPackFileTitle,
    reduceCo: STORE.reduceCoApprovalRow,
    reducePayApp: STORE.reducePayAppRow,
    reduceSeal: STORE.reducePunchSealRow,
    reduceTicket: STORE.reduceFieldTicketRow,
    allowedWith: ALLOWED.proofPackAllowedWith,
    seatAllowed: ALLOWED.proofPackSeatAllowed,
    doc: DOC.PROOF_DOC_COPY,
    keyPrefix: STORE.PROOF_PACKS_KEY_PREFIX,
  },
  EN: EN_REAL as Record<string, unknown>,
  ES: ES_REAL as unknown as Record<string, { s: unknown; src: string }>,
};

// ── fixtures ─────────────────────────────────────────────────────────────────
// Instants at 12:00Z land on the same calendar day from Denver to Tokyo.
const at = (day: string, hh = '12:00') => `${day}T${hh}:00Z`;
const as = <T,>(v: unknown) => v as T;
const HASH64 = 'ab'.repeat(32);

/** Strings that must never reach the package or the document. */
const SECRETS = [
  'Kowalski', 'Wanda Injured', 'Pedro Secretworker', '41.37', 'sub.secret@example.com', '203.0.113.9',
  'dana.secret@example.com', 'Ivan Inspector', '555-0199', 'Mozilla/5.0', 'Toolbox Tom', 'AI wrote this summary',
];

function payApp(id: string, n: number, periodTo: string, extra: Record<string, unknown> = {}) {
  return {
    id, projectId: 'p1', invoiceId: 'inv2', applicationNumber: n, applicationDate: periodTo, periodTo,
    ownerName: 'Dana Client', contractorName: 'Example Builders', projectName: 'Alder Street Renovation',
    originalContractSum: 180000, netChangeByCO: 2000, contractSumToDate: 182000,
    retainagePercent: 10, lessPreviousCertificates: 61234.56,
    lines: [
      { id: 'l1', itemNo: '1.0', description: 'Framing', scheduledValue: 40000, fromPreviousApp: 20000, thisPeriod: 12000, materialsPresentlyStored: 0, retainagePercent: 10, linkedTaskId: 't1' },
      { id: 'l2', itemNo: '2.0', description: 'Electrical rough', scheduledValue: 22000, fromPreviousApp: 4000, thisPeriod: 5000.55, materialsPresentlyStored: 750.25, retainagePercent: 10, linkedTaskId: 't2' },
      { id: 'l3', itemNo: '3.0', description: 'CO #12 Steel beam over the kitchen opening', scheduledValue: 2000, fromPreviousApp: 0, thisPeriod: 2000, materialsPresentlyStored: 0, retainagePercent: 10 },
      { id: 'l4', itemNo: '4.0', description: 'General conditions', scheduledValue: 9000, fromPreviousApp: 3000, thisPeriod: 1500, materialsPresentlyStored: 0, retainagePercent: 10 },
      { id: 'l5', itemNo: '5.0', description: 'Finishes', scheduledValue: 30000, fromPreviousApp: 0, thisPeriod: 0, materialsPresentlyStored: 0, retainagePercent: 10 },
      { id: 'l6', itemNo: '6.0', description: 'Plumbing rough', scheduledValue: 15000, fromPreviousApp: 0, thisPeriod: 900, materialsPresentlyStored: 0, retainagePercent: 10, linkedTaskId: 't9' },
    ],
    totals: {
      totalScheduledValue: 118000, totalCompletedAndStored: 49150.8, totalRetainage: 4915.08,
      totalEarnedLessRetainage: 44235.72, currentPaymentDue: 18111.17, balanceToFinish: 137764.28, percentComplete: 41.65,
    },
    savedAt: at(periodTo), createdAt: at(periodTo), updatedAt: at(periodTo), ...extra,
  };
}

/** The aia_pay_apps row the server would hold for a saved record: the same figures, with or without the lock stamp. */
function serverRow(rec: ReturnType<typeof payApp>, lockedAt: string | null = null, over: Record<string, unknown> = {}) {
  return {
    id: rec.id, lockedAt, applicationNumber: rec.applicationNumber, periodTo: rec.periodTo, periodFrom: (rec as { periodFrom?: string }).periodFrom ?? null,
    originalContractSum: rec.originalContractSum, netChangeByCO: rec.netChangeByCO, contractSumToDate: rec.contractSumToDate,
    lessPreviousCertificates: rec.lessPreviousCertificates,
    totals: {
      totalCompletedAndStored: rec.totals.totalCompletedAndStored, totalRetainage: rec.totals.totalRetainage,
      totalEarnedLessRetainage: rec.totals.totalEarnedLessRetainage, currentPaymentDue: rec.totals.currentPaymentDue, balanceToFinish: rec.totals.balanceToFinish,
    },
    lines: rec.lines.map((l) => ({ id: l.id, itemNo: l.itemNo, description: l.description, scheduledValue: l.scheduledValue, thisPeriod: l.thisPeriod, materialsPresentlyStored: l.materialsPresentlyStored })),
    ...over,
  };
}
const APP3 = () => payApp('app3', 3, '2026-09-30', { periodFrom: '2026-09-01' });
/** The line-oriented text a signature row stores (utils/portalOwnerCore buildCOConsentRecord). */
const consentRecord = (n: number, scope: string, amount: string) => [
  'MAGE ID change order approval record', `change_order_number: ${n}`, `scope: ${scope}`, `change_amount_usd: ${amount}`,
  'signer_name: Dana Client', 'user_agent: Mozilla/5.0 (secret browser)', 'signer_email: dana.secret@example.com',
].join('\n');

// THE FIXTURE IS THE WORLD AFTER BOTH MIGRATIONS: the approval row for co12 and
// the waiver w1 carry the server's provenance marker, so every class is reached.
// TODAY (markers absent) is the fixture with `todayFacts()` laid over it: rule
// T1 holds that nothing is then Signed.
function fixture(over: Partial<Input> = {}): Input {
  const base = {
    project: { id: 'p1', name: 'Alder Street Renovation', location: '14 Alder Street, Baltimore, MD 21201' },
    companyName: 'Example Builders',
    payRef: { kind: 'pay_app', id: 'app3' },
    payApps: [payApp('app3', 3, '2026-09-30', { periodFrom: '2026-09-01' }), payApp('app2', 2, '2026-08-31')],
    invoices: [
      { id: 'inv1', number: 7, projectId: 'p1', type: 'progress', progressPercent: 30, issueDate: '2026-08-31', dueDate: '2026-09-30', lineItems: [], subtotal: 1, taxRate: 0, taxAmount: 0, totalDue: 1, amountPaid: 0, status: 'sent', payments: [], createdAt: at('2026-08-31'), updatedAt: at('2026-08-31') },
      { id: 'inv2', number: 8, projectId: 'p1', type: 'progress', progressPercent: 42, issueDate: '2026-09-30', dueDate: '2026-10-30',
        lineItems: [{ id: 'il1', name: 'Framing', description: '', quantity: 1, unit: 'ls', unitPrice: 12000, total: 12000 }],
        subtotal: 12000, taxRate: 6, taxAmount: 720.5, totalDue: 12720.5, amountPaid: 100.25, retentionAmount: 600, status: 'sent', payments: [],
        billToEmail: 'dana.secret@example.com', createdAt: at('2026-09-30'), updatedAt: at('2026-09-30') },
    ],
    dailyReports: [
      { id: 'd1', projectId: 'p1', date: '2026-09-10', status: 'sent',
        weather: { temperature: '71 F', conditions: 'Clear', wind: '5 mph', isManual: false, source: 'openweather', readAt: at('2026-09-10', '13:42') },
        manpower: [{ id: 'm1', trade: 'Carpenter', company: 'Zed Kowalski Framing', headcount: 4, hoursWorked: 8 }, { id: 'm2', trade: 'Electrician', company: 'Volt', headcount: 2, hoursWorked: 6 }],
        workPerformed: 'Framed the second floor walls', issuesAndDelays: 'Late lumber drop', materialsDelivered: ['2x6 studs'],
        workProgress: [{ taskId: 't1', taskName: 'Framing', phase: 'Structure', pct: 60 }],
        photos: [
          { id: 'ph1', uri: 'file://ph1.jpg', storagePath: 'u/p1/ph1.jpg', timestamp: at('2026-09-10', '14:00') },
          { id: 'phInc', incidentPhoto: true, uri: 'file://inc.jpg', timestamp: at('2026-09-10', '15:00') },
          { id: 'phD', uri: 'file://phD.jpg', timestamp: at('2026-09-10', '16:00') },
        ],
        incident: { peopleInvolved: 'Wanda Injured', reportedBy: 'Wanda Injured', description: 'x' },
        safetyToolboxTalk: { conductedBy: 'Toolbox Tom', topic: 'Ladders' },
        homeownerSummary: 'AI wrote this summary', filedByUserId: 'user-9',
        createdAt: at('2026-09-10'), updatedAt: at('2026-09-14') },
      { id: 'd2', projectId: 'p1', date: '2026-09-20', status: 'draft',
        weather: { temperature: '60', conditions: 'Rain', wind: '', isManual: true }, manpower: [], workPerformed: 'Rough wiring', issuesAndDelays: '',
        materialsDelivered: [], photos: [], createdAt: at('2026-09-20'), updatedAt: at('2026-09-20') },
      { id: 'd0', projectId: 'p1', date: '2026-08-15', status: 'sent', weather: {}, manpower: [], workPerformed: 'Demo', issuesAndDelays: '', materialsDelivered: [], photos: [], createdAt: at('2026-08-15'), updatedAt: at('2026-08-15') },
      { id: 'dx', projectId: 'p2', date: '2026-09-10', status: 'sent', weather: {}, manpower: [], workPerformed: 'Another job', issuesAndDelays: '', materialsDelivered: [], photos: [], createdAt: at('2026-09-10'), updatedAt: at('2026-09-10') },
    ],
    dailyReportsLoaded: true,
    photos: [
      { id: 'ph1', projectId: 'p1', uri: 'https://cdn.example/ph1.jpg', storagePath: 'u/p1/ph1.jpg', timestamp: at('2026-09-10', '14:00'), createdAt: at('2026-09-10', '14:00'), latitude: 39.29038, longitude: -76.61219, locationAccuracyMeters: 8.4, linkedTaskId: 't1', linkedTaskName: 'Framing', userId: 'user-9' },
      { id: 'ph2', projectId: 'p1', uri: 'https://cdn.example/ph2.jpg', storagePath: 'u/p1/ph2.jpg', timestamp: at('2026-09-12'), createdAt: at('2026-09-12'), linkedTaskId: 't2' },
      { id: 'ph3', projectId: 'p1', uri: 'file://ph3.jpg', timestamp: at('2026-09-13'), createdAt: at('2026-09-13'), location: 'Kitchen' },
      { id: 'phOld', projectId: 'p1', uri: 'x', storagePath: 'u/p1/old.jpg', timestamp: at('2026-08-01'), createdAt: at('2026-08-01') },
    ],
    photosLoaded: true,
    changeOrders: [
      { id: 'co12', number: 12, projectId: 'p1', date: '2026-09-10', description: 'Steel beam over the kitchen opening', reason: '', lineItems: [], originalContractValue: 180000, changeAmount: 2000, newContractTotal: 182000, status: 'approved',
        approvers: [{ id: 'a1', name: 'Dana Client', email: 'dana.secret@example.com', role: 'Client', required: true, order: 1, status: 'approved', responseDate: at('2026-09-15') }],
        auditTrail: [{ id: 'au1', action: 'client_signed_via_portal', actor: 'Dana Client', timestamp: at('2026-09-15'), detail: 'Signed in the portal. record SHA-256 0123456789abcdef…' }],
        createdAt: at('2026-09-10'), updatedAt: at('2026-09-15') },
      { id: 'co13', number: 13, projectId: 'p1', date: '2026-09-12', description: 'Extra outlets', reason: '', lineItems: [], originalContractValue: 0, changeAmount: 450.5, newContractTotal: 0, status: 'approved',
        auditTrail: [{ id: 'au2', action: 'approved_via_portal', actor: 'Dana Client', timestamp: at('2026-09-16') }], createdAt: at('2026-09-12'), updatedAt: at('2026-09-16') },
      { id: 'co14', number: 14, projectId: 'p1', date: '2026-09-05', description: 'Door swap', reason: '', lineItems: [], originalContractValue: 0, changeAmount: -300, newContractTotal: 0, status: 'approved',
        auditTrail: [{ id: 'au3', action: 'marked_approved', actor: 'Sam GC', timestamp: at('2026-09-05') }], createdAt: at('2026-09-05'), updatedAt: at('2026-09-05') },
      { id: 'co15', number: 15, projectId: 'p1', date: '2026-10-04', description: 'October work', reason: '', lineItems: [], originalContractValue: 0, changeAmount: 900, newContractTotal: 0, status: 'approved',
        auditTrail: [{ id: 'au4', action: 'marked_approved', actor: 'Sam GC', timestamp: at('2026-10-04') }], createdAt: at('2026-10-04'), updatedAt: at('2026-10-04') },
      { id: 'co16', number: 16, projectId: 'p1', date: '2026-09-08', description: 'Draft only', reason: '', lineItems: [], originalContractValue: 0, changeAmount: 5, newContractTotal: 0, status: 'draft', createdAt: at('2026-09-08'), updatedAt: at('2026-09-08') },
    ],
    payAppServer: serverRow(APP3()),
    coSignatures: [
      { changeOrderId: 'co12', decision: 'approved', signerName: 'Dana Client', serverCreatedAt: at('2026-09-15', '12:05'), documentHash: 'fe'.repeat(32), hasSignature: true,
        recordedVia: 'portal_function', signedTerms: { changeOrderNumber: 12, scope: 'Steel beam over the kitchen opening', amountCents: 200000 } },
      { changeOrderId: 'co13', decision: 'approved', signerName: 'Dana Client', serverCreatedAt: at('2026-09-16'), documentHash: '', hasSignature: false, recordedVia: null, signedTerms: null },
    ],
    punchItems: [
      { id: 'pi1', projectId: 'p1', description: 'Touch up paint at the stair', location: 'Stair', assignedSub: 'Kowalski', dueDate: '2026-09-24', priority: 'low', status: 'closed', closedAt: at('2026-09-24'), createdAt: at('2026-09-15'), updatedAt: at('2026-09-24'), sealId: 's1', afterPhotoStoragePath: 'u/p1/pi1-after.jpg' },
      { id: 'pi2', projectId: 'p1', description: 'Loose outlet cover', location: 'Kitchen', assignedSub: '', dueDate: '2026-09-30', priority: 'low', status: 'open', createdAt: at('2026-09-18'), updatedAt: at('2026-09-18'), linkedTaskId: 't2' },
      { id: 'pi3', projectId: 'p1', description: 'Crew note', location: '', assignedSub: '', dueDate: '', priority: 'low', status: 'open', listType: 'crew', createdAt: at('2026-09-18'), updatedAt: at('2026-09-18') },
      { id: 'pi4', projectId: 'p1', description: 'August item', location: '', assignedSub: '', dueDate: '', priority: 'low', status: 'open', createdAt: at('2026-08-02'), updatedAt: at('2026-08-02') },
    ],
    punchSeal: { id: 's1', projectId: 'p1', sealedAt: at('2026-09-25'), itemCount: 1, manifestHash: HASH64, signerName: 'Dana Client', signerRole: 'Owner',
      items: [{ id: 'pi1', description: 'Touch up paint at the stair', location: 'Stair', closedAt: at('2026-09-24') }] },
    permits: [
      { id: 'perm1', projectId: 'p1', type: 'electrical', inspections: [
        { id: 'in1', name: 'Rough electrical', scheduledFor: '2026-09-19', result: 'passed', inspectorName: 'Ivan Inspector', notes: 'Call 555-0199', recordedAt: at('2026-09-19') },
        { id: 'in2', name: 'Final electrical', scheduledFor: '2026-09-29', result: 'scheduled', recordedAt: at('2026-09-20') },
      ] },
    ],
    lienWaivers: [
      { id: 'w1', projectId: 'p1', userId: 'u', waiverType: 'conditional_progress', subName: 'Volt Electric LLC', subEmail: 'sub.secret@example.com', throughDate: '2026-09-30', paidAmount: 5000.55, status: 'signed', signedAt: at('2026-09-29'),
        subSignature: { name: 'Vera Volt', role: 'sub', signedAt: at('2026-09-29'), ipAddress: '203.0.113.9', userAgent: 'Mozilla/5.0' }, notes: '', createdAt: at('2026-09-28'), updatedAt: at('2026-09-29') },
      { id: 'w2', projectId: 'p1', userId: 'u', waiverType: 'conditional_progress', subName: 'Paper Plumbing', throughDate: '2026-09-30', paidAmount: 900, status: 'signed', signedAt: at('2026-09-30'),
        subSignature: { name: 'Sam GC', role: 'gc', signedAt: at('2026-09-30'), method: 'paper' }, notes: '', createdAt: at('2026-09-30'), updatedAt: at('2026-09-30') },
      { id: 'w3', projectId: 'p1', userId: 'u', waiverType: 'unconditional_progress', subName: 'Received Roofing', throughDate: '2026-09-15', paidAmount: 100, status: 'received', notes: '', createdAt: at('2026-09-15'), updatedAt: at('2026-09-15') },
      { id: 'w4', projectId: 'p1', userId: 'u', waiverType: 'conditional_progress', subName: 'Asked Drywall', throughDate: '2026-09-30', paidAmount: 700, status: 'requested', signRequestedAt: at('2026-09-27'), notes: '', createdAt: at('2026-09-27'), updatedAt: at('2026-09-27') },
      { id: 'w5', projectId: 'p1', userId: 'u', waiverType: 'conditional_progress', subName: 'Voided Co', throughDate: '2026-09-30', paidAmount: 1, status: 'voided', notes: '', createdAt: at('2026-09-27'), updatedAt: at('2026-09-27') },
    ],
    waiverSignedVia: { w1: 'signing_page', w2: null, w3: null, w4: null, w5: null },
    fieldTicketServer: {
      ft1: { id: 'ft1', status: 'signed', number: 4, date: '2026-09-11', workDescription: 'Shored the opening', hasAuthorization: true, signerName: 'Dana Client', signerRole: 'owner', signedAt: at('2026-09-11', '17:00'), workerCount: 2, totalHours: 8.5 },
    },
    fieldTickets: [
      { id: 'ft1', number: 4, projectId: 'p1', date: '2026-09-11', workDescription: 'Shored the opening', reasonExtra: '', status: 'signed',
        labor: [{ id: 'r1', workerName: 'Pedro Secretworker', trade: 'Laborer', hours: 6, rate: 41.37 }, { id: 'r2', workerName: 'Pedro Secretworker', trade: 'Laborer', hours: 2.5, rate: 41.37 }],
        materials: [], equipment: [], authorization: { name: 'Dana Client', role: 'owner', signedAt: at('2026-09-11', '17:00'), signaturePaths: [] }, createdAt: at('2026-09-11'), updatedAt: at('2026-09-11') },
      { id: 'ft2', number: 5, projectId: 'p1', date: '2026-09-12', workDescription: 'Draft ticket', reasonExtra: '', status: 'draft', labor: [], materials: [], equipment: [], createdAt: at('2026-09-12'), updatedAt: at('2026-09-12') },
    ],
    generatedAt: at('2026-10-02', '09:30'),
  };
  return as<Input>({ ...base, ...over });
}
/** What the server answers TODAY, with neither migration applied: the rows are there, the markers are not. */
function todayFacts(): Partial<Input> {
  const f = fixture();
  return {
    coSignatures: (f.coSignatures ?? []).map((r) => ({ ...r, recordedVia: null })),
    waiverSignedVia: undefined,
  };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
}
function build(w: World, over: Partial<Input> = {}): Pack {
  const res = w.M.buildProofPack(deepFreeze(fixture(over)));
  if (!res.ok) throw new Error(`fixture did not build: ${res.reason}`);
  return res.pack;
}
const item = (p: Pack, key: string): Item | undefined => p.items.find((i) => i.key === key);
const BRANDING = as<import('../types').CompanyBranding>({ companyName: 'Example Builders', contactName: 'Sam GC', email: 'office@example.com', phone: '410-555-0100', address: 'Baltimore, MD', licenseNumber: 'MHIC 000000' });
const FPRINT = { hash: HASH64, code: 'ABCDE-FGHJK', serverCreatedAt: at('2026-10-02', '09:31') };
const html = (w: World, p: Pack, lang: 'en' | 'es' = 'en', fp: { hash: string; code: string; serverCreatedAt: string | null } = FPRINT) => w.M.buildHtml(p, { branding: BRANDING, lang, fingerprint: fp, photoSrc: {} });
const visible = (h: string): string => h.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ');

/** Every string a copy table can print, with representative arguments. */
function docStrings(c: DocCopy): { key: string; s: string }[] {
  const out: { key: string; s: string }[] = [];
  const visit = (key: string, v: unknown) => {
    if (typeof v === 'string') out.push({ key, s: v });
    else if (typeof v === 'function') {
      if (key === 'openItem') {
        for (const code of OPEN_CODES) {
          for (const n of [1, 3]) out.push({ key: `openItem.${code}.${n}`, s: (v as (i: unknown) => string)({ code, n, of: n + 2, source: 'photos' }) });
        }
      } else {
        for (const args of [[1, 1], [3, 7]]) {
          let s = '';
          try { s = String((v as (...a: unknown[]) => unknown)(...(key.match(/periodRange|periodOpen|photoTime|weatherReadAt|firstSaved|lastChanged|signedBy|recordFingerprintStarts|punchSealSigner|punchSealFingerprint|punchOpened|punchClosed|inspectionLine|ticketSigned|waiverThrough|waiverAmount|waiverSignedAt|waiverGapLine|fingerprintOnFile/) ? ['Sep 1, 2026', 'Sep 30, 2026'] : args))); } catch { s = ''; }
          out.push({ key: `${key}(${args.join(',')})`, s });
        }
      }
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(`${key}.${k}`, x);
  };
  for (const [k, v] of Object.entries(c)) visit(k, v);
  return out;
}
const OPEN_CODES = [
  'period_start_open', 'invoice_has_no_period', 'pay_not_locked', 'lines_without_records', 'days_without_report', 'photos_without_place',
  'photos_not_uploaded', 'reports_changed_later', 'change_orders_not_signed', 'no_change_orders', 'no_lien_waivers', 'waivers_requested_unsigned',
  'waiver_coverage_not_checked', 'no_inspection_signoff', 'photo_files_not_fingerprinted', 'no_punch_seal', 'source_not_loaded', 'items_left_out',
  'signer_identity_not_checked', 'change_order_amounts_differ', 'change_orders_declined_on_server', 'photo_coordinates_left_out',
  'free_text_as_typed', 'pay_figures_not_on_file',
] as const;

// ── forbidden words ──────────────────────────────────────────────────────────
// A claim word says the WORK is true. A lender promise says what a third party
// will do. Neither may appear. The one allowed "certification" is the sentence
// that says the document is NOT one (and the Notice to Recipients, which says
// the same). "Proof" appears NOWHERE: the lane's first name is retired. And no
// sentence may say WHO signed: MAGE ID did not identify the signer.
const BANNED_EN: { name: string; re: RegExp }[] = [
  { name: 'verified', re: /\bverif(?:y|ied|ies|ication)\b/i },
  { name: 'certified', re: /\bcertif(?:y|ied|ies)\b/i },
  { name: 'guaranteed', re: /\bguarant(?:ee|eed|ees|y)\b/i },
  { name: 'audit', re: /\baudit(?:ed|s|able)?\b/i },
  { name: 'attested', re: /\battest(?:s|ed|ation)?\b/i },
  { name: 'proves', re: /\bprov(?:e|es|en|ed)\b/i },
  { name: 'tamper-proof', re: /\btamper[- ]?proof\b/i },
  { name: 'bank-ready', re: /\b(?:bank|lender|surety|banker|insurer|architect)[- ]ready\b/i },
  { name: 'lender-approved', re: /\b(?:bank|lender|surety|insurer)[- ]approved\b/i },
  { name: 'paid faster', re: /\b(?:get|gets|getting)\s+(?:you\s+)?paid\s+faster\b|\bfaster\s+pay(?:ment)?\b/i },
  { name: 'a lender will accept', re: /\b(?:bank|lender|surety|insurer|factor)s?\s+(?:will|accepts?|require|approves?)\b/i },
  { name: 'compliant', re: /\bcompliant\b|\bcompliance\b/i },
  { name: 'official AIA', re: /\bofficial AIA\b/i },
  { name: 'the old name', re: /\bproof of work\b|\bproof pack(?:age)?s?\b|\bwork package\b/i },
  { name: 'signed by a named party', re: /\b(?:signed|approved|executed|accepted)\s+by\s+(?:the|your|a)\s+(?:sub|subcontractor|supplier|client|owner|homeowner|customer|architect|inspector)\b/i },
  { name: 'a named party signed', re: /\b(?:the|your)\s+(?:sub|subcontractor|supplier|client|owner|homeowner|customer)\s+(?:has\s+)?(?:signed|approved|accepted|agreed)\b/i },
  { name: 'identity confirmed', re: /\bidentity\s+(?:was\s+|is\s+)?(?:confirmed|checked|established|known)\b|\bconfirmed\s+signer\b/i },
  { name: 'legally binding', re: /\blegally\s+binding\b|\bbinding\s+signature\b|\be-?signature\s+law\b|\bnotari[sz]ed\b/i },
];
const BANNED_ES: { name: string; re: RegExp }[] = [
  { name: 'verificado', re: /\bverific(?:ad[oa]s?|a|ar|aci[oó]n)\b/i },
  { name: 'certificado', re: /\bcertific(?:ad[oa]s?|a|ar)\b/i },
  { name: 'garantizado', re: /\bgarant(?:iza|izad[oa]s?|izar|[ií]a)\b/i },
  { name: 'auditoría', re: /\baudit(?:or[ií]a|ad[oa]s?|ar)\b/i },
  { name: 'atestiguado', re: /\batestigu|\bda fe\b|\bdan fe\b/i },
  { name: 'prueba', re: /\bprueba(?:s)?\b|\bcomprueba|\bcomprobad[oa]/i },
  { name: 'listo para el banco', re: /\blist[oa]s? para (?:el |la )?(?:banco|prestamista|afianzadora|aseguradora)\b/i },
  { name: 'aprobado por el banco', re: /\baprobad[oa]s? por (?:el |la )?(?:banco|prestamista|afianzadora|aseguradora)\b/i },
  { name: 'cobrar más rápido', re: /\bcobr(?:a|ar|es) m[aá]s r[aá]pido\b|\bpago m[aá]s r[aá]pido\b/i },
  { name: 'el nombre anterior', re: /\bpaquete de respaldo\b|\bpaquete de obra\b|\brespaldo de obra\b/i },
  { name: 'firmado por una parte nombrada', re: /\b(?:firmad[oa]s?|aprobad[oa]s?|aceptad[oa]s?)\s+por\s+(?:el|la|su|tu|un|una)\s+(?:subcontratista|proveedor|cliente|due[ñn]o|propietari[oa]|arquitect[oa]|inspector)\b/i },
  { name: 'una parte nombrada firmó', re: /\b(?:el|la|su|tu)\s+(?:subcontratista|proveedor|cliente|due[ñn]o|propietari[oa])\s+(?:firm[oó]|aprob[oó]|acept[oó]|ha firmado)(?![a-zñ])/i },
  { name: 'identidad confirmada', re: /\bidentidad\s+(?:fue\s+|est[aá]\s+)?(?:confirmada|revisada|comprobada)\b|\bnotariad[oa]\b|\blegalmente\s+vinculante\b/i },
];
const IS_NOT_EN = 'It is not an inspection, an appraisal or a certification of the work.';
const IS_EN = 'This is a record of what MAGE ID holds for this pay period.';
const IS_NOT_ES = 'No es una inspección, un avalúo ni una certificación de la obra.';
const IS_ES = 'Este es un registro de lo que MAGE ID guarda de este periodo de pago.';
const NOTICE_EN = 'This record was prepared by the contractor named above using MAGE ID. MAGE ID did not inspect the work and makes no statement to the reader about the work, the amounts or the people named. Do not rely on this record as an inspection, an appraisal or a certification.';
const NOTICE_ES = 'Este registro lo preparó el contratista nombrado arriba con MAGE ID. MAGE ID no inspeccionó la obra y no le afirma nada al lector sobre la obra, los montos ni las personas nombradas. No tome este registro como una inspección, un avalúo ni una certificación.';
const NAME_EN = 'Pay Period Record';
const NAME_ES = 'Registro del periodo de pago';
/** The only places the word "certification" may stand: the sentences that say the document is NOT one. */
const NOT_A_CERT = ['or a certification of the work.', 'an appraisal or a certification.', 'ni una certificación de la obra.', 'un avalúo ni una certificación.'];
const stripNotCert = (t: string): string => NOT_A_CERT.reduce((x, a) => x.split(a).join(' '), t);

function bannedIn(text: string, lang: 'en' | 'es', allowTitle: string[] = []): string[] {
  let t = text;
  for (const a of allowTitle) t = t.split(a).join(' ');
  const list = lang === 'en' ? BANNED_EN : BANNED_ES;
  const hits = list.filter((b) => b.re.test(t)).map((b) => b.name);
  // "proof" in English: nowhere at all.
  if (lang === 'en' && /\bproof\b/i.test(t)) hits.push('proof');
  // The bare AIA name: only inside "AIA-style" and the trademark holder's own name.
  if (/\bAIA\b(?![- ]style)/i.test(t.replace(/American Institute of Architects/g, '').replace(/\bestilo AIA\b/gi, ''))) hits.push('bare AIA');
  return hits;
}
const TITLES_EN: string[] = [];

const STYLE: { name: string; re: RegExp }[] = [
  { name: 'em or en dash', re: /[—–]/ },
  { name: 'a hyphen used as a dash', re: /\s-\s/ },
  { name: 'and sign', re: /&/ },
  { name: 'e.g.', re: /\be\.g\.|\bi\.e\./i },
  { name: 'arrow', re: /[←-⇿➔➡]|->|=>/ },
  { name: 'exclamation', re: /!/ },
];

/** One server approval row for change order `coX`: by default the portal function wrote it and its record states the amount. */
const coRowFor = (over: Record<string, unknown> = {}) => [as<import('../utils/proofPack/core').ProofCoApprovalRecord>({
  changeOrderId: 'coX', decision: 'approved', signerName: 'A', serverCreatedAt: at('2026-09-01'), documentHash: 'fe'.repeat(32), hasSignature: true,
  recordedVia: 'portal_function', signedTerms: { changeOrderNumber: 9, scope: 'x', amountCents: 100 }, ...over,
})];

// ── rules ────────────────────────────────────────────────────────────────────
type Rule = (w: World) => string[] | Promise<string[]>;
const RULES: Record<string, Rule> = {
  'S1 every class is reached by the record its rule names': (w) => {
    const bad: string[] = [];
    const p = build(w);
    const want: Record<string, [Strength, string]> = {
      'punch_seal:s1': ['sealed', 'punch_seal_record'],
      'punch_item:pi1': ['sealed', 'punch_item_in_seal'],
      'change_order:co12': ['signed', 'co_client_signed'],
      'lien_waiver:w1': ['signed', 'waiver_sub_signed'],
      'field_ticket:ft1': ['locked', 'field_ticket_signed'],
      'daily_report:d1': ['recorded', 'daily_report'],
      'daily_report:d2': ['recorded', 'daily_report'],
      'photo:ph1': ['recorded', 'photo_phone'],
      'punch_item:pi2': ['recorded', 'punch_item_open'],
      'change_order:co13': ['recorded', 'co_portal_no_signature'],
      'change_order:co14': ['stated', 'co_marked_approved'],
      'lien_waiver:w2': ['stated', 'waiver_paper'],
      'lien_waiver:w3': ['stated', 'waiver_received'],
      'inspection:perm1:in1': ['stated', 'inspection_typed'],
    };
    for (const [key, [s, r]] of Object.entries(want)) {
      const it = item(p, key);
      if (!it) bad.push(`${key} is not in the package`);
      else if (it.strength !== s || it.reason !== r) bad.push(`${key} is ${it.strength}/${it.reason}, want ${s}/${r}`);
    }
    for (const it of p.items) if (CORE.PROOF_REASON_STRENGTH[it.reason] !== it.strength) bad.push(`${it.key}: reason ${it.reason} does not carry strength ${it.strength}`);
    // Not evidence at all.
    for (const key of ['change_order:co15', 'change_order:co16', 'lien_waiver:w4', 'lien_waiver:w5', 'field_ticket:ft2', 'punch_item:pi3', 'punch_item:pi4', 'daily_report:d0', 'daily_report:dx', 'photo:phOld', 'photo:phInc', 'inspection:perm1:in2']) {
      if (item(p, key)) bad.push(`${key} must not be in the package`);
    }
    // The pay document: locked only when the SERVER row carries the lock stamp (rule T1 holds the rest).
    if (p.pay.strength !== 'recorded' || p.pay.reason !== 'pay_app_saved') bad.push(`a pay application with no lock on the server is ${p.pay.strength}/${p.pay.reason}`);
    const locked = build(w, { payAppServer: as(serverRow(APP3(), at('2026-09-30', '18:00'))) });
    if (locked.pay.strength !== 'locked' || locked.pay.reason !== 'pay_app_locked') bad.push('a pay application the server holds a lock for, with equal figures, is not locked');
    const inv = build(w, { payRef: { kind: 'invoice', id: 'inv2' } });
    if (inv.pay.strength !== 'recorded') bad.push('an invoice is above recorded');
    const invLink = w.M.invoiceStrength({ payLinkId: 'plink', payLinkUrl: 'https://x' });
    if (invLink.strength !== 'recorded') bad.push('an invoice with a pay link is above recorded: no migration locks an invoice');
    // The unit rules, asked directly.
    if (w.M.lienWaiverStrength(as({ status: 'signed', signedAt: at('2026-09-01'), subSignature: { role: 'gc', name: 'x', signedAt: '' } }), 'signing_page')?.strength !== 'stated') bad.push('a waiver the contractor signed for the sub is not stated');
    if (w.M.lienWaiverStrength(as({ status: 'signed', subSignature: { role: 'sub', name: 'x', signedAt: '' } }), 'signing_page')?.strength !== 'stated') bad.push('a sub signature with no signing time is not stated');
    if (w.M.lienWaiverStrength(as({ status: 'requested' }), 'signing_page') !== null) bad.push('a requested waiver is classed as evidence');
    const sealOf = (items: unknown[]) => as<Parameters<typeof CORE.punchItemStrength>[1]>({ id: 's1', items });
    if (w.M.punchItemStrength(as({ id: 'zz', sealId: 's1', description: 'a', location: 'b', closedAt: at('2026-09-24') }), sealOf([{ id: 'pi1', description: 'a', location: 'b', closedAt: at('2026-09-24') }])).strength !== 'recorded') bad.push('a punch item the seal does not list is sealed because it says so');
    if (w.M.punchItemStrength(as({ id: 'pi1', sealId: 's1', description: 'a', location: 'b', closedAt: at('2026-09-24') }), null).strength !== 'recorded') bad.push('a punch item is sealed with no seal on file');
    if (w.M.fieldTicketStrength(as({ id: 'ft1', status: 'signed' }), fixture().fieldTicketServer) !== null) bad.push('a ticket with no authorization is classed as signed');
    const rowFor = coRowFor;
    const signedHistory = as<Parameters<typeof CORE.changeOrderStrength>[0]>({ id: 'coX', status: 'approved', auditTrail: [{ id: 'x', action: 'client_signed_via_portal', actor: 'a', timestamp: at('2026-09-01'), detail: 'record SHA-256 0123456789abcdef' }] });
    if (w.M.changeOrderStrength(as({ ...signedHistory, status: 'submitted' }), rowFor()) !== null) bad.push('a change order that is not approved is evidence');
    if (w.M.changeOrderStrength(signedHistory, rowFor())?.strength !== 'signed') bad.push('a change order whose row the portal function wrote is not signed');
    // Its own history is written by the in-app client view too (the device clock), and the account can write it: never enough alone.
    for (const [name, rows] of [['no rows', []], ['rows not read', undefined], ['a row for another change order', rowFor({ changeOrderId: 'other' })], ['a row with no server time', rowFor({ serverCreatedAt: '' })]] as const) {
      const r = w.M.changeOrderStrength(signedHistory, rows as never);
      if (r?.strength !== 'recorded' || r?.reason !== 'co_signed_not_confirmed') bad.push(`a change order whose history says signed, with ${name}, is ${r?.strength}/${r?.reason}`);
    }
    const unread = build(w, { coSignatures: undefined });
    const u12 = item(unread, 'change_order:co12');
    if (!u12 || u12.strength !== 'recorded' || u12.reason !== 'co_signed_not_confirmed') bad.push('with the signature rows unread, co12 is still called signed');
    if (!unread.openItems.some((o) => o.code === 'source_not_loaded' && o.source === 'change_order_signatures')) bad.push('unread signature rows are not an open item');
    const s12 = item(p, 'change_order:co12');
    if (!s12 || s12.kind !== 'change_order' || s12.signedAtServer !== at('2026-09-15', '12:05') || s12.approvedDay !== '2026-09-15') bad.push('a signed change order does not carry the server row’s time');
    if (!p.openItems.some((o) => o.code === 'signer_identity_not_checked')) bad.push('the package does not say that a signer’s identity is not checked');
    if (build(w, { coSignatures: [], changeOrders: [], lienWaivers: [], punchSeal: null, fieldTickets: [] }).openItems.some((o) => o.code === 'signer_identity_not_checked')) bad.push('a document that names no signer talks about signers');
    // A seal dated after the period does not seal the period's items.
    const early = build(w, { payRef: { kind: 'pay_app', id: 'app2' } });
    if (early.items.some((i) => i.strength === 'sealed')) bad.push('a seal made after the period seals a record in the period');
    // Every class is present in the fixture, and in PROOF_STRENGTHS.
    for (const s of CORE.PROOF_STRENGTHS) if (!p.items.some((i) => i.strength === s)) bad.push(`no fixture record is ${s}`);
    if (CORE.PROOF_STRENGTHS.join() !== 'sealed,signed,locked,recorded,stated') bad.push('the classes or their order changed');
    return bad;
  },

  'T1 a label above Recorded needs a server fact, and prints the server’s figures': async (w) => {
    const bad: string[] = [];
    const en = w.M.doc.en;
    const es = w.M.doc.es;
    const coOf = (p: Pack, id = 'co12') => { const i = item(p, `change_order:${id}`); return i && i.kind === 'change_order' ? i : undefined; };
    const is = (name: string, i: { strength: string; reason: string } | undefined | null, s: Strength, r: string) => {
      if (!i) bad.push(`${name}: not in the document`);
      else if (i.strength !== s || i.reason !== r) bad.push(`${name}: ${i.strength}/${i.reason}, want ${s}/${r}`);
    };
    // The reasons that carry a class above Recorded are exactly these six.
    const above = Object.entries(CORE.PROOF_REASON_STRENGTH).filter(([, s]) => CORE.strengthRank(s) > CORE.strengthRank('recorded')).map(([r]) => r).sort();
    if (above.join() !== 'co_client_signed,field_ticket_signed,pay_app_locked,punch_item_in_seal,punch_seal_record,waiver_sub_signed') bad.push(`reasons above Recorded: ${above.join()}`);
    if (CORE.CO_RECORDED_VIA_PORTAL !== 'portal_function' || CORE.WAIVER_SIGNED_VIA_PAGE !== 'signing_page') bad.push('the provenance markers the app reads were renamed');

    // (a) TODAY, with neither migration applied: no marker, so NOTHING is Signed.
    const today = build(w, todayFacts());
    if (today.counts.signed !== 0 || today.items.some((i) => i.strength === 'signed')) bad.push('with no provenance marker on any row, a record is still labelled Signed');
    is('today: co12', coOf(today), 'recorded', 'co_signature_recorded');
    is('today: waiver w1', item(today, 'lien_waiver:w1'), 'recorded', 'waiver_link_signature');
    if (!today.openItems.some((o) => o.code === 'source_not_loaded' && o.source === 'waiver_signature_marks')) bad.push('today: the document does not say how each waiver was signed could not be read');
    if (!/data-count="signed"[^>]*>0</.test(html(w, today))) bad.push('today: the strip does not print 0 Signed');
    const CO_BY_ACCOUNT = 'A signature record for this change order was saved to MAGE ID’s server at the time shown. The contractor’s account is able to create such a record. MAGE ID does not check who signed.';
    if (en.reason.co_signature_by_account !== CO_BY_ACCOUNT) bad.push('the sentence for an approval the contractor’s account wrote changed');
    for (const r of ['co_signature_recorded', 'co_signature_by_account'] as const) {
      if (!en.reason[r].includes('The contractor’s account is able to create such a record.') || !en.reason[r].endsWith('MAGE ID does not check who signed.')) bad.push(`en reason ${r} does not say the contractor’s account can create the record and that nobody checked who signed`);
      if (!es.reason[r].includes('La cuenta del contratista puede crear un registro así.') || !es.reason[r].endsWith('MAGE ID no revisa quién firmó.')) bad.push(`es reason ${r} does not say the same`);
    }
    if (!en.reason.waiver_link_signature.startsWith('A signature was recorded through the signing link for this waiver.') || !en.reason.waiver_link_signature.endsWith('MAGE ID does not check who used the link.')) bad.push('the waiver sentence changed');
    if (!es.reason.waiver_link_signature.endsWith('MAGE ID no revisa quién usó el enlace.')) bad.push('the Spanish waiver sentence changed');
    for (const lang of ['en', 'es'] as const) {
      const t = visible(html(w, today, lang));
      for (const r of ['co_signature_recorded', 'waiver_link_signature'] as const) if (!t.includes(w.M.doc[lang].reason[r])) bad.push(`today (${lang}): the ${r} sentence is not printed`);
    }

    // (b) An approval the contractor's account wrote is Recorded, whatever else it carries.
    const base = fixture();
    const withCo12 = (over: Record<string, unknown>) => (base.coSignatures ?? []).map((r) => (r.changeOrderId === 'co12' ? { ...r, ...over } : r));
    const byAccount = build(w, { coSignatures: as(withCo12({ recordedVia: 'contractor_account' })) });
    is('a contractor-inserted approval', coOf(byAccount), 'recorded', 'co_signature_by_account');
    if (!visible(html(w, byAccount)).includes(CO_BY_ACCOUNT)) bad.push('a contractor-inserted approval does not print its sentence');
    const history = as<Parameters<typeof CORE.changeOrderStrength>[0]>({ id: 'coX', status: 'approved', auditTrail: [{ id: 'x', action: 'client_signed_via_portal', actor: 'a', timestamp: at('2026-09-01') }] });
    for (const via of [null, undefined, '', 'contractor_account', 'PORTAL_FUNCTION', 'portal', 'service_role', 'signing_page']) {
      const r = w.M.changeOrderStrength(history, coRowFor({ recordedVia: via }));
      if (!r || r.strength !== 'recorded') bad.push(`recorded_via = ${String(via)} gives ${r?.strength}`);
    }
    const unit = (name: string, over: Record<string, unknown>, s: Strength, reason: string) => is(name, w.M.changeOrderStrength(history, coRowFor(over)), s, reason);
    unit('a portal row', {}, 'signed', 'co_client_signed');
    unit('a portal row with no amount in its record', { signedTerms: null }, 'recorded', 'co_signature_no_amount');
    unit('a row with no drawn signature', { hasSignature: false }, 'recorded', 'co_portal_no_signature');
    unit('a row with no record fingerprint', { documentHash: '' }, 'recorded', 'co_portal_no_signature');
    unit('a declined row', { decision: 'declined' }, 'recorded', 'co_server_declined');

    // (c) The amount AS SIGNED prints, and a later change to the change order is said in words.
    const raised = build(w, { changeOrders: as(base.changeOrders.map((c) => (c.id === 'co12' ? { ...c, changeAmount: 20000 } : c))) });
    const r12 = coOf(raised);
    if (!r12 || r12.signedAmountCents !== 200000 || r12.changeAmountCents !== 2000000 || !r12.amountDiffers) bad.push(`an amount changed after signing: ${JSON.stringify(r12 && { s: r12.signedAmountCents, now: r12.changeAmountCents, d: r12.amountDiffers })}`);
    const differ = raised.openItems.find((o) => o.code === 'change_order_amounts_differ');
    if (!differ || differ.n !== 1) bad.push('a changed amount is not an open item');
    const rawRaised = html(w, raised);
    if (!/data-co-amount="200000"/.test(rawRaised) || /data-co-amount="2000000"/.test(rawRaised)) bad.push('the amount at the head of the change order is not the signed amount');
    if (!/data-co-differs/.test(rawRaised)) bad.push('a changed amount is not marked on the change order');
    if (!visible(rawRaised).includes('Signed for $2,000.00 on Sep 15, 2026, 12:05 UTC. The change order now reads $20,000.00.')) bad.push('the document does not say "Signed for $2,000.00 on ... The change order now reads $20,000.00."');
    if (!visible(html(w, raised, 'es')).includes(`${es.coSignedFor('$2,000.00', HTML.proofInstant(at('2026-09-15', '12:05'), es, 'es'))} ${es.coNowReads('$20,000.00')}`)) bad.push('the Spanish document does not say the amount as signed and the amount now');
    const raisedToday = build(w, { ...todayFacts(), changeOrders: as(base.changeOrders.map((c) => (c.id === 'co12' ? { ...c, changeAmount: 20000 } : c))) });
    if (!visible(html(w, raisedToday)).includes('The signature record states $2,000.00, dated Sep 15, 2026, 12:05 UTC. The change order now reads $20,000.00.')) bad.push('a Recorded signature record does not print its own amount and the amount now');
    if (/Signed for \$/.test(visible(html(w, raisedToday)))) bad.push('a Recorded signature record prints "Signed for"');
    if (en.coNowReads('$20,000.00') !== 'The change order now reads $20,000.00.' || en.coSignedFor('$2,000.00', 'Sep 15, 2026') !== 'Signed for $2,000.00 on Sep 15, 2026.') bad.push('the two amount sentences changed');
    if (/^Signed\b|^Firmad/.test(en.coRecordStates('$1.00', 'x')) || /^Signed\b|^Firmad/.test(es.coRecordStates('$1.00', 'x')) || !es.coNowReads('$1.00') || !es.coSignedFor('$1.00', 'x')) bad.push('a Recorded signature record’s sentence says "Signed", or a Spanish amount sentence is empty');
    const same = coOf(build(w));
    if (!same || same.amountDiffers || same.signedAmountCents !== 200000) bad.push('an unchanged change order says its amount differs');
    if (/data-co-differs/.test(html(w, build(w)))) bad.push('an unchanged change order is marked as differing');
    const reworded = coOf(build(w, { changeOrders: as(base.changeOrders.map((c) => (c.id === 'co12' ? { ...c, description: 'Two steel beams' } : c))) }));
    if (!reworded || !reworded.descriptionDiffers) bad.push('a description changed after signing is not flagged');

    // (d) The NEWEST row decides: a later decline is a decline.
    const laterDecline = [...(base.coSignatures ?? []), { ...withCo12({})[0], decision: 'declined', serverCreatedAt: at('2026-09-20'), signedTerms: null }];
    for (const rows of [laterDecline, [...laterDecline].reverse()]) {
      const d = build(w, { coSignatures: as(rows) });
      is('a later decline', coOf(d), 'recorded', 'co_server_declined');
      const c = coOf(d);
      if (c && (c.serverDecision !== 'declined' || c.signedAmountCents !== null || c.signedAtServer !== at('2026-09-20'))) bad.push('a later decline still prints the earlier signature’s amount or time');
      if (!d.openItems.some((o) => o.code === 'change_orders_declined_on_server' && o.n === 1)) bad.push('a later decline is not an open item');
    }
    const earlierDecline = [...(base.coSignatures ?? []), { ...withCo12({})[0], decision: 'declined', serverCreatedAt: at('2026-09-12'), signedTerms: null }];
    is('an earlier decline, then a signature', coOf(build(w, { coSignatures: as(earlierDecline) })), 'signed', 'co_client_signed');

    // (e) The pay application: Locked only when the server row carries the stamp AND the figures are equal.
    const linked = [as<Input['payApps'][number]>(payApp('app3', 3, '2026-09-30', { periodFrom: '2026-09-01', payLinkId: 'plink_1', payLinkUrl: 'https://pay.example/x', paidAt: at('2026-10-01') })), as<Input['payApps'][number]>(payApp('app2', 2, '2026-08-31'))];
    const noStamp = build(w, { payApps: linked });
    is('a pay link with no lock stamp on the server', noStamp.pay, 'recorded', 'pay_app_link_no_lock');
    if (/data-lock-time/.test(html(w, noStamp))) bad.push('a pay application with no lock stamp prints a lock time');
    const STAMP = at('2026-09-30', '18:00');
    const lockedPack = build(w, { payApps: linked, payAppServer: as(serverRow(APP3(), STAMP)) });
    is('a stamped row with equal figures', lockedPack.pay, 'locked', 'pay_app_locked');
    if (lockedPack.pay.kind !== 'pay_app' || lockedPack.pay.lockedAt !== STAMP || !lockedPack.pay.periodFromLocked) bad.push('a locked pay application does not carry the server’s lock stamp');
    for (const lang of ['en', 'es'] as const) {
      const raw = html(w, lockedPack, lang);
      const d = w.M.doc[lang];
      if (!/data-lock-time/.test(raw) || !visible(raw).includes(d.lockTime(HTML.proofInstant(STAMP, d, lang)))) bad.push(`${lang}: the lock time printed is not the server’s certified_at`);
    }
    const tweaks: [string, Record<string, unknown>][] = [
      ['a total one cent off', { totals: { ...serverRow(APP3()).totals, currentPaymentDue: 18111.18 } }],
      ['a line amount', { lines: serverRow(APP3()).lines.map((l) => (l.id === 'l1' ? { ...l, thisPeriod: 12000.01 } : l)) }],
      ['a line’s words', { lines: serverRow(APP3()).lines.map((l) => (l.id === 'l1' ? { ...l, description: 'Framing and sheathing' } : l)) }],
      ['a billed line missing', { lines: serverRow(APP3()).lines.filter((l) => l.id !== 'l6') }],
      ['the application number', { applicationNumber: 4 }],
      ['the last day of the period', { periodTo: '2026-09-29' }],
      ['a header sum', { netChangeByCO: 2500 }],
      ['no saved totals', { totals: null }],
    ];
    for (const [name, over] of tweaks) {
      const d = build(w, { payAppServer: as(serverRow(APP3(), STAMP, over)) });
      is(`a stamped row that differs by ${name}`, d.pay, 'recorded', 'pay_app_lock_differs');
      if (d.pay.kind === 'pay_app' && d.pay.lockedAt !== null) bad.push(`a stamped row that differs by ${name} still carries a lock time`);
      if (/data-lock-time/.test(html(w, d))) bad.push(`a stamped row that differs by ${name} still prints a lock time`);
    }
    const notRead = build(w, { payApps: linked, payAppServer: undefined });
    is('a pay application the server could not be read for', notRead.pay, 'recorded', 'pay_app_not_checked');
    if (!notRead.openItems.some((o) => o.code === 'source_not_loaded' && o.source === 'pay_document')) bad.push('an unread pay application row is not an open item');
    if (!/could not be checked/.test(en.reason.pay_app_not_checked) || !/no se pudo revisar/.test(es.reason.pay_app_not_checked)) bad.push('the unread pay application sentence does not say "could not be checked"');
    is('a pay application with no row on the server', build(w, { payAppServer: null }).pay, 'recorded', 'pay_app_saved');
    is('a row for another pay application', build(w, { payAppServer: as(serverRow(payApp('other', 3, '2026-09-30'), STAMP)) }).pay, 'recorded', 'pay_app_saved');
    const everyLocalSign = { payLinkId: 'x', payLinkUrl: 'https://x', paidAt: at('2026-10-01') };
    if (w.M.payAppStrength(everyLocalSign, { lockedAt: null }, true).strength !== 'recorded') bad.push('a pay link on the phone locks a pay application');
    if (w.M.payAppStrength(everyLocalSign, { lockedAt: STAMP }, false).strength !== 'recorded') bad.push('a stamp with unequal figures locks a pay application');
    if (w.M.payAppStrength(everyLocalSign, undefined, true).strength !== 'recorded') bad.push('an unread row locks a pay application');
    if (w.M.payAppStrength({}, { lockedAt: STAMP }, true).strength !== 'locked') bad.push('a stamped row with equal figures is not locked');

    // (f) A sealed punch item prints the SEAL's fields, and only an equal local copy is Sealed.
    const pi = (over: Record<string, unknown>) => as<Input['punchItems']>(base.punchItems.map((x) => (x.id === 'pi1' ? { ...x, ...over } : x)));
    const punchOf = (p: Pack) => { const i = item(p, 'punch_item:pi1'); return i && i.kind === 'punch_item' ? i : undefined; };
    for (const [name, over] of [['other words', { description: 'Touch up paint at the stair and the hall' }], ['another place', { location: 'Hall' }], ['another closed day', { closedAt: at('2026-09-26') }], ['no seal id', { sealId: undefined }], ['another seal’s id', { sealId: 's9' }]] as const) {
      const d = build(w, { punchItems: pi(over) });
      is(`a local punch item with ${name}`, punchOf(d), 'recorded', 'punch_item_differs_from_seal');
      if (d.counts.sealed !== 1) bad.push(`a local punch item with ${name}: ${d.counts.sealed} sealed records, want the seal alone`);
    }
    const spaced = punchOf(build(w, { punchItems: pi({ description: '  Touch up   paint at the stair ', linkedTaskId: 't1' }) }));
    is('a local copy equal to the manifest but for spaces', spaced, 'sealed', 'punch_item_in_seal');
    if (spaced && (spaced.description !== 'Touch up paint at the stair' || spaced.location !== 'Stair' || spaced.closedDay !== '2026-09-24')) bad.push('a sealed punch item does not print the manifest’s own fields');
    if (spaced && spaced.taskIds.length !== 0) bad.push('a sealed punch item carries a task link the seal does not cover');
    const attach = build(w, { punchItems: pi({ linkedTaskId: 't1' }) });
    if (attach.pay.lines.some((l) => l.itemKeys.includes('punch_item:pi1'))) bad.push('a sealed punch item is attached to a billed line through a task link the seal does not cover');
    const sealItem = item(build(w), 'punch_seal:s1');
    if (!sealItem || sealItem.kind !== 'punch_seal' || sealItem.sealedAt !== at('2026-09-25') || sealItem.manifestHash !== HASH64 || sealItem.itemCount !== 1) bad.push('the seal record does not print the server row’s own fields');

    // (g) A field ticket is Locked only when the server holds it as signed and every printed field is equal.
    const srvTicket = base.fieldTicketServer!.ft1;
    for (const [name, server] of [
      ['no such ticket on the server', {}], ['a draft on the server', { ft1: { ...srvTicket, status: 'draft' } }], ['no signature block on the server', { ft1: { ...srvTicket, hasAuthorization: false } }],
      ['other words on the server', { ft1: { ...srvTicket, workDescription: 'Shored two openings' } }], ['other hours on the server', { ft1: { ...srvTicket, totalHours: 9 } }],
      ['another signer on the server', { ft1: { ...srvTicket, signerName: 'Someone Else' } }], ['another signing time on the server', { ft1: { ...srvTicket, signedAt: at('2026-09-11', '17:05') } }],
      ['another worker count on the server', { ft1: { ...srvTicket, workerCount: 3 } }],
    ] as const) is(`a field ticket with ${name}`, item(build(w, { fieldTicketServer: as(server) }), 'field_ticket:ft1'), 'recorded', 'field_ticket_differs');
    is('a field ticket the server could not be read for', item(build(w, { fieldTicketServer: undefined }), 'field_ticket:ft1'), 'recorded', 'field_ticket_not_checked');

    // (h) A lien waiver is Signed only with the signing page's marker.
    const subSigned = as<Parameters<typeof CORE.lienWaiverStrength>[0]>({ status: 'signed', signedAt: at('2026-09-29'), subSignature: { role: 'sub', name: 'x', signedAt: at('2026-09-29') } });
    for (const via of [undefined, null, '', 'contractor_account', 'SIGNING_PAGE', 'portal_function']) is(`a waiver with signed_via = ${String(via)}`, w.M.lienWaiverStrength(subSigned, via), 'recorded', 'waiver_link_signature');
    is('a waiver the signing page marked', w.M.lienWaiverStrength(subSigned, 'signing_page'), 'signed', 'waiver_sub_signed');
    is('a waiver the contractor’s account signed', item(build(w, { waiverSignedVia: { w1: 'contractor_account' } }), 'lien_waiver:w1'), 'recorded', 'waiver_link_signature');
    is('a waiver with no marker read', item(build(w, { waiverSignedVia: {} }), 'lien_waiver:w1'), 'recorded', 'waiver_link_signature');

    // (i) What the store hands the core: reduced rows, hashes re-taken, nothing assumed.
    const record = consentRecord(12, 'Steel beam over the kitchen opening', '2000.00');
    const rawRow = { change_order_id: 'co12', decision: 'approved', signer_name: ' Dana Client ', created_at: at('2026-09-15', '12:05'), document_hash: await sha(record), signature_hash: 'abc', consent_record: record, recorded_via: 'portal_function' };
    const red = await w.M.reduceCo(rawRow, sha);
    if (!red || red.recordedVia !== 'portal_function' || !red.hasSignature || red.signerName !== 'Dana Client' || JSON.stringify(red.signedTerms) !== JSON.stringify({ changeOrderNumber: 12, scope: 'Steel beam over the kitchen opening', amountCents: 200000 })) bad.push(`an approval row is reduced to ${JSON.stringify(red)}`);
    if (/Mozilla|dana\.secret|user_agent|signer_email/.test(JSON.stringify(red))) bad.push('a reduced approval row keeps the record’s text');
    const tampered = await w.M.reduceCo({ ...rawRow, consent_record: record.replace('2000.00', '9000.00') }, sha);
    if (!tampered || tampered.signedTerms !== null) bad.push('an amount is read from a record whose SHA-256 is not the row’s document_hash');
    const { recorded_via: _dropped, ...noMark } = rawRow;
    void _dropped;
    const unmarked = await w.M.reduceCo(noMark, sha);
    if (!unmarked || unmarked.recordedVia !== null) bad.push('a row with no recorded_via column is not "not known"');
    if ((await w.M.reduceCo({ ...rawRow, recorded_via: null }, sha))?.recordedVia !== null) bad.push('a NULL recorded_via is not "not known"');
    if (CORE.parseCoConsentRecord('change_amount_usd: abc') !== null || CORE.parseCoConsentRecord('scope: x') !== null || CORE.parseCoConsentRecord(null) !== null) bad.push('an amount is read from a record that states none');
    if (CORE.parseCoConsentRecord('change_amount_usd: -300.00')?.amountCents !== -30000) bad.push('a credit in a signature record is misread');
    const rawPay = { id: 'app3', certified_at: STAMP, application_number: 3, period_to: '2026-09-30', original_contract_sum: '180000', net_change_by_co: 2000, contract_sum_to_date: 182000, less_previous_certificates: 61234.56,
      lines: serverRow(APP3()).lines, snapshot_totals: { ...serverRow(APP3()).totals, __mageCertificate: { periodFrom: '2026-09-01' } } };
    const redPay = w.M.reducePayApp(rawPay);
    if (!redPay || redPay.lockedAt !== STAMP || redPay.originalContractSum !== 180000 || redPay.periodFrom !== '2026-09-01' || !redPay.totals || redPay.totals.currentPaymentDue !== 18111.17 || redPay.lines.length !== 6) bad.push('an aia_pay_apps row is not reduced to the server’s figures and its lock stamp');
    else is('a reduced, stamped server row with equal figures', build(w, { payAppServer: redPay }).pay, 'locked', 'pay_app_locked');
    const bareRow = w.M.reducePayApp({ ...rawPay, certified_at: null, snapshot_totals: null });
    if (!bareRow || bareRow.lockedAt !== null || bareRow.totals !== null) bad.push('a row with no stamp and no saved totals is reduced to something else');
    const { canonicalJson } = await import('../supabase/functions/_shared/punchSealManifest');
    const manifest = { sealId: 's1', projectId: 'p1', items: [{ id: 'pi1', description: 'Touch up paint at the stair', location: 'Stair', closedAt: at('2026-09-24'), assignedSub: 'Kowalski' }] };
    const rawSeal = { id: 's1', project_id: 'p1', sealed_at: at('2026-09-25'), item_count: 1, manifest, manifest_hash: await sha(canonicalJson(manifest)), signer_name: 'Dana Client', signer_role: 'Owner' };
    const redSeal = await w.M.reduceSeal(rawSeal, sha);
    if (!redSeal || redSeal.items.length !== 1 || redSeal.items[0].description !== 'Touch up paint at the stair' || redSeal.sealedAt !== at('2026-09-25')) bad.push('a punch_seals row is not reduced to its manifest’s own fields');
    if (redSeal && /Kowalski|assignedSub/.test(JSON.stringify(redSeal))) bad.push('a reduced seal keeps a sub’s name');
    if (await w.M.reduceSeal({ ...rawSeal, manifest: { ...manifest, items: [{ ...manifest.items[0], description: 'Edited' }] } }, sha) !== undefined) bad.push('a seal whose manifest does not give its stored fingerprint is still used');
    if (await w.M.reduceSeal({ ...rawSeal, id: 's2' }, sha) !== undefined) bad.push('a manifest that names another seal is still used');
    const redTicket = w.M.reduceTicket({ id: 'ft1', status: 'signed', number: 4, date: '2026-09-11', work_description: 'Shored the opening', labor: [{ workerName: 'Pedro Secretworker', hours: 6, rate: 41.37 }, { workerName: 'Pedro Secretworker', hours: 2.5 }], authorization: { name: 'Dana Client', role: 'owner', signedAt: at('2026-09-11', '17:00') } });
    if (!redTicket || redTicket.workerCount !== 2 || redTicket.totalHours !== 8.5 || !redTicket.hasAuthorization || /Pedro|41\.37/.test(JSON.stringify(redTicket))) bad.push('a field_tickets row is not reduced to counts and hours');
    // The reads: the marker column is asked for, and its absence is "not known", never an error that hides the rows.
    const store = stripComments(w.F['utils/proofPack/store.ts']);
    if (!/let res = await ask\(`\$\{CO_APPROVAL_COLUMNS\}, \$\{CO_APPROVAL_MARK_COLUMN\}`\);\s*if \(res\.error && isMissingColumn\(res\.error\)\) res = await ask\(CO_APPROVAL_COLUMNS\);\s*if \(res\.error\) return undefined;/.test(store)) bad.push('the approval rows are not read with the marker first and without it when the column is missing');
    if (!/\.select\(`id, \$\{WAIVER_MARK_COLUMN\}`\)\.eq\('project_id', projectId\);\s*if \(error\) return undefined;/.test(store)) bad.push('a failed read of the waiver marker is not "not known"');
    if (!/\.select\(PAY_APP_SERVER_COLUMNS\)\.eq\('id', payAppId\)\.maybeSingle\(\);\s*if \(error\) return undefined;\s*if \(!data\) return null;/.test(store)) bad.push('the pay application row is not read fresh with "could not read" kept apart from "no such row"');
    const payCols = /export const PAY_APP_SERVER_COLUMNS = '([^']+)'/.exec(store)?.[1] ?? '';
    if (!/\bcertified_at\b/.test(payCols) || !/\bsnapshot_totals\b/.test(payCols) || !/\blines\b/.test(payCols)) bad.push('the pay application read leaves out the lock stamp, the saved totals or the lines');
    // The document is built from a FRESH read, inside the tap.
    const review = stripComments(w.F['components/proofPack/ProofPackReview.tsx']);
    if (!/const makePack = async \(\) => \{\s*const fresh = await readProofServerFacts\(projectId, payRef\);[\s\S]{0,200}?buildProofPack\(\{ \.\.\.withFacts\(localInput, fresh\), leaveOut: Array\.from\(off\), generatedAt: new Date\(\)\.toISOString\(\) \}\)/.test(review)) bad.push('the document is not built from server facts read inside the Create and Share tap');
    if (!/payAppServer: f \? f\.payAppServer : undefined,\s*coSignatures: f \? f\.coSignatures : undefined,\s*punchSeal: f \? f\.punchSeal : undefined,\s*waiverSignedVia: f \? f\.waiverSignedVia : undefined,\s*fieldTicketServer: f \? f\.fieldTicketServer : undefined,/.test(review)) bad.push('the review screen assumes a server fact it has not read');
    if (/usePunchSeal|punchSealStore/.test(review)) bad.push('the review screen classes punch items from a cached seal');
    if (!/disabled=\{made\.kind === 'busy' \|\| facts === null\}/.test(review)) bad.push('Create and Share is live before the server facts are read');
    return bad;
  },

  'T2 what was left out, what the fingerprint does not show, and what is not on file are all said': (w) => {
    const bad: string[] = [];
    const out = ['photo:ph2', 'daily_report:d2', 'change_order:co14', 'lien_waiver:w1', 'punch_item:pi1'];
    const p = build(w, { leaveOut: out });
    const all = build(w);
    const want: Record<Strength, number> = { sealed: 1, signed: 1, locked: 0, recorded: 2, stated: 1 };
    for (const s of CORE.PROOF_STRENGTHS) if (p.leftOut.byStrength[s] !== want[s]) bad.push(`left out under ${s}: ${p.leftOut.byStrength[s]}, want ${want[s]}`);
    if (CORE.PROOF_STRENGTHS.reduce((n, s) => n + p.leftOut.byStrength[s], 0) !== p.leftOut.total) bad.push('the left-out counts by class do not add up to the total');
    for (const s of CORE.PROOF_STRENGTHS) if (p.counts[s] + p.leftOut.byStrength[s] !== all.counts[s]) bad.push(`${s}: included plus left out is not the whole`);
    for (const lang of ['en', 'es'] as const) {
      const d = w.M.doc[lang];
      const raw = html(w, p, lang);
      const first = raw.split('page-break-before:always')[0];
      const strip = first.slice(first.indexOf('data-counts'), first.indexOf('data-left-out="'));
      for (const s of CORE.PROOF_STRENGTHS) {
        const m = new RegExp(`data-left-out-class="${s}" data-n="(\\d+)"[^>]*>([^<]*)<`).exec(strip);
        if (!m) { bad.push(`${lang}: no left-out count under ${s} in the strip on page one`); continue; }
        if (Number(m[1]) !== p.leftOut.byStrength[s]) bad.push(`${lang}: ${m[1]} left out under ${s}, the document data has ${p.leftOut.byStrength[s]}`);
        if (m[2] !== d.leftOutCellLabel(p.leftOut.byStrength[s])) bad.push(`${lang}: the left-out cell under ${s} reads "${m[2]}"`);
        const between = strip.slice(strip.indexOf(`data-count="${s}"`) + 12, strip.indexOf(`data-left-out-class="${s}"`));
        if (strip.indexOf(`data-count="${s}"`) < 0 || strip.indexOf(`data-count="${s}"`) > strip.indexOf(`data-left-out-class="${s}"`) || /data-count="|data-left-out-class="/.test(between)) bad.push(`${lang}: the left-out count under ${s} is not in the same cell as the included count`);
      }
      const kinds = /<p data-left-out-kinds[^>]*>([^<]*)</.exec(first)?.[1] ?? '';
      for (const k of CORE.PROOF_ITEM_KINDS) if (p.leftOut.byKind[k] > 0 && !kinds.includes(`${d.kindLabel[k]} ${p.leftOut.byKind[k]}`)) bad.push(`${lang}: the left-out line by kind does not say ${d.kindLabel[k]} ${p.leftOut.byKind[k]}`);
      const none = html(w, all, lang).split('page-break-before:always')[0];
      if ((none.match(/data-left-out-class="[a-z]+" data-n="0"/g) ?? []).length !== 5 || /data-left-out-kinds/.test(none)) bad.push(`${lang}: a full document does not print 0 left out under each class`);
    }
    // The fingerprint: what it shows, what it does not, where it can be checked.
    const LIMITS_EN = 'The fingerprint shows this document has not changed since that time. It does not show that the records in it are true or that they match MAGE ID’s database.';
    const LIMITS_ES = 'La huella muestra que este documento no ha cambiado desde esa hora. No muestra que los registros que contiene sean ciertos ni que coincidan con la base de datos de MAGE ID.';
    const NOTE_EN = 'The check code is a short name for the fingerprint. Compare the full fingerprint.';
    const NOTE_ES = 'El código de revisión es un nombre corto de la huella. Compara la huella completa.';
    if (w.M.doc.en.fingerprintLimits !== LIMITS_EN || w.M.doc.es.fingerprintLimits !== LIMITS_ES) bad.push('the sentence about what the fingerprint does not show changed');
    if (w.M.doc.en.checkCodeNote !== NOTE_EN || w.M.doc.es.checkCodeNote !== NOTE_ES) bad.push('the check code note changed');
    if (!/only in the MAGE ID app, on the device that made this document/.test(w.M.doc.en.checkWhere) || !/no public page/.test(w.M.doc.en.checkWhere)) bad.push('the document does not say the check works only in the app on the device that made it');
    if (!/solo funciona en la app de MAGE ID, en el dispositivo que hizo este documento/.test(w.M.doc.es.checkWhere)) bad.push('the Spanish document does not say where the check works');
    if (!/photo files/.test(w.M.doc.en.fingerprintOutside) || !/server time/.test(w.M.doc.en.fingerprintOutside) || !/layout and language/.test(w.M.doc.en.fingerprintOutside)) bad.push('the document does not name what is printed and not fingerprinted');
    if (!/archivos de las fotos/.test(w.M.doc.es.fingerprintOutside) || !/hora del servidor/.test(w.M.doc.es.fingerprintOutside)) bad.push('the Spanish document does not name what is printed and not fingerprinted');
    if (!/company name/.test(w.M.doc.en.fingerprintCovers) || !/nombre de la empresa/.test(w.M.doc.es.fingerprintCovers)) bad.push('the document does not say the company name is inside the fingerprint');
    if (all.company.name !== 'Example Builders' || !w.M.canonicalText(all).includes('"company":{"name":"Example Builders"}')) bad.push('the company name is not inside the fingerprint');
    if (!visible(html(w, build(w, { companyName: 'Fingerprinted Name LLC' }))).includes('Fingerprinted Name LLC')) bad.push('the company name printed is not the one inside the fingerprint');
    for (const lang of ['en', 'es'] as const) for (const serverCreatedAt of [at('2026-10-02', '09:31'), null]) {
      const d = w.M.doc[lang];
      const raw = html(w, all, lang, { ...FPRINT, serverCreatedAt });
      const t = visible(raw);
      const where = `${lang}${serverCreatedAt ? '' : ', not on file'}`;
      if (!/data-fingerprint-limits/.test(raw) || !t.includes(d.fingerprintLimits)) bad.push(`${where}: the document does not say what the fingerprint does not show`);
      if (!/data-fingerprint-outside/.test(raw) || !t.includes(d.fingerprintOutside)) bad.push(`${where}: the document does not name what is outside the fingerprint`);
      if (!/data-check-code-note/.test(raw) || !t.includes(d.checkCodeNote)) bad.push(`${where}: the check code note is not printed`);
      if (!t.includes(HTML.fingerprintGroups(FPRINT.hash))) bad.push(`${where}: the full fingerprint is not printed`);
      if (serverCreatedAt && !t.includes(d.checkWhere)) bad.push(`${where}: the document does not say where the check works`);
      const hashSize = Number(/data-hash="[0-9a-f]{64}"[^>]*font-size:(\d+(?:\.\d+)?)px/.exec(raw)?.[1] ?? 0);
      const codeSize = Number(/data-check-code style="[^"]*font-size:(\d+(?:\.\d+)?)px/.exec(raw)?.[1] ?? 99);
      if (!(hashSize >= 12) || hashSize < codeSize) bad.push(`${where}: the fingerprint is printed smaller than the check code (${hashSize}px against ${codeSize}px)`);
    }
    if (w.EN['office.proofPack.saved.checkCodeNoteBody'] !== NOTE_EN || w.ES['office.proofPack.saved.checkCodeNoteBody']?.s !== NOTE_ES) bad.push('the screen’s check code note is not the document’s');
    if (w.EN['office.proofPack.saved.fingerprintLimitsBody'] !== LIMITS_EN || w.ES['office.proofPack.saved.fingerprintLimitsBody']?.s !== LIMITS_ES) bad.push('the screen’s fingerprint sentence is not the document’s');
    const review = stripComments(w.F['components/proofPack/ProofPackReview.tsx']);
    for (const k of ['checkCodeNoteBody', 'fingerprintLimitsBody', 'serverGetsBody', 'freeTextBody', 'peopleBody', 'coordsBody', 'noticeBody']) if (!new RegExp(`copy\\.${k}\\b`).test(review)) bad.push(`the review screen does not show ${k}`);
    if (!/copy\.leftOutCountLabel\(pack\.leftOut\.byStrength\[s\]\)/.test(review)) bad.push('the review screen does not show the left-out count under each label');
    // "MAGE ID does not check who signed" whenever ANY included record carries a signer's name.
    const quiet = { changeOrders: [], coSignatures: [], lienWaivers: [], waiverSignedVia: {}, punchSeal: null, fieldTickets: [], fieldTicketServer: {} };
    const f = fixture();
    const alone: [string, Partial<Input>][] = [
      ['a field ticket', { ...quiet, fieldTickets: f.fieldTickets, fieldTicketServer: f.fieldTicketServer }],
      ['a field ticket classed Recorded', { ...quiet, fieldTickets: f.fieldTickets, fieldTicketServer: {} }],
      ['a punch seal', { ...quiet, punchSeal: f.punchSeal }],
      ['a lien waiver with no marker', { ...quiet, lienWaivers: f.lienWaivers }],
      ['a change order row the contractor’s account wrote', { ...quiet, changeOrders: f.changeOrders, coSignatures: (f.coSignatures ?? []).map((r) => ({ ...r, recordedVia: 'contractor_account' })) }],
    ];
    for (const [name, over] of alone) {
      const d = build(w, as<Partial<Input>>(over));
      if (!d.items.some(CORE.itemNamesASigner)) { bad.push(`${name}: the fixture names no signer`); continue; }
      if (!d.openItems.some((o) => o.code === 'signer_identity_not_checked')) bad.push(`${name} names a signer and the document does not say who signed is not checked`);
      for (const lang of ['en', 'es'] as const) if (!visible(html(w, d, lang)).includes(lang === 'en' ? 'MAGE ID does not check who signed.' : 'MAGE ID no revisa quién firmó.')) bad.push(`${name} (${lang}): the sentence is not printed`);
    }
    if (build(w, as<Partial<Input>>(quiet)).openItems.some((o) => o.code === 'signer_identity_not_checked')) bad.push('a document that names no signer talks about signers');
    // Numbers: what is copied, what is summed, what is not on file.
    const en = w.M.doc.en;
    if (/nothing here is recalculated/i.test(en.billedSourcePayApp) || !en.billedSourcePayApp.includes(en.payAppRows.workThisPeriod) || !en.billedSourcePayApp.includes(en.payAppRows.storedMaterial) || !/added up from its lines/.test(en.billedSourcePayApp)) bad.push('the pay application sentence does not name the two rows that are added up');
    if (!w.M.doc.es.billedSourcePayApp.includes(w.M.doc.es.payAppRows.workThisPeriod) || !w.M.doc.es.billedSourcePayApp.includes(w.M.doc.es.payAppRows.storedMaterial)) bad.push('the Spanish pay application sentence does not name the two rows that are added up');
    const rawAll = html(w, all);
    const summed = [...rawAll.matchAll(/data-money="(-?\d+)" data-summed/g)].map((m) => Number(m[1]));
    if (all.pay.kind !== 'pay_app' || summed.length !== 2 || summed[0] !== all.pay.workThisPeriodCents || summed[1] !== all.pay.storedMaterialCents) bad.push(`the summed rows marked in the document are ${summed.join()}`);
    if (all.pay.kind === 'pay_app' && (all.pay.workThisPeriodCents !== all.pay.lines.reduce((n, l) => n + (l.thisPeriodCents ?? 0), 0) || all.pay.workThisPeriodCents !== 2140055 || all.pay.storedMaterialCents !== 75025)) bad.push('the two summed rows are not the sum of the billed lines in whole cents');
    if (!/data-billed-source/.test(rawAll) || !visible(rawAll).includes(en.billedSourcePayApp)) bad.push('the pay application sentence is not printed');
    const invoice = build(w, { payRef: { kind: 'invoice', id: 'inv2' } });
    const rawInv = html(w, invoice);
    if (!visible(rawInv).includes(en.billedSourceInvoice) || /data-summed/.test(rawInv)) bad.push('an invoice document sums a row or does not say its figures are copied');
    if (invoice.pay.lines.some((l) => l.thisPeriodCents !== null || l.storedCents !== null)) bad.push('an invoice line carries an amount "this period"');
    const invTable = /<table data-invoice-lines[\s\S]*?<\/table>/.exec(rawInv)?.[0] ?? '';
    if (!invTable || visible(invTable).includes(en.lineColsLabel.thisPeriod) || !visible(invTable).includes(en.lineColsLabel.lineTotal) || !visible(invTable).includes('$12,000.00')) bad.push('a progress invoice prints a line’s full total under This Period');
    if (visible(rawInv).includes(`${en.lineColsLabel.thisPeriod} `) && /<th[^>]*>This Period<\/th>/.test(rawInv)) bad.push('an invoice document has a This Period column');
    // A record with no totals prints "Not on file", never $0.00.
    const { totals: _t, ...noTotalsRec } = APP3();
    void _t;
    for (const [name, over] of [
      ['no totals on the device', { payApps: [as<Input['payApps'][number]>(noTotalsRec), f.payApps[1]], payAppServer: as(serverRow(APP3(), null, { totals: null })) }],
      ['no saved totals on the server', { payAppServer: as(serverRow(APP3(), null, { totals: null })) }],
    ] as [string, Partial<Input>][]) {
      const d = build(w, over);
      if (d.pay.kind !== 'pay_app') continue;
      const nulls = [d.pay.totalCompletedAndStoredCents, d.pay.totalRetainageCents, d.pay.totalEarnedLessRetainageCents, d.pay.currentPaymentDueCents, d.pay.balanceToFinishCents];
      if (nulls.some((v) => v !== null)) bad.push(`${name}: a total prints as a number (${JSON.stringify(nulls)})`);
      const open = d.openItems.find((o) => o.code === 'pay_figures_not_on_file');
      if (!open || open.n !== 5) bad.push(`${name}: the missing figures are not an open item`);
      for (const lang of ['en', 'es'] as const) {
        const raw = html(w, d, lang);
        const table = raw.slice(raw.indexOf('data-billed-source'), raw.indexOf('data-counts'));
        if ((table.match(/data-money-gap/g) ?? []).length !== 5) bad.push(`${name} (${lang}): ${(table.match(/data-money-gap/g) ?? []).length} figures print as a gap, want 5`);
        if (/\$0\.00/.test(visible(table))) bad.push(`${name} (${lang}): a missing figure prints as $0.00`);
        if (!visible(table).includes(w.M.doc[lang].notOnFile)) bad.push(`${name} (${lang}): the document does not print "${w.M.doc[lang].notOnFile}"`);
      }
    }
    if (HTML.proofMoneyOrGap(null, en) !== 'Not on file' || HTML.proofMoneyOrGap(0, en) !== '$0.00' || CORE.proofCentsOrNull(undefined) !== null || CORE.proofCentsOrNull(0) !== 0) bad.push('a missing figure and a zero figure are not told apart');
    if (!/typeof billedCents === 'number' \? proofMoney\(billedCents\) : copy\.notOnFileLabel/.test(review)) bad.push('the review screen prints a missing billed amount as money');
    // Privacy, word for word.
    const gets = String(w.EN['office.proofPack.privacy.serverGetsBody'] ?? '');
    for (const part of ['the project’s id', 'the pay document’s id', 'the first letter of the project name', 'the city', 'how many records are listed', 'how many were left out', 'the fingerprint', 'the fingerprint of the file']) if (!gets.includes(part)) bad.push(`the screen does not say the server receives ${part}`);
    if (Object.keys(w.M.recordArgs(all, { hash: HASH64, code: '' })).sort().join() !== 'p_city,p_content_hash,p_item_count,p_left_out_count,p_pay_id,p_pay_kind,p_project_id,p_project_initial') bad.push('the server is sent something the privacy sentence does not list');
    if (!String(w.EN['office.proofPack.privacy.freeTextBody'] ?? '').endsWith('they may name people. Read them before you share.') || !String(w.ES['office.proofPack.privacy.freeTextBody']?.s ?? '').endsWith('Léelos antes de compartir.')) bad.push('the review screen does not tell the contractor to read the free text before sharing');
    if (!String(w.EN['office.proofPack.privacy.peopleBody'] ?? '').includes('A lien waiver names the subcontractor or supplier that gave it.')) bad.push('the screen does not say a waiver names the sub');
    if (/the package (?:holds|has|carries) no (?:worker|name)/i.test(String(w.EN['office.proofPack.privacy.peopleBody'] ?? ''))) bad.push('the screen promises no name is in the document');
    if (!all.openItems.some((o) => o.code === 'free_text_as_typed')) bad.push('the document does not say free text prints as typed');
    for (const lang of ['en', 'es'] as const) if (!w.M.doc[lang].waiversNameSubs || !visible(html(w, all, lang)).includes(DOC.PROOF_DOC_COPY[lang].waiversNameSubs)) bad.push(`${lang}: the document does not say a waiver names the sub`);
    if (!/names the subcontractor or supplier/.test(w.M.doc.en.waiversNameSubs)) bad.push('the waiver sentence does not say a waiver names the sub');
    // Photo coordinates are OUT unless switched on.
    const ph = (d: Pack) => { const i = item(d, 'photo:ph1'); return i && i.kind === 'photo' ? i : undefined; };
    if (all.photoCoordinates !== 'left_out' || ph(all)?.latitude !== null || ph(all)?.longitude !== null || ph(all)?.accuracyMeters !== null) bad.push('photo coordinates are in the document by default');
    if (/39\.29038|-76\.61219|39\.29|76\.61/.test(w.M.canonicalText(all)) || /39\.29038|76\.61219/.test(html(w, all))) bad.push('photo coordinates are printed, or fingerprinted, with the switch off');
    if (!all.openItems.some((o) => o.code === 'photo_coordinates_left_out') || !/data-coords-left-out/.test(html(w, all))) bad.push('the document does not say coordinates were left out');
    const withCoords = build(w, { includeCoordinates: true });
    if (withCoords.photoCoordinates !== 'printed' || ph(withCoords)?.latitude !== 39.29038 || !visible(html(w, withCoords)).includes('39.29038, -76.61219')) bad.push('coordinates do not print when switched on');
    if (withCoords.openItems.some((o) => o.code === 'photo_coordinates_left_out')) bad.push('a document with coordinates says they were left out');
    if (!/const \[includeCoordinates, setIncludeCoordinates\] = useState\(false\);/.test(review) || !/testID="proof-pack-coords"/.test(review)) bad.push('the coordinates switch is missing or does not default to off');
    return bad;
  },

  'N1 the Notice to Recipients, on page one and at the foot of every page': (w) => {
    const bad: string[] = [];
    if (w.M.doc.en.notice !== NOTICE_EN) bad.push('the English notice changed');
    if (w.M.doc.es.notice !== NOTICE_ES) bad.push('the Spanish notice changed');
    if (w.M.doc.en.noticeHeadingLabel !== 'Notice to Recipients' || !w.M.doc.es.noticeHeadingLabel) bad.push('the notice heading changed');
    const packs: [string, Pack][] = [['a pay application', build(w)], ['an invoice', build(w, { payRef: { kind: 'invoice', id: 'inv2' } })], ['today’s facts', build(w, todayFacts())],
      ['an empty job', build(w, { dailyReports: [], photos: [], changeOrders: [], coSignatures: [], punchItems: [], punchSeal: null, permits: [], lienWaivers: [], waiverSignedVia: {}, fieldTickets: [], fieldTicketServer: {} })]];
    for (const [name, p] of packs) for (const [lang, notice] of [['en', NOTICE_EN], ['es', NOTICE_ES]] as const) {
      const raw = html(w, p, lang);
      const where = `${name} (${lang})`;
      const first = raw.split('page-break-before:always')[0];
      const block = /<div class="no-break" data-notice="first-page"[\s\S]*?<\/div>\s*<\/div>/.exec(first)?.[0] ?? '';
      if (!block) bad.push(`${where}: no notice block on the first page`);
      else {
        if (!visible(block).includes(notice) || !visible(block).includes(w.M.doc[lang].noticeHeadingLabel)) bad.push(`${where}: the first-page block does not carry the notice word for word`);
        if (first.indexOf('data-notice="first-page"') > first.indexOf('data-money')) bad.push(`${where}: money is printed before the notice`);
      }
      const foot = /<tfoot[^>]*>([\s\S]*?)<\/tfoot>/.exec(raw);
      if (!foot || !/data-notice="page-footer"/.test(foot[1]) || !visible(foot[1]).includes(notice)) bad.push(`${where}: the notice is not in the footer that repeats on every page`);
      if (!/<tfoot style="display:table-footer-group">/.test(raw)) bad.push(`${where}: the footer is not a repeating table footer group`);
      // The footer's table frames the WHOLE document, so the footer follows every page of it.
      const open = raw.indexOf('<table data-page-frame');
      const body = raw.indexOf('<tbody><tr><td style="padding:0">');
      const close = raw.lastIndexOf('</td></tr></tbody>\n</table>');
      if (open < 0 || body < open || close < body) bad.push(`${where}: the document is not framed by the footer’s table`);
      else {
        const inside = raw.slice(body, close);
        const after = raw.slice(close);
        if (!inside.includes('data-what-this-is') || !inside.includes('data-fingerprint') || (inside.match(/page-break-before:always/g) ?? []).length !== (raw.match(/page-break-before:always/g) ?? []).length) bad.push(`${where}: part of the document is outside the framed table`);
        if (/data-item|data-money|data-open=/.test(after) || /data-item|data-money/.test(raw.slice(0, open))) bad.push(`${where}: a record is printed outside the framed table`);
      }
      if (/position:\s*fixed/.test(raw)) bad.push(`${where}: a fixed footer overprints the page`);
      if (visible(raw).split(notice).length - 1 !== 2) bad.push(`${where}: the notice is printed ${visible(raw).split(notice).length - 1} times, want 2 (page one and the repeating footer)`);
    }
    if (w.EN['office.proofPack.notice.body'] !== NOTICE_EN || w.ES['office.proofPack.notice.body']?.s !== NOTICE_ES) bad.push('the review screen’s notice is not the document’s');
    if (w.EN['office.proofPack.notice.headingLabel'] !== 'Notice to Recipients') bad.push('the review screen’s notice heading changed');
    return bad;
  },

  'A1 the name a reader sees is Pay Period Record': (w) => {
    const bad: string[] = [];
    if (w.M.doc.en.titleLabel !== NAME_EN) bad.push(`the English title is "${w.M.doc.en.titleLabel}"`);
    if (w.M.doc.es.titleLabel !== NAME_ES) bad.push(`the Spanish title is "${w.M.doc.es.titleLabel}"`);
    const p = build(w);
    for (const [lang, name] of [['en', NAME_EN], ['es', NAME_ES]] as const) {
      const raw = html(w, p, lang);
      if (!new RegExp(`<title>${name} `).test(raw)) bad.push(`${lang}: the PDF title does not start with the name`);
      if (!visible(raw.split('data-what-this-is')[0]).includes(name)) bad.push(`${lang}: the header does not carry the name`);
      if (!w.M.fileTitle(p, lang).startsWith(`${name} 3 `)) bad.push(`${lang}: the file name is "${w.M.fileTitle(p, lang)}"`);
      if (/package|paquete/i.test(visible(raw))) bad.push(`${lang}: the document still calls itself a package`);
    }
    for (const lang of ['en', 'es'] as const) for (const { key, s } of docStrings(w.M.doc[lang])) if (/\bpackages?\b|\bpaquetes?\b/i.test(s)) bad.push(`docCopy.${lang}.${key} says package: "${s}"`);
    if (w.EN['office.proofPack.screen.titleLabel'] !== NAME_EN || w.ES['office.proofPack.screen.titleLabel']?.s !== NAME_ES) bad.push('the screen title is not the name');
    if (w.EN['office.proofPack.entry.label'] !== `Build ${NAME_EN}` || !/registro del periodo de pago/i.test(String(w.ES['office.proofPack.entry.label']?.s))) bad.push('the entry row does not carry the name');
    for (const [k, v] of Object.entries(w.EN)) if (/\bpackages?\b/i.test(String(v))) bad.push(`${k} says package: "${String(v)}"`);
    for (const [k, v] of Object.entries(w.ES)) if (/\bpaquetes?\b/i.test(String(v.s))) bad.push(`${k} (es) says paquete: "${String(v.s)}"`);
    if (!/<Stack\.Screen name="proof-pack" options=\{\{ title: 'Pay Period Record', headerShown: false \}\} \/>/.test(w.F['app/_layout.tsx'])) bad.push('the route title in the root layout is not the name');
    // No shipped source says the old name outside a comment that explains the rename.
    for (const [file, src] of [...Object.entries(w.F), ...Object.entries(w.far)]) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      if (/proof of work/i.test(stripComments(src))) bad.push(`${file} carries the old name in code`);
    }
    return bad;
  },

  'S2 a photo is never above Recorded': (w) => {
    const bad: string[] = [];
    if (w.M.photoStrength().strength !== 'recorded') bad.push('photoStrength answers above or below recorded');
    const rich = fixture();
    const photos = [
      ...rich.photos,
      as<Input['photos'][number]>({ id: 'phRich', projectId: 'p1', uri: 'x', storagePath: 'u/p1/rich.jpg', timestamp: at('2026-09-21'), createdAt: at('2026-09-21'), latitude: 39.29, longitude: -76.61, locationAccuracyMeters: 3, linkedTaskId: 't1', sealId: 's1', hash: HASH64, verified: true, portalState: { status: 'sent' } }),
    ];
    const p = build(w, { photos });
    const ph = p.items.filter((i) => i.kind === 'photo');
    if (ph.length !== 5) bad.push(`expected 5 photos (4 gallery in the period, 1 on a report only), got ${ph.length}`);
    for (const i of ph) {
      if (CORE.strengthRank(i.strength) > CORE.strengthRank('recorded')) bad.push(`${i.key} is ${i.strength}`);
      if (i.kind === 'photo' && i.timeSource !== 'phone_clock') bad.push(`${i.key} time source is ${i.timeSource}`);
    }
    const src = (k: string) => { const i = item(p, k); return i && i.kind === 'photo' ? i.placeSource : 'missing'; };
    if (src('photo:ph1') !== 'phone_gps') bad.push('a photo with coordinates does not say phone GPS');
    if (src('photo:ph2') !== 'none') bad.push('a photo with no place does not say none');
    if (src('photo:ph3') !== 'typed') bad.push('a photo with a typed place does not say typed');
    const d = item(p, 'photo:phD');
    if (!d || d.kind !== 'photo' || d.from !== 'daily_report' || d.dailyReportId !== 'd1') bad.push('a photo that is only on a daily report is missing or unsourced');
    const h = visible(html(w, p));
    if (!h.includes(DOC.PROOF_DOC_COPY.en.photoPlace.phone_gps)) bad.push('the document does not say where a photo place came from');
    if (!/Phone clock:/.test(h)) bad.push('the document does not say a photo time is the phone clock');
    return bad;
  },

  'S3 the period comes from the pay document, and says how': (w) => {
    const bad: string[] = [];
    const a3 = as<Parameters<typeof CORE.payAppPeriod>[0]>(payApp('app3', 3, '2026-09-30', { periodFrom: '2026-09-01' }));
    const a3n = as<Parameters<typeof CORE.payAppPeriod>[0]>(payApp('app3', 3, '2026-09-30'));
    const a2 = as<Parameters<typeof CORE.payAppPeriod>[0]>(payApp('app2', 2, '2026-08-31'));
    const eq = (name: string, got: unknown, want: unknown) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
    eq('own dates', w.M.payAppPeriod(a3, [a3, a2]), { from: '2026-09-01', to: '2026-09-30', startSource: 'pay_app_period_from', endSource: 'pay_app_period_to' });
    eq('day after prior', w.M.payAppPeriod(a3n, [a3n, a2]), { from: '2026-09-01', to: '2026-09-30', startSource: 'day_after_prior_pay_app', endSource: 'pay_app_period_to' });
    eq('open', w.M.payAppPeriod(a2, [a2]), { from: null, to: '2026-08-31', startSource: 'open', endSource: 'pay_app_period_to' });
    eq('a later application is not a prior one', w.M.payAppPeriod(a2, [a3, a2]), { from: null, to: '2026-08-31', startSource: 'open', endSource: 'pay_app_period_to' });
    eq('no end date', w.M.payAppPeriod(as({ ...a3, periodTo: '' }), [a2]), null);
    const f = fixture();
    eq('invoice', w.M.invoicePeriod(f.invoices[1], f.invoices), { from: '2026-09-01', to: '2026-09-30', startSource: 'day_after_prior_invoice', endSource: 'invoice_issue_date' });
    eq('first invoice', w.M.invoicePeriod(f.invoices[0], f.invoices), { from: null, to: '2026-08-31', startSource: 'open', endSource: 'invoice_issue_date' });
    const inv = build(w, { payRef: { kind: 'invoice', id: 'inv2' } });
    if (!inv.openItems.some((o) => o.code === 'invoice_has_no_period')) bad.push('an invoice package does not say an invoice has no period');
    const open = build(w, { payRef: { kind: 'pay_app', id: 'app2' } });
    if (!open.openItems.some((o) => o.code === 'period_start_open')) bad.push('an open period is not an open item');
    if (!item(open, 'daily_report:d0')) bad.push('an open period does not reach back to the first record');
    const missing = w.M.buildProofPack(fixture({ payRef: { kind: 'pay_app', id: 'nope' } }));
    if (missing.ok || missing.reason !== 'pay_document_missing') bad.push('a pay document that is not on file builds a package');
    const other = w.M.buildProofPack(fixture({ project: { id: 'p2', name: 'Other', location: '' } }));
    if (other.ok) bad.push('a pay document from another project builds a package');
    const h = visible(html(w, build(w)));
    if (!h.includes(DOC.PROOF_DOC_COPY.en.periodStart.pay_app_period_from)) bad.push('the document does not say how the period was found');
    return bad;
  },

  'M1 the pay figures are the pay document’s own': (w) => {
    const bad: string[] = [];
    const rec = payApp('app3', 3, '2026-09-30', { periodFrom: '2026-09-01' });
    const p = build(w);
    if (p.pay.kind !== 'pay_app') return ['the pay block is not a pay application'];
    const c = CORE.proofCents;
    const footer = AIA.g703Footer(AIA.applicationFromSavedRecord(as(rec)));
    const want: Record<string, number> = {
      originalContractSumCents: c(rec.originalContractSum), netChangeByCOCents: c(rec.netChangeByCO), contractSumToDateCents: c(rec.contractSumToDate),
      totalCompletedAndStoredCents: c(rec.totals.totalCompletedAndStored), totalRetainageCents: c(rec.totals.totalRetainage),
      totalEarnedLessRetainageCents: c(rec.totals.totalEarnedLessRetainage), lessPreviousCertificatesCents: c(rec.lessPreviousCertificates),
      currentPaymentDueCents: c(rec.totals.currentPaymentDue), balanceToFinishCents: c(rec.totals.balanceToFinish),
      workThisPeriodCents: c(footer.thisPeriod), storedMaterialCents: c(footer.stored),
    };
    const pay = p.pay as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(want)) if (pay[k] !== v) bad.push(`${k}: package ${pay[k]}, pay application ${v}`);
    if (want.currentPaymentDueCents !== 1811117) bad.push('the fixture changed under the rule');
    if (p.pay.applicationNumber !== 3) bad.push('the application number is not the pay application’s');
    for (const k of Object.keys(pay)) if (/Cents$/.test(k) && pay[k] !== null && !Number.isInteger(pay[k])) bad.push(`${k} is not whole cents`);
    // The printed money is exactly those cents.
    const h = html(w, p);
    const printed = [...h.matchAll(/data-money="(-?\d+)"[^>]*>([^<]*)</g)].map((m) => [Number(m[1]), m[2]] as const);
    for (const v of Object.values(want)) if (!printed.some(([cents]) => cents === v)) bad.push(`${v} cents is not printed in the billed table`);
    for (const [cents, shown] of printed) if (shown !== HTML.proofMoney(cents)) bad.push(`${cents} cents is printed as ${shown}`);
    if (HTML.proofMoney(1811117) !== '$18,111.17' || HTML.proofMoney(-30000) !== '-$300.00' || HTML.proofMoney(5) !== '$0.05') bad.push('proofMoney prints cents wrongly');
    if (!visible(h).includes('$18,111.17')) bad.push('the current payment due is not on the page as the pay application states it');
    // Lines: only lines billed this period, with the record's own amounts.
    if (p.pay.lines.map((l) => l.id).join() !== 'l1,l2,l3,l4,l6') bad.push(`lines printed: ${p.pay.lines.map((l) => l.id).join()}`);
    const l2 = p.pay.lines.find((l) => l.id === 'l2');
    if (!l2 || l2.thisPeriodCents !== 500055 || l2.storedCents !== 75025 || l2.scheduledValueCents !== 2200000) bad.push('line l2 does not carry the pay application’s amounts');
    // Invoice.
    const inv = build(w, { payRef: { kind: 'invoice', id: 'inv2' } });
    if (inv.pay.kind !== 'invoice' || inv.pay.totalDueCents !== 1272050 || inv.pay.taxCents !== 72050 || inv.pay.amountPaidCents !== 10025 || inv.pay.subtotalCents !== 1200000 || inv.pay.retentionCents !== 60000 || inv.pay.number !== 8) bad.push('the invoice figures are not the invoice’s own');
    if (c(0.285) !== 29 || c(-0.285) !== -29 || c(Number.NaN) !== 0 || c(1.005) !== 101) bad.push('proofCents does not round half away from zero');
    // The wording is the pay application's (the "and" sign aside).
    const en = w.M.doc.en.payAppRows;
    if (en.currentPaymentDue !== 'Current Payment Due' || en.totalCompletedAndStored !== 'Total Completed and Stored to Date' || en.lessPreviousCertificates !== 'Less Previous Certificates for Payment' || en.netChangeByCO !== 'Net Change by Change Orders' || en.totalEarnedLessRetainage !== 'Total Earned Less Retainage') bad.push('a pay application row is not worded as the pay application words it');
    return bad;
  },

  'L1 a record reaches a line only through a task or a change order': (w) => {
    const bad: string[] = [];
    const p = build(w);
    const line = (id: string) => p.pay.lines.find((l) => l.id === id);
    const eq = (name: string, got: unknown, want: unknown) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
    eq('l1 link', line('l1')?.link, 'by_task');
    eq('l1 records', [...(line('l1')?.itemKeys ?? [])].sort(), ['daily_report:d1', 'photo:ph1']);
    eq('l2 records', [...(line('l2')?.itemKeys ?? [])].sort(), ['photo:ph2', 'punch_item:pi2']);
    eq('l3 link', line('l3')?.link, 'by_change_order');
    eq('l3 records', line('l3')?.itemKeys, ['change_order:co12']);
    eq('l4 link', line('l4')?.link, 'no_task');
    eq('l4 records', line('l4')?.itemKeys, []);
    eq('l6 link', line('l6')?.link, 'task_no_records');
    // A record with no task never attaches, even on the right day.
    for (const l of p.pay.lines) for (const k of l.itemKeys) { const it = item(p, k); if (!it) bad.push(`${l.id} names ${k}, which is not in the package`); }
    if (p.pay.lines.some((l) => l.itemKeys.includes('daily_report:d2') || l.itemKeys.includes('photo:ph3') || l.itemKeys.includes('lien_waiver:w1'))) bad.push('a record with no task is attached to a line');
    const open = p.openItems.find((o) => o.code === 'lines_without_records');
    if (!open || open.n !== 2 || open.of !== 5) bad.push(`lines without records: ${JSON.stringify(open)}`);
    const inv = build(w, { payRef: { kind: 'invoice', id: 'inv2' } });
    if (inv.pay.lines.some((l) => l.link !== 'not_linkable' || l.itemKeys.length)) bad.push('an invoice line claims a link');
    if (CORE.changeOrderNumberOfLine('CO #12 Steel') !== 12 || CORE.changeOrderNumberOfLine('Steel for CO #12') !== null || CORE.changeOrderNumberOfLine('Framing') !== null) bad.push('the change order line rule reads more than a leading "CO #n"');
    const h = visible(html(w, p));
    for (const k of ['by_task', 'by_change_order', 'no_task', 'task_no_records'] as const) if (!h.includes(DOC.PROOF_DOC_COPY.en.lineLink[k])) bad.push(`the document does not print the "${k}" sentence`);
    if (!h.includes(DOC.PROOF_DOC_COPY.en.linesIntro)) bad.push('the document does not say how records are attached');
    if (!visible(html(w, inv)).includes(DOC.PROOF_DOC_COPY.en.linesInvoiceIntro)) bad.push('an invoice package does not say lines cannot be linked');
    return bad;
  },

  'O1 left-out records are removed, counted and disclosed': (w) => {
    const bad: string[] = [];
    const all = build(w);
    const out = ['photo:ph2', 'daily_report:d2', 'change_order:co14'];
    const p = build(w, { leaveOut: out });
    if (p.leftOut.total !== 3) bad.push(`left out total is ${p.leftOut.total}`);
    if (p.leftOut.byKind.photo !== 1 || p.leftOut.byKind.daily_report !== 1 || p.leftOut.byKind.change_order !== 1) bad.push('left out by kind is wrong');
    if (p.leftOut.byStrength.recorded !== 2 || p.leftOut.byStrength.stated !== 1 || p.leftOut.byStrength.sealed + p.leftOut.byStrength.signed + p.leftOut.byStrength.locked !== 0) bad.push(`left out by class is wrong: ${JSON.stringify(p.leftOut.byStrength)}`);
    for (const k of out) if (item(p, k)) bad.push(`${k} is still in the package`);
    if (p.items.length !== all.items.length - 3) bad.push('the wrong number of records was removed');
    if (p.pay.lines.some((l) => l.itemKeys.includes('photo:ph2'))) bad.push('a left-out record is still attached to a line');
    if (!p.openItems.some((o) => o.code === 'items_left_out' && o.n === 3)) bad.push('the open items do not carry the left-out count');
    if (all.leftOut.total !== 0 || all.openItems.some((o) => o.code === 'items_left_out')) bad.push('a full package claims something was left out');
    const sum = (x: Pack) => CORE.PROOF_STRENGTHS.reduce((n, s) => n + x.counts[s], 0);
    if (sum(p) !== p.items.length || sum(all) !== all.items.length) bad.push('the strength counts do not add up to the records');
    if (build(w, { leaveOut: ['photo:nope'] }).leftOut.total !== 0) bad.push('a key that names nothing is counted as left out');
    for (const lang of ['en', 'es'] as const) {
      const raw = html(w, p, lang);
      const h = visible(raw);
      if (!/data-left-out="3"/.test(raw)) bad.push(`${lang}: the document does not carry the left-out count`);
      if (!h.includes(DOC.PROOF_DOC_COPY[lang].leftOutLine(3))) bad.push(`${lang}: the document does not say 3 items were left out`);
      const first = raw.split('page-break-before:always')[0];
      if (!first.includes('data-left-out="3"')) bad.push(`${lang}: the left-out line is not on the first page`);
    }
    if (w.M.doc.en.leftOutLine(3) !== '3 items were left out by the contractor.' || w.M.doc.en.leftOutLine(1) !== '1 item was left out by the contractor.') bad.push('the left-out sentence changed');
    if (w.M.doc.es.leftOutLine(3) !== 'El contratista dejó fuera 3 registros.') bad.push('the Spanish left-out sentence changed');
    if (!visible(html(w, all)).includes(DOC.PROOF_DOC_COPY.en.nothingLeftOut)) bad.push('a full package does not say nothing was left out');
    const review = stripComments(w.F['components/proofPack/ProofPackReview.tsx']);
    if (!/leaveOut: Array\.from\(off\)/.test(review)) bad.push('the review screen does not hand its switched-off records to the core');
    if (!/copy\.leftOutBody\(pack\.leftOut\.total\)/.test(review)) bad.push('the review screen does not tell the contractor the count will be printed');
    return bad;
  },

  'G1 gaps print as gaps': (w) => {
    const bad: string[] = [];
    const p = build(w);
    const has = (x: Pack, code: string) => x.openItems.some((o) => o.code === code);
    for (const code of ['waiver_coverage_not_checked', 'no_inspection_signoff', 'photo_files_not_fingerprinted', 'pay_not_locked', 'days_without_report', 'photos_without_place', 'photos_not_uploaded', 'reports_changed_later', 'change_orders_not_signed', 'waivers_requested_unsigned', 'lines_without_records']) {
      if (!has(p, code)) bad.push(`open item ${code} is missing`);
    }
    const days = p.openItems.find((o) => o.code === 'days_without_report');
    if (!days || days.n !== 28 || days.of !== 30) bad.push(`days without a report: ${JSON.stringify(days)}`);
    const place = p.openItems.find((o) => o.code === 'photos_without_place');
    if (!place || place.n !== 3 || place.of !== 4) bad.push(`photos without a place: ${JSON.stringify(place)}`);
    if (p.waiverGaps.map((g) => g.id).join() !== 'w4') bad.push('the asked-for waiver is not listed as a gap');
    const d1 = item(p, 'daily_report:d1');
    if (!d1 || d1.kind !== 'daily_report' || !d1.changedAfterItsDay || d1.lastChangedAt !== at('2026-09-14')) bad.push('a report changed after its day does not say so');
    // Sources that were not read say "not checked", never "none".
    const unread = build(w, { lienWaivers: undefined, punchSeal: undefined, photosLoaded: false, dailyReportsLoaded: false, coSignatures: undefined, payAppServer: undefined, fieldTicketServer: undefined });
    for (const s of ['lien_waivers', 'punch_seal', 'photos', 'daily_reports', 'change_order_signatures', 'pay_document', 'field_tickets']) if (!unread.openItems.some((o) => o.code === 'source_not_loaded' && o.source === s)) bad.push(`an unread ${s} source is not an open item`);
    if (has(unread, 'no_lien_waivers') || has(unread, 'no_punch_seal')) bad.push('an unread source prints as "none on file"');
    if (!visible(html(w, unread)).includes(DOC.PROOF_DOC_COPY.en.waiversNotChecked)) bad.push('unread waivers do not print "not checked"');
    // Nothing on file says so.
    const bare = build(w, { dailyReports: [], photos: [], changeOrders: [], coSignatures: [], punchItems: [], punchSeal: null, permits: [], lienWaivers: [], waiverSignedVia: {}, fieldTickets: [], fieldTicketServer: {} });
    if (bare.items.length !== 0) bad.push('an empty job has records');
    if (!has(bare, 'no_lien_waivers') || !has(bare, 'no_punch_seal') || !has(bare, 'no_change_orders')) bad.push('an empty job does not list what is missing');
    const hb = visible(html(w, bare));
    const en = DOC.PROOF_DOC_COPY.en;
    for (const s of [en.reportsEmpty, en.photosEmpty, en.changeOrdersEmpty, en.punchEmpty, en.waiversEmpty]) if (!hb.includes(s)) bad.push(`an empty section does not say: ${s}`);
    // Every open item prints, in both languages, as a whole sentence.
    for (const lang of ['en', 'es'] as const) {
      const raw = html(w, p, lang);
      for (const o of p.openItems) {
        const s = DOC.PROOF_DOC_COPY[lang].openItem(o);
        if (!s || !/[.]$/.test(s)) bad.push(`${lang}: open item ${o.code} has no sentence`);
        else if (!visible(raw).includes(s)) bad.push(`${lang}: open item ${o.code} is not printed`);
      }
      if ((raw.match(/data-open="/g) ?? []).length !== p.openItems.length) bad.push(`${lang}: the open items list is short`);
      if (!/data-waiver-gap/.test(raw)) bad.push(`${lang}: the asked-for waiver is not printed`);
    }
    for (const lang of ['en', 'es'] as const) for (const code of OPEN_CODES) {
      if (!w.M.doc[lang].openItem({ code, n: 2, of: 5, source: 'photos' })) bad.push(`${lang}: open item ${code} has no words`);
    }
    return bad;
  },

  'D1 every printed record carries its strength label': (w) => {
    const bad: string[] = [];
    const p = build(w);
    for (const lang of ['en', 'es'] as const) {
      const raw = html(w, p, lang);
      const blocks = raw.split('data-item').slice(1);
      if (blocks.length !== p.items.length) bad.push(`${lang}: ${blocks.length} records printed, ${p.items.length} in the package`);
      const labelled = blocks.filter((b) => /data-strength="(sealed|signed|locked|recorded|stated)"/.test(b.slice(0, 1200))).length;
      if (labelled !== blocks.length) bad.push(`${lang}: ${blocks.length - labelled} printed records have no strength label`);
      for (const s of CORE.PROOF_STRENGTHS) {
        const m = new RegExp(`data-count="${s}"[^>]*>(\\d+)<`).exec(raw);
        if (!m || Number(m[1]) !== p.counts[s]) bad.push(`${lang}: the ${s} count on page one is ${m?.[1]}, the package has ${p.counts[s]}`);
        if (!visible(raw).includes(DOC.PROOF_DOC_COPY[lang].strengthRule[s])) bad.push(`${lang}: the rule for ${s} is not printed`);
      }
      const printedReasons = new Set(p.items.map((i) => i.reason));
      for (const r of printedReasons) if (!visible(raw).includes(DOC.PROOF_DOC_COPY[lang].reason[r])) bad.push(`${lang}: the reason sentence for ${r} is not printed`);
      if (!/data-strength="recorded"[\s\S]{0,400}AIA|data-strength/.test(raw.split('data-counts')[0])) bad.push(`${lang}: the pay document has no strength label`);
    }
    const want: Record<Strength, number> = { sealed: 2, signed: 2, locked: 1, recorded: 8, stated: 4 };
    for (const s of CORE.PROOF_STRENGTHS) if (p.counts[s] !== want[s]) bad.push(`fixture count ${s}: ${p.counts[s]}, want ${want[s]}`);
    for (const lang of ['en', 'es'] as const) for (const r of Object.keys(CORE.PROOF_REASON_STRENGTH)) {
      const s = (w.M.doc[lang].reason as Record<string, string>)[r];
      if (!s || s.length < 20) bad.push(`${lang}: reason ${r} has no sentence`);
    }
    return bad;
  },

  'W1 the two sentences say what this is and is not': (w) => {
    const bad: string[] = [];
    if (w.M.doc.en.whatThisIs !== IS_EN || w.M.doc.en.whatThisIsNot !== IS_NOT_EN) bad.push('the English sentences changed');
    if (w.M.doc.es.whatThisIs !== IS_ES || w.M.doc.es.whatThisIsNot !== IS_NOT_ES) bad.push('the Spanish sentences changed');
    const p = build(w);
    for (const [lang, a, b] of [['en', IS_EN, IS_NOT_EN], ['es', IS_ES, IS_NOT_ES]] as const) {
      const raw = html(w, p, lang);
      const first = visible(raw.split('page-break-before:always')[0]);
      if (!first.includes(`${a} ${b}`)) bad.push(`${lang}: the first page does not carry the two sentences together`);
      const before = visible(raw.split('data-what-this-is')[0]);
      if (/\$\d/.test(before)) bad.push(`${lang}: money is printed before the two sentences`);
      if (!visible(raw).includes(DOC.PROOF_DOC_COPY[lang].footer)) bad.push(`${lang}: the footer does not repeat what the document is not`);
    }
    if (w.EN['office.proofPack.screen.whatThisIsBody'] !== IS_EN || w.EN['office.proofPack.screen.whatThisIsNotBody'] !== IS_NOT_EN) bad.push('the review screen sentences are not the document’s');
    if (w.ES['office.proofPack.screen.whatThisIsBody']?.s !== IS_ES || w.ES['office.proofPack.screen.whatThisIsNotBody']?.s !== IS_NOT_ES) bad.push('the Spanish review screen sentences are not the document’s');
    const review = stripComments(w.F['components/proofPack/ProofPackReview.tsx']);
    const what = review.indexOf('copy.whatThisIsBody');
    const not = review.indexOf('copy.whatThisIsNotBody');
    const firstItem = review.indexOf('PROOF_ITEM_KINDS.map');
    if (what < 0 || not < 0 || firstItem < 0 || what > firstItem || not > firstItem) bad.push('the review screen does not open with the two sentences');
    return bad;
  },

  'W2 no claim word and no lender promise, in either language': (w) => {
    const bad: string[] = [];
    for (const lang of ['en', 'es'] as const) {
      for (const { key, s } of docStrings(w.M.doc[lang])) {
        const hits = bannedIn(stripNotCert(s), lang);
        if (hits.length) bad.push(`docCopy.${lang}.${key}: ${hits.join(', ')} in "${s}"`);
      }
    }
    for (const [k, v] of Object.entries(w.EN)) {
      const hits = bannedIn(stripNotCert(String(v)), 'en', TITLES_EN);
      if (hits.length) bad.push(`${k}: ${hits.join(', ')} in "${String(v)}"`);
    }
    for (const [k, v] of Object.entries(w.ES)) {
      const hits = bannedIn(stripNotCert(String(v.s)), 'es');
      if (hits.length) bad.push(`${k} (es): ${hits.join(', ')} in "${String(v.s)}"`);
    }
    // The printed document, whole, with real data in it.
    const p = build(w, { leaveOut: ['photo:ph2'] });
    for (const lang of ['en', 'es'] as const) {
      const text = stripNotCert(visible(html(w, p, lang)));
      const hits = bannedIn(text, lang);
      if (hits.length) bad.push(`the printed ${lang} document says: ${hits.join(', ')}`);
    }
    // The same with TODAY's facts (no provenance markers), and with an invoice.
    for (const over of [todayFacts(), { payRef: { kind: 'invoice', id: 'inv2' } } as Partial<Input>]) for (const lang of ['en', 'es'] as const) {
      const hits = bannedIn(stripNotCert(visible(html(w, build(w, over), lang))), lang);
      if (hits.length) bad.push(`a printed ${lang} document says: ${hits.join(', ')}`);
    }
    if (/prueba/i.test(w.M.doc.es.titleLabel)) bad.push('the Spanish title says "prueba"');
    // The feature's own source says the old name only where it explains the rename.
    for (const f of [...UI_FILES, 'utils/proofPack/share.ts', 'utils/proofPack/html.ts', 'utils/proofPack/store.ts']) {
      if (/proof of work/i.test(stripComments(w.F[f]))) bad.push(`${f} still carries the old name in code`);
    }
    // The guard catches what it is for (it would be green on a list that matches nothing).
    for (const s of ['Bank-ready package', 'This package is lender-approved', 'Gets you paid faster', 'Verified work in place', 'A certified record', 'Guaranteed by MAGE ID', 'An audit trail', 'The signer attested', 'This proves the work', 'An AIA pay application',
      'Signed by the subcontractor on the signing page.', 'Approved by the client.', 'The client signed this change order.', 'The subcontractor has signed.', 'Signed by the owner', 'Proof of Work Package', 'Build the proof pack', 'The signer’s identity was confirmed.', 'A legally binding signature.']) {
      if (bannedIn(s, 'en', TITLES_EN).length === 0) bad.push(`the English list does not catch: ${s}`);
    }
    for (const s of ['Trabajo verificado', 'Registro certificado', 'Pago garantizado', 'Una auditoría', 'Listo para el banco', 'Paquete de prueba de obra', 'Aprobado por el banco',
      'Firmada por el subcontratista.', 'Aprobada por el cliente.', 'El cliente firmó esta orden.', 'El subcontratista ha firmado.', 'Paquete de respaldo de obra', 'Firma legalmente vinculante']) {
      if (bannedIn(s, 'es').length === 0) bad.push(`the Spanish list does not catch: ${s}`);
    }
    // ...and it does not catch the sentences this document has to be able to say.
    for (const s of ['Marked approved by the contractor. No client signature is on file.', 'MAGE ID does not check who signed.', 'Signer’s name as entered: Dana Client', 'The app holds no signature from the subcontractor.', NOTICE_EN, 'Pay Period Record']) {
      const hits = bannedIn(stripNotCert(s), 'en');
      if (hits.length) bad.push(`the English list wrongly catches "${s}": ${hits.join(', ')}`);
    }
    for (const s of ['Marcada como aprobada por el contratista. No hay firma del cliente.', 'MAGE ID no revisa quién firmó.', NOTICE_ES, 'Registro del periodo de pago']) {
      const hits = bannedIn(stripNotCert(s), 'es');
      if (hits.length) bad.push(`the Spanish list wrongly catches "${s}": ${hits.join(', ')}`);
    }
    return bad;
  },

  'W3 house style in every string': (w) => {
    const bad: string[] = [];
    const check = (where: string, s: string) => { for (const r of STYLE) if (r.re.test(s)) bad.push(`${where}: ${r.name} in "${s}"`); };
    for (const lang of ['en', 'es'] as const) for (const { key, s } of docStrings(w.M.doc[lang])) check(`docCopy.${lang}.${key}`, s);
    for (const [k, v] of Object.entries(w.EN)) check(k, String(v));
    for (const [k, v] of Object.entries(w.ES)) check(`${k} (es)`, String(v.s));
    // English labels are Title Case; sentences end with a period.
    const labelKey = (k: string) => /Label(\b|\(|$)/.test(k.split('.').slice(-1)[0]) || /Label\./.test(k);
    for (const { key, s } of docStrings(w.M.doc.en)) {
      if (!s) continue;
      const isLabel = labelKey(key) || /^(payAppRows|invoiceRows|strengthLabel|kindLabel|lineColsLabel|reportStatus|inspectionResult)\./.test(key);
      if (isLabel) { if (!isTitleCase(s)) bad.push(`docCopy.en.${key} is a label and not Title Case: "${s}"`); if (/[.]$/.test(s)) bad.push(`docCopy.en.${key} is a label ending in a period`); }
    }
    for (const [k, v] of Object.entries(w.EN)) {
      const s = String(v);
      const last = k.split('.').slice(-1)[0];
      if (/[lL]abel$/.test(last)) { const plain = s.replace(/\{[a-z]+\}/gi, '1'); if (!isTitleCase(plain)) bad.push(`${k} is a label and not Title Case: "${s}"`); }
      else if (/[bB]ody$/.test(last) && !/\{from\} to \{to\}/.test(s) && !/[.]$/.test(s)) bad.push(`${k} is a sentence with no period: "${s}"`);
    }
    for (const lang of ['en', 'es'] as const) for (const s of [...Object.values(w.M.doc[lang].strengthRule), ...Object.values(w.M.doc[lang].reason), ...Object.values(w.M.doc[lang].lineLink), ...Object.values(w.M.doc[lang].periodStart)]) {
      if (!/[.]$/.test(s)) bad.push(`${lang}: a sentence has no period: "${s}"`);
    }
    // No user-facing words outside the copy hook and the copy table.
    for (const f of ['components/proofPack/ProofPackReview.tsx', 'components/proofPack/ProofPackEntryRow.tsx', 'app/proof-pack.tsx']) {
      const src = stripComments(w.F[f]);
      const jsxText = [...src.matchAll(/>\s*([A-Za-z][A-Za-z ,.'’]{3,})\s*</g)].map((m) => m[1].trim());
      if (jsxText.length) bad.push(`${f} has words outside the copy hook: ${jsxText.slice(0, 3).join(' | ')}`);
      if (/\bt\(\s*'/.test(src)) bad.push(`${f} calls t() itself`);
      if (/accessibilityLabel="/.test(src)) bad.push(`${f} has a literal accessibility label`);
    }
    return bad;
  },

  'W4 every screen key has Spanish from the right English': (w) => {
    const bad: string[] = [];
    const enKeys = Object.keys(w.EN).sort();
    const esKeys = Object.keys(w.ES).sort();
    if (enKeys.length < 60) bad.push(`only ${enKeys.length} English keys`);
    for (const k of enKeys) {
      const e = w.ES[k];
      if (!e) { bad.push(`${k} has no Spanish`); continue; }
      if (typeof e.s !== 'string' || !e.s.trim()) bad.push(`${k} has empty Spanish`);
      if (e.src !== sourceHash(String(w.EN[k]))) bad.push(`${k}: the Spanish was written for different English`);
      const vars = (s: string) => [...s.matchAll(/\{([a-z]+)\}/gi)].map((m) => m[1]).sort().join();
      if (typeof e.s === 'string' && vars(e.s) !== vars(String(w.EN[k]))) bad.push(`${k}: the Spanish carries different placeholders`);
      if (typeof e.s === 'string' && e.s === w.EN[k] && !/^\{/.test(e.s)) bad.push(`${k}: the Spanish is the English`);
    }
    for (const k of esKeys) if (!(k in w.EN)) bad.push(`${k} has Spanish and no English`);
    for (const k of enKeys) if (!k.startsWith('office.proofPack.')) bad.push(`${k} is outside the surface prefix`);
    const surface = SURFACES.find((s) => s.id === 'office.proof-pack');
    if (!surface || surface.state !== 'complete' || surface.keyPrefixes.join() !== 'office.proofPack.' || surface.files.join() !== 'hooks/useProofPackCopy.ts') bad.push('the i18n surface is not registered as complete with the one copy hook');
    // The document table: the same keys in both languages.
    const shape = (c: DocCopy) => docStrings(c).map((x) => x.key).sort().join('|');
    if (shape(w.M.doc.en) !== shape(w.M.doc.es)) bad.push('the English and Spanish document tables do not have the same keys');
    for (const { key, s } of docStrings(w.M.doc.es)) if (!s) bad.push(`docCopy.es.${key} is empty`);
    const same = docStrings(w.M.doc.en).filter((x, i) => { const y = docStrings(w.M.doc.es)[i]; return y && x.s === y.s && /[a-z]{4,} [a-z]{4,}/i.test(x.s) && !/^Subtotal$/.test(x.s); });
    if (same.length) bad.push(`document strings left in English in the Spanish table: ${same.slice(0, 3).map((x) => x.key).join(', ')}`);
    return bad;
  },

  'P1 no worker’s personal details reach the package': (w) => {
    const bad: string[] = [];
    const p = build(w);
    const canon = w.M.canonicalText(p);
    const inv = build(w, { payRef: { kind: 'invoice', id: 'inv2' } });
    const texts: [string, string][] = [
      ['the package data', canon], ['the invoice package data', w.M.canonicalText(inv)],
      ['the English document', html(w, p, 'en')], ['the Spanish document', html(w, p, 'es')], ['the invoice document', html(w, inv, 'en')],
    ];
    for (const [where, t] of texts) for (const s of SECRETS) if (t.includes(s)) bad.push(`${where} contains "${s}"`);
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(canon)) bad.push('the package data contains an email address');
    const keys = new Set<string>();
    JSON.stringify({ items: p.items, pay: p.pay, waiverGaps: p.waiverGaps }, (k, v) => { if (k) keys.add(k); return v; });
    for (const k of ['workerName', 'rate', 'email', 'subEmail', 'phone', 'ipAddress', 'userAgent', 'company', 'inspectorName', 'peopleInvolved', 'reportedBy', 'conductedBy', 'filedByUserId', 'userId', 'createdByUserId', 'assignedSub', 'homeownerSummary', 'signaturePaths', 'notes', 'incident', 'labor']) {
      if (keys.has(k)) bad.push(`the package has a "${k}" field`);
    }
    const d1 = item(p, 'daily_report:d1');
    if (!d1 || d1.kind !== 'daily_report') return [...bad, 'd1 missing'];
    if (JSON.stringify(d1.crew) !== JSON.stringify([{ trade: 'Carpenter', headcount: 4, hours: 8 }, { trade: 'Electrician', headcount: 2, hours: 6 }])) bad.push(`crew rows carry more than trade, head count and hours: ${JSON.stringify(d1.crew)}`);
    if (d1.totalHeadcount !== 6 || d1.totalHours !== 44) bad.push(`crew totals: ${d1.totalHeadcount} people, ${d1.totalHours} hours`);
    if (d1.photoCount !== 2) bad.push('an incident photo is counted on the report');
    const ft = item(p, 'field_ticket:ft1');
    if (!ft || ft.kind !== 'field_ticket' || ft.workerCount !== 2 || ft.totalHours !== 8.5) bad.push('a field ticket carries more or less than a worker count and total hours');
    // A signature keeps its signer's NAME and nothing else about the person.
    const w1 = item(p, 'lien_waiver:w1');
    if (!w1 || w1.kind !== 'lien_waiver' || w1.signerName !== 'Vera Volt') bad.push('a signed waiver lost its signer');
    const co = item(p, 'change_order:co12');
    if (!co || co.kind !== 'change_order' || co.approvedBy !== 'Dana Client' || co.recordHashPrefix !== 'fefefefefefefefe') bad.push('a signed change order lost its signer or its record fingerprint');
    if (/"(?:consentRecord|consent_record|record)":/.test(canon)) bad.push('the document data carries a signature record’s text');
    const co14 = item(p, 'change_order:co14');
    if (!co14 || co14.kind !== 'change_order' || co14.approvedBy !== '') bad.push('a change order the contractor marked approved names a person');
    return bad;
  },

  'P2 nothing goes to a model, and only the fingerprint leaves': (w) => {
    const bad: string[] = [];
    for (const f of FEATURE_FILES) {
      const src = stripComments(w.F[f]);
      const imports = [...src.matchAll(/from\s+'([^']+)'/g), ...src.matchAll(/import\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
      for (const i of imports) {
        if (/(^|\/)(ai[A-Z][A-Za-z]*|mageAI[A-Za-z]*|gemini[A-Za-z]*|anthropic[A-Za-z]*|openai[A-Za-z]*|constructionAnswer[A-Za-z]*|voice[A-Z][A-Za-z]*|stt[A-Z]?[A-Za-z]*)($|\/)/.test(i) || /\/ai\//.test(i)) bad.push(`${f} imports ${i}`);
      }
      if (/functions\.invoke|(?<![A-Za-z.])fetch\(|XMLHttpRequest|generateContent|sendBeacon/.test(src)) bad.push(`${f} makes a network call of its own`);
      if (/supabase\s*\.\s*storage|\.upload\(/.test(src)) bad.push(`${f} uploads a file`);
    }
    for (const f of [...CORE_FILES, ...UI_FILES, GATE]) {
      const src = stripComments(w.F[f]);
      if (/from '@\/lib\/supabase'|supabaseRpcOnline|supabaseWrite/.test(src)) bad.push(`${f} talks to the server (only store.ts may)`);
    }
    const store = stripComments(w.F['utils/proofPack/store.ts']);
    const fns = [...store.matchAll(/supabaseRpcOnline(?:<[^(]*>)?\(\s*'([^']+)'/g)].map((m) => m[1]).sort();
    if (fns.join() !== 'proof_pack_attach_pdf_v1,proof_pack_create_v1') bad.push(`store.ts calls: ${fns.join() || 'nothing'}`);
    const tables = [...store.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1]);
    if (tables.sort().join() !== 'aia_pay_apps,change_order_approvals,field_tickets,lien_waivers,proof_packs,punch_seals') bad.push(`store.ts reads tables: ${tables.join()}`);
    // Every select names its columns, and none of them is a person's contact detail or a drawn signature.
    const lists = [...store.matchAll(/export const ([A-Z_]+_COLUMNS?) = '([^']+)'/g)].map((m) => [m[1], m[2]] as const);
    const literal = [...store.matchAll(/\.select\(\s*(['`])([^'`]*)\1/g)].map((m) => m[2]);
    const selects = [...lists.map(([, v]) => v), ...literal];
    if (lists.length !== 6) bad.push(`store.ts has ${lists.length} named column lists, want 6`);
    if (selects.some((sel) => /\*|email|user_agent|signature_data|signature_png|sub_signature|note\b|\bip\b|ip_address|phone|materials|equipment/.test(sel))) bad.push(`store.ts selects more than the document may carry: ${selects.join(' | ')}`);
    if (/\.select\(\s*\)|\.select\(\s*['"`]\*/.test(store)) bad.push('store.ts selects every column somewhere');
    if (STORE.CO_APPROVAL_COLUMNS !== 'change_order_id, decision, signer_name, created_at, document_hash, signature_hash, consent_record') bad.push('the signature rows are not read with the seven named columns');
    if (STORE.CO_APPROVAL_MARK_COLUMN !== 'recorded_via' || STORE.WAIVER_MARK_COLUMN !== 'signed_via') bad.push('the provenance marker columns were renamed');
    if (/\.(insert|update|upsert|delete)\(/.test(store)) bad.push('store.ts writes a table directly');
    const share = stripComments(w.F['utils/proofPack/share.ts']);
    if (/supabase/.test(share.replace(/supabaseRpcOnline/g, ''))) bad.push('share.ts touches the server itself');
    // Exactly what the server is sent.
    const p = build(w, { leaveOut: ['photo:ph2'] });
    const args = w.M.recordArgs(p, { hash: HASH64, code: 'x' });
    if (/Example Builders/.test(JSON.stringify(args))) bad.push('the fingerprint record carries the company name');
    const want = { p_project_id: 'p1', p_pay_kind: 'pay_app', p_pay_id: 'app3', p_content_hash: HASH64, p_item_count: p.items.length, p_left_out_count: 1, p_project_initial: 'A', p_city: 'Baltimore' };
    if (JSON.stringify(args) !== JSON.stringify(want)) bad.push(`the server is sent ${JSON.stringify(args)}`);
    const sent = JSON.stringify(args);
    for (const s of ['Alder', 'Dana', '18111', '1811117', '21201', '14 Alder']) if (sent.includes(s)) bad.push(`the fingerprint record carries "${s}"`);
    if (STORE.cityOfLocation('14 Alder Street, Baltimore, MD 21201') !== 'Baltimore' || STORE.cityOfLocation('Baltimore, MD') !== 'Baltimore' || STORE.cityOfLocation('14 Alder Street') !== '' || STORE.cityOfLocation('Lot 4, 99 Pine') !== '') bad.push('cityOfLocation returns a street or a number');
    // Sharing happens only from the tap.
    const review = stripComments(w.F['components/proofPack/ProofPackReview.tsx']);
    if ((review.match(/createAndShareProofPack\(/g) ?? []).length !== 1 || !/const onCreate = useCallback\(async \(\) => \{[\s\S]*?createAndShareProofPack\(/.test(review)) bad.push('the package is made somewhere other than the Create and Share tap');
    if (/useEffect\([^)]*createAndShareProofPack/.test(review)) bad.push('the package is made from an effect');
    return bad;
  },

  'F1 the fingerprint is stable and moves with any record': async (w) => {
    const bad: string[] = [];
    const fp = async (p: Pack) => sha(w.M.canonicalText(p));
    const base = await fp(build(w));
    if (!FP.SHA256_HEX.test(base)) bad.push('the fingerprint is not 64 hex characters');
    if (base !== await fp(build(w))) bad.push('the same data gives two fingerprints');
    // Key order and array order of the INPUT do not matter.
    const f = fixture();
    const shuffled = as<Input>({ ...Object.fromEntries(Object.entries(f).reverse()), photos: [...f.photos].reverse(), dailyReports: [...f.dailyReports].reverse(), changeOrders: [...f.changeOrders].reverse(), punchItems: [...f.punchItems].reverse(), lienWaivers: [...(f.lienWaivers ?? [])].reverse() });
    const r = w.M.buildProofPack(shuffled);
    if (!r.ok || await fp(r.pack) !== base) bad.push('the order the records arrive in changes the fingerprint');
    // Any included record changing moves it.
    const edit = (name: string, change: (i: Input) => void): Promise<void> => {
      const x = JSON.parse(JSON.stringify(fixture())) as Input;
      change(x);
      const res = w.M.buildProofPack(x);
      if (!res.ok) { bad.push(`${name}: did not build`); return Promise.resolve(); }
      return fp(res.pack).then((h) => { if (h === base) bad.push(`${name}: the fingerprint did not change`); });
    };
    const mut = <T,>(v: readonly T[]) => v as T[];
    await edit('a daily report’s words', (x) => { mut(x.dailyReports)[0].workPerformed += ' and more'; });
    await edit('a crew count', (x) => { mut(x.dailyReports)[0].manpower[0].headcount = 5; });
    await edit('a report’s last change', (x) => { mut(x.dailyReports)[0].updatedAt = at('2026-09-15'); });
    await edit('a photo’s time', (x) => { mut(x.photos)[0].timestamp = at('2026-09-10', '14:01'); });
    await edit('a photo’s place', (x) => { delete (mut(x.photos)[0] as { latitude?: number }).latitude; });
    await edit('coordinates switched on', (x) => { x.includeCoordinates = true; });
    await edit('the company name', (x) => { x.companyName = 'Another Builder'; });
    await edit('the amount in a signature record', (x) => { mut(x.coSignatures!)[0].signedTerms!.amountCents = 1; });
    await edit('the lock stamp', (x) => { (x.payAppServer as { lockedAt: string | null }).lockedAt = at('2026-09-30', '18:00'); });
    await edit('a waiver’s provenance marker', (x) => { (x.waiverSignedVia as Record<string, string | null>).w1 = null; });
    await edit('a change order amount', (x) => { mut(x.changeOrders)[0].changeAmount = 2000.01; });
    await edit('a change order signer', (x) => { mut(x.coSignatures!)[0].signerName = 'Someone Else'; });
    await edit('a signature row’s time', (x) => { mut(x.coSignatures!)[0].serverCreatedAt = at('2026-09-15', '12:06'); });
    await edit('a signature row removed', (x) => { x.coSignatures = []; });
    await edit('a punch item', (x) => { mut(x.punchItems)[1].description = 'Other'; });
    await edit('the seal fingerprint', (x) => { (x.punchSeal as { manifestHash: string }).manifestHash = 'cd'.repeat(32); });
    await edit('an inspection result', (x) => { mut(x.permits)[0].inspections![0].result = 'failed'; });
    await edit('a waiver amount', (x) => { mut(x.lienWaivers!)[0].paidAmount = 1; });
    await edit('a field ticket', (x) => { mut(x.fieldTickets)[0].workDescription = 'Other'; });
    await edit('the amount billed', (x) => { mut(x.payApps)[0].totals.currentPaymentDue = 18111.18; });
    await edit('a line amount', (x) => { mut(x.payApps)[0].lines[0].thisPeriod = 12000.01; });
    await edit('the period', (x) => { mut(x.payApps)[0].periodTo = '2026-09-29'; });
    await edit('the made-on time', (x) => { x.generatedAt = at('2026-10-02', '09:31'); });
    await edit('a record left out', (x) => { x.leaveOut = ['photo:ph2']; });
    await edit('a record added', (x) => { mut(x.photos).push(as({ id: 'phNew', projectId: 'p1', uri: 'x', timestamp: at('2026-09-22'), createdAt: at('2026-09-22') })); });
    // A record OUTSIDE the package does not move it.
    const x = JSON.parse(JSON.stringify(fixture())) as Input;
    mut(x.dailyReports)[2].workPerformed = 'Changed August';
    mut(x.dailyReports)[0].homeownerSummary = 'different';
    mut(x.fieldTickets)[0].labor[0].workerName = 'Another Name';
    const out = w.M.buildProofPack(x);
    if (!out.ok || await fp(out.pack) !== base) bad.push('a record that is not in the package changes the fingerprint');
    // The left-out count and the open items are inside it too.
    const whole = build(w);
    const fewer = JSON.parse(JSON.stringify(whole)) as Pack; fewer.leftOut.total = 9;
    if (w.M.canonicalText(fewer) === w.M.canonicalText(whole)) bad.push('the left-out count is outside the fingerprint');
    const quiet = JSON.parse(JSON.stringify(whole)) as Pack; quiet.openItems = quiet.openItems.slice(1);
    if (w.M.canonicalText(quiet) === w.M.canonicalText(whole)) bad.push('the open items are outside the fingerprint');
    // The fingerprint covers the whole package and not the language.
    if (w.M.canonicalText(build(w)).length < 2000) bad.push('the canonical text is too short to be the whole package');
    for (const k of ['"items"', '"pay"', '"period"', '"leftOut"', '"byStrength"', '"openItems"', '"counts"', '"generatedAt"', '"waiverGaps"', '"version"', '"company"', '"photoCoordinates"']) if (!w.M.canonicalText(build(w)).includes(k)) bad.push(`the canonical text leaves out ${k}`);
    if (/"lang"|"language"/.test(w.M.canonicalText(build(w)))) bad.push('the document language is inside the fingerprint');
    if (!/import \{ canonicalJson \} from '@\/supabase\/functions\/_shared\/punchSealManifest'/.test(w.F['utils/proofPack/fingerprint.ts'])) bad.push('the fingerprint does not use the app’s one canonical writer');
    // The input is never changed (the fixture is deep-frozen in build()).
    try { build(w, { leaveOut: ['photo:ph2'] }); } catch (e) { bad.push(`the core changes its input: ${e instanceof Error ? e.message : String(e)}`); }
    return bad;
  },

  'F2 the check code and the re-open check': async (w) => {
    const bad: string[] = [];
    const code = (h: string) => {
      let bits = '';
      for (const ch of h.slice(0, 13)) bits += parseInt(ch, 16).toString(2).padStart(4, '0');
      bits = bits.slice(0, 50);
      let out = '';
      for (let i = 0; i < 50; i += 5) out += '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[parseInt(bits.slice(i, i + 5), 2)];
      return `${out.slice(0, 5)}-${out.slice(5)}`;
    };
    for (let i = 0; i < 300; i += 1) {
      const h = await sha(`probe-${i}`);
      if (w.M.checkCodeOf(h) !== code(h)) { bad.push(`check code of ${h.slice(0, 12)} is ${w.M.checkCodeOf(h)}, the server rule gives ${code(h)}`); break; }
    }
    if (w.M.checkCodeOf('0'.repeat(64)) !== '00000-00000' || w.M.checkCodeOf('f'.repeat(64)) !== 'ZZZZZ-ZZZZZ') bad.push('the check code of the all-zero or all-f hash is wrong');
    if (w.M.checkCodeOf(await sha('one')) !== 'ET9C7-B9N82') bad.push('the check code no longer equals the one the PGlite proof recorded from the SQL function');
    if (w.M.checkCodeOf('xyz') !== '' || w.M.checkCodeOf('') !== '') bad.push('something that is not a fingerprint gets a check code');
    if (w.M.checkCodeOf(HASH64.toUpperCase()) !== w.M.checkCodeOf(HASH64)) bad.push('the check code depends on letter case');
    if (!/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(w.M.checkCodeOf(HASH64))) bad.push('the check code is not two groups of five');
    const c = w.M.compareFingerprint;
    if (c(HASH64, HASH64) !== 'match' || c(HASH64, HASH64.toUpperCase()) !== 'match') bad.push('equal fingerprints do not match');
    if (c(HASH64, 'cd'.repeat(32)) !== 'changed') bad.push('different fingerprints are not "changed"');
    if (c(HASH64, null) !== 'not_on_file' || c(HASH64, '') !== 'not_on_file') bad.push('no record on file is not "not on file"');
    if (c(HASH64, undefined) !== 'not_checked') bad.push('an unreachable server is not "not checked"');
    // Re-opening: a copy that was edited after it was made is caught.
    const p = build(w);
    const fp = await FP.proofPackFingerprint(p, sha);
    const saved = { pack: p, lang: 'en' as const, fingerprint: fp, serverId: 'id1', serverCreatedAt: at('2026-10-02'), pdfHash: null };
    const onFile = async () => ({ hash: fp.hash, createdAt: at('2026-10-02'), pdfHash: null });
    const good = await STORE.recheckSavedProofPack(saved, { sha256Hex: sha, read: onFile });
    if (good.check !== 'match') bad.push(`an untouched copy re-opens as ${good.check}`);
    const edited = JSON.parse(JSON.stringify(saved)) as typeof saved;
    (edited.pack.pay as { currentPaymentDueCents: number }).currentPaymentDueCents += 1;
    const moved = await STORE.recheckSavedProofPack(edited, { sha256Hex: sha, read: onFile });
    if (moved.check !== 'changed') bad.push(`a copy edited by one cent re-opens as ${moved.check}`);
    if ((await STORE.recheckSavedProofPack(saved, { sha256Hex: sha, read: async () => null })).check !== 'not_on_file') bad.push('no record on file re-opens as something else');
    if ((await STORE.recheckSavedProofPack(saved, { sha256Hex: sha, read: async () => undefined })).check !== 'not_checked') bad.push('an unreachable server re-opens as something else');
    // The document prints the code and the fingerprint, and says so when none is on file.
    for (const lang of ['en', 'es'] as const) {
      const d = DOC.PROOF_DOC_COPY[lang];
      const raw = html(w, p, lang, { hash: fp.hash, code: fp.code, serverCreatedAt: at('2026-10-02', '09:31') });
      if (!new RegExp(`data-check-code[^>]*>${fp.code}<`).test(raw) || !new RegExp(`data-hash="${fp.hash}"[^>]*>${HTML.fingerprintGroups(fp.hash)}<`).test(raw)) bad.push(`${lang}: the document does not print the code and the whole fingerprint`);
      const t = visible(raw);
      if (!t.includes(d.fingerprintCovers) || !t.includes(d.howToCheck)) bad.push(`${lang}: the document does not say what the fingerprint covers or how to check it`);
      if (!/UTC/.test(d.fingerprintOnFile('Oct 2, 2026, 09:31 UTC')) || !t.includes('09:31 UTC')) bad.push(`${lang}: the server time is not printed`);
      const none = visible(html(w, p, lang, { hash: fp.hash, code: fp.code, serverCreatedAt: null }));
      if (!none.includes(d.fingerprintNotOnFile)) bad.push(`${lang}: a package with no record on file does not say so`);
      if (none.includes(d.howToCheck)) bad.push(`${lang}: a package with no record on file still tells the reader how to check it`);
    }
    if (HTML.fingerprintGroups(HASH64).replace(/ /g, '') !== HASH64 || HTML.fingerprintGroups(HASH64).split(' ').length !== 8) bad.push('the fingerprint is not printed whole, in eight groups');
    const share = stripComments(w.F['utils/proofPack/share.ts']);
    if ((share.match(/serverCreatedAt: filed\?\.createdAt \?\? null/g) ?? []).length !== 2 || (share.match(/serverCreatedAt:/g) ?? []).length !== 2) bad.push('the document is printed, or the copy is kept, with a time that is not the server’s');
    if (share.indexOf('await fileFingerprint(') > share.indexOf('buildProofPackHtml(')) bad.push('the document is printed before the fingerprint is put on file');
    return bad;
  },

  'F3 the migration is written, safe and not applied': (w) => {
    const bad: string[] = [];
    const sql = w.F[MIGRATION].replace(/^\s*--.*$/gm, '');
    const need: [string, RegExp][] = [
      ['the server clock on the row', /created_at timestamptz not null default now\(\)/],
      ['a 64-hex check on the fingerprint', /content_hash text not null check \(content_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/],
      ['row level security', /alter table public\.proof_packs enable row level security/],
      ['an owner-only read', /for select to authenticated\s+using \(user_id = auth\.uid\(\)\)/],
      ['no direct writes', /revoke all on public\.proof_packs from public, anon, authenticated;\s*grant select on public\.proof_packs to authenticated;/],
      ['the project owner check', /if not exists \(select 1 from public\.projects p where p\.id = v_pid and p\.user_id = v_me\) then/],
      ['the code derived on the server', /public\.proof_pack_check_code\(v_hash\)/],
      ['the same 50 bits as the app', /::bit\(64\)::bigint\) >> 2;/],
      ['the Crockford alphabet', /'0123456789ABCDEFGHJKMNPQRSTVWXYZ'/],
      ['now() as the stored time', /left\(btrim\(coalesce\(p_city, ''\)\), 80\),\s*now\(\)\s*\)/],
      ['an immutable row', /raise exception 'proof_packs: a fingerprint record cannot be changed'/],
      ['no delete', /raise exception 'proof_packs: a fingerprint record cannot be deleted'/],
      ['one file fingerprint, once', /where pp\.id = p_id and pp\.user_id = v_me and pp\.pdf_hash is null;/],
      ['no anon', /revoke execute on function public\.proof_pack_create_v1\([^)]*\) from public, anon;/],
      ['a fixed search path', /security definer\s+set search_path to ''/],
    ];
    for (const [name, re] of need) if (!re.test(sql)) bad.push(`the migration lost: ${name}`);
    const cols = [...(/create table if not exists public\.proof_packs \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? '').matchAll(/^\s{2}([a-z_]+) (?:uuid|text|int|timestamptz)/gm)].map((m) => m[1]).sort();
    const want = ['check_code', 'city', 'content_hash', 'created_at', 'id', 'item_count', 'left_out_count', 'pay_id', 'pay_kind', 'pdf_attached_at', 'pdf_hash', 'project_id', 'project_initial', 'user_id'];
    if (cols.join() !== want.join()) bad.push(`the table columns are ${cols.join()}`);
    if (/amount|total|name text|address|email|owner_name|client/i.test(cols.join())) bad.push('the table has a column for money, a name or an address');
    if (/p_created_at|p_check_code/.test(sql)) bad.push('the caller can send the time or the check code');
    // The arguments the app sends are the function's parameters.
    const params = [...(/create or replace function public\.proof_pack_create_v1\(([\s\S]*?)\)\s*returns/.exec(sql)?.[1] ?? '').matchAll(/\b(p_[a-z_]+)\b/g)].map((m) => m[1]).sort();
    const sentKeys = Object.keys(w.M.recordArgs(build(w), { hash: HASH64, code: '' })).sort();
    if (params.join() !== sentKeys.join()) bad.push(`the app sends ${sentKeys.join()} and the function takes ${params.join()}`);
    // Nothing in the repo applies it, and no function folder was added for it.
    if (existsSync(join(ROOT, 'supabase/functions/proof-pack')) || existsSync(join(ROOT, 'supabase/functions/proof-pack-check'))) bad.push('a server function was added in this lane');
    if (!/NOT APPLIED/.test(w.F[MIGRATION])) bad.push('the migration no longer says it is not applied');
    if (!/NOT\s+(?:\/\/\s*)?applied/.test(w.F[FLAG_FILE].slice(w.F[FLAG_FILE].indexOf('PAY PERIOD RECORD')))) bad.push('the flag comment no longer says the migration is not applied');
    return bad;
  },

  'E1 flag off and not the owner means no entry point': (w) => {
    const bad: string[] = [];
    if (!/^export const PROOF_PACK_ENABLED = false;$/m.test(w.F[FLAG_FILE])) bad.push('PROOF_PACK_ENABLED is not false');
    const readers = [...Object.entries(w.F), ...Object.entries(w.far)].filter(([f, s]) => f !== FLAG_FILE && /\.(ts|tsx)$/.test(f) && /\bPROOF_PACK_ENABLED\b/.test(stripComments(s))).map(([f]) => f);
    if (readers.join() !== GATE) bad.push(`the flag is read in: ${readers.join() || 'no file'}`);
    const owner = 'omirmajeed2000@gmail.com';
    if (!OWNER.isOwner(owner)) bad.push('the owner email in this test is not an owner');
    const a = w.M.allowedWith;
    if (a(false, 'someone@example.com') || a(false, null) || a(false, undefined) || a(false, '')) bad.push('flag off lets a non-owner in');
    if (!a(false, owner) || !a(false, `  ${owner.toUpperCase()} `)) bad.push('flag off keeps the owner out');
    if (!a(true, 'someone@example.com')) bad.push('flag on keeps people out');
    const s = w.M.seatAllowed;
    if (!s('owner') || s('editor') || s('viewer') || s('field') || s(null) || s(undefined)) bad.push('a seat other than owner may make a package');
    // The entry row: nothing is rendered, and no hook of the inner row runs, until both say yes.
    const row = stripComments(w.F['components/proofPack/ProofPackEntryRow.tsx']);
    if (!/if \(!projectId \|\| !payId \|\| !proofPackAllowed\(user\?\.email\)\) return null;/.test(row)) bad.push('the entry row does not return null on the gate');
    if (!/if \(!proofPackEntryAllowed\(email, role\)\) return null;/.test(row)) bad.push('the entry row does not return null on the seat');
    const outer = /export function ProofPackEntryRow\([\s\S]*?\n\}/.exec(row)?.[0] ?? '';
    if (/useProofPackCopy|useRouter|useThemedStyles|useProjectRole/.test(outer)) bad.push('the entry row runs feature hooks before the gate answers');
    if (/ProofPackReview|utils\/proofPack\/(share|store|core|html)/.test(row)) bad.push('the entry row loads the feature');
    // The route: redirect first, then the seat.
    const route = stripComments(w.F['app/proof-pack.tsx']);
    if (!/if \(!proofPackAllowed\(user\?\.email \?\? null\)\) return <Redirect href="\/\(tabs\)\/\(home\)" \/>;\s*return <ProofPackScreen \/>;/.test(route)) bad.push('the route does not redirect on the gate before mounting anything');
    if (route.indexOf('!proofPackSeatAllowed(roleState.role)') < 0 || route.indexOf('!proofPackSeatAllowed(roleState.role)') > route.lastIndexOf('<ProofPackReview')) bad.push('the route mounts the review before the seat check');
    if (!/roleState\.isLoading/.test(route)) bad.push('the route does not wait for the seat');
    // The two screens import only the row, and draw it on a SAVED document.
    for (const f of SCREENS) {
      const src = stripComments(w.F[f]);
      const imps = [...src.matchAll(/from '(@\/(?:components|utils|hooks)\/[^']*[pP]roofPack[^']*)'/g)].map((m) => m[1]);
      if (imps.join() !== '@/components/proofPack/ProofPackEntryRow') bad.push(`${f} imports ${imps.join() || 'nothing'} from the feature`);
      if ((src.match(/<ProofPackEntryRow /g) ?? []).length !== 1) bad.push(`${f} does not draw exactly one entry row`);
    }
    if (!/<ProofPackEntryRow projectId=\{project\?\.id\} kind="pay_app" payId=\{savedForThisAppNumber\?\.id\} \/>/.test(w.F['app/aia-pay-app.tsx'])) bad.push('the pay application row is not tied to the saved record');
    if (!/\{existingInvoice && !isSampleJob && \(\s*<ProofPackEntryRow projectId=\{existingInvoice\.projectId\} kind="invoice" payId=\{existingInvoice\.id\} \/>/.test(w.F['app/invoice.tsx'])) bad.push('the invoice row is not tied to the saved invoice');
    // No other door.
    const doors = Object.entries(w.far).filter(([, s]) => /['"`]\/proof-pack['"`]|ProofPackReview|ProofPackEntryRow/.test(stripComments(s))).map(([f]) => f);
    if (doors.length) bad.push(`other files lead to the feature: ${doors.join(', ')}`);
    if (!/<Stack\.Screen name="proof-pack" options=\{\{ title: '[^']+', headerShown: false \}\} \/>/.test(w.F['app/_layout.tsx'])) bad.push('the route is not declared in the root layout');
    return bad;
  },

  'E2 the core is pure': (w) => {
    const bad: string[] = [];
    for (const f of CORE_FILES) {
      const src = stripComments(w.F[f]);
      const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const i of imports) {
        if (/^react$|^react-native|^expo|async-storage|@\/lib\/|@\/contexts\/|@\/hooks\/|@\/components\/|offlineQueue|@\/i18n/.test(i)) bad.push(`${f} imports ${i}`);
      }
      if (/Date\.now\(|new Date\(\s*\)|Math\.random\(|crypto\.randomUUID/.test(src)) bad.push(`${f} reads a clock or a random number`);
      if (/AsyncStorage|localStorage|console\./.test(src)) bad.push(`${f} touches storage or the console`);
    }
    const core = stripComments(w.F['utils/proofPack/core.ts']);
    if (/new Date\(/.test(core)) bad.push('core.ts builds a Date itself (use utils/calendarDate)');
    const p1 = build(w);
    const p2 = build(w);
    if (JSON.stringify(p1) !== JSON.stringify(p2)) bad.push('the same input gives two packages');
    if (p1.generatedAt !== at('2026-10-02', '09:30') || p1.version !== CORE.PROOF_PACK_VERSION) bad.push('the package does not carry the injected time and the version');
    return bad;
  },

  'K1 storage keys are owned': (w) => {
    const bad: string[] = [];
    if (!APP_STORAGE_PREFIXES.some((pre) => w.M.keyPrefix.startsWith(pre))) bad.push(`"${w.M.keyPrefix}" is under no owned prefix: it would outlive a sign-out`);
    if (STORE.proofPacksKey('p1') !== `${STORE.PROOF_PACKS_KEY_PREFIX}p1`) bad.push('the key is not the prefix plus the project id');
    for (const f of FEATURE_FILES) {
      const src = stripComments(w.F[f]);
      if (f !== 'utils/proofPack/store.ts' && /AsyncStorage/.test(src)) bad.push(`${f} uses device storage (only store.ts may)`);
      for (const m of src.matchAll(/(?:getItem|setItem|removeItem)\(\s*(['"`][^'"`]*['"`])/g)) bad.push(`${f} writes a literal storage key ${m[1]}`);
    }
    const store = stripComments(w.F['utils/proofPack/store.ts']);
    const uses = [...store.matchAll(/AsyncStorage\.(?:getItem|setItem)\(\s*([^,)]+)/g)].map((m) => m[1].trim());
    if (uses.length !== 2 || uses.some((u) => !u.startsWith('proofPacksKey('))) bad.push(`store.ts storage calls: ${uses.join(' | ')}`);
    if (/AsyncStorage\.clear\(/.test(store)) bad.push('store.ts clears all storage');
    if (STORE.PROOF_PACKS_KEPT < 1 || STORE.PROOF_PACKS_KEPT > 50) bad.push('the number of packages kept is not bounded');
    return bad;
  },

  'R1 the lane is registered': (w) => {
    const bad: string[] = [];
    if (!/"test:proof-pack": "bun run scripts\/validate-proof-pack\.ts"/.test(w.F['package.json'])) bad.push('package.json has no test:proof-pack');
    const chain = /"ship-check": "([^"]+)"/.exec(w.F['package.json'])?.[1] ?? '';
    const links = chain.split('&&').map((s) => s.trim()).filter(Boolean);
    if (!links.includes('bun run test:proof-pack')) bad.push('test:proof-pack is not in the ship-check chain');
    const m = /name: ship-check — (\d+) checks \((\d+) validators, typecheck, lint, jest\)/.exec(w.F['.github/workflows/ship-gate.yml']);
    if (!m) bad.push('the ship-gate job name does not carry the count');
    else if (Number(m[1]) !== links.length || Number(m[2]) !== links.length - 3) bad.push(`the ship-gate job says ${m[1]} checks, the chain has ${links.length}`);
    return bad;
  },
};

// ── run ──────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
console.log('\npay period record:');
for (const [id, rule] of Object.entries(RULES)) {
  let problems: string[];
  try { problems = await rule(REAL); } catch (e) { problems = [`threw ${e instanceof Error ? e.stack ?? e.message : String(e)}`]; }
  if (problems.length === 0) { pass += 1; console.log(`  ✓ ${id}`); }
  else { fail += 1; console.log(`  ✗ ${id}`); for (const p of problems.slice(0, 12)) console.log(`      ${p}`); }
}

// ── planted mutations ────────────────────────────────────────────────────────
interface Mutation { rule: string; what: string; plant: (w: World) => World }
const mods = (over: Partial<Mods>) => (w: World): World => ({ ...w, M: { ...w.M, ...over } });
function text(file: string, from: string | RegExp, to: string) {
  return (w: World): World => {
    const s = w.F[file];
    if (s === undefined) throw new Error(`no such file ${file}`);
    const next = s.replace(from as never, to);
    if (next === s) throw new Error(`mutation anchor not found in ${file}: ${String(from)}`);
    return { ...w, F: { ...w.F, [file]: next } };
  };
}
const farAdd = (add: string) => (w: World): World => {
  const first = Object.keys(w.far)[0];
  return { ...w, far: { ...w.far, [first]: w.far[first] + add } };
};
const en = (key: string, value: unknown) => (w: World): World => {
  if (!(key in w.EN)) throw new Error(`mutation key not found: ${key}`);
  return { ...w, EN: { ...w.EN, [key]: value } };
};
const es = (key: string, value: { s: unknown; src: string } | undefined) => (w: World): World => {
  const next = { ...w.ES };
  if (value === undefined) delete next[key]; else next[key] = value;
  return { ...w, ES: next };
};
/** Wrap the real builder and edit the package it returns. */
const packEdit = (change: (p: Pack, input: Input) => void) => mods({
  buildProofPack: (input) => {
    const r = CORE.buildProofPack(input);
    if (!r.ok) return r;
    const p = JSON.parse(JSON.stringify(r.pack)) as Pack;
    change(p, input);
    return { ok: true, pack: p };
  },
});
const docEdit = (lang: 'en' | 'es', change: (c: DocCopy) => Partial<DocCopy>) => (w: World): World => ({
  ...w, M: { ...w.M, doc: { ...w.M.doc, [lang]: { ...w.M.doc[lang], ...change(w.M.doc[lang]) } } },
});
const htmlEdit = (change: (h: string) => string) => mods({ buildHtml: (p, o) => change(HTML.buildProofPackHtml(p, o)) });
const setItem = (key: string, change: (i: Record<string, unknown>) => void) => packEdit((p) => { const i = p.items.find((x) => x.key === key); if (i) change(i as unknown as Record<string, unknown>); });
const REVIEW = 'components/proofPack/ProofPackReview.tsx';
const ROW = 'components/proofPack/ProofPackEntryRow.tsx';
const ROUTE = 'app/proof-pack.tsx';
const STORE_F = 'utils/proofPack/store.ts';
const SHARE_F = 'utils/proofPack/share.ts';

const MUTATIONS: Mutation[] = [
  // S1
  { rule: 'S1', what: 'a change order the contractor marked approved is called signed', plant: setItem('change_order:co14', (i) => { i.strength = 'signed'; }) },
  { rule: 'S1', what: 'a paper waiver is called signed', plant: setItem('lien_waiver:w2', (i) => { i.strength = 'signed'; i.reason = 'waiver_sub_signed'; }) },
  { rule: 'S1', what: 'a daily report is called locked because it was sent', plant: setItem('daily_report:d1', (i) => { i.strength = 'locked'; }) },
  { rule: 'S1', what: 'an unsealed punch item is called sealed', plant: setItem('punch_item:pi2', (i) => { i.strength = 'sealed'; i.reason = 'punch_item_in_seal'; }) },
  { rule: 'S1', what: 'a typed inspection result is called recorded', plant: setItem('inspection:perm1:in1', (i) => { i.strength = 'recorded'; }) },
  { rule: 'S1', what: 'a draft field ticket is included', plant: packEdit((p) => { p.items.push({ ...(p.items.find((x) => x.key === 'field_ticket:ft1') as Item), key: 'field_ticket:ft2', id: 'ft2' }); }) },
  { rule: 'S1', what: 'a pay application with no lock on the server is called locked', plant: packEdit((p, input) => { if (input.payRef.id === 'app3' && !(input.payAppServer as { lockedAt?: string | null } | null | undefined)?.lockedAt) { p.pay.strength = 'locked'; p.pay.reason = 'pay_app_locked'; } }) },
  { rule: 'S1', what: 'an invoice with a pay link is called locked', plant: mods({ invoiceStrength: (inv) => (inv.payLinkId ? { strength: 'locked', reason: 'invoice_pay_link' } : { strength: 'recorded', reason: 'invoice_saved' }) }) },
  { rule: 'S1', what: 'a waiver signed by the contractor for the sub is called signed', plant: mods({ lienWaiverStrength: (x, via) => (x.status === 'signed' ? { strength: 'signed', reason: 'waiver_sub_signed' } : CORE.lienWaiverStrength(x, via)) }) },
  { rule: 'S1', what: 'a punch item is sealed because it carries a seal id', plant: mods({ punchItemStrength: (i) => (i.sealId ? { strength: 'sealed', reason: 'punch_item_in_seal' } : { strength: 'recorded', reason: 'punch_item_open' }) }) },
  { rule: 'S1', what: 'a ticket with no signature block is called signed', plant: mods({ fieldTicketStrength: (t) => (t.status === 'signed' ? { strength: 'locked', reason: 'field_ticket_signed' } : null) }) },
  { rule: 'S1', what: 'an October change order is in September’s package', plant: packEdit((p) => { p.items.push({ ...(p.items.find((x) => x.key === 'change_order:co14') as Item), key: 'change_order:co15', id: 'co15' }); }) },
  { rule: 'S1', what: 'a change order is signed because its own history says so', plant: mods({ changeOrderStrength: (co, rows) => { const r = CORE.changeOrderStrength(co, rows); return r && r.reason === 'co_signed_not_confirmed' ? { strength: 'signed', reason: 'co_client_signed' } : r; } }) },
  { rule: 'S1', what: 'unread signature rows still give a signed change order', plant: packEdit((p, input) => { if (input.coSignatures === undefined) { const i = p.items.find((x) => x.key === 'change_order:co12'); if (i) { i.strength = 'signed'; i.reason = 'co_client_signed'; } } }) },
  { rule: 'S1', what: 'the signed time is the device history’s, not the server row’s', plant: setItem('change_order:co12', (i) => { i.signedAtServer = null; }) },
  { rule: 'S1', what: 'the package does not say identity is unchecked', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'signer_identity_not_checked'); }) },
  { rule: 'S1', what: 'a requested waiver is evidence', plant: packEdit((p) => { p.items.push({ ...(p.items.find((x) => x.key === 'lien_waiver:w3') as Item), key: 'lien_waiver:w4', id: 'w4' }); }) },
  // T1
  { rule: 'T1', what: 'any row with a drawn signature is called signed, marker or not', plant: mods({ changeOrderStrength: (co, rows) => { const r = CORE.changeOrderStrength(co, rows); return r && (r.reason === 'co_signature_recorded' || r.reason === 'co_signature_by_account') ? { strength: 'signed', reason: 'co_client_signed' } : r; } }) },
  { rule: 'T1', what: 'today’s unmarked approval row prints as Signed', plant: packEdit((p, input) => { if (input.coSignatures && input.coSignatures.every((r) => !r.recordedVia)) { const i = p.items.find((x) => x.key === 'change_order:co12'); if (i) { i.strength = 'signed'; i.reason = 'co_client_signed'; p.counts.signed += 1; } } }) },
  { rule: 'T1', what: 'a contractor-inserted approval prints as Signed', plant: packEdit((p) => { const i = p.items.find((x) => x.key === 'change_order:co12'); if (i && i.reason === 'co_signature_by_account') { i.strength = 'signed'; i.reason = 'co_client_signed'; } }) },
  { rule: 'T1', what: 'a portal row with no amount in its record is still Signed', plant: mods({ changeOrderStrength: (co, rows) => { const r = CORE.changeOrderStrength(co, rows); return r && r.reason === 'co_signature_no_amount' ? { strength: 'signed', reason: 'co_client_signed' } : r; } }) },
  { rule: 'T1', what: 'the amount printed is the change order’s current one', plant: setItem('change_order:co12', (i) => { i.signedAmountCents = null; i.amountDiffers = false; }) },
  { rule: 'T1', what: 'a changed amount is not said', plant: setItem('change_order:co12', (i) => { i.amountDiffers = false; }) },
  { rule: 'T1', what: 'the head of the change order prints the current amount', plant: htmlEdit((h) => h.replace(/data-co-amount="200000"([^>]*>)[^<]*/, (_m, tail: string) => `data-co-amount="2000000"${tail}$20,000.00`)) },
  { rule: 'T1', what: 'the "now reads" sentence is dropped', plant: docEdit('en', () => ({ coNowReads: () => '' })) },
  { rule: 'T1', what: 'a Recorded signature record prints "Signed for"', plant: docEdit('en', (c) => ({ coRecordStates: c.coSignedFor })) },
  { rule: 'T1', what: 'a later decline is ignored', plant: packEdit((p, input) => { if ((input.coSignatures ?? []).some((r) => r.changeOrderId === 'co12' && r.decision === 'declined' && r.serverCreatedAt > '2026-09-16')) { const i = p.items.find((x) => x.key === 'change_order:co12') as unknown as Record<string, unknown> | undefined; if (i) { i.strength = 'signed'; i.reason = 'co_client_signed'; i.serverDecision = 'approved'; } } }) },
  { rule: 'T1', what: 'a later decline is not an open item', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'change_orders_declined_on_server'); }) },
  { rule: 'T1', what: 'a pay link on the phone locks the pay application', plant: mods({ payAppStrength: (rec, sv, eq) => (rec.payLinkId || rec.payLinkUrl || rec.paidAt ? { strength: 'locked', reason: 'pay_app_locked' } : CORE.payAppStrength(rec, sv, eq)) }) },
  { rule: 'T1', what: 'a pay link with no stamp prints as Locked', plant: packEdit((p, input) => { const rec = input.payApps.find((a) => a.id === input.payRef.id) as { payLinkId?: string } | undefined; if (rec?.payLinkId && p.pay.reason === 'pay_app_link_no_lock') { p.pay.strength = 'locked'; p.pay.reason = 'pay_app_locked'; } }) },
  { rule: 'T1', what: 'the stamp alone locks, figures not compared', plant: packEdit((p, input) => { const sv = input.payAppServer; if (sv && sv.lockedAt && p.pay.kind === 'pay_app' && sv.id === p.pay.id) { p.pay.strength = 'locked'; p.pay.reason = 'pay_app_locked'; p.pay.lockedAt = sv.lockedAt; } }) },
  { rule: 'T1', what: 'the stamp alone locks in the classifier', plant: mods({ payAppStrength: (rec, sv, eq) => (sv && sv.lockedAt ? { strength: 'locked', reason: 'pay_app_locked' } : CORE.payAppStrength(rec, sv, eq)) }) },
  { rule: 'T1', what: 'an unread pay application row is assumed locked', plant: mods({ payAppStrength: (rec, sv, eq) => (sv === undefined && rec.payLinkId ? { strength: 'locked', reason: 'pay_app_locked' } : CORE.payAppStrength(rec, sv, eq)) }) },
  { rule: 'T1', what: 'an unread pay application row prints as Locked', plant: packEdit((p, input) => { if (input.payAppServer === undefined && p.pay.kind === 'pay_app') { p.pay.strength = 'locked'; p.pay.reason = 'pay_app_locked'; } }) },
  { rule: 'T1', what: 'the lock time is not printed', plant: htmlEdit((h) => h.replace(/<div data-lock-time>[\s\S]*?<\/div>/, '')) },
  { rule: 'T1', what: 'the lock time printed is the phone’s', plant: packEdit((p) => { if (p.pay.kind === 'pay_app' && p.pay.lockedAt) p.pay.lockedAt = p.generatedAt; }) },
  { rule: 'T1', what: 'a local punch item that differs from the seal is Sealed', plant: packEdit((p) => { const i = p.items.find((x) => x.key === 'punch_item:pi1'); if (i && i.reason === 'punch_item_differs_from_seal') { i.strength = 'sealed'; i.reason = 'punch_item_in_seal'; p.counts.sealed += 1; } }) },
  { rule: 'T1', what: 'a sealed punch item prints the phone’s words', plant: packEdit((p, input) => { const i = p.items.find((x) => x.key === 'punch_item:pi1') as unknown as Record<string, unknown> | undefined; const local = input.punchItems.find((x) => x.id === 'pi1'); if (i && i.strength === 'sealed' && local) i.description = local.description; }) },
  { rule: 'T1', what: 'a sealed punch item reaches a billed line through its task', plant: packEdit((p, input) => { const local = input.punchItems.find((x) => x.id === 'pi1'); const l = p.pay.lines.find((x) => x.id === 'l1'); if (local?.linkedTaskId === 't1' && l && p.items.some((x) => x.key === 'punch_item:pi1' && x.strength === 'sealed')) l.itemKeys = [...l.itemKeys, 'punch_item:pi1']; }) },
  { rule: 'T1', what: 'a field ticket the server does not hold as signed is Locked', plant: packEdit((p) => { const i = p.items.find((x) => x.key === 'field_ticket:ft1'); if (i && i.reason === 'field_ticket_differs') { i.strength = 'locked'; i.reason = 'field_ticket_signed'; } }) },
  { rule: 'T1', what: 'an unread field ticket is Locked', plant: packEdit((p) => { const i = p.items.find((x) => x.key === 'field_ticket:ft1'); if (i && i.reason === 'field_ticket_not_checked') { i.strength = 'locked'; i.reason = 'field_ticket_signed'; } }) },
  { rule: 'T1', what: 'a waiver with no marker is Signed', plant: mods({ lienWaiverStrength: (x, via) => { const r = CORE.lienWaiverStrength(x, via); return r && r.reason === 'waiver_link_signature' ? { strength: 'signed', reason: 'waiver_sub_signed' } : r; } }) },
  { rule: 'T1', what: 'a waiver the contractor’s account signed prints as Signed', plant: packEdit((p, input) => { if (input.waiverSignedVia && input.waiverSignedVia.w1 !== 'signing_page') { const i = p.items.find((x) => x.key === 'lien_waiver:w1'); if (i) { i.strength = 'signed'; i.reason = 'waiver_sub_signed'; } } }) },
  { rule: 'T1', what: 'an amount is read from a record whose hash does not match', plant: mods({ reduceCo: async (raw, s) => { const r = await STORE.reduceCoApprovalRow(raw, s); if (r && !r.signedTerms) r.signedTerms = CORE.parseCoConsentRecord(String(raw.consent_record ?? '')); return r; } }) },
  { rule: 'T1', what: 'a row with no marker is assumed to be the portal’s', plant: mods({ reduceCo: async (raw, s) => { const r = await STORE.reduceCoApprovalRow(raw, s); if (r && !r.recordedVia) r.recordedVia = 'portal_function'; return r; } }) },
  { rule: 'T1', what: 'a reduced approval row keeps the record text', plant: mods({ reduceCo: async (raw, s) => { const r = await STORE.reduceCoApprovalRow(raw, s); if (r) (r as unknown as { record: unknown }).record = raw.consent_record; return r; } }) },
  { rule: 'T1', what: 'a seal whose manifest fails its fingerprint is still used', plant: mods({ reduceSeal: async (raw, s) => (await STORE.reducePunchSealRow(raw, s)) ?? { id: String(raw.id), projectId: 'p1', sealedAt: '', itemCount: 0, manifestHash: '', signerName: '', signerRole: '', items: [] } }) },
  { rule: 'T1', what: 'the pay application row keeps no lock stamp', plant: mods({ reducePayApp: (raw) => { const r = STORE.reducePayAppRow(raw); return r ? { ...r, lockedAt: null } : r; } }) },
  { rule: 'T1', what: 'a missing marker column fails the whole read', plant: text(STORE_F, 'if (res.error && isMissingColumn(res.error)) res = await ask(CO_APPROVAL_COLUMNS);', '') },
  { rule: 'T1', what: 'a failed waiver marker read is taken as "no marker"', plant: text(STORE_F, ".select(`id, ${WAIVER_MARK_COLUMN}`).eq('project_id', projectId);\n    if (error) return undefined;", ".select(`id, ${WAIVER_MARK_COLUMN}`).eq('project_id', projectId);\n    if (error) return {};") },
  { rule: 'T1', what: 'the pay application read drops the lock stamp', plant: text(STORE_F, "export const PAY_APP_SERVER_COLUMNS = 'id, certified_at, ", "export const PAY_APP_SERVER_COLUMNS = 'id, ") },
  { rule: 'T1', what: 'the document is built from the facts the screen read earlier', plant: text(REVIEW, 'withFacts(localInput, fresh)', 'withFacts(localInput, facts)') },
  { rule: 'T1', what: 'the review screen assumes the seal it has cached', plant: text(REVIEW, 'punchSeal: f ? f.punchSeal : undefined,', 'punchSeal: f ? f.punchSeal : null,') },
  { rule: 'T1', what: 'Create and Share is live before the server is read', plant: text(REVIEW, "disabled={made.kind === 'busy' || facts === null}", "disabled={made.kind === 'busy'}") },
  { rule: 'T1', what: 'the sentence drops "the contractor’s account is able to create such a record"', plant: docEdit('en', (c) => ({ reason: { ...c.reason, co_signature_by_account: 'A signature record for this change order was saved to MAGE ID’s server at the time shown. MAGE ID does not check who signed.' } })) },
  { rule: 'T1', what: 'the unmarked row’s sentence drops "MAGE ID does not check who signed"', plant: docEdit('en', (c) => ({ reason: { ...c.reason, co_signature_recorded: 'A signature record for this change order was saved to MAGE ID’s server, dated as shown. The contractor’s account is able to create such a record.' } })) },
  { rule: 'T1', what: 'the waiver sentence drops "does not check who used the link"', plant: docEdit('en', (c) => ({ reason: { ...c.reason, waiver_link_signature: 'A signature was recorded through the signing link for this waiver.' } })) },
  { rule: 'T1', what: 'the Spanish waiver sentence drops the same', plant: docEdit('es', (c) => ({ reason: { ...c.reason, waiver_link_signature: 'Se anotó una firma por el enlace de firma de esta renuncia.' } })) },
  { rule: 'T1', what: 'the unread pay application sentence says nothing about the check', plant: docEdit('en', (c) => ({ reason: { ...c.reason, pay_app_not_checked: 'The figures printed here are this device’s copy.' } })) },
  // T2
  { rule: 'T2', what: 'the left-out counts by class are zeroed', plant: packEdit((p) => { p.leftOut.byStrength = { sealed: 0, signed: 0, locked: 0, recorded: 0, stated: 0 }; }) },
  { rule: 'T2', what: 'the strip prints no left-out count under the classes', plant: htmlEdit((h) => h.replace(/<div class="num" data-left-out-class[\s\S]*?<\/div>/g, '')) },
  { rule: 'T2', what: 'the strip prints 0 left out under every class', plant: htmlEdit((h) => h.replace(/(data-left-out-class="[a-z]+" data-n=")\d+("[^>]*>)\d+/g, '$10$20')) },
  { rule: 'T2', what: 'the left-out counts are moved below the strip', plant: htmlEdit((h) => { const cells = h.match(/<div class="num" data-left-out-class[\s\S]*?<\/div>/g) ?? []; return cells.reduce((x, c) => x.replace(c, ''), h).replace('<p data-left-out="', `${cells.join('')}<p data-left-out="`); }) },
  { rule: 'T2', what: 'the by-kind line is dropped', plant: htmlEdit((h) => h.replace(/<p data-left-out-kinds[\s\S]*?<\/p>/, '')) },
  { rule: 'T2', what: 'the fingerprint sentence says the records are true', plant: docEdit('en', () => ({ fingerprintLimits: 'The fingerprint shows this document has not changed since that time, and that its records match MAGE ID’s database.' })) },
  { rule: 'T2', what: 'the fingerprint limits are not printed', plant: htmlEdit((h) => h.replace(/<div data-fingerprint-limits[\s\S]*?<\/div>/, '')) },
  { rule: 'T2', what: 'the limits are printed only when a fingerprint is on file', plant: htmlEdit((h) => (h.includes(DOC.PROOF_DOC_COPY.en.fingerprintNotOnFile) || h.includes(DOC.PROOF_DOC_COPY.es.fingerprintNotOnFile) ? h.replace(/<div data-fingerprint-limits[\s\S]*?<\/div>/, '') : h)) },
  { rule: 'T2', what: 'the Spanish check code note is empty', plant: docEdit('es', () => ({ checkCodeNote: '' })) },
  { rule: 'T2', what: 'the check code note says the code is enough', plant: docEdit('en', () => ({ checkCodeNote: 'The check code is a short name for the fingerprint. Compare the check code.' })) },
  { rule: 'T2', what: 'the fingerprint is printed in small type under a large check code', plant: htmlEdit((h) => h.replace(/(data-hash="[0-9a-f]{64}"[^>]*font-size:)15px/, '$17px')) },
  { rule: 'T2', what: 'the document does not say where the check works', plant: docEdit('en', () => ({ checkWhere: 'Anyone can check this document.' })) },
  { rule: 'T2', what: 'what is outside the fingerprint is not printed', plant: htmlEdit((h) => h.replace(/<div data-fingerprint-outside>[\s\S]*?<\/div>/, '')) },
  { rule: 'T2', what: 'the company name is taken out of the fingerprint', plant: packEdit((p) => { p.company = { name: '' }; }) },
  { rule: 'T2', what: 'the signer sentence is owed only for a Signed record', plant: packEdit((p) => { if (!p.items.some((i) => i.strength === 'signed')) p.openItems = p.openItems.filter((o) => o.code !== 'signer_identity_not_checked'); }) },
  { rule: 'T2', what: 'the signer sentence is owed only for change orders and waivers', plant: packEdit((p) => { if (!p.items.some((i) => i.kind === 'change_order' || i.kind === 'lien_waiver')) p.openItems = p.openItems.filter((o) => o.code !== 'signer_identity_not_checked'); }) },
  { rule: 'T2', what: 'the pay application says nothing is recalculated', plant: docEdit('en', () => ({ billedSourcePayApp: 'These figures are copied from the saved pay application. Nothing here is recalculated.' })) },
  { rule: 'T2', what: 'the summed rows are not marked', plant: htmlEdit((h) => h.replace(/ data-summed/g, '')) },
  { rule: 'T2', what: 'a missing total prints as $0.00', plant: htmlEdit((h) => h.replace(/data-money-gap([^>]*>)[^<]*/g, (_m, tail: string) => `data-money="0"${tail}$0.00`)) },
  { rule: 'T2', what: 'a missing total is carried as zero', plant: packEdit((p) => { if (p.pay.kind === 'pay_app' && p.pay.currentPaymentDueCents === null) { p.pay.currentPaymentDueCents = 0; p.pay.totalRetainageCents = 0; } }) },
  { rule: 'T2', what: 'the missing figures are not an open item', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'pay_figures_not_on_file'); }) },
  { rule: 'T2', what: 'an invoice line carries its total as "this period"', plant: packEdit((p) => { if (p.pay.kind === 'invoice') for (const l of p.pay.lines) l.thisPeriodCents = l.scheduledValueCents; }) },
  { rule: 'T2', what: 'the invoice table heads the line total "This Period"', plant: htmlEdit((h) => h.split('>Line Total</th>').join('>This Period</th>')) },
  { rule: 'T2', what: 'the privacy sentence leaves out the city and the counts', plant: en('office.proofPack.privacy.serverGetsBody', 'MAGE ID’s server receives one fingerprint record: the project’s id, the pay document’s id and the fingerprint.') },
  { rule: 'T2', what: 'the server is sent the company name', plant: mods({ recordArgs: (p, f) => ({ ...STORE.fingerprintRecordArgs(p, f), p_company: p.company.name }) }) },
  { rule: 'T2', what: 'the reminder to read the free text is dropped', plant: en('office.proofPack.privacy.freeTextBody', 'Descriptions print exactly as they were typed.') },
  { rule: 'T2', what: 'the review screen does not show the free text reminder', plant: text(REVIEW, '<Text style={styles.para} testID="proof-pack-free-text">{copy.freeTextBody}</Text>', '') },
  { rule: 'T2', what: 'the free text open item is dropped', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'free_text_as_typed'); }) },
  { rule: 'T2', what: 'photo coordinates are in by default', plant: text(REVIEW, 'const [includeCoordinates, setIncludeCoordinates] = useState(false);', 'const [includeCoordinates, setIncludeCoordinates] = useState(true);') },
  { rule: 'T2', what: 'coordinates are carried with the switch off', plant: packEdit((p, input) => { if (input.includeCoordinates !== true) { const i = p.items.find((x) => x.key === 'photo:ph1') as unknown as Record<string, unknown> | undefined; if (i) { i.latitude = 39.29038; i.longitude = -76.61219; } } }) },
  { rule: 'T2', what: 'the document does not say coordinates were left out', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'photo_coordinates_left_out'); }) },
  { rule: 'T2', what: 'the document does not say a waiver names the sub', plant: docEdit('en', () => ({ waiversNameSubs: '' })) },
  { rule: 'T2', what: 'the review screen has no left-out count under each label', plant: text(REVIEW, '{copy.leftOutCountLabel(pack.leftOut.byStrength[s])}', '') },
  // N1
  { rule: 'N1', what: 'the notice is reworded', plant: docEdit('en', () => ({ notice: 'This record was prepared by the contractor named above using MAGE ID.' })) },
  { rule: 'N1', what: 'the notice says MAGE ID stands behind the amounts', plant: docEdit('en', (c) => ({ notice: c.notice.replace('makes no statement to the reader about', 'stands behind') })) },
  { rule: 'N1', what: 'the Spanish notice is empty', plant: docEdit('es', () => ({ notice: '' })) },
  { rule: 'N1', what: 'the Spanish notice drops "do not rely"', plant: docEdit('es', (c) => ({ notice: c.notice.replace(' No tome este registro como una inspección, un avalúo ni una certificación.', '') })) },
  { rule: 'N1', what: 'the first-page block is dropped', plant: htmlEdit((h) => h.replace(/<div class="no-break" data-notice="first-page"[\s\S]*?<\/div>\s*<\/div>/, '')) },
  { rule: 'N1', what: 'the first-page block is moved to the last page', plant: htmlEdit((h) => { const m = /<div class="no-break" data-notice="first-page"[\s\S]*?<\/div>\s*<\/div>/.exec(h); return m ? h.replace(m[0], '').replace('</td></tr></tbody>\n</table>', `${m[0]}</td></tr></tbody>\n</table>`) : h; }) },
  { rule: 'N1', what: 'the repeating footer is dropped', plant: htmlEdit((h) => h.replace(/<tfoot[\s\S]*?<\/tfoot>/, '')) },
  { rule: 'N1', what: 'the footer stops repeating', plant: htmlEdit((h) => h.replace('<tfoot style="display:table-footer-group">', '<tfoot style="display:table-row-group">')) },
  { rule: 'N1', what: 'the footer carries only the heading', plant: htmlEdit((h) => h.replace(/(<tfoot[\s\S]*?<\/span>)[^<]*/, '$1')) },
  { rule: 'N1', what: 'the footer is a fixed element', plant: htmlEdit((h) => h.replace('data-notice="page-footer" style="', 'data-notice="page-footer" style="position:fixed;bottom:0;')) },
  { rule: 'N1', what: 'the records are printed outside the framed table', plant: htmlEdit((h) => h.replace('<tbody><tr><td style="padding:0">', '<tbody><tr><td style="padding:0"></td></tr></tbody>\n</table><div>').replace('</td></tr></tbody>\n</table>\n</body>', '</div>\n</body>')) },
  { rule: 'N1', what: 'the screen’s notice differs from the document’s', plant: en('office.proofPack.notice.body', 'This record was prepared by the contractor using MAGE ID.') },
  { rule: 'N1', what: 'the Spanish screen notice differs', plant: es('office.proofPack.notice.body', { s: 'Este registro lo preparó el contratista.', src: sourceHash(NOTICE_EN) }) },
  // A1
  { rule: 'A1', what: 'the document is titled with the old name', plant: docEdit('en', () => ({ titleLabel: 'Proof of Work Package' })) },
  { rule: 'A1', what: 'the Spanish document is titled with the old name', plant: docEdit('es', () => ({ titleLabel: 'Paquete de respaldo de obra' })) },
  { rule: 'A1', what: 'the file name keeps the old name', plant: mods({ fileTitle: (p) => `Proof of Work Package ${p.project.name}` }) },
  { rule: 'A1', what: 'the entry row keeps the old name', plant: en('office.proofPack.entry.label', 'Build Proof of Work Package') },
  { rule: 'A1', what: 'the screen title keeps the old name', plant: en('office.proofPack.screen.titleLabel', 'Proof of Work Package') },
  { rule: 'A1', what: 'the Spanish screen title keeps the old name', plant: es('office.proofPack.screen.titleLabel', { s: 'Paquete de respaldo de obra', src: sourceHash(NAME_EN) }) },
  { rule: 'A1', what: 'a screen string still says package', plant: en('office.proofPack.result.failedBody', 'The package could not be made. Try again.') },
  { rule: 'A1', what: 'a document sentence still says package', plant: docEdit('en', () => ({ fingerprintNotOnFile: 'No fingerprint is on file for this package. It cannot be checked later.' })) },
  { rule: 'A1', what: 'the route title keeps the old name', plant: text('app/_layout.tsx', "title: 'Pay Period Record', headerShown: false", "title: 'Proof of Work Package', headerShown: false") },
  { rule: 'A1', what: 'another file says the old name in code', plant: farAdd("\nexport const OLD_NAME = 'Proof of Work Package';\n") },
  // S2
  { rule: 'S2', what: 'a photo with GPS is called signed', plant: setItem('photo:ph1', (i) => { i.strength = 'signed'; }) },
  { rule: 'S2', what: 'an uploaded photo is called locked', plant: packEdit((p) => { for (const i of p.items) if (i.kind === 'photo' && i.uploaded) i.strength = 'locked'; }) },
  { rule: 'S2', what: 'photoStrength answers sealed', plant: mods({ photoStrength: () => ({ strength: 'sealed', reason: 'photo_phone' }) }) },
  { rule: 'S2', what: 'a photo with no coordinates says phone GPS', plant: setItem('photo:ph2', (i) => { i.placeSource = 'phone_gps'; }) },
  { rule: 'S2', what: 'a photo time is called the server’s', plant: setItem('photo:ph1', (i) => { i.timeSource = 'server_clock'; }) },
  { rule: 'S2', what: 'the document does not say the photo time is the phone clock', plant: htmlEdit((h) => h.replace(/Phone clock:/g, 'Taken:')) },
  // S3
  { rule: 'S3', what: 'the prior period is found from a LATER application', plant: mods({ payAppPeriod: (rec, all) => { const r = CORE.payAppPeriod(rec, all); return r && r.startSource === 'open' && all.length > 1 ? { ...r, from: '2026-10-01', startSource: 'day_after_prior_pay_app' } : r; } }) },
  { rule: 'S3', what: 'a pay application with no end date gets today', plant: mods({ payAppPeriod: (rec, all) => CORE.payAppPeriod(rec, all) ?? { from: null, to: '2026-10-09', startSource: 'open', endSource: 'pay_app_period_to' } }) },
  { rule: 'S3', what: 'an invoice claims a period of its own', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'invoice_has_no_period'); }) },
  { rule: 'S3', what: 'an open period is not disclosed', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'period_start_open'); }) },
  { rule: 'S3', what: 'the invoice period starts on the prior invoice’s own day', plant: mods({ invoicePeriod: (inv, all) => { const r = CORE.invoicePeriod(inv, all); return r && r.from ? { ...r, from: '2026-08-31' } : r; } }) },
  // M1
  { rule: 'M1', what: 'the payment due is recomputed a cent off', plant: packEdit((p) => { if (p.pay.kind === 'pay_app') p.pay.currentPaymentDueCents = (p.pay.currentPaymentDueCents ?? 0) + 1; }) },
  { rule: 'M1', what: 'the retainage is dropped', plant: packEdit((p) => { if (p.pay.kind === 'pay_app') p.pay.totalRetainageCents = 0; }) },
  { rule: 'M1', what: 'a line with nothing billed is printed', plant: packEdit((p) => { if (p.pay.kind === 'pay_app') p.pay.lines.push({ id: 'l5', itemNo: '5.0', description: 'Finishes', scheduledValueCents: 3000000, thisPeriodCents: 0, storedCents: 0, link: 'no_task', itemKeys: [] }); }) },
  { rule: 'M1', what: 'the printed money is rounded to dollars', plant: htmlEdit((h) => h.replace(/(data-money="-?\d+"[^>]*>[^<]*)\.\d\d</g, '$1<')) },
  { rule: 'M1', what: 'the invoice total is taken before tax', plant: packEdit((p) => { if (p.pay.kind === 'invoice') p.pay.totalDueCents = p.pay.subtotalCents; }) },
  { rule: 'M1', what: 'the row is reworded "Amount Requested"', plant: docEdit('en', (c) => ({ payAppRows: { ...c.payAppRows, currentPaymentDue: 'Amount Requested' } })) },
  // L1
  { rule: 'L1', what: 'records attach to a line by date', plant: packEdit((p) => { const l = p.pay.lines.find((x) => x.id === 'l4'); if (l) { l.itemKeys = ['daily_report:d2']; l.link = 'by_task'; } }) },
  { rule: 'L1', what: 'a line with no task says nothing', plant: packEdit((p) => { const l = p.pay.lines.find((x) => x.id === 'l4'); if (l) l.link = 'task_no_records'; }) },
  { rule: 'L1', what: 'the change order line loses its approval record', plant: packEdit((p) => { const l = p.pay.lines.find((x) => x.id === 'l3'); if (l) { l.itemKeys = []; l.link = 'no_task'; } }) },
  { rule: 'L1', what: 'an invoice line claims a link', plant: packEdit((p) => { if (p.pay.kind === 'invoice') p.pay.lines[0].link = 'by_task'; }) },
  { rule: 'L1', what: 'the count of lines with no records is hidden', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'lines_without_records'); }) },
  { rule: 'L1', what: 'the document drops the sentence for a line with no task', plant: htmlEdit((h) => h.split(DOC.PROOF_DOC_COPY.en.lineLink.no_task).join('')) },
  // O1
  { rule: 'O1', what: 'left-out records are not counted', plant: packEdit((p) => { p.leftOut.total = 0; }) },
  { rule: 'O1', what: 'a left-out record is still in the package', plant: mods({ buildProofPack: (i) => { const r = CORE.buildProofPack({ ...i, leaveOut: [] }); if (r.ok && i.leaveOut?.length) r.pack.leftOut = { total: i.leaveOut.length, byKind: { ...r.pack.leftOut.byKind, photo: 1, daily_report: 1, change_order: 1 }, byStrength: { ...r.pack.leftOut.byStrength, recorded: 2, stated: 1 } }; return r; } }) },
  { rule: 'O1', what: 'the document does not print the left-out line', plant: htmlEdit((h) => h.replace(/<p data-left-out="\d+"[\s\S]*?<\/p>/, '')) },
  { rule: 'O1', what: 'the left-out line is moved off page one', plant: htmlEdit((h) => { const m = /<p data-left-out="\d+"[\s\S]*?<\/p>/.exec(h); return m ? h.replace(m[0], '').replace('</body>', `${m[0]}</body>`) : h; }) },
  { rule: 'O1', what: 'the open items do not mention what was left out', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'items_left_out'); }) },
  { rule: 'O1', what: 'the sentence says "hidden for clarity"', plant: docEdit('en', () => ({ leftOutLine: (n: number) => `${n} items hidden for clarity.` })) },
  { rule: 'O1', what: 'the review screen does not pass its switches to the core', plant: text(REVIEW, /leaveOut: Array\.from\(off\)/g, 'leaveOut: []') },
  // G1
  { rule: 'G1', what: 'the inspection sign-off gap is dropped', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'no_inspection_signoff'); }) },
  { rule: 'G1', what: 'the waiver coverage gap is dropped', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'waiver_coverage_not_checked'); }) },
  { rule: 'G1', what: 'unread waivers print as none on file', plant: packEdit((p, input) => { if (input.lienWaivers === undefined) p.openItems = [...p.openItems.filter((o) => !(o.code === 'source_not_loaded' && o.source === 'lien_waivers')), { code: 'no_lien_waivers' }]; }) },
  { rule: 'G1', what: 'days with no report are not counted', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'days_without_report'); }) },
  { rule: 'G1', what: 'an empty section prints nothing', plant: htmlEdit((h) => h.split(DOC.PROOF_DOC_COPY.en.photosEmpty).join('')) },
  { rule: 'G1', what: 'the asked-for waiver is not listed', plant: packEdit((p) => { p.waiverGaps = []; }) },
  { rule: 'G1', what: 'a report changed later does not say so', plant: setItem('daily_report:d1', (i) => { i.changedAfterItsDay = false; }) },
  { rule: 'G1', what: 'an open item has no Spanish sentence', plant: docEdit('es', (c) => ({ openItem: (i) => (i.code === 'no_inspection_signoff' ? '' : c.openItem(i)) })) },
  // D1
  { rule: 'D1', what: 'a printed record loses its label', plant: htmlEdit((h) => { const at0 = h.indexOf('data-item'); const s = h.indexOf('data-strength="', at0); return s < 0 ? h : h.slice(0, s) + 'data-x="' + h.slice(s + 15); }) },
  { rule: 'D1', what: 'the counts on page one are not the package’s', plant: htmlEdit((h) => h.replace(/(data-count="recorded"[^>]*>)\d+/, '$10')) },
  { rule: 'D1', what: 'the rule for Stated is not printed', plant: htmlEdit((h) => h.split(DOC.PROOF_DOC_COPY.en.strengthRule.stated).join('')) },
  { rule: 'D1', what: 'a record is dropped from the print', plant: htmlEdit((h) => h.replace(/<div class="no-break" data-item[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, '')) },
  { rule: 'D1', what: 'a reason has no sentence in Spanish', plant: docEdit('es', (c) => ({ reason: { ...c.reason, waiver_paper: '' } })) },
  // W1
  { rule: 'W1', what: 'the second sentence is dropped from the document', plant: docEdit('en', () => ({ whatThisIsNot: '' })) },
  { rule: 'W1', what: 'the sentence says it IS a certification', plant: docEdit('en', () => ({ whatThisIsNot: 'It is an inspection and a certification of the work.' })) },
  { rule: 'W1', what: 'the Spanish first sentence is reworded', plant: docEdit('es', () => ({ whatThisIs: 'Este es el respaldo completo de la obra.' })) },
  { rule: 'W1', what: 'the two sentences are moved to the last page', plant: htmlEdit((h) => { const m = /<div data-what-this-is[\s\S]*?<\/div>/.exec(h); return m ? h.replace(m[0], '').replace('</body>', `${m[0]}</body>`) : h; }) },
  { rule: 'W1', what: 'the review screen sentence differs from the document’s', plant: en('office.proofPack.screen.whatThisIsNotBody', 'It is a summary of the work.') },
  { rule: 'W1', what: 'the review screen opens with the list', plant: text(REVIEW, '<Text style={styles.lead}>{copy.whatThisIsNotBody}</Text>', '') },
  // W2
  { rule: 'W2', what: 'a label says Verified', plant: docEdit('en', (c) => ({ strengthLabel: { ...c.strengthLabel, sealed: 'Verified' } })) },
  { rule: 'W2', what: 'the entry row says bank-ready', plant: en('office.proofPack.entry.body', 'A bank-ready package for this pay period.') },
  { rule: 'W2', what: 'the footer promises faster pay', plant: docEdit('en', (c) => ({ footer: `${c.footer} Gets you paid faster.` })) },
  { rule: 'W2', what: 'the Spanish title says prueba', plant: docEdit('es', () => ({ titleLabel: 'Registro de prueba de obra' })) },
  { rule: 'W2', what: 'a Spanish key says verificado', plant: es('office.proofPack.strength.sealedLabel', { s: 'Verificado', src: sourceHash('Sealed') }) },
  { rule: 'W2', what: 'the pay application is called an AIA pay application', plant: docEdit('en', () => ({ payAppName: (n: number) => `AIA pay application number ${n}` })) },
  { rule: 'W2', what: 'the document says the records prove the work', plant: docEdit('en', (c) => ({ labelMeaning: `${c.labelMeaning} Together they prove the work is in place.` })) },
  { rule: 'W2', what: 'a rule sentence says audit trail', plant: docEdit('en', (c) => ({ strengthRule: { ...c.strengthRule, sealed: 'The server keeps an audit trail of the record.' } })) },
  { rule: 'W2', what: 'a screen string says lender-approved', plant: en('office.proofPack.privacy.body', 'A lender-approved format. Nothing is sent to an AI model.') },
  // W3
  { rule: 'W3', what: 'a label is in sentence case', plant: en('office.proofPack.create.label', 'Create and share') },
  { rule: 'W3', what: 'a sentence uses an em dash', plant: docEdit('en', (c) => ({ openIntro: c.openIntro.replace(' that ', ' — that ') })) },
  { rule: 'W3', what: 'a heading uses the and sign', plant: docEdit('en', () => ({ punchHeadingLabel: 'Punch, Inspection & Field Ticket Records' })) },
  { rule: 'W3', what: 'a sentence says e.g.', plant: en('office.proofPack.entry.body', 'One document for this pay period, e.g. what was billed.') },
  { rule: 'W3', what: 'a string uses an arrow', plant: es('office.proofPack.create.label', { s: 'Crear → compartir', src: sourceHash('Create and Share') }) },
  { rule: 'W3', what: 'the review screen has a literal word', plant: text(REVIEW, '<Text style={styles.heading}>{copy.openHeadingLabel}</Text>', '<Text style={styles.heading}>Open items</Text>') },
  // W4
  { rule: 'W4', what: 'a key has no Spanish', plant: es('office.proofPack.create.label', undefined) },
  { rule: 'W4', what: 'the Spanish was written for other English', plant: en('office.proofPack.saved.checkFileLabel', 'Check This File') },
  { rule: 'W4', what: 'the Spanish drops a placeholder', plant: es('office.proofPack.result.onFileBody', { s: 'Documento hecho.', src: sourceHash(String(EN_REAL['office.proofPack.result.onFileBody'])) }) },
  { rule: 'W4', what: 'a Spanish document string is left in English', plant: docEdit('es', (c) => ({ fingerprintCovers: DOC.PROOF_DOC_COPY.en.fingerprintCovers, howToCheck: c.howToCheck })) },
  // P1
  { rule: 'P1', what: 'the crew rows keep the company name', plant: setItem('daily_report:d1', (i) => { (i.crew as Record<string, unknown>[])[0].company = 'Zed Kowalski Framing'; }) },
  { rule: 'P1', what: 'a field ticket keeps its labor rows', plant: setItem('field_ticket:ft1', (i) => { i.labor = [{ workerName: 'Pedro Secretworker', rate: 41.37 }]; }) },
  { rule: 'P1', what: 'a waiver keeps the sub’s email', plant: setItem('lien_waiver:w1', (i) => { i.subEmail = 'sub.secret@example.com'; }) },
  { rule: 'P1', what: 'a signature keeps its IP address', plant: setItem('lien_waiver:w1', (i) => { i.signedFrom = '203.0.113.9'; }) },
  { rule: 'P1', what: 'an inspection keeps the inspector’s name', plant: setItem('inspection:perm1:in1', (i) => { i.name = 'Rough electrical by Ivan Inspector'; }) },
  { rule: 'P1', what: 'the incident people are printed', plant: htmlEdit((h) => h.replace('</body>', '<p>Wanda Injured</p></body>')) },
  { rule: 'P1', what: 'an incident photo is counted on the report', plant: setItem('daily_report:d1', (i) => { i.photoCount = 3; }) },
  { rule: 'P1', what: 'the AI summary is carried', plant: setItem('daily_report:d1', (i) => { i.homeownerSummary = 'AI wrote this summary'; }) },
  { rule: 'P1', what: 'a signed change order loses its signer', plant: setItem('change_order:co12', (i) => { i.approvedBy = ''; }) },
  // P2
  { rule: 'P2', what: 'the core asks a model to summarise', plant: text('utils/proofPack/core.ts', "import { coApprovalLine } from '@/utils/coApproval';", "import { coApprovalLine } from '@/utils/coApproval';\nimport { mageAI } from '@/utils/mageAI';") },
  { rule: 'P2', what: 'the share step calls an edge function', plant: text(SHARE_F, 'const photoSrc = await resolveProofPhotoSources(pack, args.photoSources);', "const photoSrc = await resolveProofPhotoSources(pack, args.photoSources);\n  await supabase.functions.invoke('summarize', { body: pack });") },
  { rule: 'P2', what: 'the PDF is uploaded', plant: text(SHARE_F, 'const keptOnDevice = await saveProofPack(saved);', "const keptOnDevice = await saveProofPack(saved);\n  await supabase.storage.from('proof-packs').upload('x.pdf', uri);") },
  { rule: 'P2', what: 'the fingerprint record carries the amount', plant: mods({ recordArgs: (p, f) => ({ ...STORE.fingerprintRecordArgs(p, f), p_amount: 1811117 }) }) },
  { rule: 'P2', what: 'the fingerprint record carries the whole project name', plant: mods({ recordArgs: (p, f) => ({ ...STORE.fingerprintRecordArgs(p, f), p_project_initial: p.project.name }) }) },
  { rule: 'P2', what: 'the signature rows are read with every column', plant: text(STORE_F, '.select(columns)', ".select('*')") },
  { rule: 'P2', what: 'the signature rows are read with the signer’s email', plant: text(STORE_F, "export const CO_APPROVAL_COLUMNS = 'change_order_id, decision, signer_name,", "export const CO_APPROVAL_COLUMNS = 'change_order_id, decision, signer_name, signer_email,") },
  { rule: 'P2', what: 'the waiver read takes the signature itself', plant: text(STORE_F, '.select(`id, ${WAIVER_MARK_COLUMN}`)', '.select(`id, sub_signature, ${WAIVER_MARK_COLUMN}`)') },
  { rule: 'P2', what: 'the field ticket read takes the materials', plant: text(STORE_F, "export const FIELD_TICKET_SERVER_COLUMNS = 'id, status, number, date, work_description, labor, authorization';", "export const FIELD_TICKET_SERVER_COLUMNS = 'id, status, number, date, work_description, labor, materials, authorization';") },
  { rule: 'P2', what: 'the store reads a seventh table', plant: text(STORE_F, "supabase.from('punch_seals')", "supabase.from('profiles')") },
  { rule: 'P2', what: 'the store writes a table directly', plant: text(STORE_F, ".eq('id', serverId)", ".update({ pdf_hash: 'x' }).eq('id', serverId)") },
  { rule: 'P2', what: 'the review screen makes the package when it opens', plant: text(REVIEW, 'useEffect(() => { reloadSaved(); }, [reloadSaved]);', 'useEffect(() => { reloadSaved(); void createAndShareProofPack({} as never); }, [reloadSaved]);') },
  { rule: 'P2', what: 'the review screen fetches something itself', plant: text(REVIEW, 'const reloadSaved = useCallback(() => {', "const reloadSaved = useCallback(() => {\n    void fetch('https://example.com/log');") },
  // F1
  { rule: 'F1', what: 'the fingerprint covers only the pay figures', plant: mods({ canonicalText: (p) => FP.proofPackCanonicalText({ ...p, items: [] }) }) },
  { rule: 'F1', what: 'the fingerprint ignores the left-out count', plant: mods({ canonicalText: (p) => FP.proofPackCanonicalText({ ...p, leftOut: { total: 0, byKind: p.countsByKind, byStrength: p.counts } }) }) },
  { rule: 'F1', what: 'the fingerprint ignores the open items', plant: mods({ canonicalText: (p) => FP.proofPackCanonicalText({ ...p, openItems: [] }) }) },
  { rule: 'F1', what: 'the fingerprint ignores the made-on time', plant: mods({ canonicalText: (p) => FP.proofPackCanonicalText({ ...p, generatedAt: '' }) }) },
  { rule: 'F1', what: 'the fingerprint ignores photo records', plant: mods({ canonicalText: (p) => FP.proofPackCanonicalText({ ...p, items: p.items.filter((i) => i.kind !== 'photo') }) }) },
  { rule: 'F1', what: 'the canonical text keeps arrival order', plant: mods({ buildProofPack: (i) => { const r = CORE.buildProofPack(i); if (r.ok) r.pack.items = [...r.pack.items].sort((a, b) => i.photos.findIndex((p) => `photo:${p.id}` === a.key) - i.photos.findIndex((p) => `photo:${p.id}` === b.key)); return r; } }) },
  { rule: 'F1', what: 'the package carries a random id', plant: packEdit((p) => { (p as unknown as { nonce: number }).nonce = Math.random(); }) },
  { rule: 'F1', what: 'a second canonical writer is written', plant: text('utils/proofPack/fingerprint.ts', "import { canonicalJson } from '@/supabase/functions/_shared/punchSealManifest';", 'const canonicalJson = (v: unknown) => JSON.stringify(v);') },
  // F2
  { rule: 'F2', what: 'the check code keeps 52 bits', plant: mods({ checkCodeOf: (h) => { const c = FP.checkCodeOf(h); return c ? `${c.slice(0, 10)}${c.slice(10) === '0' ? '1' : '0'}` : c; } }) },
  { rule: 'F2', what: 'a missing record reads as a match', plant: mods({ compareFingerprint: (a, b) => (b === null ? 'match' : FP.compareFingerprint(a, b)) }) },
  { rule: 'F2', what: 'an unreachable server reads as not on file', plant: mods({ compareFingerprint: (a, b) => (b === undefined ? 'not_on_file' : FP.compareFingerprint(a, b)) }) },
  { rule: 'F2', what: 'the document does not print the fingerprint', plant: htmlEdit((h) => h.replace(/(data-hash="[0-9a-f]{64}"[^>]*>)[0-9a-f ]+/, '$1')) },
  { rule: 'F2', what: 'a package with no record still says it is on file', plant: htmlEdit((h) => h.split(DOC.PROOF_DOC_COPY.en.fingerprintNotOnFile).join(DOC.PROOF_DOC_COPY.en.howToCheck).split(DOC.PROOF_DOC_COPY.es.fingerprintNotOnFile).join(DOC.PROOF_DOC_COPY.es.howToCheck)) },
  { rule: 'F2', what: 'the printed time is the phone’s', plant: text(SHARE_F, 'serverCreatedAt: filed?.createdAt ?? null }', 'serverCreatedAt: filed?.createdAt ?? pack.generatedAt }') },
  { rule: 'F2', what: 'the document does not say what the fingerprint covers', plant: htmlEdit((h) => h.split(DOC.PROOF_DOC_COPY.en.fingerprintCovers).join('The fingerprint covers this document.').split(DOC.PROOF_DOC_COPY.es.fingerprintCovers).join('La huella cubre este documento.')) },
  { rule: 'F2', what: 'the fingerprint is cut to its first half', plant: htmlEdit((h) => h.replace(/(data-hash="[0-9a-f]{64}"[^>]*>)([0-9a-f ]{35})[0-9a-f ]+</, '$1$2<')) },
  // F3
  { rule: 'F3', what: 'the caller sends the time', plant: text(MIGRATION, "    left(btrim(coalesce(p_city, '')), 80),\n    now()\n  )", "    left(btrim(coalesce(p_city, '')), 80),\n    p_created_at\n  )") },
  { rule: 'F3', what: 'anyone on the project may create', plant: text(MIGRATION, 'where p.id = v_pid and p.user_id = v_me) then', 'where p.id = v_pid) then') },
  { rule: 'F3', what: 'the table gets an amount column', plant: text(MIGRATION, '  item_count int not null check (item_count >= 0),', '  item_count int not null check (item_count >= 0),\n  amount_cents int,') },
  { rule: 'F3', what: 'the table is writable by the app', plant: text(MIGRATION, 'grant select on public.proof_packs to authenticated;', 'grant select, insert, update on public.proof_packs to authenticated;') },
  { rule: 'F3', what: 'the file fingerprint can be replaced', plant: text(MIGRATION, ' and pp.pdf_hash is null;', ';') },
  { rule: 'F3', what: 'the app sends an argument the function does not take', plant: mods({ recordArgs: (p, f) => ({ ...STORE.fingerprintRecordArgs(p, f), p_pdf_hash: 'x' }) }) },
  { rule: 'F3', what: 'the migration says it is applied', plant: text(MIGRATION, 'NOT APPLIED.', 'Applied 2026-10-09.') },
  // E1
  { rule: 'E1', what: 'the flag is turned on', plant: text(FLAG_FILE, 'export const PROOF_PACK_ENABLED = false;', 'export const PROOF_PACK_ENABLED = true;') },
  { rule: 'E1', what: 'a screen reads the flag itself', plant: farAdd("\nimport { PROOF_PACK_ENABLED } from '@/constants/featureFlags';\nexport const x = PROOF_PACK_ENABLED;\n") },
  { rule: 'E1', what: 'the gate lets everyone in', plant: mods({ allowedWith: () => true }) },
  { rule: 'E1', what: 'the gate keeps the owner out', plant: mods({ allowedWith: (flag) => flag }) },
  { rule: 'E1', what: 'an editor may make a package', plant: mods({ seatAllowed: (r) => r === 'owner' || r === 'editor' }) },
  { rule: 'E1', what: 'the entry row draws before the gate', plant: text(ROW, 'if (!projectId || !payId || !proofPackAllowed(user?.email)) return null;', 'if (!projectId || !payId) return null;') },
  { rule: 'E1', what: 'the entry row skips the seat', plant: text(ROW, 'if (!proofPackEntryAllowed(email, role)) return null;', '') },
  { rule: 'E1', what: 'the route mounts for everyone', plant: text(ROUTE, 'if (!proofPackAllowed(user?.email ?? null)) return <Redirect href="/(tabs)/(home)" />;', '') },
  { rule: 'E1', what: 'the route skips the seat', plant: text(ROUTE, 'if (!proofPackSeatAllowed(roleState.role)) {', 'if (false) {') },
  { rule: 'E1', what: 'the invoice screen imports the review', plant: text('app/invoice.tsx', "import { ProofPackEntryRow } from '@/components/proofPack/ProofPackEntryRow';", "import { ProofPackEntryRow } from '@/components/proofPack/ProofPackEntryRow';\nimport { ProofPackReview } from '@/components/proofPack/ProofPackReview';") },
  { rule: 'E1', what: 'the pay application row is drawn for an unsaved draft', plant: text('app/aia-pay-app.tsx', 'payId={savedForThisAppNumber?.id} />', 'payId="draft" />') },
  { rule: 'E1', what: 'another screen links to the route', plant: farAdd("\nexport const go = () => router.push('/proof-pack');\n") },
  // E2
  { rule: 'E2', what: 'the core reads the clock', plant: text('utils/proofPack/core.ts', 'generatedAt: input.generatedAt,', 'generatedAt: new Date().toISOString(),') },
  { rule: 'E2', what: 'the core imports React Native', plant: text('utils/proofPack/core.ts', "import { coApprovalLine } from '@/utils/coApproval';", "import { coApprovalLine } from '@/utils/coApproval';\nimport { Platform } from 'react-native';") },
  { rule: 'E2', what: 'the html layer reads storage', plant: text('utils/proofPack/html.ts', "import { formatCalendarDay } from '@/utils/calendarDate';", "import { formatCalendarDay } from '@/utils/calendarDate';\nimport AsyncStorage from '@react-native-async-storage/async-storage';") },
  { rule: 'E2', what: 'two builds differ', plant: packEdit((p) => { (p as unknown as { r: number }).r = Math.random(); }) },
  // K1
  { rule: 'K1', what: 'the key is under a prefix nobody owns', plant: mods({ keyPrefix: 'proofpacks_' }) },
  { rule: 'K1', what: 'the review screen writes storage', plant: text(REVIEW, "import { makeProofPackStyles } from './styles';", "import { makeProofPackStyles } from './styles';\nimport AsyncStorage from '@react-native-async-storage/async-storage';") },
  { rule: 'K1', what: 'the store writes a literal key', plant: text(STORE_F, 'await AsyncStorage.setItem(proofPacksKey(entry.pack.project.id), JSON.stringify(next));', "await AsyncStorage.setItem('proof_packs', JSON.stringify(next));") },
  { rule: 'K1', what: 'the store clears all storage', plant: text(STORE_F, 'const prior = await readSavedProofPacks(entry.pack.project.id);', 'const prior = await readSavedProofPacks(entry.pack.project.id);\n    await AsyncStorage.clear();') },
  // R1
  { rule: 'R1', what: 'the validator is not in the chain', plant: text('package.json', ' && bun run test:proof-pack', '') },
  { rule: 'R1', what: 'the job name carries the old count', plant: text('.github/workflows/ship-gate.yml', /ship-check — (\d+) checks/, 'ship-check — 1 checks') },
];

console.log('\n── planted mutations (each must turn its own rule red)');
const proven = new Set<string>();
for (const m of MUTATIONS) {
  const id = Object.keys(RULES).find((k) => k.startsWith(`${m.rule} `));
  let caught = false;
  let how = '';
  try {
    if (!id) throw new Error(`no rule ${m.rule}`);
    const w = m.plant(REAL);
    let problems: string[];
    try { problems = await RULES[id](w); } catch (e) { problems = [`threw ${e instanceof Error ? e.message : String(e)}`]; }
    caught = problems.length > 0;
    if (!caught) how = 'the rule stayed green';
  } catch (e) {
    how = `mutation could not be planted: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (caught) { pass += 1; proven.add(m.rule); }
  else { fail += 1; console.log(`  ✗ ${m.rule}: ${m.what} (${how})`); }
}
const unproven = Object.keys(RULES).map((k) => k.split(' ')[0]).filter((r) => !proven.has(r));
if (unproven.length === 0) { pass += 1; console.log('  ✓ every rule has at least one planted mutation that it catches'); }
else { fail += 1; console.log(`  ✗ rules with no caught mutation: ${unproven.join(', ')}`); }

// The online door was never opened by a rule: building, printing and checking need no network.
if (rpcCalls.length === 0) { pass += 1; console.log('  ✓ no rule reached the server (the pure core, the document and the re-open check need no network)'); }
else { fail += 1; console.log(`  ✗ a rule called the server: ${rpcCalls.map((c) => c.fn).join(', ')}`); }

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-proof-pack: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
if (fail > 0) process.exit(1);
