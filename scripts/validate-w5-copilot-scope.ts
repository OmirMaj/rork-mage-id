// scripts/validate-w5-copilot-scope.ts — audit wave 5, #34 (no job → the
// whole interview, then a dead end) and #118 (the hub reads every failure as
// "Not sure which one that is" and drops what he typed).
//
// #34: every capability whose apply() needs a job must be outside
// PROJECT_FREE — checked against the capability SOURCE files the registry
// maps, so a new capability that writes onto a job cannot slip past the gate.
// The host (app/copilot.tsx) is pinned to run the gate before the shell.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_FREE, NEEDS_LINKED_ESTIMATE, copilotPrecondition, pickableProjects, isProjectScoped, WARRANTY_OWNER_ONLY_COPY } from '../utils/copilot/projectScope';
import { INTENTS } from '../utils/copilot/intentTable';
import { hubOutcome, tileSeed, showAskMage, NO_MATCH_COPY, NO_SIGNAL_COPY, SESSION_EXPIRED_COPY } from '../utils/copilot/hubRouting';
import type { CopilotCapabilityId } from '../utils/copilot/types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ''); }
}
const ROOT = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

console.log('\n#34 — which capabilities need a job (from the capability sources):');
// registry.ts: `import { xCapability } from './dir/file';` + `id: xCapability as …`
const registry = src('utils/copilot/registry.ts');
const importPath = new Map<string, string>();
for (const m of registry.matchAll(/import \{ (\w+) \} from '\.\/([^']+)';/g)) importPath.set(m[1], m[2]);
const idToFile = new Map<CopilotCapabilityId, string>();
for (const m of registry.matchAll(/^\s+(\w+): (\w+) as CopilotCapability,/gm)) {
  const p = importPath.get(m[2]);
  if (p) idToFile.set(m[1] as CopilotCapabilityId, `utils/copilot/${p}.ts`);
}
ok('the registry maps every hub intent to a capability file', INTENTS.every(i => idToFile.has(i.id)), [...idToFile.keys()]);
const needsProject: CopilotCapabilityId[] = [];
const needsEstimate: CopilotCapabilityId[] = [];
for (const [id, file] of idToFile) {
  const body = src(file);
  const applyBody = body.slice(body.indexOf('apply:'));
  // A job-requiring apply either throws without one or writes through
  // ctx.projectId / project.* (estimateEdit silently no-ops without one).
  if (/if \(!(ctx\.)?project(\?\.linkedEstimate)?\)\s*(\{\s*)?throw/.test(applyBody) || /ctx\.project\b/.test(applyBody) || /const project = ctx\.project/.test(applyBody)) needsProject.push(id);
  if (/!(ctx\.)?project\?\.linkedEstimate/.test(applyBody)) needsEstimate.push(id);
}
ok('the scan found the job-requiring capabilities (sanity: rfi, punch, schedule, invoice)', ['rfi', 'punch', 'schedule', 'invoice'].every(id => needsProject.includes(id as CopilotCapabilityId)), needsProject);
ok('every capability whose apply needs a job is outside PROJECT_FREE', needsProject.every(id => !PROJECT_FREE.has(id)), needsProject.filter(id => PROJECT_FREE.has(id)));
ok('PROJECT_FREE is exactly new_project + lead', JSON.stringify([...PROJECT_FREE].sort()) === JSON.stringify(['lead', 'new_project']));
ok('…and neither of those applies onto an existing job', [...PROJECT_FREE].every(id => !needsProject.includes(id)), needsProject);
ok('every capability whose apply needs a linked estimate is in NEEDS_LINKED_ESTIMATE', needsEstimate.every(id => NEEDS_LINKED_ESTIMATE.has(id)) && needsEstimate.length >= 2, needsEstimate);

console.log('\n#34 — the precondition and the picker:');
ok('no job → no_project for an RFI', (() => { const p = copilotPrecondition('rfi', null); return !p.ok && p.kind === 'no_project'; })());
ok('no job is fine for new_project and lead', copilotPrecondition('new_project', null).ok && copilotPrecondition('lead', null).ok);
ok('schedule on a job with no estimate → no_estimate, before any turn', (() => { const p = copilotPrecondition('schedule', { linkedEstimate: null }); return !p.ok && p.kind === 'no_estimate' && /no estimate yet/.test(p.message); })());
ok('billing likewise; punch does not care', !copilotPrecondition('invoice', {}).ok && copilotPrecondition('punch', {}).ok);
ok('isProjectScoped mirrors PROJECT_FREE', isProjectScoped('rfi') && !isProjectScoped('lead'));
{
  const P = (id: string, status: string, updatedAt: string) => ({ id, name: id, status, updatedAt }) as never;
  const list = pickableProjects([P('a', 'in_progress', '2026-09-01'), P('b', 'closed', '2026-09-20'), P('c', 'completed', '2026-09-10'), P('d', 'draft', 'garbage')]);
  ok('picker: closed jobs out, most recently touched first, unparseable dates last', JSON.stringify((list as Array<{ id: string }>).map(p => p.id)) === JSON.stringify(['c', 'a', 'd']), list);
  ok('picker tolerates a missing list', pickableProjects(undefined).length === 0);
}

console.log('\n#34 / CARRY #53 — the host runs the gate before the shell (source pins):');
const host = src('app/copilot.tsx');
ok('the host decides the job before mounting CopilotShell', /copilotPrecondition\(capabilityId, project\)/.test(host) && /pickableProjects</.test(host) && /if \(!gateOpen\)/.test(host) && host.indexOf('if (!gateOpen)') < host.indexOf('<CopilotShell'));
ok('exactly one job is used automatically, with a Change link', /candidates\.length === 1 \? candidates\[0\]\.id/.test(host) && /copilot-change-job/.test(host));
ok('no job at all → "Create a project first" opening new_project', /Create a project first\./.test(host) && /capabilityId: 'new_project'/.test(host));
ok('a picked job is written to the route (setParams)', /router\.setParams\(\{ projectId: id \}/.test(host));
ok('schedule / billing without an estimate link to the estimate Copilot', /Build the estimate first/.test(host) && /capabilityId: 'estimate', projectId/.test(host));
ok('the shell can still pick a job over a running interview', /onPickProject=\{projectFree \? undefined : \(\) => setOverlayPicker\(true\)\}/.test(host));
ok('warranty on a job he does not own says why (owner-only interim)', /useProjectRoleState\(/.test(host) && /roleState\.role !== 'owner'/.test(host) && /WARRANTY_OWNER_ONLY_COPY/.test(host) && /owner’s account/.test(WARRANTY_OWNER_ONLY_COPY));
ok('…with loading / offline / error states that say so', /Checking your role on/.test(host) && /roleState\.isPaused/.test(host) && /Couldn’t check your role/.test(host));
ok('the ctx bag still carries receipts, labor and seeds, plus his decided markup', /markupDecided, markup: globalMarkup, receipts, laborSamples, seeds \}/.test(host));
const shell = src('components/copilot/CopilotShell.tsx');
ok('a Build error offers "Pick a job" / "Back to review", not only the mic', /Pick a job/.test(shell) && /Back to review/.test(shell) && /onPress=\{backToReview\}/.test(shell));
const hook = src('hooks/useCopilotConversation.ts');
ok('the hook names a missing job / estimate on a Build failure', /copilotPrecondition\(cap\.id, ctx\.project\)/.test(hook) && /pre\.ok \? 'apply_failed' : pre\.kind/.test(hook));

console.log('\n#118 — the hub says what failed and carries the text:');
const route = (errorKind?: string, error?: string, n = 0) => hubOutcome({ actions: Array.from({ length: n }, (_, i) => ({ capabilityId: 'rfi' as const, text: `t${i}`, label: 'x' })), errorKind, error });
ok('network → "No signal", never "Not sure"', (() => { const o = route('network'); return o.kind === 'failed' && o.message === NO_SIGNAL_COPY; })());
ok('timeout → "No signal"', (() => { const o = route('timeout'); return o.kind === 'failed' && o.message === NO_SIGNAL_COPY; })());
ok('monthly_cap → the server’s cap sentence', (() => { const o = route('monthly_cap', 'Monthly AI limit reached (150/mo on free). Resets the 1st of next month.'); return o.kind === 'failed' && /150\/mo/.test(o.message); })());
ok('unauthenticated → "Session expired — sign in again."', (() => { const o = route('unauthenticated'); return o.kind === 'failed' && o.message === SESSION_EXPIRED_COPY; })());
ok('"Not sure" only for a call that worked and matched nothing', route().kind === 'no_match' && NO_MATCH_COPY.startsWith('Not sure'));
ok('one action routes, several queue', route(undefined, undefined, 1).kind === 'route' && route(undefined, undefined, 3).kind === 'queue');
ok('Ask MAGE only after a successful no-match', showAskMage(route(), true) && !showAskMage(route('network'), true) && !showAskMage(route(), false));
ok('tiles carry the typed text (trimmed) as the seed', tileSeed('  framed the third floor ') === 'framed the third floor' && tileSeed('   ') === undefined);
const split = src('utils/copilot/splitIntents.ts');
ok('splitIntents never returns a bare [] for a failed call', /if \(!res\.success\) return \{ actions: \[\], errorKind:/.test(split) && !/if \(!res\.success\) return \[\];/.test(split));
const hub = src('app/copilot-hub.tsx');
ok('the hub branches on hubOutcome and seeds every grid tile', /hubOutcome\(res(?:, utterance)?\)/.test(hub) && /open\(i\.id, tileSeed\(text\)\)/.test(hub) && !/onPress=\{\(\) => open\(i\.id\)\}/.test(hub));
ok('the hub shows the failure message and gates Ask MAGE', /outcome\.message/.test(hub) && /showAskMage\(outcome, isQuestionShaped\(text\)\)/.test(hub));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
