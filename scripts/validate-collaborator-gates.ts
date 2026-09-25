// scripts/validate-collaborator-gates.ts — wave 3, lane context-integrator
// (spans every chain).
//
// THE RULE: a screen that gates on a feature an invited teammate is granted
// on the GC's plan (utils/collaboratorAccess COLLABORATOR_PROJECT_FEATURES)
// must gate through useProjectAccess(projectId) — the project-aware answer —
// not useTierAccess's own-subscription answer, or the foreman the GC invited
// hits a paywall on the exact work he was invited to do (#91). A screen that
// is deliberately own-tier carries a documented EXCEPTION below, with why.
//
// Screens still gating own-tier with no settled reason are KNOWN_GAPS: each
// one is a handoff (named in the lane report) for the screen's owner. The
// list is a ratchet — a NEW own-tier gate fails, and a gap that gets fixed
// fails until it is taken off the list, so the list keeps meaning something.
//
// Second check (#90): after context-integrator's role change, a null role
// with isLoading and isError both false means "not on this job". Every screen
// that reads useProjectRoleState must branch on isLoading AND isError (itself
// or through the blocked component it renders), so that state says why
// instead of spinning.
// Run: bun run scripts/validate-collaborator-gates.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLABORATOR_PROJECT_FEATURES, resolveProjectAccess } from '../utils/collaboratorAccess';
import { SCHEDULE_PRO_FEATURE, canOpenSchedulePro } from '../utils/scheduleRoute';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0; let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Deliberately own-tier (or not project-scoped at all). */
const EXCEPTIONS: Record<string, string> = {
  'app/(tabs)/discover/tools.tsx': 'the tool catalog — not scoped to one project; its chips are informational',
  'app/paywall.tsx': 'the upsell itself',
  'components/Paywall.tsx': 'the upsell itself',
  'app/coi-vault.tsx': 'company-wide COI vault — no project in scope',
  'app/safety-certifications.tsx': 'company-wide crew certifications — no project in scope',
  'app/safety-forms.tsx': 'company-wide safety form library — no project in scope',
  'app/safety-osha.tsx': 'the OSHA 300 log is the OWNER\'s record (safety lane, 20260919130000)',
  'app/invoice.tsx': 'invoices are the GC\'s money; collaborators do not bill (the grant covers change-order paperwork, not invoicing)',
  'components/collaborators/CollaboratorsManager.tsx': 'inviting teammates is the owner\'s own subscription (schedule_collaboration)',
  'app/crew.tsx': 'the crew roster is tenant-wide, not one job (project-hub #91)',
  'app/oac-meeting.tsx': 'its AI is gated server-side on the CALLER\'s own tier (project-hub #91)',
  'app/photo-triage.tsx': 'its AI is gated server-side on the CALLER\'s own tier (project-hub #91)',
  'app/scan.tsx': 'Business AI spend metered on the caller (project-hub #91)',
};

/** Own-tier gates on a project-scoped screen with no settled reason yet —
 *  each is a post-chain handoff to the screen's owner. */
const KNOWN_GAPS: Record<string, string> = {
  'app/(tabs)/schedule/index.tsx': "schedule_gantt_pdf (the PDF export) reads useTierAccess; switch to useProjectAccess(selectedProject?.id).canAccess('schedule_gantt_pdf')",
  'app/schedule-wizard.tsx': "schedule_gantt_pdf via useTierAccess; switch to useProjectAccess(projectId) (or document: building a schedule is the owner's)",
  'app/last-planner.tsx': "schedule_gantt_pdf via useTierAccess; project-hub left it (collaborator writes unverified) — verify last_planner RLS for field seats, then useProjectAccess",
  'app/schedule-import.tsx': "schedule_import via useTierAccess; switch to useProjectAccess(projectId) (or document: import replaces the owner's schedule)",
  'components/construction/AskConstructionMode.tsx': "construction_answer via useTierAccess; decide whether Construction Answers is metered on the asker (document) or the GC (useProjectAccess)",
};

const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))];
const features = [...COLLABORATOR_PROJECT_FEATURES];

