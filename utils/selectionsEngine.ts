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

/**
 * The selections read, failure-aware (wave 5, #52). fetchSelectionsForProject
 * answers [] when the categories read fails and hands back categories with NO
 * options when the options read fails — so the handover row read "No allowance
 * categories yet" with no signal, and "0 of 4 picked" when only the options
 * read dropped. Its return type is pinned by five other screens, so this is a
 * separate reader: a failed read of EITHER table is `{ ok: false }`, never an
 * empty answer.
 */
export async function loadSelectionsChecked(
  projectId: string,
): Promise<{ ok: true; value: SelectionCategory[] } | { ok: false; error: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'No backend configured.' };
  try {
    const { data: cats, error: catsErr } = await supabase
      .from('selection_categories')
      .select('*')
      .eq('project_id', projectId)
      .order('display_order', { ascending: true });
    if (catsErr || !cats) return { ok: false, error: catsErr?.message || 'The selections could not be read.' };
    const ids = cats.map(c => c.id);
    if (ids.length === 0) return { ok: true, value: [] };
    const { data: opts, error: optsErr } = await supabase
      .from('selection_options')
      .select('*')
      .in('category_id', ids)
      .order('unit_price', { ascending: true });
    if (optsErr || !opts) return { ok: false, error: optsErr?.message || 'The selection options could not be read.' };
    const byCategory = new Map<string, SelectionOption[]>();
    for (const o of opts) {
      const opt = rowToOption(o as SelectionOptionRow);
      const arr = byCategory.get(opt.categoryId) ?? [];
      arr.push(opt);
      byCategory.set(opt.categoryId, arr);
    }
    return { ok: true, value: cats.map(c => rowToCategory(c as SelectionCategoryRow, byCategory.get(c.id) ?? [])) };
  } catch (e) {
    // supabase-js can reject (not answer { error }) on a dropped connection.
    return { ok: false, error: e instanceof Error ? e.message : 'The selections could not be read.' };
  }
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
// would put back the `status` that card was fetched with — undoing the
// 'chosen' / 'exceeded' a later pick wrote (the homeowner's portal pick writes
// it since 20260923140000, the GC's through gc_choose_selection). Routed
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

// ─── Queue-aware writes (wave 5, #137) ─────────────────────────────
//
// The functions above talk to Supabase directly: offline, adding a category or
// deleting one simply failed, and the screen could not tell "saved" from "will
// save when you're back" from "lost". These variants go through the offline
// queue (supabaseWriteDetailed) and return its WriteOutcome. The originals keep
// their signatures — app/selections.tsx and the dev seeders import them — and
// the screen moves to these at the join.

/** A category written through the queue. New categories get a CLIENT uuid so
 *  the queued insert and the optimistic card share one id. */
