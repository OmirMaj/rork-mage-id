import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase';

export interface QboStatus {
  status: 'disconnected' | 'connecting' | 'connected' | 'reauth_required' | 'error';
  realmId?: string;
  environment?: 'sandbox' | 'production';
  companyName?: string | null;
  lastSyncAt?: string | null;
  counts?: { synced: number; pending: number; error: number };
}

/** Start the OAuth flow. Opens an in-app browser to Intuit; the redirect
 *  URL is handled by the web build (or a deep link). Resolves once the
 *  browser closes; caller should refetch status to confirm. */
export async function connectQuickBooks(): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ success: boolean; authorizeUrl?: string; error?: string }>(
    'qbo-connect-start', { body: {} },
  );
  if (error || !data?.success || !data.authorizeUrl) {
    return { ok: false, error: error?.message ?? data?.error ?? 'Could not start QuickBooks connection.' };
  }
  try {
    if (Platform.OS === 'web') {
      window.location.href = data.authorizeUrl;
    } else {
      await WebBrowser.openAuthSessionAsync(data.authorizeUrl, 'https://app.mageid.app/integrations/qbo/callback');
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Browser could not open.' };
  }
}

/** Complete the callback (called from the web build's /integrations/qbo/callback route). */
export async function completeQuickBooksCallback(opts: { code: string; realmId: string; state: string; environment?: 'sandbox' | 'production' }): Promise<{ ok: boolean; companyName?: string | null; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ success: boolean; companyName?: string | null; error?: string }>(
    'qbo-connect-callback', { body: opts },
  );
  if (error || !data?.success) return { ok: false, error: error?.message ?? data?.error ?? 'Connection failed.' };
  return { ok: true, companyName: data.companyName };
}

export async function fetchQboStatus(): Promise<QboStatus> {
  const { data, error } = await supabase.functions.invoke<QboStatus & { success: boolean }>(
    'qbo-connect-status', { body: {} },
  );
  if (error || !data) return { status: 'disconnected' };
  return data;
}

/** Fire-and-forget push (used by useQboSync from financial mutations). */
export async function triggerQboSync(kind: 'project' | 'invoice' | 'payment' | 'item', op: 'upsert' | 'delete', objectId: string): Promise<void> {
  try { await supabase.functions.invoke('qbo-sync', { body: { kind, op, objectId } }); }
  catch { /* fire-and-forget; status flows via the qbo_sync_status field on the row */ }
}
