// scripts/validate-onemind-scope.ts — pure-fn validator for utils/oneMind/resolveScope.ts
//
// The One Mind question router: project-scoped vs business-wide, resolved
// deterministically (NO AI) by normalized token match of project names against
// the question. Longest match wins; two genuinely different projects → business
// (cross-project questions are answered from business-wide blocks).
import { resolveScope, isQuestionShaped, applyAnchorScope } from '../utils/oneMind/resolveScope';
import { assembleFactBlocks, buildMarginRollupBlock, type OneMindBundle } from '../utils/oneMind/factBlocks';
import { resolveStarters, anchorProjectIdFor } from '../utils/resolveStarters';
import type { Project } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}

const projects = [
  { id: 'p1', name: 'Henderson Remodel' },
  { id: 'p2', name: 'Lakewood Residence' },
  { id: 'p3', name: 'Kitchen Remodel' },
  { id: 'p4', name: 'Henderson Addition' },
];

// ─── Business scope (no project named) ──────────────────────────────────────

{
  const s = resolveScope("What's overdue right now?", projects);
  ok('generic money question → business', s.scope === 'business');
}
{
  const s = resolveScope('How much money is unpaid across all jobs?', projects);
  ok('cross-job question → business', s.scope === 'business');
}
{
  const s = resolveScope('', projects);
  ok('empty question → business', s.scope === 'business');
}
{
  const s = resolveScope('Which leads should I follow up on?', []);
  ok('no projects at all → business', s.scope === 'business');
}

// ─── Project scope (distinctive token) ───────────────────────────────────────

{
  const s = resolveScope('How is Lakewood doing?', projects);
  ok('distinctive token → project', s.scope === 'project' && s.projectId === 'p2');
}
{
  const s = resolveScope('is the lakewood residence over budget', projects);
  ok('full name, lowercase → project', s.scope === 'project' && s.projectId === 'p2');
}
{
  const s = resolveScope('LAKEWOOD margin???', projects);
  ok('caps + punctuation normalized', s.scope === 'project' && s.projectId === 'p2');
}

// ─── Generic-word narrowness (entityResolver narrowness) ────────────────────

{
  // "remodel" appears in two project names AND is a generic construction word —
  // it alone must never resolve to a project.
  const s = resolveScope('should I take on another remodel', projects);
  ok('shared generic token alone → business', s.scope === 'business');
}
{
  // CORRECTED (tribunal): an ALL-generic name must never hijack a question —
  // "kitchen remodel" in a sentence is a job type, not necessarily the job
  // named "Kitchen Remodel". Ambiguity resolves DOWN to business (rule 5).
  const s = resolveScope('how is the kitchen remodel going', projects);
  ok('all-generic full-name match → business (never hijacks)', s.scope === 'business');
}
{
  // A lone generic word from an all-generic name must not match.
  const s = resolveScope('what should I do about the kitchen cabinets', projects);
  ok('partial all-generic name → business', s.scope === 'business');
}
{
  // THE tribunal failure case: a 1-token generic project name must not
  // capture a portfolio-level question containing that ordinary word.
  const withGarage = [...projects, { id: 'g1', name: 'Garage' }];
  const s = resolveScope('should I take on more garage jobs next year?', withGarage);
  ok('1-token generic name (Garage) → business', s.scope === 'business');
  const s2 = resolveScope('how is the garage going', withGarage);
  ok('generic name unreachable even by exact name → business', s2.scope === 'business');
}
{
  // Expanded stoplist: "patio" must not distinctively match "Patio Cover".
  const withPatio = [...projects, { id: 'pc', name: 'Patio Cover' }];
  const s = resolveScope('what patio jobs are most profitable?', withPatio);
  ok('expanded generic token (patio) → business', s.scope === 'business');
}
{
  // Mixed name: the non-generic token keeps the project reachable.
  const withMahal = [...projects, { id: 'gm', name: 'Garage Mahal' }];
  const s = resolveScope('how is the garage mahal doing', withMahal);
  ok('generic + distinctive name still resolves', s.scope === 'project' && s.projectId === 'gm');
}

