// scopeSheet.ts — generate the AI Scope Sheet (inclusions / exclusions /
// clarifications / assumptions / allowances) from a project's priced estimate.
//
// Why: the estimator's narrative — what's in, what's out, what we assumed — is
// the single most-lost piece in the estimate handoff. The number transfers;
// the story doesn't. This drafts that story straight off the estimate line
// items so it exists as a real document the GC can edit, attach to a proposal,
// and lean on at change-order time ("was that in scope?").
//
// Generation goes through the existing `ai` relay (utils/mageAI → Gemini,
// structured JSON via schemaHint). If the model is unavailable / the user is
// offline / capped, we fall back to a deterministic heuristic sheet so the
// screen is never empty. Persistence is local (AsyncStorage, mageid_*
// namespace) keyed by project — Supabase sync is a deliberate follow-up.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { mageAI } from '@/utils/mageAI';
import type { Project, ScopeSheet, ScopeSheetItem } from '@/types';

const STORAGE_KEY = 'mageid_scope_sheets'; // map: projectId -> ScopeSheet

// ── estimate extraction ──────────────────────────────────────────────────────
interface DigestItem { name: string; group: string; qty: number; unit: string; total: number; isAllowance: boolean }

function estimateItems(project: Project): DigestItem[] {
  const le = project.linkedEstimate;
  if (le && le.items.length > 0) {
    return le.items.map((i) => ({
      name: i.name,
      group: i.csiDivision ? `CSI ${i.csiDivision}` : (i.category || 'General'),
      qty: i.quantity,
      unit: i.unit,
      total: i.lineTotal,
      isAllowance: !!i.isAllowance,
    }));
  }
  const mats = project.estimate?.materials ?? [];
  return mats.map((m) => ({
    name: m.name,
    group: m.category || 'General',
    qty: m.quantity,
    unit: m.unit,
    total: m.totalPrice,
    isAllowance: false,
  }));
}

export function estimateTotalOf(project: Project): number {
  return project.linkedEstimate?.grandTotal || project.estimate?.grandTotal || 0;
}

/** Compact, token-bounded text digest of the estimate for the prompt. */
function buildDigest(project: Project): string {
  const items = estimateItems(project);
  const byGroup = new Map<string, DigestItem[]>();
  for (const it of items) {
    const arr = byGroup.get(it.group) ?? [];
    arr.push(it);
    byGroup.set(it.group, arr);
  }
  const lines: string[] = [];
  lines.push(`Project type: ${project.type || 'n/a'}`);
  if (project.location) lines.push(`Location: ${project.location}`);
  if (project.squareFootage) lines.push(`Size: ${project.squareFootage} sq ft`);
  if (project.quality) lines.push(`Quality level: ${project.quality}`);
  if (project.description) lines.push(`Scope notes: ${String(project.description).slice(0, 400)}`);
  lines.push(`Estimate total: $${Math.round(estimateTotalOf(project)).toLocaleString('en-US')}`);
  lines.push('');
  lines.push('Estimate line items, grouped by trade:');
  for (const [group, arr] of byGroup) {
    lines.push(`• ${group}:`);
    // cap per group so a 300-line estimate doesn't blow the token budget
    for (const it of arr.slice(0, 12)) {
      lines.push(`   - ${it.name}${it.qty ? ` (${it.qty} ${it.unit})` : ''}${it.isAllowance ? ' [ALLOWANCE]' : ''}`);
    }
    if (arr.length > 12) lines.push(`   - …and ${arr.length - 12} more`);
  }
  return lines.join('\n');
}

// ── AI generation ────────────────────────────────────────────────────────────
const SCHEMA_HINT = {
  inclusions: [{ text: 'Demolition and haul-off of existing kitchen cabinetry and countertops', trade: 'Demolition' }],
  exclusions: [{ text: 'Hazardous material testing or abatement (asbestos, lead, mold)', trade: 'Environmental', risk: 'high', note: 'Common in pre-1980 structures; not in this estimate' }],
  clarifications: [{ text: 'Final paint colors and finish selections to be confirmed by owner before ordering', trade: 'Finishes', risk: 'medium' }],
  assumptions: [{ text: 'Work performed during normal business hours, Monday–Friday', risk: 'low' }],
  allowances: [{ text: 'Tile material allowance: $8.00 / sq ft', trade: 'Finishes' }],
};

