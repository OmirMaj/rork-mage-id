// validate-w5-permits-warranties-screens.ts — wave 5, lane permits-warranties:
// the three screens. Route files cannot be imported outside Metro, so the one
// pure gate is LIFTED out of its route and run for real; the rest are shape
// checks on comment-stripped source, each written so reverting its fix
// flips it.
//
//   #51  app/permits.tsx opened from job B showed every job's permits, stats,
//        hero and blockers, and "+" filed the new permit under projects[0].
//   #138 no form field could enter a permit's expiry; the card never said it.
//   #145 a failure logged in the history never reached status/blockers.
//   #67  "Permit document attached" — and no way to open the scan.
//   #53  app/warranties.tsx: an invitee saw "No warranties yet" and his adds
//        landed on his own account (owner-only RLS). Owner-only, said so.
//   #144 "Mark resolved" on a claim; #146 claim cost to the cent.
//   #142/#143 app/warranty-walk.tsx: his warranty length in the copy; the
//        walk in progress saved per job and guarded on leave.
//
// Run: bun run scripts/validate-w5-permits-warranties-screens.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
// Block comments, whole-line comments, and a trailing `// …` after code that
// ends a statement (`;` or `,`) — never a `//` inside a string such as a URL.
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([;,])[ \t]+\/\/ .*$/gm, '$1');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
/** The body of the first `const <name> = useCallback(` / `function <name>(` in src. */
function block(src: string, head: string): string {
  const i = src.indexOf(head);
  if (i < 0) return '';
  const next = src.slice(i + head.length).search(/\n {2}const \w+ = use(Callback|Memo|State|Ref)\(|\n(export )?(default )?function /);
  return next < 0 ? src.slice(i) : src.slice(i, i + head.length + next);
}

// ── Lifting (same technique as validate-project-hub-rules) ───────────────────
type BunT = { Transpiler: new (o: { loader: string }) => { transformSync(src: string): string } };
function lift<T>(file: string, head: string, name: string): T | null {
  try {
    const src = read(file);
    const start = src.indexOf(head);
    if (start < 0) throw new Error(`not found: ${head}`);
    const end = src.slice(start).search(/\n\}\n/);
    const body = src.slice(start, start + end + 3);
    const js = new (globalThis as unknown as { Bun: BunT }).Bun.Transpiler({ loader: 'ts' }).transformSync(body);
    return new Function(`${js}\nreturn ${name};`)() as T;
  } catch (err) {
    ok(`${file}: ${name} could be lifted out`, false, String(err));
    return null;
  }
}

// ═══ app/permits.tsx ═════════════════════════════════════════════════════════
const PM = 'app/permits.tsx';
const pmRaw = read(PM);
const pm = strip(pmRaw);