// ─── Longest match wins ──────────────────────────────────────────────────────

{
  // "henderson" is shared by p1 and p4 → not distinctive on its own, and no
  // full-name match → stays business (honest: we don't know which Henderson).
  const s = resolveScope('how is henderson doing', projects);
  ok('ambiguous shared name token → business', s.scope === 'business');
}
{
  const s = resolveScope('henderson addition timeline?', projects);
  ok('longest full-name match wins', s.scope === 'project' && s.projectId === 'p4');
}
{
  const s = resolveScope('is the henderson remodel making money', projects);
  ok('other henderson full-name resolves', s.scope === 'project' && s.projectId === 'p1');
}
{
  // Unambiguous when only one Henderson exists.
  const one = [{ id: 'p1', name: 'Henderson Remodel' }, { id: 'p2', name: 'Lakewood Residence' }];
  const s = resolveScope('how is henderson doing', one);
  ok('unique name token → that project', s.scope === 'project' && s.projectId === 'p1');
}

// ─── Two different projects → business ───────────────────────────────────────

{
  const s = resolveScope('compare henderson remodel and lakewood', projects);
  ok('two projects named → business', s.scope === 'business');
}
{
  // matchedProjectIds carries both project IDs when exactly two disjoint
  // candidates are found — feeds cross-project mini-blocks in assembleFactBlocks.
  const s = resolveScope('compare henderson remodel and lakewood', projects);
  ok('cross-project matchedProjectIds includes both ids',
    s.scope === 'business' &&
    Array.isArray(s.matchedProjectIds) &&
    s.matchedProjectIds.includes('p1') &&
    s.matchedProjectIds.includes('p2'),
  );
}
{
  // Single-project business (no name in question) → matchedProjectIds absent/empty.
  const s = resolveScope("what's overdue right now?", projects);
  ok('generic question → no matchedProjectIds', s.scope === 'business' && !s.matchedProjectIds?.length);
}
{
  // CORRECTED (tribunal): disjointness is checked against EVERY candidate,
  // not just the top two. Both Hendersons outrank Lakewood and overlap each
  // other — top-two-only checking silently resolved to one Henderson.
  const s = resolveScope('compare henderson remodel and henderson addition and lakewood', projects);
  ok('three projects named (top two overlap) → business', s.scope === 'business');
}

// ─── isQuestionShaped (copilot-hub handoff) ──────────────────────────────────

ok('what → question', isQuestionShaped('what is my margin'));
ok('how → question', isQuestionShaped('How much is unpaid'));
ok('is → question', isQuestionShaped('is Henderson slipping'));
ok('which → question', isQuestionShaped('which job is over budget'));
ok('trailing ? → question', isQuestionShaped('henderson margin?'));
ok('command → not question', !isQuestionShaped('log a daily report for Henderson'));
ok('CO utterance → not question', !isQuestionShaped('owner wants a heat pump'));
ok('empty → not question', !isQuestionShaped(''));
ok('whatever → not question (word boundary)', !isQuestionShaped('whatever happens log it'));

// ─── Anchored conversations (audit #36) ─────────────────────────────────────
//
// Opened from Henderson's page, the FAB forwards Henderson as the anchor. A
// question naming no project is about the anchor; one naming a project (or
// comparing two) keeps its own scope; one that says "all jobs" stays business.

