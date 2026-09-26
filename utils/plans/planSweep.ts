// utils/plans/planSweep.ts — pure. Plan Set Code Sweep: "sweep my plans for
// questions in my scope".
//
// What it decides, without React, storage or network (scripts/validate-plan-sweep.ts
// runs every function here under bun):
//   • WHICH topics to look for — the job's own scope (estimate lines and scope
//     notes, the same inputs Scope Code Gaps reads) run through the Scope Code
//     Gaps starter rules; a fixed list of common plan-review topics when the
//     job has no scope on file, and the panel says so;
//   • WHICH sheets to spend a plan review on — the plan search's confident
//     matches per topic, scored per sheet; every current sheet ends up in
//     exactly one of "reviewed" or "not reviewed", each with its reason;
//   • HOW a finding reads — as a QUESTION FOR THE ARCHITECT. The model's own
//     words go through neutralizeModelText before they are shown or drafted,
//     because that text lands in an RFI addressed to the architect;
//   • the RFI draft — rfiFromPin's shape (unsent, ball in the GC's court, no
//     addressee, 14 calendar days), with a question that says the code
//     reference is the model's recall.
//
// Honesty: this is a pre-check that raises questions. It is not plan review;
// nothing here says "passed", "compliant" or "violation".

import type { PlanSheet, ProjectType } from '@/types';
import { CODE_SCOPE_RULES, type CodeScopeRule } from '@/utils/codeScopeTriggers';
import { normalizeScopeText, phraseInNorm } from '@/utils/scopeCoverage';
import { confidentMatches } from './memoryIndexCore';
import { rfiFromPin, pinPositionPhrase, splitMatchesByCurrentSheet } from './revisionActions';
import { sheetIdFromDocId } from './planChunk';
import type { PlanMatch } from './planAnswer';
import {
  citationEvidenceFor, editionMismatchFor, type CitationEvidence, type EditionMismatch,
} from '@/utils/codeAmendments';
import type { ResolvedCodeJurisdiction } from '@/utils/codeJurisdiction';
import type { PlanCodeFindingRaw } from '@/utils/planCodeReviewer';

// ── Words ──────────────────────────────────────────────────────────────────

/** Words a sweep never shows or drafts: a finding is a question, never a verdict. */
export const FORBIDDEN_WORDS = /\b(violat\w*|non-?compliant|fails? code|illegal|code violation)\b/i;

/** The most plan reviews one sweep spends, whatever the allowance. */
export const SWEEP_MAX_SHEETS = 6;
/** The most scope topics one sweep searches (one plan search each). */
export const SWEEP_MAX_TARGETS = 8;

