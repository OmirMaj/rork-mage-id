// validate-w5-project-cap-count.ts — wave 5, lane project-cap.
//
// The free plan's one-project cap, counted the way the server counts it, and
// every create path in this lane's files asking it first.
//
//   #58/#127  Home counted every project in the list, so a free foreman invited
//             to one GC job was paywalled from his own first job. The count is
//             now utils/projectCap: non-sample projects he OWNS — and an owned
//             awarded-RFP job COUNTS (the live trigger exempts only the award's
//             own insert; productDecision #127).
//   #57       Duplicate skipped the cap: a free GC at the cap got a copy the
//             server refused, built on it, and it never synced.
//   #59       'Load an example schedule' made a real 'Example: …' project that
//             used up the free slot; repeat taps stacked more.
//   #155      A seeded sample ticked "Send your first invoice" and "Try it".
//             The checklist's work counts use the same owned, non-sample set
//             as projectCount, so the GC's work on a shared job never ticks a
//             row either.
//   #156      migration 20260923040000: the cap also fires on a rename that
//             takes a row out of 'Sample — '. INSERT raises; UPDATE PINS the
//             name (NEW.name := OLD.name) so the rest of the write lands - the
//             app sends `name` on every project write, and a raise would have
//             refused every later edit of that job. (The PGlite test runs the
//             rules; this pins the file's shape.)
//
// Run: bun run scripts/validate-w5-project-cap-count.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SAMPLE_PROJECT_PREFIX, isSampleProjectName, countsTowardFreeCap, capProjectCount, partitionImportForCap,
} from '../utils/projectCap';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
// Block comments and whole-line comments (never a `//` inside a string).
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── utils/projectCap: the rule, run for real ────────────────────────────────
console.log('utils/projectCap');
eq('prefix is "Sample", space, EM DASH U+2014, space', [...SAMPLE_PROJECT_PREFIX].map(c => c.codePointAt(0)),
  [0x53, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x20, 0x2014, 0x20]);
ok('isSampleProjectName: seeded sample', isSampleProjectName('Sample — The Henderson Residence'));
ok('isSampleProjectName: a copy of a sample stays a sample', isSampleProjectName('Sample — The Henderson Residence (copy)'));
ok('isSampleProjectName: hyphen is not a sample', !isSampleProjectName('Sample - Job'));
ok('isSampleProjectName: en dash is not a sample', !isSampleProjectName('Sample – Job'));
ok('isSampleProjectName: no space after the dash is not a sample', !isSampleProjectName('Sample —Job'));
ok('isSampleProjectName: null / undefined', !isSampleProjectName(null) && !isSampleProjectName(undefined));

const ME = 'user-foreman';
const GC = 'user-gc';
const shared = { name: 'Henderson Kitchen', ownerUserId: GC };
const sample = { name: 'Sample — The Henderson Residence', ownerUserId: ME };
const ownedAward = { name: 'Oak St Deck (won)', ownerUserId: ME, type: 'awarded_rfp' as const };
const offline = { name: 'My first job', ownerUserId: undefined };
ok('a job shared by the GC does not count', !countsTowardFreeCap(shared, ME));
ok('a sample never counts', !countsTowardFreeCap(sample, ME));
ok('an owned awarded-RFP job COUNTS (the live rule)', countsTowardFreeCap(ownedAward, ME));
ok('unset ownerUserId counts as owned (offline first job)', countsTowardFreeCap(offline, ME));
ok('an owned job counts', countsTowardFreeCap({ name: 'Mine', ownerUserId: ME }, ME));
eq('free foreman with one shared job + one sample -> 0 (can create)', capProjectCount([shared, sample], ME), 0);
eq('free foreman with one owned awarded job -> 1 (at the cap)', capProjectCount([ownedAward, shared, sample], ME), 1);
eq('no user yet: unset owner counts, someone else\'s does not', capProjectCount([offline, shared], undefined), 1);
// The tier comparison is useTierAccess: free maxProjects = 1, so count < 1.
const FREE_MAX = 1;
ok('free foreman (shared + sample) can create', capProjectCount([shared, sample], ME) < FREE_MAX);
ok('free contractor owning an awarded job cannot', !(capProjectCount([ownedAward], ME) < FREE_MAX));

// ── hooks/useProjectCapGate (CONTRACT 5) ────────────────────────────────────
console.log('hooks/useProjectCapGate');
const gate = strip(read('hooks/useProjectCapGate.ts'));
ok('exports useProjectCapGate(): { canCreate(nextName?), explainAndOfferUpgrade() }',
  /export function useProjectCapGate\(\): ProjectCapGate/.test(gate)
  && /canCreate\(nextName\?: string\): boolean;/.test(gate)
  && /explainAndOfferUpgrade\(\): void;/.test(gate));