// Wave 6c phase B: Summary and Discover link to many jobs, so they cannot
// call useProjectAccess(projectId) per job. They gate Pro through
// utils/scheduleRoute's canOpenSchedulePro(canAccess(SCHEDULE_PRO_FEATURE),
// project.myRole) — resolveProjectAccess, the same answer the hook gives —
// and the literal moved into that module. So the walk reads the constant as
// the feature it names, and counts it project-aware ONLY in that wrapped
// form; any other use of the constant (a bare own-tier canAccess) is an
// own-tier gate like the literal would be.
const FEATURE_ALIASES: Record<string, string> = { SCHEDULE_PRO_FEATURE };
const PROJECT_AWARE_ALIAS = /\bcanOpenSchedulePro\(\s*canAccess\(\s*SCHEDULE_PRO_FEATURE\s*\)/g;
function stripImports(src: string): string {
  return src.replace(/^import\s[\s\S]*?\sfrom\s+['"][^'"]+['"];?/gm, '');
}
/** Uses of an alias constant that are not the project-aware wrapped form. */
function bareAliasHits(src: string): string[] {
  const body = stripImports(src);
  const wrapped = (body.match(PROJECT_AWARE_ALIAS) ?? []).length;
  return Object.entries(FEATURE_ALIASES).filter(([name, ft]) => {
    if (!features.includes(ft as typeof features[number])) return false;
    const all = (body.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
    return all - (name === 'SCHEDULE_PRO_FEATURE' ? wrapped : 0) > 0;
  }).map(([, ft]) => ft);
}
function wrappedAliasCount(src: string): number {
  return (stripImports(src).match(PROJECT_AWARE_ALIAS) ?? []).length;
}

console.log('\nthe alias rule (self-test):');
ok('SCHEDULE_PRO_FEATURE is the granted feature Schedule Pro gates on', SCHEDULE_PRO_FEATURE === 'schedule_gantt_pdf'
  && features.includes(SCHEDULE_PRO_FEATURE as typeof features[number]));
ok('canOpenSchedulePro is resolveProjectAccess (own tier OR the seat\'s grant)',
  ([true, false] as const).every(own => ([undefined, 'owner', 'editor', 'field', 'viewer'] as const).every(role =>
    canOpenSchedulePro(own, role as never) === resolveProjectAccess(own, (role ?? null) as never, 'schedule_gantt_pdf'))));
ok('the wrapped form is project-aware, a bare canAccess(SCHEDULE_PRO_FEATURE) is own-tier',
  wrappedAliasCount("import { canOpenSchedulePro, SCHEDULE_PRO_FEATURE } from '@/utils/scheduleRoute';\nconst a = canOpenSchedulePro(canAccess(SCHEDULE_PRO_FEATURE), r);") === 1
  && bareAliasHits("import { canOpenSchedulePro, SCHEDULE_PRO_FEATURE } from '@/utils/scheduleRoute';\nconst a = canOpenSchedulePro(canAccess(SCHEDULE_PRO_FEATURE), r);").length === 0
  && bareAliasHits("import { SCHEDULE_PRO_FEATURE } from '@/utils/scheduleRoute';\nconst a = canAccess(SCHEDULE_PRO_FEATURE);").length === 1);

console.log('\nscreens gating a collaborator-granted feature:');
const ownTier: string[] = [];
let projectAware = 0;
for (const abs of files) {
  const rel = relative(ROOT, abs);
  const src = readFileSync(abs, 'utf8');
  const hits = [...features.filter(f => new RegExp(`['"]${f}['"]`).test(src)), ...bareAliasHits(src)];
  if (hits.length === 0) {
    if (wrappedAliasCount(src) > 0) projectAware++;
    continue;
  }
  if (/useProjectAccess\(/.test(src)) { projectAware++; continue; }
  if (EXCEPTIONS[rel]) continue;
  ownTier.push(rel);
}
const aliasAware = files.filter(abs => wrappedAliasCount(readFileSync(abs, 'utf8')) > 0).map(abs => relative(ROOT, abs));
ok('Summary, Discover and the AI review gate Schedule Pro through canOpenSchedulePro (project-aware)',
  ['app/(tabs)/summary/index.tsx', 'app/(tabs)/discover/schedule.tsx', 'app/schedule-review.tsx'].every(f => aliasAware.includes(f)), aliasAware.join(', '));
ok(`${projectAware} screens gate through useProjectAccess`, projectAware >= 15, String(projectAware));
const newGaps = ownTier.filter(f => !KNOWN_GAPS[f]);
ok('no NEW screen gates a collaborator-granted feature on the viewer\'s own tier', newGaps.length === 0,
  newGaps.map(f => `${f} — gate through useProjectAccess(projectId), or add a documented EXCEPTION`).join('\n      '));
const fixed = Object.keys(KNOWN_GAPS).filter(f => !ownTier.includes(f));
ok('every KNOWN_GAP is still a gap (a fixed one must come off the list)', fixed.length === 0, fixed.join(', '));
const staleEx = Object.keys(EXCEPTIONS).filter(f => {
  try { return !features.some(ft => new RegExp(`['"]${ft}['"]`).test(readFileSync(join(ROOT, f), 'utf8'))); } catch { return true; }
});
ok('every EXCEPTION still names a granted feature (a stale excuse is its own bug)', staleEx.length === 0, staleEx.join(', '));
for (const [f, why] of Object.entries(KNOWN_GAPS)) console.log(`    · gap (handoff): ${f} — ${why}`);

console.log('\n#90 — a settled null role says why (never a spinner):');
const BLOCKED_COMPONENTS: Record<string, string> = {};
for (const abs of files) {
  const src = readFileSync(abs, 'utf8');
  const m = src.match(/export (?:default )?function (\w*(?:Blocked|Gate|Wait)\w*)\(/g);
  if (!m) continue;
  for (const decl of m) {
    const name = decl.replace(/export (?:default )?function /, '').replace('(', '');
    if (/roleState\.isLoading/.test(src) && /roleState\.isError/.test(src)) BLOCKED_COMPONENTS[name] = relative(ROOT, abs);
  }
}
/** Readers of the role that are not a screen GATE: they fail closed on null
 *  on their own, so a settled null already means "less", never a spinner. */
const ROLE_USE_EXCEPTIONS: Record<string, string> = {
  'app/job-costing.tsx': 'money blinding — canViewFinancials(null) is false (fails closed), not a gate',
  // wave 6c (integration review r1): the money-blinding read moved out of
  // components/ProjectHero.tsx into this hook. hooks/ is walked since then
  // (below), so the old entry could no longer hide a stale excuse.
  'hooks/useProjectPulse.ts': 'money blinding — canViewFinancials(null) is false (fails closed), not a gate',
  'hooks/usePunchPinWriter.ts': 'not a gate: drawingPinRemovalFor(null) unlinks a pin, never deletes it (fails closed); the walk screen gates the write through pinWriteBlockedReason',
  'app/daily-report.tsx': 'publish / owner-only controls: dfrPublishAccess reads roleLoading; a settled null is "not the owner", disabled with the stated reason',
  // wave 5 (#53, closeout lane; documented by w5-join-screens): not a gate —
  // it picks which ROW TEXT an owner-only row shows. With no resolved role
  // (loading, offline, error) the project's own ownerUserId stamp decides, so
  // there is no spinner and no false "open"; an invitee's rows read "Managed
  // by the project owner", and RLS returns him nothing either way.
  'app/handover.tsx': 'owner-only row wording: an unresolved role falls back to the project\'s ownerUserId stamp (never a spinner, never a gate)',
};
/** Role readers whose settled-null handling is a post-chain handoff. */
const KNOWN_ROLE_GAPS: Record<string, string> = {
};
// Role readers are not only screens: a hook that reads the role on a
// screen's behalf (useProjectPulse, since wave 6c) is walked too.
function walkHooks(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkHooks(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
const roleFiles = [...files, ...walkHooks(join(ROOT, 'hooks'))];
const staleRoleEx = Object.keys(ROLE_USE_EXCEPTIONS).filter(f => {
  try { return !/useProjectRoleState\(/.test(readFileSync(join(ROOT, f), 'utf8')); } catch { return true; }
});
ok('every ROLE_USE_EXCEPTION still reads useProjectRoleState (a moved read takes its excuse with it)',
  staleRoleEx.length === 0, staleRoleEx.join(', '));
const noState: string[] = [];
let checked = 0;
for (const abs of roleFiles) {
  const rel = relative(ROOT, abs);
  const src = readFileSync(abs, 'utf8');
  if (!/useProjectRoleState\(/.test(src) || rel === 'hooks/useProjectRole.ts') continue;
  checked++;
  if (ROLE_USE_EXCEPTIONS[rel] || KNOWN_ROLE_GAPS[rel]) continue;
  // Branches on both, by property or destructured name, or hands the whole
  // state to a blocked component / pure gate that does.
  const direct = /\bisLoading\b/.test(src) && /\bisError\b/.test(src);
  const viaComponent = Object.keys(BLOCKED_COMPONENTS).some(c => new RegExp(`<${c}\\b[^>]*roleState=`).test(src));
  const viaHelper = /\(\s*roleState\.role,\s*roleState\s*\)/.test(src);
  if (!direct && !viaComponent && !viaHelper) noState.push(rel);
}
ok(`all ${checked} readers of useProjectRoleState handle loading AND error (so a settled null is "no access", with a reason), or are documented`,
  noState.length === 0, noState.join(', '));
const fixedRole = Object.keys(KNOWN_ROLE_GAPS).filter(f => {
  const src = readFileSync(join(ROOT, f), 'utf8');
  return !/pinWriteBlockedReason\(roleState\.role\)/.test(src);
});
ok('every KNOWN_ROLE_GAP is still a gap (a fixed one must come off the list)', fixedRole.length === 0, fixedRole.join(', '));
for (const [f, why] of Object.entries(KNOWN_ROLE_GAPS)) console.log(`    · gap (handoff): ${f} — ${why}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