/** Every user-facing sentence of the panel, in one place the validator scans. */
export const sweepCopy = {
  heading: 'Questions for your architect',
  subheading: 'A pre-check of the sheets that matter for your scope',
  recallLine: 'Every code reference below is the AI\'s recall, not a lookup.',
  editionPrefix: 'Code edition: ',
  notPlanReview: 'This raises questions for the architect. It is not a plan review.',
  freeBlocked: 'Plan Set Code Sweep needs Pro (10 sheet reviews a month) or Business (30).',
  seePlans: 'See plans',
  noSheets: 'Upload plan sheets first.',
  needsIndex: 'Index your plans first: Ask your plans → Index. The sweep can only pick sheets it can search.',
  generalBasis: 'No scope on file — MAGE searched for common plan-review topics instead.',
  scopeBasis: 'Looking for these topics from your estimate and scope notes:',
  findButton: (k: number) => `Find the sheets for my scope — uses up to ${k} plan search${k === 1 ? '' : 'es'}`,
  findBusy: 'Searching your plans…',
  reviewButton: (n: number, left: number) =>
    `Review ${n === 1 ? 'this sheet' : `these ${n} sheets`} — uses ${n} of your ${left} plan review${left === 1 ? '' : 's'} left this month`,
  reviewButtonUnknown: (n: number) => `Review ${n === 1 ? 'this sheet' : `these ${n} sheets`} — uses ${n} plan review${n === 1 ? '' : 's'}`,
  allowanceUnknown: 'Couldn\'t read how many reviews you have left; the sweep stops when the server says the limit is reached.',
  noAllowance: 'You have no plan reviews left this month, so no sheet can be reviewed. Your allowance resets on the 1st.',
  nothingToReview: 'No sheet matched your scope, so there is nothing to review yet.',
  progress: (sheet: string, i: number, n: number) => `Reviewing ${sheet} (${i} of ${n})…`,
  cancel: 'Cancel',
  cancelled: 'Cancelled — not reviewed',
  toReviewTitle: 'Sheets to review',
  reviewedTitle: 'Sheets reviewed',
  notReviewedTitle: 'Sheets NOT reviewed',
  allReviewed: (n: number) => `All ${n} current sheet${n === 1 ? ' was' : 's were'} reviewed.`,
  chosenFor: 'Chosen for',
  findingsTitle: 'Questions raised',
  observed: 'Observed',
  requirementLabel: 'Requirement (model recall — not looked up)',
  recallBadge: 'Model recall',
  noLocation: 'The AI could not place this on the sheet, so no pin will be added.',
  draftRfi: 'Draft RFI to architect',
  drafted: (n: number) => `RFI #${n} drafted — not sent`,
  noFindings: (sheet: string) =>
    `No questions raised on ${sheet} for your scope. The AI only flags what it can see; this is not a plan review.`,
  notSaved: 'This sweep isn\'t saved — draft the RFIs you want before closing.',
  reviewFailed: (reason: string) => `The plan review didn't answer for it${reason ? ` (${reason.replace(/\s*[.!]+\s*$/, '')})` : ''} — not reviewed`,
  imageUnreadable: 'The sheet image couldn\'t be read — not reviewed',
  monthlyLimit: 'Your monthly plan-review limit was reached — not reviewed',
  hourlyLimit: 'The hourly plan-review limit was reached — not reviewed',
  whyNotIndexed: 'Not in your plan index — MAGE can\'t search it; index it in Ask your plans',
  whyNoMatch: 'Nothing on it matched your scope',
  whyNoMatchUnknownIndex: 'Nothing on it matched your scope (index status couldn\'t be read)',
  whyOverLimit: (n: number) => `Matched, but over this sweep's limit of ${n} sheet${n === 1 ? '' : 's'}`,
  whySearchFailed: 'The plan search didn\'t answer for it — not reviewed',
  severity: { high: 'High', med: 'Medium', low: 'Low' } as Record<'high' | 'med' | 'low', string>,
  confidence: { high: 'High confidence', med: 'Medium confidence', low: 'Low confidence' } as Record<'high' | 'med' | 'low', string>,
} as const;

// ── 1. What to look for ────────────────────────────────────────────────────

export interface SweepTarget {
  id: string;
  /** 2–5 words, what the panel lists and what "Chosen for" names. */
  topic: string;
  /** The search query and the scope line the model reads: topic + the words
   *  in HIS scope that fired it. ≤ 80 characters (the server's clip). */
  phrase: string;
  /** The first scope word that fired it ('project type' for a type rule). */
  trigger: string;
}

export interface SweepTargets {
  basis: 'scope' | 'general';
  targets: SweepTarget[];
}

/** Searched when the job has no scope on file. Phrased as plan-review topics. */
export const GENERAL_SWEEP_TARGETS: readonly SweepTarget[] = [
  { id: 'general-egress', topic: 'Egress windows and doors', phrase: 'Egress windows and doors', trigger: 'general' },
  { id: 'general-stairs', topic: 'Stairs, handrails and guards', phrase: 'Stairs, handrails and guards', trigger: 'general' },
  { id: 'general-fire', topic: 'Fire separation and rated assemblies', phrase: 'Fire separation and rated assemblies', trigger: 'general' },
  { id: 'general-accessible', topic: 'Accessible route and clearances', phrase: 'Accessible route and clearances', trigger: 'general' },
  { id: 'general-alarms', topic: 'Smoke and CO alarms', phrase: 'Smoke and CO alarms', trigger: 'general' },
];

export interface ScopeTargetsInput {
  lines: readonly { name?: string | null; category?: string | null; description?: string | null }[];
  scopeNotes?: readonly (string | null | undefined)[];
  projectType?: ProjectType | null;
  jobKind: 'residential' | 'commercial';
  /** Test seam: defaults to the shipped starter table. */
  rules?: readonly CodeScopeRule[];
}

