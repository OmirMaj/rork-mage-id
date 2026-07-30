// utils/scheduleDraft.ts — autosave for the schedule wizard.
//
// The wizard now presents itself as creating a FILE you type into, but nothing
// was written until Save — so backgrounding the app mid-build silently lost the
// whole thing. A file you can lose isn't a file. This persists the in-progress
// draft as you edit and restores it on return.
//
// Split like the rest of the codebase: the pure decision logic (serialize,
// validate, staleness, worth-restoring) is exported and unit-tested; only the
// three thin functions at the bottom touch AsyncStorage.
//
// STORAGE KEY is per-user and therefore registered in LOCAL_USER_CACHE_KEYS
// (contexts/AuthContext) — otherwise one user's draft would surface for the
// next person on a shared device.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TemplateTask } from '@/constants/scheduleTemplates';

export const SCHEDULE_DRAFT_KEY = 'mageid_schedule_draft';

/** Bump when the shape changes; older drafts are then ignored rather than
 *  crashing a restore on a field that moved. */
export const SCHEDULE_DRAFT_VERSION = 1;

/** Drafts older than this are treated as abandoned, not resumed. Coming back a
 *  week later to a half-built schedule you'd forgotten is worse than an empty one. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ScheduleDraft {
  version: number;
  projectId: string;
  templateId: string;
  startIso: string;
  tasks: TemplateTask[];
  /** Epoch ms of the last write. */
  savedAt: number;
}

export interface DraftInput {
  projectId: string;
  templateId: string;
  startIso: string;
  tasks: TemplateTask[];
  nowMs: number;
}

/** Build the persisted record. Pure. */
export function buildDraft(input: DraftInput): ScheduleDraft {
  return {
    version: SCHEDULE_DRAFT_VERSION,
    projectId: input.projectId,
    templateId: input.templateId,
    startIso: input.startIso,
    tasks: input.tasks,
    savedAt: input.nowMs,
  };
}

/**
 * Is this draft worth writing? A single untouched blank row is the wizard's
 * own seeded state, not the user's work — persisting it would resurrect an
 * empty file forever and make "start fresh" impossible.
 */
export function isWorthSaving(tasks: TemplateTask[]): boolean {
  const named = tasks.filter((t) => (t.name ?? '').trim().length > 0);
  if (named.length === 0) return false;
  // One named task only counts once it says something beyond the placeholder.
  return named.length > 1 || (named[0]?.name ?? '').trim().length > 1;
}

/** Validate an unknown blob from storage. Returns null for anything we can't
 *  trust — wrong version, wrong shape, or stale. */
export function parseDraft(raw: unknown, nowMs: number): ScheduleDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<ScheduleDraft>;
  if (d.version !== SCHEDULE_DRAFT_VERSION) return null;
  if (!Array.isArray(d.tasks) || d.tasks.length === 0) return null;
  if (typeof d.savedAt !== 'number' || !Number.isFinite(d.savedAt)) return null;
  if (nowMs - d.savedAt > DRAFT_MAX_AGE_MS) return null; // abandoned
  if (typeof d.projectId !== 'string') return null;
  if (!isWorthSaving(d.tasks as TemplateTask[])) return null;
  return {
    version: SCHEDULE_DRAFT_VERSION,
    projectId: d.projectId,
    templateId: typeof d.templateId === 'string' ? d.templateId : '',
    startIso: typeof d.startIso === 'string' ? d.startIso : '',
    tasks: d.tasks as TemplateTask[],
    savedAt: d.savedAt,
  };
}

/**
 * Should we restore this draft into the screen the user just opened?
 * Only when it belongs to the same project — resuming someone's kitchen draft
 * inside a bathroom job would be worse than losing it.
 */
export function draftMatchesEntry(draft: ScheduleDraft, entryProjectId: string): boolean {
  if (!entryProjectId) return true; // no project chosen yet — the draft decides
  return draft.projectId === entryProjectId;
}

/** Human "saved 2 minutes ago" for the autosave indicator. Pure. */
export function savedAgoLabel(savedAt: number, nowMs: number): string {
  const secs = Math.max(0, Math.round((nowMs - savedAt) / 1000));
  if (secs < 5) return 'Saved';
  if (secs < 60) return `Saved ${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `Saved ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `Saved ${hrs}h ago`;
}

// ── Storage (the only impure part) ──────────────────────────────────────────

export async function saveDraft(input: DraftInput): Promise<void> {
  try {
    if (!isWorthSaving(input.tasks)) return;
    await AsyncStorage.setItem(SCHEDULE_DRAFT_KEY, JSON.stringify(buildDraft(input)));
  } catch {
    // Autosave must never surface an error mid-typing.
  }
}

export async function loadDraft(nowMs: number): Promise<ScheduleDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULE_DRAFT_KEY);
    if (!raw) return null;
    return parseDraft(JSON.parse(raw), nowMs);
  } catch {
    return null;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SCHEDULE_DRAFT_KEY);
  } catch {
    // best effort
  }
}
