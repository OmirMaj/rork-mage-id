// scripts/validate-proof-pack.ts — the Proof of Work Package (Big Bets, Bet 3,
// Phase 1, lane PROOFPACK): the pure core, the document, the fingerprint, the
// gate and the wording, each as a RULE with planted mutations it must catch.
//
// The feature is DARK (constants/featureFlags.ts PROOF_PACK_ENABLED = false)
// with an owner preview. What these rules hold:
//
//   S1  every strength class is reached by the record the rule names, and by
//       no weaker or stronger record
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
const SCREENS = ['app/aia-pay-app.tsx', 'app/invoice.tsx'] as const;
const FEATURE_FILES: readonly string[] = [...CORE_FILES, ...IO_FILES, ...UI_FILES, GATE];
const READ_FILES: readonly string[] = [...FEATURE_FILES, FLAG_FILE, MIGRATION, ...SCREENS, 'app/_layout.tsx', 'package.json', '.github/workflows/ship-gate.yml'];

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

function fixture(over: Partial<Input> = {}): Input {
  const base = {
    project: { id: 'p1', name: 'Alder Street Renovation', location: '14 Alder Street, Baltimore, MD 21201' },
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
    coSignatures: [
      { changeOrderId: 'co12', decision: 'approved', signerName: 'Dana Client', serverCreatedAt: at('2026-09-15', '12:05'), documentHash: 'fe'.repeat(32), hasSignature: true },
      { changeOrderId: 'co13', decision: 'approved', signerName: 'Dana Client', serverCreatedAt: at('2026-09-16'), documentHash: '', hasSignature: false },
    ],
    punchItems: [
      { id: 'pi1', projectId: 'p1', description: 'Touch up paint at the stair', location: 'Stair', assignedSub: 'Kowalski', dueDate: '2026-09-24', priority: 'low', status: 'closed', closedAt: at('2026-09-24'), createdAt: at('2026-09-15'), updatedAt: at('2026-09-24'), sealId: 's1', afterPhotoStoragePath: 'u/p1/pi1-after.jpg' },
      { id: 'pi2', projectId: 'p1', description: 'Loose outlet cover', location: 'Kitchen', assignedSub: '', dueDate: '2026-09-30', priority: 'low', status: 'open', createdAt: at('2026-09-18'), updatedAt: at('2026-09-18'), linkedTaskId: 't2' },
      { id: 'pi3', projectId: 'p1', description: 'Crew note', location: '', assignedSub: '', dueDate: '', priority: 'low', status: 'open', listType: 'crew', createdAt: at('2026-09-18'), updatedAt: at('2026-09-18') },
      { id: 'pi4', projectId: 'p1', description: 'August item', location: '', assignedSub: '', dueDate: '', priority: 'low', status: 'open', createdAt: at('2026-08-02'), updatedAt: at('2026-08-02') },
    ],
    punchSeal: { id: 's1', projectId: 'p1', sealedAt: at('2026-09-25'), itemCount: 1, manifest: { items: [{ id: 'pi1' }] }, manifestHash: HASH64, signerName: 'Dana Client', signerRole: 'Owner', method: 'in_person', signaturePaths: [], consentVersion: 'v1' },
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
  'signer_identity_not_checked',
] as const;

// ── forbidden words ──────────────────────────────────────────────────────────
// A claim word says the WORK is true. A lender promise says what a third party
// will do. Neither may appear. The one allowed "certification" is the sentence
// that says the package is NOT one; "Proof" appears only in the English title.
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
];
const IS_NOT_EN = 'It is not an inspection, an appraisal or a certification of the work.';
const IS_EN = 'This is a record of what MAGE ID holds for this pay period.';
const IS_NOT_ES = 'No es una inspección, un avalúo ni una certificación de la obra.';
const IS_ES = 'Este es un registro de lo que MAGE ID guarda de este periodo de pago.';

