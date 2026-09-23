// ============================================================================
// contexts/ActiveProjectContext.tsx — the job the user is working IN.
//
// Mounted just inside ProjectProvider in app/_layout.tsx (it reads the project
// list and the signed-in user). Consumers: the desktop sidebar (THIS JOB rows,
// the job switcher, Recent), ToolProjectPicker (a pick makes that job active),
// and — in wave 6c — the command palette and project-detail.
//
// All the decisions live in utils/activeProject.ts, which is pure and proven by
// scripts/validate-active-project.ts. This file only wires state, storage and
// the URL to them.
//
// THE URL LEADS. When the current route names a live job (`?projectId=`, or
// project-detail's `?id=`), that job IS the active job, and it is persisted and
// pushed onto the recent list. That is what makes project-detail "set the
// active job on mount" without an edit to project-detail, and what makes a
// refreshed or copied tool URL keep its job.
//
// TENANT SAFETY, three locks, any one of which is enough:
//   1. both keys sit under `mageid_`, so AuthContext's prefix sweep removes them
//      on sign-out and on a tenant switch;
//   2. every stored value is stamped with its user id and ignored for anyone
//      else (utils/activeProject readStamped*);
//   3. nothing is ever shown unless it is in THIS user's project list.
// In-memory state is reset whenever the user id changes.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useCoreData } from '@/contexts/ProjectContext';
import type { Project } from '@/types';
import {
  ACTIVE_PROJECT_KEY,
  RECENT_PROJECTS_KEY,
  pushRecent,
  readStampedActive,
  readStampedRecent,
  resolveActiveProjectId,
  stampActive,
  stampRecent,
  urlProjectIdFrom,
  visibleRecent,
} from '@/utils/activeProject';

export interface ActiveProjectValue {
  activeProjectId: string | null;
  activeProject: Project | null;
  /** Make `id` the active job and push it onto the recent list. `null` clears
   *  the explicit pick (resolution then falls back to recent / in-progress). */
  setActiveProject(id: string | null): void;
  /** Recently opened live jobs, most recent first (at most 5). Closed, sample,
   *  deleted and foreign ids never appear. */
  recentProjectIds: string[];
}

/** What a component sees with no provider above it (a jest mount of one
 *  component, a tree outside the root layout): no job, and a setter that does
 *  nothing. Inert rather than throwing, so ToolProjectPicker can call it
 *  unconditionally. */
const INERT: ActiveProjectValue = {
  activeProjectId: null,
  activeProject: null,
  setActiveProject: () => {},
  recentProjectIds: [],
};

interface Stored {
  uid: string | null;
  /** True once this user's keys have been read (or there is no user). Writes
   *  wait for it: persisting before the read resolves would overwrite the
   *  stored recent list with a one-item list. */
  hydrated: boolean;
  activeId: string | null;
  recent: string[];
}

const EMPTY: Stored = { uid: null, hydrated: false, activeId: null, recent: [] };

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export const [ActiveProjectProvider, useActiveProject] = createContextHook<ActiveProjectValue>(() => {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const { projects } = useCoreData();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ projectId?: string | string[]; id?: string | string[] }>();
  const urlProjectId = urlProjectIdFrom(pathname, params);

  const [stored, setStoredState] = useState<Stored>(EMPTY);
  // Mirrors of the latest state so setActiveProject stays a pure event
  // handler (no storage write inside a state updater, which StrictMode runs
  // twice) and so a write that races a sign-out can never stamp one user's
  // pick under another user's id.
  const storedRef = useRef<Stored>(stored);
  const uidRef = useRef<string | null>(uid);
  uidRef.current = uid;
  const setStored = useCallback((next: Stored) => {
    storedRef.current = next;
    setStoredState(next);
  }, []);
  /** A pick made before hydration finished; applied once it has. */
  const pendingRef = useRef<{ id: string | null } | null>(null);

  // Hydrate per user. Reset FIRST, synchronously, so the previous account's
  // job is gone from memory before the new account's read resolves.
  useEffect(() => {
    pendingRef.current = null;
    setStored({ ...EMPTY, uid, hydrated: !uid });
    if (!uid) return;
    let cancelled = false;
    (async () => {
      let rawActive: string | null = null;
      let rawRecent: string | null = null;
      try {
        const pairs = await AsyncStorage.multiGet([ACTIVE_PROJECT_KEY, RECENT_PROJECTS_KEY]);
        rawActive = pairs[0]?.[1] ?? null;
        rawRecent = pairs[1]?.[1] ?? null;
      } catch {
        // Storage unavailable: resolve from the URL and the project list, and
        // start this session's recent list from empty.
      }
      if (cancelled || uidRef.current !== uid) return;
      setStored({
        uid,
        hydrated: true,
        activeId: readStampedActive(rawActive, uid),
        recent: readStampedRecent(rawRecent, uid),
      });
    })();
    return () => { cancelled = true; };
  }, [uid, setStored]);

  const existingIds = useMemo(() => new Set(projects.map(p => p.id)), [projects]);

  const setActiveProject = useCallback((id: string | null) => {
    const owner = uidRef.current;
    const prev = storedRef.current;
    if (!owner || prev.uid !== owner) return;
    if (!prev.hydrated) { pendingRef.current = { id }; return; }
    const recent = id ? pushRecent(prev.recent, id, existingIds) : prev.recent;
    if (prev.activeId === id && sameList(recent, prev.recent)) return;
    setStored({ uid: owner, hydrated: true, activeId: id, recent });
    AsyncStorage.multiSet([
      [ACTIVE_PROJECT_KEY, stampActive(owner, id)],
      [RECENT_PROJECTS_KEY, stampRecent(owner, recent)],
    ]).catch(() => {});
  }, [existingIds, setStored]);

  useEffect(() => {
    if (!stored.hydrated || !pendingRef.current) return;
    const { id } = pendingRef.current;
    pendingRef.current = null;
    setActiveProject(id);
  }, [stored.hydrated, setActiveProject]);

  // The URL leads: a live job in the URL becomes the stored pick and the most
  // recent job. Only for ids in THIS user's list — a foreign or stale id in a
  // shared link changes nothing.
  useEffect(() => {
    if (!urlProjectId || !uid || stored.uid !== uid || !stored.hydrated) return;
    const live = resolveActiveProjectId({ urlProjectId, storedId: null, recentIds: [], projects });
    if (live !== urlProjectId) return;
    if (stored.activeId === urlProjectId && stored.recent[0] === urlProjectId) return;
    setActiveProject(urlProjectId);
  }, [urlProjectId, uid, stored, projects, setActiveProject]);

  const activeProjectId = useMemo(
    () => (uid ? resolveActiveProjectId({
      urlProjectId,
      storedId: stored.uid === uid ? stored.activeId : null,
      recentIds: stored.uid === uid ? stored.recent : [],
      projects,
    }) : null),
    [uid, urlProjectId, stored, projects],
  );

  const activeProject = useMemo(
    () => (activeProjectId ? projects.find(p => p.id === activeProjectId) ?? null : null),
    [activeProjectId, projects],
  );

  const recentProjectIds = useMemo(
    () => (uid && stored.uid === uid ? visibleRecent(stored.recent, projects) : []),
    [uid, stored, projects],
  );

  return useMemo(
    () => ({ activeProjectId, activeProject, setActiveProject, recentProjectIds }),
    [activeProjectId, activeProject, setActiveProject, recentProjectIds],
  );
}, INERT);