function clipPhrase(s: string, max = 80): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : one.slice(0, max).replace(/[\s,;:—-]+$/, '');
}

/**
 * The topics to search for, from the job's own scope. The same matching as
 * Scope Code Gaps (utils/scopeGaps evaluateScopeGaps): a rule fires when a line
 * or note contains one of its triggers and none of its excludeLinePhrases, and
 * only on the jobs it is written for (res / com). At most 8, in rule order.
 */
export function scopeTargetsFor(input: ScopeTargetsInput): SweepTargets {
  const rules = input.rules ?? CODE_SCOPE_RULES;
  const sources: string[] = [];
  for (const l of input.lines) {
    const norm = normalizeScopeText(`${l?.name ?? ''} ${l?.description ?? ''} ${l?.category ?? ''}`);
    if (norm) sources.push(norm);
  }
  for (const n of input.scopeNotes ?? []) {
    const norm = normalizeScopeText(n ?? '');
    if (norm) sources.push(norm);
  }

  const targets: SweepTarget[] = [];
  for (const rule of rules) {
    if (targets.length >= SWEEP_MAX_TARGETS) break;
    if (rule.projects === 'res' && input.jobKind !== 'residential') continue;
    if (rule.projects === 'com' && input.jobKind !== 'commercial') continue;
    const fired: string[] = [];
    for (const norm of sources) {
      if ((rule.excludeLinePhrases ?? []).some(x => phraseInNorm(norm, x))) continue;
      for (const t of rule.triggers) {
        if (phraseInNorm(norm, t) && !fired.includes(t)) fired.push(t);
      }
    }
    const byType = !!input.projectType && (rule.projectTypes ?? []).includes(input.projectType);
    if (fired.length === 0 && !byType) continue;
    const trigger = fired[0] ?? 'project type';
    const phrase = fired.length > 0 ? clipPhrase(`${rule.topic}: ${fired.join(', ')}`) : clipPhrase(rule.topic);
    targets.push({ id: rule.id, topic: rule.topic, phrase, trigger });
  }
  if (targets.length === 0) return { basis: 'general', targets: GENERAL_SWEEP_TARGETS.map(t => ({ ...t })) };
  return { basis: 'scope', targets };
}

// ── 2. Which sheets ────────────────────────────────────────────────────────

export type NotReviewedKind =
  | 'not_indexed' | 'no_match' | 'over_limit' | 'search_failed' | 'review_stopped' | 'review_failed' | 'cancelled';

export interface SweepReason { topic: string; snippet: string }
export interface SelectedSheet { sheet: PlanSheet; score: number; reasons: SweepReason[] }
export interface NotReviewedSheet { sheet: PlanSheet; kind: NotReviewedKind; why: string }

/** One topic's plan search: its matches, or null when that search failed. */
export interface SweepSearch { target: SweepTarget; matches: readonly PlanMatch[] | null }

export interface SelectSheetsInput {
  searches: readonly SweepSearch[];
  sheets: readonly PlanSheet[];
  /** Current sheets the index holds with this drawing. null = the manifest
   *  could not be read: index status unknown, the search decides. */
  indexedSheetIds: ReadonlySet<string> | null;
  limit: number;
  /** Stage A stopped on a refusal (a cap, a rate limit): the function's own
   *  sentence, given to every sheet not selected before the stop. */
  stoppedWhy?: string | null;
  /** The reason a matched sheet past the limit reads; defaults to whyOverLimit. */
  overLimitWhy?: string | null;
}

export interface SelectSheetsResult { selected: SelectedSheet[]; notReviewed: NotReviewedSheet[] }

const sheetNo = (s: { sheetNumber?: string; name: string }) => (s.sheetNumber ?? '').trim() || s.name || 'Sheet';

function snippetOf(content: string): string {
  const one = (content ?? '').replace(/\s+/g, ' ').trim();
  return one.length <= 90 ? one : `${one.slice(0, 89).trimEnd()}…`;
}

/**
 * Score each current sheet by its best confident match plus 0.05 for every
 * distinct topic that hit it; keep the top `limit`. EVERY current sheet lands
 * in exactly one of the two lists, with the reason it is there.
 */
