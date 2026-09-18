// scripts/validate-project-memory-sync.ts — audit round 2, finding #23.
//
// Project Memory embedded `docs.slice(0, 250)` in a fixed order (RFIs, then
// daily reports newest-first, then COs, submittals, punch items) and never
// deleted anything. On a commercial fit-out that means:
//   • a submittal created after the RFI + daily-report count passed 250 was
//     never embedded at all;
//   • a submittal embedded early kept the text it had then — the "Revise and
//     resubmit", not the later "Approved as noted" — so the RFI "suggest an
//     answer" draft could send the old rejection to the architect;
//   • a deleted RFI stayed citable forever.
// And the screen said "searched 330 records" either way.
//
// This pins the diff (what to re-embed, what to delete, what to refuse to
// delete), and that the client and the screen use it honestly.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  diffIndex, orphanedChunks, baseDocId, MAX_PRUNE_SHARE, PRUNE_ALWAYS_OK_BELOW,
  WHOLE_TYPE_PRUNE_GUARD_MIN, type IndexRow,
} from '../supabase/functions/project-memory-embed/indexDiff';
import { memoryDocHash, MEMORY_DOC_PREFIXES, MEMORY_RECORD_SOURCES } from '../utils/plans/memoryIndexCore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `— ${extra}` : ''); }
}

console.log('\n1. the diff finds what the old truncation missed');
// 330 records: 60 RFIs + 150 daily reports + 30 COs + 90 submittals. The old
// client sent the first 250 (all RFIs, all daily reports, 40 COs); the rest
// were invisible. Here: 250 indexed and current, 80 never indexed.
const manifest = [
  ...Array.from({ length: 250 }, (_, i) => ({ doc_id: `dfr-${i}`, hash: `h${i}` })),
  ...Array.from({ length: 80 }, (_, i) => ({ doc_id: `sub-${i}`, hash: `s${i}` })),
];
const rows: IndexRow[] = Array.from({ length: 250 }, (_, i) => ({ doc_id: `dfr-${i}`, content_hash: `h${i}` }));
const d1 = diffIndex(manifest, rows, { prune: true });
ok('every never-embedded submittal comes back stale', d1.stale.length === 80 && d1.stale.every(id => id.startsWith('sub-')), String(d1.stale.length));
ok('records already indexed with current text are not re-sent (no re-charge)', d1.fresh.length === 250);
ok('nothing is pruned when nothing is gone', d1.prune.length === 0);

// The stale-text case: the submittal was embedded, then a review cycle landed.
const before = memoryDocHash({ source: 'Submittal', ref: 'Submittal #12', text: 'Ceiling tile. status revise_resubmit. Review: Revise and resubmit' });
const after = memoryDocHash({ source: 'Submittal', ref: 'Submittal #12', text: 'Ceiling tile. status approved. Review: Revise and resubmit; Approved as noted' });
const d2 = diffIndex([{ doc_id: 'sub-12', hash: after }], [{ doc_id: 'sub-12', content_hash: before }], { prune: false });
ok('an edited record is re-embedded (the approval reaches the index)', d2.stale.join() === 'sub-12' && d2.fresh.length === 0);
ok('a row with no hash at all (pre-migration) is stale', diffIndex([{ doc_id: 'rfi-1', hash: 'x' }], [{ doc_id: 'rfi-1', content_hash: null }], { prune: false }).stale.join() === 'rfi-1');

console.log('\n2. deletions stop being citable');
const d3 = diffIndex(
  [{ doc_id: 'rfi-1', hash: 'a' }, { doc_id: 'rfi-2', hash: 'b' }],
  [{ doc_id: 'rfi-1', content_hash: 'a' }, { doc_id: 'rfi-2', content_hash: 'b' }, { doc_id: 'rfi-9', content_hash: 'z' }],
  { prune: true },
);
ok('a record that no longer exists is pruned', d3.prune.join() === 'rfi-9');
ok('prune is off unless the caller asks', diffIndex([{ doc_id: 'rfi-1', hash: 'a' }], [{ doc_id: 'rfi-9', content_hash: 'z' }], { prune: false }).prune.length === 0);

// A screen that syncs mid-hydration must not wipe the index and re-pay for it.
const bigRows: IndexRow[] = Array.from({ length: 200 }, (_, i) => ({ doc_id: `dfr-${i}`, content_hash: `h${i}` }));
const halfLoaded = diffIndex(bigRows.slice(0, 50).map(r => ({ doc_id: r.doc_id, hash: r.content_hash as string })), bigRows, { prune: true });
ok('a half-loaded manifest cannot delete most of the index', halfLoaded.prune.length === 0 && halfLoaded.pruneRefused);
ok('the refusal is reported, not silent', halfLoaded.pruneRefused === true);
const fewGone = diffIndex(bigRows.slice(0, 150).map(r => ({ doc_id: r.doc_id, hash: r.content_hash as string })), bigRows, { prune: true, scopePrefixes: MEMORY_DOC_PREFIXES });
ok('a normal delete of a quarter of the records still prunes', fewGone.prune.length === 50 && !fewGone.pruneRefused);

