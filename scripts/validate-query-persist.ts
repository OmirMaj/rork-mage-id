// scripts/validate-query-persist.ts — the "Instant Open" device cache (IDEAS-1
// · SPEED S1): utils/queryPersist.ts decides, components/QueryCachePersist.tsx
// does the I/O. This pins the tenant boundary and the launch timing:
//
//   1. shouldPersist — only a successful, allow-listed query whose key names
//      the signed-in user (queryKey[1]) and has not opted out is written.
//   2. decideRestore — a blob is restored only for its own user, inside
//      MAX_AGE_MS, from the same build; anything else is dropped.
//   3. The size cap drops the WHOLE write (never a partial blob).
//   4. PERSIST_KEY is under mageid_, so the sign-out sweep removes it.
//   5. The component: generation + user checked before every setItem, no
//      write without a user, read at mount with no user dependency, restore
//      gated on the first isLoading === false, hydrate only once and only for
//      queries absent from the cache, NO first-mount hold (integration round
//      2: the component never returns null — children render at once), every
//      AsyncStorage call in a try/catch.
//   6. PERSIST_ALLOW contains nothing the S1.4 analysis excluded.
//
// Pure: imports utils/queryPersist.ts and utils/localCacheKeys.ts (no React
// Native) and reads the component as text. VALIDATE_ROOT=<dir> points it at a
// scratch copy of the tree (for planting a defect without touching the repo).
//
// Run: bun run scripts/validate-query-persist.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.VALIDATE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const qp = (await import(join(ROOT, 'utils/queryPersist.ts'))) as typeof import('../utils/queryPersist');
const lck = (await import(join(ROOT, 'utils/localCacheKeys.ts'))) as typeof import('../utils/localCacheKeys');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
/** Source with comments removed (block and line; keeps URLs inside strings). */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
}

const U = 'user-a';
const V = 'user-b';
const buster = qp.makeBuster('1.0.0');
const now = 1_800_000_000_000;
const q = (key: unknown[], status = 'success', meta?: Record<string, unknown>) => ({ queryKey: key, state: { status }, meta });
const allowRoot = qp.PERSIST_ALLOW[0];

console.log('\n1. shouldPersist');
ok('an allow-list exists and every root in it is a string', qp.PERSIST_ALLOW.length > 0 && qp.PERSIST_ALLOW.every((r) => typeof r === 'string'));
ok('success + allow-listed + own user segment → true', qp.shouldPersist(q([allowRoot, U]), U) === true);
ok('a pending query → false', qp.shouldPersist(q([allowRoot, U], 'pending'), U) === false);
ok('an errored query → false', qp.shouldPersist(q([allowRoot, U], 'error'), U) === false);
ok('another user\'s segment → false', qp.shouldPersist(q([allowRoot, V]), U) === false);
ok('no user segment at all → false', qp.shouldPersist(q([allowRoot]), U) === false);
ok('a null user segment → false', qp.shouldPersist(q([allowRoot, null]), U) === false);
ok('a key root that is not allow-listed → false', qp.shouldPersist(q(['projects', U]), U) === false);
ok('meta.noPersist → false', qp.shouldPersist(q([allowRoot, U], 'success', { noPersist: true }), U) === false);
ok('no signed-in user → false', qp.shouldPersist(q([allowRoot, U]), null) === false);

console.log('\n2. decideRestore');
const stateFor = (uid: string) => ({ mutations: [], queries: [{ queryKey: [allowRoot, uid], queryHash: JSON.stringify([allowRoot, uid]), state: { status: 'success', data: { status: 'connected' }, dataUpdatedAt: now - 1000 } }] });
const good = JSON.stringify(qp.buildBlob(U, stateFor(U), now - 60_000, buster));
ok('its own user, fresh, same build → restore', qp.decideRestore(good, U, now, buster) === 'restore');
ok('another user → drop:wrong-user', qp.decideRestore(good, V, now, buster) === 'drop:wrong-user');
ok('no resolved user → drop:wrong-user', qp.decideRestore(good, null, now, buster) === 'drop:wrong-user');
ok('older than MAX_AGE_MS → drop:expired',
  qp.decideRestore(JSON.stringify(qp.buildBlob(U, stateFor(U), now - qp.MAX_AGE_MS - 1, buster)), U, now, buster) === 'drop:expired');
