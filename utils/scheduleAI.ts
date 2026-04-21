// scheduleAI.ts — AI-powered helpers for the Pro scheduler.
//
// The idea: treat the schedule like structured data the AI can reason about.
// We serialize a compact view (no crew sizes, no notes, no internal ids) and
// let Gemini riff on it. Each function returns a typed result + a
// human-readable summary so the UI can show cards without parsing strings.
//
// All calls go through the existing `mageAI` helper (Supabase edge function
// → Gemini) so we inherit caching, rate limiting, and error handling.
//
// Non-goals: perfect answers. AI output is SUGGESTIONS. The user always
// commits the change — we never mutate the schedule for them.

import { mageAI } from '@/utils/mageAI';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';
import { createId } from '@/utils/scheduleEngine';

// ---------------------------------------------------------------------------
// Serializer — turns the schedule into a string Gemini can read cheaply.
// ---------------------------------------------------------------------------
function serializeSchedule(tasks: ScheduleTask[], cpm: CpmResult): string {
  const lines: string[] = [];
  // Map internal ids to human-readable aliases so the AI can cite them.
  const aliasById = new Map<string, string>();
  tasks.forEach((t, i) => aliasById.set(t.id, `T${i + 1}`));

  lines.push(`Project finish: day ${cpm.projectFinish}`);
  lines.push(`Total tasks: ${tasks.length}`);
  lines.push(`Critical path: ${cpm.criticalPath.map(id => aliasById.get(id)).join(' → ')}`);
  lines.push('');
  lines.push('Tasks (alias | name | start | duration | crew | deps | status | progress):');

  for (const t of tasks) {
    const alias = aliasById.get(t.id)!;
    const deps = t.dependencies.map(d => aliasById.get(d) ?? '?').join(',');
    const cpmRow = cpm.perTask.get(t.id);
    const float = cpmRow ? ` float=${cpmRow.totalFloat}` : '';
    const actual = t.actualStartDay != null
      ? ` actualStart=${t.actualStartDay}${t.actualEndDay ? ` actualEnd=${t.actualEndDay}` : ''}`
      : '';
    lines.push(`${alias} | ${t.title} | start=${t.startDay} | dur=${t.durationDays}d | ${t.crew || '-'} | deps=[${deps}] | ${t.status} | ${t.progress}%${float}${actual}`);
  }
  return lines.join('\n');
}

// Reverse-lookup: alias → task id. We'll use this to map AI replies back to
// concrete tasks the UI can act on.
function buildAliasMap(tasks: ScheduleTask[]): { byAlias: Map<string, string>; byId: Map<string, string> } {
  const byAlias = new Map<string, string>();
  const byId = new Map<string, string>();
  tasks.forEach((t, i) => {
    const alias = `T${i + 1}`;
    byAlias.set(alias, t.id);
    byId.set(t.id, alias);
  });
  return { byAlias, byId };
}

// ---------------------------------------------------------------------------
// 1) Risk detector
// ---------------------------------------------------------------------------
// Scans the schedule for real-world PM issues: wrong sequencing, missing
// inspections, no buffer, over-leveraged critical path, stacked weather-
// sensitive tasks, etc. Returns a list of findings the user can accept.

export interface AIRiskFinding {
  id: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  detail: string;
  affectedTaskIds: string[];  // resolved from aliases
  suggestion?: string;
}

export interface AIRiskResult {
  findings: AIRiskFinding[];
  summary: string;
  cached?: boolean;
}