// B5 review: the share guard only catches a LARGE shortfall, and a
// half-hydrated client never produces one. ProjectContext loads the five
// collections from five independent queries, so the manifest is missing WHOLE
// TYPES, not a scattered percentage. Round 1's case — 240 of 330 records
// loaded, the 90 submittals still in flight — is a 27% gap: under the share
// guard, so all 90 submittal rows were deleted and the next open re-paid
// Gemini (and the user's monthly memory allowance) to put them back.
const jobRows: IndexRow[] = [
  ...Array.from({ length: 60 }, (_, i) => ({ doc_id: `rfi-${i}`, content_hash: `h${i}` })),
  ...Array.from({ length: 150 }, (_, i) => ({ doc_id: `dfr-${i}`, content_hash: `h${i}` })),
  ...Array.from({ length: 30 }, (_, i) => ({ doc_id: `co-${i}`, content_hash: `h${i}` })),
  ...Array.from({ length: 90 }, (_, i) => ({ doc_id: `sub-${i}`, content_hash: `h${i}` })),
];
const mid = jobRows.filter(r => !r.doc_id.startsWith('sub-')).map(r => ({ doc_id: r.doc_id, hash: r.content_hash as string }));
ok('a 27% shortfall is below the share guard', (90 / 330) < MAX_PRUNE_SHARE);
const hydrating = diffIndex(mid, jobRows, { prune: true, scopePrefixes: MEMORY_DOC_PREFIXES });
ok('a whole record type missing from the manifest refuses the prune',
  hydrating.prune.length === 0 && hydrating.pruneRefused, `${hydrating.prune.length} rows would have been deleted`);
ok('…and the refusal is total, not just that type',
  (() => {
    // A real deletion in a type that DID load (rfi-3) rides along with the
    // missing submittals: a manifest missing one collection is not evidence
    // about the others either, so nothing at all is deleted this round.
    const alsoDeleted = mid.filter(m => m.doc_id !== 'rfi-3');
    const d = diffIndex(alsoDeleted, jobRows, { prune: true, scopePrefixes: MEMORY_DOC_PREFIXES });
    return d.prune.length === 0 && d.pruneRefused;
  })());
ok('once the query lands, the same manifest prunes the records really deleted',
  (() => {
    const loaded = [...mid, ...jobRows.filter(r => r.doc_id.startsWith('sub-') && r.doc_id !== 'sub-7').map(r => ({ doc_id: r.doc_id, hash: r.content_hash as string }))];
    const d = diffIndex(loaded, jobRows, { prune: true, scopePrefixes: MEMORY_DOC_PREFIXES });
    return d.prune.join() === 'sub-7' && !d.pruneRefused;
  })());
ok('a small clear-out of one type still prunes (the guard has a floor)',
  (() => {
    const rows3: IndexRow[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ doc_id: `rfi-${i}`, content_hash: `h${i}` })),
      ...Array.from({ length: 3 }, (_, i) => ({ doc_id: `sub-${i}`, content_hash: `h${i}` })),
    ];
    const d = diffIndex(rows3.filter(r => r.doc_id.startsWith('rfi-')).map(r => ({ doc_id: r.doc_id, hash: r.content_hash as string })), rows3, { prune: true, scopePrefixes: MEMORY_DOC_PREFIXES });
    return d.prune.length === 3 && !d.pruneRefused;
  })(), `the floor is ${WHOLE_TYPE_PRUNE_GUARD_MIN} indexed docs of that type`);
ok('the whole-type guard needs a named scope (an un-scoped diff behaves as before)',
  diffIndex(mid, jobRows, { prune: true }).prune.length === 90);
ok('the screen sends the scope that arms the guard', /PROJECT_MEMORY_SYNC_SCOPE/.test(read('app/project-memory.tsx')));
ok('the embed function forwards the scope to the diff',
  /diffIndex\(manifest, rows, \{ prune, scopePrefixes: scope \}\)/.test(read('supabase/functions/project-memory-embed/index.ts')));
const tiny = diffIndex([{ doc_id: 'rfi-1', hash: 'a' }], [{ doc_id: 'rfi-1', content_hash: 'a' }, { doc_id: 'rfi-2', content_hash: 'b' }, { doc_id: 'rfi-3', content_hash: 'c' }], { prune: true });
ok('a small project can delete most of its records', tiny.prune.length === 2, `guard only applies at ${PRUNE_ALWAYS_OK_BELOW}+ docs`);
ok('the share guard is a half, not a whim', MAX_PRUNE_SHARE > 0 && MAX_PRUNE_SHARE < 1);

