// scripts/validate-portal-token-heal.ts — the portal setup screen must never
// destroy a homeowner's working link, and its link lifetime must be the one
// the database computes.
//
// WHY THIS EXISTS. The founder, 2026-09-16: "the links always expire". Three
// causes were stacked; the worst lived in app/client-portal-setup.tsx. Its
// "heal" effect saw an enabled portal with no access token in LOCAL state and
// minted one on the client — `(generateUUID() + generateUUID()).replace(/-/g,'')`
// — then wrote it. Local state lacks the token in perfectly normal situations:
// the optimistic write never reads the server's token back, and a
// collaborator's copy is stripped on purpose (AUTH-F5). The DB trigger
// portal_set_access_token only fills an EMPTY token, so the non-empty client
// token won and OVERWROTE the real one. Every link already texted to the
// homeowner stopped working, with no error anywhere. Production carried the
// fingerprint: one 64-char client-minted token among 48-char trigger tokens.
//
// The collaborator half was a second lie: the heal could never obtain a token
// for them, so the screen said "still syncing … unlock in a moment" forever.
//
// And the snapshot push sent the RAW stored expiry on every refresh. With
// links now open UNTIL HANDOVER (closing 30 days after closeout — see
// utils/portalLinkExpiry.ts and 20260916140000_portal_link_until_handover.sql),
// pushing a stored null for a closed-out job would fight the database trigger
// that computes the closing date, on every refresh.
//
// All of it is silent: the screen looks fine to the GC, and the homeowner is
// the one who finds out. So each property is pinned here.
//
// HOW IT CHECKS. The screen imports react-native and cannot run under bun, so
// these are source checks on COMMENT-STRIPPED text (a comment describing the
// old bug must not satisfy or trip anything). Each failure names the rule and
// why it exists. The shared expiry rule itself is executed by
// test:portal-link-expiry; this guard pins that the screen USES it.
//
// Mutation-tested 2026-09-16: restoring the client-minted token turns 1a, 1b,
// 1c, 2b and 2c red (8 checks); deleting the collaborator bail turns 3a red;
// pushing the raw stored expires_at turns 4b and 4c red.
// Mutation-tested 2026-09-17 (sub-link load race, 6g–6j): ungating the editor
// turns 6h red; deriving the flag from isFetched outside the links effect turns
// two 6g checks red; never resetting it on a user switch turns 6g red;
// restoring the 800ms write grace turns both 6j checks red; mounting the editor
// straight from the paywall wrapper turns 6h red.
//
// Run via: bun run test:portal-token-heal

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'app/client-portal-setup.tsx';

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, detail ? `\n      ${detail}` : ''); }
}

/** Strip // and /* *\/ comments. `(^|[^:])` keeps `https://` inside strings
 *  intact; a mis-strip can only REMOVE text, so it errs red, never green. */
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** From the `{` at `open`, the index just past its matching `}` (or -1). */
function matchBrace(src: string, open: number, o = '{', c = '}'): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c) { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** Every `useEffect(() => { … })` body in the source. */
function effectBodies(src: string): string[] {
  const out: string[] = [];
  const re = /useEffect\(\s*\(\)\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const end = matchBrace(src, open);
    if (end > 0) out.push(src.slice(open, end));
  }
  return out;
}

let raw = '';
try { raw = readFileSync(join(ROOT, FILE), 'utf8'); } catch { /* reported below */ }
ok(`${FILE} exists and is non-trivial`, raw.length > 10_000,
  'The guard cannot check a screen it cannot read — a missing file must not pass vacuously.');
const src = stripTsComments(raw);

// ── 1. Nothing on this screen mints an access token ───────────────────────
console.log('\n1. No client-minted access token');

// 1a. Every generateUUID() is an invite id, nothing else. The old token was
// two of these concatenated; any other use is a candidate secret.
const uuidUses = [...src.matchAll(/generateUUID\s*\(\s*\)/g)].map(m => src.slice(Math.max(0, m.index! - 40), m.index! + m[0].length));
const nonInviteUuid = uuidUses.filter(ctx => !/\bid\s*:\s*generateUUID\s*\(\s*\)\s*$/.test(ctx.trimEnd()));
ok('1a. generateUUID() is used only as an invite `id:`', nonInviteUuid.length === 0,
  `Found: ${nonInviteUuid.map(s => JSON.stringify(s.replace(/\s+/g, ' '))).join(' | ')}\n` +
  '      A UUID built on the client and written as accessToken overwrote the real token (the DB trigger only fills an EMPTY one).');
ok('1a. no `generateUUID() + generateUUID()` concatenation', !/generateUUID\s*\(\s*\)\s*\+\s*generateUUID/.test(src),
  'That exact expression was the client-side token mint that broke every sent link.');

// 1b. No randomness source anywhere near a token.
const randomNearToken = src.split('\n').filter(l =>
  /[Tt]oken/.test(l) && /(generateUUID|randomUUID|getRandomValues|getRandomBytes|Math\.random|Crypto\.|crypto\.)/.test(l));
ok('1b. no crypto/random/UUID expression on a line that mentions a token', randomNearToken.length === 0,
  `Lines: ${randomNearToken.map(l => l.trim()).join(' | ')}`);
ok('1b. no randomUUID / getRandomValues / getRandomBytes anywhere in the screen',
  !/(randomUUID|getRandomValues|getRandomBytes)/.test(src),
  'This screen has no business generating secrets; the database mints the portal token.');

// 1c. Every `accessToken:` written into an object is a token that came back
// from the server (`serverToken`), or a `_`-prefixed destructure discard used
// to write the portal with the token EMPTY.
const tokenProps = [...src.matchAll(/accessToken\s*:\s*([^,}\n)]+)/g)].map(m => m[1].trim());
const badTokenProps = tokenProps.filter(v => v !== 'serverToken' && !/^_\w*$/.test(v));
ok('1c. every `accessToken:` value is `serverToken` or a `_` destructure discard', badTokenProps.length === 0,
  `Offending values: ${badTokenProps.join(', ')}\n` +
  '      A non-empty token this device created always wins over the trigger and overwrites the real one.');
