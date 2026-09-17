// selectionsEngine — Supabase helpers + AI curation for the
// Selections / Allowances feature.
//
// AI curation: given a category ("Kitchen Cabinets"), a style brief
// ("modern farmhouse"), and a budget, asks Gemini to return 4 options
// with realistic 2025-2026 brand + SKU + price data. The model is
// instructed to spread the price range so the homeowner has a budget
// option, two on-target, and one premium upgrade.

import { z } from 'zod';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { mageAI } from '@/utils/mageAI';
import { generateUUID } from '@/utils/generateId';
import { supabaseWriteDetailed, type WriteOutcome } from '@/utils/offlineQueue';
import { resolveScheduleAnchor, taskCalendarRange } from '@/utils/scheduleOps';
import {
  parseCalendarDay, toCalendarDayString, addCalendarDays, formatCalendarDay,
} from '@/utils/calendarDate';
import type {
  SelectionCategory, SelectionOption, SelectionOptionSource, ProjectSchedule,
} from '@/types';

// ─── Row mapping ────────────────────────────────────────────────────

interface SelectionCategoryRow {
  id: string;
  project_id: string;
  user_id: string;
  category: string;
  style_brief: string;
  budget: number;
  due_date: string | null;
  status: SelectionCategory['status'];
  notes: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface SelectionOptionRow {
  id: string;
  category_id: string;
  source: SelectionOptionSource;
  product_name: string;
  brand: string;
  sku: string;
  description: string;
  image_url: string | null;
  product_url: string | null;
  unit_price: number;
  unit: string;
  quantity: number;
  total: number;
  lead_time_days: number | null;
  supplier: string | null;
  highlights: string[];
  is_chosen: boolean;
  chosen_at: string | null;
  chosen_by_role: 'homeowner' | 'gc' | null;
  created_at: string;
}

function rowToCategory(r: SelectionCategoryRow, opts?: SelectionOption[]): SelectionCategory {
  return {
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    category: r.category,
    styleBrief: r.style_brief,
    budget: Number(r.budget) || 0,
    dueDate: r.due_date ?? undefined,
    status: r.status,
    notes: r.notes,
    displayOrder: r.display_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    options: opts,
  };
}

function rowToOption(r: SelectionOptionRow): SelectionOption {
  return {
    id: r.id,
    categoryId: r.category_id,
    source: r.source,
    productName: r.product_name,
    brand: r.brand,
    sku: r.sku,
    description: r.description,
    imageUrl:   r.image_url   ?? undefined,
    productUrl: r.product_url ?? undefined,
    unitPrice: Number(r.unit_price) || 0,
    unit: r.unit,
    quantity: Number(r.quantity) || 1,
    total: Number(r.total) || 0,
    leadTimeDays: r.lead_time_days ?? undefined,
    supplier:     r.supplier      ?? undefined,
    highlights: Array.isArray(r.highlights) ? r.highlights : [],
    isChosen: !!r.is_chosen,
    chosenAt:     r.chosen_at      ?? undefined,
    chosenByRole: r.chosen_by_role ?? undefined,
    createdAt: r.created_at,
  };
}

// ─── Fetch ─────────────────────────────────────────────────────────

export async function fetchSelectionsForProject(projectId: string): Promise<SelectionCategory[]> {
  if (!isSupabaseConfigured) return [];

  const { data: cats, error: catsErr } = await supabase
    .from('selection_categories')
    .select('*')
    .eq('project_id', projectId)
    .order('display_order', { ascending: true });
  if (catsErr || !cats) {
    console.warn('[selectionsEngine] cats fetch error:', catsErr?.message);
    return [];
  }

  const ids = cats.map(c => c.id);
  if (ids.length === 0) return cats.map(c => rowToCategory(c as SelectionCategoryRow, []));

  const { data: opts, error: optsErr } = await supabase
    .from('selection_options')
    .select('*')
    .in('category_id', ids)
    .order('unit_price', { ascending: true });
  if (optsErr) {
    console.warn('[selectionsEngine] opts fetch error:', optsErr.message);
  }

  const byCategory = new Map<string, SelectionOption[]>();
  for (const o of (opts ?? [])) {
    const opt = rowToOption(o as SelectionOptionRow);
    const arr = byCategory.get(opt.categoryId) ?? [];
    arr.push(opt);
    byCategory.set(opt.categoryId, arr);
  }
  return cats.map(c => rowToCategory(c as SelectionCategoryRow, byCategory.get(c.id) ?? []));
}

// ─── Save ──────────────────────────────────────────────────────────

export async function saveSelectionCategory(c: Partial<SelectionCategory> & { id?: string; projectId: string; category: string; budget: number; styleBrief?: string }): Promise<SelectionCategory | null> {
  if (!isSupabaseConfigured) return null;
  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user?.id;
  if (!userId) return null;

  const row = {
    id: c.id,
    project_id: c.projectId,
    user_id: userId,
    category: c.category,
    style_brief: c.styleBrief ?? '',
    budget: c.budget,
    due_date: c.dueDate ?? null,
    status: c.status ?? 'pending',
    notes: c.notes ?? '',
    display_order: c.displayOrder ?? 0,
  };
  const { data, error } = await supabase
    .from('selection_categories')
    .upsert(row, { onConflict: 'id' })
    .select('*')
    .maybeSingle();
  if (error || !data) {
    console.warn('[selectionsEngine] cat save error:', error?.message);
    return null;
  }
  return rowToCategory(data as SelectionCategoryRow, []);
}

// Due date on an EXISTING category. Deliberately a one-column update and not a
// round-trip through saveSelectionCategory: that upsert rewrites the whole row
// from whatever the screen last fetched, so a GC fixing a date on a stale card
// would reset `status` to what it was before the homeowner picked in the
// portal (and chooseSelectionOption's 'chosen'/'exceeded' with it). Routed
// through the offline queue so a date typed on a jobsite with no signal is
// queued, not lost. `null` clears the date.
export async function saveSelectionCategoryDueDate(
  categoryId: string,
  dueDate: string | null,
): Promise<WriteOutcome> {
  // Only a real calendar day reaches the column — a mistyped '2026-02-30'
  // would otherwise land as a Postgres cast error the GC never sees explained.
  // The date PREFIX is the day: DatePickerModal hands back noon UTC with the
  // picked components, and re-projecting that instant into local time would
  // name tomorrow east of UTC+12.
  const day = dueDate != null && parseCalendarDay(dueDate) ? dueDate.slice(0, 10) : null;
  if (dueDate != null && !day) return 'failed';
  return supabaseWriteDetailed('selection_categories', 'update', { id: categoryId, due_date: day });
}

export async function deleteSelectionCategory(id: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { error } = await supabase.from('selection_categories').delete().eq('id', id);
  return !error;
}

export async function saveSelectionOption(o: Partial<SelectionOption> & { id?: string; categoryId: string; productName: string; unitPrice: number }): Promise<SelectionOption | null> {
  if (!isSupabaseConfigured) return null;
  const total = (o.unitPrice ?? 0) * (o.quantity ?? 1);
  const row = {
    id: o.id,
    category_id: o.categoryId,
    source: o.source ?? 'gc_added',
    product_name: o.productName,
    brand: o.brand ?? '',
    sku: o.sku ?? '',
    description: o.description ?? '',
    image_url:   o.imageUrl   ?? null,
    product_url: o.productUrl ?? null,
    unit_price: o.unitPrice,
    unit: o.unit ?? 'ea',
    quantity: o.quantity ?? 1,
    total,
    lead_time_days: o.leadTimeDays ?? null,
    supplier:       o.supplier      ?? null,
    highlights: o.highlights ?? [],
    is_chosen: o.isChosen ?? false,
    chosen_at:     o.chosenAt     ?? null,
    chosen_by_role: o.chosenByRole ?? null,
  };
  const { data, error } = await supabase
    .from('selection_options')
    .upsert(row, { onConflict: 'id' })
    .select('*')
    .maybeSingle();
  if (error || !data) {
    console.warn('[selectionsEngine] opt save error:', error?.message);
    return null;
  }
  return rowToOption(data as SelectionOptionRow);
}

// Mark one option as chosen + un-mark every other option in the same
// category. Done in two updates because Supabase doesn't have a single
// "exactly-one" constraint pattern.
export async function chooseSelectionOption(categoryId: string, optionId: string, role: 'homeowner' | 'gc'): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const now = new Date().toISOString();
  // 1) Un-mark every other option in this category.
  const { error: clearErr } = await supabase
    .from('selection_options')
    .update({ is_chosen: false, chosen_at: null, chosen_by_role: null })
    .eq('category_id', categoryId)
    .neq('id', optionId);
  if (clearErr) {
    console.warn('[selectionsEngine] clear-other error:', clearErr.message);
    return false;
  }
  // 2) Mark the chosen one.
  const { error: setErr } = await supabase
    .from('selection_options')
    .update({ is_chosen: true, chosen_at: now, chosen_by_role: role })
    .eq('id', optionId);
  if (setErr) {
    console.warn('[selectionsEngine] set-chosen error:', setErr.message);
    return false;
  }
  // 3) Recompute the category's status — if chosen.total > budget mark
  //    'exceeded', else 'chosen'. Pull the chosen option to compare.
  const { data: opt } = await supabase
    .from('selection_options')
    .select('total, category_id')
    .eq('id', optionId)
    .maybeSingle();
  if (opt) {
    const { data: cat } = await supabase
      .from('selection_categories')
      .select('budget')
      .eq('id', categoryId)
      .maybeSingle();
    const budget = Number(cat?.budget ?? 0);
    const total = Number(opt.total ?? 0);
    const newStatus: SelectionCategory['status'] = total > budget && budget > 0 ? 'exceeded' : 'chosen';
    await supabase.from('selection_categories').update({ status: newStatus }).eq('id', categoryId);
  }
  return true;
}

