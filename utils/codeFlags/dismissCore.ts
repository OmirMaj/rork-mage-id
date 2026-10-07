// utils/codeFlags/dismissCore.ts — Code Flags: "Hide This Flag" memory.
//
// A dismissal is the contractor's own note on his own device. It is NOT on the
// change order or the estimate line, it is never synced, and no client-facing
// path can read it. One AsyncStorage key under the app-owned `mageid_` prefix
// (utils/localCacheKeys APP_STORAGE_PREFIXES), so the tenant-switch sweep
// removes it at sign-out; the record also names the account that wrote it, and
// a record written by another account is read as empty.
//
// A dismissal remembers WHICH families were on the line when he hid it. If the
// line is later edited into a new kind of work (a family that was not there),
// the chip comes back: he hid the flag he read, not every future one.
//
// Pure: no React, no storage. utils/codeFlags/dismissStore.ts wires AsyncStorage.
import type { CodeFlagFamilyId } from '@/utils/codeFlags/rules';

/** Under an existing app prefix, so the tenant-switch sweep covers it. */
export const CODE_FLAG_DISMISS_KEY = 'mageid_code_flag_dismissed';
export const CODE_FLAG_DISMISS_VERSION = 1;

export interface CodeFlagDismissal { families: string[]; at: string }
export interface CodeFlagDismissRecord {
  v: number;
  /** The signed-in account id, or '' when nobody was signed in. */
  account: string;
  /** scope ('p:<projectId>' or 'cart') → line key → dismissal. */
  lines: Record<string, Record<string, CodeFlagDismissal>>;
}

export function emptyDismissRecord(account: string): CodeFlagDismissRecord {
  return { v: CODE_FLAG_DISMISS_VERSION, account, lines: {} };
}

export function dismissScope(projectId: string | null | undefined): string {
  const id = (projectId ?? '').trim();
  return id ? `p:${id}` : 'cart';
}

/** The stored record for THIS account, or an empty one. Never throws. */
export function parseDismissRecord(raw: string | null | undefined, account: string): CodeFlagDismissRecord {
  const fresh = emptyDismissRecord(account);
  if (!raw) return fresh;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return fresh; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fresh;
  const r = v as Partial<CodeFlagDismissRecord>;
  if (r.v !== CODE_FLAG_DISMISS_VERSION || r.account !== account) return fresh;
  if (!r.lines || typeof r.lines !== 'object' || Array.isArray(r.lines)) return fresh;
  for (const [scope, byLine] of Object.entries(r.lines)) {
    if (!scope || !byLine || typeof byLine !== 'object' || Array.isArray(byLine)) continue;
    const out: Record<string, CodeFlagDismissal> = {};
    for (const [lineKey, d] of Object.entries(byLine as Record<string, unknown>)) {
      const row = d as Partial<CodeFlagDismissal> | null;
      if (!lineKey || !row || !Array.isArray(row.families)) continue;
      const families = row.families.filter((f): f is string => typeof f === 'string' && !!f);
      if (families.length) out[lineKey] = { families, at: typeof row.at === 'string' ? row.at : '' };
    }
    if (Object.keys(out).length) fresh.lines[scope] = out;
  }
  return fresh;
}

export function withDismissal(
  record: CodeFlagDismissRecord, scope: string, lineKey: string, families: readonly CodeFlagFamilyId[], nowISO: string,
): CodeFlagDismissRecord {
  if (!scope || !lineKey || !families.length) return record;
  return {
    ...record,
    lines: { ...record.lines, [scope]: { ...(record.lines[scope] ?? {}), [lineKey]: { families: [...families], at: nowISO } } },
  };
}

/** True when every family on the line now was on it when he hid the flag. */
export function isDismissed(
  record: CodeFlagDismissRecord | null | undefined, scope: string, lineKey: string, families: readonly CodeFlagFamilyId[],
): boolean {
  const d = record?.lines?.[scope]?.[lineKey];
  if (!d || !families.length) return false;
  return families.every((f) => d.families.includes(f));
}
