// scripts/validate-punch-walk-sub.ts — wave 3, lane punch (#20, #110)
//
// #20  The photo walk silently assigned every item to a sub guessed from the
//      trade — sometimes one from another job — or wrote the trade word
//      itself as the sub. Now: only a sub ON THIS JOB is ever proposed, the
//      card shows it before Save ("→ Sparks Electric (on this job)" / "No sub
//      on this job"), tap to change or clear, and nothing matched saves ''.
// #110 A collaborator walking the GC's job got his OWN directory (RLS is
//      owner-only). Now the owner's subs on the job come through the
//      project_subcontractors RPC, and his own directory is never the fallback.
//
// Run: bun run scripts/validate-punch-walk-sub.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickSubForTrade, walkProposedSub } from '../utils/tradeInference';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

type S = { id: string; companyName: string; trade: 'Electrical' | 'Plumbing'; assignedProjects: string[]; updatedAt?: string };
const onJobOld: S = { id: 'e1', companyName: 'Old Sparks', trade: 'Electrical', assignedProjects: ['p1'], updatedAt: '2026-01-01T00:00:00Z' };
const onJobNew: S = { id: 'e2', companyName: 'Sparks Electric', trade: 'Electrical', assignedProjects: ['p1', 'p2'], updatedAt: '2026-09-01T00:00:00Z' };
const offJobWarm: S = { id: 'e3', companyName: 'Other Job Electric', trade: 'Electrical', assignedProjects: ['p9'], updatedAt: '2026-09-17T00:00:00Z' };
const plumber: S = { id: 'pl', companyName: 'Pipes', trade: 'Plumbing', assignedProjects: ['p1'] };

console.log('pickSubForTrade proposes only a sub on THIS job (#20):');
check('among on-job subs of the trade, the most recently touched', pickSubForTrade('Electrical', [onJobOld, onJobNew, offJobWarm], 'p1')?.id === 'e2');
check('never the warmer sub from another job', pickSubForTrade('Electrical', [offJobWarm], 'p1') === null);
check('no project id → no proposal', pickSubForTrade('Electrical', [onJobNew], undefined) === null);
check('no sub of the trade on the job → null (not another trade)', pickSubForTrade('Electrical', [plumber], 'p1') === null);
check('a sub with no assignedProjects is not on the job', pickSubForTrade('Electrical', [{ ...onJobNew, assignedProjects: undefined as never }], 'p1') === null);

console.log('\nwalkProposedSub — what the card shows is what Save writes:');
check("'auto' = pickSubForTrade", walkProposedSub({ mode: 'auto' }, 'Electrical', [onJobNew, offJobWarm], 'p1')?.id === 'e2');
check("'none' = unassigned even when a sub matches", walkProposedSub({ mode: 'none' }, 'Electrical', [onJobNew], 'p1') === null);
check("'picked' = exactly the tapped sub", walkProposedSub({ mode: 'picked', sub: plumber }, 'Electrical', [onJobNew], 'p1')?.id === 'pl');

console.log('\napp/punch-walk.tsx:');
{
  const walk = read('app', 'punch-walk.tsx');
  check('Save uses the same walkProposedSub call the card renders from',
    /const proposedSub = walkProposedSub\(subChoice, draft\.trade, subs, projectId\);/.test(walk)
    && /const sub = walkProposedSub\(subChoice, draft\.trade, subs, projectId\);/.test(walk));
  check("no match saves '' — never the trade word", /assignedSub: sub\?\.companyName \?\? '',/.test(walk) && !/\?\? draft\.trade/.test(walk));
  check('the card shows the proposed sub, or says there is none', /`→ \$\{proposedSub\.companyName\} \(on this job\)`/.test(walk)
    && /No \$\{draft\.trade === 'General' \? '' : `\$\{draft\.trade\} `\}sub on this job/.test(walk)
    && /`Trade: \$\{draft\.trade\} — GC to assign`/.test(walk));
  check('tap to change or clear: a picker of on-job subs plus "No sub"',
    /setSubChoice\(\{ mode: 'none' \}\)/.test(walk) && /setSubChoice\(\{ mode: 'picked', sub: s \}\)/.test(walk)
    && /subs\.filter\(s => \(s\.assignedProjects \?\? \[\]\)\.includes\(projectId\)\)/.test(walk));
  check('the choice resets on save and when the trade changes', /setSubChoice\(\{ mode: 'auto' \}\);/.test(walk)
    && /if \(lastTradeRef\.current !== draft\.trade\)/.test(walk));
  check('#110 the walk reads subs through useProjectSubcontractors, not useProjects().subcontractors',
    /const projectSubs = useProjectSubcontractors\(projectId\);/.test(walk) && !/useProjects\(\)[^\n]*\bsubcontractors\b/.test(walk)
    && !/const \{[^}]*\bsubcontractors\b[^}]*\} = useProjects\(\)/.test(walk));
  check('#111 walk items are stamped with their creator', /\.\.\.\(userId \? \{ createdByUserId: userId \} : \{\}\),/.test(walk));
}

