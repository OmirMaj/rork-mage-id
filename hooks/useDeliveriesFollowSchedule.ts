// hooks/useDeliveriesFollowSchedule.ts — is Deliveries That Follow The Schedule
// open on THIS device, for THIS person (lane DELIVERIES-1).
//
// Three things must hold before any of its screens draw:
//   1. the gate (utils/deliveries/allowed.ts): the flag is on, or this is the
//      owner account;
//   2. THE TABLE HAS THE COLUMNS. The build can reach a phone before
//      supabase/migrations/20261012090000_deliveries_follow_schedule.sql is
//      applied. So the device asks the table for the new columns, once, by
//      name. If the answer is an error (the columns are not there, or the
//      phone is offline and has never seen them) the feature stays closed,
//      quietly: no banner, no alert, and the Deliveries screen is the one from
//      before the lane. Nothing is queued. Once the columns have been seen the
//      answer is remembered on the device, so the feature works offline after;
//   3. a signed-in account.
//
// The job-effect preview is on Pro and up (hooks/useTierAccess isProOrAbove).
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { deliveriesFollowScheduleAllowed, deliveriesFollowScheduleIsOwnerPreview } from '@/utils/deliveries/allowed';
import { DELIVERY_SCHEDULE_COLUMNS } from '@/utils/deliveries/rowCore';

/** "This device has seen the delivery columns." A fact about the table, not about a person or a job. */
export const DELIVERY_COLUMNS_SEEN_KEY = 'mageid_deliveries_fs_columns_seen';

export interface DeliveriesFollowSchedule {
  /** The gate passes AND the table has the columns. Every screen of the feature asks this. */
  on: boolean;
  /** The flag is still off: the screens say "Owner Preview". */
  ownerPreview: boolean;
  /** The job-effect preview (Pro and up). */
  canPreviewJobEffect: boolean;
}

async function columnsExist(): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(DELIVERY_COLUMNS_SEEN_KEY)) === '1') return true;
  } catch { /* storage unreadable: ask the table */ }
  try {
    const { error } = await supabase.from('deliveries').select(['id', ...DELIVERY_SCHEDULE_COLUMNS].join(', ')).limit(1);
    if (error) return false;
    try { await AsyncStorage.setItem(DELIVERY_COLUMNS_SEEN_KEY, '1'); } catch { /* asked again next time */ }
    return true;
  } catch {
    return false;
  }
}

export function useDeliveriesFollowSchedule(): DeliveriesFollowSchedule {
  const { user } = useAuth();
  const { isProOrAbove } = useTierAccess();
  const allowed = deliveriesFollowScheduleAllowed(user?.email) && !!user?.id;
  const probe = useQuery({
    queryKey: ['deliveries-follow-schedule-columns', user?.id ?? null],
    queryFn: columnsExist,
    enabled: allowed,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const on = allowed && probe.data === true;
  return { on, ownerPreview: deliveriesFollowScheduleIsOwnerPreview(), canPreviewJobEffect: on && isProOrAbove };
}

export default useDeliveriesFollowSchedule;
