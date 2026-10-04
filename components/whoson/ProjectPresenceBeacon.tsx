// components/whoson/ProjectPresenceBeacon.tsx — the ONE timer behind "who is
// on this project" (whoson spec 3.1). Mounted once at the root; renders
// nothing.
//
// What it does, while a signed-in person has a screen of a SHARED project in
// front and the app is in the foreground:
//   - once a minute, one call: a mark ('open') for a person who said yes, a
//     plain read for everyone else. The rows come back either way and are
//     written into the query cache, where the stack and the roster rows read
//     them. No react-query observer polls.
//     A mark is counted from the last MARK: a plain read in between (a screen
//     opening the Team section, a saved choice, a roster change) never pushes
//     it out, so the dot of someone using the project does not lapse.
//   - one best-effort leave ('closed') when the route leaves the project, when
//     the app reaches the background, and (web) after five minutes with no
//     input. `inactive` is ignored: iOS reports it for Face ID, Control Centre
//     and call banners.
//
// WHICH project: the one the focused ROUTE names, urlProjectIdFrom(pathname,
// params). Never the stored "last picked" project: a contractor back on Home
// does not have a project open.
//
// When to speak and when to stay quiet is decided by the pure
// utils/whoson/heartbeat.ts (truth tables in scripts/validate-whoson.ts); the
// request itself is utils/whoson/peopleClient.ts. This file only owns the
// timer and the listeners.
//
// On web, AppState IS document visibility (react-native-web), so no second
// visibilitychange listener is added. The input listeners are passive capture
// listeners on `document` that write one timestamp.
//
// Everything is inside try/catch: the app must never reach its error boundary
// because of this feature. With WHOS_ON_ENABLED false the component returns
// null before any hook: no listener, no timer, no request.
import React, { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { WHOS_ON_ENABLED } from '@/constants/featureFlags';
import { urlProjectIdFrom } from '@/utils/activeProject';
import { WhosOnBoundary } from './WhosOnBoundary';
import { WHOSON, peopleModel } from '@/utils/whoson/people';
import {
  dueInMs, isWebIdle, leaveNeeded, nextTick,
  type CachedPeopleFacts, type PresenceSituation, type Tick,
} from '@/utils/whoson/heartbeat';
import {
  callPeople, heartbeatState, knownChoice, lastPeopleSentMs, notePeopleRouteChange, peopleInFlight, readOf,
  subscribePeopleResults, subscribePresenceKick,
  type PeopleRead, type PeopleResult,
} from '@/utils/whoson/peopleClient';

/** Read at use, not at import: the idle rule exists on web only. */
const isWeb = (): boolean => Platform.OS === 'web';
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

let logged = false;
function logOnce(where: string, err: unknown): void {
  if (logged) return;
  logged = true;
  console.warn(`[WhosOn] beacon ${where} failed:`, err instanceof Error ? err.message : String(err));
}

interface Engine {
  /** The signed-in user or the route's project changed. */
  setWho: (userId: string | null, projectId: string | null) => void;
  setAppState: (state: AppStateStatus) => void;
  noteInput: () => void;
  onResult: (userId: string, projectId: string, result: PeopleResult) => void;
  /** Something outside asked for a tick now (the choice was saved). */
  kick: () => void;
  /** A roster read landed for this project (an invite sent, accepted or revoked). */
  rosterChanged: (projectId: unknown) => void;
  stop: () => void;
}

function createEngine(queryClient: QueryClient): Engine {
  let situation: PresenceSituation = { userId: null, projectId: null, appState: 'active', webIdle: false };
  /** The project this device last marked open and has not left. */
  let markedProjectId: string | null = null;
  /** The project a mark was last SENT for and has not answered yet. */
  let markAttemptFor: string | null = null;
  let lastInputMs = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** When this engine last sent anything. The floor under every wait: whatever
   *  an answer says, two requests are never closer than MIN_GAP_MS. */
  let lastFireMs: number | null = null;
  /** When this engine last sent a MARK for the project in front. The minute
   *  between marks is counted from here, never from a plain read. Cleared when
   *  the device leaves the project. */
  let lastMarkMs: number | null = null;
  let stopped = false;

  const clear = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const facts = (): CachedPeopleFacts | null => {
    const { userId, projectId } = situation;
    if (!userId || !projectId) return null;
    const read = queryClient.getQueryData<PeopleRead>(['project_people', userId, projectId]);
    if (!read) return null;
    const m = peopleModel(read.people, { fetchedAtMs: read.fetchedAtMs, nowMs: Date.now() });
    // What this session last heard (a save a second ago) beats an older read.
    const heard = knownChoice(userId);
    return { known: m.known, shared: m.shared, viewerIsOwner: m.viewerIsOwner, choice: heard === undefined ? m.choice : heard };
  };

  const ownerHasPending = (): boolean => {
    const { projectId } = situation;
    if (!projectId) return false;
    const roster = queryClient.getQueryData<{ status?: string }[]>(['project_collaborators', projectId]);
    return Array.isArray(roster) && roster.some(c => c?.status === 'pending');
  };

  const tickNow = (): Tick => {
    const hb = heartbeatState();
    const { userId, projectId } = situation;
    return nextTick({
      userId,
      routeProjectId: projectId,
      foreground: situation.appState !== 'background',
      webIdle: situation.webIdle,
      cached: facts(),
      ownerHasPending: ownerHasPending(),
      inFlight: peopleInFlight(userId, projectId),
      backoffLevel: hb.backoffLevel,
      pausedUntilMs: hb.pausedUntilMs,
      stopped: hb.stoppedProjectId !== null && hb.stoppedProjectId === projectId,
      marked: markedProjectId !== null && markedProjectId === projectId,
      nowMs: Date.now(),
    });
  };

  const leave = (userId: string | null, projectId: string | null) => {
    if (!userId || !projectId) return;
    void callPeople(userId, projectId, 'closed').catch(() => {});
  };

  /** Move to a new situation: send the one leave it calls for, then re-plan. */
  const move = (next: PresenceSituation) => {
    const prev = situation;
    const toLeave = leaveNeeded({ ...prev, markedProjectId }, next);
    situation = next;
    if (toLeave) {
      markedProjectId = null;
      lastMarkMs = null;
      leave(prev.userId, toLeave);
    }
    if (prev.userId !== next.userId) { markedProjectId = null; markAttemptFor = null; }
    if (prev.userId !== next.userId || prev.projectId !== next.projectId) {
      lastMarkMs = null;
      notePeopleRouteChange();
    }
    plan('event');
  };

  const fire = () => {
    timer = null;
    if (stopped) return;
    try {
      // Web: nobody has touched the computer for the idle limit.
      if (!situation.webIdle && isWebIdle({ isWeb: isWeb(), lastInputMs, nowMs: Date.now() })) {
        move({ ...situation, webIdle: true });
        return;
      }
      const tick = tickNow();
      const { userId, projectId } = situation;
      if (tick.action === 'none' || !userId || !projectId) {
        // Quiet for now. If that is the ten-minute server pause, it may have
        // been set by a call no listener is told about (a leave): plan() sets
        // the look at the end of the pause, and does nothing otherwise.
        plan('event');
        return;
      }
      lastFireMs = Date.now();
      if (tick.action === 'mark') {
        markAttemptFor = projectId;
        lastMarkMs = lastFireMs;
      }
      // The answer comes back through onResult (the client tells every listener).
      void callPeople(userId, projectId, tick.action === 'mark' ? 'open' : 'none').catch(() => {});
    } catch (err) {
      logOnce('tick', err);
    }
  };

  function plan(reason: 'result' | 'event', atLeastMs = 0): void {
    try {
      clear();
      if (stopped) return;
      const nowMs = Date.now();
      const hb = heartbeatState();
      const tick = tickNow();
      if (tick.action === 'none') {
        // Paused by a server refusal: look again when the pause ends.
        const waiting = situation.userId && situation.projectId && situation.appState !== 'background' && !situation.webIdle;
        if (waiting && nowMs < hb.pausedUntilMs) timer = setTimeout(() => plan('event'), hb.pausedUntilMs - nowMs + 50);
        return;
      }
      const due = dueInMs({ tick, reason, lastSentMs: lastPeopleSentMs(), lastMarkMs, backoffLevel: hb.backoffLevel, nowMs });
      const floor = lastFireMs === null ? 0 : Math.max(0, lastFireMs + WHOSON.MIN_GAP_MS - nowMs);
      timer = setTimeout(fire, Math.max(due, floor, atLeastMs));
    } catch (err) {
      logOnce('plan', err);
    }
  }

  return {
    setWho(userId, projectId) {
      try {
        if (situation.userId === userId && situation.projectId === projectId) return;
        // Getting here is itself something a person did.
        lastInputMs = Date.now();
        move({ ...situation, userId, projectId, webIdle: false });
      } catch (err) { logOnce('route', err); }
    },
    setAppState(state) {
      try {
        // `inactive` (Face ID, Control Centre, a call banner) is not a leave.
        if (state !== 'active' && state !== 'background') return;
        if (state === situation.appState) return;
        if (state === 'active') lastInputMs = Date.now();
        move({ ...situation, appState: state, webIdle: state === 'active' ? false : situation.webIdle });
      } catch (err) { logOnce('app state', err); }
    },
    noteInput() {
      lastInputMs = Date.now();
      if (!situation.webIdle) return;
      try { move({ ...situation, webIdle: false }); } catch (err) { logOnce('input', err); }
    },
    onResult(userId, projectId, result) {
      try {
        if (stopped) return;
        const read = readOf(result);
        if (read) queryClient.setQueryData<PeopleRead>(['project_people', userId, projectId], read);
        const attempted = markAttemptFor === projectId;
        if (attempted) markAttemptFor = null;
        const landed = result.outcome === 'ok' && result.marked;
        // No answer to a mark: it may have reached the server, so a leave is still owed.
        const mayHaveLanded = attempted && result.outcome === 'unknown';
        if ((landed || mayHaveLanded) && userId === situation.userId) {
          const stillThere = situation.projectId === projectId && situation.appState !== 'background' && !situation.webIdle;
          if (stillThere) markedProjectId = projectId;
          // The mark landed after this device had already left: take it back.
          else leave(userId, projectId);
        }
        if (userId !== situation.userId || projectId !== situation.projectId) return;
        // Nothing was sent (web offline, or the session is not this account's
        // yet): look again in a minute, never at once.
        const notSent = result.outcome === 'dropped' || result.outcome === 'offline';
        plan('result', notSent ? WHOSON.TICK_MS : 0);
      } catch (err) { logOnce('result', err); }
    },
    kick() {
      plan('event');
    },
    rosterChanged(projectId) {
      if (typeof projectId === 'string' && projectId === situation.projectId) plan('event');
    },
    stop() {
      stopped = true;
      clear();
    },
  };
}

function ProjectPresenceBeaconInner() {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ projectId?: string | string[]; id?: string | string[] }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  let routeProjectId: string | null = null;
  try {
    routeProjectId = urlProjectIdFrom(pathname ?? '', params ?? {});
  } catch (err) {
    logOnce('route read', err);
  }

  const engineRef = useRef<Engine | null>(null);

  // The engine, the AppState listener and the two subscriptions live as long
  // as the beacon does.
  useEffect(() => {
    let engine: Engine;
    try {
      engine = createEngine(queryClient);
    } catch (err) {
      logOnce('start', err);
      return;
    }
    engineRef.current = engine;
    const offResults = subscribePeopleResults((u, p, r) => engine.onResult(u, p, r));
    const offKick = subscribePresenceKick(() => engine.kick());
    let appSub: { remove: () => void } | null = null;
    let offRoster: (() => void) | null = null;
    try {
      // Launched straight into the background: say so before the first event.
      // (Anything but 'active' / 'background' is ignored, a non-string included.)
      engine.setAppState(AppState.currentState);
      appSub = AppState.addEventListener('change', (state: AppStateStatus) => engine.setAppState(state));
      // An invite sent or accepted changes whether an owner alone should keep
      // looking: re-plan when THIS project's roster read lands.
      offRoster = queryClient.getQueryCache().subscribe((event) => {
        try {
          if (event.type !== 'updated' || event.action.type !== 'success') return;
          const key = event.query.queryKey;
          if (Array.isArray(key) && key[0] === 'project_collaborators') engine.rosterChanged(key[1]);
        } catch (err) { logOnce('roster', err); }
      });
    } catch (err) {
      logOnce('listen', err);
    }
    return () => {
      engineRef.current = null;
      engine.stop();
      offResults();
      offKick();
      try { appSub?.remove(); } catch { /* ignore */ }
      try { offRoster?.(); } catch { /* ignore */ }
    };
  }, [queryClient]);

  // Who is signed in, and which project the focused route names.
  useEffect(() => {
    engineRef.current?.setWho(userId, routeProjectId);
  }, [userId, routeProjectId]);

  // Web: input on the page is what "somebody is at the computer" means.
  const watching = isWeb() && !!userId && !!routeProjectId;
  useEffect(() => {
    if (!watching || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    const onInput = () => { engineRef.current?.noteInput(); };
    const opts = { capture: true, passive: true } as const;
    try {
      for (const name of INPUT_EVENTS) document.addEventListener(name, onInput, opts);
    } catch (err) {
      logOnce('input listen', err);
    }
    return () => {
      try {
        for (const name of INPUT_EVENTS) document.removeEventListener(name, onInput, opts);
      } catch { /* ignore */ }
    };
  }, [watching]);

  return null;
}

export function ProjectPresenceBeacon() {
  if (!WHOS_ON_ENABLED) return null;
  // The boundary is for the router hooks: a hook cannot be put in a try/catch.
  return <WhosOnBoundary><ProjectPresenceBeaconInner /></WhosOnBoundary>;
}

export default ProjectPresenceBeacon;