// ─── AI Curation ──────────────────────────────────────────────────

const aiOptionSchema = z.object({
  productName: z.string().default(''),
  brand:       z.string().default(''),
  description: z.string().default(''),
  unitPrice:   z.number().default(0),
  unit:        z.string().default('ea'),
  quantity:    z.number().default(1),
  leadTimeDays: z.number().nullable().optional(),
  supplier:    z.string().nullable().optional(),
  highlights:  z.array(z.string()).default([]),
  productUrl:  z.string().default(''),
});

const aiCurationSchema = z.object({
  options: z.array(aiOptionSchema).default([]),
  notes:   z.string().default(''),
});

export interface CurateInput {
  category: string;       // "Kitchen Cabinets"
  styleBrief: string;     // "modern farmhouse, off-white, soft-close"
  budget: number;         // total allowance
  quantity?: number;      // unit count if relevant ("60 sqft of tile"); default 1
  unit?: string;          // 'ea' | 'sqft' | 'lf' | 'box'
}

export interface CuratedOption {
  productName: string;
  brand: string;
  description: string;
  unitPrice: number;
  unit: string;
  quantity: number;
  total: number;
  leadTimeDays?: number;
  supplier?: string;
  highlights: string[];
  productUrl: string;
  imageUrl?: string | null;
}