export async function aiDetectRisks(tasks: ScheduleTask[], cpm: CpmResult): Promise<AIRiskResult> {
  const { byAlias } = buildAliasMap(tasks);
  const serialized = serializeSchedule(tasks, cpm);
  const schemaHint = {
    summary: 'one-line overall health read',
    findings: [
      {
        severity: 'low|medium|high',
        title: 'short headline',
        detail: 'why this matters in 1-2 sentences',
        affectedAliases: ['T1', 'T5'],
        suggestion: 'concrete fix',
      },
    ],
  };
  const prompt = `You are a construction project manager reviewing a schedule for risks.
Identify real issues in PLAIN CONSTRUCTION TERMS. Focus on: wrong task order,
missing inspections before cover-up, no weather buffer on exterior tasks, too
many critical tasks (fragile plan), subs double-booked, rough-ins not in
correct sequence. Do not list generic advice — cite specific task aliases.

Schedule:
${serialized}

Return up to 6 findings, most important first.`;

  const res = await mageAI({
    prompt,
    schemaHint,
    tier: 'smart',
    maxTokens: 1200,
    cacheKey: `risks-${tasks.length}-${cpm.projectFinish}-${cpm.criticalPath.length}`,
    cacheHours: 1,
  });

  if (!res.success || !res.data) {
    return { findings: [], summary: 'AI risk check failed. Try again.', cached: res.cached };
  }

  const raw = res.data as { summary?: string; findings?: Array<{
    severity?: string;
    title?: string;
    detail?: string;
    affectedAliases?: string[];
    suggestion?: string;
  }> };

  const findings: AIRiskFinding[] = (raw.findings ?? []).map((f, i) => ({
    id: createId('risk'),
    severity: (f.severity === 'high' || f.severity === 'medium' || f.severity === 'low')
      ? f.severity
      : 'medium',
    title: f.title || `Finding ${i + 1}`,
    detail: f.detail || '',
    affectedTaskIds: (f.affectedAliases ?? [])
      .map(a => byAlias.get(a))
      .filter((x): x is string => !!x),
    suggestion: f.suggestion,
  }));

  return {
    summary: raw.summary || (findings.length > 0 ? `${findings.length} issues found` : 'Schedule looks clean.'),
    findings,
    cached: res.cached,
  };
}

// ---------------------------------------------------------------------------
// 2) Optimizer — identify compression opportunities
// ---------------------------------------------------------------------------

export interface AIOptimizationIdea {
  id: string;
  title: string;
  detail: string;
  expectedDaysSaved: number;
  affectedTaskIds: string[];
  action: 'parallelize' | 'overlap' | 'resource' | 'split' | 'other';
}

export async function aiOptimizeSchedule(tasks: ScheduleTask[], cpm: CpmResult): Promise<{
  ideas: AIOptimizationIdea[];
  summary: string;
  cached?: boolean;
}> {
  const { byAlias } = buildAliasMap(tasks);
  const serialized = serializeSchedule(tasks, cpm);

  const schemaHint = {
    summary: 'one-line takeaway',
    ideas: [
      {
        title: 'short actionable headline',
        detail: 'explain the how in 1-2 sentences',
        expectedDaysSaved: 3,
        action: 'parallelize|overlap|resource|split|other',
        affectedAliases: ['T3', 'T4'],
      },
    ],
  };

  const prompt = `You are a construction scheduler. Suggest ways to finish the
project earlier WITHOUT extra cost. Focus on: tasks that can run in parallel
but are sequenced, FS links that could be SS+lag, critical-path tasks that
could be split across two crews, padding that could be removed.

Schedule:
${serialized}

Return up to 5 ideas, highest impact first. Be specific — cite aliases.`;

  const res = await mageAI({
    prompt,
    schemaHint,
    tier: 'smart',
    maxTokens: 1200,
    cacheKey: `opt-${tasks.length}-${cpm.projectFinish}-${cpm.criticalPath.length}`,
    cacheHours: 1,
  });

  if (!res.success || !res.data) {
    return { ideas: [], summary: 'AI optimizer failed.', cached: res.cached };
  }

  const raw = res.data as { summary?: string; ideas?: Array<{
    title?: string;
    detail?: string;
    expectedDaysSaved?: number;
    action?: string;
    affectedAliases?: string[];
  }> };

  const ideas: AIOptimizationIdea[] = (raw.ideas ?? []).map(i => ({
    id: createId('opt'),
    title: i.title || 'Idea',
    detail: i.detail || '',
    expectedDaysSaved: Number(i.expectedDaysSaved) || 0,
    action: (['parallelize', 'overlap', 'resource', 'split'].includes(String(i.action))
      ? i.action
      : 'other') as AIOptimizationIdea['action'],
    affectedTaskIds: (i.affectedAliases ?? [])
      .map(a => byAlias.get(a))
      .filter((x): x is string => !!x),
  }));

  return {
    summary: raw.summary || `${ideas.length} ideas`,
    ideas,
    cached: res.cached,
  };
}