console.log('\n#51 permits — one job when he came from one:');
ok('the screen hands the route job to the list', /<PermitsScreenInner scopedProjectId=\{projectId \|\| undefined\} \/>/.test(pm));
ok('scopedPermits filters to the job', /const scopedPermits = useMemo\(\s*\(\) => \(scopedProjectId \? permits\.filter\(p => p\.projectId === scopedProjectId\) : permits\)/.test(pm));
{
  const inner = pm.slice(pm.indexOf('function PermitsScreenInner('));
  const raw = inner.match(/\bpermits\.(filter|reduce|forEach|length|map)\b/g) ?? [];
  eq('no derived view reads the unscoped `permits` (only the scope itself does)', raw.length, 1);
  for (const v of ['phaseFilters', 'filtered', 'stats', 'nextInspection', 'blockers']) {
    const b = block(inner, `const ${v} = useMemo(`);
    ok(`…${v} reads scopedPermits`, b.includes('scopedPermits'), b.slice(0, 120));
  }
}
{
  const b = block(pm, 'const openNewForm = useCallback(');
  ok('"+" never silently files under projects[0]', !/projects\[0\]\?\.id \?\? ''/.test(b) && /projects\.length === 1 \? projects\[0\]\.id : ''/.test(b), b);
  ok('…defaults to the scoped job', /projectId: scopedProjectId\s*\? \(projects\.some\(p => p\.id === scopedProjectId\) \? scopedProjectId : ''\)/.test(b));
}
ok('the header names the job', /title: scopedProject \? `Permits · \$\{scopedProject\.name\}` : 'Permits'/.test(pm));
ok('"All jobs" clears the scope', /router\.setParams\(\{ projectId: undefined \}\)/.test(pm));
ok('the permitsGate text the hub validator pins is intact', /Permits are managed by the project owner/.test(pmRaw));

console.log('\n#138 permits — the expiry date:');
ok('the form state carries expiresDate', /\/\*\*[^*]*#138[\s\S]{0,120}\*\/\s*expiresDate: string;/.test(pmRaw) && /inspectionNotes: '',\s*expiresDate: '',/.test(pm));
ok('opening a permit prefills it as a calendar day', /expiresDate: calendarDayOf\(permit\.expiresDate\) \?\? '',/.test(pm));
ok('the save ALWAYS sends the key (\'\' when cleared)', /expiresDate: form\.expiresDate,/.test(pm) && !/expiresDate: form\.expiresDate \|\| undefined/.test(pm));
ok('it is picked with the DatePickerModal (future allowed)', /setDateField\('expiresDate'\)/.test(pm) && /allowFuture=\{[^}]*dateField === 'expiresDate'/.test(pm));
ok('there is a Clear', /setForm\(f => \(\{ \.\.\.f, expiresDate: '' \}\)\)/.test(pm));
ok('+6 / +12 month shortcuts use calendar months', /addCalendarMonths\(expiryBase, m\)/.test(pm) && /\[6, 12\]\.map/.test(pm));
ok('the card reads the same rule as Brain Watch', /permitExpiryState\(permit, nowMs\)/.test(pm) && /const expiry = permitExpiryLine\(permit, Date\.now\(\)\);/.test(pm));
ok('…and says "Expires today" / "Expired N days ago"', /'Expires today'/.test(pm) && /`Expired \$\{-d\} day/.test(pm));

console.log('\n#145 permits — a logged verdict and the status:');
{
  const b = block(pm, 'const addLoggedInspection = useCallback(');
  ok('logging a verdict for the booked visit ASKS', /showAlert\(\s*'Update the permit status\?'/.test(b) && /'Keep as scheduled'/.test(b) && /'Update status'/.test(b), b.slice(0, 200));
  ok('…only when it is on/after the booked day and the permit is scheduled',
    /form\.status === 'inspection_scheduled'/.test(b) && /row\.scheduledFor >= headDay/.test(b));
  ok('…and never changes the status outside the Update-status button',
    (b.match(/status: row\.result === 'failed' \? 'inspection_failed' : 'inspection_passed'/g) ?? []).length === 1
      && /onPress: \(\) => \{[\s\S]*status: row\.result === 'failed'/.test(b));
}
ok('blockers include a failure open in the history', /p\.status === 'inspection_failed' \|\| p\.status === 'denied' \|\| historyFailures\.has\(p\.id\)/.test(pm));
ok('the Failed count too', /p\.status === 'inspection_failed' \|\| historyFailures\.has\(p\.id\)/.test(pm));
ok('history failures come from openFailedInspection', /openFailedInspection\(decodePermitInspectionNotes\(p\.inspectionNotes\)\.inspections, p\)/.test(pm));
ok('the card shows the history failure', /historyFailure=\{historyFailures\.get\(permit\.id\) \?\? null\}/.test(pm) && /\) : historyFailure \? \(/.test(pm));

console.log('\n#67 permits — the saved scan opens:');
ok('"Permit document attached" dead text is gone', !/Permit document attached/.test(pmRaw));
ok('the card has a "View permit" button', /accessibilityRole="button"\s*accessibilityLabel="View permit"/.test(pm) && /onViewScan\(\);/.test(pm));
ok('…whose press does not also open the edit form', /e\.stopPropagation\?\.\(\); onViewScan\(\);/.test(pm));
ok('a bucket path is signed with resolvePhotoUrls', /resolvePhotoUrls\(\[uri\]\)/.test(pm) && /looksLikeStoragePath\(uri\)/.test(pm));
ok('a queued upload shows the local original with the uploading note', /getOwnPhotoUploadQueue\(\)/.test(pm) && /'Scan saved — uploading, viewable once it lands\.'/.test(pm));
{
  const b = block(pm, 'const openEditForm = useCallback(');
  ok('opening a permit resolves its saved scan', /resolvePermitScan\(saved\)/.test(b), b.slice(0, 200));
  ok('…tagged with the permit id so a late result cannot fill another form',
    /const ticket = `\$\{permit\.id\}:/.test(b) && /if \(scanTicketRef\.current !== ticket\) return;/.test(b));
  ok('…and a device-local scan is shown directly', /isDeviceLocalUri\(saved\)[\s\S]{0,80}setAttachmentPreview\(saved\)/.test(b));
}
ok('"uploads on its own as soon as you have signal" only for a fresh pick',
  /scanState === 'unavailable'[\s\S]{0,300}isDeviceLocalUri\(form\.attachmentUri\)[\s\S]{0,300}'Scan attached\. It uploads on its own as soon as you have signal\.'/.test(pm));
ok('the viewer zooms (ScrollView zoom scale)', /maximumZoomScale=\{5\}/.test(pm));
ok('web opens the signed copy in a new tab from a direct tap', /Linking\.openURL\(scanViewer\.webUrl!\)/.test(pm));
ok('attaching needs the job first (the bucket path is per job)', /if \(!form\.projectId\) \{\s*showAlert\('Pick a project first'/.test(pm));

// ═══ app/warranties.tsx ══════════════════════════════════════════════════════
const WR = 'app/warranties.tsx';
const wrRaw = read(WR);
const wr = strip(wrRaw);

console.log('\n#53 warranties — owner-only on a named job, said so:');
type WGate = (a: { hasProject: boolean; role: string | null; roleLoading: boolean; roleError: boolean; rolePaused: boolean }) => string;
const wg = lift<WGate>(WR, 'function warrantiesGate(', 'warrantiesGate');
if (wg) {
  const base = { hasProject: true, role: null as string | null, roleLoading: false, roleError: false, rolePaused: false };
  eq('the owner opens it', wg({ ...base, role: 'owner' }), 'open');
  eq('no job named (Tools) is his own log', wg({ ...base, hasProject: false }), 'open');
  eq('editor → owner-only note', wg({ ...base, role: 'editor' }), 'owner_only');
  eq('field → owner-only note', wg({ ...base, role: 'field' }), 'owner_only');
  eq('viewer → owner-only note', wg({ ...base, role: 'viewer' }), 'owner_only');
  eq('loading → spinner, never the empty state', wg({ ...base, roleLoading: true }), 'loading');
  eq('failed read → retry', wg({ ...base, roleError: true }), 'error');
  eq('offline with no known role → waiting for signal', wg({ ...base, rolePaused: true }), 'paused');
  eq('offline with a cached editor role → still the note', wg({ ...base, role: 'editor', rolePaused: true }), 'owner_only');
  eq('settled null → no access', wg({ ...base }), 'no_access');
}
{
  const screen = block(wr, 'export default function WarrantiesScreen(');
  ok('the screen reads the role for the route job', /useProjectRoleState\(projectId \|\| undefined\)/.test(screen));
  ok('…and renders the note INSTEAD of the list when not open', /if \(gate !== 'open'\) \{[\s\S]*<WarrantiesAccessNote/.test(screen) && /return <WarrantiesScreenInner \/>;/.test(screen));
}
ok('the note names whose warranties they are', /Warranties are kept on the project owner's account — ask them to log one/.test(wrRaw));
ok('the account-wide form lists only jobs he owns', /ownProjects\.map\(p => \(/.test(wr) && !/\{projects\.map\(p => \(/.test(wr));
ok('…and says why a shared job is missing', /warranty-shared-jobs-note/.test(wr));

console.log('\n#144/#146 warranties — resolving claims, cents:');
{
  const b = block(wr, 'const handleResolveClaim = useCallback(');
  ok('"Mark resolved" stamps resolvedAt as today\'s calendar day', /resolvedAt: todayCalendarDay\(\)/.test(b), b.slice(0, 200));
  ok('…keeps the claim (a map, not a filter)', /\(w\.claims \?\? \[\]\)\.map\(c => c\.id === claimId/.test(b));
  ok('…through updateWarranty (the offline-queued path)', /updateWarranty\(w\.id,/.test(b));
  ok('…with an optional one-line resolution', /showPrompt\(/.test(b) && /resolution: resolution \|\| c\.resolution/.test(b));
}
ok('open claims have the button, resolved ones read "Resolved <date>"', /Mark resolved/.test(wr) && /Resolved \{formatDate\(c\.resolvedAt!\)\}/.test(wr));
ok('the "no mark resolved yet" comment is gone', !/deliberately no "mark resolved" here yet/.test(wrRaw));
ok('claim cost prints to the cent', /formatMoney\(c\.cost, 2\)/.test(wr) && !/Math\.round\(c\.cost\)/.test(wr));
ok('addWarrantyClaim is still wired (nav-coverage pins it)', /addWarrantyClaim\(/.test(wr));

// ═══ app/warranty-walk.tsx ═══════════════════════════════════════════════════
const WW = 'app/warranty-walk.tsx';
const wwRaw = read(WW);
const ww = strip(wwRaw);

console.log('\n#142 warranty walk — his warranty length in the copy:');
ok('reads his months from settings', /resolveWalkMonths\(resolveWarrantyMonths\(settings\)\)/.test(ww));
ok('no hard-wired "12-month warranty closes"', !/12-month warranty closes/.test(ww));
ok('no "year-one" anywhere in the screen', !/year-one/i.test(ww));
ok('no hard-wired "11-month" in the title, email title, subject or preheader', !/11-month/.test(ww));
ok('hero names his N months', /before your \$\{warrantyMonths\}-month warranty closes/.test(ww));
ok('email title/subject/preheader use the walk label', /completed the \$\{emailWalk\}/.test(ww) && /\$\{project\.name\} — \$\{emailWalkTitle\}/.test(ww) && /\$\{project\.name\} — \$\{emailWalk\} summary/.test(ww));
ok('an unset warranty is SAID to be an assumption, with the way to set it', /these dates assume 12 months/.test(ww) && /router\.push\('\/\(tabs\)\/settings' as never\)/.test(ww));
ok('…and the homeowner email then names no month count', /monthsAssumed \? 'warranty walk'/.test(ww));
ok('a close-date start is said as such (#136)', /counted from the day you closed the job/.test(ww));

console.log('\n#143 warranty walk — the draft and the leave guard:');
ok('draft key comes from the shared codec', /walkDraftKey\(projectId\)/.test(ww));
ok('restored through parseWalkDraft with the completion stamp', /parseWalkDraft\(raw, WALK_ITEM_IDS, completedAt\)/.test(ww));
ok('every AsyncStorage call is inside a try', (() => {
  const calls = ww.match(/AsyncStorage\.(getItem|setItem|removeItem)/g) ?? [];
  const guarded = ww.match(/try \{[^}]*AsyncStorage\.(getItem|setItem|removeItem)[\s\S]{0,400}?\} catch/g) ?? [];
  return calls.length > 0 && guarded.length >= 3;
})());
ok('the saver waits for the restore (hydrated) and is debounced', /if \(!hydrated\) return;/.test(ww) && /DRAFT_SAVE_DEBOUNCE_MS/.test(ww));
ok('"Resumed your walk from <time>"', /Resumed your walk from/.test(ww));
ok('beforeRemove guard is registered', /navigation\.addListener\('beforeRemove'/.test(ww) && /e\.preventDefault\(\)/.test(ww));
{
  const b = block(ww, 'const handleComplete = useCallback(');
  ok('a logged walk deletes the draft', /void clearDraft\(\);/.test(b), b.slice(0, 200));
  ok('…and opens the gate BEFORE its own router.back()', /allowLeave\.current = true; router\.back\(\);/.test(b));
}
ok('Discard deletes the draft', /text: 'Discard walk'[\s\S]{0,200}clearDraft\(\)/.test(ww));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