export async function curateSelectionsAI(input: CurateInput): Promise<{ options: CuratedOption[]; notes: string }> {
  const qty = input.quantity ?? 1;
  const unit = input.unit ?? 'ea';

  const aiRes = await mageAI({
    prompt: `You are a residential construction selections specialist. A homeowner needs to pick a ${input.category}. Their style brief: "${input.styleBrief || 'no specific style'}". Total allowance: $${input.budget.toLocaleString()}. Quantity: ${qty} ${unit}.

Generate 4 distinct options spread across the budget range — one BUDGET option (50-70% of allowance), two ON-TARGET options (80-105% of allowance), and one PREMIUM upgrade (110-140% of allowance, if it's clearly worth it).

For each option give:
  • productName  — specific product line name (e.g. "Wolf Classic Crestwood Shaker")
  • brand        — real manufacturer (KraftMaid, Wolf, IKEA, Daltile, Schlage, Kohler, etc.)
  • description  — 1-2 sentences explaining the look and key materials
  • unitPrice    — realistic 2025-2026 retail price per ${unit}
  • unit         — '${unit}'
  • quantity     — ${qty}
  • leadTimeDays — typical lead time in days (null if available off the shelf)
  • supplier     — where to buy: Home Depot, Lowe's, Build.com, Wayfair, supplier showroom, etc.
  • productUrl   — a real product or search-results page URL at the named supplier for THIS exact item (e.g. a Home Depot, Lowe's, Build.com, or Wayfair product/search URL). Best effort; prefer a direct product page.
  • highlights   — 2-4 short bullet attributes the homeowner cares about (warranty, finish, soft-close, durability, etc.)

Pick brands the homeowner has heard of. Don't invent fake products. Spread the price range — the budget option should feel like a real budget option, the premium should feel premium.`,
    schema: aiCurationSchema,
    tier: 'smart',
    maxTokens: 2200,
  });

  if (!aiRes.success) {
    console.warn('[selectionsEngine] AI curation failed:', aiRes.error);
    return { options: [], notes: '' };
  }

  const options: CuratedOption[] = aiRes.data.options.map((o: z.infer<typeof aiOptionSchema>) => ({
    productName: o.productName || 'Untitled option',
    brand: o.brand || '',
    description: o.description || '',
    unitPrice: o.unitPrice || 0,
    unit: o.unit || unit,
    quantity: o.quantity || qty,
    total: (o.unitPrice || 0) * (o.quantity || qty),
    leadTimeDays: o.leadTimeDays ?? undefined,
    supplier: o.supplier ?? undefined,
    highlights: o.highlights ?? [],
    productUrl: o.productUrl || '',
  })).filter((o: CuratedOption) => o.productName !== 'Untitled option');

  return { options, notes: aiRes.data.notes ?? '' };
}

