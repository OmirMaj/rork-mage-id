// validate-collaborator-role-picker.ts — the roster can set every role, asks
// before it lifts financial blinding, and never locks an active member out.
//
// WHY (audit round 2 #27). Each roster row carried one chip,
// `role === 'editor' ? 'viewer' : 'editor'`. On a Field row that read "Make
// editor": one tap, no dialog, and the foreman saw the estimate, markup and
// contract terms. Nothing could set Field on an existing row, so the only way
// back was re-inviting him — and project-invite's 'invite' upserted the row to
// status 'pending' with a fresh token. Every RLS gate requires 'accepted', so
// the fix locked a working super out of the whole project. Same lockout when a
// GC re-sent an invite because "I can't find the link".
//
// What this pins:
//   1. the one-way toggle is gone and every row offers editor / viewer / field;
//   2. the confirm condition, lifted verbatim from the component and run for
//      every (from, to) pair against the real isFinancialsBlinded: it fires
//      exactly when a move lifts blinding (field → editor / viewer);
//   3. the invite form refuses an email already active on the job;
//   4. project-invite 'invite' checks for an accepted row BEFORE the seat check
//      and BEFORE the upsert, and returns code 'already_member' with a 2xx (a
//      non-2xx body never reaches the screen through functions.invoke).
//
// Run via: bun run scripts/validate-collaborator-role-picker.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFinancialsBlinded } from '../utils/roleBlinding';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const ui = strip(readFileSync(join(ROOT, 'components', 'collaborators', 'CollaboratorsManager.tsx'), 'utf8'));
const fn = strip(readFileSync(join(ROOT, 'supabase', 'functions', 'project-invite', 'index.ts'), 'utf8'));

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

console.log('\nroster role picker (#27):');
ok('the one-way editor/viewer toggle is gone',
  !/c\.role === 'editor' \? 'viewer' : 'editor'/.test(ui) && !/Make viewer' : 'Make editor'/.test(ui));
ok('every row maps editor / viewer / field into requestRoleChange',
  /\(\['editor', 'viewer', 'field'\] as const\)\.map\(\(r\) => \{[\s\S]{0,400}requestRoleChange\(c, r\)/.test(ui));
ok('no role change is fired straight from a row tap (only through requestRoleChange)',
  !/onPress=\{\(\) => changeRole\.mutate/.test(ui));

const body = ui.slice(ui.indexOf('const requestRoleChange = useCallback'), ui.indexOf('const copyLink = useCallback'));
const cond = body.match(/if \((isFinancialsBlinded\(c\.role\) && !isFinancialsBlinded\(next\))\) \{\s*showAlert\(/);
ok('the lifting-blinding confirm was located (showAlert under the condition)', !!cond);
ok('…and the change only runs from the dialog\'s confirm button in that branch',
  /isFinancialsBlinded\(next\)\) \{\s*showAlert\([\s\S]*?\{ text: `Make \$\{label\}`, onPress: run \}[\s\S]*?\);\s*return;\s*\}/.test(body));
if (cond) {
  const gate = new Function('isFinancialsBlinded', 'c', 'next', `return !!(${cond[1]});`) as
    (f: typeof isFinancialsBlinded, c: { role: string }, next: string) => boolean;
  const roles = ['editor', 'viewer', 'field'] as const;
  for (const from of roles) for (const to of roles) {
    if (from === to) continue;
    const want = from === 'field';
    ok(`${from} → ${to}: ${want ? 'asks first (shows money)' : 'no dialog'}`,
      gate(isFinancialsBlinded, { role: from }, to) === want);
  }
}
ok('the dialog names what they will see', /see costs, margins, the estimate and contract terms/.test(body));

const onInvite = ui.slice(ui.indexOf('const onInvite = useCallback'), ui.indexOf('const requestRoleChange'));
ok('the invite form refuses an email already active on this job, before sending',
  /collaborators\.find\(\(c\) => c\.status === 'accepted' && c\.email\.trim\(\)\.toLowerCase\(\) === typed\)[\s\S]{0,600}return;/.test(onInvite)
  && onInvite.indexOf("c.status === 'accepted'") < onInvite.indexOf('invite.mutate('));

console.log('\nproject-invite never re-pends an active member (#27):');
const inv = fn.slice(fn.indexOf('if (action === "invite")'), fn.indexOf('if (action === "accept")'));
const lookAt = inv.search(/project_collaborators\?project_id=eq\.[^`]*invited_email=eq\./);
const memberAt = inv.search(/if \(existing\?\.status === "accepted"\) \{\s*return json\(/);
const seatAt = inv.indexOf('seatCheck(');
const upsertAt = inv.indexOf('on_conflict=project_id,invited_email');
ok('the existing row is looked up by (project, email)', lookAt !== -1);
ok('an accepted row returns before the seat check and before the upsert',
  memberAt !== -1 && memberAt < seatAt && memberAt < upsertAt, `member ${memberAt} seat ${seatAt} upsert ${upsertAt}`);
const branch = inv.slice(memberAt, inv.indexOf('}', inv.indexOf('return json(', memberAt) + 1) + 200);
ok("…with code 'already_member' and no error status (functions.invoke drops a non-2xx body)",
  /code: "already_member"/.test(branch) && !/\}\s*,\s*4\d\d\)/.test(branch.slice(0, branch.indexOf('});') + 3)));
ok('changeRole still accepts field (the backend half of the picker)', /ROLES = new Set\(\["owner", "editor", "viewer", "field"\]\)/.test(fn));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
