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
import { mageAI } from './mageAI';
import { generateUUID } from './generateId';
import type {
  SelectionCategory, SelectionOption, SelectionOptionSource,
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
  byCategory: Array<{
    category: string;
    budget: number;
    chosenTotal: number;
    delta: number;              // chosenTotal - budget (negative = under, positive = over)
    status: SelectionCategory['status'];
  }>;
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