// Save a batch of AI-curated options against a category in one round-trip.
export async function saveCuratedOptions(categoryId: string, options: CuratedOption[]): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  if (options.length === 0) return true;

  const rows = options.map(o => ({
    id: generateUUID(),
    category_id: categoryId,
    source: 'ai_generated' as const,
    product_name: o.productName,
    brand: o.brand,
    description: o.description,
    unit_price: o.unitPrice,
    unit: o.unit,
    quantity: o.quantity,
    total: o.total,
    lead_time_days: o.leadTimeDays ?? null,
    supplier:       o.supplier      ?? null,
    image_url:   o.imageUrl   ?? null,
    product_url: o.productUrl ?? null,
    highlights: o.highlights,
    is_chosen: false,
  }));

  const { error } = await supabase.from('selection_options').insert(rows);
  if (error) {
    console.warn('[selectionsEngine] save curated error:', error.message);
    return false;
  }

  // Move the category status to 'browsing' since options now exist.
  await supabase.from('selection_categories').update({ status: 'browsing' }).eq('id', categoryId);
  return true;
}

// Roll up running allowance totals across every chosen option in a project.
export interface AllowanceSummary {
  totalBudget: number;
  totalChosen: number;
  totalOver: number;            // sum of (chosen.total - budget) across exceeded categories
  byCategory: {
    category: string;
    budget: number;
    chosenTotal: number;
    delta: number;              // chosenTotal - budget (negative = under, positive = over)
    status: SelectionCategory['status'];
  }[];
}

export function summarizeAllowances(categories: SelectionCategory[]): AllowanceSummary {
  let totalBudget = 0;
  let totalChosen = 0;
  let totalOver = 0;
  const byCategory: AllowanceSummary['byCategory'] = [];

  for (const c of categories) {
    const chosen = (c.options ?? []).find(o => o.isChosen);
    const chosenTotal = chosen?.total ?? 0;
    const delta = chosenTotal - c.budget;
    if (chosen && delta > 0) totalOver += delta;
    totalBudget += c.budget;
    totalChosen += chosenTotal;
    byCategory.push({
      category: c.category,
      budget: c.budget,
      chosenTotal,
      delta,
      status: c.status,
    });
  }
  return { totalBudget, totalChosen, totalOver, byCategory };
}

