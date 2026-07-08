// SafetyContext — Wave A safety collections (JHAs, Toolbox Talks, Incidents,
// Hazard Log). Kept OUT of the already-large ProjectContext: this is a new
// feature surface with its own tertiary_* collections and its own server
// tables. Follows the createContextHook + AsyncStorage pattern (PropertyContext)
// but adds offline-first Supabase sync via supabaseWrite (ProjectContext's
// punchItems shape): optimistic setState → persist local → queue remote write.
//
// Mounted directly inside <ProjectProvider> in app/_layout.tsx, so it is below
// <AuthProvider> and can read the current user for canSync + row user_id.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import type {
  JobHazardAnalysis,
  ToolboxTalk,
  SafetyIncident,
  Hazard,
} from '@/types';

// Server table names (RLS-scoped to the signed-in user).
const JHAS_TABLE = 'jhas';
const TOOLBOX_TABLE = 'toolbox_talks';
const INCIDENTS_TABLE = 'safety_incidents';
const HAZARDS_TABLE = 'hazards';

// Local-cache key BASES. The live keys are namespaced per-user
// (`${BASE}_${userId}`) so one account's cache can never render for another
// on a shared/handoff device — see `keys` below. The legacy un-namespaced
// keys are intentionally abandoned; synced records rehydrate from Supabase.
const JHAS_KEY = 'tertiary_jhas';
const TOOLBOX_KEY = 'tertiary_toolbox_talks';
const INCIDENTS_KEY = 'tertiary_safety_incidents';
const HAZARDS_KEY = 'tertiary_hazards';

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function saveLocal(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn('[Safety] Local save failed for', key, err);
  }
}

// ── snake_case row → camelCase domain mappers ──────────────────────────
// JSONB columns (steps, sign_offs, attendees, people_involved,
// corrective_actions) round-trip verbatim, so their inner keys stay camelCase.
type Row = Record<string, unknown>;

function mapJha(r: Row): JobHazardAnalysis {
  return {
    id: r.id as string,
    projectId: (r.project_id as string) ?? '',
    title: (r.title as string) ?? '',
    trade: (r.trade as string) ?? '',
    taskDescription: (r.task_description as string) ?? '',
    date: (r.date as string) ?? '',
    steps: (r.steps as JobHazardAnalysis['steps']) ?? [],
    requiredPPE: (r.required_ppe as string[]) ?? [],
    signOffs: (r.sign_offs as JobHazardAnalysis['signOffs']) ?? [],
    planSheetId: (r.plan_sheet_id as string | undefined) ?? undefined,
    pinX: (r.pin_x as number | undefined) ?? undefined,
    pinY: (r.pin_y as number | undefined) ?? undefined,
    aiGenerated: (r.ai_generated as boolean) ?? false,
    status: (r.status as JobHazardAnalysis['status']) ?? 'draft',
    createdBy: (r.created_by as string) ?? '',
    createdAt: (r.created_at as string) ?? '',
    updatedAt: (r.updated_at as string) ?? '',
  };
}

function mapToolbox(r: Row): ToolboxTalk {
  return {
    id: r.id as string,
    projectId: (r.project_id as string) ?? '',
    topic: (r.topic as string) ?? '',
    date: (r.date as string) ?? '',
    presenter: (r.presenter as string) ?? '',
    notes: (r.notes as string) ?? '',
    attachmentUrl: (r.attachment_url as string | undefined) ?? undefined,
    attendees: (r.attendees as ToolboxTalk['attendees']) ?? [],
    aiTopicSource: (r.ai_topic_source as ToolboxTalk['aiTopicSource']) ?? undefined,
    createdBy: (r.created_by as string) ?? '',
    createdAt: (r.created_at as string) ?? '',
    updatedAt: (r.updated_at as string) ?? '',
  };
}

