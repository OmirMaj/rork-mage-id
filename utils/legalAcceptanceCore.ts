// utils/legalAcceptanceCore.ts — the rules behind the saved record of every
// acceptance and acknowledgement (lane PROTECT-SERVER).
//
// Pure: no react-native, no storage import, no network. utils/legalAcceptance.ts
// wires it to AsyncStorage and the one rpc; scripts/validate-legal-acceptance.ts
// runs everything here under bun.
//
// WHAT IS RECORDED. One row in public.legal_acceptances per (person, kind,
// version, words): the Terms of Service and the Privacy Policy, the code-answer
// notice, the scan notice. The server stamps who (auth.uid()) and when (its own
// clock); this module only says WHAT (kind, version, a SHA-256 of the words
// shown) and WHERE (surface, build, over-the-air update, platform).
// Migration: supabase/migrations/20261010100000_legal_acceptances.sql.
//
// WHAT A TERMS OR PRIVACY ROW MEANS: this account signed in, or created itself,
// on a screen that DISPLAYED the sentence naming both documents, at these
// versions; or tapped "I Agree" on the re-acceptance sheet. Nothing else writes
// one. So a sign-in is recorded only from a screen whose constant below says it
// shows the sentence in this build (TERMS_SENTENCE_ON_SIGNUP_SCREEN,
// TERMS_SENTENCE_ON_LOGIN_SCREEN), NEVER from an email link (a confirmation, a
// sign-in link, a password reset) and NEVER from a restored session. With the
// re-acceptance gate on, an existing account's sign-in records nothing: only
// the sheet's "I Agree" does (signInAcceptanceSurface).
//
// THE VERSION CONSTANTS BELOW ARE PINNED TO THE PUBLISHED PAGES. The hashes are
// of the text of marketing/terms.html and marketing/privacy.html (the words
// inside <main>, tags removed, white space collapsed: normalizeLegalHtml).
// scripts/validate-legal-acceptance.ts recomputes both on every ship-check and
// fails when a page's words changed and its version here did not. So the Terms
// cannot change silently: whoever edits the page must bump the version and the
// hash in the same change, and every account is then asked again (once the
// re-acceptance gate is switched on).
//
// THE VERSION TEXT IS ARCHIVED. docs/legal/versions/<kind>-<version>-<hash8>.txt
// holds the exact normalised words each hash below was taken over, written by
// scripts/archive-legal-text.ts (the same normalizeLegalHtml and the same
// SHA-256). The validator requires the archive file for the current constants
// and re-hashes it, so "which words did version X say" has an answer in the
// repo after the page has moved on.
//
// THE PHONE KEEPS WHAT IT OWES. A record that could not be sent (no signal, or
// the migration is not applied yet) stays in one small owner-stamped store and
// is sent again at the next sign-in, app start and foreground. The store
// survives sign-out and a change of account on the phone (utils/localCacheKeys
// DEVICE_SCOPED_KEYS): every entry is keyed by its owner's id and is read and
// sent only on that owner's own session, and it holds ids, versions, hashes,
// surfaces and times, nothing else. It is never put on the offline queue: a
// refusal there is toasted and written to the Not-saved ledger, and "the
// server has no such function yet" must be silent. Nothing here ever blocks or
// fails a sign-in.

// ── the documents and their versions ────────────────────────────────────────

/** marketing/terms.html, "Last updated: May 12, 2026". */
export const TERMS_VERSION = '2026-05-12';
/** marketing/privacy.html, "Last updated: October 4, 2026". */
export const PRIVACY_VERSION = '2026-10-04';
/** SHA-256 of normalizeLegalHtml(marketing/terms.html). Pinned by the validator. */
export const TERMS_TEXT_SHA256 = 'c0b1f2072c384c6ccc7c2bf40fe2c4a6b6d175d5e126f8016d13f4e5f11b52f7';
/** SHA-256 of normalizeLegalHtml(marketing/privacy.html). Pinned by the validator. */
export const PRIVACY_TEXT_SHA256 = '7f7902ac6105e96ec3f333c406fa2eac682f3d95e637afcf68b4fbc4715795ad';

export const TERMS_URL = 'https://mageid.app/terms';
export const PRIVACY_URL = 'https://mageid.app/privacy';