// ---------------------------------------------------------------------------
// 3) Critical path explainer
// ---------------------------------------------------------------------------

export async function aiExplainCriticalPath(tasks: ScheduleTask[], cpm: CpmResult): Promise<{
  explanation: string;
  cached?: boolean;
}> {
  const { byAlias, byId } = buildAliasMap(tasks);
  const critical = cpm.criticalPath.map(id => {
    const t = tasks.find(x => x.id === id);
    const alias = byId.get(id);
    return t && alias ? `${alias} (${t.title}, ${t.durationDays}d)` : alias;
  }).filter(Boolean).join(' → ');

  const prompt = `Explain why this is the critical path, in plain English, for
a construction site foreman who is not a scheduling expert. Be concrete about
what a delay on each step would cost. Keep it under 150 words.

Critical path: ${critical}
Project finish: day ${cpm.projectFinish}`;

  const res = await mageAI({
    prompt,
    tier: 'fast',
    maxTokens: 400,
    cacheKey: `explain-cp-${cpm.criticalPath.join('-')}-${cpm.projectFinish}`,
    cacheHours: 6,
  });

  if (!res.success) {
    return { explanation: 'AI explainer unavailable right now.', cached: res.cached };
  }
  // This path doesn't use JSON mode — we want narrative prose.
  const text = typeof res.data === 'string' ? res.data : (res.raw ?? '');
  return { explanation: text.trim(), cached: res.cached };
}

// ---------------------------------------------------------------------------
// 4) Delay impact analyzer
// ---------------------------------------------------------------------------

export async function aiDelayImpact(
  tasks: ScheduleTask[],
  cpm: CpmResult,
  taskId: string,
  daysDelay: number,
): Promise<{ explanation: string; projectFinishDelta: number; cached?: boolean }> {
  const t = tasks.find(x => x.id === taskId);
  const row = cpm.perTask.get(taskId);
  if (!t || !row) return { explanation: 'Task not found', projectFinishDelta: 0 };

  // If delay ≤ totalFloat, no impact on project finish. Otherwise finish slips
  // by (delay - float).
  const hardDelay = Math.max(0, daysDelay - Math.max(0, row.totalFloat));

  const serialized = serializeSchedule(tasks, cpm);
  const prompt = `A delay of ${daysDelay} day(s) on "${t.title}" is being considered.
This task has ${row.totalFloat} day(s) of float, so the project finish would slip
by ${hardDelay} day(s). Given the full schedule below, explain in PLAIN ENGLISH
what other tasks get pushed, what the business impact is, and any mitigation
the PM should consider. Under 120 words.

Schedule:
${serialized}`;

  const res = await mageAI({
    prompt,
    tier: 'smart',
    maxTokens: 400,
    cacheKey: `delay-${taskId}-${daysDelay}-${cpm.projectFinish}`,
    cacheHours: 2,
  });

  const text = typeof res.data === 'string' ? res.data : (res.raw ?? 'Analysis unavailable.');
  return { explanation: text.trim(), projectFinishDelta: hardDelay, cached: res.cached };
}

// ---------------------------------------------------------------------------
// 5) Conversational Q&A — "when does drywall start?" / "who's on day 40?"
// ---------------------------------------------------------------------------