function coerceItems(v: unknown): ScopeSheetItem[] {
  if (!Array.isArray(v)) return [];
  const out: ScopeSheetItem[] = [];
  for (const raw of v) {
    if (typeof raw === 'string' && raw.trim()) { out.push({ text: raw.trim() }); continue; }
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      if (!text) continue;
      const risk = o.risk === 'high' || o.risk === 'medium' || o.risk === 'low' ? o.risk : undefined;
      out.push({
        text,
        trade: typeof o.trade === 'string' && o.trade.trim() ? o.trade.trim() : undefined,
        risk,
        note: typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined,
      });
    }
  }
  return out;
}

export interface GenerateResult {
  sheet: ScopeSheet;
  /** Set when the AI path failed but we returned a heuristic sheet, so the UI
   *  can show a gentle "drafted offline" notice with the reason. */
  warning?: string;
  errorKind?: string;
}

export async function generateScopeSheet(project: Project, opts?: { forceRegenerate?: boolean }): Promise<GenerateResult> {
  const total = estimateTotalOf(project);
  const items = estimateItems(project);
  if (items.length === 0) {
    return { sheet: heuristicScopeSheet(project), warning: 'No estimate line items found — drafted a generic starter sheet.' };
  }

  const prompt = [
    'You are a senior construction estimator writing the SCOPE OF WORK section of a proposal/contract for a general contractor.',
    'From the estimate below, write a clear, defensible scope sheet. Be specific to the trades actually present in the estimate.',
    '',
    'Produce five lists:',
    '1. inclusions — what the contractor IS providing, grouped by trade, in plain confident bullets derived from the line items.',
    '2. exclusions — work commonly assumed by owners but NOT in this estimate (e.g. permits/fees if not line-itemed, hazmat abatement, structural/civil engineering, landscaping, unforeseen/concealed conditions, utility relocation). Flag dispute-prone ones with risk:"high" and a short note.',
    '3. clarifications — ambiguities to pin down before work (selections, access, owner-furnished items, working hours). Flag with risk where money/schedule is at stake.',
    '4. assumptions — site/access/schedule conditions the price depends on.',
    '5. allowances — any line items marked [ALLOWANCE], phrased as an allowance with the amount if known.',
    '',
    'Voice: professional contractor, concise, one idea per bullet. Do not invent line items that are not implied by the estimate. 4–10 items per list.',
    '',
    '=== ESTIMATE ===',
    buildDigest(project),
  ].join('\n');

  const cacheKey = opts?.forceRegenerate
    ? undefined
    : `scope_v1_${project.id}_${Math.round(total)}_${items.length}`;

  const res = await mageAI({
    prompt,
    schemaHint: SCHEMA_HINT,
    tier: 'smart',
    maxTokens: 2600,
    cacheKey,
    cacheHours: 168, // a scope sheet is stable until the estimate changes
    timeoutMs: 60000,
  });

  if (!res.success || !res.data) {
    const reason = res.errorKind === 'unauthenticated'
      ? 'Sign in to use AI — showing a starter sheet you can edit.'
      : res.errorKind === 'monthly_cap'
        ? (res.error || 'AI limit reached this month — showing a starter sheet you can edit.')
        : 'Could not reach AI — drafted a starter sheet you can edit.';
    return { sheet: heuristicScopeSheet(project), warning: reason, errorKind: res.errorKind };
  }

  const d = res.data as Record<string, unknown>;
  const sheet: ScopeSheet = {
    kind: 'scope_sheet_v1',
    projectId: project.id,
    inclusions: coerceItems(d.inclusions),
    exclusions: coerceItems(d.exclusions),
    clarifications: coerceItems(d.clarifications),
    assumptions: coerceItems(d.assumptions),
    allowances: coerceItems(d.allowances),
    source: 'ai',
    estimateTotal: total,
    generatedAt: new Date().toISOString(),
  };

  // If the model returned nothing usable, fall back rather than show an empty sheet.
  const count = sheet.inclusions.length + sheet.exclusions.length + sheet.clarifications.length + sheet.assumptions.length + sheet.allowances.length;
  if (count === 0) {
    return { sheet: heuristicScopeSheet(project), warning: 'AI returned an empty draft — showing a starter sheet you can edit.' };
  }
  return { sheet };
}