console.log('\n3. chunked docs (plan sheets) are one identity');
ok('a chunk answers to its base id', baseDocId('plan-sheet:abc#3') === 'plan-sheet:abc' && baseDocId('rfi-1') === 'rfi-1');
const chunked = diffIndex(
  [{ doc_id: 'plan-sheet:a', hash: 'h' }],
  [{ doc_id: 'plan-sheet:a#0', content_hash: 'h' }, { doc_id: 'plan-sheet:a#1', content_hash: 'h' }],
  { prune: true },
);
ok('all chunks current = the sheet is fresh', chunked.fresh.join() === 'plan-sheet:a' && chunked.prune.length === 0);
const halfStale = diffIndex(
  [{ doc_id: 'plan-sheet:a', hash: 'h2' }],
  [{ doc_id: 'plan-sheet:a#0', content_hash: 'h2' }, { doc_id: 'plan-sheet:a#1', content_hash: 'h1' }],
  { prune: false },
);
ok('one stale chunk restales the whole sheet', halfStale.stale.join() === 'plan-sheet:a');
ok('a shrunk doc drops its leftover tail chunk',
  orphanedChunks(['plan-sheet:a'], [{ doc_id: 'plan-sheet:a', content_hash: 'h' }, { doc_id: 'plan-sheet:a#1', content_hash: 'old' }]).join() === 'plan-sheet:a#1');
ok('another doc\'s chunks are never touched',
  orphanedChunks(['plan-sheet:a'], [{ doc_id: 'plan-sheet:b#1', content_hash: 'x' }]).length === 0);

console.log('\n4. the client sends the whole record set, incrementally');
const pm = code('utils/projectMemory.ts');
ok('the 250-record truncation is gone', !/docs\.slice\(0, 250\)/.test(pm), 'this is the line that made new submittals invisible');
ok('the client asks what is already indexed', /action: 'manifest'/.test(pm));
ok('it sends a content hash per doc', /content_hash: hashes\.get\(d\.id\)/.test(pm));
ok('it batches until every stale record is covered', /batchGroups\(/.test(pm));
ok('only a caller with the complete record set may prune', /PROJECT_MEMORY_SYNC_SCOPE/.test(pm) && /prune: opts\.prune === true/.test(pm));
ok('the prune scope is Project Memory\'s own doc prefixes', /scopePrefixes: MEMORY_DOC_PREFIXES/.test(pm));
ok('the closeout binder (Home Passport) still calls the diff-only form',
  /syncMemoryEmbeddings\(project\.id, memoryDocs\)/.test(read('app/closeout-binder.tsx')), 'a passport sync must never prune project records');

console.log('\n5. retrieval is scoped and can fall back');
ok('the semantic search asks only for the record types this screen counts', (pm.match(/sources: MEMORY_RECORD_SOURCES/g) ?? []).length >= 2);
ok('weak matches fall through to the keyword path', (pm.match(/confidentMatches\(/g) ?? []).length >= 2);
ok('the five sources line up with the five doc prefixes', MEMORY_RECORD_SOURCES.length === MEMORY_DOC_PREFIXES.length);
const extract = read('utils/projectMemory.ts');
for (const [source, prefix] of [['RFI', 'rfi-'], ['Daily Report', 'dfr-'], ['Change Order', 'co-'], ['Submittal', 'sub-'], ['Punch Item', 'punch-']] as const) {
  ok(`${source} docs are written with the ${prefix} prefix the prune scope names`,
    new RegExp(`id: \`${prefix}\\$\\{`).test(extract) && (MEMORY_RECORD_SOURCES as readonly string[]).includes(source) && (MEMORY_DOC_PREFIXES as readonly string[]).includes(prefix));
}

console.log('\n6. the screen reports coverage, not the whole record count');
const screen = read('app/project-memory.tsx');
ok('a semantic answer says how much of the record is indexed', /turn\.indexed/.test(screen) && /\} indexed`/.test(screen));
ok('a keyword answer still says it searched every record', /Searched \$\{turn\.searched\}/.test(screen));
ok('a partly-built index is disclosed on the empty state', /memory-index-status/.test(screen));

console.log('\n7. the embed function enforces the same rules');
const fn = code('supabase/functions/project-memory-embed/index.ts');
ok('a manifest with no scope cannot prune', /body\.prune === true && scope\.length > 0/.test(fn));
ok('the manifest path spends no Gemini call (no charge, still rate-limited)',
  fn.indexOf('action === "manifest"') < fn.indexOf('await geminiEmbed(') && /rateLimitCount\(`pm:\$\{auth\.userId\}`\)/.test(fn));
ok('deletes go through an RPC, not a spliced PostgREST in.() filter',
  /delete_project_memory_docs/.test(fn) && !/doc_id=in\./.test(fn));
ok('the upsert still writes the hash', /content_hash: typeof d\.content_hash/.test(fn));
ok('it survives deploying ahead of the migration', /content_hash/.test(fn) && /r\.status === 400/.test(fn));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