// ─── Connector: contract allowances → selection categories ─────────
//
// When a GC sends a contract with allowances, those allowances are the
// spending caps the homeowner gets to pick within. We auto-create a
// matching SelectionCategory for each, so the GC doesn't have to
// re-type the same data into a separate screen. Idempotent: if a
// category with the same (case-insensitive) name already exists for
// the project, we skip it. Returns the count of categories actually
// created.

interface ContractAllowanceLite {
  id: string;
  category: string;
  amount: number;
  description?: string;
}

export async function syncAllowancesToSelections(
  projectId: string,
  allowances: ContractAllowanceLite[],
): Promise<number> {
  if (!isSupabaseConfigured) return 0;
  if (!allowances || allowances.length === 0) return 0;
  // Pull existing categories so we can dedupe by name.
  const existing = await fetchSelectionsForProject(projectId);
  const existingNames = new Set(
    existing.map(c => c.category.trim().toLowerCase()).filter(Boolean),
  );
  let created = 0;
  for (const a of allowances) {
    const name = (a.category ?? '').trim();
    if (!name) continue;
    if (existingNames.has(name.toLowerCase())) continue;
    if (!a.amount || a.amount <= 0) continue;
    const saved = await saveSelectionCategory({
      projectId,
      category: name,
      budget: a.amount,
      styleBrief: a.description ?? '',
    });
    if (saved) {
      created += 1;
      existingNames.add(name.toLowerCase());
    }
  }
  return created;
}


// ─── Due-date suggestion: install task − lead time − buffer ──────────
//
// Why this exists: `selection_categories.due_date` drives the owner's
// "Waiting on you" ranking and the portal's overdue badge, but a GC has no
// idea off-hand what date to type. The app already knows the two numbers that
// set it: when the install happens (the schedule) and how long the product
// takes to arrive (the options' leadTimeDays).
//
// What it refuses to do, on purpose (screen audit 2026-09-16, both
// sharpenings): there is no join key from a free-text category ("Kitchen
// Cabinets") to a ScheduleTask, so the GC PICKS the install task — nothing
// here matches names. And every input must be real: a schedule without a
// startDate (consumers elsewhere fall back to today — the finish-day-jump
// trap), no picked task, or no option carrying a lead time ⇒ no suggestion at
// all. A homeowner reads "pick by" as a fact; a date anchored on today or on
// a guessed lead would be a guess dressed as one. Pure and synchronous so
// scripts/validate-selections-due.ts can pin every refusal.

/** Default float between "product ordered" and "product needed on site". */
export const SELECTION_DUE_BUFFER_DAYS = 5;

export type SelectionDueRefusal =
  | 'no-schedule-start'
  | 'no-task-picked'
  | 'task-not-found'
  | 'no-lead-time';

export type SelectionDueSuggestion =
  | {
      ok: true;
      /** 'YYYY-MM-DD' — the value to store in due_date if the GC accepts. */
      dueDate: string;
      /** 'YYYY-MM-DD' — the picked task's calendar start. */
      installDate: string;
      taskTitle: string;
      leadDays: number;
      /** The option whose lead time set the date (the longest one). */
      leadOptionName: string;
      bufferDays: number;
      /** The arithmetic, verbatim, for the grounding chip. */
      chip: string;
    }
  | { ok: false; reason: SelectionDueRefusal; message: string };

type ScheduleForDue = Pick<ProjectSchedule, 'startDate' | 'workingDaysPerWeek' | 'nonWorkingDates' | 'tasks'>;

