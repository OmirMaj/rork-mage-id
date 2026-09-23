// validate-w5-coi-subs-coverage.ts — a COI's expiry can actually be recorded,
// and nothing claims a read that didn't happen (audit #23 / #40).
//
// The vault called analyze-photos with task 'coi', which the function never
// accepted: every certificate read "AI validation unavailable", the card had
// only a Notes box, and so no sub's COI expiry was ever recorded from the
// vault — no reminders, and the award blocker's "add the coverage dates" led
// nowhere. The list skipped (`continue`) every certificate without a date.
// This pins, by behaviour where it can and by source where it must:
//   1. a manual coverage row feeds subcontractors.coi_expiry (through the same
//      pure subCoiExpiryAcross ProjectContext.syncSubCoiExpiry calls);
//   2. recomputeValidation judges by CALENDAR day and never passes an
//      unconfirmed AI read or a certificate with no date;
//   3. a read that doesn't happen says why — "isn't live yet" for the old
//      server's 400, the server's own sentence for a cap — never a bare
//      "unavailable"; a real read comes back tagged source 'ai';
//   4. the vault list falls back to the date on the sub's record, labelled;
//   5. the card has the rows and saves them through updateCOI;
//   6. analyze-photos has the 'coi' task (allow-list, union, prompt,
//      normaliser) on the analyze_photos meter;
//   7. the award blocker names the path that works;
//   8. the migration's subcontractor columns (CONTRACT 17) and material_receipts
//      table (CONTRACT 16) are there, with the TIN guard that never refuses a
//      queued edit.
//
// Run: bun run scripts/validate-w5-coi-subs-coverage.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Type-only (erased at runtime), so the bun stubs below still load first.
import type { Subcontractor } from '../types';
import type { COICoverageW5 } from '../utils/coiFiles';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// ── stubs: the edge function call and the file read ─────────────────────────
type InvokeResult = { data: unknown; error: unknown };
let nextInvoke: () => Promise<InvokeResult> = async () => ({ data: null, error: null });
const invoked: { name: string; body: unknown }[] = [];
const supabaseStub = {
  functions: { invoke: async (name: string, opts: { body: unknown }) => { invoked.push({ name, body: opts.body }); return nextInvoke(); } },
};
interface VirtualModuleBuilder { module(s: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void }
const bun = (globalThis as unknown as { Bun?: { plugin(d: { name: string; setup: (b: VirtualModuleBuilder) => void }): void } }).Bun;
if (!bun) { console.error('must run under bun'); process.exit(1); }
bun.plugin({
  name: 'stub-coi-validator-edges',
  setup(build) {
    build.module('@/lib/supabase', () => ({ exports: { supabase: supabaseStub, isSupabaseConfigured: true }, loader: 'object' }));
    build.module('@/utils/platformFile', () => ({ exports: { readAsBase64: async () => 'QUJD' }, loader: 'object' }));
  },
});
const httpError = (status: number, body: unknown) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: { status, json: async () => body },
});

const { validateCOIImage, recomputeValidation, coiReadFailureMessage } = await import('../utils/coiValidator');
const { vaultCoiExpiry, vaultCoiStatus, certificateExpiryDay, reviewAwardCompliance } = await import('../utils/subCompliance');
const { subCoiExpiryAcross } = await import('../utils/projectContextPure');
const { toCalendarDayString, addCalendarDays } = await import('../utils/calendarDate');

const NOW = new Date(2026, 8, 23, 20, 30); // 8:30 pm local — after UTC midnight west of Greenwich
const day = (n: number) => toCalendarDayString(addCalendarDays(NOW, n));

