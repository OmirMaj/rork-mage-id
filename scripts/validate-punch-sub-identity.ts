// scripts/validate-punch-sub-identity.ts — a punch item's sub name and sub id
// must move together, and a stale id must never decide whose item it is.
//
// WHAT WENT WRONG (audit round 2, #25). Bulk assign wrote `assignedSubId`; the
// single-item edit sheet's sub chips wrote only `assignedSub` (the name), and a
// bulk assign to a typed trade name left the old id in place. So an item
// bulk-assigned to ABC Electric and then moved to Rivera Drywall read
// "Sub: Rivera Drywall" on the GC's screen while still carrying ABC's id:
//   • utils/subPortalSnapshot put it on BOTH subs' portals (id OR name match);
//   • app/punch-list's portal shortcut preferred the id and opened ABC's
//     sub-portal setup for "Hand Rivera Drywall their 20 items".
//
// Run via: bun run scripts/validate-punch-sub-identity.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { punchItemBelongsToSub, resolvePunchSub, buildSubPortalSnapshot, punchItemsFollowingSubRename, ownsProjectFor } from '../utils/subPortalSnapshot';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

const ABC = { id: 'sub-abc', companyName: 'ABC Electric' };
const RIVERA = { id: 'sub-riv', companyName: 'Rivera Drywall' };
const RIVERA2 = { id: 'sub-riv-2', companyName: 'rivera drywall ' };
const subs = [ABC, RIVERA, RIVERA2];

console.log('which sub a punch item belongs to (the portal snapshot):');
const stale = { assignedSub: 'Rivera Drywall', assignedSubId: ABC.id };
check('a reassigned row with ABC\'s leftover id is NOT on ABC\'s portal', !punchItemBelongsToSub(stale, ABC));
check('...and IS on Rivera\'s (the name the GC sees)', punchItemBelongsToSub(stale, RIVERA));
check('a consistent row is on its sub\'s portal', punchItemBelongsToSub({ assignedSub: 'ABC Electric', assignedSubId: ABC.id }, ABC));
check('an id-only row (no name) still belongs to that sub', punchItemBelongsToSub({ assignedSub: '', assignedSubId: ABC.id }, ABC));
check('a legacy name-only row matches by name, case-insensitively', punchItemBelongsToSub({ assignedSub: ' abc electric' }, ABC));
check('an unassigned row belongs to nobody', !punchItemBelongsToSub({ assignedSub: '' }, ABC));

{
  const snap = buildSubPortalSnapshot({
    link: { id: 'l1' } as never, project: { id: 'p1', name: 'Job' } as never, sub: ABC as never, commitments: [],
    punchItems: [
      { id: 'moved', projectId: 'p1', description: 'Patch drywall', status: 'open', priority: 'medium', ...stale },
      { id: 'mine', projectId: 'p1', description: 'Trim out panel', status: 'open', priority: 'medium', assignedSub: 'ABC Electric', assignedSubId: ABC.id },
    ] as never,
  } as never) as { punchItems?: { id: string }[] };
  check('ABC\'s published snapshot lists only ABC\'s item', (snap.punchItems ?? []).map(p => p.id).join(',') === 'mine',
    (snap.punchItems ?? []).map(p => p.id).join(','));
}

console.log('\nwhich sub record the portal shortcut / edit sheet resolves:');
check('20 Rivera items with one stale ABC id resolve to Rivera, not ABC',
  resolvePunchSub('Rivera Drywall', [...Array(19).fill(undefined), ABC.id], subs)?.id === RIVERA.id);
check('two records sharing a name: the id on the items breaks the tie',
  resolvePunchSub('Rivera Drywall', [RIVERA2.id], subs)?.id === RIVERA2.id);
check('a typed name with no record resolves to no sub (no shortcut), even with a stale id',
  resolvePunchSub('Garcia Paint', [ABC.id], subs) === undefined);
