// hooks/useSharePresence.ts — the account's own choice: show when I have a
// project open, or not.
//
// profiles.share_presence is NULL (not asked), true or false. Until a person
// answers, the server stores nothing about them and nobody sees a dot or a
// time for them (whoson spec, decision 4).
//
// READ: the caller's own profiles row (own-row select), kept under
// ['whoson_choice', userId]. `known` stays false until the server answers, and
// a read that fails (the column is not there yet, no signal) is unknown, never
// "not asked": the Settings row draws nothing for it. The Team section does
// not use this read at all; it takes the choice from the people rows, so it
// works even where the profile column cannot be selected.
//
// WRITE: set_share_presence through utils/offlineQueue.ts's online-only door
// (never queued: a choice that sits in an outbox was not made when the screen
// said it was). 'offline' = web, nothing sent. 'failed' = refused, or no
// answer: the switch goes back to where it was.

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseRpcOnline, currentSessionUserId } from '@/utils/offlineQueue';
import { useAuth } from '@/contexts/AuthContext';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';
import { WHOSON } from '@/utils/whoson/people';
import { kickPresence, knownChoice, rememberChoice, rememberSavedChoice } from '@/utils/whoson/peopleClient';

export type SaveChoiceResult = 'saved' | 'offline' | 'failed';

export interface SharePresence {
  /** true, false, or null = not asked yet. Meaningless until `known`. */
  choice: boolean | null;
  /** The server has answered the read. Always false with `read: false`. */
  known: boolean;
  setChoice: (on: boolean) => Promise<SaveChoiceResult>;
}

export function useSharePresence(opts?: { read?: boolean }): SharePresence {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const read = opts?.read !== false;
  // A strict boolean: react-query reads `enabled: undefined` as ENABLED.
  const on = Boolean(WHOS_ON_ENABLED && isSupabaseConfigured && userId && read);

  const query = useQuery({
    queryKey: ['whoson_choice', userId],
    enabled: on,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<{ choice: boolean | null }> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), WHOSON.READ_TIMEOUT_MS);
      const sentAtMs = Date.now();
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('share_presence')
          .eq('id', userId as string)
          .abortSignal(ctrl.signal)
          .maybeSingle();
        if (error) throw new Error(error.message);
        // No row is not "not asked": it is not known.
        if (!data) throw new Error('no profile row');
        const v = (data as { share_presence?: unknown }).share_presence;
        const choice = typeof v === 'boolean' ? v : null;
        // A read that went out before a save in this session is a picture from
        // before the save: the client keeps what was saved, and so does this.
        rememberChoice(userId as string, choice, sentAtMs);
        const heard = knownChoice(userId as string);
        return { choice: heard === undefined ? choice : heard };
      } finally {
        clearTimeout(timer);
      }
    },
  });

  const setChoice = useCallback(async (value: boolean): Promise<SaveChoiceResult> => {
    if (!WHOS_ON_ENABLED || !isSupabaseConfigured || !userId) return 'failed';
    try {
      // The door sends as whoever is signed in: that must still be this account.
      if ((await currentSessionUserId()) !== userId) return 'failed';
      const res = await supabaseRpcOnline<boolean>('set_share_presence', { p_on: value });
      if (res.status !== 'synced') return res.code === 'offline' ? 'offline' : 'failed';
    } catch {
      return 'failed';
    }
    rememberSavedChoice(userId, value);
    queryClient.setQueryData(['whoson_choice', userId], { choice: value });
    void queryClient.invalidateQueries({ queryKey: ['whoson_choice'] });
    void queryClient.invalidateQueries({ queryKey: ['project_people'] });
    kickPresence();
    return 'saved';
  }, [userId, queryClient]);

  const data = on ? query.data : undefined;
  return {
    choice: data ? data.choice : null,
    known: data !== undefined,
    setChoice,
  };
}

export default useSharePresence;