// ── deterministic fallback ───────────────────────────────────────────────────
export function heuristicScopeSheet(project: Project): ScopeSheet {
  const items = estimateItems(project);
  const groups = Array.from(new Set(items.map((i) => i.group)));
  const inclusions: ScopeSheetItem[] = groups.length
    ? groups.map((g) => ({ text: `${g.replace(/^CSI\s+/, 'CSI Division ')} work as detailed in the attached estimate`, trade: g }))
    : [{ text: 'All work as detailed in the attached estimate' }];

  const allowances: ScopeSheetItem[] = items
    .filter((i) => i.isAllowance)
    .map((i) => ({ text: `${i.name}: carried as an allowance`, trade: i.group }));

  return {
    kind: 'scope_sheet_v1',
    projectId: project.id,
    inclusions,
    exclusions: [
      { text: 'Permits, fees, and municipal approvals unless explicitly listed in the estimate', trade: 'General', risk: 'medium' },
      { text: 'Hazardous material testing or abatement (asbestos, lead, mold)', trade: 'Environmental', risk: 'high', note: 'Common in older structures; testing not included' },
      { text: 'Unforeseen or concealed conditions discovered during construction', trade: 'General', risk: 'high', note: 'Handled by change order at documented cost' },
      { text: 'Structural, civil, or geotechnical engineering and design', trade: 'Engineering' },
      { text: 'Relocation of unknown or undocumented utilities', trade: 'Sitework', risk: 'medium' },
      { text: 'Any work not described in the attached estimate', trade: 'General' },
    ],
    clarifications: [
      { text: 'Final finish selections (colors, models, fixtures) to be confirmed by owner prior to ordering', trade: 'Finishes', risk: 'medium' },
      { text: 'Pricing assumes continuous, unobstructed access to the work area', trade: 'General' },
    ],
    assumptions: [
      { text: 'Work performed during normal business hours, Monday–Friday', risk: 'low' },
      { text: 'Existing structure is sound and code-compliant unless noted otherwise', risk: 'medium' },
      { text: 'Owner provides power and water at the site during construction', risk: 'low' },
    ],
    allowances,
    source: 'heuristic',
    estimateTotal: estimateTotalOf(project),
    generatedAt: new Date().toISOString(),
  };
}

// ── persistence (local, offline-first) ───────────────────────────────────────
export async function loadScopeSheet(projectId: string): Promise<ScopeSheet | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, ScopeSheet>;
    return map[projectId] ?? null;
  } catch {
    return null;
  }
}

export async function saveScopeSheet(sheet: ScopeSheet): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, ScopeSheet>) : {};
    map[sheet.projectId] = sheet;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // best-effort; the screen keeps the in-memory copy regardless
  }
}

// ── plain-text export (copy / share / paste into a proposal) ──────────────────
export function scopeSheetToText(sheet: ScopeSheet, projectName?: string): string {
  const section = (title: string, items: ScopeSheetItem[]) => {
    if (!items.length) return '';
    const body = items
      .map((i) => `  • ${i.text}${i.trade ? ` (${i.trade})` : ''}${i.note ? ` — ${i.note}` : ''}`)
      .join('\n');
    return `${title}\n${body}\n`;
  };
  return [
    `SCOPE OF WORK${projectName ? ` — ${projectName}` : ''}`,
    '',
    section('INCLUSIONS', sheet.inclusions),
    section('EXCLUSIONS', sheet.exclusions),
    section('CLARIFICATIONS', sheet.clarifications),
    section('ASSUMPTIONS', sheet.assumptions),
    section('ALLOWANCES', sheet.allowances),
  ].filter(Boolean).join('\n').trim();
}
