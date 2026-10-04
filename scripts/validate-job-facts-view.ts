// validate-job-facts-view.ts — the public job facts read answers only for a
// live link, signs only what shared-photos-sign would, and never names an
// account (lane FACTS, M3).
//
// Transpiles the edge function's `// ── pure:begin/end ──` block from its own
// source (the validate-w5-scan-files-share.ts way) and runs it under bun,
// next to shared-photos-sign's pure block on the SAME rows:
//   A. the code rule accepts and rejects the right strings;
//   B. a revoked row produces exactly the same answer as an unknown code;
//   C. the photo filter matches signableSharePhotos on a shared fixture table;
//   D. the 200 body's key set excludes user_id, project_id and id;
//   E. wiring: the code check comes before any read, errors are no-store, a
//      200 is cached 30 s at most, 120 per IP per hour, and the photo query
//      sits after the live check.
//
// PLANTED MUTATION (MUTATE=1): serve a revoked row. It must turn this red.
//
// Run: bun run scripts/validate-job-facts-view.ts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const eq = <T,>(name: string, got: T, want: T) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);

const MUTATE = Number(process.env.MUTATE || 0);
let src = readFileSync(join(ROOT, 'supabase/functions/job-facts-view/index.ts'), 'utf8');
if (MUTATE === 1) {
  const from = '  if (row.revoked_at != null) return null;\n';
  if (!src.includes(from)) { console.error('MUTATE=1: anchor not found'); process.exit(3); }
  src = src.replace(from, '');
  console.log('(planted mutation: serve a revoked row)');
} else if (MUTATE) { console.error('unknown MUTATE'); process.exit(2); }
const signSrc = readFileSync(join(ROOT, 'supabase/functions/shared-photos-sign/index.ts'), 'utf8');

function pureBlock(text: string, name: string): string {
  const a = text.indexOf('// ── pure:begin');
  const b = text.indexOf('// ── pure:end');
  ok(`${name} has its pure block`, a > 0 && b > a);
  return text.slice(a, b);
}
const dir = mkdtempSync(join(tmpdir(), 'job-facts-view-'));
// Each block's one outside dependency is the storage-path rule (lane SEC3): the
// sliced files import the same two names the functions import, from the same module.
const RULE_IMPORT = `import { PROJECT_PHOTO_PATH, requestStoragePath } from ${JSON.stringify(join(ROOT, 'supabase/functions/_shared/storagePath.ts'))};\n`;
writeFileSync(join(dir, 'view.ts'), RULE_IMPORT + pureBlock(src, 'job-facts-view'));
writeFileSync(join(dir, 'sign.ts'), RULE_IMPORT + pureBlock(signSrc, 'shared-photos-sign'));

type Row = Record<string, unknown>;
type Signable = { id: string; path: string; ts: string | null; tag: string | null };
const v = await import(join(dir, 'view.ts')) as {
  CODE_RE: RegExp;
  NOT_LIVE: { live: false };
  LINK_COLUMNS: string;
  parseCode: (raw: string | null | undefined) => string | null;
  liveLink: (row: Row | null | undefined) => { projectId: string; payload: Record<string, unknown>; publishedAt: string } | null;
  payloadPhotoIds: (p: Record<string, unknown>) => string[];
  signableFactsPhotos: (rows: Row[], projectId: string, ids: string[]) => Signable[];
  viewBody: (link: { payload: Record<string, unknown>; publishedAt: string }, photos: { id: string; url: string }[]) => Record<string, unknown>;
};
const s = await import(join(dir, 'sign.ts')) as {
  parseShareSignRequest: (b: unknown) => { projectId: string; photoIds: string[] } | null;
  signableSharePhotos: (rows: Row[], req: { projectId: string; photoIds: string[] }) => Signable[];
};

const PID = '2f31d28f-dd61-4396-bd41-1203e533a1cc';
const UID = '291a590e-c15b-4561-b00a-db1bf54177c8';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

