// SafetyContext — Wave A safety collections (JHAs, Toolbox Talks, Incidents,
// Hazard Log). Kept OUT of the already-large ProjectContext: this is a new
// feature surface with its own tertiary_* collections and its own server
// tables. Follows the createContextHook + AsyncStorage pattern (PropertyContext)
// but adds offline-first Supabase sync via supabaseWrite (ProjectContext's
// punchItems shape): optimistic setState → persist local → queue remote write.
//
// Mounted directly inside <ProjectProvider> in app/_layout.tsx, so it is below
// <AuthProvider> and can read the current user for canSync + row user_id.

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import type {
  JobHazardAnalysis,
  ToolboxTalk,
  SafetyIncident,
  Hazard,
} from '@/types';

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

export const [SafetyProvider, useSafety] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canSync = !!userId && isSupabaseConfigured;

  const [jhas, setJhas] = useState<JobHazardAnalysis[]>([]);
  const [toolboxTalks, setToolboxTalks] = useState<ToolboxTalk[]>([]);
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
  const [hazards, setHazards] = useState<Hazard[]>([]);

  // Don't write the empty initial state back over persisted data before the
  // first hydrate completes (same guard PropertyContext uses).
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [j, t, i, h] = await Promise.all([
        loadLocal<JobHazardAnalysis[]>(JHAS_KEY, []),
        loadLocal<ToolboxTalk[]>(TOOLBOX_KEY, []),
        loadLocal<SafetyIncident[]>(INCIDENTS_KEY, []),
        loadLocal<Hazard[]>(HAZARDS_KEY, []),
      ]);
      if (cancelled) return;
      if (Array.isArray(j)) setJhas(j.filter(x => x && typeof x.id === 'string'));
      if (Array.isArray(t)) setToolboxTalks(t.filter(x => x && typeof x.id === 'string'));
      if (Array.isArray(i)) setIncidents(i.filter(x => x && typeof x.id === 'string'));
      if (Array.isArray(h)) setHazards(h.filter(x => x && typeof x.id === 'string'));
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // ── JHAs ─────────────────────────────────────────────────────────────
  const addJha = useCallback((jha: JobHazardAnalysis) => {
    const updated = [jha, ...jhas];
    setJhas(updated);
    void saveLocal(JHAS_KEY, updated);
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
  }, [jhas, canSync, userId]);

  const updateJha = useCallback((id: string, updates: Partial<JobHazardAnalysis>) => {
    const now = new Date().toISOString();
    const updated = jhas.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setJhas(updated);
    void saveLocal(JHAS_KEY, updated);
    if (canSync) {
      const j = updated.find(x => x.id === id);
      if (j) void supabaseWrite('jhas', 'update', {
        id, title: j.title, trade: j.trade, task_description: j.taskDescription,
        date: j.date, steps: j.steps, required_ppe: j.requiredPPE, sign_offs: j.signOffs,
        plan_sheet_id: j.planSheetId, pin_x: j.pinX, pin_y: j.pinY,
        ai_generated: j.aiGenerated, status: j.status, updated_at: now,
      });
    }
  }, [jhas, canSync]);

  const deleteJha = useCallback((id: string) => {
    const updated = jhas.filter(x => x.id !== id);
    setJhas(updated);
    void saveLocal(JHAS_KEY, updated);
    if (canSync) void supabaseWrite('jhas', 'delete', { id });
  }, [jhas, canSync]);

  const getJhasForProject = useCallback(
    (projectId: string) => jhas.filter(x => x.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [jhas],
  );

  // ── Toolbox Talks ────────────────────────────────────────────────────
  const addToolboxTalk = useCallback((talk: ToolboxTalk) => {
    const updated = [talk, ...toolboxTalks];
    setToolboxTalks(updated);
    void saveLocal(TOOLBOX_KEY, updated);
    if (canSync) {
      void supabaseWrite('toolbox_talks', 'insert', {
        id: talk.id, user_id: userId, project_id: talk.projectId,
        topic: talk.topic, date: talk.date, presenter: talk.presenter, notes: talk.notes,
        attachment_url: talk.attachmentUrl, attendees: talk.attendees,
        ai_topic_source: talk.aiTopicSource, created_by: talk.createdBy,
        created_at: talk.createdAt, updated_at: talk.updatedAt,
      });
    }
  }, [toolboxTalks, canSync, userId]);

  const updateToolboxTalk = useCallback((id: string, updates: Partial<ToolboxTalk>) => {
    const now = new Date().toISOString();
    const updated = toolboxTalks.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setToolboxTalks(updated);
    void saveLocal(TOOLBOX_KEY, updated);
    if (canSync) {
      const t = updated.find(x => x.id === id);
      if (t) void supabaseWrite('toolbox_talks', 'update', {
        id, topic: t.topic, date: t.date, presenter: t.presenter, notes: t.notes,
        attachment_url: t.attachmentUrl, attendees: t.attendees,
        ai_topic_source: t.aiTopicSource, updated_at: now,
      });
    }
  }, [toolboxTalks, canSync]);

  const deleteToolboxTalk = useCallback((id: string) => {
    const updated = toolboxTalks.filter(x => x.id !== id);
    setToolboxTalks(updated);
    void saveLocal(TOOLBOX_KEY, updated);
    if (canSync) void supabaseWrite('toolbox_talks', 'delete', { id });
  }, [toolboxTalks, canSync]);

  const getToolboxTalksForProject = useCallback(
    (projectId: string) => toolboxTalks.filter(x => x.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [toolboxTalks],
  );

  // ── Incidents ────────────────────────────────────────────────────────
  const addIncident = useCallback((incident: SafetyIncident) => {
    const updated = [incident, ...incidents];
    setIncidents(updated);
    void saveLocal(INCIDENTS_KEY, updated);
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
  }, [incidents, canSync, userId]);

  const updateIncident = useCallback((id: string, updates: Partial<SafetyIncident>) => {
    const now = new Date().toISOString();
    const updated = incidents.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setIncidents(updated);
    void saveLocal(INCIDENTS_KEY, updated);
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
        osha_recordable: i.oshaRecordable, status: i.status, updated_at: now,
      });
    }
  }, [incidents, canSync]);

  const deleteIncident = useCallback((id: string) => {
    const updated = incidents.filter(x => x.id !== id);
    setIncidents(updated);
    void saveLocal(INCIDENTS_KEY, updated);
    if (canSync) void supabaseWrite('safety_incidents', 'delete', { id });
  }, [incidents, canSync]);

  const getIncidentsForProject = useCallback(
    (projectId: string) => incidents.filter(x => x.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [incidents],
  );

  // ── Hazards ──────────────────────────────────────────────────────────
  const addHazard = useCallback((hazard: Hazard) => {
    const updated = [hazard, ...hazards];
    setHazards(updated);
    void saveLocal(HAZARDS_KEY, updated);
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
  }, [hazards, canSync, userId]);

  const updateHazard = useCallback((id: string, updates: Partial<Hazard>) => {
    const now = new Date().toISOString();
    const updated = hazards.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setHazards(updated);
    void saveLocal(HAZARDS_KEY, updated);
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
  }, [hazards, canSync]);

  const deleteHazard = useCallback((id: string) => {
    const updated = hazards.filter(x => x.id !== id);
    setHazards(updated);
    void saveLocal(HAZARDS_KEY, updated);
    if (canSync) void supabaseWrite('hazards', 'delete', { id });
  }, [hazards, canSync]);

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