function mapIncident(r: Row): SafetyIncident {
  return {
    id: r.id as string,
    projectId: (r.project_id as string) ?? '',
    type: (r.type as SafetyIncident['type']) ?? 'near_miss',
    severity: (r.severity as SafetyIncident['severity']) ?? 'low',
    occurredAt: (r.occurred_at as string) ?? '',
    description: (r.description as string) ?? '',
    location: (r.location as string) ?? '',
    planSheetId: (r.plan_sheet_id as string | undefined) ?? undefined,
    pinX: (r.pin_x as number | undefined) ?? undefined,
    pinY: (r.pin_y as number | undefined) ?? undefined,
    peopleInvolved: (r.people_involved as SafetyIncident['peopleInvolved']) ?? [],
    photoUrls: (r.photo_urls as string[]) ?? [],
    correctiveActions: (r.corrective_actions as SafetyIncident['correctiveActions']) ?? [],
    treatment: (r.treatment as SafetyIncident['treatment']) ?? 'none',
    daysAway: (r.days_away as number) ?? 0,
    restrictedDuty: (r.restricted_duty as boolean) ?? false,
    lostConsciousness: (r.lost_consciousness as boolean) ?? false,
    fatality: (r.fatality as boolean) ?? false,
    oshaRecordable: (r.osha_recordable as boolean) ?? false,
    status: (r.status as SafetyIncident['status']) ?? 'open',
    reportedBy: (r.reported_by as string) ?? '',
    createdBy: (r.created_by as string) ?? '',
    createdAt: (r.created_at as string) ?? '',
    updatedAt: (r.updated_at as string) ?? '',
  };
}

function mapHazard(r: Row): Hazard {
  return {
    id: r.id as string,
    projectId: (r.project_id as string) ?? '',
    description: (r.description as string) ?? '',
    location: (r.location as string) ?? '',
    photoUrl: (r.photo_url as string | undefined) ?? undefined,
    severity: (r.severity as Hazard['severity']) ?? 3,
    likelihood: (r.likelihood as Hazard['likelihood']) ?? 3,
    riskScore: (r.risk_score as number) ?? 0,
    planSheetId: (r.plan_sheet_id as string | undefined) ?? undefined,
    pinX: (r.pin_x as number | undefined) ?? undefined,
    pinY: (r.pin_y as number | undefined) ?? undefined,
    assignedTo: (r.assigned_to as string | undefined) ?? undefined,
    dueDate: (r.due_date as string | undefined) ?? undefined,
    correctiveAction: (r.corrective_action as string | undefined) ?? undefined,
    status: (r.status as Hazard['status']) ?? 'open',
    sourceInspectionId: (r.source_inspection_id as string | undefined) ?? undefined,
    createdBy: (r.created_by as string) ?? '',
    createdAt: (r.created_at as string) ?? '',
    updatedAt: (r.updated_at as string) ?? '',
  };
}

// Read a collection: Supabase (RLS-scoped, authoritative) when possible,
// falling back to the per-user local cache on error / offline. Because the
// cache key is per-user, an empty server result correctly yields an empty
// list — it never leaks a prior account's records the way a shared global
// key would.
async function hydrateCollection<T extends { id: string }>(
  table: string,
  key: string,
  canSync: boolean,
  map: (r: Row) => T,
): Promise<T[]> {
  if (canSync) {
    try {
      const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        const mapped = data.map(map).filter(x => x && typeof x.id === 'string');
        await saveLocal(key, mapped);
        return mapped;
      }
    } catch { /* fall through to local cache */ }
  }
  const local = await loadLocal<T[]>(key, []);
  return Array.isArray(local) ? local.filter(x => x && typeof x.id === 'string') : [];
}