console.log('\n1 · a typed coverage row feeds the sub\'s COI expiry:');
{
  const typed = [{ type: 'general_liability' as const, policyNumber: 'GL-1', expiresAt: '2027-03-31', source: 'manual' as const },
                 { type: 'workers_comp' as const, expiresAt: '2027-01-15', source: 'manual' as const }];
  ok('subCoiExpiryAcross (what syncSubCoiExpiry writes to coi_expiry) = the earliest typed expiry',
    subCoiExpiryAcross([{ coverages: typed }]) === '2027-01-15', String(subCoiExpiryAcross([{ coverages: typed }])));
  ok('…and nothing when no row has a date (the old empty vault — coi_expiry untouched)',
    subCoiExpiryAcross([{ coverages: [] }]) === undefined);
}

console.log('\n2 · recomputeValidation:');
{
  const v1 = recomputeValidation([{ type: 'general_liability', expiresAt: day(0), source: 'manual' }], undefined, NOW);
  ok('expiring TODAY is a warning, not "expired" (calendar day, not UTC midnight)',
    v1.overallStatus === 'warn' && v1.issues.some(i => i.code === 'expires_within_30_days') && !v1.issues.some(i => i.code === 'expired'), JSON.stringify(v1.issues));
  const v2 = recomputeValidation([{ type: 'general_liability', expiresAt: day(-1), source: 'manual' }], undefined, NOW);
  ok('yesterday → expired (critical, fail)', v2.overallStatus === 'fail' && v2.issues.some(i => i.code === 'expired'));
  const v3 = recomputeValidation([{ type: 'general_liability', expiresAt: day(200), source: 'manual' }], undefined, NOW);
  ok('a typed, in-date policy passes', v3.overallStatus === 'pass' && v3.issues.length === 0, JSON.stringify(v3));
  const v4 = recomputeValidation([{ type: 'general_liability', expiresAt: day(200), source: 'ai' }], undefined, NOW);
  ok('an UNCONFIRMED AI read never passes', v4.overallStatus === 'warn' && v4.issues.some(i => i.code === 'ai_dates_unconfirmed'));
  const v5 = recomputeValidation([{ type: 'general_liability', policyNumber: 'GL-1', source: 'manual' }], undefined, NOW);
  ok('a certificate with no expiry anywhere never passes', v5.overallStatus === 'warn');
  const prior = { validatedAt: '', overallStatus: 'fail' as const, issues: [{ code: 'additional_insured_missing', severity: 'critical' as const, message: 'x' }] };
  ok('endorsement findings from the read survive a manual edit',
    recomputeValidation([{ type: 'general_liability', expiresAt: day(200), source: 'manual' }], prior, NOW).issues.some(i => i.code === 'additional_insured_missing'));
}

