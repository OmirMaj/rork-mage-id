// utils/learn/skillsProgress.ts — the mageid_skills_v1 blob: skills checks he
// passed while the award could not reach the server (pending), and his last
// score on each check.
//
// WHY THESE RULES
//   • One key under the mageid_ prefix. APP_STORAGE_PREFIXES covers it, so
//     the tenant-switch sweep (wipeLocalUserCache) removes it with the rest of
//     the account's local data, and a pending award (which holds the printed
//     name) never reaches the next account on a shared phone. Nothing is
//     cached in memory here: every call reads storage, so there is no copy to
//     forget on a user change.
//   • Parsed by hand, defensively: garbage (an old shape, a half write, a hand
//     edit) parses to EMPTY and a bad entry is dropped on its own; nothing
//     throws into the screen.
//   • Every read and write sits in try/catch. AsyncStorage is imported lazily
//     (its module pulls react-native, which bun cannot load), so
//     scripts/validate-skill-quiz-engine.ts can run the parse under bun.
//   • A pending award is retried when /skills-check (or /skills-certificates)
//     gains focus and when the app comes back to the foreground while one of
//     those screens is open. It is dropped once the server answers (issued,
//     or not passed) and on 'quiz_changed' (a retry can never succeed);
//     offline, a server blip and the hourly limit keep it (afterRetry).
//
// A pending entry is "passed, not issued yet". Nothing here ever reads as a
// certificate: only the award function issues one.

import type { SkillTopicId } from './types';
import { skillTopic } from './topics';
import { afterRetry, type AwardOutcome } from './quizEngine';

export const SKILLS_PROGRESS_KEY = 'mageid_skills_v1';

export interface PendingAward {
  topic: SkillTopicId;
  quizVersion: number;
  answers: Record<string, string>;
  holderName: string;
  passedAt: string;
}

export interface LastAttempt {
  correct: number;
  total: number;
  at: string;
}

export interface SkillsProgress {
  v: 1;
  pending: PendingAward[];
  lastAttempt: Partial<Record<SkillTopicId, LastAttempt>>;
}

export const EMPTY_SKILLS_PROGRESS: SkillsProgress = Object.freeze({ v: 1, pending: [], lastAttempt: {} }) as SkillsProgress;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 50;
}

function parseAnswers(v: unknown): Record<string, string> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== 'string' || k.length > 40 || val.length > 40) return null;
    out[k] = val;
  }
  return out;
}

function parsePending(v: unknown): PendingAward | null {
  if (!isRecord(v)) return null;
  const topic = typeof v.topic === 'string' ? skillTopic(v.topic) : null;
  const answers = parseAnswers(v.answers);
  if (!topic || !answers) return null;
  if (!isCount(v.quizVersion) || v.quizVersion < 1) return null;
  if (typeof v.holderName !== 'string' || !v.holderName.trim()) return null;
  if (typeof v.passedAt !== 'string') return null;
  return { topic: topic.id, quizVersion: v.quizVersion, answers, holderName: v.holderName, passedAt: v.passedAt };
}

/** Any stored value (the raw string or an already-parsed object) → a valid
 *  blob. Unknown topics and malformed entries are dropped one by one. */
export function parseSkillsProgress(raw: unknown): SkillsProgress {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return EMPTY_SKILLS_PROGRESS; }
  }
  if (!isRecord(v) || v.v !== 1) return EMPTY_SKILLS_PROGRESS;
  const pending: PendingAward[] = [];
  if (Array.isArray(v.pending)) {
    for (const e of v.pending) {
      const p = parsePending(e);
      // One entry per topic: the newest write wins.
      if (p) { const i = pending.findIndex(x => x.topic === p.topic); if (i >= 0) pending.splice(i, 1); pending.push(p); }
    }
  }
  const lastAttempt: SkillsProgress['lastAttempt'] = {};
  if (isRecord(v.lastAttempt)) {
    for (const [k, a] of Object.entries(v.lastAttempt)) {
      const topic = skillTopic(k);
      if (!topic || !isRecord(a)) continue;
      if (!isCount(a.correct) || !isCount(a.total) || a.correct > a.total || typeof a.at !== 'string') continue;
      lastAttempt[topic.id] = { correct: a.correct, total: a.total, at: a.at };
    }
  }
  return { v: 1, pending, lastAttempt };
}