ok('saved in the future (clock moved back) → drop:expired',
  qp.decideRestore(JSON.stringify(qp.buildBlob(U, stateFor(U), now + 60_000, buster)), U, now, buster) === 'drop:expired');
ok('another build (buster) → drop:buster', qp.decideRestore(good, U, now, qp.makeBuster('1.0.1')) === 'drop:buster');
ok('garbage → drop:unparseable', qp.decideRestore('{not json', U, now, buster) === 'drop:unparseable');
ok('valid JSON of the wrong shape → drop:unparseable', qp.decideRestore('"x"', U, now, buster) === 'drop:unparseable'
  && qp.decideRestore(JSON.stringify({ v: 1, userId: U }), U, now, buster) === 'drop:unparseable');
ok('another schema version → drop:unparseable',
  qp.decideRestore(JSON.stringify({ ...JSON.parse(good), v: qp.PERSIST_SCHEMA + 1 }), U, now, buster) === 'drop:unparseable');
ok('nothing stored → drop:empty (nothing to delete)', qp.decideRestore(null, U, now, buster) === 'drop:empty');
ok('the buster carries the app version and the schema', buster.includes('1.0.0') && buster.includes(`s${qp.PERSIST_SCHEMA}`));

console.log('\n   restorableQueries (the hydrate filter)');
const mixed = qp.buildBlob(U, {
  queries: [
    { queryKey: [allowRoot, U], queryHash: 'h-own', state: { status: 'success' } },
    { queryKey: [allowRoot, V], queryHash: 'h-foreign', state: { status: 'success' } },
    { queryKey: ['projects', U], queryHash: 'h-excluded', state: { status: 'success' } },
    { queryKey: [allowRoot, U, 'x'], queryHash: 'h-live', state: { status: 'success' } },
    { queryKey: [allowRoot, U, 'p'], queryHash: 'h-pending', state: { status: 'pending' } },
  ],
}, now, buster);
const restorable = qp.restorableQueries(mixed, U, (h) => h === 'h-live').map((x) => x.queryHash);
ok('only its own, allow-listed, successful queries that are NOT already in the cache',
  JSON.stringify(restorable) === JSON.stringify(['h-own']), JSON.stringify(restorable));
ok('buildBlob never carries mutations', qp.buildBlob(U, { mutations: [{ x: 1 }], queries: [] }, now, buster).state.mutations?.length === 0);

console.log('\n3. the size cap');
const big = 'x'.repeat(qp.SIZE_CAP_BYTES.web + 10);
const bigBlob = qp.buildBlob(U, { queries: [{ queryKey: [allowRoot, U], queryHash: 'h', state: { status: 'success', data: big } }] }, now, buster);
const webRes = qp.serializeBlob(bigBlob, 'web');
ok('over the web cap → nothing written (ok: false, over-cap), never a partial blob',
  webRes.ok === false && webRes.reason === 'over-cap' && !('json' in webRes));
ok('the same blob fits the native cap', qp.serializeBlob(bigBlob, 'native').ok === true);
ok('a blob with no persistable query → empty (the caller removes the old blob)', (() => {
  const r = qp.serializeBlob(qp.buildBlob(U, { queries: [] }, now, buster), 'native');
  return r.ok === false && r.reason === 'empty';
})());
ok('utf8Bytes counts multi-byte characters', qp.utf8Bytes('a') === 1 && qp.utf8Bytes('é') === 2 && qp.utf8Bytes('—') === 3 && qp.utf8Bytes('😀') === 4);
ok('web cap is below 1 MB (localStorage is shared with the Supabase session)', qp.SIZE_CAP_BYTES.web <= 1_000_000);
ok('persistSignature changes when data changes and is empty for nothing',
  qp.persistSignature({ queries: [] }) === ''
  && qp.persistSignature({ queries: [{ queryKey: [], queryHash: 'h', state: { dataUpdatedAt: 1 } }] })
    !== qp.persistSignature({ queries: [{ queryKey: [], queryHash: 'h', state: { dataUpdatedAt: 2 } }] }));