function bannedIn(text: string, lang: 'en' | 'es', allowTitle: string[] = []): string[] {
  let t = text;
  for (const a of allowTitle) t = t.split(a).join(' ');
  const list = lang === 'en' ? BANNED_EN : BANNED_ES;
  const hits = list.filter((b) => b.re.test(t)).map((b) => b.name);
  // "proof" in English: only as part of the title, which the caller strips.
  if (lang === 'en' && /\bproof\b/i.test(t)) hits.push('proof');
  // The bare AIA name: only inside "AIA-style" and the trademark holder's own name.
  if (/\bAIA\b(?![- ]style)/i.test(t.replace(/American Institute of Architects/g, '').replace(/\bestilo AIA\b/gi, ''))) hits.push('bare AIA');
  return hits;
}
const TITLES_EN = ['Proof of Work Package', 'Build Proof of Work Package'];

const STYLE: { name: string; re: RegExp }[] = [
  { name: 'em or en dash', re: /[—–]/ },
  { name: 'a hyphen used as a dash', re: /\s-\s/ },
  { name: 'and sign', re: /&/ },
  { name: 'e.g.', re: /\be\.g\.|\bi\.e\./i },
  { name: 'arrow', re: /[←-⇿➔➡]|->|=>/ },
  { name: 'exclamation', re: /!/ },
];

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
    // The pay document: locked only once a pay link exists or it is paid.
    if (p.pay.strength !== 'recorded' || p.pay.reason !== 'pay_app_saved') bad.push(`a pay application with no pay link is ${p.pay.strength}`);
    const locked = build(w, { payApps: [as(payApp('app3', 3, '2026-09-30', { payLinkId: 'plink_1' })), as(payApp('app2', 2, '2026-08-31'))] });
    if (locked.pay.strength !== 'locked' || locked.pay.reason !== 'pay_app_pay_link') bad.push('a pay application with a pay link is not locked');
    const inv = build(w, { payRef: { kind: 'invoice', id: 'inv2' } });
    if (inv.pay.strength !== 'recorded') bad.push('an invoice is above recorded');
    const invLink = w.M.invoiceStrength({ payLinkId: 'plink', payLinkUrl: 'https://x' });
    if (invLink.strength !== 'recorded') bad.push('an invoice with a pay link is above recorded: no migration locks an invoice');
    // The unit rules, asked directly.
    if (w.M.lienWaiverStrength(as({ status: 'signed', signedAt: at('2026-09-01'), subSignature: { role: 'gc', name: 'x', signedAt: '' } }))?.strength !== 'stated') bad.push('a waiver the contractor signed for the sub is not stated');
    if (w.M.lienWaiverStrength(as({ status: 'signed', subSignature: { role: 'sub', name: 'x', signedAt: '' } }))?.strength !== 'stated') bad.push('a sub signature with no server signing time is not stated');
    if (w.M.lienWaiverStrength(as({ status: 'requested' })) !== null) bad.push('a requested waiver is classed as evidence');
    if (w.M.punchItemStrength(as({ id: 'zz', sealId: 's1' }), as({ id: 's1', manifest: { items: [{ id: 'pi1' }] } })).strength !== 'recorded') bad.push('a punch item the seal does not list is sealed because it says so');
    if (w.M.punchItemStrength(as({ id: 'pi1' }), null).strength !== 'recorded') bad.push('a punch item is sealed with no seal on file');
    if (w.M.fieldTicketStrength(as({ status: 'signed' })) !== null) bad.push('a ticket with no authorization is classed as signed');
    const signedHistory = as<Parameters<typeof CORE.changeOrderStrength>[0]>({ id: 'coX', status: 'approved', auditTrail: [{ id: 'x', action: 'client_signed_via_portal', actor: 'a', timestamp: at('2026-09-01'), detail: 'record SHA-256 0123456789abcdef' }] });
    const rowFor = (over: Record<string, unknown> = {}) => [as<import('../utils/proofPack/core').ProofCoSignatureRecord>({ changeOrderId: 'coX', decision: 'approved', signerName: 'A', serverCreatedAt: at('2026-09-01'), documentHash: 'fe'.repeat(32), hasSignature: true, ...over })];
    if (w.M.changeOrderStrength(as({ ...signedHistory, status: 'submitted' }), rowFor()) !== null) bad.push('a change order that is not approved is evidence');
    if (w.M.changeOrderStrength(signedHistory, rowFor())?.strength !== 'signed') bad.push('a change order with a signature row on the server is not signed');
    // Its own history is written by the in-app client view too (the device clock), and the account can write it: never enough alone.
    for (const [name, rows] of [['no rows', []], ['rows not read', undefined], ['a row for another change order', rowFor({ changeOrderId: 'other' })], ['a declined row', rowFor({ decision: 'declined' })], ['a row with no drawn signature', rowFor({ hasSignature: false })], ['a row with no record fingerprint', rowFor({ documentHash: '' })], ['a row with no server time', rowFor({ serverCreatedAt: '' })]] as const) {
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
    if (build(w, { coSignatures: [], lienWaivers: [] }).openItems.some((o) => o.code === 'signer_identity_not_checked')) bad.push('a package with no signed record talks about signers');
    // A seal dated after the period does not seal the period's items.
    const early = build(w, { payRef: { kind: 'pay_app', id: 'app2' } });
    if (early.items.some((i) => i.strength === 'sealed')) bad.push('a seal made after the period seals a record in the period');
    // Every class is present in the fixture, and in PROOF_STRENGTHS.
    for (const s of CORE.PROOF_STRENGTHS) if (!p.items.some((i) => i.strength === s)) bad.push(`no fixture record is ${s}`);
    if (CORE.PROOF_STRENGTHS.join() !== 'sealed,signed,locked,recorded,stated') bad.push('the classes or their order changed');
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
    for (const k of Object.keys(pay)) if (/Cents$/.test(k) && !Number.isInteger(pay[k])) bad.push(`${k} is not whole cents`);
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
    const unread = build(w, { lienWaivers: undefined, punchSeal: undefined, photosLoaded: false, dailyReportsLoaded: false, coSignatures: undefined });
    for (const s of ['lien_waivers', 'punch_seal', 'photos', 'daily_reports', 'change_order_signatures']) if (!unread.openItems.some((o) => o.code === 'source_not_loaded' && o.source === s)) bad.push(`an unread ${s} source is not an open item`);
    if (has(unread, 'no_lien_waivers') || has(unread, 'no_punch_seal')) bad.push('an unread source prints as "none on file"');
    if (!visible(html(w, unread)).includes(DOC.PROOF_DOC_COPY.en.waiversNotChecked)) bad.push('unread waivers do not print "not checked"');
    // Nothing on file says so.
    const bare = build(w, { dailyReports: [], photos: [], changeOrders: [], coSignatures: [], punchItems: [], punchSeal: null, permits: [], lienWaivers: [], fieldTickets: [] });
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
      if (!visible(raw).includes(DOC.PROOF_DOC_COPY[lang].footer)) bad.push(`${lang}: the footer does not repeat what the package is not`);
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
        const allow = lang === 'en' ? [...TITLES_EN, IS_NOT_EN, w.M.doc.en.footer === DOC.PROOF_DOC_COPY.en.footer ? '' : ''] : [IS_NOT_ES];
        const t = s.split(lang === 'en' ? 'or a certification of the work.' : 'ni una certificación de la obra.').join(' ');
        const hits = bannedIn(t, lang, allow.filter(Boolean));
        if (hits.length) bad.push(`docCopy.${lang}.${key}: ${hits.join(', ')} in "${s}"`);
      }
    }
    for (const [k, v] of Object.entries(w.EN)) {
      const hits = bannedIn(String(v).split('or a certification of the work.').join(' '), 'en', TITLES_EN);
      if (hits.length) bad.push(`${k}: ${hits.join(', ')} in "${String(v)}"`);
    }
    for (const [k, v] of Object.entries(w.ES)) {
      const hits = bannedIn(String(v.s).split('ni una certificación de la obra.').join(' '), 'es');
      if (hits.length) bad.push(`${k} (es): ${hits.join(', ')} in "${String(v.s)}"`);
    }
    // The printed document, whole, with real data in it.
    const p = build(w, { leaveOut: ['photo:ph2'] });
    for (const lang of ['en', 'es'] as const) {
      const text = visible(html(w, p, lang)).split(lang === 'en' ? 'or a certification of the work.' : 'ni una certificación de la obra.').join(' ');
      const hits = bannedIn(text, lang, lang === 'en' ? TITLES_EN : []);
      if (hits.length) bad.push(`the printed ${lang} document says: ${hits.join(', ')}`);
    }
    // The title is a name: it appears, and "proof" appears nowhere else.
    if (w.M.doc.en.titleLabel !== 'Proof of Work Package') bad.push('the English title changed');
    if (/prueba/i.test(w.M.doc.es.titleLabel)) bad.push('the Spanish title says "prueba"');
    // The guard catches what it is for (it would be green on a list that matches nothing).
    for (const s of ['Bank-ready package', 'This package is lender-approved', 'Gets you paid faster', 'Verified work in place', 'A certified record', 'Guaranteed by MAGE ID', 'An audit trail', 'The signer attested', 'This proves the work', 'An AIA pay application']) {
      if (bannedIn(s, 'en', TITLES_EN).length === 0) bad.push(`the English list does not catch: ${s}`);
    }
    for (const s of ['Trabajo verificado', 'Registro certificado', 'Pago garantizado', 'Una auditoría', 'Listo para el banco', 'Paquete de prueba de obra', 'Aprobado por el banco']) {
      if (bannedIn(s, 'es').length === 0) bad.push(`the Spanish list does not catch: ${s}`);
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
    JSON.stringify(p, (k, v) => { if (k) keys.add(k); return v; });
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
    if (tables.sort().join() !== 'change_order_approvals,proof_packs') bad.push(`store.ts reads tables: ${tables.join()}`);
    const selects = [...store.matchAll(/\.select\('([^']+)'\)/g)].map((m) => m[1]);
    if (selects.some((sel) => /\*|email|user_agent|signature_data|consent_record|note\b|ip/.test(sel))) bad.push(`store.ts selects more than the package may carry: ${selects.join(' | ')}`);
    if (!selects.includes('change_order_id, decision, signer_name, created_at, document_hash, signature_hash')) bad.push('the signature rows are not read with the six named columns');
    if (/\.(insert|update|upsert|delete)\(/.test(store)) bad.push('store.ts writes a table directly');
    const share = stripComments(w.F['utils/proofPack/share.ts']);
    if (/supabase/.test(share.replace(/supabaseRpcOnline/g, ''))) bad.push('share.ts touches the server itself');
    // Exactly what the server is sent.
    const p = build(w, { leaveOut: ['photo:ph2'] });
    const args = w.M.recordArgs(p, { hash: HASH64, code: 'x' });
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
    await edit('a photo’s place', (x) => { mut(x.photos)[0].latitude = 39.3; });
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
    for (const k of ['"items"', '"pay"', '"period"', '"leftOut"', '"openItems"', '"counts"', '"generatedAt"', '"waiverGaps"', '"version"']) if (!w.M.canonicalText(build(w)).includes(k)) bad.push(`the canonical text leaves out ${k}`);
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
      if (!new RegExp(`data-check-code[^>]*>${fp.code}<`).test(raw) || !new RegExp(`data-hash[^>]*>${fp.hash}<`).test(raw)) bad.push(`${lang}: the document does not print the code and the fingerprint`);
      const t = visible(raw);
      if (!t.includes(d.fingerprintCovers) || !t.includes(d.howToCheck)) bad.push(`${lang}: the document does not say what the fingerprint covers or how to check it`);
      if (!/UTC/.test(d.fingerprintOnFile('Oct 2, 2026, 09:31 UTC')) || !t.includes('09:31 UTC')) bad.push(`${lang}: the server time is not printed`);
      const none = visible(html(w, p, lang, { hash: fp.hash, code: fp.code, serverCreatedAt: null }));
      if (!none.includes(d.fingerprintNotOnFile)) bad.push(`${lang}: a package with no record on file does not say so`);
      if (none.includes(d.howToCheck)) bad.push(`${lang}: a package with no record on file still tells the reader how to check it`);
    }
    if (!/photo files/.test(DOC.PROOF_DOC_COPY.en.fingerprintCovers) || !/layout/.test(DOC.PROOF_DOC_COPY.en.fingerprintCovers)) bad.push('the document does not say the fingerprint leaves out the photo files and the layout');
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
    if (!/NOT\s+(?:\/\/\s*)?applied/.test(w.F[FLAG_FILE].slice(w.F[FLAG_FILE].indexOf('PROOF OF WORK PACKAGE')))) bad.push('the flag comment no longer says the migration is not applied');
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
    if (!/<Stack\.Screen name="proof-pack" options=\{\{ title: 'Proof of Work Package', headerShown: false \}\} \/>/.test(w.F['app/_layout.tsx'])) bad.push('the route is not declared in the root layout');
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
console.log('\nproof of work package:');
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
  { rule: 'S1', what: 'a pay application with no pay link is called locked', plant: packEdit((p, input) => { if (input.payRef.id === 'app3' && !(input.payApps[0] as { payLinkId?: string }).payLinkId) { p.pay.strength = 'locked'; p.pay.reason = 'pay_app_pay_link'; } }) },
  { rule: 'S1', what: 'an invoice with a pay link is called locked', plant: mods({ invoiceStrength: (inv) => (inv.payLinkId ? { strength: 'locked', reason: 'invoice_pay_link' } : { strength: 'recorded', reason: 'invoice_saved' }) }) },
  { rule: 'S1', what: 'a waiver signed by the contractor for the sub is called signed', plant: mods({ lienWaiverStrength: (x) => (x.status === 'signed' ? { strength: 'signed', reason: 'waiver_sub_signed' } : CORE.lienWaiverStrength(x)) }) },
  { rule: 'S1', what: 'a punch item is sealed because it carries a seal id', plant: mods({ punchItemStrength: (i) => (i.sealId ? { strength: 'sealed', reason: 'punch_item_in_seal' } : { strength: 'recorded', reason: 'punch_item_open' }) }) },
  { rule: 'S1', what: 'a ticket with no signature block is called signed', plant: mods({ fieldTicketStrength: (t) => (t.status === 'signed' ? { strength: 'locked', reason: 'field_ticket_signed' } : null) }) },
  { rule: 'S1', what: 'an October change order is in September’s package', plant: packEdit((p) => { p.items.push({ ...(p.items.find((x) => x.key === 'change_order:co14') as Item), key: 'change_order:co15', id: 'co15' }); }) },
  { rule: 'S1', what: 'a change order is signed because its own history says so', plant: mods({ changeOrderStrength: (co, rows) => { const r = CORE.changeOrderStrength(co, rows); return r && r.reason === 'co_signed_not_confirmed' ? { strength: 'signed', reason: 'co_client_signed' } : r; } }) },
  { rule: 'S1', what: 'unread signature rows still give a signed change order', plant: packEdit((p, input) => { if (input.coSignatures === undefined) { const i = p.items.find((x) => x.key === 'change_order:co12'); if (i) { i.strength = 'signed'; i.reason = 'co_client_signed'; } } }) },
  { rule: 'S1', what: 'the signed time is the device history’s, not the server row’s', plant: setItem('change_order:co12', (i) => { i.signedAtServer = null; }) },
  { rule: 'S1', what: 'the package does not say identity is unchecked', plant: packEdit((p) => { p.openItems = p.openItems.filter((o) => o.code !== 'signer_identity_not_checked'); }) },
  { rule: 'S1', what: 'a requested waiver is evidence', plant: packEdit((p) => { p.items.push({ ...(p.items.find((x) => x.key === 'lien_waiver:w3') as Item), key: 'lien_waiver:w4', id: 'w4' }); }) },
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
  { rule: 'M1', what: 'the payment due is recomputed a cent off', plant: packEdit((p) => { if (p.pay.kind === 'pay_app') p.pay.currentPaymentDueCents += 1; }) },
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
  { rule: 'O1', what: 'a left-out record is still in the package', plant: mods({ buildProofPack: (i) => { const r = CORE.buildProofPack({ ...i, leaveOut: [] }); if (r.ok && i.leaveOut?.length) r.pack.leftOut = { total: i.leaveOut.length, byKind: { ...r.pack.leftOut.byKind, photo: 1, daily_report: 1, change_order: 1 } }; return r; } }) },
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
  { rule: 'W2', what: 'the Spanish title says prueba', plant: docEdit('es', () => ({ titleLabel: 'Paquete de prueba de obra' })) },
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
  { rule: 'W4', what: 'the Spanish drops a placeholder', plant: es('office.proofPack.result.onFileBody', { s: 'Paquete hecho.', src: sourceHash(String(EN_REAL['office.proofPack.result.onFileBody'])) }) },
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
  { rule: 'P2', what: 'the share step calls an edge function', plant: text(SHARE_F, 'const photoSrc = await resolveProofPhotoSources(args.pack, args.photoSources);', "const photoSrc = await resolveProofPhotoSources(args.pack, args.photoSources);\n  await supabase.functions.invoke('summarize', { body: args.pack });") },
  { rule: 'P2', what: 'the PDF is uploaded', plant: text(SHARE_F, 'const keptOnDevice = await saveProofPack(saved);', "const keptOnDevice = await saveProofPack(saved);\n  await supabase.storage.from('proof-packs').upload('x.pdf', uri);") },
  { rule: 'P2', what: 'the fingerprint record carries the amount', plant: mods({ recordArgs: (p, f) => ({ ...STORE.fingerprintRecordArgs(p, f), p_amount: 1811117 }) }) },
  { rule: 'P2', what: 'the fingerprint record carries the whole project name', plant: mods({ recordArgs: (p, f) => ({ ...STORE.fingerprintRecordArgs(p, f), p_project_initial: p.project.name }) }) },
  { rule: 'P2', what: 'the signature rows are read with every column', plant: text(STORE_F, ".select('change_order_id, decision, signer_name, created_at, document_hash, signature_hash')", ".select('*')") },
  { rule: 'P2', what: 'the signature rows are read with the signer’s email', plant: text(STORE_F, ".select('change_order_id, decision, signer_name, created_at, document_hash, signature_hash')", ".select('change_order_id, decision, signer_name, signer_email, created_at, document_hash, signature_hash')") },
  { rule: 'P2', what: 'the store writes a table directly', plant: text(STORE_F, ".eq('id', serverId)", ".update({ pdf_hash: 'x' }).eq('id', serverId)") },
  { rule: 'P2', what: 'the review screen makes the package when it opens', plant: text(REVIEW, 'useEffect(() => { reloadSaved(); }, [reloadSaved]);', 'useEffect(() => { reloadSaved(); void createAndShareProofPack({} as never); }, [reloadSaved]);') },
  { rule: 'P2', what: 'the review screen fetches something itself', plant: text(REVIEW, 'const reloadSaved = useCallback(() => {', "const reloadSaved = useCallback(() => {\n    void fetch('https://example.com/log');") },
  // F1
  { rule: 'F1', what: 'the fingerprint covers only the pay figures', plant: mods({ canonicalText: (p) => FP.proofPackCanonicalText({ ...p, items: [] }) }) },
  { rule: 'F1', what: 'the fingerprint ignores the left-out count', plant: mods({ canonicalText: (p) => FP.proofPackCanonicalText({ ...p, leftOut: { total: 0, byKind: p.countsByKind } }) }) },
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
  { rule: 'F2', what: 'the document does not print the fingerprint', plant: htmlEdit((h) => h.replace(/(data-hash[^>]*>)[0-9a-f]{64}/, '$1')) },
  { rule: 'F2', what: 'a package with no record still says it is on file', plant: htmlEdit((h) => h.split(DOC.PROOF_DOC_COPY.en.fingerprintNotOnFile).join(DOC.PROOF_DOC_COPY.en.howToCheck).split(DOC.PROOF_DOC_COPY.es.fingerprintNotOnFile).join(DOC.PROOF_DOC_COPY.es.howToCheck)) },
  { rule: 'F2', what: 'the printed time is the phone’s', plant: text(SHARE_F, 'serverCreatedAt: filed?.createdAt ?? null }', 'serverCreatedAt: filed?.createdAt ?? args.pack.generatedAt }') },
  { rule: 'F2', what: 'the document does not say the photo files are left out', plant: htmlEdit((h) => h.split(DOC.PROOF_DOC_COPY.en.fingerprintCovers).join('The fingerprint covers this document.').split(DOC.PROOF_DOC_COPY.es.fingerprintCovers).join('La huella cubre este documento.')) },
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