check('no name: the id is all there is', resolvePunchSub('', [ABC.id], subs)?.id === ABC.id);


console.log('\na sub rename carries onto his punch items (round-2 integration):');
{
  const items = [
    { id: 'his', assignedSub: 'ABC Electric', assignedSubId: ABC.id, projectId: 'mine' },
    { id: 'his-case', assignedSub: ' abc electric', assignedSubId: ABC.id, projectId: 'mine' },
    { id: 'legacy', assignedSub: 'ABC Electric', projectId: 'mine' },
    { id: 'moved', assignedSub: 'Rivera Drywall', assignedSubId: ABC.id, projectId: 'mine' },
    { id: 'other', assignedSub: 'Rivera Drywall', assignedSubId: RIVERA.id, projectId: 'mine' },
  ];
  const mine = ownsProjectFor([{ id: 'mine', ownerUserId: 'me' }], 'me');
  const follow = punchItemsFollowingSubRename(items, ABC, 'ABC Electric', 'ABC Electric LLC', subs, mine);
  check('his rows by id + legacy name-only rows follow; a row reassigned by name does not',
    follow.join(',') === 'his,his-case,legacy', follow.join(','));
  // End to end: after the cascade he still owns them.
  const renamed = { ...ABC, companyName: 'ABC Electric LLC' };
  const after = items.map(p => follow.includes(p.id) ? { ...p, assignedSub: 'ABC Electric LLC', assignedSubId: ABC.id } : p);
  check('after the rename his items are still on his portal',
    after.filter(p => punchItemBelongsToSub(p, renamed)).map(p => p.id).join(',') === 'his,his-case,legacy');
  check('...and the edit sheet still resolves him (a save keeps assigned_sub_id)',
    resolvePunchSub('ABC Electric LLC', [ABC.id], [renamed, RIVERA])?.id === ABC.id);
  check('control: WITHOUT the cascade, the rename drops them (the bug)',
    items.filter(p => punchItemBelongsToSub(p, renamed)).length === 0
      && resolvePunchSub('ABC Electric', [ABC.id], [renamed, RIVERA]) === undefined);
  check('a legacy name-only row stays when another record still carries the old name',
    !punchItemsFollowingSubRename(items, ABC, 'ABC Electric', 'ABC Electric LLC', [...subs, { id: 'abc-2', companyName: 'ABC Electric' }], mine).includes('legacy'));
  check('a non-rename edit (same name, different case/space) moves nothing',
    punchItemsFollowingSubRename(items, ABC, 'ABC Electric', ' abc electric ', subs, mine).length === 0);
  // Integration round 3: a collaborator renaming a sub in HIS private list
  // must not rewrite the OWNER's legacy rows on a shared job he can read.
  {
    const projects = [{ id: 'his-job', ownerUserId: 'collab' }, { id: 'owner-job', ownerUserId: 'owner' }, { id: 'stale-cache' }];
    const ownerSub = { id: 'owner-abc', companyName: 'ABC Electric' };
    const shared = [
      { id: 'o-1', assignedSub: 'ABC Electric', projectId: 'owner-job' },
      { id: 'o-2', assignedSub: 'ABC Electric', projectId: 'owner-job' },
      { id: 'o-cached', assignedSub: 'ABC Electric', projectId: 'stale-cache' },
      { id: 'c-1', assignedSub: 'ABC Electric', projectId: 'his-job' },
      { id: 'c-idd', assignedSub: 'ABC Electric', assignedSubId: 'collab-abc', projectId: 'owner-job' },
      { id: 'orphan', assignedSub: 'ABC Electric' },
    ];
    const collabSub = { id: 'collab-abc', companyName: 'ABC Electric' };
    const f = punchItemsFollowingSubRename(shared, collabSub, 'ABC Electric', 'ABC Electric LLC', [collabSub], ownsProjectFor(projects, 'collab'));
    check('a collaborator\'s rename leaves the owner\'s legacy rows on the shared job alone',
      f.join(',') === 'c-1,c-idd', f.join(','));
    const after = shared.map(p => f.includes(p.id) ? { ...p, assignedSub: 'ABC Electric LLC', assignedSubId: 'collab-abc' } : p);
    check('...so the owner\'s rows stay on the owner\'s sub portal',
      after.filter(p => p.projectId === 'owner-job' && !p.assignedSubId).every(p => punchItemBelongsToSub(p, ownerSub)));
    check('control: with every project treated as his (the regression), the owner\'s rows were taken',
      punchItemsFollowingSubRename(shared, collabSub, 'ABC Electric', 'ABC Electric LLC', [collabSub], () => true).includes('o-1'));
    check('signed out owns nothing', !ownsProjectFor(projects, null)('his-job'));
  }
  const ctx = read('contexts', 'ProjectContext.tsx');
  const fn = ctx.slice(ctx.indexOf('const updateSubcontractor = useCallback('), ctx.indexOf('const deleteSubcontractor = useCallback('));
  check('updateSubcontractor cascades a rename through updatePunchItems, scoped to his projects',
    /punchItemsFollowingSubRename\(punchItemsRef\.current, before, before\.companyName, newName, subcontractors, ownsProjectFor\(projectsRef\.current, userId\)\)/.test(fn)
      && /\}, \[subcontractors, saveSubsMutation, canSync, userId\]\);/.test(fn)
      && /if \(follow\.length > 0\) updatePunchItemsRef\.current\?\.\(follow, \{ assignedSub: newName, assignedSubId: id \}\)/.test(fn));
  check('the ref points at the real updatePunchItems', /updatePunchItemsRef\.current = updatePunchItems;/.test(ctx));
}

