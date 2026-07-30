// validate-collaborator-invite.ts — pins the project-role derivation and the
// Pro tier gate for Live Schedule Collaboration Phase 1.
// Run via: bun run scripts/validate-collaborator-invite.ts
import { roleForUser } from '../utils/projectRole';
import { REQUIRED_TIER } from '../utils/featureTiers';
import type { ProjectCollaborator } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}

const mk = (o: Partial<ProjectCollaborator>): ProjectCollaborator => ({
  id: 'x', email: 'x@x', name: '', role: 'editor', status: 'accepted', invitedAt: '', userId: null, ...o,
});

console.log('\nproject role derivation:');
expect('accepted editor → editor', roleForUser([mk({ role: 'editor', status: 'accepted', userId: 'u1' })], 'u1'), 'editor');
expect('accepted viewer → viewer', roleForUser([mk({ role: 'viewer', status: 'accepted', userId: 'u2' })], 'u2'), 'viewer');
expect('no collaborator rows → owner', roleForUser([], 'owner'), 'owner');
expect('has collaborators but not me → owner', roleForUser([mk({ userId: 'other', status: 'accepted' })], 'owner'), 'owner');
expect('pending row not counted → owner', roleForUser([mk({ role: 'viewer', status: 'pending', userId: 'u3' })], 'u3'), 'owner');
expect('revoked row not counted → owner', roleForUser([mk({ role: 'editor', status: 'revoked', userId: 'u4' })], 'u4'), 'owner');
expect('no uid → null', roleForUser([], null), null);

console.log('\ntier gate:');
expect('schedule_collaboration gates to pro', REQUIRED_TIER['schedule_collaboration'], 'pro');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