const anchored = (q: string, anchor: string | null = 'p1') =>
  applyAnchorScope(resolveScope(q, projects), q, anchor, projects);
{
  const s = anchored('Is this project over budget?');
  ok('anchor + "Is this project over budget?" → project scope of the anchor',
    s.scope === 'project' && s.projectId === 'p1');
}
{
  const s = anchored('Which invoices here are still unpaid?');
  ok('anchor + "invoices here" → the anchor, not every job', s.scope === 'project' && s.projectId === 'p1');
}
{
  const s = anchored('How much is unpaid across all jobs?');
  ok('anchor + "across all jobs" → business', s.scope === 'business');
}
{
  const s = anchored('Which project is over budget?');
  ok('anchor + "which project" (a ranking) → business', s.scope === 'business');
}
{
  const s = anchored('How is Lakewood doing?');
  ok('anchor + a NAMED other project → that project wins', s.scope === 'project' && s.projectId === 'p2');
}
{
  const s = anchored('compare henderson remodel and lakewood');
  ok('anchor + cross-project compare → business compare', s.scope === 'business' && (s.matchedProjectIds?.length ?? 0) >= 2);
}
// Bare "overall" / "company" / "business" are about the anchored job, not the
// business (review round 1): only an explicit all-jobs phrase drops the anchor.
{
  const s = anchored('Is this job over budget overall?');
  ok('anchor + "overall" stays on the job', s.scope === 'project' && s.projectId === 'p1');
}
{
  const s = anchored('Who is the company on the electrical?');
  ok('anchor + "the company on the electrical" stays on the job', s.scope === 'project' && s.projectId === 'p1');
}
{
  const s = anchored('Which company is doing the electrical here?');
  ok('anchor + "which company" stays on the job', s.scope === 'project' && s.projectId === 'p1');
}
{
  const s = anchored('How is my business doing this month?');
  ok('anchor + "my business" → business', s.scope === 'business');
}
{
  const s = anchored('Is the whole business profitable?');
  ok('anchor + "the whole business" → business', s.scope === 'business');
}
{
  const s = anchored('Is this project over budget?', null);
  ok('no anchor → unchanged (business)', s.scope === 'business');
}
{
  const s = anchored('Is this project over budget?', 'not-my-project');
  ok('an anchor that is not one of his projects anchors nothing', s.scope === 'business');
}

// The FAB forwards the job only from the job screens, by the right param.
ok('project-detail forwards its `id`', anchorProjectIdFor('project-detail', { id: 'p1' }) === 'p1');
ok('schedule-pro forwards `projectId`', anchorProjectIdFor('schedule-pro', { projectId: 'p1' }) === 'p1');
// The Schedule TAB's `projectId` is a sticky entry nonce, not the job on screen
// (the picker switches jobs without touching the URL) — it must not anchor.
ok('schedule tab does NOT forward its sticky `projectId`', anchorProjectIdFor('schedule', { projectId: 'p1' }) === undefined);
ok('schedule tab keeps the business-wide starters even with a name', resolveStarters('schedule', 'Henderson Remodel').every(x => !x.q.includes('Henderson Remodel')));
ok('a bare `id` on another screen is NOT a project', anchorProjectIdFor('invoice', { id: 'inv-9' }) === undefined);
ok('project-detail ignores a stray `projectId`', anchorProjectIdFor('project-detail', { projectId: 'x' }) === undefined);

// Starters name the job instead of "this"/"here"; without an anchor a job
// screen falls back to the business-wide set.
{
  const named = resolveStarters('project-detail', 'Henderson Remodel').map(x => x.q);
  ok('project starters name the job', named.every(q => q.includes('Henderson Remodel')));
  ok('project starters never say "this"/"here"', named.every(q => !/\b(this|here)\b/i.test(q)));
  const sched = resolveStarters('schedule-pro', 'Henderson Remodel').map(x => x.q);
  ok('schedule starters name the job', sched.every(q => q.includes('Henderson Remodel')));
  const bare = resolveStarters('project-detail').map(x => x.q);
  ok('no anchor → no "this"/"here" starter', bare.every(q => !/\b(this|here)\b/i.test(q)));
}

// ─── The facts behind those scopes ─────────────────────────────────────────