export async function saveSelectionCategoryDetailed(
  c: Partial<SelectionCategory> & { id?: string; projectId: string; category: string; budget: number; styleBrief?: string },
): Promise<{ outcome: WriteOutcome; category: SelectionCategory | null }> {
  if (!isSupabaseConfigured) return { outcome: 'failed', category: null };
  let userId: string | undefined;
  try {
    const session = await supabase.auth.getSession();
    userId = session.data.session?.user?.id;
  } catch { userId = undefined; }
  if (!userId) return { outcome: 'failed', category: null };
  const now = new Date().toISOString();
  if (!c.id) {
    const row = {
      id: generateUUID(),
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
    const outcome = await supabaseWriteDetailed('selection_categories', 'insert', row);
    if (outcome === 'failed') return { outcome, category: null };
    return {
      outcome,
      category: rowToCategory({ ...row, created_at: now, updated_at: now } as SelectionCategoryRow, []),
    };
  }
  // An existing category: send only what the caller set. Never `status` unless
  // it was asked for — the whole-row upsert above is how a stale card undid a
  // homeowner's pick.
  const patch: Record<string, unknown> = { id: c.id, category: c.category, budget: c.budget };
  if (c.styleBrief !== undefined) patch.style_brief = c.styleBrief;
  if (c.notes !== undefined) patch.notes = c.notes;
  if (c.displayOrder !== undefined) patch.display_order = c.displayOrder;
  if (c.dueDate !== undefined) patch.due_date = c.dueDate ?? null;
  if (c.status !== undefined) patch.status = c.status;
  const outcome = await supabaseWriteDetailed('selection_categories', 'update', patch);
  return { outcome, category: null };
}

export async function deleteSelectionCategoryDetailed(id: string): Promise<WriteOutcome> {
  return supabaseWriteDetailed('selection_categories', 'delete', { id });
}

/** An option written through the queue. On an EXISTING option the pick columns
 *  (is_chosen / chosen_at / chosen_by_role) are never sent — picks go through
 *  chooseSelectionOptionDetailed — because saveSelectionOption's upsert writes
 *  `is_chosen: o.isChosen ?? false`, so setting a photo on the chosen option
 *  un-chose it. On an existing option unit price and quantity travel as a
 *  PAIR (total = unitPrice × quantity, to the cent) or not at all: the same
 *  upsert re-derived total as unitPrice × (quantity ?? 1), so a photo edit on
 *  a 60 sq ft tile option rewrote its total to one square foot. Half a pair
 *  is refused with OPTION_PRICE_NEEDS_QUANTITY rather than written or
 *  silently dropped — a reported success must mean the price changed. */
export const OPTION_PRICE_NEEDS_QUANTITY = 'A price change needs the quantity too, so the option total stays right. Nothing was saved.';

export type NewSelectionOptionInput = Partial<SelectionOption> & {
  id?: undefined; categoryId: string; productName: string; unitPrice: number;
};
export type SelectionOptionEditInput = Partial<SelectionOption> & {
  id: string; categoryId: string; productName: string;
};

export async function saveSelectionOptionDetailed(
  o: NewSelectionOptionInput | SelectionOptionEditInput,
): Promise<{ outcome: WriteOutcome; option: SelectionOption | null; message?: string }> {
  if (!isSupabaseConfigured) return { outcome: 'failed', option: null };
  if (o.id && (o.unitPrice === undefined) !== (o.quantity === undefined)) {
    return { outcome: 'failed', option: null, message: OPTION_PRICE_NEEDS_QUANTITY };
  }
  const quantity = o.quantity ?? 1;
  const total = Math.round((o.unitPrice ?? 0) * quantity * 100) / 100;
  if (!o.id) {
    const row = {
      id: generateUUID(),
      category_id: o.categoryId,
      source: o.source ?? 'gc_added',
      product_name: o.productName,
      brand: o.brand ?? '',
      sku: o.sku ?? '',
      description: o.description ?? '',
      image_url: o.imageUrl ?? null,
      product_url: o.productUrl ?? null,
      unit_price: o.unitPrice,
      unit: o.unit ?? 'ea',
      quantity,
      total,
      lead_time_days: o.leadTimeDays ?? null,
      supplier: o.supplier ?? null,
      highlights: o.highlights ?? [],
      is_chosen: false,
    };
    const outcome = await supabaseWriteDetailed('selection_options', 'insert', row);
    if (outcome === 'failed') return { outcome, option: null };
    return {
      outcome,
      option: rowToOption({ ...row, chosen_at: null, chosen_by_role: null, created_at: new Date().toISOString() } as SelectionOptionRow),
    };
  }
  const patch: Record<string, unknown> = { id: o.id, product_name: o.productName };
  if (o.unitPrice !== undefined && o.quantity !== undefined) {
    patch.unit_price = o.unitPrice;
    patch.quantity = quantity;
    patch.total = total;
  }
  if (o.brand !== undefined) patch.brand = o.brand;
  if (o.sku !== undefined) patch.sku = o.sku;
  if (o.description !== undefined) patch.description = o.description;
  if (o.imageUrl !== undefined) patch.image_url = o.imageUrl ?? null;
  if (o.productUrl !== undefined) patch.product_url = o.productUrl ?? null;
  if (o.unit !== undefined) patch.unit = o.unit;
  if (o.leadTimeDays !== undefined) patch.lead_time_days = o.leadTimeDays ?? null;
  if (o.supplier !== undefined) patch.supplier = o.supplier ?? null;
  if (o.highlights !== undefined) patch.highlights = o.highlights;
  const outcome = await supabaseWriteDetailed('selection_options', 'update', patch);
  return { outcome, option: null };
}

// ─── Choose ────────────────────────────────────────────────────────

export type ChooseOutcome =
  | { ok: true; status: 'chosen' | 'exceeded'; /** dollars over the allowance, 0 when within */ over: number }
  | { ok: false; reason: 'offline' | 'denied' | 'failed'; message: string };

/** Choosing is refused offline rather than queued: the homeowner may be
 *  picking the same category in the portal right now, and a pick replayed
 *  hours later would silently overwrite his. */
export const CHOOSE_OFFLINE_MESSAGE = 'Choosing needs signal — the homeowner may be picking in the portal right now. Try again when you\'re back online.';

function looksLikeNetworkFailure(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('network request failed') || m.includes('failed to fetch')
    || m.includes('load failed') || m.includes('network') || m.includes('timed out') || m.includes('timeout');
}

/**
 * The GC's pick, in ONE server transaction (gc_choose_selection,
 * 20260923140000): owner check, clear the other options, set this one, set the
 * category's 'chosen' / 'exceeded' status. It used to be three client writes —
 * clear, set, status — so a timeout between the first two left the category
 * with NO pick: the homeowner's earlier choice wiped and the GC's never saved.
 * Now a failure anywhere rolls the whole thing back and the homeowner's pick
 * stays.
 */
export async function chooseSelectionOptionDetailed(categoryId: string, optionId: string): Promise<ChooseOutcome> {
  if (!isSupabaseConfigured) return { ok: false, reason: 'failed', message: 'No backend configured.' };
  try {
    const { data, error } = await supabase.rpc('gc_choose_selection', {
      p_category_id: categoryId,
      p_option_id: optionId,
    });
    if (error) {
      const msg = error.message ?? '';
      if (looksLikeNetworkFailure(msg)) return { ok: false, reason: 'offline', message: CHOOSE_OFFLINE_MESSAGE };
      if (msg.includes('selection_denied') || (error as { code?: string }).code === '42501') {
        return { ok: false, reason: 'denied', message: 'Only the project owner can choose on this category.' };
      }
      console.warn('[selectionsEngine] gc_choose_selection error:', msg);
      return { ok: false, reason: 'failed', message: 'The pick was not saved. Nothing changed — try again.' };
    }
    const res = (data ?? {}) as { ok?: boolean; status?: string; over?: number | string };
    if (!res.ok) return { ok: false, reason: 'failed', message: 'The pick was not saved. Nothing changed — try again.' };
    return {
      ok: true,
      status: res.status === 'exceeded' ? 'exceeded' : 'chosen',
      over: Math.max(0, Number(res.over ?? 0) || 0),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof TypeError || looksLikeNetworkFailure(msg)) {
      return { ok: false, reason: 'offline', message: CHOOSE_OFFLINE_MESSAGE };
    }
    return { ok: false, reason: 'failed', message: 'The pick was not saved. Nothing changed — try again.' };
  }
}

/**
 * Boolean form, kept for app/selections.tsx and the dev seeders. `role` is no
 * longer written: gc_choose_selection records every pick made from the GC's
 * signed-in app as 'gc' — only the portal RPC may record a homeowner's pick,
 * so the GC's app cannot attribute a choice to the client.
 */
export async function chooseSelectionOption(categoryId: string, optionId: string, _role: 'homeowner' | 'gc'): Promise<boolean> {
  return (await chooseSelectionOptionDetailed(categoryId, optionId)).ok;
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

  // Move the category to 'browsing' now that options exist — but ONLY out of
  // 'pending'. Unconditionally, re-curating after the homeowner had picked
  // demoted a 'chosen' / 'exceeded' category back to 'browsing' (#137), and the
  // overage CTA with it. The options themselves are saved either way, so a
  // failed status write is reported in the log, not as a failed save.
  const { error: statusErr } = await supabase
    .from('selection_categories')
    .update({ status: 'browsing' })
    .eq('id', categoryId)
    .eq('status', 'pending');
  if (statusErr) console.warn('[selectionsEngine] browsing status error:', statusErr.message);
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