/** The first-use scan notice. Bump the version when the words change. */
export const SCAN_ACK_VERSION = '1';
export const SCAN_ACK_COPY = {
  title: 'Before you rely on a scan',
  body: 'A scan is a first measure. It can be off by an inch or more. Check before you order, cut, price or build from it.',
  button: 'I Understand',
} as const;
/** SHA-256 of legalNoticeText(SCAN_ACK_COPY.title, SCAN_ACK_COPY.body). Pinned by the validator. */
export const SCAN_ACK_TEXT_SHA256 = '9d7fc726dc02c18190a0d8a48cf99099b2aba33b6993f598c242bdc521a45878';
/** SHA-256 of the Spanish title and body a Spanish-language phone shows
 *  (i18n/catalog/es/office/notices.ts, office.notices.scan.title / .body). Pinned by the validator. */
export const SCAN_ACK_TEXT_SHA256_ES = '5f4ba3704d4b4491f0f43470ab3344a81cd84f4383698d104302eca476331983';
/** SHA-256 of legalNoticeText(CODE_ACK_COPY.title, CODE_ACK_COPY.body) (utils/codeAckCore). Pinned by the validator. */
export const CODE_ACK_TEXT_SHA256 = '57f54a19c61744cbac397556245c2f3ca3c7a4492e3de827da7320962dd52ff0';

/**
 * The Living Model's question before a scanned room is sent to the account
 * for the first time (kind 'scan_room_upload'). The words are the ones the
 * screen shows (hooks/useLivingModelCopy scanAskTitleBody / scanAskBody; the
 * Spanish is i18n/catalog/es/office/livingModel.ts). Bump the version when
 * they change. scripts/validate-living-model-sync.ts pins all of it, and the
 * exact text of each language is archived under docs/legal/versions.
 */
export const SCAN_UPLOAD_VERSION = '1';
export const SCAN_UPLOAD_COPY = {
  title: 'This model includes a room you scanned.',
  body: 'Saving it to your account sends the room’s name and its sizes: floor outline, ceiling height, walls, doors, windows and fixtures, and that the room came from a scan. They go to MAGE ID’s servers so your other devices and your team on this project can see them. No photo or video is sent. You are asked again for each scanned room you add later.',
  button: 'Save to My Account',
} as const;
/** SHA-256 of legalNoticeText(SCAN_UPLOAD_COPY.title, SCAN_UPLOAD_COPY.body). Pinned by scripts/validate-living-model-sync.ts. */
export const SCAN_UPLOAD_TEXT_SHA256 = 'PENDING_EN';
/** SHA-256 of the Spanish title and body (office.livingModel.sync.scanAskTitleBody / .scanAskBody). Pinned by the same check. */
export const SCAN_UPLOAD_TEXT_SHA256_ES = 'PENDING_ES';

/** The exact string a notice's hash is taken over: title, one newline, body. */
export function legalNoticeText(title: string, body: string): string {
  return `${title}\n${body}`;
}

/**
 * The words of a published legal page, as hashed. Everything between <main ...>
 * and </main> (the header, footer and navigation are not the agreement), with
 * script and style blocks and every tag removed, the five common entities
 * decoded and every run of white space collapsed to one space.
 */