function mkProject(over: Partial<Project>): Project {
  return {
    id: 'p1', name: 'Henderson Remodel', type: 'renovation', location: '12 Main St',
    squareFootage: 2400, quality: 'standard', description: '',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    estimate: null, status: 'in_progress', ...over,
  } as Project;
}
const est = (id: string, base: number, grand: number) => ({
  id, name: 'Est', items: [], baseTotal: base, grandTotal: grand, markupPct: 20,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
}) as never;
function mkBundle(over: Partial<OneMindBundle>): OneMindBundle {
  return {
    projects: [], commitments: [], changeOrders: [], invoices: [], rfis: [], leads: [],
    dailyReports: [], permits: [], submittals: [], punchItems: [], expiringCertifications: [],
    bidResponses: [], ...over,
  } as OneMindBundle;
}
const henderson = mkProject({ id: 'p1', name: 'Henderson Remodel', linkedEstimate: est('e1', 80_000, 100_000) });
const lakewood = mkProject({ id: 'p2', name: 'Lakewood Residence', linkedEstimate: est('e2', 60_000, 80_000) });
const kitchen = mkProject({ id: 'p3', name: 'Kitchen Remodel' }); // no linked estimate → no basis
const closed = mkProject({ id: 'p9', name: 'Old Barn', status: 'closed', linkedEstimate: est('e9', 10_000, 20_000) });
// A signed sub on Lakewood well over its $60K cost basis → margin eroded.
const overrun = { id: 'c1', projectId: 'p2', amount: 75_000, status: 'signed', type: 'subcontract' } as never;
const bundle = mkBundle({ projects: [henderson, lakewood, kitchen, closed], commitments: [overrun] });

await (async () => {
  const q = 'Is this project over budget?';
  const scope = applyAnchorScope(resolveScope(q, bundle.projects), q, 'p1', bundle.projects);
  const blocks = await assembleFactBlocks(scope, q, bundle);
  const margin = blocks.find(b => b.ref === 'MARGIN');
  ok('anchored "Is this project over budget?" assembles the MARGIN block', !!margin);
  ok('…for the anchored job', margin?.drillIn?.params?.projectId === 'p1');

  const biz = await assembleFactBlocks({ scope: 'business' }, 'Which project is over budget?', bundle);
  const rollup = biz.find(b => b.ref === 'MARGINS');
  ok('business scope assembles a per-job MARGINS roll-up', !!rollup, biz.map(b => b.ref).join(','));
  const facts = rollup?.facts ?? [];
  ok('roll-up lists the worst job first (Lakewood, eroded)',
    facts.findIndex(f => f.startsWith('Lakewood Residence:')) >= 0
      && facts.findIndex(f => f.startsWith('Lakewood Residence:')) < facts.findIndex(f => f.startsWith('Henderson Remodel:')),
    facts.join(' | '));
  ok('eroded job says how far below bid', facts.some(f => f.startsWith('Lakewood Residence:') && /down .* from bid/.test(f)));
  ok('no-basis job gets the honesty line, never a number',
    facts.some(f => /No margin basis for 1 active job\(s\) \(Kitchen Remodel\)/.test(f))
      && !facts.some(f => f.startsWith('Kitchen Remodel:')));
  ok('closed jobs are left out', !facts.some(f => f.includes('Old Barn')));
  ok('subs-only basis is stated inline on every job line',
    facts.filter(f => /: projected margin/.test(f)).every(f => f.includes('subs only')));
  ok('roll-up drills into /portfolio-margin', rollup?.drillIn?.pathname === '/portfolio-margin');

  // Limit: seven eroded jobs → five named, the rest counted, not dropped.
  const many = Array.from({ length: 7 }, (_, i) => mkProject({
    id: `m${i}`, name: `Job ${i}`, linkedEstimate: est(`em${i}`, 50_000, 60_000),
  }));
  const manyCommit = many.map((p, i) => ({ id: `mc${i}`, projectId: p.id, amount: 55_000 + i * 1_000, status: 'signed', type: 'subcontract' })) as never[];
  const b7 = buildMarginRollupBlock(mkBundle({ projects: many, commitments: manyCommit }));
  const lines = (b7?.facts ?? []).filter(f => /^Job \d: projected margin/.test(f));
  ok('names at most five jobs', lines.length === 5, String(lines.length));
  ok('counts the rest', (b7?.facts ?? []).some(f => /^2 more job\(s\)/.test(f)));
  ok('worst (largest overrun) first', lines[0]?.startsWith('Job 6:'), lines[0]);
  ok('nothing active → no block', buildMarginRollupBlock(mkBundle({ projects: [closed] })) === null);
})();

// ─── Footer ──────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