// ── Pure transitions ────────────────────────────────────────────────────────

export function withPending(p: SkillsProgress, entry: PendingAward): SkillsProgress {
  return { ...p, pending: [...p.pending.filter(e => e.topic !== entry.topic), entry] };
}

export function withoutPending(p: SkillsProgress, topic: SkillTopicId): SkillsProgress {
  if (!p.pending.some(e => e.topic === topic)) return p;
  return { ...p, pending: p.pending.filter(e => e.topic !== topic) };
}

export function withAttempt(p: SkillsProgress, topic: SkillTopicId, a: LastAttempt): SkillsProgress {
  return { ...p, lastAttempt: { ...p.lastAttempt, [topic]: a } };
}

// ── Storage ─────────────────────────────────────────────────────────────────

async function storage() {
  const mod = await import('@react-native-async-storage/async-storage');
  return mod.default;
}

export async function loadSkillsProgress(): Promise<SkillsProgress> {
  try {
    const s = await storage();
    return parseSkillsProgress(await s.getItem(SKILLS_PROGRESS_KEY));
  } catch (err) {
    console.warn('[skills] progress read failed', err);
    return EMPTY_SKILLS_PROGRESS;
  }
}

let writeChain: Promise<void> = Promise.resolve();

/** Read, apply a pure transition, write. Serialized so two quick updates
 *  (record the attempt, then store the pending award) land in order. */
export function updateSkillsProgress(fn: (p: SkillsProgress) => SkillsProgress): Promise<void> {
  const run = async () => {
    const cur = await loadSkillsProgress();
    const next = fn(cur);
    if (next === cur) return;
    try {
      const s = await storage();
      await s.setItem(SKILLS_PROGRESS_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('[skills] progress write failed', err);
    }
  };
  writeChain = writeChain.then(run, run);
  return writeChain;
}

/** The pending award for `topic` on its CURRENT quiz version, or null. An
 *  entry from an older version cannot be issued and is not offered. */
export async function pendingFor(topic: SkillTopicId): Promise<PendingAward | null> {
  const t = skillTopic(topic);
  if (!t) return null;
  const p = await loadSkillsProgress();
  return p.pending.find(e => e.topic === topic && e.quizVersion === t.quizVersion) ?? null;
}

export interface RetryOutcome {
  topic: SkillTopicId;
  result: AwardOutcome;
}

let retrying: Promise<RetryOutcome[]> | null = null;

/** Send every pending award again. One retry loop at a time (focus and the
 *  foreground listener can fire together); a second caller shares the first
 *  loop's outcome. */
export function retryPendingAwards(
  award: (input: Omit<PendingAward, 'passedAt'>) => Promise<AwardOutcome>,
): Promise<RetryOutcome[]> {
  if (retrying) return retrying;
  retrying = (async () => {
    const out: RetryOutcome[] = [];
    try {
      const p = await loadSkillsProgress();
      for (const e of p.pending) {
        const result = await award({ topic: e.topic, quizVersion: e.quizVersion, answers: e.answers, holderName: e.holderName });
        out.push({ topic: e.topic, result });
        if (afterRetry(result) === 'drop') await updateSkillsProgress(cur => withoutPending(cur, e.topic));
        // Offline once means offline for the rest: stop instead of queuing
        // more requests that will fail the same way.
        if (!result.ok && result.reason === 'offline') break;
      }
    } catch (err) {
      console.warn('[skills] pending retry failed', err);
    } finally {
      retrying = null;
    }
    return out;
  })();
  return retrying;
}