export function selectSheets(input: SelectSheetsInput): SelectSheetsResult {
  const current = input.sheets.filter(s => s.superseded !== true);
  const limit = Math.max(0, Math.floor(Number.isFinite(input.limit) ? input.limit : 0));
  const indexed = input.indexedSheetIds;
  const anyFailed = input.searches.some(s => s.matches === null);

  const hits = new Map<string, { best: number; topics: Map<string, SweepReason> }>();
  for (const search of input.searches) {
    if (!search.matches) continue;
    const { current: live } = splitMatchesByCurrentSheet(search.matches, current);
    for (const m of confidentMatches(live)) {
      const id = sheetIdFromDocId(m.doc_id);
      if (!id) continue;
      if (indexed && !indexed.has(id)) continue;
      const h = hits.get(id) ?? { best: 0, topics: new Map<string, SweepReason>() };
      h.best = Math.max(h.best, m.similarity);
      if (!h.topics.has(search.target.id)) h.topics.set(search.target.id, { topic: search.target.topic, snippet: snippetOf(m.content) });
      hits.set(id, h);
    }
  }

  const matched = current
    .filter(s => hits.has(s.id))
    .map(s => {
      const h = hits.get(s.id)!;
      return { sheet: s, score: h.best + 0.05 * h.topics.size, reasons: [...h.topics.values()] };
    })
    .sort((a, b) => b.score - a.score || sheetNo(a.sheet).localeCompare(sheetNo(b.sheet)));

  const selected = matched.slice(0, limit);
  const chosen = new Set(selected.map(x => x.sheet.id));
  const overWhy = input.overLimitWhy || sweepCopy.whyOverLimit(limit);
  const notReviewed: NotReviewedSheet[] = [];
  for (const s of current) {
    if (chosen.has(s.id)) continue;
    if (indexed && !indexed.has(s.id)) notReviewed.push({ sheet: s, kind: 'not_indexed', why: sweepCopy.whyNotIndexed });
    else if (hits.has(s.id)) notReviewed.push({ sheet: s, kind: 'over_limit', why: overWhy });
    else if (input.stoppedWhy) notReviewed.push({ sheet: s, kind: 'search_failed', why: input.stoppedWhy });
    else if (anyFailed) notReviewed.push({ sheet: s, kind: 'search_failed', why: sweepCopy.whySearchFailed });
    else notReviewed.push({ sheet: s, kind: 'no_match', why: indexed ? sweepCopy.whyNoMatch : sweepCopy.whyNoMatchUnknownIndex });
  }
  return { selected, notReviewed };
}

// ── 3. How a finding reads ─────────────────────────────────────────────────

const NEUTRAL: readonly [RegExp, string][] = [
  [/\b(?:is|are|was|were)\s+in\s+violation\s+of\b/gi, 'may conflict with'],
  [/\bin\s+violation\s+of\b/gi, 'possibly in conflict with'],
  [/\bcode\s+violations\b/gi, 'possible code conflicts'],
  [/\bcode\s+violation\b/gi, 'possible code conflict'],
  [/\bviolations?\s+of\b/gi, 'possible conflict with'],
  [/\bviolat(?:es|e|ed|ing)\b/gi, 'may conflict with'],
  [/\bviolations\b/gi, 'possible conflicts'],
  [/\bviolation\b/gi, 'possible conflict'],
  [/\bnon-?compliant\s+with\b/gi, 'possibly not meeting'],
  [/\bnon-?compliant\b/gi, 'possibly not meeting the requirement'],
  [/\bfails?\s+code\b/gi, 'may not meet code'],
  [/\billegal\b/gi, 'possibly not permitted'],
  // Anything left of the violat- family, whatever its ending.
  [/\bviolat\w*/gi, 'possible conflict'],
];

/**
 * The model's words with every verdict word replaced by neutral wording: this
 * text is shown as a question for the architect and drafted into an RFI to
 * him. The output never matches FORBIDDEN_WORDS.
 */
export function neutralizeModelText(s: string | null | undefined): string {
  let out = String(s ?? '');
  for (const [re, rep] of NEUTRAL) {
    out = out.replace(re, (m: string) => (/^[A-Z]/.test(m) ? rep[0].toUpperCase() + rep.slice(1) : rep));
  }
  // Belt and braces: a spelling the table missed still never reaches him.
  while (FORBIDDEN_WORDS.test(out)) out = out.replace(FORBIDDEN_WORDS, 'possible conflict');
  return out.replace(/\s+/g, ' ').trim();
}