console.log('\nhooks/useProjectSubcontractors.ts (#110):');
{
  const src = read('hooks', 'useProjectSubcontractors.ts');
  const lift = (name: string) => {
    const i = src.indexOf(`export function ${name}(`);
    // The body brace is the first " {\n" after the signature (return types here have no braces).
    let depth = 0, j = src.indexOf(' {\n', i) + 1;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
    return src.slice(i, j + 1).replace(/^export /, '');
  };
  const tr = new (globalThis as unknown as { Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(code: string): string } } }).Bun.Transpiler({ loader: 'ts' });
  const js = tr.transformSync(`${lift('ownsProjectForPicker')}\n${lift('pickerSubFromRow')}\nexport const api = { ownsProjectForPicker, pickerSubFromRow };`)
    .replace(/export const api =/, 'return');
  // eslint-disable-next-line no-new-func
  const api = new Function(js)() as {
    ownsProjectForPicker: (p: { ownerUserId?: string } | null, u: string | null | undefined, r: string | null) => boolean | null;
    pickerSubFromRow: (r: Record<string, unknown>) => { id: string; companyName: string; assignedProjects: string[] } | null;
  };
  check('owner by the project row', api.ownsProjectForPicker({ ownerUserId: 'u1' }, 'u1', 'editor') === true);
  check('a collaborator is not the owner even if the cached role says owner', api.ownsProjectForPicker({ ownerUserId: 'gc' }, 'u1', 'owner') === false);
  check('no ownerUserId: falls back to the role; unresolved role = unknown (null), never "his"',
    api.ownsProjectForPicker({}, 'u1', 'owner') === true && api.ownsProjectForPicker({}, 'u1', 'field') === false
    && api.ownsProjectForPicker({}, 'u1', null) === null && api.ownsProjectForPicker(null, 'u1', 'owner') === null);
  const row = api.pickerSubFromRow({ id: 's', company_name: 'X', trade: 'Electrical', assigned_projects: ['p1', 3], phone: '555' });
  check('RPC rows map to picker subs; junk array entries dropped; no contact fields carried',
    !!row && row.assignedProjects.join() === 'p1' && !('phone' in (row as object)));
  check('the non-owner path reads project_subcontractors', /supabase\.rpc\('project_subcontractors', \{ p_project_id: projectId \}\)/.test(src));
  const code = src.replace(/\/\/[^\n]*/g, '');
  check('his own directory is returned ONLY when he owns the project (read once, returned once)',
    (code.match(/\bsubcontractors\b/g) ?? []).length === 2 && /if \(owns === true\) \{\s*return \{ subs: subcontractors, isOwner: true/.test(src),
    String((code.match(/\bsubcontractors\b/g) ?? []).length));
  check('the collaborator path returns the RPC rows or nothing', /subs: q\.data \?\? \[\],/.test(src));
  check('unknown ownership returns an empty list, not his directory', /if \(owns === null\) \{[\s\S]{0,400}subs: \[\], isOwner: false,/.test(src));
}

console.log('\nmigration: project_subcontractors (#110):');
{
  const sql = read('supabase', 'migrations', '20260919200000_punch_sub_portal.sql');
  const fn = sql.slice(sql.indexOf('create or replace function public.project_subcontractors'));
  check('gated by can_access_project(.., field)', /if not public\.can_access_project\(p_project_id, 'field'\) then/.test(fn));
  check('returns only id, company_name, trade, assigned_projects', /returns table \(id uuid, company_name text, trade text, assigned_projects jsonb\)/.test(fn)
    && !/phone|email|license|coi|notes/i.test(fn.slice(0, fn.indexOf('revoke'))));
  check('the OWNER\'s subs, assigned to this project', /join public\.projects p on p\.id::text = p_project_id and s\.user_id = p\.user_id/.test(fn)
    && /s\.assigned_projects \? p_project_id/.test(fn));
  check('not callable by anon', /revoke execute on function public\.project_subcontractors\(text\) from public, anon;/.test(sql));
}

console.log(fail ? `\n✗ validate-punch-walk-sub: ${fail} failure(s)` : `\nall punch walk sub checks passed (${pass})`);
if (fail) process.exit(1);