console.log('\napp/punch-list.tsx keeps the name and the id together:');
const screen = read('app', 'punch-list.tsx');
check('a sub chip sets the id with the name',
  /onPress=\{\(\) => \{ setAssignedSub\(s\.companyName\); setFormSubId\(s\.id\); \}\}/.test(screen));
check('typing a name clears the id', /onChangeText=\{t => \{ setAssignedSub\(t\); setFormSubId\(undefined\); \}\}/.test(screen));
check('the edit save always sends assignedSubId (undefined clears a stale one)',
  /assignedSubId: assignedSub\.trim\(\) \? formSubId : undefined,/.test(screen));
check('opening an item seeds the id from the record its NAME points at',
  /setFormSubId\(resolvePunchSub\(item\.assignedSub \?\? '', \[item\.assignedSubId\], subcontractors\)\?\.id\);/.test(screen));
check('bulk assign always sends the id with the name', /\{ assignedSub: companyName, assignedSubId: subId \}/.test(screen));
check('the portal shortcut resolves through resolvePunchSub, not "the last id in the pool"',
  /const sub = resolvePunchSub\(name, ids, subcontractors\);/.test(screen) && !/if \(i\.assignedSubId\) assignedId = i\.assignedSubId;/.test(screen));

console.log('\ncontexts/ProjectContext.tsx sends a cleared id to the server:');
{
  const ctx = read('contexts', 'ProjectContext.tsx');
  const start = ctx.indexOf('function punchItemToUpdateRow(');
  const row = start >= 0 ? ctx.slice(start, ctx.indexOf('\n}\n', start)) : '';
  // undefined drops out of the JSON and the server keeps the stale sub's id,
  // which the next refetch brings back; null clears it.
  check('the punch UPDATE writes assigned_sub_id as `?? null`, not a bare (droppable) undefined',
    /assigned_sub_id: pi\.assignedSubId \?\? null,/.test(row), row.slice(0, 200));
}

console.log(fail ? `\n✗ validate-punch-sub-identity: ${fail} failure(s)` : `\nall punch sub-identity checks passed (${pass})`);
if (fail) process.exit(1);
