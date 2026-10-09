// validate-legal-acceptance.ts — the saved record of every acceptance and
// acknowledgement, the re-acceptance gate, and the tombstones account deletion
// leaves for signed records (lane PROTECT-SERVER).
//
// WHY THIS EXISTS. Until this lane nothing recorded that anyone agreed to the
// Terms of Service. The record is only worth having if (1) the words a person
// agreed to cannot change without the version changing, (2) every way of
// getting an account writes it, (3) writing it can never cost someone their
// sign-in, and (4) the server, not the phone, says who and when. This guard
// holds each of those, and the two acknowledgements and the deletion step that
// ride on the same table:
//
//   A. the words       the Terms and Privacy pages hash to the constants, the
//                      version is the page's own date, and a page that changes
//                      without its version changing fails; the exact hashed
//                      text of the current version is archived under
//                      docs/legal/versions and re-hashed here; the two notices'
//                      hashes are of the words on screen, English and Spanish.
//   B. the recorder    first acceptance wins, another account's entries are
//                      never read or sent, nothing carries a client time, a
//                      missing function is silent, a refusal is retried a few
//                      times further apart and then left, owed records survive
//                      the tenant wipe, and nothing ever rejects.
//   C. sign-in paths   a Terms or Privacy row means "signed in on a screen that
//                      DISPLAYED the sentence". One constant per screen says
//                      whether it does in this build, and the screen's own
//                      source is read against it. A sign-in records only from
//                      a screen whose constant is true; an email link (a
//                      confirmation, a sign-in link, a password reset) and a
//                      restored session never record; with the re-acceptance
//                      gate on, an existing account's sign-in never records. A
//                      sign-up with no session yet is noted under the new
//                      account's id and keeps its surface. Unawaited; a thrown
//                      recorder cannot reject a sign-in.
//   D. the gate        off by default, mounts nothing and reads nothing while
//                      off, and an unreadable answer never shows the sheet.
//   E. the notices     the code-answer notice and the scan notice record; the
//                      scan notice guards the three entry points.
//   F. the migrations  legal_acceptances: insert-only, server time, anon holds
//                      nothing, definer with an empty search_path. Tombstones:
//                      service role only, no personal column.
//   G. deletion        delete-account writes tombstones before any write and
//                      never lists the acceptance table.
//   H. registration    the scripts are in package.json and the ship-check chain.
//   I. mutations       planted in memory; each must turn its check red.
//
// The migrations' behaviour is proved on PGlite by scripts/pgq/*.mjs (not part
// of ship-check; see scripts/pgq/README.md).
//
// Run: bun run scripts/validate-legal-acceptance.ts

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceHash } from '../i18n/hash';

declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(src: string): string } };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

const F = {
  core: 'utils/legalAcceptanceCore.ts',
  wiring: 'utils/legalAcceptance.ts',
  auth: 'contexts/AuthContext.tsx',
  layout: 'app/_layout.tsx',
  reset: 'app/reset-password.tsx',
  gate: 'components/LegalGateHost.tsx',
  flags: 'constants/featureFlags.ts',
  copy: 'hooks/useLegalCopy.ts',
  codeCore: 'utils/codeAckCore.ts',
  codeHost: 'components/CodeAckHost.tsx',
  scanCore: 'utils/scanAckCore.ts',
  scanHook: 'hooks/useScanAck.ts',
  scanFlow: 'components/roomScan/RoomScanFlow.tsx',
  terms: 'marketing/terms.html',
  privacy: 'marketing/privacy.html',
  en: 'i18n/catalog/en/office.notices.generated.ts',
  es: 'i18n/catalog/es/office/notices.ts',
  migAccept: 'supabase/migrations/20261010100000_legal_acceptances.sql',
  migTomb: 'supabase/migrations/20261010110000_signed_record_tombstones.sql',
  del: 'supabase/functions/delete-account/index.ts',
  pkg: 'package.json',
  keys: 'utils/localCacheKeys.ts',
  signup: 'app/signup.tsx',
  login: 'app/login.tsx',
  docPrivacy: 'docs/legal/privacy-policy-versus-code.md',
  docDeletion: 'docs/legal/account-deletion-and-signed-records.md',
  archiver: 'scripts/archive-legal-text.ts',
} as const;
const ARCHIVE_DIR = 'docs/legal/versions';
type Files = Record<string, string>;
const loadFiles = (): Files => {
  const files: Files = Object.fromEntries(Object.values(F).map((f) => [f, read(f)]));
  // Every archived version, under its repo path.
  if (existsSync(path.join(ROOT, ARCHIVE_DIR))) {
    for (const name of readdirSync(path.join(ROOT, ARCHIVE_DIR))) if (name.endsWith('.txt')) files[`${ARCHIVE_DIR}/${name}`] = read(`${ARCHIVE_DIR}/${name}`);
  }
  return files;
};

const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const stripSql = (sql: string): string => sql.replace(/--[^\n]*/g, '');

const SCRATCH = mkdtempSync(path.join(tmpdir(), 'mageid-legal-'));
let seq = 0;
/** Transpile a dependency-free TS module to a scratch file and import it, so planted mutations really run. */
async function evalModule<T>(src: string): Promise<T> {
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(src);
  // A new folder per module: bun remembers a folder's listing after the first import from it.
  const file = path.join(mkdtempSync(path.join(SCRATCH, `m${seq++}-`)), 'module.mjs');
  writeFileSync(file, js);
  return (await import(file)) as T;
}

interface Core {
  TERMS_VERSION: string; PRIVACY_VERSION: string; TERMS_TEXT_SHA256: string; PRIVACY_TEXT_SHA256: string;
  SCAN_ACK_VERSION: string; SCAN_ACK_COPY: { title: string; body: string; button: string };
  SCAN_ACK_TEXT_SHA256: string; SCAN_ACK_TEXT_SHA256_ES: string; CODE_ACK_TEXT_SHA256: string;
  LEGAL_STORE_KEY: string; LEGAL_RPC: string; LEGAL_STORE_MAX_USERS: number; LEGAL_REFUSAL_MAX_TRIES: number; LEGAL_REFUSAL_BACKOFF_MS: number;
  TERMS_SENTENCE_ON_SIGNUP_SCREEN: boolean; TERMS_SENTENCE_ON_LOGIN_SCREEN: boolean;
  screenShowsTerms(s: string | null): boolean;
  signInAcceptanceSurface(i: { method: string; startedFrom?: string | null; user?: { created_at?: string | null; last_sign_in_at?: string | null } | null; reacceptOn: boolean }): string | null;
  reacceptStateWithLocal(state: string, store: unknown, uid: string | null, items?: unknown): string;
  normalizeLegalHtml(h: string): string;
  legalNoticeText(t: string, b: string): string;
  currentAgreementItems(): Array<{ kind: string; version: string; sha: string }>;
  scanAckItem(lang?: string): { kind: string; version: string; sha: string };
  codeAckItem(v: number): { kind: string; version: string; sha: string };
  isNewAccount(c?: string | null, l?: string | null): boolean;
  parseLegalStore(raw: string | null): { v: 1; byUser: Record<string, Record<string, { version: string; sha: string; surface: string; at: number; sent: boolean }>> };
  emptyLegalStore(): ReturnType<Core['parseLegalStore']>;
  noteLegalItem(s: unknown, uid: string, item: unknown, surface: string, at: number): { store: ReturnType<Core['parseLegalStore']>; changed: boolean };
  pendingLegalEntries(s: unknown, uid: string | null): Array<{ kind: string; entry: { version: string; sent: boolean } }>;
  legalRpcArgs(kind: string, entry: unknown, ctx: unknown): Record<string, unknown>;
  isMissingLegalFunction(m?: string | null): boolean;
  reacceptStateFromRows(rows: unknown, items?: unknown): string;
  shouldShowReaccept(flag: boolean, uid: string | null, state: string): boolean;
  createLegalRecorder(deps: unknown): { note(u: string | null, items: unknown[], surface: string, at?: number): Promise<void>; flush(u: string | null): Promise<void>; has(u: string | null, item: unknown): Promise<boolean> };
}
interface CodeCore {
  CODE_ACK_COPY: { title: string; body: string; button: string }; CODE_ACK_VERSION: number;
  createCodeAckGate(deps: unknown): { ensure(): Promise<boolean>; setHost(h: unknown): void };
}
interface ScanCore {
  SCAN_ACK_STORAGE_KEY: string;
  createScanAckGate(deps: unknown): { ensure(a: string | null, p: () => Promise<boolean>, on?: (at: Date) => void): Promise<boolean>; known(a: string | null): boolean };
}

/** What a page must satisfy: its words hash to the constant and its own date is the version. */
function pageMatches(core: Core, html: string, version: string, hash: string): { hashOk: boolean; dateOk: boolean; date: string } {
  const text = core.normalizeLegalHtml(html);
  const m = /Last updated:\s*([A-Za-z]+ \d{1,2}, \d{4})/.exec(text);
  let iso = '';
  if (m) {
    const d = new Date(`${m[1]} 12:00:00 UTC`);
    if (Number.isFinite(d.getTime())) iso = d.toISOString().slice(0, 10);
  }
  return { hashOk: sha(text) === hash, dateOk: iso === version, date: iso };
}

const A1 = '00000000-0000-4000-8000-0000000000a1';
const B2 = '00000000-0000-4000-8000-0000000000b2';
const memStore = () => {
  const m = new Map<string, string>();
  return { m, getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); } };
};

interface Result { name: string; pass: boolean; detail: string }

