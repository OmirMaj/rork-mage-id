// utils/codeAckCore.ts — the one-time "Before you rely on a code answer"
// acknowledgement, and the standing line under every code result.
//
// Pure (no react-native, no storage import): the storage and the alert are
// handed in. utils/codeAck.ts wires AsyncStorage; components/CodeAckHost.tsx
// (mounted once in app/_layout.tsx) hands over the app's alert and the
// signed-in account id. Modelled on utils/aiConsentCore.ts, much smaller:
// there is one answer ("I understand") and no "no".
//
// WHEN IT IS ASKED. Before a building-code AI request goes out (Code Check and
// its drill-in, Plan Review, the plan sweep, Ask's construction answers,
// Inspection Ready's recall list, the photo code look), the surface awaits
// ensure(). An answer that is already on screen is never covered or removed:
// the gate sits on the next request, not on the screen. Web asks too.
//
// WHAT IS RECORDED, AND WHERE. One AsyncStorage key holding
// { v, at, account }: the notice version, the ISO date-time of the tap and
// the account that tapped. The device key is the cache that keeps the notice
// from being asked twice. The proof is a row in public.legal_acceptances (kind
// 'code_answer_ack'), written through the host's `acknowledged` callback
// (components/CodeAckHost.tsx, utils/legalAcceptance recordCodeAck): the server
// stamps who and when. The key is
// under the `mageid_` prefix (utils/localCacheKeys APP_STORAGE_PREFIXES), so
// the tenant-switch sweep removes it at sign-out and the next person on the
// phone is asked for themselves; a record for another account is never taken.
//
// A dismissed alert (Android back) is not an acknowledgement: nothing is
// stored, the request is not sent, and the next tap asks again.

/** Bump when the notice's words change in a way people must see again. */
export const CODE_ACK_VERSION = 1;

/** Under an existing app prefix, so the tenant-switch sweep covers it. */
export const CODE_ACK_STORAGE_KEY = 'mageid_code_answer_ack';

export const CODE_ACK_COPY = {
  title: 'Before you rely on a code answer',
  body: 'Code requirements, dimensions and figures shown by MAGE ID may be wrong, out of date, or not the edition your town adopted. The adopted code and your building department govern. Check every requirement before you build.',
  button: 'I understand',
} as const;

/** The standing line under every code result. One sentence pair, the same on
 *  every surface; a surface with its own line carries this inside it (never a
 *  second line stacked under the first). */
export const CODE_RESULT_NOTE = 'Not a substitute for the adopted code. Confirm with your building department.';

export interface CodeAckRecord {
  /** CODE_ACK_VERSION at the time of the tap. */
  v: number;
  /** ISO date-time of the tap. */
  at: string;
  /** The signed-in account id, or '' when nobody was signed in. */
  account: string;
}

export interface CodeAckStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface CodeAckHost {
  /** The signed-in account id (null when signed out). */
  accountId: () => string | null;
  /** Shows the notice. Resolves true only when "I understand" was tapped. */
  prompt: () => Promise<boolean>;
  /** Called once after a fresh tap, with who tapped and when: the host saves
   *  the server record (utils/legalAcceptance recordCodeAck). Optional, best
   *  effort; a throw here never undoes the acknowledgement. */
  acknowledged?: (account: string | null, at: Date, version: number) => void;
}

/** A stored value → a record, or null for anything that is not one. */
export function parseCodeAck(raw: string | null | undefined): CodeAckRecord | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<CodeAckRecord> | null;
    if (!o || typeof o !== 'object') return null;
    if (typeof o.v !== 'number' || !Number.isFinite(o.v)) return null;
    if (typeof o.at !== 'string' || !o.at) return null;
    if (typeof o.account !== 'string') return null;
    return { v: o.v, at: o.at, account: o.account };
  } catch {
    return null;
  }
}

/** True when `rec` is this account's acknowledgement of the current notice. */
export function codeAckCovers(rec: CodeAckRecord | null, account: string | null, version: number = CODE_ACK_VERSION): boolean {
  return !!rec && rec.v >= version && rec.account === (account ?? '');
}

/** What mountRoute and the host write: the record as stored. */
export function serializeCodeAck(account: string | null, at: Date, version: number = CODE_ACK_VERSION): string {
  const rec: CodeAckRecord = { v: version, at: at.toISOString(), account: account ?? '' };
  return JSON.stringify(rec);
}

type AlertButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
type ShowAlert = (title: string, message?: string, buttons?: AlertButton[], options?: { cancelable?: boolean; onDismiss?: () => void }) => void;

/** Shows the notice with the app's alert. True only for "I understand"; a
 *  dismissal (Android back) is false. Settles exactly once. */
export function askCodeAckOnce(showAlert: ShowAlert): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const settle = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    showAlert(
      CODE_ACK_COPY.title,
      CODE_ACK_COPY.body,
      [{ text: CODE_ACK_COPY.button, onPress: () => settle(true) }],
      { cancelable: false, onDismiss: () => settle(false) },
    );
  });
}

export interface CodeAckGate {
  /** True when a code request may go out. Asks once per account. Never throws.
   *  A second call while the notice is up gets false: one tap, one request. */
  ensure(): Promise<boolean>;
  /** True, with no await, when this session already knows the signed-in
   *  account acknowledged. Handlers check it first so an acknowledged tap runs
   *  exactly as it did before the gate existed (no extra tick before the
   *  button turns busy, so a double tap cannot start two requests). */
  known(): boolean;
  /** The stored record for the signed-in account, or null. Never throws. */
  read(): Promise<CodeAckRecord | null>;
  setHost(h: CodeAckHost | null): void;
}

export function createCodeAckGate(deps: { storage: CodeAckStorage; now?: () => Date }): CodeAckGate {
  let host: CodeAckHost | null = null;
  // True while the notice is up. A second request arriving meanwhile is
  // refused (false): the tap that raised the notice is the one that goes on.
  let asking = false;
  // The account this session knows has acknowledged ('' = signed out), from a
  // read or from the tap. It also carries an acknowledgement that could not be
  // written, so a full disk does not ask on every tap.
  let acked: string | null = null;
  const now = deps.now ?? (() => new Date());

  const account = (): string | null => {
    try { return host ? host.accountId() : null; } catch { return null; }
  };

  const read = async (): Promise<CodeAckRecord | null> => {
    try {
      const rec = parseCodeAck(await deps.storage.getItem(CODE_ACK_STORAGE_KEY));
      if (!codeAckCovers(rec, account())) return null;
      acked = rec ? rec.account : acked;
      return rec;
    } catch {
      return null;
    }
  };

  const known = (): boolean => acked !== null && acked === (account() ?? '');

  const ensure = async (): Promise<boolean> => {
    if (known()) return true;
    if (asking) return false;
    if (await read()) return true;
    if (known()) return true;
    if (asking) return false;
    // Nobody to show the notice: the request waits (fail closed). The host is
    // mounted at the root of the app, so this is a test or a headless run.
    if (!host) return false;
    const who = account();
    const ask = host.prompt;
    const tell = host.acknowledged;
    asking = true;
    try {
      let yes = false;
      try { yes = (await ask()) === true; } catch { yes = false; }
      if (!yes) return false;
      acked = who ?? '';
      const at = now();
      try { await deps.storage.setItem(CODE_ACK_STORAGE_KEY, serializeCodeAck(who, at)); } catch { /* stands for this session */ }
      try { tell?.(who, at, CODE_ACK_VERSION); } catch { /* the server record is best effort */ }
      return true;
    } finally {
      asking = false;
    }
  };

  return { ensure, read, known, setHost(h) { host = h; } };
}
