// hooks/useProjectPeople.ts — the people on one project, for THIS viewer.
//
// One read through utils/whoson/peopleClient.ts (the only file that calls the
// server), kept under ['project_people', userId, projectId]. The key carries
// the user id, so a second account on the same device never reads the first
// one's list.
//
// What this hook does NOT do (whoson spec 3.1, section 8):
//   - It does not poll. react-query gives every observer its own timer, and
//     the project page can be mounted twice on desktop, so the one timer lives
//     in components/whoson/ProjectPresenceBeacon.tsx and writes each answer
//     into this cache.
//   - It does not refetch on window focus or on reconnect: the beacon's
//     "back in front" tick is the one foreground trigger.
//   - It does not retry: a read that got no answer is the beacon's back-off.
//
// It IS fresh on open: staleTime 0 and refetchOnMount 'always'. The app
// default is five minutes, which would let a contractor reopen the project
// three minutes after his sub accepted and still read "No team members yet".
//
// An unanswered read is never an empty team: `view` says which it is, and
// `model.known` is false for everything but an answered read with rows.
//
// `people` is NOT the raw payload. It is the people this viewer may see, as
// the model holds them: the owner, then the team members (all of them for the
// project owner; a team member's own row and nobody else's), with emails and
// last-seen times blanked for a viewer who is not the owner. A caller that
// looks a row up in `people` can never show what the model would not.
//
// The clock tick at the bottom makes NO request. It re-renders every 15 s
// only while this read shows something that ages (a dot, or a "min ago" line)
// and stops once the read is stale, when every line is absolute.

import { useEffect, useReducer } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';
import type { ProjectPerson } from '@/types';
import { WHOSON, needsClock, peopleModel, UNKNOWN_PEOPLE, type PeopleModel } from '@/utils/whoson/people';
import { callPeople, readOf, type PeopleRead } from '@/utils/whoson/peopleClient';

/**
 *   'off'      the feature is off, nobody is signed in, or there is no project;
 *   'loading'  the first read is in flight;
 *   'error'    the read failed and nothing was ever read;
 *   'offline'  web, offline at the read, nothing read yet;
 *   'none'     the server answered with no rows this app can show (no access,
 *              or the project is not on the server yet): unknown, draw nothing;
 *   'list'     people to draw (a later refresh may have failed; dots expire on
 *              their own).
 */
export type PeopleView = 'off' | 'loading' | 'error' | 'offline' | 'none' | 'list';

class PeopleReadError extends Error {
  readonly outcome: string;
  constructor(outcome: string) {
    super(`people read: ${outcome}`);
    this.outcome = outcome;
  }
}

const NO_PEOPLE: ProjectPerson[] = [];

export interface ProjectPeople {
  /** The owner, then the team members this viewer may see (model-filtered). [] when unknown. */
  people: ProjectPerson[];
  model: PeopleModel;
  view: PeopleView;
  /** When the request behind `people` was SENT. null = nothing read. */
  fetchedAtMs: number | null;
  /** The clock this render used. */
  nowMs: number;
  refetch: () => void;
}

export function useProjectPeople(projectId: string | null | undefined): ProjectPeople {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // A strict boolean: react-query reads `enabled: undefined` as ENABLED.
  const on = Boolean(WHOS_ON_ENABLED && isSupabaseConfigured && userId && projectId);

  const query = useQuery({
    queryKey: ['project_people', userId, projectId],
    enabled: on,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async (): Promise<PeopleRead> => {
      const result = await callPeople(userId, projectId, 'none');
      const read = readOf(result);
      if (!read) throw new PeopleReadError(result.outcome);
      return read;
    },
  });

  const data = on ? query.data : undefined;
  const fetchedAtMs = data ? data.fetchedAtMs : null;
  const nowMs = Date.now();
  const model = data ? peopleModel(data.people, { fetchedAtMs, nowMs }) : UNKNOWN_PEOPLE;
  // Never the raw rows: only what the model lets this viewer see.
  const people = model.known && model.owner ? [model.owner, ...model.members] : NO_PEOPLE;

  // Re-read the clock (no request) while a dot or a relative time is on screen.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const ticking = on && needsClock(people, fetchedAtMs, nowMs);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(bump, WHOSON.RERENDER_MS);
    return () => clearInterval(id);
  }, [ticking, fetchedAtMs]);

  let view: PeopleView;
  if (!on) view = 'off';
  else if (data) view = model.known ? 'list' : 'none';
  else if (query.isError) view = (query.error as PeopleReadError | null)?.outcome === 'offline' ? 'offline' : 'error';
  else if (query.fetchStatus === 'paused') view = 'offline';
  else view = 'loading';

  return {
    people,
    model,
    view,
    fetchedAtMs,
    nowMs,
    refetch: () => { if (on) void query.refetch(); },
  };
}

export default useProjectPeople;