console.log('\nA. the code rule:');
eq('a good code passes', v.parseCode('ABCDEFGH2345'), 'ABCDEFGH2345');
eq('dashes, spaces and lower case are normalized', v.parseCode(' abcd-efgh-2345 '), 'ABCDEFGH2345');
for (const bad of ['', 'ABCDEFGH234', 'ABCDEFGH23456', 'ABCDEFGHI234', 'ABCDEFGHO234', 'ABCDEFGH0234', 'ABCDEFGH1234', "ABCDEFGH234'", 'ABCDEFGH23%5'])
  eq(`"${bad}" is refused`, v.parseCode(bad), null);
eq('null is refused', v.parseCode(null), null);
ok('the function\'s regex is the table\'s check', v.CODE_RE.source === '^[A-HJ-NP-Z2-9]{12}$'
  && readFileSync(join(ROOT, 'supabase/migrations/20261002161000_job_fact_links.sql'), 'utf8').includes("check (code ~ '^[A-HJ-NP-Z2-9]{12}$')"));

console.log('\nB. revoked = unknown (no oracle):');
const payload = {
  v: 1, job: { name: 'Maple Ave', business: 'Northwind' }, sections: ['photos'], includeCoAmounts: false,
  facts: [
    { kind: 'photo', section: 'photos', label: 'Photo', value: 'Framing', source: { record: 'photo', ref: id(1) }, date: '2026-09-01', photo: { id: id(1), ts: 't', tag: 'Framing' } },
    { kind: 'photo', section: 'photos', label: 'Photo', value: 'Site photo', source: { record: 'photo', ref: id(2) }, date: '2026-09-02', photo: { id: id(2), ts: 't', tag: null } },
    { kind: 'photo', section: 'photos', label: 'Photo', value: 'x', source: { record: 'photo', ref: 'demo' }, date: '2026-09-02', photo: { id: 'not-a-uuid', ts: 't', tag: null } },
  ],
  leftOut: [],
};
const liveRow = { project_id: PID, payload, published_at: '2026-10-02T12:00:00Z', revoked_at: null };
const revokedRow = { ...liveRow, revoked_at: '2026-10-02T13:00:00Z' };
// The answer the handler gives: liveLink(row) ? 200 viewBody : 404 NOT_LIVE.
const answer = (row: Row | null) => { const l = v.liveLink(row); return l ? { status: 200, body: v.viewBody(l, []) } : { status: 404, body: v.NOT_LIVE }; };
eq('a revoked row answers exactly what an unknown code answers', answer(revokedRow), answer(null));
eq('… which is 404 {live:false}', answer(null), { status: 404, body: { live: false } });
ok('a live row answers 200 live:true', answer(liveRow).status === 200 && (answer(liveRow).body as Row).live === true);
ok('a row with a broken payload is not served', v.liveLink({ ...liveRow, payload: [] }) === null && v.liveLink({ ...liveRow, payload: null }) === null);
ok('the handler returns NOT_LIVE for every not-live case, before the photo query', (() => {
  const at404 = src.indexOf('if (!link) return json(NOT_LIVE, 404);');
  const atPhotos = src.indexOf('.from("photos")');
  return at404 > 0 && atPhotos > at404 && (src.match(/json\(NOT_LIVE, 404\)/g) ?? []).length === 1;
})());

