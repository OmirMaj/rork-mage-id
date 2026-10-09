// utils/legalAcceptance.ts — the app's one recorder of acceptances and
// acknowledgements (Terms of Service, Privacy Policy, the code-answer notice,
// the scan notice, the yes to sending a scanned room to the account). The rules are utils/legalAcceptanceCore.ts (pure, run under
// bun by scripts/validate-legal-acceptance.ts); this file only connects them to
// AsyncStorage, the session and the one rpc.
//
// A TERMS OR PRIVACY ROW MEANS the account signed in on a screen that displayed
// the sentence for these versions, or tapped "I Agree" on the sheet. So
// recordSignInAcceptance writes only when signInAcceptanceSurface says so: from
// a screen whose constant in the core module is true, never from an email link
// or a restored session, and, with the re-acceptance gate on, never for an
// account that already existed.
//
// THE ONE WRITE is record_my_legal_acceptance through supabaseRpcOnline:
// online-only, never put on the offline queue, never written to the Not-saved
// ledger, never toasted. What could not be sent stays in the store
// (mageid_legal_acceptance_v1, owner-stamped; it survives sign-out and a change
// of account on the phone) and is sent at the next sign-in, app start and
// foreground (components/LegalGateHost). A record the server refuses is tried
// a few times, further apart, then left until the app starts again. The server stamps
// who and when; a retry writes nothing twice.
//
// NOTHING HERE CAN FAIL A SIGN-IN. Every export returns void or a promise that
// never rejects, and contexts/AuthContext.tsx calls them without awaiting.
//
// No react-native import (the same reason as utils/codeAck.ts): the platform
// the build and the update id are handed in by components/LegalGateHost.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseRpcOnline } from '@/utils/offlineQueue';
import { TERMS_REACCEPT_ENABLED } from '@/constants/featureFlags';
import {
  codeAckItem,
  createLegalRecorder,
  currentAgreementItems,
  reacceptStateFromRows,
  scanAckItem,
  scanRoomUploadItem,
  signInAcceptanceSurface,
  type LegalItem,
  type LegalSurface,
  type ReacceptState,
  type SignInMethod,
  type SignInScreen,
} from '@/utils/legalAcceptanceCore';

export {
  PRIVACY_URL,
  PRIVACY_VERSION,
  TERMS_URL,
  TERMS_VERSION,
  type SignInMethod,
  type SignInScreen,
} from '@/utils/legalAcceptanceCore';

let build: { appVersion: string | null; updateId: string | null; platform: string | null } = { appVersion: null, updateId: null, platform: null };

/** components/LegalGateHost hands over the build, the over-the-air update id and the platform once. */
export function setLegalBuildInfo(info: { appVersion: string | null; updateId?: string | null; platform: string | null }): void {
  build = { appVersion: info.appVersion, updateId: info.updateId ?? null, platform: info.platform };
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
  updateId: () => build.updateId,
  platform: () => build.platform,
});

/**
 * A sign-in or a sign-up just happened for `user` through `method`
 * (`startedFrom` says which screen Apple / Google was started on). Records the
 * Terms of Service and the Privacy Policy ONLY when that screen displays the
 * sentence in this build and the re-acceptance gate does not own this account
 * (signInAcceptanceSurface); otherwise it does nothing at all.
 * Works with no session yet (an email sign-up waiting for its confirmation
 * link): the note is kept under the new account's id and sent when that
 * account's session arrives, so it keeps the surface of the sign-up tap.
 * Best effort, returns at once, never throws.
 */
export function recordSignInAcceptance(
  user: { id?: string | null; created_at?: string | null; last_sign_in_at?: string | null } | null | undefined,
  method: SignInMethod,
  startedFrom?: SignInScreen | null,
): void {
  try {
    if (!user?.id) return;
    const surface = signInAcceptanceSurface({ method, startedFrom, user, reacceptOn: TERMS_REACCEPT_ENABLED });
    if (!surface) return;
    void recorder.note(user.id, currentAgreementItems(), surface).catch(() => { /* never surfaces */ });
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

/**
 * "Save to My Account" on the Living Model's scan question: he agreed that a
 * scanned room's name and sizes are sent to his account, in the language the
 * question was shown in. Best effort, returns at once, never throws.
 */
export function recordScanRoomUpload(userId: string | null | undefined, lang: 'en' | 'es', at?: number): void {
  try { void recorder.note(userId, [scanRoomUploadItem(lang)], 'in_app', at).catch(() => { /* never surfaces */ }); } catch { /* never surfaces */ }
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
    const state = reacceptStateFromRows(data);
    if (state !== 'needed') return state;
    // The server has no row yet, but this phone noted both documents for this
    // account (a sign-up a moment ago, or "I Agree" with no signal): accepted,
    // and the record is on its way.
    const items = currentAgreementItems();
    const noted = await Promise.all(items.map((item) => recorder.has(userId, item)));
    return noted.every(Boolean) ? 'accepted' : 'needed';
  } catch {
    return 'unknown';
  }
}