export async function aiAskSchedule(
  tasks: ScheduleTask[],
  cpm: CpmResult,
  question: string,
  projectStartDate: Date,
): Promise<{ answer: string; cached?: boolean }> {
  const serialized = serializeSchedule(tasks, cpm);
  const startStr = projectStartDate.toISOString().slice(0, 10);
  const prompt = `Answer the user's question using ONLY the schedule data below.
Be concrete — cite task names, day numbers, and actual calendar dates (project
starts ${startStr}, day N = ${startStr} + (N-1) days). If the answer isn't
derivable from the data, say so clearly. Keep answers under 120 words.

Schedule:
${serialized}

Question: ${question}`;

  const res = await mageAI({
    prompt,
    tier: 'smart',
    maxTokens: 500,
    // No cache — conversational answers shouldn't be reused
  });

  const text = typeof res.data === 'string' ? res.data : (res.raw ?? 'No answer.');
  return { answer: text.trim() };
}

// ---------------------------------------------------------------------------
// 6) Voice/text as-built logging — "we finished the foundation today"
// ---------------------------------------------------------------------------

export interface AIAsBuiltPatch {
  taskId: string;
  taskTitle: string;
  patch: Partial<ScheduleTask>;
  rationale: string;
}

export async function aiLogAsBuilt(
  tasks: ScheduleTask[],
  transcript: string,
  todayDayNumber: number,
): Promise<{ patches: AIAsBuiltPatch[]; summary: string; cached?: boolean }> {
  const { byAlias, byId } = buildAliasMap(tasks);
  const simplified = tasks.map((t, i) => `T${i + 1}: ${t.title} (${t.status}, ${t.progress}% done)`).join('\n');

  const schemaHint = {
    summary: 'what the user logged, in one line',
    updates: [
      {
        alias: 'T3',
        progressPercent: 100,
        markDone: true,
        actualStartToday: false,
        actualEndToday: true,
        rationale: 'user said foundation is finished',
      },
    ],
  };

  const prompt = `The PM said: "${transcript}"
Today is day ${todayDayNumber} of the project.
Parse this into concrete per-task updates. Do NOT invent tasks — only pick from
the list below. If unclear, leave "updates" empty.

Tasks:
${simplified}`;

  const res = await mageAI({
    prompt,
    schemaHint,
    tier: 'fast',
    maxTokens: 600,
  });

  if (!res.success || !res.data) {
    return { patches: [], summary: 'Could not parse that.' };
  }

  const raw = res.data as { summary?: string; updates?: Array<{
    alias?: string;
    progressPercent?: number;
    markDone?: boolean;
    actualStartToday?: boolean;
    actualEndToday?: boolean;
    rationale?: string;
  }> };

  const patches: AIAsBuiltPatch[] = [];
  for (const u of raw.updates ?? []) {
    const id = u.alias ? byAlias.get(u.alias) : undefined;
    if (!id) continue;
    const t = tasks.find(x => x.id === id);
    if (!t) continue;
    const patch: Partial<ScheduleTask> = {};
    if (typeof u.progressPercent === 'number') patch.progress = Math.max(0, Math.min(100, u.progressPercent));
    if (u.markDone) { patch.status = 'done'; patch.progress = 100; }
    if (u.actualStartToday) patch.actualStartDay = todayDayNumber;
    if (u.actualEndToday) {
      patch.actualEndDay = todayDayNumber;
      patch.status = 'done';
      patch.progress = 100;
      if (!t.actualStartDay) patch.actualStartDay = t.startDay;
    }
    patches.push({ taskId: id, taskTitle: t.title, patch, rationale: u.rationale || '' });
  }
  return { patches, summary: raw.summary || `${patches.length} update(s) parsed`, cached: res.cached };
}

// ---------------------------------------------------------------------------
// 7) Schedule generator — free-text → full schedule (for empty projects)
// ---------------------------------------------------------------------------

export interface AIGeneratedTask {
  alias: string;
  title: string;
  phase: string;
  durationDays: number;
  deps: string[];
  crew?: string;
  isMilestone?: boolean;
}