console.log('\n4. the key is inside the tenant sweep');
ok('PERSIST_KEY starts with mageid_', qp.PERSIST_KEY.startsWith('mageid_'));
ok('PERSIST_KEY is an app storage key and the sign-out sweep removes it',
  lck.isAppStorageKey(qp.PERSIST_KEY) && lck.selectTenantKeysToWipe([qp.PERSIST_KEY, 'sb-x-auth-token']).includes(qp.PERSIST_KEY)
  && !lck.DEVICE_SCOPED_KEYS.includes(qp.PERSIST_KEY));

console.log('\n5. components/QueryCachePersist.tsx');
const comp = code(readFileSync(join(ROOT, 'components/QueryCachePersist.tsx'), 'utf8'));
const setItemAt = [...comp.matchAll(/AsyncStorage\.setItem\(/g)].map((m) => m.index ?? 0);
const writeNowAt = comp.indexOf('const writeNow = async (gen: number, uid: string | null)');
ok('exactly one setItem, inside writeNow', setItemAt.length === 1 && writeNowAt >= 0 && setItemAt[0] > writeNowAt, `setItem x${setItemAt.length}`);
const writeBody = writeNowAt >= 0 && setItemAt.length ? comp.slice(writeNowAt, setItemAt[0]) : '';
ok('writeNow first refuses a stale generation, a missing user and a user change',
  /^const writeNow = async \(gen: number, uid: string \| null\): Promise<void> => \{\s*if \(gen !== generationRef\.current \|\| !uid \|\| userRef\.current !== uid\) return;/
    .test(writeBody));
ok('the generation and the user are checked again right before setItem',
  /if \(gen !== generationRef\.current \|\| userRef\.current !== uid\) return;[\s\S]*$/.test(writeBody)
  && (writeBody.match(/gen !== generationRef\.current/g) ?? []).length >= 2);
ok('a write that lands after the generation moved takes itself back',
  /await AsyncStorage\.setItem\(PERSIST_KEY, result\.json\);[\s\S]{0,400}if \(gen !== generationRef\.current \|\| userRef\.current !== uid\) await removeBlob\(\);/.test(comp));
ok('schedule() never arms a write without a user, and captures the generation',
  /const schedule = \(\) => \{\s*const uid = userRef\.current;\s*if \(!uid \|\| timerRef\.current\) return;\s*const gen = generationRef\.current;/.test(comp));
ok('a user change bumps the generation, cancels the timer and deletes the previous user\'s blob',
  /if \(prev !== userId\) \{\s*generationRef\.current \+= 1;[\s\S]{0,200}clearTimeout\(timerRef\.current\)[\s\S]{0,120}if \(prev !== null\) void removeBlob\(\);/.test(comp));
ok('unmount bumps the generation and cancels the timer',
  /return \(\) => \{\s*generationRef\.current \+= 1;\s*if \(timerRef\.current\) \{ clearTimeout\(timerRef\.current\);/.test(comp));
ok('the throttle is WRITE_THROTTLE_MS and background / pagehide flush',
  /WRITE_THROTTLE_MS - \(Date\.now\(\) - lastWriteRef\.current\)/.test(comp)
  && /if \(s === 'background'\) flush\(\);/.test(comp) && /addEventListener\('pagehide', onPageHide\)/.test(comp));

ok('reads useAuth().isLoading', /const \{ user, isLoading \} = useAuth\(\);/.test(comp));
ok('never gates on the user alone (no `user === null` / `!user` gate)',
  !/user\s*===\s*null/.test(comp) && !/\(!user\)/.test(comp) && !/if \(!user\b/.test(comp));
const readEffect = comp.match(/useEffect\(\(\) => \{\s*const settle = [\s\S]*?AsyncStorage\.getItem\(PERSIST_KEY\)[\s\S]*?\}, \[(.*?)\]\);/);
ok('the storage read starts in a mount effect with no dependency on the user',
  !!readEffect && readEffect[1].trim() === '', readEffect ? `deps: [${readEffect[1]}]` : 'read effect not found');
const compBody = comp.slice(Math.max(0, comp.indexOf('export default function QueryCachePersist')));
const nullReturns = [...compBody.matchAll(/return null;/g)];
// Round 2: the hold held the provider subtree back for one render (4 goldens
// that mount the real _layout went red) and bought nothing while no
// first-screen provider reads an allow-listed key.
ok('NO first-mount hold: no `return null`, no hold timer, no hold state — the component always renders its children',
  nullReturns.length === 0 && !/setHoldOver|holdOver|blobSettled|childrenMountedRef|RESTORE_WAIT_MS/.test(comp)
  && /return <>\{children\}<\/>;\s*\}\s*$/.test(comp.trimEnd() + '\n') && !('RESTORE_WAIT_MS' in qp),
  `return null x${nullReturns.length}`);
ok('the blob read lands in a ref (no re-render), and nothing but the restore reads it',
  /const settle = \(raw: string \| null\) => \{ blobRef\.current = \{ settled: true, raw \}; \};/.test(comp)
  && !/useState/.test(comp));
const guardAt = comp.indexOf('if (!isLoading && !restoreDecidedRef.current) {');
const hydrateAt = [...comp.matchAll(/\bhydrate\(client/g)].map((m) => m.index ?? 0);
ok('hydrate is called once, inside the first-resolved-auth guard that flips restoreDecidedRef first',
  guardAt >= 0 && hydrateAt.length === 1 && hydrateAt[0] > guardAt
  && /if \(!isLoading && !restoreDecidedRef\.current\) \{\s*restoreDecidedRef\.current = true;\s*if \(userId && blobRef\.current\.settled && blobRef\.current\.raw\)/.test(comp));
ok('only when decideRestore says restore, and only for queries absent from the cache',
  /const decision = decideRestore\(blobRef\.current\.raw, userId, Date\.now\(\), buster\);\s*if \(decision === 'restore'\)/.test(comp)
  && /restorableQueries\(blob, userId, \(hash\) => cache\.get\(hash\) !== undefined\)/.test(comp));
ok('a restored query is marked invalid (it refetches on first read)',
  /invalidateQueries\(\{ queryKey: \[\.\.\.q\.queryKey\], exact: true, refetchType: 'none' \}\)/.test(comp));
ok('a dropped blob (wrong user, expired, other build, garbage) is deleted',
  /else if \(decision !== 'drop:empty'\) \{\s*dropOwedRef\.current = true;/.test(comp));
// Every AsyncStorage call sits inside a try block that is still open.
const storageCalls = [...comp.matchAll(/AsyncStorage\.(getItem|setItem|removeItem|multiRemove|clear)\(/g)];
const unguarded = storageCalls.filter((m) => {
  const at = m.index ?? 0;
  const tryAt = comp.lastIndexOf('try {', at);
  if (tryAt < 0) return true;
  const between = comp.slice(tryAt + 'try '.length, at);
  const depth = (between.match(/\{/g) ?? []).length - (between.match(/\}/g) ?? []).length;
  return depth <= 0;
});
ok('every AsyncStorage call is inside a try/catch', storageCalls.length >= 3 && unguarded.length === 0,
  unguarded.map((m) => m[0]).join(', '));
ok('never AsyncStorage.clear() (web shares localStorage with the Supabase session)', !/AsyncStorage\.clear\(/.test(comp));

console.log('\n6. the allow-list and the exclusions agree with the S1.4 analysis');
const excluded = Object.keys(qp.PERSIST_EXCLUDED);
const both = qp.PERSIST_ALLOW.filter((r) => excluded.includes(r));
ok('no root is both allowed and excluded', both.length === 0, both.join(', '));
ok('every exclusion carries a reason', Object.values(qp.PERSIST_EXCLUDED).every((r) => typeof r === 'string' && r.length > 20));
const CANDIDATES = ['projects', 'settings', 'changeOrders', 'invoices', 'dailyReports', 'punchItems', 'public_bids', 'companies',
  'jobs', 'workers', 'conversations', 'messages', 'smart-proposals', 'backcharges'];
const undecided = CANDIDATES.filter((c) => !qp.PERSIST_ALLOW.includes(c) && !excluded.includes(c));
ok('every root the spec named is decided (allowed or excluded with a reason)', undecided.length === 0, undecided.join(', '));
ok('\'projects\' stays excluded until ProjectContext serves its device copy as placeholder data',
  !qp.PERSIST_ALLOW.includes('projects') && excluded.includes('projects'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