console.log('\n3 · a read that does not happen says why; a real one is tagged:');
{
  nextInvoke = async () => ({ data: null, error: httpError(400, { success: false, error: 'task must be "punch", "dfr", "rfi", "triage", "receipt", "rooms", or "conditionRisk"' }) });
  const r1 = await validateCOIImage('file:///x/coi.pdf', 'application/pdf');
  const m1 = r1.validation.issues[0]?.message ?? '';
  ok("the live server's 400 for 'coi' reads as not live yet", /isn't live yet/.test(m1) && /Type the expiry/.test(m1), m1);
  ok('…with code ai_validation_unavailable (the card opens an empty row) and no coverages',
    r1.validation.issues[0]?.code === 'ai_validation_unavailable' && r1.coverages.length === 0);
  ok('a PDF is sent as application/pdf', JSON.stringify(invoked.at(-1)?.body).includes('application/pdf'));

  nextInvoke = async () => ({ data: null, error: httpError(429, { success: false, error: 'Monthly photo-analysis limit reached (150 on pro). Resets on the 1st.', code: 'monthly_cap_reached' }) });
  const m2 = (await validateCOIImage('file:///x/coi.jpg')).validation.issues[0]?.message ?? '';
  ok("a monthly cap carries the server's own sentence, no 'try again'", m2.startsWith('Monthly photo-analysis limit reached') && !/try again/i.test(m2), m2);

  nextInvoke = async () => { throw new TypeError('Network request failed'); };
  const m3 = (await validateCOIImage('file:///x/coi.jpg')).validation.issues[0]?.message ?? '';
  ok('offline says offline', /offline/.test(m3), m3);

  ok('no failure path says the bare old "AI validation unavailable"',
    ![m1, m2, m3].some(m => /^AI validation unavailable/.test(m)));
  ok('the helper maps the new unknown_task code too', /isn't live yet/.test(coiReadFailureMessage('unknown_task', '')));

  nextInvoke = async () => ({ data: { success: true, data: {
    insuredName: 'Acme', coverages: [
      { type: 'general_liability', policyNumber: 'GL-9', effectiveDate: '2026-01-01', expiresAt: '2027-01-01', eachOccurrence: 1000000 },
      { type: 'workers comp', policyNumber: 'WC-1', expiresAt: 'soon' },
    ], hasAdditionalInsured: true, hasWaiverOfSubrogation: false, confidence: 88 } }, error: null });
  const r4 = await validateCOIImage('file:///x/coi.jpg');
  ok('a real read comes back tagged source "ai" (shown unconfirmed)', r4.coverages.every(c => c.source === 'ai') && r4.coverages.length === 2);
  ok('…with a date that is not a calendar day dropped, not stored as a guess',
    r4.coverages[1].aiExpiresAt === undefined && r4.coverages[0].aiExpiresAt === '2027-01-01');
  // Review round 1: the model's days are SUGGESTIONS. expiresAt / effectiveDate
  // feed coi_expiry, the reminders and the award gate the moment the
  // certificate is saved, so a read must never fill them.
  ok('…and the days it read land in aiExpiresAt / aiEffectiveDate, NEVER expiresAt / effectiveDate',
    r4.coverages.every(c => c.expiresAt === undefined && c.effectiveDate === undefined) && r4.coverages[0].aiEffectiveDate === '2026-01-01',
    JSON.stringify(r4.coverages));
  ok('…and the endorsement finding kept', r4.validation.issues.some(i => i.code === 'waiver_subrogation_missing'));
  ok('…never "pass" while unconfirmed', r4.validation.overallStatus !== 'pass');
}

console.log('\n4 · the vault list falls back to the date on the record:');
{
  const noDates = { coverages: [{ expiresAt: undefined }] };
  const e1 = vaultCoiExpiry(noDates, { coiExpiry: day(10) });
  ok('certificate with no date + a typed record date → the record date', e1.day === day(10) && e1.source === 'record');
  const s1 = vaultCoiStatus(e1, NOW);
  ok('…counted as expiring, and labelled as typed on his record', s1.key === 'expiring' && /typed on his record/.test(s1.label), s1.label);
  ok('record date in the past → expired', vaultCoiStatus(vaultCoiExpiry(noDates, { coiExpiry: day(-3) }), NOW).key === 'expired');
  const e2 = vaultCoiExpiry({ coverages: [{ expiresAt: day(90) }] }, { coiExpiry: day(5) });
  ok("the certificate's own date wins over the record", e2.day === day(90) && e2.source === 'certificate');
  const e3 = vaultCoiExpiry(noDates, { coiExpiry: 'next spring' });
  ok('an unparseable record date is reported, not skipped', e3.recordUnreadable && /not a date — no reminders/.test(vaultCoiStatus(e3, NOW).label));
  ok('certificateExpiryDay reads the earliest calendar day', certificateExpiryDay({ coverages: [{ expiresAt: '2027-05-01' }, { expiresAt: '2027-02-01T12:00:00.000Z' }] }) === '2027-02-01');

  const vault = src('app/coi-vault.tsx');
  const summary = vault.slice(vault.indexOf('const complianceSummary = useMemo'), vault.indexOf('const subStatus = useMemo'));
  ok('complianceSummary uses vaultCoiExpiry/vaultCoiStatus, not a coverages-only Date.parse',
    /vaultCoiStatus\(vaultCoiExpiry\(latest, sub\), now\)/.test(summary) && !/Date\.parse/.test(summary));
  ok('…and no longer skips a certificate without a date (`if (expiryMs == null) continue`)', !/expiryMs == null\) continue/.test(summary));
  ok('the row badge uses the same fallback', /vaultCoiStatus\(vaultCoiExpiry\(stat\.latest, sub\)\)/.test(vault));
}

console.log('\n5 · the card has coverage rows, saved through updateCOI:');
{
  const vault = src('app/coi-vault.tsx');
  ok('rows carry type, policy #, carrier, effective and expiry',
    /COVERAGE_TYPES\.map/.test(vault) && /placeholder="Policy #"/.test(vault) && /placeholder="Carrier"/.test(vault)
    && /field: 'effectiveDate'/.test(vault) && /field: 'expiresAt'/.test(vault));
  ok('dates come from DatePickerModal as calendar days', /<DatePickerModal/.test(vault) && /iso\.slice\(0, 10\)/.test(vault));
  ok('saving writes coverages + recomputeValidation through onUpdate (→ ctx.updateCOI → syncSubCoiExpiry)',
    /onUpdate\(\{ coverages: cleaned, validation: recomputeValidation\(cleaned, v\) \}\)/.test(vault)
    && /onUpdate=\{\(patch\) => ctxRef\.current\.updateCOI\?\.\(coi\.id, patch\)\}/.test(vault));
  ok('a card with no rows opens one empty row and says "Type the expiry from the certificate"',
    /stored\.length > 0 \? stored : \[emptyRow\(\)\]/.test(vault) && /Type the expiry from the certificate/.test(vault));
  ok('AI rows are shown unconfirmed with a Confirm action that moves the suggestion (confirmAiCoverage)',
    /Read by AI — unconfirmed/.test(vault) && /onPress=\{\(\) => replaceRow\(i, confirmAiCoverage\(c\)\)\}/.test(vault));
  ok('…the date buttons show an AI-read day as "AI read: … — unconfirmed", not as the policy date',
    /AI read: expires \$\{formatCalendarDay\(c\.aiExpiresAt\)\} — unconfirmed/.test(vault)
    && /c\.expiresAt\s*\?\s*`Expires \$\{formatCalendarDay\(c\.expiresAt\)\}`/.test(vault));
  ok('…and picking a date goes through pickCoverageDate (drops the matching suggestion)',
    /replaceRow\(picking\.row, pickCoverageDate\(row, picking\.field, iso\.slice\(0, 10\)\)\)/.test(vault));
  ok('the subtitle no longer says "we read it"', !/we read it/.test(vault));
  // #40 sharpening / review round 1: the paywall key named it a "Validator"
  // whose pitch sold limit checks nothing here performs.
  ok('the paywall is not sold as an "Insurance Validator"',
    /feature="Prequal \+ COI Tracking"/.test(vault) && !/Insurance Validator/.test(vault));
  ok('the file header no longer claims fields that did not exist', !/the GC can fill the structured fields by hand/.test(vault));
  const subs = src('app/(tabs)/subs/index.tsx');
  ok('the Subs tab COI vault row no longer says "AI checks expirations + endorsements"', !/AI checks expirations/.test(subs));
}

console.log("\n6 · analyze-photos has the 'coi' task:");
{
  const fn = src('supabase/functions/analyze-photos/index.ts');
  ok("'coi' is in the request union", /task: [^\n]*'conditionRisk' \| 'coi';/.test(fn));
  ok("'coi' is on the allow-list", /\['punch', 'dfr', 'rfi', 'triage', 'receipt', 'rooms', 'conditionRisk', 'coi'\]\.includes\(body\.task\)/.test(fn));
  ok("an unknown task says so with code 'unknown_task'", /code: 'unknown_task'/.test(fn));
  ok('the prompt switch routes coi → COI_PROMPT', /body\.task === 'coi'\s*\? COI_PROMPT/.test(fn));
  ok('the prompt asks for the RawAIExtraction shape with YYYY-MM-DD dates',
    ['insuredName', 'coverages', 'carrierName', 'policyNumber', 'effectiveDate', 'expiresAt', 'eachOccurrence', 'generalAggregate', 'hasAdditionalInsured', 'hasWaiverOfSubrogation', 'confidence', 'YYYY-MM-DD']
      .every(k => fn.slice(fn.indexOf('const COI_PROMPT'), fn.indexOf('interface CoiCoverageOut')).includes(k)));
  ok("a 'coi' normaliser returns the coverages", /if \(body\.task === 'coi'\) \{[\s\S]*?coverages: rawCov\.map/.test(fn));
  ok('metered on analyze_photos (only conditionRisk has its own meter)', /const meterKey = body\.task === 'conditionRisk' \? 'cost_xray' : 'analyze_photos';/.test(fn));
  ok('under the same Pro gate as the vault screen', /requireTier\(req, \['pro', 'business'\], 'analyze_photos'\)/.test(fn));
}

console.log('\n7 · the award blocker names the path that works:');
{
  const r = reviewAwardCompliance(
    { id: 's', companyName: 'Acme', contactName: '', phone: '', email: '', address: '', trade: 'General', licenseNumber: '', w9OnFile: false, bidHistory: [], assignedProjects: [], notes: '', createdAt: '', updatedAt: '' },
    NOW.getTime(), { vaultCertCount: 1 });
  ok('it points at the certificate\'s Coverages and the Subs record', /type the expiry under Coverages/.test(r.blockers[0] ?? '') && /COI Expiry on his record in the Subs tab/.test(r.blockers[0] ?? ''), r.blockers[0]);
}

console.log('\n8 · the migration:');
{
  const sql = src('supabase/migrations/20260923150000_coi_subs_records.sql');
  for (const col of ['legal_name text', 'tax_id_last4 text', 'license_verified_at timestamptz', 'coi_verified_at timestamptz', 'w9_doc_path text', 'coi_last_warned_for text']) {
    ok(`subcontractors.${col.split(' ')[0]}`, sql.includes(`ADD COLUMN IF NOT EXISTS ${col}`));
  }
  ok('tax_id_last4 CHECK is exactly four digits', /CHECK \(tax_id_last4 IS NULL OR tax_id_last4 ~ '\^\[0-9\]\{4\}\$'\)/.test(sql));
  // Review round 1: on UPDATE a bad value keeps the stored one (house rule:
  // NEW.col := OLD.col) — a stale '12' replayed from an old queue must not
  // wipe a valid '1234'. Only an INSERT has nothing to keep and gets NULL.
  const guard = sql.slice(sql.indexOf('subcontractors_sanitize_tax_id_last4()'), sql.indexOf('DROP TRIGGER'));
  ok('…with a BEFORE trigger that pins a bad value (UPDATE → OLD, INSERT → NULL) instead of refusing the queued edit',
    /BEFORE INSERT OR UPDATE OF tax_id_last4 ON public\.subcontractors/.test(sql)
    && /IF TG_OP = 'UPDATE' THEN\s*NEW\.tax_id_last4 := OLD\.tax_id_last4;\s*ELSE\s*NEW\.tax_id_last4 := NULL;\s*END IF;/.test(guard)
    && !/RAISE/.test(guard), guard);
  ok('material_receipts has the CONTRACT 16 columns',
    ['id text PRIMARY KEY', 'user_id uuid NOT NULL', 'project_id text', 'commitment_id text', 'payload jsonb NOT NULL', 'updated_at timestamptz NOT NULL', 'deleted_at timestamptz'].every(c => sql.includes(c)));
  ok('owner-only RLS on all four commands', ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].every(c => new RegExp(`FOR ${c} TO authenticated [^;]*auth\\.uid\\(\\) = user_id`).test(sql)));
  ok('anon has nothing; authenticated has the four grants',
    /REVOKE ALL ON public\.material_receipts FROM anon;/.test(sql) && /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.material_receipts TO authenticated;/.test(sql));
}

console.log('\n9 · an AI-only certificate clears nothing until the GC confirms it (review round 1):');
{
  const { confirmAiCoverage, pickCoverageDate, hasUnconfirmedAi } = await import('../utils/coiFiles');
  // Exactly what a read hands the vault: the model's days as suggestions only.
  const aiOnly: COICoverageW5[] = [{ type: 'general_liability', policyNumber: 'GL-9', aiEffectiveDate: '2026-06-30', aiExpiresAt: '2027-06-30', source: 'ai' }];
  const expiredSub: Subcontractor = { id: 's', companyName: 'Acme', contactName: '', phone: '', email: '', address: '', trade: 'General', licenseNumber: '', licenseExpiry: '2099-01-01', coiExpiry: '2025-01-01', w9OnFile: true, bidHistory: [], assignedProjects: [], notes: '', createdAt: '', updatedAt: '' };
  ok('subCoiExpiryAcross (→ subcontractors.coi_expiry, coiVerifiedAt) writes NOTHING for it',
    subCoiExpiryAcross([{ coverages: aiOnly }]) === undefined, String(subCoiExpiryAcross([{ coverages: aiOnly }])));
  const e = vaultCoiExpiry({ coverages: aiOnly }, expiredSub);
  ok("the vault badge does not read the AI day as the certificate's", e.source !== 'certificate' && e.day === '2025-01-01', JSON.stringify(e));
  ok('…so the lapsed record still reads expired', vaultCoiStatus(e, NOW).key === 'expired');
  const award = reviewAwardCompliance(expiredSub, NOW.getTime(), { vaultCoiExpiry: subCoiExpiryAcross([{ coverages: aiOnly }]), vaultCertCount: 1 });
  ok('the award gate does not call it current', award.coi !== 'current' && award.blockers.length > 0, JSON.stringify(award));
  const v = recomputeValidation(aiOnly, undefined, NOW);
  ok('recomputeValidation names the AI day as unconfirmed and never passes',
    v.overallStatus === 'warn' && v.issues.some(i => i.code === 'ai_dates_unconfirmed' && /2027-06-30/.test(i.message)) && !v.issues.some(i => i.code === 'expired'),
    JSON.stringify(v.issues));

  const c = confirmAiCoverage(aiOnly[0], NOW);
  ok('Confirm moves both AI days into the real fields and makes the row manual',
    c.expiresAt === '2027-06-30' && c.effectiveDate === '2026-06-30' && c.source === 'manual' && !!c.confirmedAt
    && !('aiExpiresAt' in c) && !('aiEffectiveDate' in c) && !hasUnconfirmedAi(c), JSON.stringify(c));
  ok('…after which the certificate DOES set coi_expiry', subCoiExpiryAcross([{ coverages: [c] }]) === '2027-06-30');
  ok('Confirm keeps a day the GC already typed over the AI one',
    confirmAiCoverage({ ...aiOnly[0], expiresAt: '2027-05-31' }, NOW).expiresAt === '2027-05-31');

  const p1 = pickCoverageDate(aiOnly[0], 'expiresAt', '2027-07-01', NOW);
  ok('picking the expiry sets it, drops that suggestion, keeps the effective one as a suggestion',
    p1.expiresAt === '2027-07-01' && p1.aiExpiresAt === undefined && p1.aiEffectiveDate === '2026-06-30' && p1.effectiveDate === undefined && hasUnconfirmedAi(p1),
    JSON.stringify(p1));
  const p2 = pickCoverageDate(p1, 'effectiveDate', '2026-07-01', NOW);
  ok('…and once no AI day is waiting the row is the GC\'s', p2.source === 'manual' && !hasUnconfirmedAi(p2), JSON.stringify(p2));
}

console.log(`\nvalidate-w5-coi-subs-coverage: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