export async function aiGenerateSchedule(description: string): Promise<{
  tasks: AIGeneratedTask[];
  summary: string;
  cached?: boolean;
}> {
  const schemaHint = {
    summary: 'one-line summary of the generated schedule',
    tasks: [
      {
        alias: 'T1',
        title: 'clear site',
        phase: 'Site',
        durationDays: 2,
        crew: 'Excavation',
        deps: [],
        isMilestone: false,
      },
    ],
  };

  const prompt = `Generate a realistic construction schedule from this description.
Break the project into 20-40 specific tasks with appropriate durations,
standard construction phases (Site, Foundation, Framing, MEP, Drywall,
Finishes, Inspections, Landscaping, Closeout), real crews, and correct
dependency ordering. Include inspection milestones at cover-up points.
Use T1, T2, T3… aliases. FS-only dependencies for simplicity.

Project description:
${description}`;

  const res = await mageAI({
    prompt,
    schemaHint,
    tier: 'smart',
    maxTokens: 3000,
    cacheKey: `gen-${description.slice(0, 80)}`,
    cacheHours: 24,
  });

  if (!res.success || !res.data) {
    return { tasks: [], summary: 'Generator failed.' };
  }
  const raw = res.data as { summary?: string; tasks?: AIGeneratedTask[] };
  const tasks = (raw.tasks ?? []).map(t => ({
    alias: t.alias || '',
    title: t.title || 'Task',
    phase: t.phase || 'General',
    durationDays: Math.max(0, Number(t.durationDays) || 1),
    deps: Array.isArray(t.deps) ? t.deps : [],
    crew: t.crew,
    isMilestone: t.isMilestone || t.durationDays === 0,
  }));
  return { tasks, summary: raw.summary || `Generated ${tasks.length} tasks`, cached: res.cached };
}

// Convert generator output → real ScheduleTask[] with computed startDays.
export function materializeGeneratedTasks(generated: AIGeneratedTask[]): ScheduleTask[] {
  const idByAlias = new Map<string, string>();
  for (const g of generated) idByAlias.set(g.alias, createId('task'));
  const endDayByAlias = new Map<string, number>();
  const startByAlias = new Map<string, number>();

  for (const g of generated) {
    let earliest = 1;
    for (const depAlias of g.deps) {
      const end = endDayByAlias.get(depAlias);
      if (end != null) earliest = Math.max(earliest, end + 1);
    }
    startByAlias.set(g.alias, earliest);
    endDayByAlias.set(g.alias, g.durationDays === 0 ? earliest : earliest + g.durationDays - 1);
  }

  return generated.map(g => {
    const id = idByAlias.get(g.alias)!;
    const startDay = startByAlias.get(g.alias)!;
    const endDay = endDayByAlias.get(g.alias)!;
    const dependencies = g.deps.map(a => idByAlias.get(a)).filter((x): x is string => !!x);
    const task: ScheduleTask = {
      id,
      title: g.title,
      phase: g.phase,
      durationDays: g.durationDays,
      startDay,
      progress: 0,
      crew: g.crew ?? '',
      dependencies,
      notes: '',
      status: 'not_started',
      isMilestone: g.isMilestone || g.durationDays === 0,
      baselineStartDay: startDay,
      baselineEndDay: endDay,
    };
    return task;
  });
}

// ---------------------------------------------------------------------------
// 8) Bulk edit — natural language instruction against a selected subset
// ---------------------------------------------------------------------------
// The user highlights a handful of rows in the grid, types a command like
// "compress each of these by 20%" or "move all of these out by a week, and
// change their crew to Finish Carp". The model returns typed Partial<Task>
// patches for just those tasks. We never let it touch non-selected tasks.

export interface AIBulkPatch {
  taskId: string;
  taskTitle: string;
  patch: Partial<ScheduleTask>;
  rationale: string;
}