ok('1c. no `accessToken =` assignment', !/\baccessToken\s*=(?!=)/.test(src));

// 1d. `serverToken` only ever binds a value read from the server.
const serverTokenDecls = [...src.matchAll(/(?:const|let|var)\s+serverToken\s*=\s*([^;\n]+)/g)].map(m => m[1].trim());
ok('1d. `const serverToken =` binds only the loader-delivered persisted token',
  serverTokenDecls.every(v => v === 'persistedToken'),
  `Bindings: ${serverTokenDecls.join(', ')}`);
ok('1d. persistedToken comes from project.clientPortal.accessToken',
  /const\s+persistedToken\s*=\s*project\?\.clientPortal\?\.accessToken\s*;/.test(src));
const adoptCalls = [...src.matchAll(/\badopt\s*\(([^)]*)\)/g)].map(m => m[1].trim());
ok('1d. adopt(serverToken) is only called with a server read-back `.token`',
  adoptCalls.length >= 2 && adoptCalls.every(a => /^(first|back)\.token$/.test(a)),
  `adopt() arguments: ${adoptCalls.join(', ') || '(none found)'}`);
ok('1d. the read-backs are `await readServerPortalToken(`',
  /const\s+first\s*=\s*await\s+readServerPortalToken\s*\(/.test(src)
  && /const\s+back\s*=\s*await\s+readServerPortalToken\s*\(/.test(src));

// ── 2. The heal reads the server token before it writes anything ──────────
console.log('\n2. Read before write');

const readerStart = src.search(/async\s+function\s+readServerPortalToken\s*\(/);
const readerBody = readerStart >= 0 ? src.slice(readerStart, matchBrace(src, src.indexOf('{', src.indexOf(')', src.indexOf('Promise<', readerStart))))) : '';
// Wave 5 (#82, CONTRACT 13): the key moved to owner-only portal_credentials,
// so the owner reads it through portal_get_owner_token, never the row.
ok('2a. readServerPortalToken asks the owner-only getter (portal_get_owner_token) by project id',
  /supabase\.rpc\(\s*'portal_get_owner_token'\s*,\s*\{\s*p_project_id:\s*projectId\s*\}\s*\)/.test(readerBody)
  && !/\.select\(\s*'client_portal'\s*\)/.test(readerBody),
  'The heal must learn what the SERVER holds before deciding anything — through the getter, not the row the strip empties.');
ok('2a. readServerPortalToken reports a failed read as not-ok (never as "no token")',
  /if\s*\(\s*error\s*\)\s*\{[\s\S]*?code\s*===\s*'42501'\)\s*return\s*\{\s*ok:\s*true,\s*token:\s*null\s*\};\s*return\s*\{\s*ok:\s*false\s*\};\s*\}/.test(readerBody),
  'A failed read treated as "none" would trigger a write on every offline visit. Only the getter\'s own refusal (42501 — no owned row on the server yet, after ownership is confirmed) reads as none.');
ok('2a. readServerPortalToken never logs', !/console\./.test(readerBody),
  'The token is a capability secret — never log it, or anything next to it.');

const heal = effectBodies(src).find(b => b.includes('readServerPortalToken(')) ?? '';
ok('2b. the heal effect exists (a useEffect that calls readServerPortalToken)', heal.length > 0);
const firstRead = heal.indexOf('readServerPortalToken(');
const firstWrite = heal.search(/updateProject\s*\(/);
ok('2b. the heal reads the server token BEFORE any updateProject write',
  firstRead >= 0 && (firstWrite === -1 || firstRead < firstWrite),
  `read at ${firstRead}, first write at ${firstWrite}`);
ok('2b. an existing server token is adopted and the heal RETURNS before the write',
  /if\s*\(\s*first\.token\s*\)\s*\{\s*adopt\(\s*first\.token\s*\)\s*;\s*return\s*;\s*\}/.test(heal)
  && heal.search(/if\s*\(\s*first\.token\s*\)/) < firstWrite,
  'If the server has a token, use it locally and write NOTHING.');
ok('2b. a failed first read returns without writing',
  /if\s*\(\s*!first\.ok\s*\)\s*\{[^}]*return\s*;\s*\}/.test(heal)
  && heal.search(/if\s*\(\s*!first\.ok\s*\)/) < firstWrite);
const writes = [...heal.matchAll(/updateProject\s*\(\s*id\s*,\s*\{\s*clientPortal\s*:\s*([^}]+)\}/g)].map(m => m[1].trim());
ok('2c. the heal writes the portal only as `portalWithoutToken`',
  writes.length === 1 && writes[0] === 'portalWithoutToken',
  `Heal writes: ${writes.join(' | ') || '(none)'}`);
ok('2c. portalWithoutToken is the persisted portal with accessToken destructured away',
  /const\s*\{\s*accessToken\s*:\s*_\w*\s*,\s*\.\.\.portalWithoutToken\s*\}\s*=\s*persisted\s*;/.test(heal),
  'An EMPTY token is the only safe write: the trigger mints one, or keeps the one that exists.');
ok('2c. after the empty write the heal reads back rather than assuming',
  heal.indexOf('readServerPortalToken(', firstWrite) > firstWrite);
ok('2d. the heal never logs', !/console\./.test(heal));
ok('2e. the heal gives up into a visible failed state (no endless "syncing")',
  /setTokenHeal\(\s*'failed'\s*\)/.test(heal) && /linkHealFailed/.test(src) && /retryTokenHeal/.test(src));

// ── 3. The heal never runs for a project this account does not own ────────
console.log('\n3. Owner only');

const collabBail = heal.search(/if\s*\(\s*localOwnership\s*===\s*'collaborator'\s*\)\s*return\s*;/);
const firstSupabase = heal.search(/supabase\b|readServerPortalToken\(|updateProject\s*\(/);
ok('3a. the heal returns for a collaborator before touching the server',
  collabBail >= 0 && (firstSupabase === -1 || collabBail < firstSupabase),
  'Credentials are stripped for collaborators on purpose (AUTH-F5): never read or write the owner’s portal credential for them.');
ok('3b. ownership compares the project owner with the signed-in user',
  /ownerUserId\s*===\s*userId\s*\?\s*'owner'\s*:\s*'collaborator'/.test(src)
  && /const\s+localOwnership\s*=\s*portalOwnershipOf\(\s*project\?\.ownerUserId\s*,\s*userId\s*\)/.test(src));
const ownerConfirm = heal.search(/\.select\(\s*'user_id'\s*\)/);
ok('3c. unknown ownership is confirmed from user_id BEFORE the credential is read',
  /if\s*\(\s*localOwnership\s*!==\s*'owner'\s*\)/.test(heal) && ownerConfirm >= 0 && ownerConfirm < firstRead,
  'A cache predating ownerUserId must not read client_portal until the server says this account owns the row.');
ok('3d. a collaborator sees that only the owner can share the link',
  /const\s+linkOwnerOnly\s*=\s*linkPending\s*&&\s*isCollaborator/.test(src)
  && /Only the project owner can share the client link/.test(src),
  'Before: "still syncing … unlock in a moment", a wait that never ended.');
// linkNeedsSave's exact spelling is pinned by test:portal-owner, so the
// collaborator case is ordered instead: owner-only is read FIRST in both the
// hint and the alert (a collaborator's Save never writes the portal).
const hintAt = src.indexOf('testID="portal-link-hint"');
const hintBlock = hintAt >= 0 ? src.slice(hintAt, hintAt + 600) : '';
const alertFn = src.slice(Math.max(0, src.indexOf('const warnIfLinkPending')), src.indexOf('const warnIfLinkPending') + 900);
const firstIdx = (block: string, a: string, b: string) => block.indexOf(a) >= 0 && block.indexOf(a) < block.indexOf(b);
ok('3e. owner-only outranks needs-save in the link hint', firstIdx(hintBlock, 'linkOwnerOnly', 'linkNeedsSave'));
ok('3e. owner-only outranks needs-save in the Copy/Share/Email alert', firstIdx(alertFn, 'linkOwnerOnly', 'linkNeedsSave'));

// ── 4. Every expires_at write goes through the shared resolver ─────────────
console.log('\n4. Link lifetime through expiresAtForPolicy');

ok('4a. expiresAtForPolicy is imported from @/utils/portalLinkExpiry',
  /import\s*\{[^}]*\bexpiresAtForPolicy\b[^}]*\}\s*from\s*'@\/utils\/portalLinkExpiry'/.test(src));

// Replace each resolver call with a marker, then inspect what is left.
let rest = src;
let policyCalls = 0;
for (;;) {
  const at = rest.search(/expiresAtForPolicy\s*\(\s*\{/);
  if (at < 0) break;
  const open = rest.indexOf('(', at);
  const end = matchBrace(rest, open, '(', ')');
  if (end < 0) break;
  rest = rest.slice(0, at) + '__POLICY__' + rest.slice(end);
  policyCalls++;
}
ok('4b. the screen calls the resolver (label, snapshot push, regenerate)', policyCalls >= 3, `found ${policyCalls}`);
const expiresWrites = [...rest.matchAll(/expires_at\s*:\s*(\S+)/g)].map(m => m[1].replace(/,$/, ''));
ok('4c. every `expires_at:` write is the resolver’s answer',
  expiresWrites.length >= 1 && expiresWrites.every(v => v === '__POLICY__'),
  `expires_at values: ${expiresWrites.join(', ') || '(no expires_at write found)'}\n` +
  '      A raw stored date pushed on every snapshot refresh reopens a closed-out until-handover link.');
const policyVars = new Set([...rest.matchAll(/const\s+(\w+)\s*=\s*__POLICY__/g)].map(m => m[1]));
const linkExpiresWrites = [...rest.matchAll(/linkExpiresAt\s*:\s*([^,}\n]+)/g)].map(m => m[1].trim());
const badLinkExpires = linkExpiresWrites.filter(v => {
  if (v === '__POLICY__') return false;
  const id = v.replace(/\s*\?\?\s*undefined$/, '');
  return !policyVars.has(id);
});
ok('4d. every stored `linkExpiresAt:` comes from the resolver', linkExpiresWrites.length >= 1 && badLinkExpires.length === 0,
  `Offending: ${badLinkExpires.join(', ')}`);
ok('4e. expiresAtFromDuration is only ever an INPUT to the resolver', !/expiresAtFromDuration\s*\(/.test(rest),
  'A fixed-duration date minted outside the resolver bypasses the handover rule.');
ok('4f. the snapshot push re-runs when the project is closed out or reopened',
  /project\?\.status\s*,\s*project\?\.closedAt/.test(src));
ok('4g. link_duration_days stays NULL for until-handover',
  /link_duration_days\s*:\s*portal\.linkDurationDays\s*\?\?\s*null/.test(src),
  'NULL is how the database knows the date is its to compute.');

// ── 5. Until handover: defaults, options, preference migration, copy ──────
console.log('\n5. Until-handover default and copy');

ok('5a. picker options come from PORTAL_LINK_DURATION_OPTIONS', /PORTAL_LINK_DURATION_OPTIONS\.map\(/.test(src));
ok('5a. default comes from DEFAULT_PORTAL_LINK_DURATION_DAYS', /\?\?\s*DEFAULT_PORTAL_LINK_DURATION_DAYS/.test(src));
ok('5a. no hard-coded duration list', !/\[\s*(null\s*,\s*)?7\s*,\s*30\s*,\s*90\s*\]/.test(src));
ok('5b. the stored legacy "No expiry" preference reads as until-handover and is rewritten',
  /const\s+LEGACY_NO_EXPIRY_PREF\s*=\s*'none'/.test(src)
  && /raw\s*===\s*LEGACY_NO_EXPIRY_PREF\s*\)\s*\{\s*[^}]*setDurationChoice\(\s*null\s*\)[^}]*setItem\(\s*LINK_DURATION_PREF_KEY\s*,\s*UNTIL_HANDOVER_PREF\s*\)/.test(src));
ok('5b. new picks store the until-handover sentinel, not "none"',
  /durationChoice\s*===\s*null\s*\?\s*UNTIL_HANDOVER_PREF/.test(src) && !/NO_EXPIRY_PREF\s*:/.test(src));
ok('5c. the GC-facing copy says what until-handover does',
  /Open for the whole job/.test(src) && /HANDOVER_GRACE_DAYS\}\s*days after you close the project out/.test(src));
ok('5c. the retired "no expiry" promise is gone from the copy', !/no expiry date/i.test(src) && !/'Always on'/.test(src));

// ── 6. The SUB portal had the same bug, one layer further in ────────────────
// ProjectContext.upsertSubPortalLink minted a token on the phone whenever local
// state had none — and local state had none after EVERY server load, because
// the loader's mapper dropped access_token. The mint went out as a plain INSERT
// of an id that already existed, the queue read the duplicate as "already
// landed", and the app shared a token the server never saw. The same plain
// insert meant no edit after the first save (disable, passcode) ever synced.
{
  const ctx = stripTsComments(readFileSync(join(ROOT, 'contexts/ProjectContext.tsx'), 'utf8'));
  const fnStart = ctx.indexOf('const upsertSubPortalLink = useCallback(');
  const fnEnd = ctx.indexOf('const deleteSubPortalLink = useCallback(', fnStart);
  const upsertFn = fnStart >= 0 && fnEnd > fnStart ? ctx.slice(fnStart, fnEnd) : '';
  ok('6a. upsertSubPortalLink found', upsertFn.length > 0);
  ok('6a. …never mints a token on the phone', upsertFn.length > 0 && !/generateUUID|Math\.random|getRandomValues|randomUUID/.test(upsertFn));
  ok("6b. …writes with 'upsert', so edits after the first save reach the server",
    /supabaseWrite\(\s*'sub_portal_links'\s*,\s*'upsert'/.test(upsertFn) && !/supabaseWrite\(\s*'sub_portal_links'\s*,\s*'insert'/.test(ctx));
  ok('6c. …sends access_token only when it holds the server value',
    /\.\.\.\(\s*link\.accessToken\s*\?\s*\{\s*access_token:\s*link\.accessToken\s*\}\s*:\s*\{\s*\}\s*\)/.test(upsertFn));
  const loader = ctx.slice(ctx.indexOf(".from('sub_portal_links').select('*')"), ctx.indexOf('SUB_PORTAL_LINKS_KEY, mapped'));
  ok('6d. the loader carries access_token into the local link', /accessToken:\s*\(?\s*r\.access_token/.test(loader));

  const sub = stripTsComments(readFileSync(join(ROOT, 'app/sub-portal-setup.tsx'), 'utf8'));
  ok('6e. sub-portal-setup never mints a token',
    !/generateUUID\s*\(\s*\)\s*\+\s*generateUUID/.test(sub)
    && !sub.split('\n').some(l => /accessToken|access_token/.test(l) && /generateUUID|randomUUID|getRandomValues|Math\.random/.test(l)));
  ok("6e. …reads the server's token back", /\.from\('sub_portal_links'\)\s*\.select\('access_token'\)\s*\.eq\('id',\s*link\.id\)/.test(sub));
  for (const door of ['handleCopy', 'handleShare', 'handleEmailInvite']) {
    const at = sub.indexOf(`const ${door} = useCallback(`);
    const body = at >= 0 ? sub.slice(at, at + 400) : '';
    ok(`6f. ${door} refuses to hand out a token-less link`, /if \(warnIfTokenPending\(\)\) return;/.test(body));
  }

  // ── 6g+. The screen waits for the saved links before choosing or writing ──
  // The editor's state initialiser picks the sub's existing link or builds a
  // new one, and the token effect writes it at once. Opened before the context
  // had loaded the links, "existing" was undefined for a sub who had one, and
  // the write created a SECOND sub_portal_links row — a second portal URL for
  // the same sub. An 800ms grace hid it on a fast load only. The fix gates the
  // editor's MOUNT on a loaded signal the context sets in the same effect that
  // installs the links, so no render sees "loaded" with the links still empty.
  const loadEffect = effectBodies(ctx).find(b => /subPortalLinksQuery\.data/.test(b)) ?? '';
  ok('6g. the context declares subPortalLinksLoaded: boolean on its value type',
    /subPortalLinksLoaded\s*:\s*boolean\s*;/.test(ctx));
  ok('6g. …sets it true in the SAME effect that installs the loaded links',
    /if\s*\(\s*subPortalLinksQuery\.data\s*\)\s*\{\s*setSubPortalLinks\(\s*subPortalLinksQuery\.data\s*\)\s*;\s*setSubPortalLinksLoaded\(\s*true\s*\)\s*;/.test(loadEffect),
    'A flag derived separately (isFetched, a second effect) leaves a render where it reads loaded while the links are still [] — the duplicate window.');
  ok('6g. …drops it back while a new key (user switch) has no data yet',
    /else\s*\{\s*setSubPortalLinksLoaded\(\s*false\s*\)\s*;?\s*\}/.test(loadEffect));
  ok('6g. …and exposes it on the context value',
    /subPortalLinks\s*,\s*subPortalLinksLoaded\s*,\s*upsertSubPortalLink/.test(ctx));

  const gateAt = sub.indexOf('function SubPortalSetupScreenInner(');
  const gateOpen = gateAt >= 0 ? sub.indexOf('{', sub.indexOf(')', gateAt)) : -1;
  const gate = gateOpen >= 0 ? sub.slice(gateOpen, matchBrace(sub, gateOpen)) : '';
  ok('6h. the screen gate reads subPortalLinksLoaded from the context',
    /const\s*\{\s*subPortalLinksLoaded\s*\}\s*=\s*useProjects\(\)/.test(gate));
  const bail = gate.search(/if\s*\(\s*!subPortalLinksLoaded\s*\)\s*\{/);
  const editorMount = gate.search(/<SubPortalSetupEditor\s*\/>/);
  ok('6h. …returns a loading view BEFORE the editor mounts',
    bail >= 0 && editorMount > bail && /return\s*\(/.test(gate.slice(bail, editorMount)),
    'The editor must not mount — and so not choose a link or write — until the links are loaded.');
  ok('6h. the paywall wrapper renders the gate, not the editor directly',
    /return\s*<SubPortalSetupScreenInner\s*\/>/.test(sub) && (sub.match(/<SubPortalSetupEditor\s*\/>/g) ?? []).length === 1);

  const editorAt = sub.indexOf('function SubPortalSetupEditor(');
  const editor = editorAt >= 0 ? sub.slice(editorAt) : '';
  ok('6i. the link choice (getSubPortalLinkFor + new-link initialiser) lives only in the gated editor',
    editorAt > gateAt && /getSubPortalLinkFor\(/.test(editor) && !/getSubPortalLinkFor\(/.test(sub.slice(0, editorAt))
    && /useState<SubPortalLink>\(\s*\(\)\s*=>\s*\{\s*if\s*\(\s*existing\s*\)\s*return\s+existing\s*;/.test(editor));
  ok('6i. every upsertSubPortalLink( call is inside the gated editor',
    !/upsertSubPortalLink\(/.test(sub.slice(0, editorAt)) && /upsertSubPortalLink\(/.test(editor));
  ok('6j. the timing-based write grace is gone',
    !/SUB_TOKEN_WRITE_GRACE_MS|WRITE_GRACE/.test(sub),
    'A fixed wait loses to any load slower than it; the loaded signal replaces it.');
  const tokenEffect = effectBodies(sub).find(b => /select\('access_token'\)/.test(b)) ?? '';
  const firstUpsert = tokenEffect.search(/upsertSubPortalLink\(/);
  const firstWait = tokenEffect.search(/await\s+wait\(/);
  ok('6j. the token effect writes the (new or existing) link before its first wait',
    firstUpsert >= 0 && (firstWait === -1 || firstUpsert < firstWait),
    'A sub with no link must still get one created — immediately, now that the choice is made on loaded data.');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
