// utils/scanAckCore.ts — the one-time "Before you rely on a scan" notice.
//
// Pure (no react-native, no storage import): the storage and the prompt are
// handed in. hooks/useScanAck.ts wires AsyncStorage, the app's alert, the
// signed-in account and the saved record (utils/legalAcceptance recordScanAck).
// Modelled on utils/codeAckCore.ts.
//
// WHEN IT IS ASKED. The first time anyone starts a room scan, opens the Order
// List or opens Clearance Check, the action awaits ensure(). The notice is the
// sentence the founder agreed on 2026-10-09 (utils/legalAcceptanceCore
// SCAN_ACK_COPY). A scan already on screen is never covered or removed: the
// gate sits on the next action. The scanner's own gates (owner preview,
// utils/roomScan/allowed) are untouched and come first.
//
// WHAT IS RECORDED, AND WHERE. One AsyncStorage key holding { v, at, account }
// (under the `mageid_` prefix, so the tenant-switch sweep removes it and the
// next person on the phone is asked for themselves), and one row in
// public.legal_acceptances (kind 'scan_ack') through the recorder, which the
// server stamps with who and when.
//
// A dismissed alert (Android back) is not an acknowledgement: nothing is
// stored, the action does not go on, and the next tap asks again.

/** Bump with utils/legalAcceptanceCore SCAN_ACK_VERSION when the words change. */
export const SCAN_ACK_LOCAL_VERSION = 1;

/** Under an existing app prefix, so the tenant-switch sweep covers it. */
export const SCAN_ACK_STORAGE_KEY = 'mageid_scan_ack';

export interface ScanAckRecord {
  v: number;
  /** ISO date-time of the tap (device clock; the server row carries the server's). */
  at: string;
  /** The signed-in account id, or '' when nobody was signed in. */
  account: string;
}

export interface ScanAckStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function parseScanAck(raw: string | null | undefined): ScanAckRecord | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<ScanAckRecord> | null;
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
export function scanAckCovers(rec: ScanAckRecord | null, account: string | null, version: number = SCAN_ACK_LOCAL_VERSION): boolean {
  return !!rec && rec.v >= version && rec.account === (account ?? '');
}

export interface ScanAckGate {
  /**
   * True when the scan action may go on. Asks once per account. Never throws.
   * `prompt` shows the notice and resolves true only for "I Understand";
   * `onAcknowledged` runs once, after a fresh tap (the saved record).
   * A second call while the notice is up gets false: one tap, one action.
   */
  ensure(account: string | null, prompt: () => Promise<boolean>, onAcknowledged?: (at: Date) => void): Promise<boolean>;
  /** True, with no await, when this session already knows `account` acknowledged. */
  known(account: string | null): boolean;
}

export function createScanAckGate(deps: { storage: ScanAckStorage; now?: () => Date }): ScanAckGate {
  let asking = false;
  let acked: string | null = null;
  const now = deps.now ?? (() => new Date());
  const known = (account: string | null): boolean => acked !== null && acked === (account ?? '');

  const ensure = async (account: string | null, prompt: () => Promise<boolean>, onAcknowledged?: (at: Date) => void): Promise<boolean> => {
    if (known(account)) return true;
    if (asking) return false;
    try {
      const rec = parseScanAck(await deps.storage.getItem(SCAN_ACK_STORAGE_KEY));
      if (scanAckCovers(rec, account)) { acked = account ?? ''; return true; }
    } catch { /* unreadable storage: ask */ }
    if (known(account)) return true;
    if (asking) return false;
    asking = true;
    try {
      let yes = false;
      try { yes = (await prompt()) === true; } catch { yes = false; }
      if (!yes) return false;
      const at = now();
      acked = account ?? '';
      try {
        const rec: ScanAckRecord = { v: SCAN_ACK_LOCAL_VERSION, at: at.toISOString(), account: account ?? '' };
        await deps.storage.setItem(SCAN_ACK_STORAGE_KEY, JSON.stringify(rec));
      } catch { /* stands for this session */ }
      try { onAcknowledged?.(at); } catch { /* the record is best effort; the action goes on */ }
      return true;
    } finally {
      asking = false;
    }
  };

  return { ensure, known };
}