console.log('\nC. the photo filter is shared-photos-sign\'s:');
eq('payload photo ids: UUIDs only, in order', v.payloadPhotoIds(payload), [id(1), id(2)]);
const row = (n: number, over: Row = {}): Row => ({
  id: id(n), user_id: UID, project_id: PID, uri: `${UID}/${PID}/${id(n)}.jpg`, timestamp: 't', tag: null, portal_state: null, ...over,
});
const FIXTURE: Row[] = [
  row(1),
  row(2, { portal_state: { status: 'sent' } }),
  row(3, { portal_state: { status: 'recalled' } }),
  row(4, { portal_state: { status: 'draft' } }),
  row(5, { uri: 'file:///var/mobile/5.jpg' }),
  row(6, { uri: `${UID}/OTHER-PROJECT/${id(6)}.jpg` }),
  row(7, { uri: `someone-else/${PID}/${id(7)}.jpg` }),
  row(8, { project_id: 'another' }),
  row(9, { uri: `https://x.supabase.co/storage/v1/object/public/project-photos/${UID}/${PID}/${id(9)}.jpg` }),
  row(10, { uri: 'https://picsum.photos/seed/x/640/480' }),
  row(11, { user_id: null }),
  row(12, { uri: `${UID}/${PID}/sub/${id(12)}.jpg` }),
  row(13),                                              // never asked for
];
const asked = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14].map(id);
const mine = v.signableFactsPhotos(FIXTURE, PID, asked);
const theirs = s.signableSharePhotos(FIXTURE, s.parseShareSignRequest({ projectId: PID, photoIds: asked })!);
eq('both pure blocks sign exactly the same rows, in the same order', mine, theirs);
eq('… which are the stored, plain-or-sent, same-job, owner-folder, asked ones', mine.map((p) => p.id), [id(1), id(2), id(9)]);
// Lane SEC3: both blocks decide the path with the one storage-path rule.
const CRAFTED: Row[] = [
  row(1, { uri: `${UID}/${PID}/%2e%2e` }),                           // passed the old "three segments" test
  row(2, { uri: `${UID}/${PID}/.%2E` }),
  row(3, { uri: ` ${UID}/${PID}/${id(3)}.jpg` }),                    // padded: refused, never trimmed
  row(4, { uri: `/${UID}/${PID}/${id(4)}.jpg` }),                    // slash-led: refused, never stripped
  row(5, { uri: `${UID}/${PID}/${id(5)}.exe` }),
  row(6, { uri: `https://x.supabase.co/storage/v1/object/sign/project-photos/${UID}/${PID}/%2e%2e/${id(6)}.jpg?token=t` }),
  row(7, { uri: `${UID.toUpperCase()}/${PID}/${id(7)}.jpg` }),       // another folder to Storage
];
eq('an encoded dot segment, a padded, slash-led, non-image or upper-case-folder path is refused by both',
  [v.signableFactsPhotos(CRAFTED, PID, asked).map((p) => p.id), s.signableSharePhotos(CRAFTED, s.parseShareSignRequest({ projectId: PID, photoIds: asked })!).map((p) => p.id)], [[], []]);
