// scripts/validate-w5-rfp-marketplace-feed.ts — what the app reads from the
// marketplace after audit wave 5 (2026-09-23):
//   #13  the contractor bid feed (Pre-priced Bids, bid-detail, company-detail)
//        listed homeowner RFPs, and bid-detail showed the homeowner's email and
//        an Email button — while she was told contractors can't browse posts.
//   #86  once 20260923101000 revokes address_line / latitude / longitude /
//        contact_email / posted_by, any client select('*') or select of those
//        columns on public_bids fails outright, so NO client read may name them
//        (the poster reads hers through get_rfp_private).
//   #97  Review bids told a homeowner on a weak signal "Not your project", and
//        a failed bids read said "No bids yet".
//
// contexts/BidsContext.tsx imports AsyncStorage, AuthContext, lib/supabase and
// the offline queue at module scope; bun cannot load those, so they are
// replaced with stand-ins BEFORE the module is imported (the same pattern as
// validate-w5-reports-pdf). AsyncStorage is an in-memory Map the cache checks
// drive directly.
//
// Run: bun run scripts/validate-w5-rfp-marketplace-feed.ts

// `bun:test` has no type declarations in this repo's tsc program, so it is
// reached through a variable specifier; bun resolves it at runtime.
const BUN_TEST = 'bun:test';
const { mock } = (await import(BUN_TEST)) as {
  mock: { module: (specifier: string, factory: () => Record<string, unknown>) => void };
};
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const store = new Map<string, string>();
const AsyncStorage = {
  getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: async (k: string, v: string) => { store.set(k, v); },
  removeItem: async (k: string) => { store.delete(k); },
};
mock.module('@react-native-async-storage/async-storage', () => ({ default: AsyncStorage }));
mock.module('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
mock.module('@/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));
mock.module('@/utils/offlineQueue', () => ({ supabaseWrite: async () => true }));

const bidsCtx = await import('../contexts/BidsContext');
const { RFP_BROWSE_ENABLED } = await import('../constants/featureFlags');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
/** Source with // and /* *\/ comments removed (see validate-rfp-marketplace-honesty). */
function code(src: string): string {
  return src
    .replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1')
    .split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
}

const PRIVATE = ['address_line', 'latitude', 'longitude', 'contact_email', 'posted_by'];
const privateIn = (cols: string) => cols.split(',').map(c => c.trim()).filter(c => c === '*' || PRIVATE.includes(c));

// ── #86: no client read of public_bids names a private column ───────────────
console.log('\n#86 — every client read of public_bids selects safe columns only');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) { if (name !== 'node_modules') walk(rel, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}
const CLIENT_DIRS = ['app', 'components', 'contexts', 'hooks', 'utils'];
const files = CLIENT_DIRS.flatMap(d => walk(d));
let reads = 0;
const offenders: string[] = [];
for (const f of files) {
  const src = code(read(f));
  const re = /\.from\(\s*['"]public_bids['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tail = src.slice(m.index, m.index + 500);
    const sel = tail.match(/\.select\(\s*([^)]*)\)/);
    const stmtEnd = tail.search(/;/);
    if (!sel || (stmtEnd >= 0 && (sel.index ?? 0) > stmtEnd)) continue; // insert/update/delete with no read-back
    reads++;
    const arg = sel[1].trim();
    let cols: string | null = null;
    const lit = arg.match(/^['"`]([^'"`]*)['"`]$/);
    if (lit) cols = lit[1];
    else if (arg === '') cols = '*';
    else if (/^[A-Z_]+$/.test(arg) && arg in bidsCtx) cols = String((bidsCtx as Record<string, unknown>)[arg]);
    else {
      // An identifier built in the same file (my-rfps: BASE_COLS + REACH_COLS):
      // every *COLS* string constant in the file must be safe.
      const lits = [...src.matchAll(/const [A-Z_]*COLS[A-Z_]* = '([^']*)'/g)].map(x => x[1].replace(/^,/, ''));
      cols = lits.length ? lits.join(',') : null;
    }
    const where = `${relative(ROOT, join(ROOT, f))}: .select(${arg.slice(0, 60)})`;
    if (cols === null) offenders.push(`${where} — cannot resolve the column list`);
    else if (privateIn(cols).length) offenders.push(`${where} — ${privateIn(cols).join(', ')}`);
  }
}
ok(`found the client reads (${reads})`, reads >= 9, String(reads));
ok('no client select(\'*\') and no client select of address_line / latitude / longitude / contact_email / posted_by',
  offenders.length === 0, offenders.join('\n      '));

console.log('\n#13 — the bid feed never carries a homeowner RFP while browsing is off');
ok('PUBLIC_BID_FEED_COLUMNS lists safe columns (no *, none of the five)',
  privateIn(bidsCtx.PUBLIC_BID_FEED_COLUMNS).length === 0 && /\bis_homeowner_rfp\b/.test(bidsCtx.PUBLIC_BID_FEED_COLUMNS));
ok('the filter is null-OR-false (a NULL-flag agency row is kept), never a bare eq(false)',
  bidsCtx.NON_HOMEOWNER_FILTER === 'is_homeowner_rfp.is.null,is_homeowner_rfp.eq.false');
const ctxCode = code(read('contexts/BidsContext.tsx'));
ok('the feed query selects PUBLIC_BID_FEED_COLUMNS and applies the filter while !RFP_BROWSE_ENABLED',
  /\.from\('public_bids'\)\s*\.select\(PUBLIC_BID_FEED_COLUMNS\)/.test(ctxCode)
  && /if \(!RFP_BROWSE_ENABLED\) q = q\.or\(NON_HOMEOWNER_FILTER\);/.test(ctxCode));
ok('server rows are filtered again through feedRowAllowed (a regressed query filter can\'t leak)',
  /\.filter\(r => feedRowAllowed\(\{ isHomeownerRfp: r\.is_homeowner_rfp === true \}\)\)/.test(ctxCode));
ok('Posted by / Email come only from get_bid_contacts',
  /supabase\.rpc\('get_bid_contacts'/.test(ctxCode) && !/r\.posted_by|r\.contact_email/.test(ctxCode));
ok('addBid refuses a homeowner row', /if \(!feedRowAllowed\(stamped\)\) return;/.test(ctxCode));
ok('feedRowAllowed: browsing off drops a homeowner row, keeps agency and NULL-flag rows',
  bidsCtx.feedRowAllowed({ isHomeownerRfp: true }, false) === false
  && bidsCtx.feedRowAllowed({ isHomeownerRfp: false }, false) === true
  && bidsCtx.feedRowAllowed({ isHomeownerRfp: undefined }, false) === true
  && bidsCtx.feedRowAllowed({ isHomeownerRfp: true }, true) === true);
ok('RFP_BROWSE_ENABLED is still off (the default the feed uses)', RFP_BROWSE_ENABLED === false);
const mapped = bidsCtx.mapPublicBidRow({
  id: 'b1', title: 'Kitchen', is_homeowner_rfp: true, posted_by: 'jane@x.com', contact_email: 'jane@x.com',
  address_line: '412 Elm', budget_min: '1000', budget_max: null, estimated_value: '5000',
});
ok('mapPublicBidRow maps isHomeownerRfp and never copies posted_by / contact_email / address from the row',
  mapped.isHomeownerRfp === true && mapped.postedBy === '' && mapped.contactEmail === ''
  && !('addressLine' in mapped && (mapped as { addressLine?: string }).addressLine) && mapped.budgetMin === 1000 && mapped.budgetMax === undefined,
  JSON.stringify(mapped));
const withContact = bidsCtx.mapPublicBidRow({ id: 'a1', title: 'Framing' }, { postedBy: 'Al Builders', contactEmail: 'al@b.co' });
ok('a non-homeowner row keeps the contact get_bid_contacts returned', withContact.contactEmail === 'al@b.co' && withContact.postedBy === 'Al Builders');

// The device cache: purge once, then filter every read.
const HOMEOWNER = { id: 'h1', title: 'Deck', isHomeownerRfp: true, contactEmail: 'jane@x.com', postedBy: 'jane@x.com' };
const AGENCY = { id: 'a1', title: 'Framing', isHomeownerRfp: false, contactEmail: 'al@b.co', postedBy: 'Al' };
store.set('mageid_public_bids', JSON.stringify([HOMEOWNER, AGENCY]));
const first = await bidsCtx.readCachedBids();
ok('the first cache read on a device purges the pre-wave-5 cache (it could hold homeowner emails)',
  first.length === 0 && !store.has('mageid_public_bids') && store.get('mageid_public_bids_w5_purged') === '1');
store.set('mageid_public_bids', JSON.stringify([HOMEOWNER, AGENCY]));
const second = await bidsCtx.readCachedBids();
ok('after the purge, a cached homeowner row is still dropped on read', second.length === 1 && second[0].id === 'a1', JSON.stringify(second));
ok('the purge flag key is mageid_-prefixed (tenant-wipe sweep covers it)', /const BIDS_CACHE_PURGED_KEY = 'mageid_/.test(ctxCode));

const detail = code(read('app/bid-detail.tsx'));
ok('bid-detail hides Posted by and the Email for a homeowner RFP viewed by anyone but its poster (both layouts share the two values)',
  /const hideHomeownerContact = !!localBid\?\.isHomeownerRfp && localBid\.userId !== user\?\.id;/.test(detail)
  && /const contactEmail = hideHomeownerContact \? '' :/.test(detail)
  && /const postedBy = hideHomeownerContact \? '' :/.test(detail)
  && (detail.match(/Posted by: \{postedBy\}/g) ?? []).length === 2);
ok('post-bid marks its row as not a homeowner RFP', /isHomeownerRfp: false,/.test(code(read('app/post-bid.tsx'))));

console.log('\n#86 — the nearby feeds sort on the ~1 km location');
for (const f of ['app/nearby-rfps.tsx', 'app/(tabs)/mage-id-bids/index.tsx']) {
  const c = code(read(f));
  ok(`${f} distances use lat_coarse / lng_coarse`,
    /lat_coarse,lng_coarse/.test(c) && /Number\(r\.lat_coarse\), Number\(r\.lng_coarse\)/.test(c) && !/r\.latitude|r\.longitude/.test(c));
}

console.log('\n#97 — Review bids tells loading, failure, gone and not-yours apart');
const rv = code(read('app/rfp-responses-review.tsx'));
const headerFn = rv.slice(rv.indexOf("queryKey: ['rfp-header', bidId]"), rv.indexOf("queryKey: ['rfp-responses', bidId]"));
ok('the header read uses maybeSingle and THROWS on error (never cached as a null success)',
  /\.maybeSingle\(\);/.test(headerFn) && /if \(error\) throw new Error/.test(headerFn) && !/\.single\(\)/.test(headerFn));
ok('the poster\'s street address comes from get_rfp_private, and a failure throws',
  /supabase\.rpc\('get_rfp_private', \{ p_bid_id: bidId \}\)/.test(rv) && /if \(error\) throw new Error\(error\.message \|\| 'Could not load this RFP\.'\);/.test(rv)
  && /address_line: await readOwnAddress\(bidId \?\? ''\)/.test(headerFn));
const respFn = rv.slice(rv.indexOf("queryKey: ['rfp-responses', bidId]"), rv.indexOf('refetchInterval: 30_000'));
ok('the bids read throws instead of returning [] (an empty list means "No bids yet")',
  /if \(error\) throw new Error/.test(respFn) && !/return \[\];/.test(respFn));
ok('the 30-second poll is kept', /refetchInterval: 30_000/.test(rv));
const iFail = rv.indexOf("if (!rfp && (headerFailed || headerFetch === 'paused'))");
const iPending = rv.indexOf('if (rfp === undefined)');
const iGone = rv.indexOf('if (rfp === null)');
const iNotYours = rv.indexOf('if (rfp.user_id !== user.id)');
const iAuth = rv.indexOf('if (authLoading)');
ok('order: auth hydrating → couldn\'t load (error or paused) → loading → gone → not yours',
  iAuth > 0 && iFail > iAuth && iPending > iFail && iGone > iPending && iNotYours > iGone, [iAuth, iFail, iPending, iGone, iNotYours].join(','));
ok('"Not your project" appears once, only in the loaded-row branch',
  (rv.match(/'Not your project'/g) ?? []).length === 1
  && rv.slice(iNotYours, iNotYours + 200).includes("'Not your project'"));
ok('the failure state says it couldn\'t load and offers Retry',
  /Couldn\\'t load this RFP — check your connection/.test(rv) && /\{ retry: true \}/.test(rv) && /testID="rfp-review-retry"/.test(rv));
ok('a genuine no-row says the RFP no longer exists', /'This RFP no longer exists'/.test(rv));
ok('a failed bids read with nothing on screen shows an error card with Retry, not "No bids yet"',
  /const responsesLoadFailed = responses === undefined && responsesFailed;/.test(rv)
  && /\{responsesLoadFailed && \(/.test(rv)
  && /!isLoading && !responsesLoadFailed && responses !== undefined && sortedResponses\.length === 0/.test(rv));
ok('a withdrawn bid offers no Shortlist / Decline / Award',
  /!isAwarded && !isDeclined && !isAwardedRow && !isWithdrawn &&/.test(rv));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
