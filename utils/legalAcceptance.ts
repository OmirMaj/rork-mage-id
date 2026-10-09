// utils/legalAcceptance.ts — the app's one recorder of acceptances and
// acknowledgements (Terms of Service, Privacy Policy, the code-answer notice,
// the scan notice). The rules are utils/legalAcceptanceCore.ts (pure, run under
// bun by scripts/validate-legal-acceptance.ts); this file only connects them to
// AsyncStorage, the session and the one rpc.
//
// THE ONE WRITE is record_my_legal_acceptance through supabaseRpcOnline:
// online-only, never put on the offline queue, never written to the Not-saved
// ledger, never toasted. What could not be sent stays in the store
// (mageid_legal_acceptance_v1, owner-stamped) and is sent at the next sign-in,
// app start and foreground (components/LegalAcceptanceSync). The server stamps
// who and when; a retry writes nothing twice.
//
// NOTHING HERE CAN FAIL A SIGN-IN. Every export returns void or a promise that
// never rejects, and contexts/AuthContext.tsx calls them without awaiting.
//
// No react-native import (the same reason as utils/codeAck.ts): the platform
// and the build are handed in by components/LegalAcceptanceSync.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseRpcOnline } from '@/utils/offlineQueue';
import {
  codeAckItem,
  createLegalRecorder,
  currentAgreementItems,
  reacceptStateFromRows,
  scanAckItem,
  surfaceForSignIn,
  type LegalItem,
  type LegalSurface,
  type ReacceptState,
  type SignInMethod,
} from '@/utils/legalAcceptanceCore';

export {
  PRIVACY_URL,
  PRIVACY_VERSION,
  TERMS_URL,
  TERMS_VERSION,
  type SignInMethod,
} from '@/utils/legalAcceptanceCore';

let build: { appVersion: string | null; platform: string | null } = { appVersion: null, platform: null };

/** components/LegalAcceptanceSync hands over the build and the platform once. */
export function setLegalBuildInfo(info: { appVersion: string | null; platform: string | null }): void {
  build = info;
}

const recorder = createLegalRecorder({
  storage: AsyncStorage,
  send: async (fn, args) => {
    if (!isSupabaseConfigured) return { status: 'failed' };
    const res = await supabaseRpcOnline<unknown>(fn, args);
    return { status: res.status, error: res.error, data: res.data };
  },
  sessionUserId: async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  },
  appVersion: () => build.appVersion,
  platform: () => build.platform,
});

/**
 * A session was just created for `user` through `method`: record that the
 * Terms of Service and the Privacy Policy shown on that screen were accepted.
 * Best effort, returns at once, never throws.
 */
export function recordSignInAcceptance(
  user: { id?: string | null; created_at?: string | null; last_sign_in_at?: string | null } | null | undefined,
  method: SignInMethod,
): void {
  try {
    if (!user?.id) return;
    void recorder.note(user.id, currentAgreementItems(), surfaceForSignIn(method, user)).catch(() => { /* never surfaces */ });
  } catch { /* never surfaces */ }
}

/** "I Agree" on the re-acceptance sheet. Resolves when the attempt is over; never rejects. */
export function recordReacceptance(userId: string | null | undefined): Promise<void> {
  // A fresh acceptance of the current words: the surface says so. The store
  // keeps the FIRST entry for the same version, so this only writes when the
  // account had none (which is the only time the sheet is shown).
  return recorder.note(userId, currentAgreementItems(), 'reaccept').catch(() => { /* never surfaces */ });
}

/** The code-answer notice was acknowledged (now, or at `at` on this phone earlier). */
export function recordCodeAck(userId: string | null | undefined, version: number, at?: number): void {
  try { void recorder.note(userId, [codeAckItem(version)], 'in_app', at).catch(() => { /* never surfaces */ }); } catch { /* never surfaces */ }
}

/** The scan notice was acknowledged, in the language it was shown in. */
export function recordScanAck(userId: string | null | undefined, lang: 'en' | 'es', at?: number): void {
  try { void recorder.note(userId, [scanAckItem(lang)], 'in_app', at).catch(() => { /* never surfaces */ }); } catch { /* never surfaces */ }
}

/** Send whatever this account still owes. Never rejects. */
export function flushLegalAcceptances(userId: string | null | undefined): Promise<void> {
  return recorder.flush(userId).catch(() => { /* never surfaces */ });
}

/** True when this phone has already noted this exact notice for this account. */
export function hasNotedLegalItem(userId: string | null | undefined, item: LegalItem): Promise<boolean> {
  return recorder.has(userId, item);
}

export type { LegalItem, LegalSurface, ReacceptState };

/**
 * Has this account accepted the CURRENT Terms and Privacy Policy? Reads the
 * account's own rows. 'unknown' when they could not be read (offline, signed
 * out, or the table is not on the server yet): the gate then shows nothing.
 */
export async function readReacceptState(userId: string | null | undefined): Promise<ReacceptState> {
  try {
    if (!userId || !isSupabaseConfigured) return 'unknown';
    const { data, error } = await supabase
      .from('legal_acceptances')
      .select('kind,version,text_sha256')
      .eq('user_id', userId)
      .in('kind', ['terms', 'privacy']);
    if (error || !Array.isArray(data)) return 'unknown';
    return reacceptStateFromRows(data);
  } catch {
    return 'unknown';
  }
}
