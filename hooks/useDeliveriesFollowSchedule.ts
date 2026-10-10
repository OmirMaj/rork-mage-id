// hooks/useDeliveriesFollowSchedule.ts — is Deliveries That Follow The Schedule
// open on THIS device, for THIS person (lane DELIVERIES-1).
//
// Three things must hold before any of its screens draw:
//   1. the gate (utils/deliveries/allowed.ts): the flag is on, or this is the
//      owner account;
//   2. THE TABLE HAS THE COLUMNS. The build can reach a phone before
//      supabase/migrations/20261012090000_deliveries_follow_schedule.sql is
//      applied. So the device asks the table for the new columns, by name. If
//      the answer is an error (the columns are not there, or the phone is
//      offline and has never seen them) the feature stays closed, quietly: no
//      banner, no alert, and the Deliveries screen is the one from before the
//      lane. Nothing is queued. Once the columns have been seen the answer is
//      remembered on the device, so the feature works offline after;
//   3. a signed-in account.
//
// THE REMEMBERED ANSWER IS READ FIRST, AND NOTHING IS DRAWN ON A GUESS. Reading
// it takes a moment (device storage). Until it is back the hook says `pending`
// and the Deliveries screen draws neither list: it used to draw the old list
// for that moment and then swap it, which is the flicker. A remembered "seen"
// opens the feature with no spinner and no request. `pending` is only ever
// true for a person the gate allows; for everyone else it is false at once and
// the screen is today's screen. It is also never held for the network: with
// nothing remembered the old list is drawn while the table is asked.
//
// THE REMEMBERED ANSWER IS NOT TRUSTED FOR EVER. When a write comes back "no
// such column" for one of the seven, the sync queue removes the stored key and
// calls columnsGate.markColumnsMissing: the feature closes here at once and
// the table is asked again (utils/deliveries/columnsGate.ts).
//
// The job-effect preview is on Pro and up (hooks/useTierAccess isProOrAbove).
import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { deliveriesFollowScheduleAllowed, deliveriesFollowScheduleIsOwnerPreview } from '@/utils/deliveries/allowed';
import { DELIVERY_SCHEDULE_COLUMNS } from '@/utils/deliveries/rowCore';
import {
  DELIVERY_COLUMNS_SEEN_KEY, columnsAnswer, columnsEpoch, setColumnsAnswer, subscribeColumns,
} from '@/utils/deliveries/columnsGate';

export { DELIVERY_COLUMNS_SEEN_KEY };

export interface DeliveriesFollowSchedule {
  /** The gate passes AND the table has the columns. Every screen of the feature asks this. */
  on: boolean;
  /** The gate passes and the remembered answer is still being read: draw neither list yet. */
  pending: boolean;
  /** The flag is still off: the screens say "Owner Preview". */
  ownerPreview: boolean;
  /** The job-effect preview (Pro and up). */
  canPreviewJobEffect: boolean;
}

/** Step 1: what the device remembers. Never asks the network. */
async function readRemembered(): Promise<void> {
  let seen = false;
  try { seen = (await AsyncStorage.getItem(DELIVERY_COLUMNS_SEEN_KEY)) === '1'; } catch { /* storage unreadable: ask the table */ }
  // A write may have proved it wrong while this read was out: only an answer nobody has given yet is filled in.
  if (columnsAnswer() === 'unknown') setColumnsAnswer(seen ? 'seen' : 'unseen');
}

/** Step 2, only with nothing remembered: ask the table for the columns by name. */
async function askTable(): Promise<boolean> {
  try {
    const { error } = await supabase.from('deliveries').select(['id', ...DELIVERY_SCHEDULE_COLUMNS].join(', ')).limit(1);
    if (error) return false;
    try { await AsyncStorage.setItem(DELIVERY_COLUMNS_SEEN_KEY, '1'); } catch { /* asked again next time */ }
    setColumnsAnswer('seen');
    return true;
  } catch {
    return false;
  }
}

export function useDeliveriesFollowSchedule(): DeliveriesFollowSchedule {
  const { user } = useAuth();
  const { isProOrAbove } = useTierAccess();
  const allowed = deliveriesFollowScheduleAllowed(user?.email) && !!user?.id;
  const answer = useSyncExternalStore(subscribeColumns, columnsAnswer, columnsAnswer);
  const epoch = useSyncExternalStore(subscribeColumns, columnsEpoch, columnsEpoch);
  useEffect(() => {
    if (allowed && answer === 'unknown') void readRemembered();
  }, [allowed, answer]);
  // Asked again whenever a write proved the remembered answer wrong (the epoch is in the key).
  useQuery({
    queryKey: ['deliveries-follow-schedule-columns', user?.id ?? null, epoch],
    queryFn: askTable,
    enabled: allowed && answer === 'unseen',
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const on = allowed && answer === 'seen';
  const pending = allowed && answer === 'unknown';
  return { on, pending, ownerPreview: deliveriesFollowScheduleIsOwnerPreview(), canPreviewJobEffect: on && isProOrAbove };
}

export default useDeliveriesFollowSchedule;
