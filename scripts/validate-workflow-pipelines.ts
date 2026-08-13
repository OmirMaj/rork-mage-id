// validate-workflow-pipelines.ts — pins the workflow lifecycle model.
//
// docs/workflow-audit-roadmap.md proposed stage sequences WITHOUT checking the
// unions in types/index.ts, and four of eight were wrong — it invented
// 'walk_scheduled'/'walked' for warranties, flattened the permit inspection
// cycle into the application path, treated the selections budget flag
// 'exceeded' as a stage, and proposed a bid-response lifecycle that does not
// exist in the codebase at all. The exhaustiveness check added in a later task
// is what makes that class of mistake impossible to repeat.
//
// Run: bun run scripts/validate-workflow-pipelines.ts
import {
  stagesFor, advanceTargetFor, isSideBranch, sideBranchesFor, visualStageFor,
  WORKFLOW_KINDS,
} from '../utils/workflowPipelines';
// fileURLToPath + join because the repo path contains a space.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log('  ✓', name); }
  else {
    fail++;
    console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want));
  }
}

console.log('\nstructure — every kind:');
for (const kind of WORKFLOW_KINDS) {
  const stages = stagesFor(kind);
  ok(`${kind}: has stages`, stages.length > 0);
  ok(`${kind}: exactly one terminal stage, and it is last`,
    stages.filter(s => s.terminal).length === 1 && !!stages[stages.length - 1].terminal);
  ok(`${kind}: every stage key is unique`,
    new Set(stages.map(s => s.key)).size === stages.length);
  ok(`${kind}: advancing the terminal stage goes nowhere`,
    advanceTargetFor(kind, stages[stages.length - 1].key) === null);
  ok(`${kind}: each non-terminal stage advances to its immediate successor`,
    stages.slice(0, -1).every((s, i) => advanceTargetFor(kind, s.key) === stages[i + 1].key));
  ok(`${kind}: no stage is also a side branch`,
    stages.every(s => !isSideBranch(kind, s.key)));
  ok(`${kind}: an unknown status advances nowhere`,
    advanceTargetFor(kind, 'not_a_real_status') === null);
}

console.log('\nside branches never advance:');
expect('a voided lien waiver has no next step', advanceTargetFor('lienWaiver', 'voided'), null);
expect('a denied permit has no next step', advanceTargetFor('permit', 'denied'), null);
expect('a rejected prequal has no next step', advanceTargetFor('prequal', 'rejected'), null);
expect('a prequal needing changes has no next step', advanceTargetFor('prequal', 'needs_changes'), null);
expect('an expired prequal has no next step', advanceTargetFor('prequal', 'expired'), null);
expect('an over-budget selection has no next step', advanceTargetFor('selection', 'exceeded'), null);
expect('a cancelled bid package has no next step', advanceTargetFor('bidPackage', 'cancelled'), null);

// sideBranchesFor is what a later task's exhaustiveness guard reads to prove
// every status in types/index.ts is accounted for, so pin its exact output —
// otherwise a stage quietly demoted to a side branch changes that guard's
// meaning without failing anything here.
console.log('\nthe side-branch sets themselves:');
expect('punch has none', sideBranchesFor('punch'), []);
expect('oac has none', sideBranchesFor('oac'), []);
expect('permit', sideBranchesFor('permit'), ['denied', 'expired']);
expect('permitInspection', sideBranchesFor('permitInspection'), ['inspection_failed']);
expect('lienWaiver', sideBranchesFor('lienWaiver'), ['voided']);
expect('prequal', sideBranchesFor('prequal'), ['needs_changes', 'rejected', 'expired']);
expect('selection', sideBranchesFor('selection'), ['exceeded']);
expect('bidPackage', sideBranchesFor('bidPackage'), ['cancelled']);

console.log('\nvisual anchoring:');
expect('a normal status anchors to itself', visualStageFor('permit', 'under_review'), 'under_review');
expect('a side branch anchors to the first stage so the breadcrumb still renders',
  visualStageFor('permit', 'denied'), 'applied');
expect('a failed inspection anchors back to scheduled, the loop it repeats',
  visualStageFor('permitInspection', 'inspection_failed'), 'inspection_scheduled');

// PURITY. This module exists so bun can run the lifecycle logic at all; the
// moment someone imports a hook "just for a lookup" it stops being runnable
// here and every check above becomes unreachable — silently, because the
// validator would fail to load rather than fail a case. Pin it at the source.
console.log('\npurity:');
const core = src('utils/workflowPipelines.ts');
ok('workflowPipelines imports nothing at all', !/^\s*import\b/m.test(core),
  'the module must stay import-free so bun can execute it');
ok('workflowPipelines has no require() or dynamic import either',
  !/\brequire\s*\(|\bimport\s*\(/.test(core));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