ok('the function takes its key rule from _shared/storagePath.ts, and Storage is handed the rule\'s answers re-checked with the same pins',
  src.includes('import { PROJECT_PHOTO_PATH, requestStoragePath } from "../_shared/storagePath.ts";')
  && /const key = requestStoragePath\(p\.path, PROJECT_PHOTO_PATH, \{ 0: p\.owner, 1: link\.projectId \}\);\s*if \(key\) keys\.push\(key\);/.test(src)
  && /\.createSignedUrls\(keys, SIGNED_URL_TTL_SECONDS\)/.test(src) && !/createSignedUrls\(ok\.map/.test(src));
eq('a reversed ask order is kept by both', v.signableFactsPhotos(FIXTURE, PID, [...asked].reverse()).map((p) => p.id),
  s.signableSharePhotos(FIXTURE, s.parseShareSignRequest({ projectId: PID, photoIds: [...asked].reverse() })!).map((p) => p.id));

console.log('\nD. the 200 body never names an account:');
const body = v.viewBody(v.liveLink(liveRow)!, [{ id: id(1), url: 'https://x/sign/1' }]);
const keys = Object.keys(body);
for (const k of ['user_id', 'project_id', 'id', 'userId', 'projectId', 'code']) ok(`no "${k}" key in the body`, !keys.includes(k));
ok('the body JSON holds no project id', !JSON.stringify(body).includes(PID));
eq('the body\'s keys are exactly the allowlist', keys.sort(), ['facts', 'includeCoAmounts', 'job', 'leftOut', 'live', 'photos', 'publishedAt', 'sections']);
ok('the read selects named columns only, never user_id or id', v.LINK_COLUMNS === 'project_id, payload, published_at, revoked_at');
eq('a payload smuggling extra job keys is cut to name + business', (v.viewBody({ payload: { job: { name: 'A', business: 'B', user_id: UID } }, publishedAt: 'x' }, []) as { job: unknown }).job, { name: 'A', business: 'B' });

console.log('\nE. wiring:');
const handler = src.slice(src.indexOf('serve(async'));
ok('the code check comes before any read (limiter, table, storage)', (() => {
  const c = handler.indexOf('if (!code) return json({ error: "bad_code" }, 400);');
  return c > 0 && c < handler.indexOf('rateLimitCount(') && c < handler.indexOf('.from("job_fact_links")');
})());
ok('errors are no-store; a 200 is cached 30 s at most', /status === 200 \? "public, max-age=30" : "no-store"/.test(src));
ok('120 requests per IP per hour, keyed by clientIpFrom', /IP_HOURLY_LIMIT = 120;/.test(src) && /rateLimitCount\(`job-facts-view:\$\{clientIpFrom\(req\.headers\)\}`\)/.test(src));
ok('signed URLs live 1 hour', /SIGNED_URL_TTL_SECONDS = 60 \* 60;/.test(src));
ok('last_viewed_at is stamped only on a live row', /update\(\{ last_viewed_at: new Date\(\)\.toISOString\(\) \}\)\s*\n\s*\.eq\("code", code\)\.is\("revoked_at", null\)/.test(src));
ok('the header declares verify_jwt off (the edge-verify-jwt self-declared rule)', /verify_jwt is OFF/.test(src.slice(0, 600)));
ok('no AI and no tier gate', !/requireTier|gemini|anthropic|openai/i.test(src));

console.log('\nF. the public page (marketing/facts/index.html):');
{
  const page = readFileSync(join(ROOT, 'marketing/facts/index.html'), 'utf8');
  const redirects = readFileSync(join(ROOT, 'marketing/_redirects'), 'utf8');
  const toml = readFileSync(join(ROOT, 'marketing/netlify.toml'), 'utf8');
  ok('noindex and no-referrer', /<meta name="robots" content="noindex"/.test(page) && /<meta name="referrer" content="no-referrer"/.test(page));
  ok('the fetch omits credentials and sends no referrer', /credentials: 'omit', referrerPolicy: 'no-referrer'/.test(page));
  ok('no analytics, no third-party script', !/posthog|gtag|googletagmanager|<script[^>]+src="https?:/i.test(page));
  ok('values go in as text, never markup', !/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(page));
  ok('it asks job-facts-view, and only it', (page.match(/functions\/v1\/[a-z-]+/g) ?? []).every((m) => m === 'functions/v1/job-facts-view'));
  ok('a revoked or unknown code reads "This link is no longer active."', page.includes('This link is no longer active.'));
  ok('the footer says read-only and no prediction; never "verified"', page.includes("'Read-only. Shared by ' + business + '. Nothing here is a prediction.'") && !/verified/i.test(page.replace(/<!--[\s\S]*?-->/g, '')));
  ok('/facts/* is rewritten in _redirects above the catch-all', (() => { const a = redirects.indexOf('/facts/*  /facts/index.html  200'); const b = redirects.indexOf('/*  /404.html  404'); return a > 0 && b > a; })());
  ok('… and mirrored in netlify.toml', /from = "\/facts\/\*"\n\s+to = "\/facts\/index.html"\n\s+status = 200/.test(toml));
  const m = /function classifyFactsResponse\(status, d\) \{[\s\S]*?\n {2}\}/.exec(page);
  ok('the page has its response classifier', !!m);
  if (m) {
    const classify = new Function(`${m[0]}; return classifyFactsResponse;`)() as (s: number, d: unknown) => string;
    eq('404 {live:false} → notlive', classify(404, { live: false }), 'notlive');
    eq('400 bad_code → notlive', classify(400, { error: 'bad_code' }), 'notlive');
    eq('a gateway 404 with no live:false is an outage, not "no longer active"', classify(404, { message: 'not found' }), 'error');
    eq('a live 200 → live', classify(200, v.viewBody(v.liveLink(liveRow)!, [])), 'live');
    eq('a 200 missing its facts → error', classify(200, { live: true, job: { name: 'x' }, publishedAt: 'x', sections: [] }), 'error');
    eq('429 → error', classify(429, { error: 'rate_limited' }), 'error');
  }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
