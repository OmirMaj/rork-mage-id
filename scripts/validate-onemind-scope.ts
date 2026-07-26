// scripts/validate-onemind-scope.ts — pure-fn validator for utils/oneMind/resolveScope.ts
//
// The One Mind question router: project-scoped vs business-wide, resolved
// deterministically (NO AI) by normalized token match of project names against
// the question. Longest match wins; two genuinely different projects → business
// (cross-project questions are answered from business-wide blocks).
import { resolveScope, isQuestionShaped } from '../utils/oneMind/resolveScope';

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

// ─── Footer ──────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