export async function aiBulkEdit(
  tasks: ScheduleTask[],
  cpm: CpmResult,
  selectedIds: string[],
  instruction: string,
): Promise<{
  patches: AIBulkPatch[];
  summary: string;
  /** True when the response came from AsyncStorage cache, not the network. */
  fromCache?: boolean;
  /** Populated only on failure or partial-match — 'timeout' | 'network' | etc. */
  errorKind?: 'timeout' | 'network' | 'http' | 'model' | 'validation' | 'unknown';
  /** Human-readable detail when errorKind is set (e.g. timeout message). */
  errorDetail?: string;
}> {
  const selSet = new Set(selectedIds);
  const selected = tasks.filter(t => selSet.has(t.id));
  if (selected.length === 0) {
    return { patches: [], summary: 'No tasks selected.' };
  }

  const { byAlias, byId } = buildAliasMap(tasks);
  // Build a focused view of just the selected tasks so the model spends its
  // attention on them. Keep the full alias map so it doesn't hallucinate new
  // ids, and include the full schedule summary so it can reason about
  // downstream effects without proposing changes there.
  const fullContext = serializeSchedule(tasks, cpm);
  const selectedLines = selected.map(t => {
    const alias = byId.get(t.id) ?? t.id;
    return `${alias}: ${t.title} | start=${t.startDay} | dur=${t.durationDays}d | crew=${t.crew || '-'} | phase=${t.phase}`;
  }).join('\n');

  const schemaHint = {
    summary: 'one-line description of what you are doing',
    updates: [
      {
        alias: 'T3',
        durationDays: 4,
        startDay: 12,
        crew: 'Finish Carp',
        phase: 'Finishes',
        progressPercent: 50,
        rationale: 'user asked to compress by 20% and reassign crew',
      },
    ],
  };

  const prompt = `You are editing a construction schedule on behalf of the PM.
ONLY modify these selected tasks (cite them by alias — do not invent new ones):
${selectedLines}

PM instruction: "${instruction}"

Full schedule context (for reasoning, do NOT modify non-selected rows):
${fullContext}

Rules:
- Leave a field unset in your reply if you are not changing it (so the UI
  only shows actual deltas).
- Keep durations >= 0.
- Keep startDay >= 1.
- Never add or remove tasks — only edit the listed ones.
- If the instruction is ambiguous or unsafe, return updates: [] and explain
  in summary.`;

  const res = await mageAI({
    prompt,
    schemaHint,
    tier: 'smart',
    maxTokens: 900,
  });

  if (!res.success || !res.data) {
    return {
      patches: [],
      summary: res.error || 'AI could not complete that edit.',
      fromCache: res.fromCache,
      errorKind: res.errorKind,
      errorDetail: res.error,
    };
  }

  const raw = res.data as {
    summary?: string;
    updates?: Array<{
      alias?: string;
      durationDays?: number;
      startDay?: number;
      crew?: string;
      phase?: string;
      progressPercent?: number;
      rationale?: string;
    }>;
  };

  const patches: AIBulkPatch[] = [];
  for (const u of raw.updates ?? []) {
    const id = u.alias ? byAlias.get(u.alias) : undefined;
    if (!id) continue;
    if (!selSet.has(id)) continue; // model tried to edit outside selection — drop
    const t = tasks.find(x => x.id === id);
    if (!t) continue;
    const patch: Partial<ScheduleTask> = {};
    if (typeof u.durationDays === 'number' && u.durationDays >= 0 && u.durationDays !== t.durationDays) {
      patch.durationDays = Math.round(u.durationDays);
    }
    if (typeof u.startDay === 'number' && u.startDay >= 1 && u.startDay !== t.startDay) {
      patch.startDay = Math.round(u.startDay);
    }
    if (typeof u.crew === 'string' && u.crew !== t.crew) patch.crew = u.crew;
    if (typeof u.phase === 'string' && u.phase !== t.phase) patch.phase = u.phase;
    if (typeof u.progressPercent === 'number' && u.progressPercent !== t.progress) {
      patch.progress = Math.max(0, Math.min(100, Math.round(u.progressPercent)));
    }
    if (Object.keys(patch).length === 0) continue;
    patches.push({
      taskId: id,
      taskTitle: t.title,
      patch,
      rationale: u.rationale ?? '',
    });
  }

  return {
    patches,
    summary: raw.summary ?? (patches.length === 0 ? 'No changes proposed.' : `${patches.length} task(s) to update.`),
    fromCache: res.fromCache,
    // Preserve 'validation' kind so UI can show "partial result" banner even on a success
    errorKind: res.errorKind,
    errorDetail: res.error,
  };
}
