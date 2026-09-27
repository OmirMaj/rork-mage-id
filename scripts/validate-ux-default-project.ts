// validate-ux-default-project — which job a WRITE may default to (UX wave, Lane 0).
//
// WHAT IT PROVES. pickDefaultProjectId (utils/defaultProjectId.ts) is the
// default for payroll hours, voice notes and daily logs, so a wrong answer is
// a wrong legal record. It must: take the route's job, then a REAL stored
// pick, then the most recent job, then return null — never the resolver's
// "most recently updated in-progress job" guess, never projects[0], and never
// a closed, sample or completed job.
//
// Run: bun run scripts/validate-ux-default-project.ts
// Pure node:fs + the pure modules; no react-native import (those crash bun).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  pickDefaultProjectId, explainDefaultProjectId, isDefaultableJob, PICK_JOB_FIRST,
} from '../utils/defaultProjectId';
import { resolveActiveProjectId, visibleRecent } from '../utils/activeProject';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}
function eq<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `expected ${e}, got ${a}`);
}

type Status = 'draft' | 'estimated' | 'in_progress' | 'completed' | 'closed';
const job = (id: string, status: Status, updatedAt: string, name = `Job ${id}`) => ({ id, name, status, updatedAt });

const HEN = job('hen', 'in_progress', '2026-09-01T00:00:00Z', 'Henderson Residence');
const SMITH = job('smi', 'in_progress', '2026-09-20T00:00:00Z', 'Smith Kitchen');
const LEAD = job('lead', 'estimated', '2026-09-25T00:00:00Z', 'Chan Addition');
const DONE = job('done', 'completed', '2026-09-26T00:00:00Z', 'Okafor Duplex');
const CLOSED = job('x', 'closed', '2026-09-26T00:00:00Z', 'Old Warehouse');
const SAMPLE = job('s', 'in_progress', '2026-09-27T00:00:00Z', 'Sample — Kitchen Remodel');
const ALL = [HEN, SMITH, LEAD, DONE, CLOSED, SAMPLE];

console.log('\nux default-project validation:');

console.log('\n1. eligibility');
ok('an in-progress job is defaultable', isDefaultableJob(HEN));
ok('an estimated job is defaultable (a lead being priced)', isDefaultableJob(LEAD));
ok('a COMPLETED job is not (isEligibleJob lets it through; this does not)', !isDefaultableJob(DONE));
ok('a closed job is not', !isDefaultableJob(CLOSED));
ok('a sample job is not', !isDefaultableJob(SAMPLE));

console.log('\n2. the order: route, real pick, recent, null');
eq('the route wins over everything', pickDefaultProjectId({ routeProjectId: 'smi', activeProjectId: 'hen', recentProjectIds: ['hen'], projects: ALL }), 'smi');
eq('…and says so', explainDefaultProjectId({ routeProjectId: 'smi', projects: ALL }).source, 'route');
eq('a real pick (it is on the recent list) comes next', pickDefaultProjectId({ activeProjectId: 'smi', recentProjectIds: ['hen', 'smi'], projects: ALL }), 'smi');
eq('…source active', explainDefaultProjectId({ activeProjectId: 'smi', recentProjectIds: ['hen', 'smi'], projects: ALL }).source, 'active');
eq('then the most recent defaultable job', pickDefaultProjectId({ recentProjectIds: ['done', 'x', 'lead', 'hen'], projects: ALL }), 'lead');
eq('…source recent', explainDefaultProjectId({ recentProjectIds: ['hen'], projects: ALL }).source, 'recent');
eq('nothing known → null, with no source', explainDefaultProjectId({ projects: ALL }), { id: null, source: null });

console.log('\n3. never a guess');
{
  // The resolver's 4th step: no route, no stored pick, no recent → the most
  // recently updated in-progress job. The context hands that to callers as
  // activeProjectId. It must NOT become a default.
  const guess = resolveActiveProjectId({ urlProjectId: null, storedId: null, recentIds: [], projects: ALL });
  ok('(precondition) the resolver does guess here', guess === 'smi', String(guess));
  eq('the guess is refused: null', pickDefaultProjectId({ activeProjectId: guess, recentProjectIds: visibleRecent([], ALL), projects: ALL }), null);
}
eq('never projects[0] — a full list with nothing picked is still null', pickDefaultProjectId({ projects: [HEN, SMITH] }), null);
eq('an active id missing from the recent list is treated as the guess', pickDefaultProjectId({ activeProjectId: 'hen', recentProjectIds: [], projects: ALL }), null);

console.log('\n4. every step skips what is not defaultable');
eq('a route naming a completed job falls through to the recent job', pickDefaultProjectId({ routeProjectId: 'done', recentProjectIds: ['hen'], projects: ALL }), 'hen');
eq('a route naming a closed job falls through', pickDefaultProjectId({ routeProjectId: 'x', projects: ALL }), null);
eq('a route naming a sample job falls through', pickDefaultProjectId({ routeProjectId: 's', recentProjectIds: ['smi'], projects: ALL }), 'smi');
eq('a route naming a deleted / foreign job falls through', pickDefaultProjectId({ routeProjectId: 'gone', recentProjectIds: ['smi'], projects: ALL }), 'smi');
eq('a completed active pick falls through to the next recent', pickDefaultProjectId({ activeProjectId: 'done', recentProjectIds: ['done', 'hen'], projects: ALL }), 'hen');
eq('blank strings are ignored', pickDefaultProjectId({ routeProjectId: '', activeProjectId: '', recentProjectIds: ['', 'hen'], projects: ALL }), 'hen');
eq('null inputs are tolerated', pickDefaultProjectId({ routeProjectId: null, activeProjectId: null, recentProjectIds: null, projects: [] }), null);

console.log('\n5. source pins');
{
  const src = read('utils/defaultProjectId.ts');
  ok('builds on isEligibleJob from utils/activeProject (no second eligibility rule)', /import \{ isEligibleJob \} from '@\/utils\/activeProject';/.test(src));
  ok('has no updatedAt ordering (the in-progress guess cannot creep back)', !/updatedAt\)|Date\.parse|updatedMs/.test(src.replace(/\/\/.*$/gm, '')));
  ok('never indexes projects[0]', !/projects\[0\]/.test(src.replace(/\/\/.*$/gm, '')));
  ok('the blocked-button line is the plan\'s wording', PICK_JOB_FIRST === 'Pick the project first');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('ALL PASS');
