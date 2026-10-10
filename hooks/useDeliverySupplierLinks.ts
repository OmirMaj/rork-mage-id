// hooks/useDeliverySupplierLinks.ts — the Supplier Link's one door to the
// server (lane DELIVERIES-2).
//
// ONLINE ONLY, ON PURPOSE. A link the server does not hold is a dead link, so
// making one, turning one off and marking an answer as seen are done straight
// against public.delivery_supplier_links and are NOT queued offline: with no
// signal the action fails and the screen says so. This is the one place the
// lane touches the network. It touches no other table, and public.deliveries
// is never written from here (a date a person chooses to use is saved by the
// delivery's own writer, through the offline queue, like any other edit).
//
// THE SECTION IS CLOSED UNTIL THE TABLE HAS ANSWERED. The build can reach a
// phone before supabase/migrations/20261013090000_delivery_supplier_links.sql
// is applied. `on` is true only when the gate passes (utils/deliveryLink/core)
// AND the read of the job's links has come back without an error. A missing
// table, or no signal, leaves the delivery's sheet exactly as it was.
//
// NOTHING HERE SENDS ANYTHING. No function is called, no message, no push.
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  readLinkRow, supplierLinkAllowed, supplierLinkIsOwnerPreview, type SupplierLink, type SupplierLinkShown,
} from '@/utils/deliveryLink/core';

const COLUMNS = 'delivery_id, token, shown, made_at, reply, reply_count, reply_seen_at';
const TABLE = 'delivery_supplier_links';

export interface DeliverySupplierLinks {
  /** The gate passes and the table has answered. Nothing of the section draws without it. */
  on: boolean;
  ownerPreview: boolean;
  /** The link for a delivery, or null. */
  linkFor: (deliveryId: string) => SupplierLink | null;
  /** An action is in flight. */
  busy: boolean;
  /** Make the link. Resolves false when it did not go through. */
  make: (deliveryId: string, shown: SupplierLinkShown) => Promise<boolean>;
  /** Turn the link off: the row is removed and the token stops working. */
  turnOff: (deliveryId: string) => Promise<boolean>;
  /** Record that a person has looked at the latest answer. */
  markSeen: (deliveryId: string) => Promise<boolean>;
  /** Read the job's links again (a person pressed Check for an Answer). */
  refresh: () => Promise<boolean>;
}

async function readLinks(projectId: string): Promise<SupplierLink[]> {
  const { data, error } = await supabase.from(TABLE).select(COLUMNS).eq('project_id', projectId);
  if (error) throw new Error(error.message);
  const out: SupplierLink[] = [];
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const link = readLinkRow(row);
    if (link) out.push(link);
  }
  return out;
}

export function useDeliverySupplierLinks(projectId: string): DeliverySupplierLinks {
  const { user } = useAuth();
  const client = useQueryClient();
  const allowed = supplierLinkAllowed(user?.email) && !!user?.id && !!projectId;
  const key = useMemo(() => ['delivery-supplier-links', user?.id ?? null, projectId] as const, [user?.id, projectId]);
  const query = useQuery({ queryKey: key, queryFn: () => readLinks(projectId), enabled: allowed, staleTime: 30 * 1000, retry: false });
  const [busy, setBusy] = useState(false);
  const links = query.data;

  const linkFor = useCallback((deliveryId: string) => (links ?? []).find((l) => l.deliveryId === deliveryId) ?? null, [links]);

  const run = useCallback(async (work: () => Promise<{ error: { message: string } | null }>): Promise<boolean> => {
    if (!allowed) return false;
    setBusy(true);
    try {
      const { error } = await work();
      if (error) return false;
      await client.invalidateQueries({ queryKey: key });
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [allowed, client, key]);

  const userId = user?.id ?? '';
  const make = useCallback((deliveryId: string, shown: SupplierLinkShown) => run(async () =>
    supabase.from(TABLE).insert({ delivery_id: deliveryId, project_id: projectId, user_id: userId, shown })), [run, projectId, userId]);
  const turnOff = useCallback((deliveryId: string) => run(async () =>
    supabase.from(TABLE).delete().eq('delivery_id', deliveryId)), [run]);
  const markSeen = useCallback((deliveryId: string) => run(async () =>
    supabase.from(TABLE).update({ reply_seen_at: new Date().toISOString() }).eq('delivery_id', deliveryId)), [run]);
  const refresh = useCallback(async () => {
    if (!allowed) return false;
    setBusy(true);
    try { const r = await query.refetch(); return !r.isError; } finally { setBusy(false); }
  }, [allowed, query]);

  return { on: allowed && query.isSuccess, ownerPreview: supplierLinkIsOwnerPreview(), linkFor, busy, make, turnOff, markSeen, refresh };
}

export default useDeliverySupplierLinks;