export const [SafetyProvider, useSafety] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canSync = !!userId && isSupabaseConfigured;
  // Author stamp for new records — the signed-in user's name (or email).
  const authorName = ((user?.name && user.name.trim()) || user?.email || '').trim();

  // Per-user local-cache keys. Recomputed only when the account changes.
  const keys = useMemo(() => {
    const suffix = userId ?? 'anon';
    return {
      jhas: `${JHAS_KEY}_${suffix}`,
      toolbox: `${TOOLBOX_KEY}_${suffix}`,
      incidents: `${INCIDENTS_KEY}_${suffix}`,
      hazards: `${HAZARDS_KEY}_${suffix}`,
    };
  }, [userId]);

  const [jhas, setJhas] = useState<JobHazardAnalysis[]>([]);
  const [toolboxTalks, setToolboxTalks] = useState<ToolboxTalk[]>([]);
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
  const [hazards, setHazards] = useState<Hazard[]>([]);

  // Don't write the empty initial state back over persisted data before the
  // first hydrate completes (same guard PropertyContext uses).
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = false;
    // Clear the previous account's in-memory rows IMMEDIATELY so a stale
    // cache can never render for a different (or logged-out) user during the
    // async hydrate below. On logout (canSync=false, no server read) this
    // leaves the surfaces empty rather than showing the last user's records.
    setJhas([]); setToolboxTalks([]); setIncidents([]); setHazards([]);
    (async () => {
      const [j, t, i, h] = await Promise.all([
        hydrateCollection(JHAS_TABLE, keys.jhas, canSync, mapJha),
        hydrateCollection(TOOLBOX_TABLE, keys.toolbox, canSync, mapToolbox),
        hydrateCollection(INCIDENTS_TABLE, keys.incidents, canSync, mapIncident),
        hydrateCollection(HAZARDS_TABLE, keys.hazards, canSync, mapHazard),
      ]);
      if (cancelled) return;
      setJhas(j); setToolboxTalks(t); setIncidents(i); setHazards(h);
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [userId, canSync, keys]);

  // ── JHAs ─────────────────────────────────────────────────────────────
  const addJha = useCallback((input: JobHazardAnalysis) => {
    const jha: JobHazardAnalysis = { ...input, createdBy: input.createdBy || authorName };
    const updated = [jha, ...jhas];
    setJhas(updated);
    void saveLocal(keys.jhas, updated);
    if (canSync) {
      void supabaseWrite('jhas', 'insert', {
        id: jha.id, user_id: userId, project_id: jha.projectId,
        title: jha.title, trade: jha.trade, task_description: jha.taskDescription,
        date: jha.date, steps: jha.steps, required_ppe: jha.requiredPPE,
        sign_offs: jha.signOffs, plan_sheet_id: jha.planSheetId, pin_x: jha.pinX, pin_y: jha.pinY,
        ai_generated: jha.aiGenerated, status: jha.status, created_by: jha.createdBy,
        created_at: jha.createdAt, updated_at: jha.updatedAt,
      });
    }
  }, [jhas, canSync, userId, keys, authorName]);

  const updateJha = useCallback((id: string, updates: Partial<JobHazardAnalysis>) => {
    const now = new Date().toISOString();
    const updated = jhas.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setJhas(updated);
    void saveLocal(keys.jhas, updated);
    if (canSync) {
      const j = updated.find(x => x.id === id);
      if (j) void supabaseWrite('jhas', 'update', {
        id, title: j.title, trade: j.trade, task_description: j.taskDescription,
        date: j.date, steps: j.steps, required_ppe: j.requiredPPE, sign_offs: j.signOffs,
        plan_sheet_id: j.planSheetId, pin_x: j.pinX, pin_y: j.pinY,
        ai_generated: j.aiGenerated, status: j.status, updated_at: now,
      });
    }
  }, [jhas, canSync, keys]);

  const deleteJha = useCallback((id: string) => {
    const updated = jhas.filter(x => x.id !== id);
    setJhas(updated);
    void saveLocal(keys.jhas, updated);
    if (canSync) void supabaseWrite('jhas', 'delete', { id });
  }, [jhas, canSync, keys]);

  const getJhasForProject = useCallback(
    (projectId: string) => jhas.filter(x => x.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [jhas],
  );

  // ── Toolbox Talks ────────────────────────────────────────────────────
  const addToolboxTalk = useCallback((input: ToolboxTalk) => {
    const talk: ToolboxTalk = { ...input, createdBy: input.createdBy || authorName };
    const updated = [talk, ...toolboxTalks];
    setToolboxTalks(updated);
    void saveLocal(keys.toolbox, updated);
    if (canSync) {
      void supabaseWrite('toolbox_talks', 'insert', {
        id: talk.id, user_id: userId, project_id: talk.projectId,
        topic: talk.topic, date: talk.date, presenter: talk.presenter, notes: talk.notes,
        attachment_url: talk.attachmentUrl, attendees: talk.attendees,
        ai_topic_source: talk.aiTopicSource, created_by: talk.createdBy,
        created_at: talk.createdAt, updated_at: talk.updatedAt,
      });
    }
  }, [toolboxTalks, canSync, userId, keys, authorName]);

  const updateToolboxTalk = useCallback((id: string, updates: Partial<ToolboxTalk>) => {
    const now = new Date().toISOString();
    const updated = toolboxTalks.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setToolboxTalks(updated);
    void saveLocal(keys.toolbox, updated);
    if (canSync) {
      const t = updated.find(x => x.id === id);
      if (t) void supabaseWrite('toolbox_talks', 'update', {
        id, topic: t.topic, date: t.date, presenter: t.presenter, notes: t.notes,
        attachment_url: t.attachmentUrl, attendees: t.attendees,
        ai_topic_source: t.aiTopicSource, updated_at: now,
      });
    }
  }, [toolboxTalks, canSync, keys]);

  const deleteToolboxTalk = useCallback((id: string) => {
    const updated = toolboxTalks.filter(x => x.id !== id);
    setToolboxTalks(updated);
    void saveLocal(keys.toolbox, updated);
    if (canSync) void supabaseWrite('toolbox_talks', 'delete', { id });
  }, [toolboxTalks, canSync, keys]);

  const getToolboxTalksForProject = useCallback(
    (projectId: string) => toolboxTalks.filter(x => x.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [toolboxTalks],
  );

  // ── Incidents ────────────────────────────────────────────────────────
  const addIncident = useCallback((input: SafetyIncident) => {
    const incident: SafetyIncident = {
      ...input,
      createdBy: input.createdBy || authorName,
      reportedBy: input.reportedBy || authorName,
    };
    const updated = [incident, ...incidents];
    setIncidents(updated);
    void saveLocal(keys.incidents, updated);
    if (canSync) {
      void supabaseWrite('safety_incidents', 'insert', {
        id: incident.id, user_id: userId, project_id: incident.projectId,
        type: incident.type, severity: incident.severity, occurred_at: incident.occurredAt,
        description: incident.description, location: incident.location,
        plan_sheet_id: incident.planSheetId, pin_x: incident.pinX, pin_y: incident.pinY,
        people_involved: incident.peopleInvolved, photo_urls: incident.photoUrls,
        corrective_actions: incident.correctiveActions, treatment: incident.treatment,
        days_away: incident.daysAway, restricted_duty: incident.restrictedDuty,
        lost_consciousness: incident.lostConsciousness, fatality: incident.fatality,
        osha_recordable: incident.oshaRecordable, status: incident.status,
        reported_by: incident.reportedBy, created_by: incident.createdBy,
        created_at: incident.createdAt, updated_at: incident.updatedAt,
      });
    }
  }, [incidents, canSync, userId, keys]);

  const updateIncident = useCallback((id: string, updates: Partial<SafetyIncident>) => {
    const now = new Date().toISOString();
    const updated = incidents.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setIncidents(updated);
    void saveLocal(keys.incidents, updated);
    if (canSync) {
      const i = updated.find(x => x.id === id);
      if (i) void supabaseWrite('safety_incidents', 'update', {
        id, type: i.type, severity: i.severity, occurred_at: i.occurredAt,
        description: i.description, location: i.location,
        plan_sheet_id: i.planSheetId, pin_x: i.pinX, pin_y: i.pinY,
        people_involved: i.peopleInvolved, photo_urls: i.photoUrls,
        corrective_actions: i.correctiveActions, treatment: i.treatment,
        days_away: i.daysAway, restricted_duty: i.restrictedDuty,
        lost_consciousness: i.lostConsciousness, fatality: i.fatality,
        osha_recordable: i.oshaRecordable, status: i.status,
        reported_by: i.reportedBy, updated_at: now,
      });
    }
  }, [incidents, canSync, keys]);

  const deleteIncident = useCallback((id: string) => {
    const updated = incidents.filter(x => x.id !== id);
    setIncidents(updated);
    void saveLocal(keys.incidents, updated);
    if (canSync) void supabaseWrite('safety_incidents', 'delete', { id });
  }, [incidents, canSync, keys]);

  const getIncidentsForProject = useCallback(
    (projectId: string) => incidents.filter(x => x.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [incidents],
  );

  // ── Hazards ──────────────────────────────────────────────────────────
  const addHazard = useCallback((hazard: Hazard) => {
    const updated = [hazard, ...hazards];
    setHazards(updated);
    void saveLocal(keys.hazards, updated);
    if (canSync) {
      void supabaseWrite('hazards', 'insert', {
        id: hazard.id, user_id: userId, project_id: hazard.projectId,
        description: hazard.description, location: hazard.location, photo_url: hazard.photoUrl,
        severity: hazard.severity, likelihood: hazard.likelihood, risk_score: hazard.riskScore,
        plan_sheet_id: hazard.planSheetId, pin_x: hazard.pinX, pin_y: hazard.pinY,
        assigned_to: hazard.assignedTo, due_date: hazard.dueDate,
        corrective_action: hazard.correctiveAction, status: hazard.status,
        source_inspection_id: hazard.sourceInspectionId, created_by: hazard.createdBy,
        created_at: hazard.createdAt, updated_at: hazard.updatedAt,
      });
    }
  }, [hazards, canSync, userId, keys]);

  const updateHazard = useCallback((id: string, updates: Partial<Hazard>) => {
    const now = new Date().toISOString();
    const updated = hazards.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setHazards(updated);
    void saveLocal(keys.hazards, updated);
    if (canSync) {
      const hz = updated.find(x => x.id === id);
      if (hz) void supabaseWrite('hazards', 'update', {
        id, description: hz.description, location: hz.location, photo_url: hz.photoUrl,
        severity: hz.severity, likelihood: hz.likelihood, risk_score: hz.riskScore,
        plan_sheet_id: hz.planSheetId, pin_x: hz.pinX, pin_y: hz.pinY,
        assigned_to: hz.assignedTo, due_date: hz.dueDate,
        corrective_action: hz.correctiveAction, status: hz.status,
        source_inspection_id: hz.sourceInspectionId, updated_at: now,
      });
    }
  }, [hazards, canSync, keys]);

  const deleteHazard = useCallback((id: string) => {
    const updated = hazards.filter(x => x.id !== id);
    setHazards(updated);
    void saveLocal(keys.hazards, updated);
    if (canSync) void supabaseWrite('hazards', 'delete', { id });
  }, [hazards, canSync, keys]);

  const getHazardsForProject = useCallback(
    (projectId: string) => hazards.filter(x => x.projectId === projectId)
      .sort((a, b) => b.riskScore - a.riskScore),
    [hazards],
  );

  return {
    jhas, addJha, updateJha, deleteJha, getJhasForProject,
    toolboxTalks, addToolboxTalk, updateToolboxTalk, deleteToolboxTalk, getToolboxTalksForProject,
    incidents, addIncident, updateIncident, deleteIncident, getIncidentsForProject,
    hazards, addHazard, updateHazard, deleteHazard, getHazardsForProject,
  };
});
