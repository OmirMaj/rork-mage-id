// utils/firstJobStore.ts — what "Your First Job" keeps on the device, and the
// proposal read behind its "Send It To Your Client" step. The rules are in
// utils/firstJobPath.ts (pure); this file is only the reads and writes.
//
// STORAGE. Two AsyncStorage keys, both under `mageid_` and both ending in the
// user id, so the tenant-switch sweep (utils/localCacheKeys) removes them and
// one person's answers are never shown to the next person on a shared phone:
//   mageid_first_job_path::<userId>  the answer, skipped steps, hidden, removed
//   mageid_first_job_sent::<userId>  the "an estimate left this phone" mark
// Nothing here is mirrored to the server. The sweep runs on sign-out, so a
// removed card can come back after signing in again; the steps themselves are
// read from the account's data, so an account that did the work is still
// treated as established and is not shown the card.
//
// THE SENT MARK. Sharing an estimate as a PDF from the project page, copying
// the proposal link and emailing the estimate leave nothing saved on the
// project (the estimate wizard's own share does: quotedPaymentSplit.sharedAt).
// markEstimateSent is the smallest mark that lets those three count. It is
// written by the share itself, never by a tap on the card, and never for a
// sample job.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { isSampleProjectName } from '@/utils/projectCap';
import {
  firstJobSentKey, firstJobStateKey, parseStored, serializeStored, type FirstJobStored,
} from '@/utils/firstJobPath';

/** The old starter card's dismissed flag (components/OnboardingChecklist.tsx). Read only. */
const LEGACY_DISMISSED_KEY = 'mageid_onboarding_checklist_dismissed_v2';

export async function loadFirstJobState(userId: string): Promise<FirstJobStored> {
  let raw: string | null = null;
  let legacy = false;
  try { raw = await AsyncStorage.getItem(firstJobStateKey(userId)); } catch { /* treated as nothing saved */ }
  if (!raw) {
    try { legacy = (await AsyncStorage.getItem(LEGACY_DISMISSED_KEY)) === '1'; } catch { /* not dismissed */ }
  }
  return parseStored(raw, legacy);
}

export async function saveFirstJobState(userId: string, state: FirstJobStored): Promise<void> {
  try { await AsyncStorage.setItem(firstJobStateKey(userId), serializeStored(state)); } catch { /* the card still works this visit */ }
}

const sentListeners = new Set<() => void>();
/** Home listens so the step can tick when he comes back from the share. */
export function subscribeEstimateSent(fn: () => void): () => void {
  sentListeners.add(fn);
  return () => { sentListeners.delete(fn); };
}

/**
 * Record that an estimate or proposal really left this phone. Call it where
 * the share succeeds. A sample job is ignored: practising is not doing. The
 * signed-in user is read from the saved session (no network), so a call site
 * is one line.
 */
export async function markEstimateSent(projectName?: string | null): Promise<void> {
  if (projectName != null && isSampleProjectName(projectName)) return;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    if (!userId) return;
    await AsyncStorage.setItem(firstJobSentKey(userId), new Date().toISOString());
    sentListeners.forEach((fn) => fn());
  } catch { /* a missed mark only delays a tick */ }
}

/** true / false once read. Throws nothing: an unreadable store is "no mark". */
export async function readEstimateSent(userId: string): Promise<boolean> {
  try { return !!(await AsyncStorage.getItem(firstJobSentKey(userId))); } catch { return false; }
}

/**
 * The projects that have a proposal or contract out of draft (sent or signed).
 * Row-level security limits the read to his own rows. A failed read THROWS, so
 * the caller can tell "none" from "could not check".
 */
export async function fetchSentContractProjectIds(): Promise<string[]> {
  if (!isSupabaseConfigured) throw new Error('first-job: not connected');
  const { data, error } = await supabase
    .from('project_contracts')
    .select('project_id')
    .in('status', ['sent', 'signed'])
    .limit(200);
  if (error) throw new Error(error.message);
  const ids = new Set<string>();
  for (const r of (data ?? []) as { project_id?: unknown }[]) {
    if (typeof r.project_id === 'string') ids.add(r.project_id);
  }
  return [...ids];
}