ok('gate counts with capProjectCount(projects, userId)', /capProjectCount\(projects, userId\)/.test(gate));
ok('a sample name is always allowed', /if \(isSampleProjectName\(nextName\)\) return true;/.test(gate));
ok('explain offers the plans screen', /showAlert\(PROJECT_CAP_ALERT_TITLE, PROJECT_CAP_ALERT_BODY/.test(gate) && /router\.push\('\/paywall'/.test(gate));

// ── Home ────────────────────────────────────────────────────────────────────
console.log('app/(tabs)/(home)/index.tsx');
const home = strip(read('app/(tabs)/(home)/index.tsx'));
ok('#58 realProjectCount = capProjectCount(projects, userId), deps include the user',
  /const realProjectCount = useMemo\(\s*\(\) => capProjectCount\(projects, userId\),\s*\[projects, userId\],?\s*\);/.test(home));
ok('#58 the `void user;` placeholder is gone', !/void user;/.test(home));
ok('#58 no list-wide count of samples left', !/projects\.filter\(p => !p\.name\.startsWith\('Sample — '\)\)\.length/.test(home));
const dupStart = home.indexOf("if (id !== 'duplicate' || ref.kind !== 'project') return;");
const dup = dupStart >= 0 ? home.slice(dupStart, home.indexOf('addProject(clone);', dupStart)) : '';
ok('#57 duplicate handler found', dup.length > 0);
const gateAt = dup.search(/if \(!isSampleProjectName\(cloneName\) && !canCreateProject\(realProjectCount\)\) \{/);
ok('#57 duplicate checks the cap right after `if (!source) return;` and before the clone',
  gateAt > dup.indexOf('if (!source) return;') && gateAt >= 0 && gateAt < dup.indexOf('const clone: Project'));
ok('#57 at the cap: closes the sheet, opens the cap Paywall, returns',
  /!canCreateProject\(realProjectCount\)\) \{\s*setActionSheetRef\(null\);\s*setProjectCapPaywall\(true\);\s*return;\s*\}/.test(dup));
ok('#57 the clone uses the gated name', /name: cloneName,/.test(dup));
ok('#155 the checklist work set is projectCount\'s set: owned and not a sample',
  /const ownedRealProjects = useMemo\(\s*\(\) => projects\.filter\(p => countsTowardFreeCap\(p, userId\)\),\s*\[projects, userId\],?\s*\);/.test(home));
ok('#155 no checklist count over every non-sample project (shared jobs included)', !/nonSampleProjects/.test(home));
ok('#155 estimateCount runs over owned non-sample projects', /const estimateCount = useMemo\(\s*\(\) => ownedRealProjects\.filter\(/.test(home));
ok('#155 realInvoiceCount = invoices on owned non-sample projects',
  /const realInvoiceCount = useMemo\(\(\) => \{\s*const realIds = new Set\(ownedRealProjects\.map\(p => p\.id\)\);\s*return invoices\.filter\(i => realIds\.has\(i\.projectId\)\)\.length;/.test(home));
ok('#155 checklist gets realProjectCount / estimateCount / realInvoiceCount',
  /projectCount=\{realProjectCount\}/.test(home) && /invoiceCount=\{realInvoiceCount\}/.test(home) && !/invoiceCount=\{invoices\.length\}/.test(home));
ok('#155 triedWowFeature reads the filtered estimateCount', /triedWowFeature=\{milestones\.voiceUsed \|\| milestones\.takeoffRun \|\| estimateCount > 0\}/.test(home));
ok('#155 milestones refetch key unchanged', /useOnboardingMilestones\(`\$\{projects\.length\}-\$\{invoices\.length\}`\)/.test(home));

// ── OnboardingChecklist ─────────────────────────────────────────────────────
console.log('components/OnboardingChecklist.tsx');
const cl = strip(read('components/OnboardingChecklist.tsx'));
ok('#155 the invoice row is never done while held (no project yet)', /done: invoiceCount > 0 && projectCount > 0,/.test(cl));
ok("the invoice row's hold is still projectCount === 0", /heldReason: projectCount === 0 \? 'after your first project' : undefined,/.test(cl));

// ── Discover > Schedule example ─────────────────────────────────────────────
console.log('app/(tabs)/discover/schedule.tsx');
const ds = strip(read('app/(tabs)/discover/schedule.tsx'));
ok('#59 example project name = SAMPLE_PROJECT_PREFIX + "Residential Build"',
  /const EXAMPLE_SCHEDULE_PROJECT_NAME = `\$\{SAMPLE_PROJECT_PREFIX\}Residential Build`;/.test(ds));
ok('#59 no "Example: " project name left', !/name: 'Example: /.test(ds));
const ex = ds.slice(ds.indexOf("case 'example': {"), ds.indexOf("case 'manual':"));
ok('#59 example project uses the constant and location ""', /name: EXAMPLE_SCHEDULE_PROJECT_NAME,/.test(ex) && /location: '',/.test(ex) && !/United States/.test(ex));
const reuseAt = ex.search(/if \(existing\) \{\s*openSchedule\(existing\.id\);\s*break;\s*\}/);
ok('#59 a repeat tap opens the existing example (with tasks) before creating another',
  reuseAt >= 0 && reuseAt < ex.indexOf('addProject(newProject)')
  && /p\.name === EXAMPLE_SCHEDULE_PROJECT_NAME && \(p\.schedule\?\.tasks\?\.length \?\? 0\) > 0/.test(ex));
ok('example schedule starts on the local calendar day', /startDate: todayCalendarDay\(\)/.test(ex) && !/now\.slice\(0, 10\)/.test(ex));

// ── Migration 20260923040000 (#156) — shape; PGlite runs the rules ──────────
console.log('supabase/migrations/20260923040000_project_cap_on_rename.sql');
const mig = strip(read('supabase/migrations/20260923040000_project_cap_on_rename.sql'));
ok('trigger is BEFORE INSERT OR UPDATE OF name', /create or replace trigger enforce_free_tier_project_cap_trigger\s+before insert or update of name on public\.projects/i.test(mig));
ok('SECURITY DEFINER + search_path public kept', /security definer\s+set search_path to 'public'/i.test(mig));
ok('master early return kept', /if public\.is_master_account\(v_owner\) then\s+return NEW;/i.test(mig));
ok('UPDATE checks only a row leaving the sample prefix, owner = OLD.user_id',
  /if TG_OP = 'UPDATE' then\s+if coalesce\(OLD\.name, ''\) not like 'Sample — %' then\s+return NEW;\s+end if;\s+v_owner := OLD\.user_id;/i.test(mig));
ok('awarded_rfp exemption only on INSERT, never for the winner\'s own session',
  /NEW\.type = 'awarded_rfp'\s+and \(auth\.uid\(\) is null or auth\.uid\(\) is distinct from NEW\.user_id\)/i.test(mig));
const countSql = mig.match(/select count\(\*\) into v_count[\s\S]*?;/i)?.[0] ?? '';
ok('count is the live rule + id <> NEW.id, with NO awarded_rfp filter (#127)',
  /where user_id = v_owner\s+and name not like 'Sample — %'\s+and id <> NEW\.id;/i.test(countSql) && !/awarded/i.test(countSql));
ok("at the cap: UPDATE pins the name and returns, INSERT raises check_violation 'Free tier is limited to 1 project' (CONTRACT 21)",
  /if v_count >= 1 then\s+if TG_OP = 'UPDATE' then\s+NEW\.name := OLD\.name;\s+return NEW;\s+end if;\s+raise exception 'Free tier is limited to 1 project\. Upgrade to Pro for unlimited projects\.'\s+using errcode = 'check_violation';\s+end if;/i.test(mig));
ok('exactly one raise in the function (the INSERT refusal)', (mig.match(/raise exception/gi) ?? []).length === 1);

// ── Data import is a create path too (integration review, wave 5) ─────────
console.log('\ndata import — the cap applies to a backup file');
{
  const freeCan = (n: number) => n < 1;      // useTierAccess().canCreateProject on free
  const proCan = (_n: number) => true;
  const file = [{ name: 'Henderson' }, { name: `${SAMPLE_PROJECT_PREFIX}Demo` }, { name: 'Maple' }, { name: 'Oak' }];
  const empty = partitionImportForCap(file, 0, freeCan);
  eq('free, no job yet: the first real project and every sample come in, the rest are held (file order)',
    [empty.admit.map(p => p.name), empty.held.map(p => p.name)],
    [['Henderson', `${SAMPLE_PROJECT_PREFIX}Demo`], ['Maple', 'Oak']]);
  const full = partitionImportForCap(file, 1, freeCan);
  eq('free, already at the cap: only samples come in', [full.admit.length, full.held.length], [1, 3]);
  const pro = partitionImportForCap(file, 5, proCan);
  eq('a paid plan holds nothing back', [pro.admit.length, pro.held.length], [4, 0]);
  // Raw source, not strip(): the screen's DocumentPicker type list holds the
  // string '*/*', which the block-comment stripper reads as a comment opener.
  const scr = read('app/data-import.tsx');
  ok('the import screen imports only the admitted projects and says how many were held back',
    /partitionImportForCap\(toAdd, capProjectCount\(projects, user\?\.id\), canCreateProject\)/.test(scr)
      && /projects: projectSplit\.admit,/.test(scr)
      && !/projects: parsed\.data\.projects \?\? \[\]/.test(scr)
      && /setResult\(\{ \.\.\.r, projectsHeld: heldProjects \}\)/.test(scr)
      && /HELD BACK BY YOUR PLAN/.test(scr));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