/** Plan Review's citation rule (construction-ai planFindingCitation): the split
 *  edition + section when the function sent them, else the codeRef alone. */
export function sweepCitation(f: { codeRef?: string; citedEdition?: string | null; section?: string | null }): { citedCode: string; section: string } {
  const edition = (f.citedEdition ?? '').trim();
  return { citedCode: edition || (f.codeRef ?? '').trim(), section: edition ? (f.section ?? '').trim() : '' };
}

export function sweepLevel(s: string | null | undefined): 'high' | 'med' | 'low' {
  const v = (s ?? '').toLowerCase();
  return v === 'high' || v === 'low' ? v : 'med';
}

export interface SweepFindingView {
  title: string;
  observed: string;
  requirement: string;
  requirementLabel: string;
  /** The citation as the model wrote it (neutralised); '' when none. */
  citation: string;
  rung: CitationEvidence;
  mismatch: EditionMismatch | null;
  where: string;
  location: { x: number; y: number } | null;
  severity: 'high' | 'med' | 'low';
  confidence: 'high' | 'med' | 'low';
}

function validLocation(v: unknown): { x: number; y: number } | null {
  if (!v || typeof v !== 'object') return null;
  const { x, y } = v as { x?: unknown; y?: unknown };
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

export function sweepFindingView(
  finding: PlanCodeFindingRaw,
  sheet: { sheetNumber?: string; name: string },
  jurisdiction: ResolvedCodeJurisdiction,
): SweepFindingView {
  const question = neutralizeModelText(finding.question);
  const requirement = neutralizeModelText(finding.requirement);
  const observed = neutralizeModelText(finding.observed);
  const codeRef = neutralizeModelText(finding.codeRef);
  const title = question
    || (requirement ? `Confirm: ${requirement}` : 'Confirm this item on the drawing with the architect');
  const cite = sweepCitation({ codeRef, citedEdition: finding.citedEdition, section: finding.section });
  const location = validLocation(finding.location);
  const no = sheetNo(sheet);
  return {
    title,
    observed,
    requirement,
    requirementLabel: sweepCopy.requirementLabel,
    citation: codeRef,
    rung: citationEvidenceFor(jurisdiction, cite.citedCode, cite.section),
    mismatch: editionMismatchFor(jurisdiction, cite.citedCode),
    where: location ? `approximate location: ${pinPositionPhrase(location.x, location.y)} on ${no}` : `location not identified on ${no}`,
    location,
    severity: sweepLevel(finding.severity),
    confidence: sweepLevel(finding.confidence),
  };
}

// ── 4. The RFI draft ───────────────────────────────────────────────────────

/**
 * The addRFI input for "Draft RFI to architect". rfiFromPin's shape exactly —
 * unsent, ball in the GC's court, no addressee, due 14 calendar days out, the
 * sheet attached by its durable key — with the sweep's question. The pin
 * position only feeds rfiFromPin's own question, which is replaced here, so a
 * finding with no location never gets an invented one.
 */
export function rfiFromSweepFinding(
  sheet: { projectId: string; sheetNumber?: string; name: string },
  view: SweepFindingView,
  now: Date,
  sheetImageUri?: string | null,
) {
  const at = view.location ?? { x: 0.5, y: 0.5 };
  const base = rfiFromPin(sheet, { x: at.x, y: at.y, label: view.title }, now, { sheetImageUri });
  const where = view.where.charAt(0).toUpperCase() + view.where.slice(1);
  const cite = view.citation ? ` Code reference (the model's recall): ${view.citation}.` : '';
  const attached = base.attachments.length > 0 ? ` ${sheetNo(sheet)} is attached.` : '';
  const question = neutralizeModelText(
    `${view.title} ${where}. Observed on the drawing: ${view.observed || 'not described'}.${cite} `
    + 'MAGE raised this from an AI pre-check of the sheet; the code reference is the model\'s recall and has not been looked up.'
    + attached,
  );
  return { ...base, question };
}