async function runChecks(files: Files): Promise<Result[]> {
  const results: Result[] = [];
  const ok = (name: string, pass: boolean, detail = ''): void => { results.push({ name, pass, detail }); };
  const core = await evalModule<Core>(files[F.core]);
  const codeCore = await evalModule<CodeCore>(files[F.codeCore]);
  const scanCore = await evalModule<ScanCore>(files[F.scanCore]);

  // ── A. the words ──
  {
    const t = pageMatches(core, files[F.terms], core.TERMS_VERSION, core.TERMS_TEXT_SHA256);
    const p = pageMatches(core, files[F.privacy], core.PRIVACY_VERSION, core.PRIVACY_TEXT_SHA256);
    ok('A1 marketing/terms.html hashes to TERMS_TEXT_SHA256 (a changed page needs a new version and hash in utils/legalAcceptanceCore.ts)', t.hashOk);
    ok('A2 TERMS_VERSION is the date printed on the Terms page', t.dateOk, `page says ${t.date}, constant says ${core.TERMS_VERSION}`);
    ok('A3 marketing/privacy.html hashes to PRIVACY_TEXT_SHA256', p.hashOk);
    ok('A4 PRIVACY_VERSION is the date printed on the Privacy page', p.dateOk, `page says ${p.date}, constant says ${core.PRIVACY_VERSION}`);
    // The self-test of the rule itself: an edited page with the old version must be caught.
    const edited = files[F.terms].replace('one hundred U.S. dollars', 'ten U.S. dollars');
    ok('A5 self-test: one changed word in the Terms, with the version left alone, is caught', edited !== files[F.terms] && pageMatches(core, edited, core.TERMS_VERSION, core.TERMS_TEXT_SHA256).hashOk === false);
    const cosmetic = files[F.terms].replace('<main id="main" class="legal">', '<main   id="main"\n class="legal" data-x="1">').replace(/<footer[\s\S]*<\/footer>/, '<footer>new footer</footer>');
    ok('A6 self-test: a change outside the words (markup, the site footer) does not force a new version', cosmetic !== files[F.terms] && pageMatches(core, cosmetic, core.TERMS_VERSION, core.TERMS_TEXT_SHA256).hashOk === true);
    ok('A7 the hash is of the words inside <main> only, tags and scripts removed',
      core.normalizeLegalHtml('<nav>Menu</nav><main class="x"><h1>A &amp; B</h1><script>x()</script>\n <p>c&nbsp;d</p></main><footer>F</footer>') === 'A & B c d');
    const items = core.currentAgreementItems();
    ok('A8 an account accepts exactly the Terms and the Privacy Policy, at their current version and hash',
      items.length === 2 && items[0].kind === 'terms' && items[0].version === core.TERMS_VERSION && items[0].sha === core.TERMS_TEXT_SHA256
      && items[1].kind === 'privacy' && items[1].version === core.PRIVACY_VERSION && items[1].sha === core.PRIVACY_TEXT_SHA256);

    const AGREED = 'A scan is a first measure. It can be off by an inch or more. Check before you order, cut, price or build from it.';
    ok('A9 the scan notice is the agreed sentence, word for word, with the button "I Understand"', core.SCAN_ACK_COPY.body === AGREED && core.SCAN_ACK_COPY.button === 'I Understand');
    ok('A10 SCAN_ACK_TEXT_SHA256 is the hash of the English title and body', sha(core.legalNoticeText(core.SCAN_ACK_COPY.title, core.SCAN_ACK_COPY.body)) === core.SCAN_ACK_TEXT_SHA256);
    const enVal = (key: string): string => { const m = new RegExp(`"${key.replace(/\./g, '\\.')}": ("(?:[^"\\\\]|\\\\.)*")`).exec(files[F.en]); return m ? JSON.parse(m[1]) as string : ''; };
    const esVal = (key: string): { s: string; src: string } => { const m = new RegExp(`"${key.replace(/\./g, '\\.')}": \\{ s: ("(?:[^"\\\\]|\\\\.)*"), src: "([0-9a-f]{8})" \\}`).exec(files[F.es]); return m ? { s: JSON.parse(m[1]) as string, src: m[2] } : { s: '', src: '' }; };
    ok('A11 the words on screen (the copy hook\'s English) are the words that are hashed',
      enVal('office.notices.scan.title') === core.SCAN_ACK_COPY.title && enVal('office.notices.scan.body') === core.SCAN_ACK_COPY.body && enVal('office.notices.scan.ackLabel') === core.SCAN_ACK_COPY.button);
    const esT = esVal('office.notices.scan.title'); const esB = esVal('office.notices.scan.body');
    ok('A12 SCAN_ACK_TEXT_SHA256_ES is the hash of the Spanish title and body a Spanish phone shows', esT.s !== '' && esB.s !== '' && sha(core.legalNoticeText(esT.s, esB.s)) === core.SCAN_ACK_TEXT_SHA256_ES);
    ok('A13 the Spanish was translated from the current English', esT.src === sourceHash(core.SCAN_ACK_COPY.title) && esB.src === sourceHash(core.SCAN_ACK_COPY.body));
    ok('A14 a Spanish phone records the Spanish hash, an English phone the English', core.scanAckItem('es').sha === core.SCAN_ACK_TEXT_SHA256_ES && core.scanAckItem('en').sha === core.SCAN_ACK_TEXT_SHA256 && core.scanAckItem().kind === 'scan_ack');
    ok('A15 CODE_ACK_TEXT_SHA256 is the hash of the code-answer notice (utils/codeAckCore CODE_ACK_COPY)', sha(core.legalNoticeText(codeCore.CODE_ACK_COPY.title, codeCore.CODE_ACK_COPY.body)) === core.CODE_ACK_TEXT_SHA256);
    for (const [kind, version, hash, page] of [['terms', core.TERMS_VERSION, core.TERMS_TEXT_SHA256, F.terms], ['privacy', core.PRIVACY_VERSION, core.PRIVACY_TEXT_SHA256, F.privacy]] as const) {
      const file = `${ARCHIVE_DIR}/${kind}-${version}-${hash.slice(0, 8)}.txt`;
      const text = files[file];
      ok(`A17 the exact hashed text of the current ${kind} version is archived at ${file}, hashes to the constant, and is the page's words (run: bun run scripts/archive-legal-text.ts)`,
        typeof text === 'string' && sha(text) === hash && text === core.normalizeLegalHtml(files[page]), typeof text === 'string' ? 'the file does not hash to the constant' : 'the file is missing');
    }
    ok('A18 the archive is written by the script that computes the hash, with the same normaliser, and never rewrites a version',
      /import \{[^}]*normalizeLegalHtml[^}]*\} from '\.\.\/utils\/legalAcceptanceCore';/.test(files[F.archiver]) && /createHash\('sha256'\)/.test(files[F.archiver])
      && /\$\{LEGAL_ARCHIVE_DIR\}\/\$\{kind\}-\$\{version\}-\$\{sha256\.slice\(0, 8\)\}\.txt/.test(files[F.archiver]) && /exists with DIFFERENT words/.test(files[F.archiver]));
    ok('A16 the re-acceptance sheet has no Spanish written by a build lane (a .legal. key is a human legal translator\'s)', !/office\.notices\.legal\./.test(stripComments(files[F.es])) && /'office\.notices\.legal\.reacceptTitle'/.test(files[F.copy]));
  }

  // ── B. the recorder ──
  {
    const item = { kind: 'terms', version: 'v1', sha: 'a'.repeat(64) };
    let s = core.emptyLegalStore();
    const r1 = core.noteLegalItem(s, A1, item, 'signup_email', 1000); s = r1.store;
    const r2 = core.noteLegalItem(s, A1, item, 'login_first', 9000);
    ok('B1 the first acceptance wins: a later sign-in does not replace the sign-up\'s surface or time', r1.changed && !r2.changed && r2.store.byUser[A1].terms.surface === 'signup_email' && r2.store.byUser[A1].terms.at === 1000);
    const r3 = core.noteLegalItem(s, A1, { ...item, version: 'v2' }, 'reaccept', 5000);
    ok('B2 a new version replaces the entry and is owed again', r3.changed && r3.store.byUser[A1].terms.version === 'v2' && r3.store.byUser[A1].terms.sent === false);
    ok('B3 another account\'s entries are never listed as owed', core.pendingLegalEntries(s, B2).length === 0 && core.pendingLegalEntries(s, null).length === 0 && core.pendingLegalEntries(s, A1).length === 1);
    ok('B4 a malformed store, a bad user id or a bad hash is dropped, never thrown on',
      core.pendingLegalEntries(core.parseLegalStore('{not json'), A1).length === 0
      && Object.keys(core.parseLegalStore(JSON.stringify({ v: 1, byUser: { 'not-a-uuid': { terms: { version: 'v', sha: 'a'.repeat(64), surface: 'in_app', at: 1, sent: false } }, [A1]: { terms: { version: 'v', sha: 'zz', surface: 'in_app', at: 1, sent: false } } } })).byUser).length === 0);
    const args = core.legalRpcArgs('terms', { version: 'v1', sha: 'a'.repeat(64), surface: 'signup_email', at: 1000, sent: false }, { appVersion: '1.0.0', updateId: '0198c5a2-7d3e-7b61-9f04-2c1d5e6f7a8b', platform: 'ios', now: 61000 });
    const keys = Object.keys(args).sort().join(',');
    ok('B5 the rpc carries kind, version, hash, surface, build, the over-the-air update id, platform and a delay: no user id and no time',
      keys === 'p_app_version,p_delay_ms,p_kind,p_platform,p_surface,p_text_sha256,p_update_id,p_version' && args.p_delay_ms === 60000 && args.p_update_id === '0198c5a2-7d3e-7b61-9f04-2c1d5e6f7a8b'
      && !Object.values(args).some((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)), keys);
    const neg = core.legalRpcArgs('terms', { version: 'v1', sha: 'a'.repeat(64), surface: 'in_app', at: 9000, sent: false }, { appVersion: '<script>', updateId: 'not an id!', platform: 'windows', now: 1000 });
    ok('B6 a clock that ran backwards, an odd build string, an odd update id and an unknown platform are sent as null', neg.p_delay_ms === null && neg.p_app_version === null && neg.p_platform === null && neg.p_update_id === null);

    // The recorder against a fake server.
    const mk = (opts: { session?: string | null | (() => string | null); clock?: () => number; reply?: (fn: string, a: Record<string, unknown>) => Promise<{ status: string; error?: string; data?: unknown }>; store?: ReturnType<typeof memStore> } = {}) => {
      const store = opts.store ?? memStore();
      const sent: Array<{ fn: string; args: Record<string, unknown> }> = [];
      const rec = core.createLegalRecorder({
        storage: store,
        send: async (fn: string, a: Record<string, unknown>) => { sent.push({ fn, args: a }); return opts.reply ? opts.reply(fn, a) : { status: 'synced', data: { ok: true, recorded: true } }; },
        sessionUserId: async () => (opts.session === undefined ? A1 : typeof opts.session === 'function' ? opts.session() : opts.session),
        now: opts.clock ?? (() => 5000), appVersion: () => '1.0.0', updateId: () => null, platform: () => 'ios',
      });
      return { rec, sent, store };
    };
    {
      const { rec, sent, store } = mk();
      await rec.note(A1, core.currentAgreementItems(), 'signup_email', 4000);
      const st = core.parseLegalStore(store.m.get(core.LEGAL_STORE_KEY) ?? null);
      ok('B7 a sign-up sends two rows (terms, privacy) through record_my_legal_acceptance and marks both sent',
        sent.length === 2 && sent.every((x) => x.fn === 'record_my_legal_acceptance') && sent[0].args.p_kind === 'terms' && sent[1].args.p_kind === 'privacy'
        && st.byUser[A1].terms.sent && st.byUser[A1].privacy.sent && core.pendingLegalEntries(st, A1).length === 0, JSON.stringify(sent.map((x) => x.args.p_kind)));
      await rec.note(A1, core.currentAgreementItems(), 'login_first', 4500);
      ok('B8 signing in again sends nothing more', sent.length === 2);
    }
    {
      const { rec, sent, store } = mk({ reply: async () => ({ status: 'failed', error: 'Could not find the function public.record_my_legal_acceptance(p_kind) in the schema cache (PGRST202)' }) });
      let threw = false;
      try { await rec.note(A1, core.currentAgreementItems(), 'signup_email'); await rec.flush(A1); await rec.flush(A1); } catch { threw = true; }
      const st = core.parseLegalStore(store.m.get(core.LEGAL_STORE_KEY) ?? null);
      ok('B9 before the migration is applied: silent, the record stays owed on the phone, and the server is asked once, not on every flush', !threw && sent.length === 1 && core.pendingLegalEntries(st, A1).length === 2, `sent ${sent.length}`);
    }
    {
      let online = false;
      const store = memStore();
      const a = mk({ store, reply: async () => (online ? { status: 'synced', data: { ok: true, recorded: true } } : { status: 'failed', error: 'Network request failed' }) });
      await a.rec.note(A1, core.currentAgreementItems(), 'signup_email', 1000);
      const owedOffline = core.pendingLegalEntries(core.parseLegalStore(store.m.get(core.LEGAL_STORE_KEY) ?? null), A1).length;
      online = true;
      await a.rec.flush(A1);
      const owedAfter = core.pendingLegalEntries(core.parseLegalStore(store.m.get(core.LEGAL_STORE_KEY) ?? null), A1).length;
      const last = a.sent[a.sent.length - 1];
      ok('B10 a sign-in with no signal is owed, and is sent when the phone is back, with the surface it happened on and how long it waited', owedOffline === 2 && owedAfter === 0 && last.args.p_surface === 'signup_email' && last.args.p_delay_ms === 4000, JSON.stringify({ owedOffline, owedAfter }));
    }
    {
      const { rec, sent } = mk({ session: B2 });
      await rec.note(A1, core.currentAgreementItems(), 'signup_email');
      ok('B11 nothing is sent on another account\'s session (the server would stamp the wrong person)', sent.length === 0);
    }
    {
      const boom = { getItem: async () => { throw new Error('disk'); }, setItem: async () => { throw new Error('disk'); } };
      const rec = core.createLegalRecorder({ storage: boom, send: async () => { throw new Error('net'); }, sessionUserId: async () => { throw new Error('auth'); } });
      let rejected = false;
      try {
        await rec.note(A1, core.currentAgreementItems(), 'signup_email');
        await rec.flush(A1);
        await rec.note(null, [], 'login_first');
        await rec.note('not-a-uuid', core.currentAgreementItems(), 'login_first');
        await rec.has(A1, core.currentAgreementItems()[0]);
      } catch { rejected = true; }
      ok('B12 with storage, the network and the session all throwing, note / flush / has still resolve', !rejected);
    }
    {
      const { rec, store } = mk({ reply: async () => ({ status: 'synced', data: { ok: false, reason: 'limit' } }) });
      await rec.note(A1, core.currentAgreementItems(), 'signup_email');
      ok('B13 an answer of ok:false does not mark the record sent', core.pendingLegalEntries(core.parseLegalStore(store.m.get(core.LEGAL_STORE_KEY) ?? null), A1).length === 2);
    }
    {
      // The server refuses every time. Two records are owed (terms, privacy), so each round of tries is 2 sends.
      let t = 0;
      const { rec, sent, store } = mk({ clock: () => t, reply: async () => ({ status: 'synced', data: { ok: false, reason: 'limit' } }) });
      await rec.note(A1, core.currentAgreementItems(), 'signup_email', 0);
      const afterNote = sent.length;
      await rec.flush(A1); await rec.flush(A1);
      const atOnce = sent.length;
      t = core.LEGAL_REFUSAL_BACKOFF_MS + 1; await rec.flush(A1); await rec.flush(A1);
      const second = sent.length;
      t += core.LEGAL_REFUSAL_BACKOFF_MS * 2; await rec.flush(A1);
      const tooSoon = sent.length;
      t += core.LEGAL_REFUSAL_BACKOFF_MS * 4; await rec.flush(A1);
      const third = sent.length;
      t += core.LEGAL_REFUSAL_BACKOFF_MS * 1000; for (let i = 0; i < 5; i++) await rec.flush(A1);
      const ever = sent.length;
      const owed = core.pendingLegalEntries(core.parseLegalStore(store.m.get(core.LEGAL_STORE_KEY) ?? null), A1).length;
      ok('B19 a refused record is not retried at every flush: it waits (one minute, then four), stops after three tries for this app start, and stays owed on the phone',
        afterNote === 2 && atOnce === 2 && second === 4 && tooSoon === 4 && third === 6 && ever === 6 && owed === 2 && core.LEGAL_REFUSAL_MAX_TRIES === 3,
        JSON.stringify({ afterNote, atOnce, second, tooSoon, third, ever, owed }));
    }
    {
      // An email sign-up with confirmation on: no session comes back. The tap is noted under the NEW account's id.
      let session: string | null = null;
      let t = 1000;
      const store = memStore();
      const { rec, sent } = mk({ store, clock: () => t, session: () => session });
      await rec.note(A1, core.currentAgreementItems(), 'signup_email', 1000);
      const sentBefore = sent.length;
      const owedBefore = core.pendingLegalEntries(core.parseLegalStore(store.m.get(core.LEGAL_STORE_KEY) ?? null), A1).length;
      // Three hours later the link is opened; the session arrives; the host flushes.
      t = 1000 + 3 * 60 * 60 * 1000; session = A1;
      await rec.flush(A1);
      ok('B20 a sign-up with no session yet is noted under the new account\'s id, sent nothing, and when the link is opened hours later is recorded as signup_email with the wait reported',
        sentBefore === 0 && owedBefore === 2 && sent.length === 2 && sent.every((x) => x.args.p_surface === 'signup_email' && x.args.p_delay_ms === 3 * 60 * 60 * 1000), JSON.stringify(sent.map((x) => [x.args.p_surface, x.args.p_delay_ms])));
    }
    {
      // has() sees a note made a moment ago, before its send has finished.
      let release: () => void = () => { /* set below */ };
      const gate = new Promise<void>((r) => { release = r; });
      const { rec } = mk({ reply: async () => { await gate; return { status: 'synced', data: { ok: true, recorded: true } }; } });
      const noting = rec.note(A1, core.currentAgreementItems(), 'signup_email');
      const seen = await rec.has(A1, core.currentAgreementItems()[0]);
      release(); await noting;
      ok('B21 has() answers from a note made a moment ago (after its write, without waiting for its send)', seen === true);
    }
    ok('B14 only "the function is missing" is treated as not-installed', core.isMissingLegalFunction('PGRST202 Could not find the function public.record_my_legal_acceptance') && !core.isMissingLegalFunction('permission denied for function record_my_legal_acceptance') && !core.isMissingLegalFunction('Network request failed') && !core.isMissingLegalFunction(null));
    {
      const now = '2026-10-09T12:00:00Z';
      const fresh = { created_at: now, last_sign_in_at: '2026-10-09T12:00:05Z' };
      const old = { created_at: '2026-01-01T00:00:00Z', last_sign_in_at: now };
      const S = core.signInAcceptanceSurface;
      const table = (c: Core, on: boolean): string => [
        c.signInAcceptanceSurface({ method: 'signup_email', user: fresh, reacceptOn: on }),
        c.signInAcceptanceSurface({ method: 'apple', startedFrom: 'signup', user: fresh, reacceptOn: on }),
        c.signInAcceptanceSurface({ method: 'google', startedFrom: 'signup', user: fresh, reacceptOn: on }),
        c.signInAcceptanceSurface({ method: 'apple', startedFrom: 'signup', user: old, reacceptOn: on }),
        c.signInAcceptanceSurface({ method: 'password', user: old, reacceptOn: on }),
        c.signInAcceptanceSurface({ method: 'apple', startedFrom: 'login', user: fresh, reacceptOn: on }),
        c.signInAcceptanceSurface({ method: 'google', startedFrom: 'login', user: old, reacceptOn: on }),
        c.signInAcceptanceSurface({ method: 'apple', user: fresh, reacceptOn: on }),
        c.signInAcceptanceSurface({ method: 'google', startedFrom: 'somewhere' as never, user: fresh, reacceptOn: on }),
      ].map((v) => v ?? '-').join(' ');
      ok('B15 as built (both the sign-up and the login screen show the sentence): a sign-up records; a password sign-in records login_first and Apple / Google from the login screen record; Apple / Google with no screen named record nothing',
        core.TERMS_SENTENCE_ON_SIGNUP_SCREEN === true && core.TERMS_SENTENCE_ON_LOGIN_SCREEN === true
        && table(core, false) === 'signup_email signup_apple signup_google login_first login_first signup_apple login_first - -', table(core, false));
      // The one-line change, made in memory: the login screen's constant false.
      const flippedSrc = files[F.core].replace('export const TERMS_SENTENCE_ON_LOGIN_SCREEN = true;', 'export const TERMS_SENTENCE_ON_LOGIN_SCREEN = false;');
      const flipped = flippedSrc === files[F.core] ? core : await evalModule<Core>(flippedSrc);
      ok('B22 with the login screen\'s constant false (the one-line change back), a password sign-in and Apple / Google from the login screen record NOTHING; a sign-up still records',
        flippedSrc !== files[F.core] && table(flipped, false) === 'signup_email signup_apple signup_google login_first - - - - -', table(flipped, false));
      const links = [core, flipped].flatMap((c) => [false, true].flatMap((on) => [fresh, old, null].map((u) => c.signInAcceptanceSurface({ method: 'email_link', startedFrom: 'login', user: u, reacceptOn: on }))));
      ok('B23 an email link (a confirmation, a sign-in link, a password reset) never records, whatever the constants and the account\'s age', links.length === 12 && links.every((v) => v === null), JSON.stringify(links));
      ok('B24 with the re-acceptance gate ON, an account that already existed records nothing at sign-in from any screen (signing out and back in cannot agree for it); a NEW account still records its sign-up',
        table(core, true) === 'signup_email signup_apple signup_google - - signup_apple - - -' && table(flipped, true) === 'signup_email signup_apple signup_google - - - - - -', `${table(core, true)} | ${table(flipped, true)}`);
      ok('B25 a restored session has no method and no screen: nothing names it, so nothing records it', S({ method: 'restore' as never, user: old, reacceptOn: false }) === null && core.screenShowsTerms(null) === false && core.screenShowsTerms('email') === false);
    }
    const wiring = stripComments(files[F.wiring]);
    ok('B16 the wiring sends through supabaseRpcOnline (never toasted, never on the Not-saved ledger) and never writes the table directly',
      /supabaseRpcOnline<unknown>\(fn, args\)/.test(wiring) && !/\.from\('legal_acceptances'\)\s*\.(insert|upsert|update|delete)/.test(wiring) && !/supabaseRpcDetailed|supabaseWrite\b/.test(wiring));
    {
      const keys = await evalModule<{ selectTenantKeysToWipe(all: string[], o?: { dropOfflineQueue?: boolean }): string[]; DEVICE_SCOPED_KEYS: string[] }>(files[F.keys]);
      const all = [core.LEGAL_STORE_KEY, scanCore.SCAN_ACK_STORAGE_KEY, 'mageid_projects'];
      const switchWipe = keys.selectTenantKeysToWipe(all, { dropOfflineQueue: true });
      const reauthWipe = keys.selectTenantKeysToWipe(all, { dropOfflineQueue: false });
      ok('B17 owed acceptance records survive a change of account and a sign-out (the store is a listed survivor of the sweep); the scan notice\'s own store and project data are still swept',
        core.LEGAL_STORE_KEY === 'mageid_legal_acceptance_v1' && !switchWipe.includes(core.LEGAL_STORE_KEY) && !reauthWipe.includes(core.LEGAL_STORE_KEY)
        && switchWipe.includes(scanCore.SCAN_ACK_STORAGE_KEY) && switchWipe.includes('mageid_projects'), JSON.stringify({ switchWipe, reauthWipe }));
      // Person A agrees with no signal; A signs out; B signs in (the sweep runs); A comes back.
      const store = memStore();
      let session: string | null = A1;
      let online = false;
      const a = mk({ store, session: () => session, reply: async () => (online ? { status: 'synced', data: { ok: true, recorded: true } } : { status: 'failed', error: 'Network request failed' }) });
      await a.rec.note(A1, core.currentAgreementItems(), 'signup_email', 1000);
      for (const k of keys.selectTenantKeysToWipe([...store.m.keys()], { dropOfflineQueue: true })) store.m.delete(k);
      session = B2; online = true;
      const beforeB = a.sent.length;
      await a.rec.flush(B2);
      const sentAsB = a.sent.length - beforeB;
      session = A1;
      await a.rec.flush(A1);
      const st = core.parseLegalStore(store.m.get(core.LEGAL_STORE_KEY) ?? null);
      ok('B26 run: A agrees offline, B signs in on the same phone (the tenant sweep runs), A returns: A\'s two records are still there, were never sent on B\'s session, and land on A\'s',
        sentAsB === 0 && core.pendingLegalEntries(st, A1).length === 0 && st.byUser[A1]?.terms?.sent === true && st.byUser[A1]?.privacy?.sent === true && a.sent.length === beforeB + 2, JSON.stringify({ sent: a.sent.length, sentAsB }));
    }
    {
      let st = core.emptyLegalStore();
      const item = { kind: 'terms', version: 'v1', sha: 'a'.repeat(64) };
      const id = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      // Account 1 still owes its record; the rest are marked sent as they go.
      st = core.noteLegalItem(st, id(1), item, 'signup_email', 1).store;
      for (let i = 2; i <= 20; i++) {
        st = core.noteLegalItem(st, id(i), item, 'signup_email', i).store;
        st.byUser[id(i)].terms.sent = true;
      }
      const ids = Object.keys(st.byUser);
      ok('B18 the surviving store is capped: 20 accounts noted leaves 12, the account being written and an account that still owes a record among them',
        core.LEGAL_STORE_MAX_USERS === 12 && ids.length === 12 && ids.includes(id(20)) && ids.includes(id(1)) && !ids.includes(id(2)), JSON.stringify(ids.map((x) => Number(x.slice(-4)))));
    }
  }

  // ── C. sign-in paths ──
  {
    const auth = stripComments(files[F.auth]);
    const sigAt = auth.indexOf('const completeSignIn = useCallback(async (');
    const sigEnd = auth.indexOf('}, [queryClient]);', sigAt);
    const body = sigAt === -1 ? '' : auth.slice(sigAt, sigEnd);
    ok('C1 completeSignIn takes the sign-in method and the screen Apple / Google was started on, and hands the user and both to the recorder', /method: SignInMethod,\s*startedFrom\?: SignInScreen,\s*\) => \{/.test(body) && /\n\s*recordSignInAcceptance\(signedIn, method, startedFrom\);/.test(body));
    ok('C2 the note is made AFTER the tenant wipe and the last-user marker, so it is not swept with the previous account\'s keys',
      body.indexOf('recordSignInAcceptance(') > body.indexOf('await writeLastUser(incoming);') && body.indexOf('await writeLastUser(incoming);') > body.indexOf('await dropPendingWrites();'));
    const calls = [...auth.matchAll(/await completeSignIn\(([^;]*)\);/g)].map((m) => m[1]);
    const parsed = calls.map((c) => /, '(password|signup_email|apple|google)'(, startedFrom)?$/.exec(c.trim()));
    const methods = parsed.map((m) => (m ?? [])[1]);
    const screened = parsed.every((m) => !!m && ((m[1] === 'apple' || m[1] === 'google') ? m[2] === ', startedFrom' : m[2] === undefined));
    ok('C3 every completeSignIn call names its method: password, email sign-up, Google (three ways) and Apple (two ways); every Apple and Google call passes on the screen it was started from',
      calls.length === 7 && methods.every((m) => !!m) && screened && methods.filter((m) => m === 'google').length === 3 && methods.filter((m) => m === 'apple').length === 2
      && methods.includes('password') && methods.includes('signup_email'), JSON.stringify(calls));
    // Every call that creates a session sits in a callback that reaches completeSignIn.
    const creators = [...auth.matchAll(/supabase\.auth\.(signInWithPassword|signUp|signInWithIdToken|setSession|verifyOtp|exchangeCodeForSession)\(/g)];
    const blocks = auth.split(/\n  const (?=[A-Za-z]+ = useCallback\()/);
    const uncovered: string[] = [];
    for (const blk of blocks) {
      if (!/supabase\.auth\.(signInWithPassword|signUp|signInWithIdToken|setSession|verifyOtp|exchangeCodeForSession)\(/.test(blk)) continue;
      if (!/await completeSignIn\(/.test(blk)) uncovered.push(blk.slice(0, 40).split(' ')[0]);
    }
    ok('C4 every AuthContext callback that creates a session (password, sign-up, id token, setSession) reaches completeSignIn', creators.length >= 6 && uncovered.length === 0, uncovered.join(', '));
    const nseAt = auth.indexOf('const onNewSessionEstablished = useCallback(');
    const nse = auth.slice(nseAt, auth.indexOf('onNewSessionRef.current = ', nseAt));
    ok('C5 the email-link path (a confirmed sign-up, a sign-in link, a password reset, a crew claim link) records NOTHING: no recorder call anywhere in onNewSessionEstablished',
      nseAt !== -1 && nse.length > 500 && !/recordSignInAcceptance|recordReacceptance|legalAcceptance/.test(nse));
    const restore = [...auth.matchAll(/onAuthStateChange\(|getSession\(\)|refreshSession\(/g)].length;
    ok('C12 the recorder is reached from exactly two places in AuthContext: completeSignIn and the sign-up that is waiting for its confirmation link. No session listener, restore or refresh calls it',
      restore >= 2 && [...auth.matchAll(/recordSignInAcceptance\(([^)]*)\)/g)].map((m) => m[1]).join(' | ') === "signedIn, method, startedFrom | data.user, 'signup_email'", [...auth.matchAll(/recordSignInAcceptance\(([^)]*)\)/g)].map((m) => m[1]).join(' | '));
    const suAt = auth.indexOf('const signup = useCallback(');
    const su = auth.slice(suAt, auth.indexOf("console.log('[Auth] Signup successful')", suAt));
    ok('C13 a sign-up with no session yet notes the acceptance under the new account\'s id, after the "already exists" answer (a made-up id) has been refused',
      /if \(data\.session\) \{[\s\S]*?await completeSignIn\(data\.user, handoff, 'signup_email'\);\s*\} else \{\s*recordSignInAcceptance\(data\.user, 'signup_email'\);\s*\}/.test(su)
      && su.indexOf('identities?.length') !== -1 && su.indexOf('identities?.length') < su.indexOf("recordSignInAcceptance(data.user, 'signup_email')"));
    ok('C14 Apple and Google take the screen they were started on, and default to the login screen (whose constant decides)',
      /const signInWithGoogle = useCallback\(async \(startedFrom: SignInScreen = 'login'\): Promise<boolean> => \{/.test(auth) && /const signInWithApple = useCallback\(async \(startedFrom: SignInScreen = 'login'\): Promise<boolean> => \{/.test(auth));
    const signup = stripComments(files[F.signup]);
    const login = stripComments(files[F.login]);
    ok('C15 the sign-up screen says so when it starts Apple or Google', /await signInWithGoogle\('signup'\)/.test(signup) && /await signInWithApple\('signup'\)/.test(signup) && !/signInWith(Google|Apple)\('signup'\)/.test(login));
    // The sentence is either typed on the screen or drawn by the shared <AgreementNotice /> (components/AgreementNotice.tsx).
    const sentence = (src: string): boolean => (/Terms of Service/.test(src) && /Privacy Policy/.test(src) && /agree/i.test(src)) || /<AgreementNotice\b/.test(src);
    ok('C16 TERMS_SENTENCE_ON_SIGNUP_SCREEN is true and app/signup.tsx displays the sentence, with a link to each document',
      core.TERMS_SENTENCE_ON_SIGNUP_SCREEN === true && /<AgreementNotice testID="signup-agreement"/.test(signup) && sentence(signup)
      // WEBCANCEL: the sentence is shown once, by the shared notice; the links live in the component.
      && !/By creating an account you agree to our/.test(signup)
      && /mageid\.app\/terms/.test(readFileSync(path.join(ROOT, 'components/ProtectNotices.tsx'), 'utf8')) && /mageid\.app\/privacy/.test(readFileSync(path.join(ROOT, 'components/ProtectNotices.tsx'), 'utf8')));
    ok('C17 TERMS_SENTENCE_ON_LOGIN_SCREEN is true ONLY IF app/login.tsx displays the sentence (today it does, and the constant is true)',
      core.TERMS_SENTENCE_ON_LOGIN_SCREEN === false || sentence(login), 'the constant says the login screen shows the Terms sentence and app/login.tsx does not contain it');
    // The two files that call setSession themselves must go on to onNewSessionEstablished.
    for (const f of [F.layout, F.reset]) {
      const src = stripComments(files[f]);
      ok(`C6 ${f} sets a session from a link and then calls onNewSessionEstablished`, !/supabase\.auth\.setSession\(/.test(src) || /await onNewSessionEstablished\(/.test(src));
    }
    ok('C7 the recorder is never awaited by a sign-in path', !/await\s+recordSignInAcceptance\(/.test(auth) && [...auth.matchAll(/recordSignInAcceptance\(/g)].length === 2);
    const wiring = stripComments(files[F.wiring]);
    const fnAt = wiring.indexOf('export function recordSignInAcceptance(');
    const fn = wiring.slice(fnAt, wiring.indexOf('\nexport ', fnAt + 10));
    ok('C8 recordSignInAcceptance returns void and its whole body is inside try / catch, with the promise\'s rejection swallowed',
      /\): void \{\s*try \{/.test(fn) && /\} catch \{[^}]*\}\s*\}\s*$/.test(fn.trim()) && /void recorder\.note\([^;]*\)\.catch\(/.test(fn), fn.slice(0, 80));
    ok('C11 recordSignInAcceptance notes only what the one decision allows: the surface comes from signInAcceptanceSurface with the real re-acceptance flag, and no surface means no note',
      /const surface = signInAcceptanceSurface\(\{ method, startedFrom, user, reacceptOn: TERMS_REACCEPT_ENABLED \}\);\s*if \(!surface\) return;\s*void recorder\.note\(user\.id, currentAgreementItems\(\), surface\)/.test(fn)
      && /import \{ TERMS_REACCEPT_ENABLED \} from '@\/constants\/featureFlags';/.test(wiring));
    // The behaviour: a sign-in built the way completeSignIn is, with a recorder that throws, still resolves.
    {
      const throwing = (): void => { throw new Error('recorder exploded'); };
      const safe = (user: { id: string } | null): void => { try { if (!user?.id) return; throwing(); } catch { /* never surfaces */ } };
      let signedIn = false;
      const signIn = async (): Promise<string> => { safe({ id: A1 }); signedIn = true; return 'user'; };
      let rejected = false;
      try { await signIn(); } catch { rejected = true; }
      ok('C9 self-test of the shape: a recorder that throws inside the guarded call does not reject the sign-in', !rejected && signedIn);
    }
    ok('C10 every exported recorder call in the wiring swallows a rejection', [...wiring.matchAll(/recorder\.(note|flush)\(/g)].length === [...wiring.matchAll(/recorder\.(note|flush)\([^;]*\)\.catch\(/g)].length && [...wiring.matchAll(/recorder\.(note|flush)\(/g)].length >= 5);
  }

  // ── D. the gate ──
  {
    ok('D1 TERMS_REACCEPT_ENABLED is false', /^export const TERMS_REACCEPT_ENABLED = false;$/m.test(files[F.flags]));
    const gate = stripComments(files[F.gate]);
    ok('D2 with the flag off (or signed out) the host returns before the gate component is mounted', /if \(!TERMS_REACCEPT_ENABLED \|\| !userId\) return null;\s*return <ReacceptGate userId=\{userId\} \/>;/.test(gate));
    const hostAt = gate.indexOf('export default function LegalGateHost()');
    ok('D3 the account\'s rows are read only inside the gate component, never by the host', hostAt !== -1 && !/readReacceptState\(/.test(gate.slice(hostAt)) && /readReacceptState\(userId\)/.test(gate.slice(0, hostAt)));
    ok('D4 the sheet shows only through shouldShowReaccept(flag, user, state)', /const visible = shouldShowReaccept\(TERMS_REACCEPT_ENABLED, userId, state\) && !agreedHere;\s*useSheetDialogScope\(visible\);\s*if \(!visible\) return null;/.test(gate));
    const T = core.shouldShowReaccept;
    ok('D5 the rule: shown only for flag on + signed in + a row known to be missing',
      T(true, A1, 'needed') === true && T(false, A1, 'needed') === false && T(true, null, 'needed') === false && T(true, A1, 'unknown') === false && T(true, A1, 'accepted') === false && T(false, A1, 'unknown') === false);
    const items = core.currentAgreementItems();
    const rowsOk = items.map((i) => ({ kind: i.kind, version: i.version, text_sha256: i.sha }));
    ok('D6 rows that could not be read are "unknown" (nobody is asked or blocked); a missing or older row is "needed"; both current rows are "accepted"',
      core.reacceptStateFromRows(null) === 'unknown' && core.reacceptStateFromRows(undefined) === 'unknown' && core.reacceptStateFromRows([]) === 'needed'
      && core.reacceptStateFromRows([rowsOk[0]]) === 'needed' && core.reacceptStateFromRows([{ ...rowsOk[0], version: '2020-01-01' }, rowsOk[1]]) === 'needed'
      && core.reacceptStateFromRows([rowsOk[0], { ...rowsOk[1], text_sha256: 'f'.repeat(64) }]) === 'needed' && core.reacceptStateFromRows(rowsOk) === 'accepted');
    const wiring = stripComments(files[F.wiring]);
    {
      const items = core.currentAgreementItems();
      let st = core.emptyLegalStore();
      st = core.noteLegalItem(st, A1, items[0], 'signup_email', 1).store;
      const one = core.reacceptStateWithLocal('needed', st, A1);
      st = core.noteLegalItem(st, A1, items[1], 'signup_email', 1).store;
      ok('D11 a person who agreed a moment ago on this phone is not asked again while the record is on its way: "needed" becomes "accepted" only when BOTH current documents are noted here for THIS account; "unknown" stays unknown',
        one === 'needed' && core.reacceptStateWithLocal('needed', st, A1) === 'accepted' && core.reacceptStateWithLocal('needed', st, B2) === 'needed'
        && core.reacceptStateWithLocal('unknown', st, A1) === 'unknown' && core.reacceptStateWithLocal('needed', st, null) === 'needed');
      ok('D12 the wiring asks the recorder for both documents before it answers "needed", and "I Agree" records under the surface reaccept',
        /const noted = await Promise\.all\(items\.map\(\(item\) => recorder\.has\(userId, item\)\)\);\s*return noted\.every\(Boolean\) \? 'accepted' : 'needed';/.test(wiring)
        && /return recorder\.note\(userId, currentAgreementItems\(\), 'reaccept'\)/.test(wiring));
    }
    ok('D7 a read error answers "unknown"', /if \(error \|\| !Array\.isArray\(data\)\) return 'unknown';/.test(wiring) && /\} catch \{\s*return 'unknown';/.test(wiring));
    ok('D8 the sheet has no dismiss: two buttons, I Agree and Sign Out, and a no-op on the hardware back', /onRequestClose=\{\(\) => \{[^}]*\}\}/.test(files[F.gate]) && /testID="legal-reaccept-agree"/.test(gate) && /testID="legal-reaccept-signout"/.test(gate) && !/onDismiss|closeLabel|Not Now/.test(gate));
    ok('D9 the host is mounted once in the root layout', [...files[F.layout].matchAll(/<LegalGateHost \/>/g)].length === 1);
    ok('D10 the host sends what is owed at a change of account and at foreground, flag or no flag', gate.indexOf('void flushLegalAcceptances(userId);') !== -1 && gate.indexOf('void flushLegalAcceptances(userId);') < gate.indexOf('if (!TERMS_REACCEPT_ENABLED || !userId) return null;') && /s === 'active' && userIdRef\.current\) void flushLegalAcceptances\(/.test(gate));
  }

  // ── E. the notices ──
  {
    // The code-answer notice: a fresh tap tells the host, with who and when.
    const told: Array<{ account: string | null; version: number }> = [];
    const gate = codeCore.createCodeAckGate({ storage: memStore(), now: () => new Date('2026-10-09T12:00:00Z') });
    gate.setHost({ accountId: () => A1, prompt: async () => true, acknowledged: (account: string | null, _at: Date, version: number) => { told.push({ account, version }); } });
    const first = await gate.ensure();
    const second = await gate.ensure();
    ok('E1 the code-answer notice tells its host once, on the tap, with the account and the notice version', first && second && told.length === 1 && told[0].account === A1 && told[0].version === codeCore.CODE_ACK_VERSION, JSON.stringify(told));
    const g2 = codeCore.createCodeAckGate({ storage: memStore() });
    g2.setHost({ accountId: () => A1, prompt: async () => true, acknowledged: () => { throw new Error('recorder down'); } });
    let ok2 = false; try { ok2 = await g2.ensure(); } catch { ok2 = false; }
    const g3 = codeCore.createCodeAckGate({ storage: memStore() });
    const told3: number[] = [];
    g3.setHost({ accountId: () => A1, prompt: async () => false, acknowledged: () => { told3.push(1); } });
    ok('E2 a host that throws does not undo the acknowledgement; a dismissed notice tells nobody', ok2 === true && (await g3.ensure()) === false && told3.length === 0);
    const host = stripComments(files[F.codeHost]);
    ok('E3 CodeAckHost records the tap through the recorder, and sends an acknowledgement already on this phone once', /acknowledged: \(account, at, version\) => recordCodeAck\(account, version, at\.getTime\(\)\)/.test(host) && /if \(rec && id && rec\.account === id\) recordCodeAck\(id, rec\.v, Date\.parse\(rec\.at\)\);/.test(host));

    // The scan notice.
    const store = memStore();
    const sg = scanCore.createScanAckGate({ storage: store, now: () => new Date('2026-10-09T12:00:00Z') });
    let asked = 0; const recorded: Date[] = [];
    const dismissed = await sg.ensure(A1, async () => { asked++; return false; }, (at) => recorded.push(at));
    const stillUnknown = !sg.known(A1) && !store.m.has(scanCore.SCAN_ACK_STORAGE_KEY);
    const yes = await sg.ensure(A1, async () => { asked++; return true; }, (at) => recorded.push(at));
    const again = await sg.ensure(A1, async () => { asked++; return true; }, (at) => recorded.push(at));
    ok('E4 the scan notice: a dismissal is not an acknowledgement; a tap is, once; it is recorded once', dismissed === false && stillUnknown && yes && again && asked === 2 && recorded.length === 1 && sg.known(A1));
    const other = await sg.ensure(B2, async () => { asked++; return true; }, (at) => recorded.push(at));
    ok('E5 the next person on the phone is asked for themselves', other && asked === 3 && recorded.length === 2);
    // The device record now names B2 (the last to tap).
    const sg2 = scanCore.createScanAckGate({ storage: store });
    const honoured = await sg2.ensure(B2, async () => { throw new Error('must not ask'); });
    const sg3 = scanCore.createScanAckGate({ storage: store });
    let askedA = 0;
    const notMine = await sg3.ensure(A1, async () => { askedA++; return false; });
    ok('E6 a stored acknowledgement is honoured with no prompt for the account that gave it, and never taken for another account', honoured === true && notMine === false && askedA === 1);
    const hook = stripComments(files[F.scanHook]);
    ok('E7 the hook shows the copy hook\'s words in an alert that cannot be tapped away, and records in the language shown',
      /showAlert\(\s*shown\.scanTitle,\s*shown\.scanBody,\s*\[\{ text: shown\.scanAckLabel, onPress: \(\) => settle\(true\) \}\],\s*\{ cancelable: false, onDismiss: \(\) => settle\(false\) \},/.test(hook)
      && /recordScanAck\(userId, shownLang, at\.getTime\(\)\)/.test(hook));
    const flow = stripComments(files[F.scanFlow]);
    const startAt = flow.indexOf('const startScan = useCallback(async () => {');
    const start = flow.slice(startAt, flow.indexOf('RoomScanNative.startScan(', startAt));
    ok('E8 starting a scan waits on the notice before it turns busy or touches the scanner', /if \(busy\) return;\s*if \(!scanAck\.known\(\) && !\(await scanAck\.ensure\(\)\)\) return;\s*setBusy\(true\);/.test(start));
    ok('E9 Clearance Check and the Order List open only through the notice',
      /clearance=\{clearanceOn \? \{ label: ccopy\.openLabel, onPress: \(\) => afterScanAck\(\(\) => setStep\('clearance'\)\) \} : undefined\}/.test(flow)
      && /order=\{\{ label: ocopy\.openLabel, onPress: \(\) => afterScanAck\(\(\) => \{ setOrderSend\('idle'\); setStep\('order'\); \}\) \}\}/.test(flow)
      && [...flow.matchAll(/setStep\('clearance'\)/g)].length === 1 && [...flow.matchAll(/setStep\('order'\)/g)].length === 1);
    ok('E10 afterScanAck goes on only for a known acknowledgement or a true answer', /if \(scanAck\.known\(\)\) \{ go\(\); return; \}\s*void scanAck\.ensure\(\)\.then\(\(ok\) => \{ if \(ok\) go\(\); \}\);/.test(flow));
    ok('E11 the scanner\'s own gate is untouched: the flow still asks clearanceCheckAllowed and the route its own gate', /clearanceCheckAllowed\(userEmail\)/.test(flow));
  }

  // ── F. the migrations ──
  {
    const sql = stripSql(files[F.migAccept]);
    const SIG = 'text, text, text, text, text, text, bigint, text';
    ok('F1 row level security is on and the one policy is own-rows SELECT for authenticated',
      /alter table public\.legal_acceptances enable row level security;/.test(sql)
      && /create policy legal_acceptances_read_own on public\.legal_acceptances\s+for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\);/.test(sql)
      && [...sql.matchAll(/create policy /g)].length === 1);
    ok('F2 insert-only: every privilege is revoked from clients and the service role, and only SELECT is granted back',
      /revoke all on public\.legal_acceptances from public, anon, authenticated, service_role;/.test(sql)
      && /grant select on public\.legal_acceptances to authenticated;/.test(sql) && /grant select on public\.legal_acceptances to service_role;/.test(sql)
      && !/grant[^;]*\b(insert|update|delete|all)\b[^;]*on public\.legal_acceptances/i.test(sql));
    ok('F3 anon holds nothing: no table grant, and the recorder is revoked from public and anon and granted to authenticated only',
      !/grant[^;]*on public\.legal_acceptances to[^;]*\banon\b/.test(sql)
      && sql.includes(`revoke all on function public.record_my_legal_acceptance(${SIG}) from public, anon;`)
      && sql.includes(`grant execute on function public.record_my_legal_acceptance(${SIG}) to authenticated;`)
      && [...sql.matchAll(/grant execute on function public\.record_my_legal_acceptance/g)].length === 1);
    const fnAt = sql.indexOf('create or replace function public.record_my_legal_acceptance(');
    const fn = sql.slice(fnAt, sql.indexOf('$function$;', fnAt));
    ok('F4 the recorder is SECURITY DEFINER with an empty search_path', /returns jsonb\s+language plpgsql\s+security definer\s+set search_path to ''\s+as \$function\$/.test(fn));
    ok('F5 the user id is auth.uid() and no argument can name a person', /v_uid uuid := auth\.uid\(\);/.test(fn) && !/p_user|p_uid|p_subject/.test(fn) && /if v_uid is null then\s+raise exception/.test(fn));
    ok('F6 the time is the server\'s: the insert stamps clock_timestamp(), no argument is a time, and the delay is stored beside it, never subtracted',
      /pg_catalog\.clock_timestamp\(\), v_delay\)/.test(fn) && !/p_[a-z_]*(_at|time|timestamp|date)\b/.test(fn) && !/clock_timestamp\(\)\s*-/.test(fn) && !/now\(\)\s*-/.test(fn));
    ok('F7 a retry writes nothing twice (one row per person, kind, version and words)', /create unique index if not exists legal_acceptances_once\s+on public\.legal_acceptances \(user_id, kind, version, text_sha256\) where user_id is not null;/.test(sql) && /on conflict \(user_id, kind, version, text_sha256\) where user_id is not null do nothing/.test(fn));
    ok('F8 nothing is changed or removed: a BEFORE UPDATE OR DELETE trigger on every row', /create trigger legal_acceptances_keep\s+before update or delete on public\.legal_acceptances\s+for each row execute function public\.legal_acceptances_keep\(\);/.test(sql) && /a recorded acceptance is never deleted/.test(sql) && /a recorded acceptance is never changed/.test(sql));
    ok('F9 account deletion keeps the row: the foreign key is ON DELETE SET NULL and the row carries a non-reversible marker', /user_id\s+uuid references auth\.users\(id\) on delete set null,/.test(sql) && /pg_catalog\.sha256\(pg_catalog\.convert_to\('mageid:legal_acceptance:v1:' \|\| v_uid::text, 'UTF8'\)\)/.test(fn));
    const tableAt = sql.indexOf('create table if not exists public.legal_acceptances (');
    const table = sql.slice(tableAt, sql.indexOf('\n);', tableAt));
    ok('F10 the table has no IP address, user agent, email, name or token column', !/^\s*(ip|ip_address|user_agent|email|name|token|access_token)\s/m.test(table) && /accepted_at\s+timestamptz not null default now\(\),/.test(table));
    ok('F17 the kinds are a closed list inside the recorder, checked before the per-person limit is counted (junk kinds cannot fill it)',
      /if p_kind not in \('terms', 'privacy', 'code_answer_ack', 'scan_ack'\) then\s+raise exception/.test(fn) && fn.indexOf("if p_kind not in ('terms'") < fn.indexOf('select count(*) into v_count')
      && fn.indexOf("if p_kind not in ('terms'") !== -1);
    ok('F18 the over-the-air update id is a column, checked, stored by the recorder and frozen by the keep trigger',
      /^\s*update_id\s+text,$/m.test(table) && /constraint legal_acceptances_update_id_check\s+check \(update_id is null or update_id ~ '\^\[A-Za-z0-9-\]\{1,64\}\$'\)/.test(table)
      && /p_update_id text default null/.test(fn) && /v_app, v_platform, v_update,/.test(fn) && /and new\.update_id is not distinct from old\.update_id/.test(sql));
    ok('F19 the header says what a row means (a screen that displayed the sentence) and that this file goes on before or with the app update',
      /ON A SCREEN THAT DISPLAYED the sentence/.test(files[F.migAccept]) && /Apply this BEFORE the app update, or together with it/.test(files[F.migAccept]) && !/Any order is safe/.test(files[F.migAccept]));
    ok('F11 a signed-in account cannot write a no-account surface', /if p_surface in \('portal', 'signing_link'\) then\s+raise exception/.test(fn));

    const tomb = stripSql(files[F.migTomb]);
    ok('F12 tombstones: RLS on, no policy, nothing for clients, SELECT only for the service role',
      /alter table public\.signed_record_tombstones enable row level security;/.test(tomb) && !/create policy/.test(tomb)
      && /revoke all on public\.signed_record_tombstones from public, anon, authenticated, service_role;/.test(tomb) && /grant select on public\.signed_record_tombstones to service_role;/.test(tomb)
      && !/grant[^;]*on public\.signed_record_tombstones to[^;]*(anon|authenticated)/.test(tomb));
    ok('F13 the tombstone writer is SECURITY DEFINER with an empty search_path, for the service role only',
      /create or replace function public\.tombstone_signed_records\([\s\S]{0,200}?\)\s+returns jsonb\s+language plpgsql\s+security definer\s+set search_path to ''/.test(tomb)
      && /revoke all on function public\.tombstone_signed_records\(uuid, text\[\], text\[\]\) from public, anon, authenticated;/.test(tomb)
      && /grant execute on function public\.tombstone_signed_records\(uuid, text\[\], text\[\]\) to service_role;/.test(tomb));
    const tTableAt = tomb.indexOf('create table if not exists public.signed_record_tombstones (');
    const tTable = tomb.slice(tTableAt, tomb.indexOf('\n);', tTableAt));
    {
      const said = [files[F.migTomb], files[F.del], files[F.docDeletion], files[F.docPrivacy]];
      const claim = /\bno personal data\b(?!")/i;
      ok('F20 nothing says a tombstone holds "no personal data": the migration, the function and both legal notes say what is kept (a one-way hash of the signed row and of the account id) and call it pseudonymous',
        !claim.test(files[F.migTomb].replace(/not "no\s+--\s+personal data"/, '')) && !claim.test(files[F.del]) && !/no personal data\./i.test(files[F.docDeletion].replace(/not the same as "no personal data"\./, ''))
        && said.every((t) => /pseudonymous/.test(t)) && /\| 19 \| \*\*Tombstones of signed records\.\*\*/.test(files[F.docPrivacy]) && /one-way hashes of the document and of the account ID/.test(files[F.docPrivacy]));
      ok('F21 the legal note says what stays exposed after the bucket is private, proposes the next tightening, and says where the hashed words are kept and that the hash is of the repo file',
        /## Posting Photos And Drawings: What Stays Exposed/.test(files[F.docPrivacy]) && /Any signed-in account can read the files of every OPEN posting/.test(files[F.docPrivacy])
        && /chooses how long its link lives/.test(files[F.docPrivacy]) && /Proposed next tightening \(not built/.test(files[F.docPrivacy])
        && /## Which Words: The Archive/.test(files[F.docPrivacy]) && /The hash is of the file in this repository/.test(files[F.docPrivacy]) && /Netlify deploys it on a push to `main`/.test(files[F.docPrivacy]));
    }
    ok('F14 a tombstone has no column that names a person and no account id', !/^\s*(user_id|signer_name|signer_email|name|email|signature_data|amount|ip|user_agent|token)\s/m.test(tTable));
    ok('F15 the writer re-checks that every project is the account\'s own, and leaves the waiver\'s signing key out of the hash', /where p\.user_id = p_user_id and p\.id::text = any \(p_project_ids\);/.test(tomb) && /\(pg_catalog\.to_jsonb\(w\) - 'sign_token'\)::text/.test(tomb));
    ok('F16 neither migration alters or adds a trigger to change_order_approvals or lien_waivers (another lane owns them)',
      !/(alter table|create trigger[^;]*on) public\.(change_order_approvals|lien_waivers)/.test(tomb) && !/(change_order_approvals|lien_waivers)/.test(sql));
  }

  // ── G. deletion ──
  {
    const del = stripComments(files[F.del]);
    const serveAt = del.indexOf('serve(async (req) => {');
    const body = del.slice(serveAt);
    const tombAt = body.indexOf("sb.rpc('tombstone_signed_records'");
    const firstWrite = Math.min(...['.update(', '.delete()', '.remove(', 'auth.admin.deleteUser('].map((w) => { const i = body.indexOf(w); return i === -1 ? Number.MAX_SAFE_INTEGER : i; }));
    ok('G1 delete-account writes tombstones before its first update, delete, storage remove or login delete', tombAt !== -1 && tombAt < firstWrite, `tombstone at ${tombAt}, first write at ${firstWrite}`);
    ok('G2 and after the read pass has succeeded (it needs the owned project and portal lists)', tombAt > body.indexOf('collected = await collectTenantKeys();') && tombAt > body.indexOf('const { projectIds, subcontractorIds, portalIds'));
    ok('G3 the lists go as bound arguments, with the user id from the token', /sb\.rpc\('tombstone_signed_records', \{\s*p_user_id: userId,\s*p_project_ids: projectIds,\s*p_portal_ids: portalIds,\s*\}\)/.test(body));
    const tombBlock = body.slice(tombAt - 200, body.indexOf('2-00', tombAt) === -1 ? tombAt + 2500 : body.indexOf("from('profiles')", tombAt));
    ok('G4 a missing function or a failure never stops the deletion: no return and no throw in the step', !/return json\(/.test(tombBlock) && !/throw /.test(tombBlock) && /tombstones = 'not_installed'/.test(tombBlock));
    const listAt = del.indexOf('const USER_SCOPED_TABLES = [');
    const list = del.slice(listAt, del.indexOf('];', listAt));
    const tenantAt = del.indexOf('const TENANT_SCOPED_DELETES');
    const tenant = del.slice(tenantAt, del.indexOf('];', tenantAt));
    ok('G5 the acceptance table and the tombstones are in no delete list', !/legal_acceptances|signed_record_tombstones/.test(list) && !/legal_acceptances|signed_record_tombstones/.test(tenant));
    ok('G6 the response reports the tombstones as a count or a word, never an id', /signedRecordTombstones: typeof tombstones === 'string' \? tombstones : tombstones\.written,/.test(body));
  }

  // ── H. registration ──
  {
    const pkg = JSON.parse(files[F.pkg]) as { scripts: Record<string, string> };
    const chain = pkg.scripts['ship-check'] ?? '';
    for (const [name, script] of [['test:legal-acceptance', 'scripts/validate-legal-acceptance.ts'], ['test:rfp-attachments-private', 'scripts/validate-rfp-attachments-private.ts']] as const) {
      ok(`H1 ${name} runs ${script} and is in the ship-check chain`, pkg.scripts[name] === `bun run ${script}` && chain.includes(`bun run ${name}`));
    }
  }
  return results;
}

// ── I. planted mutations ──
interface Mutation { name: string; file: string; from: string | RegExp; to: string; red: string; /** A second replacement in the same file, for a rule that two guards hold. */ also?: [string, string] }
const M: Mutation[] = [
  { name: 'the Terms change by one word and the version does not', file: F.terms, from: 'binding individual arbitration', to: 'binding individual mediation', red: 'A1' },
  { name: 'the Privacy Policy gains a sentence and the version does not', file: F.privacy, from: 'We do not sell or rent your personal information to any third party.', to: 'We do not sell or rent your personal information to any third party. We may share it with partners.', red: 'A3' },
  { name: 'the version is bumped but the hash is not', file: F.core, from: "export const TERMS_VERSION = '2026-05-12';", to: "export const TERMS_VERSION = '2026-11-01';", red: 'A2' },
  { name: 'the page date changes and the version does not', file: F.privacy, from: 'Last updated: October 4, 2026', to: 'Last updated: November 1, 2026', red: 'A4' },
  { name: 'the normaliser hashes the whole file', file: F.core, from: "  if (open !== -1 && close !== -1 && close > open) {\n    body = html.slice(html.indexOf('>', open) + 1, close);\n  }", to: '', red: 'A6' },
  { name: 'the scan notice is softened', file: F.core, from: 'It can be off by an inch or more.', to: 'It is usually close.', red: 'A9' },
  { name: 'the screen shows other words than the hashed ones', file: F.en, from: '"office.notices.scan.body": "A scan is a first measure.', to: '"office.notices.scan.body": "A scan is a good measure.', red: 'A11' },
  { name: 'the Spanish changes without its hash', file: F.es, from: 'Puede variar una pulgada o más.', to: 'Es bastante exacto.', red: 'A12' },
  { name: 'a later sign-in overwrites the sign-up record', file: F.core, from: '  if (cur && cur.version === item.version && cur.sha === item.sha) return { store, changed: false };', to: '', red: 'B1' },
  { name: 'pending entries are listed for whoever asks', file: F.core, from: '  const mine = store.byUser[userId];\n  if (!mine) return [];\n  const out: Array<{ kind: LegalKind; entry: LegalEntry }> = [];', to: '  const mine = store.byUser[userId] ?? Object.values(store.byUser)[0];\n  if (!mine) return [];\n  const out: Array<{ kind: LegalKind; entry: LegalEntry }> = [];', red: 'B3' },
  { name: 'the rpc carries the phone\'s time', file: F.core, from: '    p_delay_ms: Number.isFinite(delay) && delay >= 0 ? Math.round(delay) : null,', to: '    p_delay_ms: Number.isFinite(delay) && delay >= 0 ? Math.round(delay) : null,\n    p_accepted_at: new Date(entry.at).toISOString(),', red: 'B5' },
  { name: 'the recorder sends on whatever session is active', file: F.core, from: '    if (who !== userId) return;', to: '', red: 'B11' },
  { name: 'the recorder lets a storage failure out', file: F.core, from: '    const run = chain.then(work, work).catch(() => { /* never surfaces */ });', to: '    const run = chain.then(work, work);',
    also: ['    try { return parseLegalStore(await deps.storage.getItem(LEGAL_STORE_KEY)); } catch { return emptyLegalStore(); }', '    return parseLegalStore(await deps.storage.getItem(LEGAL_STORE_KEY));'], red: 'B12' },
  { name: 'the recorder keeps hammering a missing function', file: F.core, from: '        if (isMissingLegalFunction(res.error)) functionMissing = true;', to: '', red: 'B9' },
  { name: 'ok:false is marked sent', file: F.core, from: '      if (!legalRpcLanded(res.data)) {', to: '      if (false) {', red: 'B13' },
  { name: 'a refused record is retried at every flush', file: F.core, from: ' || now() < was.nextAt', to: '', red: 'B19' },
  { name: 'a refused record is retried forever', file: F.core, from: 'was.tries >= LEGAL_REFUSAL_MAX_TRIES || ', to: '', red: 'B19' },
  { name: 'the rpc drops the update id', file: F.core, from: "    p_update_id: ctx.updateId && /^[A-Za-z0-9-]{1,64}$/.test(ctx.updateId) ? ctx.updateId : null,", to: '    p_update_id: null,', red: 'B5' },
  { name: 'an email link records', file: F.core, from: "  if (method === 'email_link') return null;", to: "  if (method === 'email_link') return 'login_first';", red: 'B23' },
  { name: 'the login screen records whatever its constant says', file: F.core, from: "  if (screen === 'login') return TERMS_SENTENCE_ON_LOGIN_SCREEN;", to: "  if (screen === 'login') return true;", red: 'B22' },
  { name: 'the login screen\'s constant is set back to false while the sentence is on the screen', file: F.core, from: 'export const TERMS_SENTENCE_ON_LOGIN_SCREEN = true;', to: 'export const TERMS_SENTENCE_ON_LOGIN_SCREEN = false;', red: 'B15' },
  { name: 'Apple with no screen named records as a sign-up', file: F.core, from: "return startedFrom === 'signup' || startedFrom === 'login' ? startedFrom : null;", to: "return startedFrom === 'login' ? 'login' : 'signup';", red: 'B15' },
  { name: 'with the gate on, signing out and back in records the new version', file: F.core, from: '  if (input.reacceptOn === true && !fresh) return null;\n', to: '', red: 'B24' },
  { name: 'has() does not wait for a note made a moment ago', file: F.core, from: 'try { await notesWritten; return hasLegalItem(', to: 'try { return hasLegalItem(', red: 'B21' },
  { name: 'the owed store is swept at a change of account', file: F.keys, from: "  'mageid_legal_acceptance_v1',\n];", to: '];', red: 'B17' },
  { name: 'the surviving store is never pruned', file: F.core, from: '  if (ids.length <= LEGAL_STORE_MAX_USERS) return store;', to: '  if (ids.length <= 10000) return store;', red: 'B18' },
  { name: 'one noted document counts as both', file: F.core, from: "  return items.every((item) => hasLegalItem(store, userId, item)) ? 'accepted' : 'needed';", to: "  return items.some((item) => hasLegalItem(store, userId, item)) ? 'accepted' : 'needed';", red: 'D11' },
  { name: 'the archived Terms text is edited', file: `${ARCHIVE_DIR}/terms-2026-05-12-c0b1f207.txt`, from: 'binding individual arbitration', to: 'binding individual mediation', red: 'A17' },
  { name: 'the archive file is renamed away', file: `${ARCHIVE_DIR}/privacy-2026-10-04-7f7902ac.txt`, from: /^[\s\S]*$/, to: 'x', red: 'A17' },
  { name: 'the wiring goes through the toasting queue', file: F.wiring, from: 'const res = await supabaseRpcOnline<unknown>(fn, args);', to: "const res = { status: await supabaseRpcDetailed('legal_acceptances', 'x', fn, args), error: undefined, data: undefined };", red: 'B16' },
  { name: 'completeSignIn stops recording', file: F.auth, from: '    recordSignInAcceptance(signedIn, method, startedFrom);\n', to: '', red: 'C1' },
  { name: 'the record is noted before the tenant wipe', file: F.auth, from: /(\n    const incoming: LastUser \| null = signedIn \? \{ id: signedIn\.id, email: signedIn\.email \?\? null \} : null;)/, to: '$1\n    recordSignInAcceptance(signedIn, method, startedFrom);', red: 'C2' },
  { name: 'the Apple path forgets its method', file: F.auth, from: "await completeSignIn(data.user ?? data.session?.user, handoff, 'apple', startedFrom);", to: "await completeSignIn(data.user ?? data.session?.user, handoff, undefined as never, startedFrom);", red: 'C3' },
  { name: 'the Google path forgets the screen it was started on', file: F.auth, from: "await completeSignIn(data.user ?? data.session?.user, handoff, 'google', startedFrom);", to: "await completeSignIn(data.user ?? data.session?.user, handoff, 'google');", red: 'C3' },
  { name: 'the email-link path records again (a password reset would write a row)', file: F.auth, from: "    // An email link (a confirmed sign-up, a sign-in link, a password reset)\n    // made this session. NOTHING is recorded here", to: "    recordSignInAcceptance(incoming as never, 'email_link');\n    // An email link (a confirmed sign-up, a sign-in link, a password reset)\n    // made this session. NOTHING is recorded here", red: 'C5' },
  { name: 'a session listener records', file: F.auth, from: /(\n  const completeSignIn = useCallback\(async \()/, to: "\n  const onRestore = (u: User) => { recordSignInAcceptance(u, 'password'); };$1", red: 'C12' },
  { name: 'a sign-up waiting for its link notes nothing', file: F.auth, from: "        recordSignInAcceptance(data.user, 'signup_email');\n", to: '', red: 'C13' },
  { name: 'Apple defaults to the sign-up screen', file: F.auth, from: "const signInWithApple = useCallback(async (startedFrom: SignInScreen = 'login')", to: "const signInWithApple = useCallback(async (startedFrom: SignInScreen = 'signup')", red: 'C14' },
  { name: 'the sign-up screen stops saying where Apple was started', file: F.signup, from: "await signInWithApple('signup')", to: 'await signInWithApple()', red: 'C15' },
  { name: 'the sign-up screen loses its sentence', file: F.signup, from: '<AgreementNotice testID="signup-agreement"', to: '<Text testID="signup-agreement"', red: 'C16' },
  { name: 'the sign-up screen shows the older sentence again, a second time', file: F.signup, from: '<View style={styles.loginRow}>', to: '<Text>By creating an account you agree to our Terms</Text><View style={styles.loginRow}>', red: 'C16' },
  { name: 'the sign-in awaits the recorder', file: F.auth, from: '    recordSignInAcceptance(signedIn, method, startedFrom);\n', to: '    await recordSignInAcceptance(signedIn, method, startedFrom);\n', red: 'C7' },
  { name: 'the wiring notes whatever the decision was', file: F.wiring, from: '    if (!surface) return;\n', to: '', red: 'C11' },
  { name: 'the wiring ignores the re-acceptance flag', file: F.wiring, from: 'reacceptOn: TERMS_REACCEPT_ENABLED });', to: 'reacceptOn: false });', red: 'C11' },
  { name: 'the gate answers from the server alone', file: F.wiring, from: "    return noted.every(Boolean) ? 'accepted' : 'needed';", to: "    return 'needed';", red: 'D12' },
  { name: 'the recorder call loses its try', file: F.wiring, from: "  try {\n    if (!user?.id) return;\n    const surface = signInAcceptanceSurface(", to: '  {\n    if (!user?.id) return;\n    const surface = signInAcceptanceSurface(', also: ["    void recorder.note(user.id, currentAgreementItems(), surface).catch(() => { /* never surfaces */ });\n  } catch { /* never surfaces */ }", '    void recorder.note(user.id, currentAgreementItems(), surface);\n  }'], red: 'C8' },
  { name: 'the flag is switched on', file: F.flags, from: 'export const TERMS_REACCEPT_ENABLED = false;', to: 'export const TERMS_REACCEPT_ENABLED = true;', red: 'D1' },
  { name: 'the gate mounts with the flag off', file: F.gate, from: '  if (!TERMS_REACCEPT_ENABLED || !userId) return null;', to: '  if (!userId) return null;', red: 'D2' },
  { name: 'an unreadable answer shows the sheet', file: F.core, from: "  return flagOn === true && !!userId && state === 'needed';", to: "  return flagOn === true && !!userId && state !== 'accepted';", red: 'D5' },
  { name: 'rows that could not be read count as missing', file: F.core, from: "  if (!rows) return 'unknown';", to: "  if (!rows) return 'needed';", red: 'D6' },
  { name: 'a read error blocks the account', file: F.wiring, from: "    if (error || !Array.isArray(data)) return 'unknown';", to: "    if (error || !Array.isArray(data)) return 'needed';", red: 'D7' },
  { name: 'the code-answer notice stops telling its host', file: F.codeCore, from: '      try { tell?.(who, at, CODE_ACK_VERSION); } catch { /* the server record is best effort */ }\n', to: '', red: 'E1' },
  { name: 'a throwing host undoes the code acknowledgement', file: F.codeCore, from: '      try { tell?.(who, at, CODE_ACK_VERSION); } catch { /* the server record is best effort */ }', to: '      tell?.(who, at, CODE_ACK_VERSION);', red: 'E2' },
  { name: 'CodeAckHost stops recording', file: F.codeHost, from: '      acknowledged: (account, at, version) => recordCodeAck(account, version, at.getTime()),\n', to: '', red: 'E3' },
  { name: 'a dismissed scan notice counts', file: F.scanCore, from: '      if (!yes) return false;\n      const at = now();', to: '      const at = now();', red: 'E4' },
  { name: 'the scan acknowledgement is not account-scoped', file: F.scanCore, from: "  return !!rec && rec.v >= version && rec.account === (account ?? '');", to: '  return !!rec && rec.v >= version;', red: 'E6' },
  { name: 'the scan starts before the notice', file: F.scanFlow, from: '    if (!scanAck.known() && !(await scanAck.ensure())) return;\n', to: '', red: 'E8' },
  { name: 'the Order List opens without the notice', file: F.scanFlow, from: "onPress: () => afterScanAck(() => { setOrderSend('idle'); setStep('order'); }) }", to: "onPress: () => { setOrderSend('idle'); setStep('order'); } }", red: 'E9' },
  { name: 'Clearance Check opens without the notice', file: F.scanFlow, from: "onPress: () => afterScanAck(() => setStep('clearance')) }", to: "onPress: () => setStep('clearance') }", red: 'E9' },
  { name: 'afterScanAck goes on whatever the answer', file: F.scanFlow, from: 'void scanAck.ensure().then((ok) => { if (ok) go(); });', to: 'void scanAck.ensure().then(() => { go(); });', red: 'E10' },
  { name: 'authenticated is granted INSERT', file: F.migAccept, from: 'grant select on public.legal_acceptances to authenticated;', to: 'grant select, insert on public.legal_acceptances to authenticated;', red: 'F2' },
  { name: 'anon may call the recorder', file: F.migAccept, from: 'grant execute on function public.record_my_legal_acceptance(text, text, text, text, text, text, bigint, text) to authenticated;', to: 'grant execute on function public.record_my_legal_acceptance(text, text, text, text, text, text, bigint, text) to authenticated, anon;', red: 'F3' },
  { name: 'the recorder runs with the caller\'s rights', file: F.migAccept, from: "returns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path to ''\nas $function$\ndeclare\n  v_uid uuid", to: "returns jsonb\nlanguage plpgsql\nset search_path to ''\nas $function$\ndeclare\n  v_uid uuid", red: 'F4' },
  { name: 'the recorder\'s search_path is public', file: F.migAccept, from: "returns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path to ''\nas $function$\ndeclare\n  v_uid uuid", to: "returns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path to public\nas $function$\ndeclare\n  v_uid uuid", red: 'F4' },
  { name: 'the recorder takes the user as an argument', file: F.migAccept, from: '  v_uid uuid := auth.uid();\n  v_id bigint;', to: '  v_uid uuid := coalesce(p_user, auth.uid());\n  v_id bigint;', red: 'F5' },
  { name: 'the stored time is moved back by the phone\'s delay', file: F.migAccept, from: '     pg_catalog.clock_timestamp(), v_delay)', to: "     pg_catalog.clock_timestamp() - (v_delay * interval '1 millisecond'), v_delay)", red: 'F6' },
  { name: 'the keep trigger is update-only', file: F.migAccept, from: '  before update or delete on public.legal_acceptances', to: '  before update on public.legal_acceptances', red: 'F8' },
  { name: 'account deletion cascades', file: F.migAccept, from: 'uuid references auth.users(id) on delete set null,', to: 'uuid references auth.users(id) on delete cascade,', red: 'F9' },
  { name: 'the table gains an IP column', file: F.migAccept, from: '  update_id          text,\n  accepted_at', to: '  update_id          text,\n  ip_address         inet,\n  accepted_at', red: 'F10' },
  { name: 'any kind is accepted', file: F.migAccept, from: "  if p_kind not in ('terms', 'privacy', 'code_answer_ack', 'scan_ack') then", to: '  if false then', red: 'F17' },
  { name: 'the update id can be rewritten when the account is deleted', file: F.migAccept, from: '     and new.update_id is not distinct from old.update_id\n', to: '', red: 'F18' },
  { name: 'the header goes back to "any order"', file: F.migAccept, from: 'Apply this BEFORE the app update, or together with it', to: 'Any order is safe', red: 'F19' },
  { name: 'the function says "no personal data" again', file: F.del, from: 'These are pseudonymous, not anonymous:', to: 'There is no personal data here:', red: 'F20' },
  { name: 'the legal note stops saying open postings stay readable', file: F.docPrivacy, from: 'Any signed-in account can read the files of every OPEN posting', to: 'Files are private', red: 'F21' },
  { name: 'tombstones are readable by signed-in accounts', file: F.migTomb, from: 'grant select on public.signed_record_tombstones to service_role;', to: 'grant select on public.signed_record_tombstones to service_role, authenticated;', red: 'F12' },
  { name: 'a client may call the tombstone writer', file: F.migTomb, from: 'revoke all on function public.tombstone_signed_records(uuid, text[], text[]) from public, anon, authenticated;', to: 'revoke all on function public.tombstone_signed_records(uuid, text[], text[]) from public, anon;', red: 'F13' },
  { name: 'a tombstone keeps the signer\'s name', file: F.migTomb, from: '  counterparty_ref text,\n  signed_at', to: '  counterparty_ref text,\n  signer_name      text,\n  signed_at', red: 'F14' },
  { name: 'the tombstone writer trusts the project list', file: F.migTomb, from: '     where p.user_id = p_user_id and p.id::text = any (p_project_ids);', to: '     where p.id::text = any (p_project_ids);', red: 'F15' },
  { name: 'tombstones are written after the rows are deleted', file: F.del, from: /(\n    let tombstones: \{ written: number; skipped: string\[\] \} \| 'not_installed' \| 'failed' = 'failed';)/, to: "\n    await sb.from('change_order_approvals').delete().in('project_id', projectIds);$1", red: 'G1' },
  { name: 'a tombstone failure aborts the deletion', file: F.del, from: "    } else if (tombstones === 'failed') {\n      console.error('[delete-account] signed-record tombstones were NOT written; the deletion continues');", to: "    } else if (tombstones === 'failed') {\n      return json({ success: false, error: 'tombstones' }, 500);", red: 'G4' },
  { name: 'delete-account deletes the acceptance records', file: F.del, from: "  'project_presence',\n];", to: "  'project_presence',\n  'legal_acceptances',\n];", red: 'G5' },
  { name: 'the validator is dropped from the chain', file: F.pkg, from: ' && bun run test:legal-acceptance', to: '', red: 'H1' },
];

const files = loadFiles();
const base = await runChecks(files);
let fail = 0;
for (const r of base) {
  console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}${!r.pass && r.detail ? ` — ${r.detail}` : ''}`);
  if (!r.pass) fail++;
}

console.log('\nplanted mutations (in memory; each must turn its check red)');
for (const m of M) {
  const src = files[m.file];
  let out = src.replace(m.from as string, m.to);
  if (m.also) {
    const second = out.replace(m.also[0], m.also[1]);
    if (second === out) { console.log(`  ✗ mutation anchor (second) not found: ${m.name} (${m.file})`); fail++; continue; }
    out = second;
  }
  if (out === src) { console.log(`  ✗ mutation anchor not found: ${m.name} (${m.file})`); fail++; continue; }
  let res: Result[] = [];
  let threw = '';
  try { res = await runChecks({ ...files, [m.file]: out }); } catch (e) { threw = String(e); }
  const red = res.filter((r) => !r.pass).map((r) => r.name.split(' ')[0]);
  const caught = threw !== '' || red.includes(m.red);
  console.log(`  ${caught ? '✓' : '✗'} ${m.name} → ${m.red} red${caught ? '' : ` (red: ${red.join(', ') || 'none'})`}`);
  if (!caught) fail++;
}

try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* scratch only */ }
const total = base.length + M.length;
console.log(`\n${fail === 0 ? '✓' : '✗'} legal acceptance: ${total - fail} passed, ${fail} failed (${base.length} checks, ${M.length} planted mutations)`);
process.exit(fail > 0 ? 1 : 0);