// The anchor and the task start come from THE schedule rule in scheduleOps
// (resolveScheduleAnchor + taskCalendarRange) — the same two calls behind the
// Gantt, the portal snapshot and the ICS export. The anchor reads the FIRST TEN
// characters of startDate as the calendar day. A private reading via
// calendarDayOf once re-projected a Supabase round-tripped instant
// ('2026-06-01T00:00:00.000Z') into LOCAL time, so west of UTC the chip named
// an install date one day before the one on the GC's schedule.
function scheduleAnchorOf(schedule: ScheduleForDue | null | undefined): Date | null {
  return schedule ? resolveScheduleAnchor(schedule).date : null;
}

function taskStartOn(scheduleStart: Date, schedule: ScheduleForDue, startDay: number): Date {
  return taskCalendarRange(
    { startDay: Math.floor(startDay), durationDays: 1 },
    scheduleStart,
    schedule.workingDaysPerWeek,
    schedule.nonWorkingDates,
  ).start;
}

/** A task's calendar start ('YYYY-MM-DD'), or null when the schedule has no
 *  real start date — for the install-task picker's row labels. Never today. */
export function scheduleTaskCalendarStart(
  schedule: ScheduleForDue | null | undefined,
  startDay: number,
): string | null {
  const start = scheduleAnchorOf(schedule);
  if (!schedule || !start || !Number.isFinite(startDay)) return null;
  return toCalendarDayString(taskStartOn(start, schedule, startDay));
}

export function suggestSelectionDueDate(input: {
  schedule: ScheduleForDue | null | undefined;
  taskId: string | null | undefined;
  options: readonly Pick<SelectionOption, 'productName' | 'brand' | 'leadTimeDays'>[];
  bufferDays?: number;
}): SelectionDueSuggestion {
  const { schedule, taskId } = input;
  const bufferDays = Math.max(0, Math.round(input.bufferDays ?? SELECTION_DUE_BUFFER_DAYS));

  // A bare/ISO start that isn't a real calendar day is the same as no start:
  // never substitute today.
  const scheduleStart = scheduleAnchorOf(schedule);
  if (!schedule || !scheduleStart) {
    return {
      ok: false,
      reason: 'no-schedule-start',
      message: 'The schedule has no start date, so its tasks have no calendar dates to count back from.',
    };
  }

  let lead: { days: number; name: string } | null = null;
  for (const o of input.options) {
    const d = o.leadTimeDays;
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0) continue;
    if (!lead || d > lead.days) {
      lead = { days: Math.round(d), name: [o.brand, o.productName].filter(Boolean).join(' ') || 'an option' };
    }
  }
  if (!lead) {
    return {
      ok: false,
      reason: 'no-lead-time',
      message: 'None of these options has a lead time, so there is nothing to count back.',
    };
  }

  // Asked after the lead time on purpose: when no option has one, the screen
  // can say so BEFORE the GC bothers picking a task that could not help.
  if (!taskId) {
    return { ok: false, reason: 'no-task-picked', message: 'Pick the install task to count back from.' };
  }
  const task = schedule.tasks.find(t => t.id === taskId);
  if (!task || !Number.isFinite(task.startDay)) {
    return { ok: false, reason: 'task-not-found', message: 'That task is no longer on the schedule.' };
  }

  const install = taskStartOn(scheduleStart, schedule, task.startDay);
  // Lead time and buffer are CALENDAR days — a supplier's "6 weeks" includes
  // weekends.
  const due = addCalendarDays(install, -(lead.days + bufferDays));
  const installDate = toCalendarDayString(install);
  const dueDate = toCalendarDayString(due);

  // Year only when the two dates straddle one, so "Jan 4 → pick by Nov 20"
  // can't read as the same winter.
  const sameYear = install.getFullYear() === due.getFullYear();
  const fmt = (d: string) => formatCalendarDay(
    d,
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  );
  const title = task.title?.trim() || 'Install task';
  const chip = `${title} ${fmt(installDate)} − ${lead.days}d lead (${lead.name}) − ${bufferDays}d buffer → pick by ${fmt(dueDate)}`;

  return {
    ok: true, dueDate, installDate, taskTitle: title,
    leadDays: lead.days, leadOptionName: lead.name, bufferDays, chip,
  };
}