export function normalizeLegalHtml(html: string): string {
  const open = html.search(/<main\b[^>]*>/i);
  const close = html.search(/<\/main>/i);
  let body = html;
  if (open !== -1 && close !== -1 && close > open) {
    body = html.slice(html.indexOf('>', open) + 1, close);
  }
  return body
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── kinds and surfaces ──────────────────────────────────────────────────────

export type LegalKind = 'terms' | 'privacy' | 'code_answer_ack' | 'scan_ack' | 'scan_room_upload';
export type LegalSurface = 'signup_email' | 'signup_apple' | 'signup_google' | 'login_first' | 'reaccept' | 'in_app';
/** How the session came to exist. */
export type SignInMethod = 'signup_email' | 'password' | 'apple' | 'google' | 'email_link';

export interface LegalItem {
  kind: LegalKind;
  version: string;
  sha: string;
}

/** The two documents an account accepts. */
export function currentAgreementItems(): LegalItem[] {
  return [
    { kind: 'terms', version: TERMS_VERSION, sha: TERMS_TEXT_SHA256 },
    { kind: 'privacy', version: PRIVACY_VERSION, sha: PRIVACY_TEXT_SHA256 },
  ];
}

/** The scan notice as shown: the hash is of the words in the language the person read. */
export function scanAckItem(lang: 'en' | 'es' = 'en'): LegalItem {
  return { kind: 'scan_ack', version: SCAN_ACK_VERSION, sha: lang === 'es' ? SCAN_ACK_TEXT_SHA256_ES : SCAN_ACK_TEXT_SHA256 };
}

/** The yes to sending a scanned room to the account: the hash is of the question in the language he read. */
export function scanRoomUploadItem(lang: 'en' | 'es' = 'en'): LegalItem {
  return { kind: 'scan_room_upload', version: SCAN_UPLOAD_VERSION, sha: lang === 'es' ? SCAN_UPLOAD_TEXT_SHA256_ES : SCAN_UPLOAD_TEXT_SHA256 };
}

export function codeAckItem(version: number): LegalItem {
  return { kind: 'code_answer_ack', version: String(version), sha: CODE_ACK_TEXT_SHA256 };
}

// ── which screens show the sentence ─────────────────────────────────────────

/** The two screens a person signs in from. An email link and a restored session are neither. */
export type SignInScreen = 'signup' | 'login';

/**
 * Does app/signup.tsx display "By creating an account you agree to our Terms
 * of Service and Privacy Policy" in THIS build? It does. The validator reads
 * the screen and fails if this says true and the sentence is gone.
 */
export const TERMS_SENTENCE_ON_SIGNUP_SCREEN = true;

/**
 * Does app/login.tsx display the Terms sentence in THIS build? Yes: the
 * sentence sits above its buttons (the PROTECT-TEXT change). So a password
 * sign-in, a Face ID sign-in and Apple / Google started from the login screen
 * record an acceptance. Set it back to false in the same commit that ever
 * removes the sentence; the validator fails if it is true without the sentence.
 */
export const TERMS_SENTENCE_ON_LOGIN_SCREEN = true;

export function screenShowsTerms(screen: SignInScreen | null | undefined): boolean {
  if (screen === 'signup') return TERMS_SENTENCE_ON_SIGNUP_SCREEN;
  if (screen === 'login') return TERMS_SENTENCE_ON_LOGIN_SCREEN;
  return false;
}

/** The screen a sign-in method was started from. Email sign-up is the sign-up screen and a password is the login screen; Apple and Google say which; an email link is neither. */
export function screenForSignIn(method: SignInMethod, startedFrom?: SignInScreen | null): SignInScreen | null {
  if (method === 'signup_email') return 'signup';
  if (method === 'password') return 'login';
  if (method === 'apple' || method === 'google') return startedFrom === 'signup' || startedFrom === 'login' ? startedFrom : null;
  return null;
}

/** An account whose first sign-in is the one that just happened. */
const NEW_ACCOUNT_WINDOW_MS = 2 * 60 * 1000;

/**
 * True when this sign-in created the account: Supabase stamps created_at and
 * last_sign_in_at from its own clock, and on a first sign-in they are moments
 * apart. Both are server times; the phone's clock is not consulted.
 */
export function isNewAccount(createdAt: string | null | undefined, lastSignInAt: string | null | undefined): boolean {
  if (!createdAt || !lastSignInAt) return false;
  const c = Date.parse(createdAt);
  const l = Date.parse(lastSignInAt);
  if (!Number.isFinite(c) || !Number.isFinite(l)) return false;
  return Math.abs(l - c) <= NEW_ACCOUNT_WINDOW_MS;
}

/**
 * THE ONE DECISION: does this sign-in write an acceptance, and under which
 * surface? Null means record nothing.
 *
 *   an email link (confirmation, sign-in link, password reset)   never
 *   a screen whose constant says it does not show the sentence    never
 *   Apple / Google with no screen named                           never
 *   the re-acceptance gate is on and the account already existed  never: that
 *       account is asked by the sheet, and only its "I Agree" records. Signing
 *       out and back in must not agree on its behalf.
 *   otherwise: signup_email / signup_apple / signup_google for an account this
 *       sign-in created, login_first for one that already existed.
 */
export function signInAcceptanceSurface(input: {
  method: SignInMethod;
  /** Where Apple / Google was started. Ignored for the other methods. */
  startedFrom?: SignInScreen | null;
  user?: { created_at?: string | null; last_sign_in_at?: string | null } | null;
  /** TERMS_REACCEPT_ENABLED. */
  reacceptOn: boolean;
}): LegalSurface | null {
  const { method, user } = input;
  if (method === 'email_link') return null;
  const screen = screenForSignIn(method, input.startedFrom);
  if (!screenShowsTerms(screen)) return null;
  const fresh = method === 'signup_email' || isNewAccount(user?.created_at, user?.last_sign_in_at);
  if (input.reacceptOn === true && !fresh) return null;
  if (method === 'signup_email') return 'signup_email';
  if (method === 'apple') return fresh ? 'signup_apple' : 'login_first';
  if (method === 'google') return fresh ? 'signup_google' : 'login_first';
  return 'login_first';
}

// ── the store of what the phone owes and what it knows landed ───────────────

/**
 * Under an existing app prefix, and listed in utils/localCacheKeys
 * DEVICE_SCOPED_KEYS: it survives sign-out and a change of account, so a record
 * owed by one person is still there when that person signs in again.
 */
export const LEGAL_STORE_KEY = 'mageid_legal_acceptance_v1';
/** How many accounts' entries one phone keeps. Past this, accounts with nothing owed go first, oldest first. */
export const LEGAL_STORE_MAX_USERS = 12;

export interface LegalEntry {
  version: string;
  sha: string;
  surface: LegalSurface;
  /** Device time of the tap or the sign-in, ms. Used only to report a delay. */
  at: number;
  /** True once the server answered ok for this entry. */
  sent: boolean;
}

export interface LegalStore {
  v: 1;
  /** Every entry is stamped with its owner; another account's are never read or sent. */
  byUser: Record<string, Partial<Record<LegalKind, LegalEntry>>>;
}

const KINDS: readonly LegalKind[] = ['terms', 'privacy', 'code_answer_ack', 'scan_ack', 'scan_room_upload'];
const SURFACES: readonly LegalSurface[] = ['signup_email', 'signup_apple', 'signup_google', 'login_first', 'reaccept', 'in_app'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emptyLegalStore(): LegalStore {
  return { v: 1, byUser: {} };
}

/** A stored value to a store; anything malformed is dropped, never thrown on. */
export function parseLegalStore(raw: string | null | undefined): LegalStore {
  const out = emptyLegalStore();
  if (!raw) return out;
  try {
    const o = JSON.parse(raw) as { v?: unknown; byUser?: unknown } | null;
    if (!o || typeof o !== 'object' || o.v !== 1 || !o.byUser || typeof o.byUser !== 'object') return out;
    for (const [uid, entries] of Object.entries(o.byUser as Record<string, unknown>)) {
      if (!UUID_RE.test(uid) || !entries || typeof entries !== 'object') continue;
      const kept: Partial<Record<LegalKind, LegalEntry>> = {};
      for (const kind of KINDS) {
        const e = (entries as Record<string, unknown>)[kind] as Partial<LegalEntry> | undefined;
        if (!e || typeof e !== 'object') continue;
        if (typeof e.version !== 'string' || typeof e.sha !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha)) continue;
        if (typeof e.surface !== 'string' || !SURFACES.includes(e.surface as LegalSurface)) continue;
        if (typeof e.at !== 'number' || !Number.isFinite(e.at)) continue;
        kept[kind] = { version: e.version, sha: e.sha, surface: e.surface as LegalSurface, at: e.at, sent: e.sent === true };
      }
      if (Object.keys(kept).length > 0) out.byUser[uid] = kept;
    }
  } catch { /* an unreadable store is an empty one */ }
  return out;
}

/**
 * Note that `userId` accepted `item` on `surface` at device time `at`.
 * FIRST WINS: when this account already has an entry for the same kind, version
 * and words (sent or not), nothing changes, so the surface of the real first
 * acceptance (a sign-up) is never replaced by a later sign-in. A new version or
 * new words replaces the entry and is owed again.
 */
export function noteLegalItem(store: LegalStore, userId: string, item: LegalItem, surface: LegalSurface, at: number): { store: LegalStore; changed: boolean } {
  if (!UUID_RE.test(userId)) return { store, changed: false };
  const mine = store.byUser[userId] ?? {};
  const cur = mine[item.kind];
  if (cur && cur.version === item.version && cur.sha === item.sha) return { store, changed: false };
  const next: LegalStore = {
    v: 1,
    byUser: { ...store.byUser, [userId]: { ...mine, [item.kind]: { version: item.version, sha: item.sha, surface, at, sent: false } } },
  };
  return { store: pruneLegalStore(next, userId), changed: true };
}

/**
 * Keep the store small: at most LEGAL_STORE_MAX_USERS accounts. `keep` (the
 * account being written) always stays. Accounts that owe nothing are dropped
 * first, oldest entry first; an account that still owes a record is dropped
 * only when every other account also owes one.
 */
export function pruneLegalStore(store: LegalStore, keep: string): LegalStore {
  const ids = Object.keys(store.byUser);
  if (ids.length <= LEGAL_STORE_MAX_USERS) return store;
  const info = ids.filter((id) => id !== keep).map((id) => {
    const entries = Object.values(store.byUser[id] ?? {}) as LegalEntry[];
    return { id, owes: entries.some((e) => !e.sent), newest: Math.max(0, ...entries.map((e) => e.at)) };
  });
  info.sort((a, b) => (a.owes === b.owes ? a.newest - b.newest : a.owes ? 1 : -1));
  const drop = new Set(info.slice(0, ids.length - LEGAL_STORE_MAX_USERS).map((x) => x.id));
  const byUser: LegalStore['byUser'] = {};
  for (const id of ids) if (!drop.has(id)) byUser[id] = store.byUser[id];
  return { v: 1, byUser };
}

/** What this account still owes the server. Never another account's. */
export function pendingLegalEntries(store: LegalStore, userId: string | null | undefined): Array<{ kind: LegalKind; entry: LegalEntry }> {
  if (!userId) return [];
  const mine = store.byUser[userId];
  if (!mine) return [];
  const out: Array<{ kind: LegalKind; entry: LegalEntry }> = [];
  for (const kind of KINDS) {
    const e = mine[kind];
    if (e && !e.sent) out.push({ kind, entry: e });
  }
  return out;
}

/** The server took this exact entry. A newer entry noted meanwhile stays owed. */
export function markLegalSent(store: LegalStore, userId: string, kind: LegalKind, entry: LegalEntry): LegalStore {
  const mine = store.byUser[userId];
  const cur = mine?.[kind];
  if (!mine || !cur || cur.version !== entry.version || cur.sha !== entry.sha) return store;
  return { v: 1, byUser: { ...store.byUser, [userId]: { ...mine, [kind]: { ...cur, sent: true } } } };
}

/** True when this phone knows the account has this exact item on record (noted here, sent or not). */
export function hasLegalItem(store: LegalStore, userId: string | null | undefined, item: LegalItem): boolean {
  if (!userId) return false;
  const e = store.byUser[userId]?.[item.kind];
  return !!e && e.version === item.version && e.sha === item.sha;
}

// ── the rpc ─────────────────────────────────────────────────────────────────

export const LEGAL_RPC = 'record_my_legal_acceptance';

export function legalRpcArgs(kind: LegalKind, entry: LegalEntry, ctx: { appVersion: string | null; updateId?: string | null; platform: string | null; now: number }): Record<string, unknown> {
  const delay = ctx.now - entry.at;
  return {
    p_kind: kind,
    p_version: entry.version,
    p_text_sha256: entry.sha,
    p_surface: entry.surface,
    p_app_version: ctx.appVersion && /^[A-Za-z0-9._+() -]{1,40}$/.test(ctx.appVersion) ? ctx.appVersion : null,
    p_platform: ctx.platform === 'ios' || ctx.platform === 'android' || ctx.platform === 'web' ? ctx.platform : null,
    // The over-the-air update the phone is running RIGHT NOW (expo-updates'
    // update id), or null for the bundle built into the binary and for web.
    // With app_version it says which bundle sent the record. An entry noted
    // offline and sent after an update carries the sender's id, not the one it
    // was noted under; reported_delay_ms shows that gap.
    p_update_id: ctx.updateId && /^[A-Za-z0-9-]{1,64}$/.test(ctx.updateId) ? ctx.updateId : null,
    // The phone's own account of how long ago, never a time: the server stamps the time.
    p_delay_ms: Number.isFinite(delay) && delay >= 0 ? Math.round(delay) : null,
  };
}

/** The rpc failed because the function is not on the server yet (the migration is held). */
export function isMissingLegalFunction(message: string | null | undefined): boolean {
  if (typeof message !== 'string') return false;
  const m = message.toLowerCase();
  if (!m.includes(LEGAL_RPC)) return false;
  return m.includes('pgrst202') || m.includes('could not find the function') || m.includes('does not exist');
}

/** What record_my_legal_acceptance answered: true only for ok:true. */
export function legalRpcLanded(data: unknown): boolean {
  return !!data && typeof data === 'object' && (data as { ok?: unknown }).ok === true;
}

// ── the recorder (storage and network handed in) ────────────────────────────

export interface LegalStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface LegalRecorderDeps {
  storage: LegalStorage;
  /** Sends one rpc. Resolves; a rejection is treated as "no answer". */
  send: (fn: string, args: Record<string, unknown>) => Promise<{ status: string; error?: string; data?: unknown }>;
  /** The signed-in account right now, or null. Checked before every send. */
  sessionUserId: () => Promise<string | null>;
  now?: () => number;
  appVersion?: () => string | null;
  updateId?: () => string | null;
  platform?: () => string | null;
}

/** How many times one record may be REFUSED (the server answered, and said no) before this app start stops sending it. */
export const LEGAL_REFUSAL_MAX_TRIES = 3;
/** The wait after the first refusal; each later one waits four times longer (1 minute, then 4). */
export const LEGAL_REFUSAL_BACKOFF_MS = 60 * 1000;

export interface LegalRecorder {
  /** Note an acceptance and try to send it. Never throws, never rejects. */
  note(userId: string | null | undefined, items: LegalItem[], surface: LegalSurface, at?: number): Promise<void>;
  /** Send whatever this account still owes. Never throws, never rejects. */
  flush(userId: string | null | undefined): Promise<void>;
  /** True when this phone has noted this exact item for this account. Never throws. */
  has(userId: string | null | undefined, item: LegalItem): Promise<boolean>;
}

export function createLegalRecorder(deps: LegalRecorderDeps): LegalRecorder {
  const now = deps.now ?? (() => Date.now());
  // Every note and flush is appended here so two never interleave their
  // read-modify-write of the one store.
  let chain: Promise<void> = Promise.resolve();
  // The function is not on the server (this session): stop asking until restart.
  let functionMissing = false;
  // A record the server REFUSED (ok:false: the per-person limit, an unknown
  // kind). It will be refused again, so it is retried a few times, further
  // apart each time, and then left alone until the app starts again. It stays
  // in the store. Keyed by owner, kind, version and words.
  const refused = new Map<string, { tries: number; nextAt: number }>();
  const refusalKey = (userId: string, kind: LegalKind, entry: LegalEntry): string => `${userId}|${kind}|${entry.version}|${entry.sha}`;
  // Resolves when every note() made so far has written its entry to the store.
  let notesWritten: Promise<void> = Promise.resolve();

  const read = async (): Promise<LegalStore> => {
    try { return parseLegalStore(await deps.storage.getItem(LEGAL_STORE_KEY)); } catch { return emptyLegalStore(); }
  };
  const write = async (s: LegalStore): Promise<void> => {
    try { await deps.storage.setItem(LEGAL_STORE_KEY, JSON.stringify(s)); } catch { /* owed again next time */ }
  };

  const doFlush = async (userId: string): Promise<void> => {
    if (functionMissing) return;
    let store = await read();
    const owed = pendingLegalEntries(store, userId);
    if (owed.length === 0) return;
    let who: string | null = null;
    try { who = await deps.sessionUserId(); } catch { who = null; }
    // Never on someone else's session: the server would stamp THEIR id.
    if (who !== userId) return;
    for (const { kind, entry } of owed) {
      const rk = refusalKey(userId, kind, entry);
      const was = refused.get(rk);
      if (was && (was.tries >= LEGAL_REFUSAL_MAX_TRIES || now() < was.nextAt)) continue;
      let res: { status: string; error?: string; data?: unknown };
      try {
        res = await deps.send(LEGAL_RPC, legalRpcArgs(kind, entry, {
          appVersion: deps.appVersion ? deps.appVersion() : null,
          updateId: deps.updateId ? deps.updateId() : null,
          platform: deps.platform ? deps.platform() : null,
          now: now(),
        }));
      } catch {
        return;
      }
      if (res.status !== 'synced') {
        if (isMissingLegalFunction(res.error)) functionMissing = true;
        return;
      }
      if (!legalRpcLanded(res.data)) {
        const tries = (was?.tries ?? 0) + 1;
        refused.set(rk, { tries, nextAt: now() + LEGAL_REFUSAL_BACKOFF_MS * Math.pow(4, tries - 1) });
        continue;
      }
      refused.delete(rk);
      store = markLegalSent(await read(), userId, kind, entry);
      await write(store);
    }
  };

  const enqueue = (work: () => Promise<void>): Promise<void> => {
    const run = chain.then(work, work).catch(() => { /* never surfaces */ });
    chain = run;
    return run;
  };

  return {
    note(userId, items, surface, at) {
      try {
        if (!userId || !UUID_RE.test(userId)) return Promise.resolve();
        const when = typeof at === 'number' && Number.isFinite(at) ? at : now();
        let wrote: () => void = () => { /* replaced below */ };
        const before = notesWritten;
        notesWritten = Promise.all([before, new Promise<void>((resolve) => { wrote = resolve; })]).then(() => { /* void */ });
        return enqueue(async () => {
          try {
            let store = await read();
            let changed = false;
            for (const item of items) {
              const r = noteLegalItem(store, userId, item, surface, when);
              store = r.store;
              changed = changed || r.changed;
            }
            if (changed) await write(store);
          } finally {
            wrote();
          }
          await doFlush(userId);
        });
      } catch {
        return Promise.resolve();
      }
    },
    flush(userId) {
      try {
        if (!userId) return Promise.resolve();
        return enqueue(() => doFlush(userId));
      } catch {
        return Promise.resolve();
      }
    },
    async has(userId, item) {
      // After every note already made has reached the store (not after its
      // send): a sign-up noted a moment ago is seen.
      try { await notesWritten; return hasLegalItem(await read(), userId, item); } catch { return false; }
    },
  };
}

// ── the re-acceptance gate's rule ───────────────────────────────────────────

export interface AcceptanceRow { kind?: unknown; version?: unknown; text_sha256?: unknown }

/** What the gate knows about the account. 'unknown' never shows the sheet. */
export type ReacceptState = 'accepted' | 'needed' | 'unknown';

/**
 * Whether the signed-in account has a row for the CURRENT version of both
 * documents. `rows` is the account's own legal_acceptances rows, or null when
 * they could not be read (offline, or the table is not there yet): then the
 * answer is 'unknown' and nobody is asked or blocked.
 */
export function reacceptStateFromRows(rows: AcceptanceRow[] | null | undefined, items: LegalItem[] = currentAgreementItems()): ReacceptState {
  if (!rows) return 'unknown';
  for (const item of items) {
    const hit = rows.some((r) => r.kind === item.kind && r.version === item.version && r.text_sha256 === item.sha);
    if (!hit) return 'needed';
  }
  return 'accepted';
}

/**
 * What the gate concludes from the server's rows and this phone's own store.
 * 'needed' becomes 'accepted' when this phone has noted BOTH current documents
 * for this account: a note is written only by a screen that showed the
 * sentence or by "I Agree", and it is sent as soon as it can be. Without this
 * a person who created an account a second ago would be asked again before the
 * record of the sign-up had landed.
 */
export function reacceptStateWithLocal(state: ReacceptState, store: LegalStore, userId: string | null | undefined, items: LegalItem[] = currentAgreementItems()): ReacceptState {
  if (state !== 'needed') return state;
  return items.every((item) => hasLegalItem(store, userId, item)) ? 'accepted' : 'needed';
}

/** The whole decision: the sheet shows only when the flag is on AND a row is known to be missing. */
export function shouldShowReaccept(flagOn: boolean, userId: string | null | undefined, state: ReacceptState): boolean {
  return flagOn === true && !!userId && state === 'needed';
}
